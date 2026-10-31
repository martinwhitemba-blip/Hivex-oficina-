/** Reglas puras de la Fase 3. No tocan la base ni la red. */

export const CAFE_DAILY_REWARDS = 6;
export const CAFE_POINTS = 5;

export function seasonOf(day: string): { code: string; name: string; multiplier: number } {
  const month = Number(day.slice(5, 7));
  if (month === 10) return { code: 'octubre_dorado', name: 'Octubre dorado', multiplier: 2 };
  if (month === 12) return { code: 'cierre', name: 'Cierre de año', multiplier: 2 };
  return { code: 'ordinaria', name: 'Temporada ordinaria', multiplier: 1 };
}

export function cafeAward(game: 'taza' | 'memoria', input: { elapsedMs?: number; moves?: number }, multiplier: number) {
  const factor = multiplier > 0 ? multiplier : 1;
  if (game === 'taza') {
    const ms = input.elapsedMs ?? -1;
    return ms >= 120 && ms <= 2500 ? CAFE_POINTS * factor : 0;
  }
  const moves = input.moves ?? 99;
  return moves >= 4 && moves <= 16 ? CAFE_POINTS * factor : 0;
}
