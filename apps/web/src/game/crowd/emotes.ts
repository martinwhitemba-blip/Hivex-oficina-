import { TILE } from '../../config';

/** El choque de cinco solo llega a dos baldosas. */
export const HIGH_FIVE_RANGE = TILE * 2;

export interface EmoteSpot {
  id: string;
  x: number;
  y: number;
  ghost?: boolean;
}

export function isHighFive(emote: string) {
  const name = emote.toLowerCase();
  return name.includes('high') || name.includes('🙌') || name.includes('choca');
}

export function emoteMs(emote: string) {
  const name = emote.toLowerCase();
  if (name.includes('confetti') || name.includes('🎉') || name.includes('heart') || name.includes('❤')) return 2200;
  return 1700;
}

/** El compañero más cercano dentro del alcance. Los ausentes (ghost) no chocan. */
export function highFivePartner<T extends EmoteSpot>(self: EmoteSpot, others: readonly T[], range = HIGH_FIVE_RANGE): T | null {
  let best: T | null = null;
  let bestD = range;
  for (const other of others) {
    if (other.id === self.id || other.ghost) continue;
    const distance = Math.hypot(other.x - self.x, other.y - self.y);
    if (distance <= range && (best === null || distance < bestD)) {
      best = other;
      bestD = distance;
    }
  }
  return best;
}
