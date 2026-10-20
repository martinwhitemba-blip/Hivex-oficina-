/** Joystick virtual para pantallas táctiles (devuelve un eje normalizado -1..1). */
export class Joystick {
  readonly el = document.createElement('div');
  private knob = document.createElement('div');
  private id: number | null = null;
  private cx = 0; private cy = 0;
  private readonly R = 46;

  constructor(private onAxis: (x: number, y: number) => void) {
    this.el.className = 'joystick';
    this.knob.className = 'knob';
    this.el.append(this.knob);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.id = e.pointerId;
      this.el.setPointerCapture(e.pointerId);
      const r = this.el.getBoundingClientRect();
      this.cx = r.left + r.width / 2; this.cy = r.top + r.height / 2;
      this.move(e);
    });
    this.el.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) this.move(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.id) return;
      this.id = null;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.onAxis(0, 0);
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private move(e: PointerEvent) {
    let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
    const d = Math.hypot(dx, dy);
    if (d > this.R) { dx = (dx / d) * this.R; dy = (dy / d) * this.R; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / this.R, ny = dy / this.R;
    // zona muerta
    this.onAxis(Math.abs(nx) < 0.18 ? 0 : nx, Math.abs(ny) < 0.18 ? 0 : ny);
  }
}
