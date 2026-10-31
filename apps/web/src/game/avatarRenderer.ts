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
  face?: CanvasImageSource;
}

/** Dibuja el avatar con los pies en (x, y). Cabeza grande, cuerpo corto, estilo plataforma. */
export function drawAvatar(ctx: Ctx, x: number, y: number, o: AvatarDrawOpts) {
  const { look, dir } = o;
  ctx.save();
  if (o.dim) ctx.globalAlpha = 0.6;
  const cycle = o.t * 8.5;
  const step = o.moving && !o.sitting ? Math.sin(cycle) : 0;
  const bob = o.moving && !o.sitting ? Math.abs(Math.sin(cycle)) * 2.4 : 0;
  const squash = o.moving && !o.sitting ? 1 + Math.sin(cycle * 2) * 0.07 : 1;
  shadow(ctx, x, y + 1, 12, 4.2, 0.28);
  if (o.moving && !o.sitting) {
    const puff = (Math.sin(cycle) + 1) / 2;
    ctx.save();
    ctx.globalAlpha *= 0.35 * (1 - puff);
    ellipse(ctx, x - 7 - puff * 3, y - 1, 3.2, 1.6, '#C4B08A');
    ellipse(ctx, x + 6 + (1 - puff) * 3, y - 1, 2.6, 1.3, '#C4B08A');
    ctx.restore();
  }
  const by = y - bob;
  ctx.translate(x, by);
  ctx.scale(2 - squash, squash);
  ctx.translate(-x, -by);

  if (!o.sitting) {
    ctx.fillStyle = look.pants;
    fillRR(ctx, x - 6.5, by - 15 + step * 1.6, 5.2, 10 - step, 2, look.pants);
    fillRR(ctx, x + 1.3, by - 15 - step * 1.6, 5.2, 10 + step, 2, look.pants);
    fillRR(ctx, x - 7.2, by - 6 + Math.max(0, step) * 0.4, 6.4, 4.2, 1.6, '#1A1A1A');
    fillRR(ctx, x + 0.8, by - 6, 6.4, 4.2, 1.6, '#1A1A1A');
    ctx.fillStyle = '#F5C518';
    ctx.fillRect(x - 6.2, by - 3.2, 2.2, 1.2);
    ctx.fillRect(x + 4.2, by - 3.2, 2.2, 1.2);
  } else {
    fillRR(ctx, x - 8, by - 10, 16, 5, 2, look.pants);
  }

  const top = by - (o.sitting ? 6 : 15);
  fillRR(ctx, x - 9, top - 14, 18, 15, 6, look.shirt, shade(look.shirt, -0.22), 1);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x - 6, top - 12, 5, 2);
  const arm = o.moving ? step * 2.4 : 0;
  const sleeve = shade(look.shirt, -0.12);
  if (dir !== 'left') {
    fillRR(ctx, x + 7, top - 12 + arm, 4.2, 10, 2, sleeve);
    circle(ctx, x + 9, top - 2 + arm, 2.3, look.skin);
  }
  if (dir !== 'right') {
    fillRR(ctx, x - 11.2, top - 12 - arm, 4.2, 10, 2, sleeve);
    circle(ctx, x - 9, top - 2 - arm, 2.3, look.skin);
  }

  const headY = top - 16;
  const showPhoto = Boolean(o.face && look.usePhoto);
  circle(ctx, x, headY, 12.5, look.skin, shade(look.skin, -0.2), 1);
  if (!showPhoto) drawHair(ctx, x, headY - 8, look, dir);
  if (showPhoto && o.face) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, headY, 10.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(o.face, x - 11, headY - 12, 22, 22);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, headY, 10.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#F5C518';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  } else if (dir !== 'up') {
    const blink = o.moving ? false : (Math.floor(o.t * 0.7) % 9 === 0 && (o.t % 1) < 0.12);
    const ex = dir === 'left' ? -3.2 : dir === 'right' ? 3.2 : 0;
    ctx.fillStyle = '#1A1A1A';
    if (blink) {
      ctx.fillRect(x + ex - (dir === 'down' ? 4 : 1.5), headY + 0.5, dir === 'down' ? 8 : 3, 1);
    } else if (dir === 'down') {
      circle(ctx, x - 3.6, headY + 0.4, 1.7, '#1A1A1A');
      circle(ctx, x + 3.6, headY + 0.4, 1.7, '#1A1A1A');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x - 4.1, headY - 0.3, 1, 1);
      ctx.fillRect(x + 3.1, headY - 0.3, 1, 1);
    } else {
      circle(ctx, x + ex, headY + 0.4, 1.7, '#1A1A1A');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + ex - 0.5, headY - 0.3, 1, 1);
    }
    ctx.fillStyle = 'rgba(255,120,120,0.45)';
    if (dir === 'down') { circle(ctx, x - 7, headY + 3.2, 1.5, 'rgba(255,120,120,0.4)'); circle(ctx, x + 7, headY + 3.2, 1.5, 'rgba(255,120,120,0.4)'); }
    ctx.strokeStyle = shade(look.skin, -0.35);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(x + ex * 0.3, headY + 4.2, dir === 'down' ? 2.4 : 1.6, 0.15, Math.PI - 0.15);
    ctx.stroke();
    if (look.glasses) {
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.1;
      if (dir === 'down') {
        ctx.strokeRect(x - 6.2, headY - 1.4, 5, 3.6);
        ctx.strokeRect(x + 1.2, headY - 1.4, 5, 3.6);
      }       else ctx.strokeRect(x + ex - 2.6, headY - 1.4, 5, 3.6);
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
export function drawNameTag(ctx: Ctx, x: number, y: number, name: string, status: StatusId, isSelf: boolean, dotColor?: string) {
  ctx.font = `600 9px ${FONT}`;
  const tw = ctx.measureText(name).width;
  const w = tw + 20, h = 14;
  const px = x - w / 2, py = y + 4;
  fillRR(ctx, px, py, w, h, 7, isSelf ? 'rgba(12,12,14,0.92)' : 'rgba(20,20,22,0.78)', isSelf ? BRAND.gold : undefined, 1.2);
  circle(ctx, px + 7.5, py + h / 2, 3, dotColor || STATUSES[status]?.color || '#6B7280', '#0B0B0C', 1);
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
  if (look.usePhoto && look.photoUrl) return look.photoUrl;
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
