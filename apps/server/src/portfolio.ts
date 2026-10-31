import crypto from 'node:crypto';
import { companyUsage } from './billing';
import { HttpError, type Actor } from './http';
import { prisma } from './prisma';
import { companyScope } from './tenant';

function inviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function assertOwner(actor: Actor) {
  if (actor.membership.role !== 'propietario') {
    throw new HttpError(403, 'Solo el propietario consulta el portafolio', 'errors.phase3.owner');
  }
}

async function summaries(companyIds: string[]) {
  if (!companyIds.length) return [];
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const week = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * 86400000);
  const [companies, workers, areas, openTasks, overdue, doneWeek] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true, officeName: true, subscription: { select: { plan: { select: { code: true } } } } },
    }),
    prisma.membership.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, active: true }, _count: { _all: true } }),
    prisma.area.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, parentId: null, status: { not: 'hecho' } }, _count: { _all: true } }),
    prisma.task.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companyIds }, parentId: null, status: { not: 'hecho' }, dueDate: { lt: start } },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['companyId'],
      where: { companyId: { in: companyIds }, parentId: null, status: 'hecho', doneAt: { gte: week } },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) => rows.find((row) => row.companyId === id)?._count._all ?? 0;
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    officeName: company.officeName,
    plan: company.subscription?.plan.code || 'starter',
    workers: count(workers, company.id),
    areas: count(areas, company.id),
    openTasks: count(openTasks, company.id),
    overdue: count(overdue, company.id),
    doneWeek: count(doneWeek, company.id),
  }));
}

async function ownedCompanies(actor: Actor) {
  const rows = await prisma.membership.findMany({
    where: { userId: actor.userId, role: 'propietario', active: true },
    include: { company: { select: { id: true, name: true } } },
    take: 50,
  });
  return rows.map((row) => ({ id: row.company.id, name: row.company.name }));
}

export async function portfolioView(actor: Actor) {
  assertOwner(actor);
  const usage = await companyUsage(actor.company.id);
  const mine = await ownedCompanies(actor);
  const owned = await prisma.holding.findFirst({
    where: { ownerUserId: actor.userId },
    include: { companies: { take: 100 } },
  });
  if (owned) {
    return {
      plan: usage.plan.code,
      canCreate: false,
      holding: {
        id: owned.id,
        name: owned.name,
        owner: true,
        inviteCode: owned.inviteCode,
        companies: await summaries(owned.companies.map((row) => row.companyId)),
      },
      mine,
    };
  }
  const link = await prisma.holdingCompany.findUnique({
    where: { companyId: actor.company.id },
    include: { holding: true },
  });
  if (!link) return { plan: usage.plan.code, canCreate: usage.plan.code === 'grupo', holding: null, mine };
  const [own] = await summaries([actor.company.id]);
  return {
    plan: usage.plan.code,
    canCreate: false,
    holding: { id: link.holding.id, name: link.holding.name, owner: false, companies: own ? [own] : [] },
    mine,
  };
}

export async function createHolding(actor: Actor, name: string) {
  assertOwner(actor);
  const usage = await companyUsage(actor.company.id);
  if (usage.plan.code !== 'grupo') throw new HttpError(403, 'El portafolio es del plan Grupo', 'errors.phase3.grupo');
  if (await prisma.holding.findFirst({ where: { ownerUserId: actor.userId } })) throw new HttpError(409, 'Ya tienes un portafolio');
  if (await prisma.holdingCompany.findUnique({ where: { companyId: actor.company.id } })) throw new HttpError(409, 'Esta empresa ya está en un grupo');
  const holding = await prisma.holding.create({
    data: {
      name: name.slice(0, 80),
      ownerUserId: actor.userId,
      inviteCode: inviteCode(),
      companies: { create: { companyId: actor.company.id } },
    },
  });
  return { id: holding.id, inviteCode: holding.inviteCode };
}

async function holdingOf(actor: Actor) {
  assertOwner(actor);
  const holding = await prisma.holding.findFirst({ where: { ownerUserId: actor.userId } });
  if (!holding) throw new HttpError(404, 'Todavía no hay portafolio');
  return holding;
}

export async function addOwnedCompany(actor: Actor, companyId: string) {
  const holding = await holdingOf(actor);
  const membership = await prisma.membership.findFirst({
    where: { userId: actor.userId, companyId, role: 'propietario', active: true },
  });
  if (!membership) throw new HttpError(404, 'Esa empresa no es tuya');
  const linked = await prisma.holdingCompany.findUnique({ where: { companyId } });
  if (linked && linked.holdingId !== holding.id) throw new HttpError(409, 'Esa empresa ya está en otro grupo');
  if (!linked) await prisma.holdingCompany.create({ data: { holdingId: holding.id, companyId } });
  return { ok: true as const };
}

export async function joinHolding(actor: Actor, code: string) {
  assertOwner(actor);
  const holding = await prisma.holding.findUnique({ where: { inviteCode: code.trim().toUpperCase() } });
  if (!holding) throw new HttpError(404, 'Ese código no es de un grupo');
  const linked = await prisma.holdingCompany.findUnique({ where: { companyId: actor.company.id } });
  if (linked && linked.holdingId !== holding.id) throw new HttpError(409, 'Esta empresa ya está en un grupo');
  if (!linked) await prisma.holdingCompany.create({ data: { holdingId: holding.id, companyId: actor.company.id } });
  return { ok: true as const, name: holding.name };
}

export async function removeFromHolding(actor: Actor, companyId: string) {
  const holding = await holdingOf(actor);
  const link = await prisma.holdingCompany.findFirst({ where: { holdingId: holding.id, ...companyScope(companyId) } });
  if (!link) throw new HttpError(404, 'Esa empresa no está en tu grupo');
  const count = await prisma.holdingCompany.count({ where: { holdingId: holding.id } });
  if (count <= 1) throw new HttpError(409, 'El portafolio tiene que conservar una empresa');
  await prisma.holdingCompany.delete({ where: { id: link.id } });
  return { ok: true as const };
}
