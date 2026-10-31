import { HttpError, type Actor } from './http';
import { prisma } from './prisma';
import { storage } from './storage';
import { companyScope } from './tenant';
import { visibleTask } from './taskBoard';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv']);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 8;

function safeName(name: string) {
  const base = name.split(/[/\\]/).pop() || 'archivo';
  const clean = base.replace(/[^\w.\- ()áéíóúñüÁÉÍÓÚÑÜ]+/g, '').slice(0, 80);
  return clean || 'archivo';
}

export async function listTaskFiles(actor: Actor, taskId: string) {
  const task = await visibleTask(actor, taskId);
  const rows = await prisma.taskFile.findMany({
    where: { ...companyScope(actor.company.id), taskId: task.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_FILES,
  });
  return {
    storage: storage.kind,
    items: rows.map((row) => ({ id: row.id, name: row.name, mime: row.mime, bytes: row.bytes, createdAt: row.createdAt })),
  };
}

export async function addTaskFile(actor: Actor, taskId: string, file: { name: string; mime: string; bytes: Buffer }) {
  const task = await visibleTask(actor, taskId);
  const mime = file.mime.split(';')[0].trim().toLowerCase();
  if (!ALLOWED.has(mime) || file.bytes.length < 1 || file.bytes.length > MAX_BYTES) {
    throw new HttpError(400, 'Ese archivo no se puede adjuntar. Usa PNG, JPG, WebP, PDF, TXT o CSV, hasta 4 MB.', 'errors.phase3.file');
  }
  const count = await prisma.taskFile.count({ where: { ...companyScope(actor.company.id), taskId: task.id } });
  if (count >= MAX_FILES) throw new HttpError(409, 'Esta tarea ya tiene 8 archivos');
  const row = await prisma.taskFile.create({
    data: {
      companyId: actor.company.id,
      taskId: task.id,
      name: safeName(file.name),
      mime,
      bytes: file.bytes.length,
      storageKey: 'pending',
      createdById: actor.membership.id,
    },
  });
  const storageKey = `tasks/${actor.company.id}/${task.id}/${row.id}`;
  try {
    await storage.put(storageKey, file.bytes, mime);
  } catch {
    await prisma.taskFile.delete({ where: { id: row.id } }).catch(() => undefined);
    throw new HttpError(502, 'No se pudo guardar el archivo', 'errors.phase3.storage');
  }
  return prisma.taskFile.update({
    where: { id: row.id },
    data: { storageKey },
    select: { id: true, name: true, mime: true, bytes: true },
  });
}

export async function loadTaskFile(actor: Actor, taskId: string, fileId: string) {
  const task = await visibleTask(actor, taskId);
  const row = await prisma.taskFile.findFirst({ where: { id: fileId, taskId: task.id, ...companyScope(actor.company.id) } });
  if (!row || row.storageKey === 'pending') throw new HttpError(404, 'Archivo no encontrado');
  const bytes = await storage.get(row.storageKey).catch(() => null);
  if (!bytes) throw new HttpError(404, 'Archivo no encontrado');
  return { row, bytes };
}

export async function removeTaskFile(actor: Actor, taskId: string, fileId: string) {
  const task = await visibleTask(actor, taskId);
  const row = await prisma.taskFile.findFirst({ where: { id: fileId, taskId: task.id, ...companyScope(actor.company.id) } });
  if (!row) throw new HttpError(404, 'Archivo no encontrado');
  if (actor.membership.role === 'empleado' && row.createdById !== actor.membership.id) {
    throw new HttpError(403, 'No puedes quitar este archivo');
  }
  await prisma.taskFile.delete({ where: { id: row.id } });
  if (row.storageKey !== 'pending') await storage.remove(row.storageKey).catch(() => undefined);
  return { ok: true as const };
}
