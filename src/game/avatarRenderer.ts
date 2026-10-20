/** Dibujo procedural de avatares (estilo pixel-art "chibi") y del modo coche. */
import { BRAND } from '../config';
import { STATUSES } from '../data/statuses';
import type { AvatarLook, Dir, StatusId } from './types';
import { circle, ellipse, fillRR, FONT, shade, shadow, type Ctx } from './draw';

export interface AvatarDrawOpts {
  look: AvatarLook;
  dir: Dir;
  moving: boolean;
  sitting: boolean;
  t: number;          // tiempo (s) para animación
  dim?: boolean;      // ausente → semitransparente
}

/** Dibuja el avatar con los pies en (x, y). Ocupa ~22x32 px de mundo. */
export function drawAvatar(ctx: Ctx, x: number, y: number, o: AvatarDrawOpts) {
  const { look, dir } = o;
  ctx.save();
  if (o.dim) ctx.globalAlpha = 0.6;
  const step = o.moving ? Math.sin(o.t * 14) : 0;
  const bob = o.moving ? Math.abs(Math.sin(o.t * 14)) * 1.5 : 0;
  shadow(ctx, x, y, 9, 3.5, 0.25);
  const by = y - bob;

  // Piernas
  if (!o.sitting) {
    ctx.fillStyle = look.pants;
    ctx.fillRect(x - 5, by - 9 + step * 1.5, 4, 8 - step * 1.5);
    ctx.fillRect(x + 1, by - 9 - step * 1.5, 4, 8 + step * 1.5);
    ctx.fillStyle = '#1B1B1B';
    ctx.fillRect(x - 5.5, by - 2 + Math.max(0, step) * 0, 5, 2);
    ctx.fillRect(x + 0.5, by - 2, 5, 2);
  } else {
    ctx.fillStyle = look.pants;
    ctx.fillRect(x - 6, by - 8, 12, 4);
  }
  const top = by - (o.sitting ? 4 : 9);
  // Cuerpo
  fillRR(ctx, x - 7, top - 11, 14, 12, 4, look.shirt, shade(look.shirt, -0.2), 1);
  // brazos
  ctx.fillStyle = shade(look.shirt, -0.1);
  const armSwing = o.moving ? step * 2 : 0;
  if (dir !== 'left') ctx.fillRect(x + 6, top - 9 + armSwing, 3, 8);
  if (dir !== 'right') ctx.fillRect(x - 9, top - 9 - armSwing, 3, 8);
  ctx.fillStyle = look.skin;
  if (dir !== 'left') ctx.fillRect(x + 6, top - 2 + armSwing, 3, 2);
  if (dir !== 'right') ctx.fillRect(x - 9, top - 2 - armSwing, 3, 2);
  // Cabeza
  const hy = top - 23;
  fillRR(ctx, x - 8, hy, 16, 14, 5, look.skin, shade(look.skin, -0.15), 1);
  drawHair(ctx, x, hy, look, dir);
  // Cara
  if (dir !== 'up') {
    ctx.fillStyle = '#1E1E1E';
    const ex = dir === 'left' ? -3 : dir === 'right' ? 3 : 0;
    if (dir === 'down') { ctx.fillRect(x - 4, hy + 7, 2, 2.5); ctx.fillRect(x + 2, hy + 7, 2, 2.5); }
    else ctx.fillRect(x + ex - 1, hy + 7, 2, 2.5);
    ctx.fillStyle = 'rgba(230,110,110,0.35)';
    if (dir === 'down') { ctx.fillRect(x - 6, hy + 10, 2, 1.5); ctx.fillRect(x + 4, hy + 10, 2, 1.5); }
    if (look.glasses) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      if (dir === 'down') { ctx.strokeRect(x - 5.5, hy + 6, 4.5, 3.5); ctx.strokeRect(x + 1, hy + 6, 4.5, 3.5); }
      else ctx.strokeRect(x + ex - 2.5, hy + 6, 4.5, 3.5);
    }
  }
  ctx.restore();
}

function drawHair(ctx: Ctx, x: number, hy: number, look: AvatarLook, dir: Dir) {
  ctx.fillStyle = look.hair;
  const full = dir === 'up';
  switch (look.hairStyle) {
    case 0: // corto
      fillRR(ctx, x - 8.5, hy - 1.5, 17, full ? 13 : 6, 5, look.hair);
      if (dir === 'left') ctx.fillRect(x + 3, hy + 2, 5, 6);
      if (dir === 'right') ctx.fillRect(x - 8, hy + 2, 5, 6);
      break;
    case 1: // largo
      fillRR(ctx, x - 9, hy - 1.5, 18, full ? 18 : 6, 5, look.hair);
      if (!full) { ctx.fillRect(x - 9, hy + 2, 3.5, 14); ctx.fillRect(x + 5.5, hy + 2, 3.5, 14); }
      break;
    case 2: // moño
      fillRR(ctx, x - 8.5, hy - 1.5, 17, full ? 13 : 6, 5, look.hair);
      circle(ctx, x, hy - 3, 4.5, look.hair);
      break;
    case 3: // rapado
      fillRR(ctx, x - 8, hy - 1, 16, full ? 10 : 4, 4, shade(look.hair, 0.05));
      break;
  }
}

