/** Dónde va la foto y qué cara pone un gesto. Sin Three.js. */

export type PhotoSpot = 'cara' | 'gafete';
export type Expression = 'neutral' | 'happy' | 'surprised' | 'wink';

export function photoSpot(value: unknown): PhotoSpot {
  return value === 'gafete' ? 'gafete' : 'cara';
}

export function expressionFor(emote: string | null | undefined): Expression {
  const name = (emote || '').trim().toLowerCase();
  if (!name) return 'neutral';
  if (name.includes('confetti') || name.includes('🎉') || name.includes('sorpresa') || name === 'surprised') return 'surprised';
  if (name.includes('wink') || name.includes('😉')) return 'wink';
  if (
    name.includes('wave') || name.includes('clap') || name.includes('heart') || name.includes('high')
    || name.includes('👋') || name.includes('👏') || name.includes('❤') || name.includes('🙌')
  ) return 'happy';
  return 'neutral';
}
