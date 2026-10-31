/** Cámara 2D con seguimiento suave y zoom. */
export class Camera {
  x = 0; y = 0;          // centro en px de mundo
  zoom = 1;
  viewW = 800; viewH = 600; // en px CSS

  constructor(private mapW: number, private mapH: number) {}

  resize(w: number, h: number) { this.viewW = w; this.viewH = h; }

  get left() { return this.x - this.viewW / 2 / this.zoom; }
  get top() { return this.y - this.viewH / 2 / this.zoom; }

  follow(tx: number, ty: number, dt: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 4.2);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clamp();
  }

  clamp() {
    const hw = this.viewW / 2 / this.zoom, hh = this.viewH / 2 / this.zoom;
    this.x = this.mapW < hw * 2 ? this.mapW / 2 : Math.max(hw, Math.min(this.mapW - hw, this.x));
    this.y = this.mapH < hh * 2 ? this.mapH / 2 : Math.max(hh, Math.min(this.mapH - hh, this.y));
  }

  screenToWorld(sx: number, sy: number) {
    return { x: this.left + sx / this.zoom, y: this.top + sy / this.zoom };
  }

  setZoom(z: number) { this.zoom = Math.max(0.6, Math.min(2, z)); this.clamp(); }
}
