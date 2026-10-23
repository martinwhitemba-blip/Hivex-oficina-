import { describe, expect, it } from 'vitest';
import { allowRelay, companyRoom } from '../src/socket';

describe('eventos de la oficina', () => {
  it('limita emotes y burbujas a uno por segundo y persona', () => {
    const who = `relay-${Date.now()}`;
    expect(companyRoom('acme')).toBe('empresa:acme');
    expect(allowRelay(who, 'emote', 5_000)).toBe(true);
    expect(allowRelay(who, 'emote', 5_500)).toBe(false);
    expect(allowRelay(who, 'bubble', 5_500)).toBe(true);
    expect(allowRelay(who, 'bubble', 5_800)).toBe(false);
    expect(allowRelay(`${who}-2`, 'emote', 5_500)).toBe(true);
    expect(allowRelay(who, 'emote', 6_000)).toBe(true);
  });
});
