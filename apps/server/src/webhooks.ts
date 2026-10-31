import crypto from 'node:crypto';
import { HttpError, type Actor } from './http';
import { webhookUrlProblem } from './phase3Logic';
import { prisma } from './prisma';
import { companyScope } from './tenant';

const MAX_HOOKS = 5;
const WINDOW_MS = 60_000;
const MAX_SENDS = 30;
const sends = new Map<string, number[]>();

function assertOwner(actor: Actor) {
  if (actor.membership.role !== 'propietario') {
    throw new HttpError(403, 'Solo el propietario conecta avisos externos', 'errors.phase3.hooks');
  }
}

function assertUrl(url: string) {
  const issue = webhookUrlProblem(url, process.env.NODE_ENV === 'test');
  if (issue) throw new HttpError(400, 'La URL tiene que ser https y pública', 'errors.phase3.url');
}

function present(row: { id: string; name: string; url: string; events: string; format: string; active: boolean }) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: JSON.parse(row.events) as string[],
    format: row.format,
    active: row.active,
  };
}

export async function listHooks(actor: Actor) {
  assertOwner(actor);
  const rows = await prisma.outboundHook.findMany({ where: companyScope(actor.company.id), orderBy: { name: 'asc' }, take: MAX_HOOKS });
  return rows.map(present);
}

export async function createHook(actor: Actor, input: { name: string; url: string; events: string[]; format: string }) {
  assertOwner(actor);
  assertUrl(input.url);
  const count = await prisma.outboundHook.count({ where: companyScope(actor.company.id) });
  if (count >= MAX_HOOKS) throw new HttpError(409, 'Ya hay 5 conexiones');
  const events = input.events.filter((event) => event === 'tarea_creada' || event === 'tarea_hecha');
  if (!events.length) throw new HttpError(400, 'Elige al menos un aviso');
  const secret = crypto.randomBytes(24).toString('hex');
  const row = await prisma.outboundHook.create({
    data: {
      companyId: actor.company.id,
      name: input.name.slice(0, 80),
      url: input.url.trim(),
      secret,
      events: JSON.stringify(events),
      format: input.format === 'slack' ? 'slack' : 'generico',
    },
  });
  return { ...present(row), secret };
}

export async function deleteHook(actor: Actor, id: string) {
  assertOwner(actor);
  const row = await prisma.outboundHook.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Esa conexión no existe');
  await prisma.outboundHook.delete({ where: { id: row.id } });
  return { ok: true as const };
}

export async function setHookActive(actor: Actor, id: string, active: boolean) {
  assertOwner(actor);
  const row = await prisma.outboundHook.findFirst({ where: { id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Esa conexión no existe');
  await prisma.outboundHook.update({ where: { id: row.id }, data: { active } });
  return { ok: true as const };
}

function allowSend(companyId: string) {
  const now = Date.now();
  const recent = (sends.get(companyId) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_SENDS) return false;
  recent.push(now);
  sends.set(companyId, recent);
  return true;
}

export async function dispatchCompanyEvent(companyId: string, event: 'tarea_creada' | 'tarea_hecha', payload: { taskId: string; title: string }) {
  const hooks = await prisma.outboundHook.findMany({ where: { ...companyScope(companyId), active: true }, take: MAX_HOOKS });
  for (const hook of hooks) {
    const events = JSON.parse(hook.events) as string[];
    if (!events.includes(event) || !allowSend(companyId)) continue;
    const title = payload.title.slice(0, 140);
    const body = hook.format === 'slack'
      ? JSON.stringify({ text: `HIVEX · ${event === 'tarea_creada' ? 'Nueva tarea' : 'Tarea terminada'}: ${title}` })
      : JSON.stringify({ event, companyId, taskId: payload.taskId, title, at: new Date().toISOString() });
    const signature = crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
    try {
      await fetch(hook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'HIVEX-webhook', 'x-hivex-signature': signature },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(2500),
      });
    } catch { /* un destino caído no frena la tarea */ }
  }
}
