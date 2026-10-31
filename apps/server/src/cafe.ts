import type { Actor } from './http';
import { cafeAward, CAFE_DAILY_REWARDS, seasonOf } from './phase3Logic';
import { prisma } from './prisma';
import { companyScope } from './tenant';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function cafeHome(actor: Actor) {
  const day = today();
  const season = seasonOf(day);
  const start = new Date(`${day}T00:00:00.000Z`);
  const [rewarded, best] = await Promise.all([
    prisma.cafePlay.count({
      where: { ...companyScope(actor.company.id), membershipId: actor.membership.id, awarded: { gt: 0 }, createdAt: { gte: start } },
    }),
    prisma.cafePlay.findFirst({
      where: { ...companyScope(actor.company.id), membershipId: actor.membership.id },
      orderBy: { awarded: 'desc' },
      select: { awarded: true, game: true },
    }),
  ]);
  return { season, rewarded, limit: CAFE_DAILY_REWARDS, best: best?.awarded ?? 0, bestGame: best?.game ?? null };
}

export async function playCafe(actor: Actor, input: { game: 'taza' | 'memoria'; elapsedMs?: number; moves?: number }) {
  const day = today();
  const season = seasonOf(day);
  const start = new Date(`${day}T00:00:00.000Z`);
  const rewarded = await prisma.cafePlay.count({
    where: { ...companyScope(actor.company.id), membershipId: actor.membership.id, awarded: { gt: 0 }, createdAt: { gte: start } },
  });
  const raw = cafeAward(input.game, input, season.multiplier);
  const awarded = rewarded >= CAFE_DAILY_REWARDS ? 0 : raw;
  const score = input.game === 'taza' ? input.elapsedMs || 0 : input.moves || 0;
  await prisma.cafePlay.create({
    data: { companyId: actor.company.id, membershipId: actor.membership.id, game: input.game, score, awarded },
  });
  if (awarded > 0) {
    await prisma.membership.update({ where: { id: actor.membership.id }, data: { points: { increment: awarded } } });
  }
  return { awarded, capped: rewarded >= CAFE_DAILY_REWARDS, season, points: actor.membership.points + awarded };
}
