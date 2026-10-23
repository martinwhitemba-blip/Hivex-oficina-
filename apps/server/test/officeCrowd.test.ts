import { describe, expect, it } from 'vitest';
import { assignLods, drawBudget, DRAW_FULL, DRAW_MID } from '../../web/src/game/crowd/rules';
import { govern, startingProfile } from '../../web/src/game/crowd/quality';
import { expressionFor, photoSpot } from '../../web/src/game/crowd/look';

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