import { describe, expect, it } from 'vitest';
import { assignLods, drawBudget, DRAW_FULL, DRAW_MID } from '../../web/src/game/crowd/rules';
import { govern, startingProfile } from '../../web/src/game/crowd/quality';
import { expressionFor, photoSpot } from '../../web/src/game/crowd/look';
import { HIGH_FIVE_RANGE, highFivePartner } from '../../web/src/game/crowd/emotes';
import { TaskState, clockLabel, isLate } from '../../web/src/game/crowd/taskState';

describe('presupuesto de la oficina 3D', () => {
  it('cien avatares caben en menos de 300 llamadas de dibujo', () => {
    expect(drawBudget()).toBeLessThan(300);
    const people = Array.from({ length: 100 }, (_, index) => ({
      id: `p${index}`,
      dist: (index % 10) * 40,
      ghost: index % 5 === 0,
    }));
    const slots = assignLods(people);
    let full = 0;
    let mid = 0;
    let shadows = 0;
    for (const slot of slots.values()) {
      if (slot.tier === 'full') full += 1;
      if (slot.tier === 'mid') mid += 1;
      if (slot.shadow) shadows += 1;
    }
    expect(full).toBeLessThanOrEqual(12);
    expect(mid).toBeLessThanOrEqual(16);
    expect(shadows).toBeLessThanOrEqual(12);
    expect(46 + full * DRAW_FULL + mid * DRAW_MID + shadows).toBeLessThan(300);
    expect([...slots.values()].filter((slot) => slot.tier === 'ghost').length).toBeGreaterThan(0);
  });

  it('la foto cae en la cara salvo el gafete, y el gesto elige la expresión', () => {
    expect(photoSpot(undefined)).toBe('cara');
    expect(photoSpot('otro')).toBe('cara');
    expect(photoSpot('gafete')).toBe('gafete');
    expect(expressionFor(null)).toBe('neutral');
    expect(expressionFor('👋')).toBe('happy');
    expect(expressionFor('clap')).toBe('happy');
    expect(expressionFor('🎉')).toBe('surprised');
    expect(expressionFor('😉')).toBe('wink');
    expect(expressionFor('zzz')).toBe('neutral');
  });

  it('el choque de cinco solo encuentra a quien está a dos baldosas', () => {
    const self = { id: 'yo', x: 0, y: 0 };
    const close = { id: 'cerca', x: HIGH_FIVE_RANGE, y: 0 };
    const far = { id: 'lejos', x: HIGH_FIVE_RANGE + 1, y: 0 };
    const ghost = { id: 'silla', x: 10, y: 0, ghost: true };
    expect(highFivePartner(self, [far, ghost, self])).toBeNull();
    expect(highFivePartner(self, [far, close, ghost])?.id).toBe('cerca');
    expect(highFivePartner(self, [close, { id: 'mas', x: 8, y: 0 }])?.id).toBe('mas');
  });

  it('la carta, el retraso y la misión salen del evento sin esperar al servidor', () => {
    const board = new TaskState();
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    board.applyTask({ taskId: 'padre', title: 'Llamar al cliente oro', status: 'en_curso', areaId: 'atlas', assigneeId: 'ana', parentId: null, dueDate: '2026-10-20', updatedAt: '2026-10-23T11:58:20.000Z' });
    board.applyTask({ taskId: 'paso', title: 'Marcar', status: 'hecho', areaId: 'atlas', assigneeId: 'ana', parentId: 'padre', dueDate: null, updatedAt: '2026-10-23T11:59:00.000Z' });
    board.applyTask({ taskId: 'paso2', title: 'Apuntar', status: 'pendiente', areaId: 'atlas', assigneeId: 'ana', parentId: 'padre', dueDate: null, updatedAt: '2026-10-23T11:59:00.000Z' });
    board.applyTask({ taskId: 'cola', title: 'Archivar', status: 'pendiente', areaId: 'atlas', assigneeId: null, parentId: null, dueDate: null, updatedAt: '2026-10-23T11:00:00.000Z' });
    board.applyGoal({ goalId: 'm1', areaId: 'atlas', pct: 40 });
    const duty = board.duty('ana', now, '2026-10-23');
    expect(duty?.title).toBe('Llamar al cliente oro');
    expect(duty?.overdue).toBe(true);
    expect(duty?.done).toBe(1);
    expect(duty?.total).toBe(2);
    expect(duty?.time).toBe(clockLabel(now - Date.parse('2026-10-23T11:58:20.000Z')));
    expect(isLate('2026-10-24', 'en_curso', '2026-10-23')).toBe(false);
    expect(board.tally('atlas')).toMatchObject({ pending: 1, doing: 1, done: 0, pct: 40 });
    board.applyTask({ taskId: 'padre', deleted: true });
    expect(board.duty('ana', now, '2026-10-23')).toBeNull();
  });

  it('esconde a los ausentes que quedan lejos y no les pone sombra', () => {
    const slots = assignLods([
      { id: 'lejos', dist: 5000, ghost: true },
      { id: 'silla', dist: 80, ghost: true },
    ]);
    expect(slots.get('lejos')?.tier).toBe('hidden');
    expect(slots.get('silla')).toEqual({ tier: 'ghost', shadow: false });
  });

  it('el móvil baja la resolución, quita sombras y el gobernador afloja si el frame va justo', () => {
    const phone = startingProfile({ mobile: true, devicePixelRatio: 3 });
    expect(phone.shadows).toBe(false);
    expect(phone.pixelRatio).toBeLessThanOrEqual(1.25);
    const eased = govern(phone, 8, { mobile: true, devicePixelRatio: 3 });
    expect(eased.shadows).toBe(false);
    expect(eased.pixelRatio).toBeLessThanOrEqual(1.25);
    const laptop = startingProfile({ mobile: false, devicePixelRatio: 2 });
    expect(laptop.shadows).toBe(true);
    expect(laptop.pixelRatio).toBeLessThanOrEqual(1.75);
    const tight = govern(govern(laptop, 40, { mobile: false, devicePixelRatio: 2 }), 40, { mobile: false, devicePixelRatio: 2 });
    expect(tight.tier).toBeGreaterThan(laptop.tier);
    expect(tight.shadows).toBe(false);
  });
});