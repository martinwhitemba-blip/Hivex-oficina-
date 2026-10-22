import path from 'node:path';
import sharp from 'sharp';
import { pointsForReport, streakEnding } from './domain';
import { HttpError } from './http';
import { prisma } from './prisma';
import { storage } from './storage';

export function photoUrl(photoPath: string | null | undefined) {
  if (!photoPath) return null;
  return `/uploads/${photoPath.split(path.sep).join('/')}`;
}

export function parseLook(json: string) {
  const fallback = { skin: '#EFC3A0', hair: '#3B2A20', hairStyle: 0 as 0 | 1 | 2 | 3, shirt: '#E0A800', pants: '#1F2937', glasses: false, usePhoto: false };
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const style = Number(value.hairStyle);
    return {
      skin: typeof value.skin === 'string' ? value.skin : fallback.skin,
      hair: typeof value.hair === 'string' ? value.hair : fallback.hair,
      hairStyle: (style === 1 || style === 2 || style === 3 ? style : 0) as 0 | 1 | 2 | 3,
      shirt: typeof value.shirt === 'string' ? value.shirt : fallback.shirt,
      pants: typeof value.pants === 'string' ? value.pants : fallback.pants,
      glasses: Boolean(value.glasses),
      usePhoto: value.usePhoto === true,
    };
  } catch {
    return fallback;
  }
}

export async function savePhoto(companyId: string, membershipId: string, bytes: Buffer) {
  let png: Buffer;
  try {
    png = await sharp(bytes).rotate().resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
  } catch {
    throw new HttpError(400, 'No pudimos leer la imagen. Usa JPG, PNG o WebP.');
  }
  const relative = `${companyId}/${membershipId}.png`;
  await storage.put(relative, png);
  await prisma.membership.update({ where: { id: membershipId }, data: { photoPath: relative } });
  return photoUrl(relative);
}

export async function upsertReport(input: {
  companyId: string;
  membershipId: string;
  date: string;
  note: string;
  metrics: Record<string, number>;
  source: string;
  isDemo?: boolean;
}) {
  const member = await prisma.membership.findFirst({
    where: { id: input.membershipId, companyId: input.companyId, active: true },
    include: { area: { include: { kpis: true } } },
  });
  if (!member) throw new HttpError(404, 'Empleado no encontrado');
  if (!member.area) throw new HttpError(400, 'Esta persona no tiene área. Asigna un área antes de guardar métricas.');
  const known = new Map(member.area.kpis.map((kpi) => [kpi.key, kpi]));
  for (const key of Object.keys(input.metrics)) {
    if (!known.has(key)) {
      throw new HttpError(400, `«${key}» no es una métrica de ${member.area.name}. Claves válidas: ${[...known.keys()].join(', ') || 'ninguna'}`);
    }
  }
  const existing = await prisma.dailyReport.findUnique({
    where: { membershipId_date: { membershipId: member.id, date: input.date } },
  });
  const report = await prisma.dailyReport.upsert({
    where: { membershipId_date: { membershipId: member.id, date: input.date } },
    create: {
      companyId: member.companyId,
      membershipId: member.id,
      date: input.date,
      note: input.note,
      source: input.source,
      isDemo: Boolean(input.isDemo),
    },
    update: { note: input.note, source: existing?.source === 'demo' ? 'demo' : input.source },
  });
  for (const [key, value] of Object.entries(input.metrics)) {
    const kpi = known.get(key)!;
    await prisma.reportValue.upsert({
      where: { reportId_kpiId: { reportId: report.id, kpiId: kpi.id } },
      create: { reportId: report.id, kpiId: kpi.id, value },
      update: { value },
    });
  }
  if (existing) return { reportId: report.id, pointsAwarded: 0, badges: [] as { code: string; label: string }[] };

  const dated = await prisma.dailyReport.findMany({ where: { membershipId: member.id }, select: { date: true } });
  const award = pointsForReport({
    values: input.metrics,
    kpis: member.area.kpis,
    isFirstReport: dated.length <= 1,
    streak: streakEnding(dated.map((row) => row.date), input.date),
  });
  await prisma.dailyReport.update({ where: { id: report.id }, data: { pointsAwarded: award.points } });
  await prisma.membership.update({ where: { id: member.id }, data: { points: { increment: award.points } } });
  for (const badge of award.badges) {
    await prisma.badge.upsert({
      where: { membershipId_code: { membershipId: member.id, code: badge.code } },
      create: { membershipId: member.id, code: badge.code, label: badge.label },
      update: {},
    });
  }
  return { reportId: report.id, pointsAwarded: award.points, badges: award.badges };
}

export async function awardBadge(membershipId: string, code: string, label: string, points = 0) {
  const already = await prisma.badge.findUnique({ where: { membershipId_code: { membershipId, code } } });
  if (already) return false;
  await prisma.badge.create({ data: { membershipId, code, label } });
  if (points) await prisma.membership.update({ where: { id: membershipId }, data: { points: { increment: points } } });
  return true;
}
