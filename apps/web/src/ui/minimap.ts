/** Minimapa: base pre-renderizada + puntos de avatares + rectángulo de la vista. */
import { TILE } from '../config';
import { STATUSES } from '../data/statuses';
import type { Game } from '../game/game';

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private base = document.createElement('canvas');
  private k: number;

  constructor(private game: Game, width = 210) {
    const W = game.world.w * TILE, H = game.world.h * TILE;
    this.k = width / W;
    const h = Math.round(H * this.k);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [this.canvas, this.base]) { c.width = width * dpr; c.height = h * dpr; }
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = h + 'px';
    const b = this.base.getContext('2d')!;
    b.imageSmoothingQuality = 'high';
    b.drawImage(game.mapRenderer.canvas, 0, 0, this.base.width, this.base.height);
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      game.moveTo((e.clientX - r.left) / this.k, (e.clientY - r.top) / this.k);
    });
  }

  draw() {
    const ctx = this.canvas.getContext('2d')!;
    const dpr = this.canvas.width / parseFloat(this.canvas.style.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    ctx.setTransform(dpr * this.k, 0, 0, dpr * this.k, 0, 0);
    const cam = this.game.camera;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#F5C518';
    ctx.lineWidth = 2 / this.k;
    ctx.strokeRect(cam.left, cam.top, cam.viewW / cam.zoom, cam.viewH / cam.zoom);
    for (const a of this.game.allAvatars()) {
      const me = a === this.game.player;
      ctx.beginPath();
      ctx.arc(a.x, a.y - 8, (me ? 4.5 : 3.2) / this.k * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = me ? '#F5C518' : STATUSES[a.status].color;
      ctx.fill();
      ctx.lineWidth = 1 / this.k;
      ctx.strokeStyle = '#0B0B0C';
      ctx.stroke();
    }
  }
}
