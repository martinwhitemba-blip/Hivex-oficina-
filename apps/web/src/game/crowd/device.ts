/** Móvil de verdad: puntero grueso o pantalla estrecha con toque. */
export function isCoarseMobile() {
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const narrow = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) <= 820;
  return Boolean(coarse || (touch && narrow));
}
