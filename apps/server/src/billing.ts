import { HttpError } from './http';
import { prisma } from './prisma';

export const PLAN_DEFS = [
  { code: 'starter', name: 'Starter', maxWorkers: 8, maxAreas: 4, description: 'Para un equipo pequeño que empieza a ordenar su oficina.' },
  { code: 'pro', name: 'Pro', maxWorkers: 25, maxAreas: 12, description: 'Varias áreas, panel del dueño y más personas en la oficina.' },
  { code: 'empresa', name: 'Empresa', maxWorkers: 100, maxAreas: 30, description: 'Operación amplia: muchas áreas y equipos en el mismo plano.' },
  { code: 'grupo', name: 'Grupo', maxWorkers: 1000, maxAreas: 80, description: 'Por encima de 100 personas. El límite de esta empresa se puede acordar aparte.' },
] as const;

export async function ensurePlans() {
  for (const plan of PLAN_DEFS) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: { ...plan }, update: { ...plan } });
  }
}

export async function attachPlan(companyId: string, code: string, status: 'trial' | 'activa' = 'trial', customMaxWorkers?: number | null) {
  await ensurePlans();
  const plan = await prisma.plan.findUnique({ where: { code } });
  if (!plan) throw new HttpError(404, 'Ese plan no existe');
  const trialEndsAt = status === 'trial' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null;
  const custom = code === 'grupo'
    ? (customMaxWorkers == null ? {} : { customMaxWorkers })
    : { customMaxWorkers: null };
  await prisma.subscription.upsert({
    where: { companyId },
    create: { companyId, planId: plan.id, status, trialEndsAt, ...custom },
    update: { planId: plan.id, status, trialEndsAt, ...custom },
  });
  return plan;
}

export async function companyUsage(companyId: string) {
  const subscription = await prisma.subscription.findUnique({ where: { companyId }, include: { plan: true } });
  const plan = subscription?.plan ?? (await prisma.plan.findUnique({ where: { code: 'starter' } })) ?? (await ensurePlans(), await prisma.plan.findUnique({ where: { code: 'starter' } }))!;
  const workers = await prisma.membership.count({ where: { companyId, active: true } });
  const areas = await prisma.area.count({ where: { companyId } });
  return {
    plan,
    status: subscription?.status ?? 'trial',
    trialEndsAt: subscription?.trialEndsAt ?? null,
    workers,
    areas,
    maxWorkers: plan.code === 'grupo' && subscription?.customMaxWorkers ? subscription.customMaxWorkers : plan.maxWorkers,
    maxAreas: plan.maxAreas,
    customMaxWorkers: plan.code === 'grupo' ? subscription?.customMaxWorkers ?? null : null,
  };
}

export async function assertCanAddWorker(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { isDemo: true } });
  if (company?.isDemo) return;
  const usage = await companyUsage(companyId);
  if (usage.workers >= usage.maxWorkers) {
    throw new HttpError(409, `Tu plan ${usage.plan.name} permite hasta ${usage.maxWorkers} personas y ya estás en el límite. Entra en Plan y uso para verlo. El cobro en línea todavía no está conectado.`);
  }
}

export async function assertCanAddArea(companyId: string) {
  const usage = await companyUsage(companyId);
  if (usage.areas >= usage.maxAreas) {
    throw new HttpError(409, `Tu plan ${usage.plan.name} permite hasta ${usage.maxAreas} áreas y ya estás en el límite. Entra en Plan y uso para verlo. El cobro en línea todavía no está conectado.`);
  }
}

export async function audit(companyId: string, actorId: string | null, action: string, summary: string, metadata: unknown = {}) {
  await prisma.auditLog.create({
    data: { companyId, actorId, action, summary, metadata: JSON.stringify(metadata ?? {}) },
  });
}
