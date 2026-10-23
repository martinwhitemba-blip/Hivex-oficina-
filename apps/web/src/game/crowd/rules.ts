/** Niveles de detalle y presupuesto de llamadas de dibujo. Puro: se puede probar sin WebGL. */

export type LodTier = 'full' | 'mid' | 'billboard' | 'ghost' | 'hidden';

export interface LodPerson {
  id: string;
  dist: number;
  ghost: boolean;
}

export interface LodLimits {
  fullCap: number;
  midCap: number;
  near: number;
  mid: number;
  ghostHide: number;
  shadowCap: number;
}

export interface LodSlot {
  tier: LodTier;
  shadow: boolean;
}

/** Mallas de color por avatar en el nivel alto (sin la sombra, que va aparte). */
export const DRAW_FULL = 14;
export const DRAW_MID = 3;
/** Oficina horneada, etiquetas, manchas, impostores y fantasmas instanciados. */
export const DRAW_FIXED = 46;

export const DEFAULT_LIMITS: LodLimits = {
  fullCap: 12,
  midCap: 20,
  near: 300,
  mid: 680,
  ghostHide: 1100,
  shadowCap: 12,
};

export function assignLods(people: LodPerson[], limits: LodLimits = DEFAULT_LIMITS): Map<string, LodSlot> {
  const slots = new Map<string, LodSlot>();
  const active = people.filter((person) => !person.ghost).sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  let full = 0;
  let mid = 0;
  const fullIds: string[] = [];
  for (const person of active) {
    let tier: LodTier = 'billboard';
    if (person.dist <= limits.near && full < limits.fullCap) {
      tier = 'full';
      full += 1;
      fullIds.push(person.id);
    } else if (person.dist <= limits.mid && mid < limits.midCap) {
      tier = 'mid';
      mid += 1;
    }
    slots.set(person.id, { tier, shadow: false });
  }
  fullIds.slice(0, limits.shadowCap).forEach((id) => {
    const slot = slots.get(id);
    if (slot) slot.shadow = true;
  });
  for (const person of people) {
    if (!person.ghost) continue;
    slots.set(person.id, { tier: person.dist > limits.ghostHide ? 'hidden' : 'ghost', shadow: false });
  }
  return slots;
}

/** Peor caso de llamadas de color con los topes indicados (las sombras suman una por avatar). */
export function drawBudget(limits: LodLimits = DEFAULT_LIMITS) {
  return DRAW_FIXED + limits.fullCap * DRAW_FULL + limits.midCap * DRAW_MID + Math.min(limits.shadowCap, limits.fullCap);
}
