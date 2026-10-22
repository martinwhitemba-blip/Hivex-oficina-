import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { z } from 'zod';
import { actorFromRequest, HttpError, parseBody } from './http';
import { prisma } from './prisma';
import { photoUrl } from './services';
import { storage } from './storage';

const HEX = /^#[0-9A-Fa-f]{6}$/;
const INK = '#0B0B0C';
const DEFAULTS = { primario: '#F5C518', acento: '#E0A800' };

export function contrastRatio(a: string, b: string) {
  const left = rgb(a);
  const right = rgb(b);
  if (!left || !right) return 0;
  const hi = Math.max(lum(left), lum(right));
  const lo = Math.min(lum(left), lum(right));
  return (hi + 0.05) / (lo + 0.05);
}

export function readableOnInk(color: string) {
  return contrastRatio(color, INK) >= 3;
}

export async function brandDto(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { branding: true } });
  if (!company) throw new HttpError(404, 'Empresa no encontrada');
  return {
    nombre: company.name,
    oficina: company.officeName,
    primario: company.branding?.primaryColor || DEFAULTS.primario,
    acento: company.branding?.accentColor || DEFAULTS.acento,
    logoUrl: photoUrl(company.branding?.logoPath),
    poweredBy: 'HIVEX',
  };
}

export function registerBrandRoutes(app: FastifyInstance) {
  app.get('/api/marca', async (req) => {
    const actor = await actorFromRequest(req);
    return brandDto(actor.company.id);
  });

  app.get('/api/marca/codigo/:code', async (req) => {
    const code = String((req.params as { code: string }).code || '').trim().toUpperCase();
    const company = await prisma.company.findUnique({ where: { joinCode: code } });
    if (!company || !company.joinCodeEnabled) throw new HttpError(404, 'Ese código de acceso no es válido o está desactivado');
    return brandDto(company.id);
  });

  app.patch('/api/marca', async (req) => {
    const actor = await actorFromRequest(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'Solo la dirección puede cambiar la marca');
    const body = parseBody(z.object({
      nombre: z.string().trim().min(2, 'Escribe el nombre de la empresa').max(80),
      oficina: z.string().trim().min(2, 'Escribe el nombre del espacio').max(60),
      primario: z.string().regex(HEX, 'El color tiene que ser hexadecimal'),
      acento: z.string().regex(HEX, 'El color tiene que ser hexadecimal'),
    }), req.body);
    if (!readableOnInk(body.primario) || !readableOnInk(body.acento)) {
      throw new HttpError(400, 'Ese color no se lee sobre el fondo oscuro. Elige uno más claro.');
    }
    await prisma.company.update({
      where: { id: actor.company.id },
      data: { name: body.nombre, officeName: body.oficina },
    });
    await prisma.companyBranding.upsert({
      where: { companyId: actor.company.id },
      create: { companyId: actor.company.id, primaryColor: body.primario, accentColor: body.acento },
      update: { primaryColor: body.primario, accentColor: body.acento },
    });
    return brandDto(actor.company.id);
  });

  app.post('/api/marca/logo', async (req) => {
    const actor = await actorFromRequest(req);
    if (actor.membership.role === 'empleado') throw new HttpError(403, 'Solo la dirección puede cambiar la marca');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'Adjunta un logo');
    const bytes = await file.toBuffer();
    if (bytes.length > 1_500_000) throw new HttpError(400, 'El logo pesa demasiado. El máximo es 1,5 MB.');
    const name = file.filename.toLowerCase();
    const svg = name.endsWith('.svg') || file.mimetype.includes('svg');
    const current = await prisma.companyBranding.findUnique({ where: { companyId: actor.company.id } });
    let key = '';
    if (svg) {
      const text = bytes.toString('utf8');
      if (/<script|javascript:|on\w+=/i.test(text)) throw new HttpError(400, 'Ese SVG no se puede usar');
      key = `${actor.company.id}/logo.svg`;
      await storage.put(key, Buffer.from(text, 'utf8'));
    } else {
      let png: Buffer;
      try {
        png = await sharp(bytes).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
      } catch {
        throw new HttpError(400, 'Usa un logo PNG, JPG o SVG.');
      }
      key = `${actor.company.id}/logo.png`;
      await storage.put(key, png);
    }
    if (current?.logoPath && current.logoPath !== key) await storage.remove(current.logoPath);
    await prisma.companyBranding.upsert({
      where: { companyId: actor.company.id },
      create: { companyId: actor.company.id, logoPath: key },
      update: { logoPath: key },
    });
    return brandDto(actor.company.id);
  });
}

function rgb(hex: string) {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lum(channels: number[]) {
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(channels[0]) + 0.7152 * lin(channels[1]) + 0.0722 * lin(channels[2]);
}