/** Coche visto desde arriba (dorado HIVEX con franjas negras). angle en radianes, 0 = derecha. */
export function drawCar(ctx: Ctx, x: number, y: number, angle: number, t: number, honking: boolean) {
  shadow(ctx, x, y + 2, 28, 12, 0.28);
  ctx.save();
  ctx.translate(x, y - 8);
  ctx.rotate(angle);
  ctx.scale(1.3, 1.3);
  // ruedas
  ctx.fillStyle = '#111';
  for (const [wx, wy] of [[-13, -12], [9, -12], [-13, 9], [9, 9]]) fillRR(ctx, wx, wy, 8, 4, 1.5, '#111');
  // carrocería
  fillRR(ctx, -20, -10, 40, 20, 7, BRAND.gold, '#8A6A00', 1.5);
  ctx.fillStyle = '#111';
  ctx.fillRect(-20, -2, 40, 1.6);
  ctx.fillRect(-20, 1, 40, 1.6);
  // cabina
  fillRR(ctx, -7, -8, 17, 16, 4, '#1B1F27');
  fillRR(ctx, 4, -7, 5, 14, 2, '#5DA9C9');
  fillRR(ctx, -6, -7, 3, 14, 1.5, '#4A8AA6');
  // faros
  circle(ctx, 19, -6, 2, '#FFF7C2');
  circle(ctx, 19, 6, 2, '#FFF7C2');
  ctx.fillStyle = '#EF4444';
  ctx.fillRect(-21, -8, 2, 4);
  ctx.fillRect(-21, 4, 2, 4);
  if (honking) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = 6 + i * 5 + ((t * 30) % 5);
      ctx.beginPath(); ctx.arc(22, 0, r, -0.6, 0.6); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Etiqueta de nombre bajo el avatar con punto de estado. */
export function drawNameTag(ctx: Ctx, x: number, y: number, name: string, status: StatusId, isSelf: boolean) {
  ctx.font = `600 9px ${FONT}`;
  const tw = ctx.measureText(name).width;
  const w = tw + 20, h = 14;
  const px = x - w / 2, py = y + 4;
  fillRR(ctx, px, py, w, h, 7, isSelf ? 'rgba(12,12,14,0.92)' : 'rgba(20,20,22,0.78)', isSelf ? BRAND.gold : undefined, 1.2);
  circle(ctx, px + 7.5, py + h / 2, 3, STATUSES[status].color, '#0B0B0C', 1);
  ctx.fillStyle = isSelf ? BRAND.goldSoft : '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, px + 13, py + h / 2 + 0.5);
}

/** Bocadillo encima del avatar (emoji / texto). */
export function drawBubble(ctx: Ctx, x: number, y: number, content: string, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `600 11px ${FONT}`;
  const w = Math.max(22, ctx.measureText(content).width + 12), h = 18;
  fillRR(ctx, x - w / 2, y - h, w, h, 9, '#FFFFFF', 'rgba(0,0,0,0.15)', 1);
  ctx.beginPath(); ctx.moveTo(x - 4, y - 1); ctx.lineTo(x + 4, y - 1); ctx.lineTo(x, y + 4); ctx.closePath();
  ctx.fillStyle = '#FFFFFF'; ctx.fill();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(content, x, y - h / 2 + 1);
  ctx.restore();
}

/** Mini retrato (cabeza) para la lista lateral → dataURL. */
export function portraitDataUrl(look: AvatarLook, size = 28): string {
  const c = document.createElement('canvas');
  const s = 2;
  c.width = c.height = size * s;
  const ctx = c.getContext('2d')!;
  ctx.scale(s * size / 28, s * size / 28);
  ellipse(ctx, 14, 14, 14, 14, '#2A2A2E');
  ctx.save();
  ctx.beginPath(); ctx.arc(14, 14, 14, 0, Math.PI * 2); ctx.clip();
  ctx.translate(14, 41);
  ctx.scale(1.25, 1.25);
  drawAvatar(ctx, 0, 0, { look, dir: 'down', moving: false, sitting: false, t: 0 });
  ctx.restore();
  return c.toDataURL();
}
