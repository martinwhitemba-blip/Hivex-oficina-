import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { resolveLocale, type Locale } from '../../../packages/i18n/src/index';
import { env } from './env';
import { prisma } from './prisma';

function tokenFrom(req: FastifyRequest) {
  const custom = req.headers['x-hivex-token'];
  const bearer = req.headers.authorization || '';
  return (typeof custom === 'string' && custom) || (bearer.startsWith('Bearer ') ? bearer.slice(7) : '');
}

/** Perfil de la persona, luego idioma de la empresa, luego Accept-Language, luego es. */
export async function localeForRequest(req: FastifyRequest): Promise<Locale> {
  const accept = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'] : null;
  const token = tokenFrom(req);
  if (!token) return resolveLocale({ acceptLanguage: accept });
  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub?: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub || '' },
      select: {
        locale: true,
        memberships: { where: { active: true }, take: 1, select: { company: { select: { locale: true } } } },
      },
    });
    return resolveLocale({
      user: user?.locale,
      company: user?.memberships[0]?.company.locale,
      acceptLanguage: accept,
    });
  } catch {
    return resolveLocale({ acceptLanguage: accept });
  }
}
