import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { ZodType } from 'zod';
import { localizeError, resolveLocale, type Locale } from '../../../packages/i18n/src/index';
import { env } from './env';
import { prisma } from './prisma';

export class HttpError extends Error {
  statusCode: number;
  code?: string;
  params?: Record<string, string | number>;
  constructor(statusCode: number, message: string, code?: string, params?: Record<string, string | number>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.params = params;
  }
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message || 'Datos no válidos');
  }
  return result.data;
}

export interface Actor {
  userId: string;
  email: string;
  membership: {
    id: string;
    companyId: string;
    role: string;
    areaId: string | null;
    name: string;
    points: number;
    photoPath: string | null;
    status: string;
    phone: string;
    schedule: string;
    bio: string;
    startDate: string | null;
    lookJson: string;
    jobTitleId: string | null;
    active: boolean;
  };
  mustChangePassword: boolean;
  company: {
    id: string;
    name: string;
    slug: string;
    officeName: string;
    apiKey: string;
    isDemo: boolean;
    moduloLlamadas: boolean;
    locale: string;
  };
  /** Preferencia guardada en el perfil. Vacía si la persona no ha elegido. */
  userLocale: string | null;
  /** Idioma ya resuelto: perfil, luego empresa, luego Accept-Language, luego es. */
  locale: Locale;
  area: { id: string; name: string; color: string; teamName: string } | null;
  jobTitle: { id: string; name: string } | null;
}

export async function actorFromRequest(req: FastifyRequest): Promise<Actor> {
  const custom = req.headers['x-hivex-token'];
  const bearer = req.headers.authorization || '';
  const token = (typeof custom === 'string' && custom) || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');
  if (!token) throw new HttpError(401, 'Inicia sesión para continuar');
  let sub = '';
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
    sub = payload.sub || '';
  } catch {
    throw new HttpError(401, 'La sesión ha caducado. Entra de nuevo');
  }
  const user = await prisma.user.findUnique({
    where: { id: sub },
    include: {
      memberships: {
        where: { active: true },
        include: { company: true, area: true, jobTitle: true },
        take: 1,
      },
    },
  });
  const membership = user?.memberships[0];
  if (!user || !membership) throw new HttpError(401, 'No encontramos tu usuario en ninguna empresa');
  if (user.mustChangePassword) {
    const path = req.url.split('?')[0];
    if (path !== '/api/auth/yo' && path !== '/api/auth/cambiar-clave') {
      throw new HttpError(403, 'Cambia la contraseña temporal antes de continuar.');
    }
  }
  return {
    userId: user.id,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    membership: membership,
    company: membership.company,
    area: membership.area,
    jobTitle: membership.jobTitle,
    userLocale: user.locale,
    locale: resolveLocale({
      user: user.locale,
      company: membership.company.locale,
      acceptLanguage: typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : null,
    }),
  };
}

export function replyError(err: unknown, reply: FastifyReply, locale: Locale) {
  if (err instanceof HttpError) {
    const body = localizeError(locale, err.message, err.code, err.params);
    return reply.code(err.statusCode).send(body);
  }
  const status = typeof err === 'object' && err && 'statusCode' in err ? Number((err as { statusCode: number }).statusCode) : 500;
  const message = err instanceof Error ? err.message : 'Error interno';
  if (status >= 500) console.error(err);
  const code = status >= 500 ? 500 : (status >= 400 && status < 600 ? status : 500);
  const text = code >= 500 ? 'Error interno del servidor' : message;
  const body = localizeError(locale, text);
  return reply.code(code).send(body);
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: '14d' });
}

export function sendError(err: unknown, reply: FastifyReply) {
  return replyError(err, reply, 'es');
}
