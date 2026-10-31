import { HttpError, type Actor } from './http';
import { mondayOf } from './planningLogic';
import { basicAnswer, type AssistantFacts } from './phase3Logic';
import { prisma } from './prisma';
import { companyScope } from './tenant';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ASKS = 8;
const asks = new Map<string, number[]>();

function allowAsk(membershipId: string) {
  const now = Date.now();
  const recent = (asks.get(membershipId) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_ASKS) throw new HttpError(429, 'Demasiadas preguntas. Espera un momento.', 'errors.phase3.busy');
  recent.push(now);
  asks.set(membershipId, recent);
}

async function factsOf(actor: Actor): Promise<AssistantFacts> {
  const today = new Date().toISOString().slice(0, 10);
  const where = { ...companyScope(actor.company.id), parentId: null };
  const [openTasks, overdue, tasks, goals] = await Promise.all([
    prisma.task.count({ where: { ...where, status: { not: 'hecho' } } }),
    prisma.task.count({ where: { ...where, status: { not: 'hecho' }, dueDate: { lt: new Date(`${today}T00:00:00.000Z`) } } }),
    prisma.task.findMany({
      where: { ...where, status: { not: 'hecho' }, assigneeId: { not: null } },
      select: { assigneeId: true, estimateMinutes: true, assignee: { select: { name: true } } },
      take: 200,
    }),
    prisma.weeklyGoal.findMany({
      where: { ...companyScope(actor.company.id), weekStart: mondayOf(today) },
      select: { target: true, current: true },
      take: 80,
    }),
  ]);
  const load = new Map<string, { name: string; minutes: number }>();
  for (const task of tasks) {
    if (!task.assigneeId || !task.assignee) continue;
    const row = load.get(task.assigneeId) || { name: task.assignee.name, minutes: 0 };
    row.minutes += task.estimateMinutes;
    load.set(task.assigneeId, row);
  }
  const busiest = [...load.values()].sort((a, b) => b.minutes - a.minutes)[0] || null;
  const missionPct = goals.length
    ? Math.round(goals.reduce((sum, goal) => sum + Math.min(100, goal.target > 0 ? (goal.current / goal.target) * 100 : 0), 0) / goals.length)
    : null;
  return { companyName: actor.company.name, openTasks, overdue, missionPct, busiest };
}

export async function askAssistant(actor: Actor, question: string) {
  if (actor.membership.role !== 'propietario') {
    throw new HttpError(403, 'El asistente es para el propietario', 'errors.phase3.assistant');
  }
  allowAsk(actor.membership.id);
  const facts = await factsOf(actor);
  const basic = basicAnswer(facts, question);
  const base = process.env.HIVEX_AI_BASE_URL?.trim().replace(/\/$/, '') || '';
  const key = process.env.HIVEX_AI_API_KEY?.trim() || '';
  if (!base || !key) return { mode: 'basico' as const, answer: basic };
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.HIVEX_AI_MODEL?.trim() || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Eres el asistente de HIVEX. Responde en español, en pocas frases, y usa solo los números que te pasan. No inventes otras empresas ni pidas claves.' },
          { role: 'user', content: `${question}\n\nDatos: ${JSON.stringify(facts)}` },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const body = await response.json() as { choices?: { message?: { content?: string } }[] };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (text) return { mode: 'externo' as const, answer: text.slice(0, 1200) };
    }
  } catch { /* sin respuesta externa se queda el modo básico */ }
  return { mode: 'basico' as const, answer: `${basic} El modelo externo no contestó, así que sigue el modo básico.` };
}
