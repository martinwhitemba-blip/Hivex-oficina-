/** Reparte la presencia solo entre la sala de una empresa. Sin recorrer el servidor entero. */

export const INTEREST_UNDER = 40;
export const INTEREST_RADIUS = 720;

export interface PresenceViewer {
  id: string;
  areaId?: string | null;
  x: number;
  y: number;
}

export function closeEnough(viewer: PresenceViewer, other: { areaId?: string | null; x: number; y: number }) {
  if (viewer.areaId && other.areaId && viewer.areaId === other.areaId) return true;
  return Math.hypot(viewer.x - other.x, viewer.y - other.y) < INTEREST_RADIUS;
}

export interface PresencePlan<T extends PresenceViewer> {
  /** `room`: un emit a la sala (vale entre instancias con el adaptador Redis). `interest`: solo los cercanos. */
  mode: 'room' | 'interest';
  targets: T[];
}

export function fanoutPresence<T extends PresenceViewer>(
  members: Iterable<T>,
  selfId: string,
  state: { x: number; y: number; areaId?: string | null },
  crowd: number,
): PresencePlan<T> {
  const others: T[] = [];
  for (const member of members) {
    if (member.id === selfId) continue;
    others.push(member);
  }
  if (crowd <= INTEREST_UNDER) return { mode: 'room', targets: others };
  return { mode: 'interest', targets: others.filter((member) => closeEnough(member, state)) };
}
