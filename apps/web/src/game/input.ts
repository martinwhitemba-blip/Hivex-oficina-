/** Teclado: WASD / flechas + atajos. Ignora teclas mientras se escribe en un input. */
export class Input {
  private keys = new Set<string>();
  private handlers = new Map<string, () => void>();
  /** Eje del joystick táctil (-1..1). */
  virtual = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!e.repeat) this.handlers.get(k)?.();
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(key: string, fn: () => void) { this.handlers.set(key.toLowerCase(), fn); }

  axis() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y -= 1;
    if (k.has('s') || k.has('arrowdown')) y += 1;
    if (!x && !y) return { x: this.virtual.x, y: this.virtual.y };
    return { x, y };
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
