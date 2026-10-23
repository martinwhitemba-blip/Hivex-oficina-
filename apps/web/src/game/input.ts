/** Teclado: WASD / flechas + atajos. Ignora teclas solo si el foco está en un campo visible. */
export class Input {
  private keys = new Set<string>();
  private handlers = new Map<string, () => void>();
  /** Eje del joystick táctil (-1..1). */
  virtual = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      const fromCode: Record<string, string> = {
        KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
        ArrowUp: 'arrowup', ArrowDown: 'arrowdown', ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
      };
      const k = fromCode[e.code] || e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!e.repeat) this.handlers.get(k)?.();
      this.keys.add(k);
    }, true);
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.code === 'KeyW') this.keys.delete('w');
      if (e.code === 'KeyA') this.keys.delete('a');
      if (e.code === 'KeyS') this.keys.delete('s');
      if (e.code === 'KeyD') this.keys.delete('d');
    }, true);
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

/** Un campo de texto visible tiene el foco. Los paneles ocultos no se comen el movimiento. */
export function isTextField(target: EventTarget | null) {
  const node = target instanceof HTMLElement ? target : null;
  if (!node) return false;
  const field = node.closest('input, textarea, select, [contenteditable="true"]');
  if (!field || !(field instanceof HTMLElement)) return false;
  if (field.closest('[hidden]')) return false;
  const pages = document.getElementById('pages');
  if (pages?.classList.contains('hidden') && pages.contains(field)) return false;
  const style = getComputedStyle(field);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function isTyping(e: KeyboardEvent) {
  return isTextField(e.target) || isTextField(document.activeElement);
}
