import { HttpError } from './http';
import { prisma } from './prisma';
import { photoUrl } from './services';

export interface DirectDto {
  id: string;
  body: string;
  createdAt: Date;
  senderId: string;
  recipientId: string;
  senderName: string;
  photoUrl: string | null;
}

export async function assertCoworker(companyId: string, selfId: string, otherId: string) {
  if (!otherId || otherId === selfId) throw new HttpError(400, 'Elige a un compañero de tu empresa');
  const person = await prisma.membership.findFirst({
    where: { id: otherId, companyId, active: true },
    include: { jobTitle: true },
  });
  if (!person) throw new HttpError(404, 'Esa persona no está en tu empresa');
  return person;
}

export function directDto(message: {
  id: string;
  body: string;
  createdAt: Date;
  senderId: string;
  recipientId: string;
  sender: { name: string; photoPath: string | null };
}): DirectDto {
  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    senderId: message.senderId,
    recipientId: message.recipientId,
    senderName: message.sender.name,
    photoUrl: photoUrl(message.sender.photoPath),
  };
}

export async function directDirectory(companyId: string, selfId: string) {
  const people = await prisma.membership.findMany({
    where: { companyId, active: true, id: { not: selfId } },
    include: { jobTitle: true },
    orderBy: { name: 'asc' },
  });
  const unreadRows = await prisma.directMessage.groupBy({
    by: ['senderId'],
    where: { companyId, recipientId: selfId, readAt: null },
    _count: { _all: true },
  });
  const unread = new Map(unreadRows.map((row) => [row.senderId, row._count._all]));
  const latest = await Promise.all(people.map(async (person) => {
    const last = await prisma.directMessage.findFirst({
      where: {
        companyId,
        OR: [
          { senderId: selfId, recipientId: person.id },
          { senderId: person.id, recipientId: selfId },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return { person, last };
  }));
  return latest
    .map(({ person, last }) => ({
      id: person.id,
      name: person.name,
      puesto: person.jobTitle?.name || '',
      photoUrl: photoUrl(person.photoPath),
      unread: unread.get(person.id) || 0,
      ultimo: last ? { body: last.body, createdAt: last.createdAt, mio: last.senderId === selfId } : null,
    }))
    .sort((a, b) => {
      const at = a.ultimo ? new Date(a.ultimo.createdAt).getTime() : 0;
      const bt = b.ultimo ? new Date(b.ultimo.createdAt).getTime() : 0;
      return bt - at || a.name.localeCompare(b.name, 'es');
    });
}

export async function directThread(companyId: string, selfId: string, otherId: string) {
  const other = await assertCoworker(companyId, selfId, otherId);
  await prisma.directMessage.updateMany({
    where: { companyId, senderId: otherId, recipientId: selfId, readAt: null },
    data: { readAt: new Date() },
  });
  const messages = await prisma.directMessage.findMany({
    where: {
      companyId,
      OR: [
        { senderId: selfId, recipientId: otherId },
        { senderId: otherId, recipientId: selfId },
      ],
    },
    include: { sender: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return {
    con: {
      id: other.id,
      name: other.name,
      puesto: other.jobTitle?.name || '',
      photoUrl: photoUrl(other.photoPath),
    },
    mensajes: messages.map(directDto),
  };
}

export async function sendDirect(companyId: string, selfId: string, otherId: string, raw: string) {
  const text = raw.trim();
  if (!text || text.length > 1000) throw new HttpError(400, 'Escribe un mensaje de hasta 1000 caracteres');
  await assertCoworker(companyId, selfId, otherId);
  const message = await prisma.directMessage.create({
    data: { companyId, senderId: selfId, recipientId: otherId, body: text },
    include: { sender: true },
  });
  return directDto(message);
}
