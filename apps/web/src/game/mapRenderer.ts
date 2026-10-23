/**
 * Render ESTÁTICO del mapa (suelo, paredes, muebles, decoración) a un canvas
 * offscreen. Se dibuja una vez y luego se copia cada frame (rápido).
 * Todo procedural: no hay sprites con copyright.
 */
import { TILE, BRAND } from '../config';
import { SAMPLE_RANKINGS } from '../data/sampleData';
import { knownPhrase, moneyOf } from '../i18n';
import type { MapObject, RoomDef } from './types';
import { Cell, type World } from './world';
import { circle, ellipse, fillRR, rng, rr, shade, shadow, text, type Ctx } from './draw';

const T = TILE;
const GOLD_LINE = '#D6AE45';
const WALL_FILL = '#F3E9D2';
const CORRIDOR = '#F5F0E6';

export class MapRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  rankings = SAMPLE_RANKINGS;
  private emblem: HTMLImageElement | null = null;

  constructor(private world: World, scale = 2) {
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = world.w * T * scale;
    this.canvas.height = world.h * T * scale;
  }

  setEmblem(img: HTMLImageElement) { this.emblem = img; }
  setRankings(rankings: typeof SAMPLE_RANKINGS) { this.rankings = rankings; }

  render() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.world.w * T, this.world.h * T);
    this.drawGround(ctx);
    this.drawRoomFloors(ctx);
    this.drawPlaza(ctx);
    const objs = [...this.world.def.objects];
    // Alfombras primero, luego paredes, luego el resto ordenado por Y.
    objs.filter((o) => o.type === 'rug').forEach((o) => this.drawObject(ctx, o));
    this.drawWalls(ctx);
    this.drawRoomLabels(ctx);
    objs.filter((o) => o.type !== 'rug').sort((a, b) => (a.y + (a.h ?? 1)) - (b.y + (b.h ?? 1))).forEach((o) => this.drawObject(ctx, o));
  }

  // ─────────────────────────────── Suelo ───────────────────────────────
  private drawGround(ctx: Ctx) {
    const { width: w, height: h, road, building, entrance } = this.world.def;
    const r = rng(7);
    // Césped con franjas
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#7BC85A' : '#74C254';
        ctx.fillRect(x * T, y * T, T, T);
      }
    for (let i = 0; i < 900; i++) {
      const x = r() * w * T, y = r() * h * T;
      ctx.fillStyle = r() > 0.5 ? 'rgba(40,110,40,0.25)' : 'rgba(170,230,120,0.35)';
      ctx.fillRect(x, y, 2, 3);
    }
    // Acera + carretera
    const sw = (yy: number) => {
      for (let x = 0; x < w; x++) {
        ctx.fillStyle = x % 2 ? '#DAD6CF' : '#D2CEC6';
        ctx.fillRect(x * T, yy * T, T, T);
        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
        ctx.strokeRect(x * T + 0.5, yy * T + 0.5, T - 1, T - 1);
      }
    };
    sw(road.y - 2); sw(road.y - 1); sw(road.y + road.h);
    ctx.fillStyle = '#4B4F58';
    ctx.fillRect(0, road.y * T, w * T, road.h * T);
    ctx.fillStyle = '#F2F2F2';
    for (let x = 0; x < w * T; x += 48) ctx.fillRect(x, (road.y + road.h / 2) * T - 2, 26, 4);
    ctx.fillStyle = '#E8E3D9';
    ctx.fillRect(0, road.y * T, w * T, 3);
    ctx.fillRect(0, (road.y + road.h) * T - 3, w * T, 3);
    // Paso de cebra frente a la entrada
    ctx.fillStyle = '#F5F5F5';
    for (let i = 0; i < 6; i++) ctx.fillRect((entrance.x - 1) * T + i * 18 + 4, road.y * T + 10, 10, road.h * T - 20);
    // Camino de entrada
    const by = building.y + building.h;
    for (let y = by; y < road.y - 2; y++)
      for (let x = entrance.x; x < entrance.x + entrance.w; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#E7DFD0' : '#DED5C3';
        ctx.fillRect(x * T, y * T, T, T);
      }
    // Interior del edificio (pasillos de mármol claro)
    for (let y = building.y; y < building.y + building.h; y++)
      for (let x = building.x; x < building.x + building.w; x++) {
        ctx.fillStyle = (x + y) % 2 ? CORRIDOR : '#F1EBDF';
        ctx.fillRect(x * T, y * T, T, T);
      }
    // Vetas sutiles del mármol
    ctx.save();
    ctx.beginPath();
    ctx.rect(building.x * T, building.y * T, building.w * T, building.h * T);
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,170,130,0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = (building.x + r() * building.w) * T, y = (building.y + r() * building.h) * T;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 20 * r(), y + 10 * r(), x + 40 * r(), y - 10 * r(), x + 60 * r(), y + 14 * r());
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(160,140,100,0.10)';
    for (let x = building.x; x <= building.x + building.w; x++) { ctx.beginPath(); ctx.moveTo(x * T + 0.5, building.y * T); ctx.lineTo(x * T + 0.5, (building.y + building.h) * T); ctx.stroke(); }
    for (let y = building.y; y <= building.y + building.h; y++) { ctx.beginPath(); ctx.moveTo(building.x * T, y * T + 0.5); ctx.lineTo((building.x + building.w) * T, y * T + 0.5); ctx.stroke(); }
    ctx.restore();
  }

  private drawRoomFloors(ctx: Ctx) {
    for (const room of this.world.def.rooms) {
      if (!room.floor) continue;
      const q = room.rect;
      for (let y = q.y; y < q.y + q.h; y++)
        for (let x = q.x; x < q.x + q.w; x++) {
          ctx.fillStyle = (x + y) % 2 ? room.floor : shade(room.floor, -0.018);
          ctx.fillRect(x * T, y * T, T, T);
        }
      // patrón de baldosa sutil
      ctx.strokeStyle = 'rgba(150,120,70,0.08)';
      for (let y = q.y; y < q.y + q.h; y++)
        for (let x = q.x; x < q.x + q.w; x++) {
          ctx.beginPath();
          ctx.moveTo(x * T + 16, y * T + 6); ctx.lineTo(x * T + 26, y * T + 16); ctx.lineTo(x * T + 16, y * T + 26); ctx.lineTo(x * T + 6, y * T + 16); ctx.closePath();
          ctx.stroke();
        }
      if (!room.walls) {
        // Zona abierta: borde dorado discontinuo
        ctx.save();
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = GOLD_LINE;
        ctx.lineWidth = 2;
        rr(ctx, q.x * T + 3, q.y * T + 3, q.w * T - 6, q.h * T - 6, 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ─────────────────────────────── Plaza central ───────────────────────────────
  private drawPlaza(ctx: Ctx) {
    const p = this.world.def.plaza;
    const cx = p.cx * T, cy = p.cy * T, R = p.r * T;
    const teal = '#2BB3A3';
    // Líneas hacia las salas (con nodos)
    ctx.save();
    ctx.strokeStyle = 'rgba(43,179,163,0.55)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(43,179,163,0.6)';
    ctx.shadowBlur = 8;
    const lines: [number, number, number, number][] = [
      [5.5 * T, cy, cx - R, cy], [cx + R, cy, 66.5 * T, cy],
      [cx, 15.2 * T, cx, cy - R], [cx, cy + R, cx, 29.6 * T],
    ];
    for (const [x1, y1, x2, y2] of lines) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.restore();
    for (const [x1, y1] of lines) { circle(ctx, x1, y1, 5, '#E6FFFB', teal, 2); }
    // Disco
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    g.addColorStop(0, 'rgba(120,220,210,0.45)');
    g.addColorStop(1, 'rgba(120,220,210,0.12)');
    circle(ctx, cx, cy, R, g);
    ctx.save();
    ctx.shadowColor = 'rgba(43,179,163,0.8)';
    ctx.shadowBlur = 10;
    circle(ctx, cx, cy, R, 'rgba(0,0,0,0)', teal, 3);
    circle(ctx, cx, cy, R * 0.72, 'rgba(0,0,0,0)', 'rgba(43,179,163,0.7)', 2);
    ctx.restore();
    // radios
    ctx.strokeStyle = 'rgba(43,179,163,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.4, cy + Math.sin(a) * R * 0.4);
      ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
      ctx.stroke();
    }
    // Emblema de marca en el centro (sobre disco oscuro con aro dorado)
    const er = R * 0.38;
    circle(ctx, cx, cy, er + 4, BRAND.goldDeep);
    circle(ctx, cx, cy, er, '#0E0E10', 'rgba(245,197,24,0.7)', 1.5);
    if (this.emblem) {
      const s = er * 1.55;
      ctx.drawImage(this.emblem, cx - s / 2, cy - s / 2 - 1, s, s);
    }
  }

  // ─────────────────────────────── Paredes ───────────────────────────────
  private drawWalls(ctx: Ctx) {
    const W = this.world;
    const isWall = (x: number, y: number) => W.cell(x, y) === Cell.Wall;
    const b = W.def.building;
    for (let y = 0; y < W.h; y++)
      for (let x = 0; x < W.w; x++) {
        const c = W.cell(x, y);
        if (c === Cell.Door) {
          // Umbral de puerta
          ctx.fillStyle = 'rgba(214,174,69,0.18)';
          ctx.fillRect(x * T, y * T, T, T);
          continue;
        }
        if (c !== Cell.Wall) continue;
        const px = x * T, py = y * T;
        const up = isWall(x, y - 1), dn = isWall(x, y + 1), lf = isWall(x - 1, y), rt = isWall(x + 1, y);
        const horizontal = lf || rt;
        // Muro como banda fina centrada en el tile (estilo planta arquitectónica)
        const th = 12; // grosor
        const o = (T - th) / 2;
        ctx.fillStyle = WALL_FILL;
        if (horizontal || (!up && !dn)) ctx.fillRect(lf ? px : px + o, py + o, (lf ? o : 0) + th + (rt ? o : 0), th);
        if (up || dn || !horizontal) ctx.fillRect(px + o, up ? py : py + o, th, (up ? o : 0) + th + (dn ? o : 0));
        // Líneas doradas dobles en los bordes
        ctx.strokeStyle = GOLD_LINE;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (horizontal) {
          const x1 = lf ? px : px + o, x2 = rt ? px + T : px + o + th;
          ctx.moveTo(x1, py + o); ctx.lineTo(x2, py + o);
          ctx.moveTo(x1, py + o + th); ctx.lineTo(x2, py + o + th);
        }
        if (up || dn) {
          const y1 = up ? py : py + o, y2 = dn ? py + T : py + o + th;
          ctx.moveTo(px + o, y1); ctx.lineTo(px + o, y2);
          ctx.moveTo(px + o + th, y1); ctx.lineTo(px + o + th, y2);
        }
        ctx.stroke();
        // Ventanales en la fachada exterior superior
        const outerTop = y === b.y && x > b.x + 1 && x < b.x + b.w - 2;
        if (outerTop && x % 3 !== 0) {
          fillRR(ctx, px + 2, py + o + 2, T - 4, th - 4, 2, '#2E4F5A');
          ctx.fillStyle = 'rgba(160,230,240,0.55)';
          ctx.fillRect(px + 6, py + o + 3, 8, 2);
        }
      }
    // Sombra exterior del edificio para darle volumen
    ctx.save();
    ctx.strokeStyle = 'rgba(60,40,10,0.12)';
    ctx.lineWidth = 6;
    ctx.strokeRect(b.x * T - 3, b.y * T - 3, b.w * T + 6, b.h * T + 6);
    ctx.restore();
  }

  private drawRoomLabels(ctx: Ctx) {
    for (const room of this.world.def.rooms) this.drawLabel(ctx, room);
  }

  private drawLabel(ctx: Ctx, room: RoomDef) {
    if (!room.label || !room.labelPos) return;
    const label = knownPhrase(room.label);
    const cx = room.labelPos.x * T, cy = (room.labelPos.y + 0.5) * T;
    ctx.font = `800 9px Inter, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + 18;
    shadow(ctx, cx, cy + 9, tw / 2, 3, 0.15);
    fillRR(ctx, cx - tw / 2, cy - 8, tw, 16, 4, '#121214', BRAND.goldDeep, 1.5);
    circle(ctx, cx - tw / 2 + 7, cy, 2.5, room.accent ?? BRAND.gold);
    text(ctx, label, cx + 3, cy + 0.5, 9, BRAND.gold, 800);
  }

  // ─────────────────────────────── Objetos ───────────────────────────────
  private drawObject(ctx: Ctx, o: MapObject) {
    const x = o.x * T, y = o.y * T, w = (o.w ?? 1) * T, h = (o.h ?? 1) * T;
    switch (o.type) {
      case 'desk': return this.desk(ctx, x, y, w, o.variant ?? 2);
      case 'execDesk': return this.execDesk(ctx, x, y, w);
      case 'chair': return this.chair(ctx, x + T / 2, y + T / 2, o.dir ?? 'down', '#3F4652');
      case 'stool': return this.stool(ctx, x + T / 2, y + T / 2);
      case 'meetingTable': return this.meetingTable(ctx, x, y, w, h);
      case 'roundTable': return this.roundTable(ctx, x, y, w);
      case 'plant': return this.plant(ctx, x + T / 2, y + T / 2, o.x * 7 + o.y);
      case 'cactus': return this.cactus(ctx, x + T / 2, y + T / 2);
      case 'tallPlant': return this.tallPlant(ctx, x + T / 2, y + T / 2);
      case 'lamp': return this.lamp(ctx, x + T / 2, y + T / 2);
      case 'tv': return this.tv(ctx, x, y, w, o.text ?? '');
      case 'whiteboard': return this.whiteboard(ctx, x, y, w);
      case 'counter': return this.counter(ctx, x, y, w);
      case 'fridge': return this.fridge(ctx, x, y, w, h);
      case 'sofa': return this.sofa(ctx, x, y, w, h, o.dir ?? 'up', o.variant ?? 0);
      case 'bookshelf': return this.bookshelf(ctx, x, y, w);
      case 'ranking': return this.ranking(ctx, x, y, w, h, o.board ?? 'ventas');
      case 'waterCooler': return this.waterCooler(ctx, x + T / 2, y + T / 2);
      case 'printer': return this.printer(ctx, x, y);
      case 'tree': return this.tree(ctx, x + T / 2, y + T / 2);
      case 'blossom': return this.blossom(ctx, x + T / 2, y + T / 2);
      case 'hedge': return this.hedge(ctx, x, y, w, h);
      case 'streetLamp': return this.streetLamp(ctx, x + T / 2, y + T / 2);
      case 'pumpkin': return this.pumpkin(ctx, x + T / 2, y + T / 2);
      case 'bench': return this.bench(ctx, x, y, w);
      case 'rug': return this.rug(ctx, x, y, w, h, o.variant ?? 0);
    }
  }

  private desk(ctx: Ctx, x: number, y: number, w: number, monitors: number) {
    // silla debajo (mirando al monitor)
    this.chair(ctx, x + w / 2, y + T + 12, 'up', '#2F3540');
    shadow(ctx, x + w / 2, y + T - 1, w / 2 - 1, 4, 0.16);
    fillRR(ctx, x + 1, y + 3, w - 2, T - 6, 3, '#FFFFFF', '#CFC6B4', 1);
    ctx.fillStyle = '#E9E3D6';
    ctx.fillRect(x + 2, y + T - 7, w - 4, 3);
    const mons = monitors === 1 ? [x + w / 2] : [x + w * 0.3, x + w * 0.7];
    for (const mx of mons) {
      fillRR(ctx, mx - 10, y + 4, 20, 13, 2, '#22262E');
      fillRR(ctx, mx - 8.5, y + 5.5, 17, 9.5, 1, '#3FA7D6');
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(mx - 7, y + 7, 7, 1.5);
      ctx.fillRect(mx - 7, y + 10, 11, 1.5);
      ctx.fillStyle = '#5A606B';
      ctx.fillRect(mx - 2, y + 17, 4, 2);
    }
    fillRR(ctx, x + w / 2 - 8, y + 20, 16, 4, 1, '#D9DDE3', '#B8BEC8', 0.5);
    circle(ctx, x + w - 7, y + 21, 2.5, '#F2F2F2', '#A39A88', 1);
  }

  private execDesk(ctx: Ctx, x: number, y: number, w: number) {
    this.chair(ctx, x + w / 2, y + T + 12, 'up', '#5A3A22');
    shadow(ctx, x + w / 2, y + T, w / 2, 5, 0.2);
    fillRR(ctx, x, y + 2, w, T - 4, 4, '#8B5E3C', '#5E3D24', 1.5);
    fillRR(ctx, x + 3, y + 5, w - 6, T - 10, 3, '#9C6B45');
    fillRR(ctx, x + w / 2 - 11, y + 6, 22, 14, 2, '#2A2E36');
    fillRR(ctx, x + w / 2 - 9, y + 7.5, 18, 10, 1, '#F5C518');
    circle(ctx, x + 10, y + 12, 4, '#F7E7A6', '#B88A1E', 1);
    ctx.fillStyle = '#F4F1EA';
    ctx.fillRect(x + w - 22, y + 9, 12, 9);
  }

  private chair(ctx: Ctx, cx: number, cy: number, dir: string, color: string) {
    shadow(ctx, cx, cy + 8, 8, 3, 0.15);
    const vertical = dir === 'up' || dir === 'down';
    // asiento
    fillRR(ctx, cx - 7, cy - 6, 14, 13, 4, color, shade(color, -0.12), 1);
    ctx.fillStyle = shade(color, -0.18);
    // respaldo en el lado opuesto a donde mira
    if (vertical) {
      const by = dir === 'up' ? cy + 5 : cy - 9;
      fillRR(ctx, cx - 8, by, 16, 5, 2.5, shade(color, -0.15));
    } else {
      const bx = dir === 'left' ? cx + 5 : cx - 9;
      fillRR(ctx, bx, cy - 8, 5, 16, 2.5, shade(color, -0.15));
    }
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(cx - 4, cy - 4, 8, 2);
  }

  private stool(ctx: Ctx, cx: number, cy: number) {
    shadow(ctx, cx, cy + 8, 7, 3);
    circle(ctx, cx, cy, 7.5, '#C88B4A', '#8E5A2B', 1.5);
    circle(ctx, cx, cy, 4, '#D9A066');
  }

  private meetingTable(ctx: Ctx, x: number, y: number, w: number, h: number) {
    shadow(ctx, x + w / 2, y + h + 1, w / 2, 6, 0.18);
    fillRR(ctx, x, y, w, h, 18, '#D3AE84', '#9C7652', 2);
    fillRR(ctx, x + 6, y + 6, w - 12, h - 12, 14, '#DDBA92');
    for (let i = 0; i < 4; i++) {
      const lx = x + 30 + i * ((w - 60) / 3);
      fillRR(ctx, lx - 8, y + 9, 16, 10, 2, '#E5E7EB', '#9CA3AF', 0.8);
      fillRR(ctx, lx - 8, y + h - 19, 16, 10, 2, '#F9FAFB', '#9CA3AF', 0.8);
    }
    circle(ctx, x + w / 2, y + h / 2, 7, '#1F2937', '#111', 1);
    circle(ctx, x + w / 2, y + h / 2, 2.5, '#22C55E');
  }

  private roundTable(ctx: Ctx, x: number, y: number, w: number) {
    const cx = x + w / 2, cy = y + w / 2;
    shadow(ctx, cx, cy + w / 2 - 4, w / 2 - 6, 5, 0.18);
    circle(ctx, cx, cy, w / 2 - 6, '#FFFFFF', '#C8A57B', 2.5);
    circle(ctx, cx - 7, cy - 4, 4, '#FFFFFF', '#8E5A2B', 1.5);
    circle(ctx, cx - 7, cy - 4, 2.2, '#6B3F1F');
    circle(ctx, cx + 8, cy + 5, 4, '#FFFFFF', '#8E5A2B', 1.5);
    circle(ctx, cx + 8, cy + 5, 2.2, '#6B3F1F');
    ellipse(ctx, cx + 6, cy - 7, 5, 3, '#F5D7A1');
  }

  private pot(ctx: Ctx, cx: number, cy: number, color = '#F4F1EA', rim = '#C9BFA9') {
    shadow(ctx, cx, cy + 11, 9, 3.5, 0.2);
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 1); ctx.lineTo(cx + 8, cy + 1); ctx.lineTo(cx + 6, cy + 12); ctx.lineTo(cx - 6, cy + 12); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = rim;
    ctx.fillRect(cx - 9, cy, 18, 3);
  }

  private plant(ctx: Ctx, cx: number, cy: number, seed: number) {
    const r = rng(seed + 11);
    this.pot(ctx, cx, cy + 2, r() > 0.5 ? '#F4F1EA' : '#D9825B', r() > 0.5 ? '#C9BFA9' : '#A85A38');
    const greens = ['#2F8F46', '#3BAA55', '#4CC064', '#257A3A'];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r();
      ellipse(ctx, cx + Math.cos(a) * 6, cy - 3 + Math.sin(a) * 5, 6, 4, greens[i % 4]);
    }
    ellipse(ctx, cx, cy - 5, 5, 4, '#56C870');
  }

  private cactus(ctx: Ctx, cx: number, cy: number) {
    this.pot(ctx, cx, cy + 2, '#D9825B', '#A85A38');
    fillRR(ctx, cx - 4, cy - 14, 8, 18, 4, '#3E9B4F', '#2C7A3B', 1);
    fillRR(ctx, cx - 11, cy - 8, 6, 10, 3, '#3E9B4F', '#2C7A3B', 1);
    fillRR(ctx, cx - 7, cy - 1, 4, 4, 1, '#3E9B4F');
    fillRR(ctx, cx + 5, cy - 11, 6, 9, 3, '#3E9B4F', '#2C7A3B', 1);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 6; i++) ctx.fillRect(cx - 2 + (i % 2) * 3, cy - 12 + i * 3, 1, 1);
    circle(ctx, cx, cy - 15, 2.2, '#F472B6');
  }

  private tallPlant(ctx: Ctx, cx: number, cy: number) {
    this.pot(ctx, cx, cy + 2, '#2B2B2E', '#111');
    ctx.strokeStyle = '#2C7A3B';
    ctx.lineWidth = 1.5;
    const leaves = [[-14, -20], [-6, -26], [4, -27], [13, -20], [-12, -8], [12, -9], [0, -16]];
    for (const [dx, dy] of leaves) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * 0.6, cy + dy * 0.6); ctx.stroke();
      ctx.save();
      ctx.translate(cx + dx * 0.7, cy + dy * 0.7);
      ctx.rotate(Math.atan2(dy, dx));
      ellipse(ctx, 0, 0, 9, 3.5, '#34A853');
      ellipse(ctx, 1, -0.5, 6, 1.6, '#5BCB78');
      ctx.restore();
    }
  }

  private lamp(ctx: Ctx, cx: number, cy: number) {
    const g = ctx.createRadialGradient(cx, cy - 12, 2, cx, cy - 12, 30);
    g.addColorStop(0, 'rgba(255,220,130,0.45)');
    g.addColorStop(1, 'rgba(255,220,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 32, cy - 44, 64, 64);
    shadow(ctx, cx, cy + 10, 7, 3);
    ellipse(ctx, cx, cy + 9, 6, 2.5, '#3A3A3A');
    ctx.fillStyle = '#4A4A4A';
    ctx.fillRect(cx - 1, cy - 12, 2, 21);
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 22); ctx.lineTo(cx + 6, cy - 22); ctx.lineTo(cx + 9, cy - 11); ctx.lineTo(cx - 9, cy - 11); ctx.closePath();
    ctx.fillStyle = '#FFF4D6'; ctx.fill();
    ctx.strokeStyle = '#D6B56A'; ctx.lineWidth = 1; ctx.stroke();
  }

  private tv(ctx: Ctx, x: number, y: number, w: number, label: string) {
    const top = y + 4;
    ctx.save();
    ctx.shadowColor = 'rgba(43,179,163,0.7)';
    ctx.shadowBlur = 10;
    fillRR(ctx, x + 2, top, w - 4, 22, 3, '#0E1116', BRAND.goldDeep, 1.5);
    ctx.restore();
    const g = ctx.createLinearGradient(x, top, x, top + 22);
    g.addColorStop(0, '#103A42'); g.addColorStop(1, '#0B2228');
    fillRR(ctx, x + 5, top + 3, w - 10, 16, 2, g);
    // mini gráfica
    ctx.strokeStyle = 'rgba(94,234,212,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const px = x + 8 + i * ((w - 16) / 7), py = top + 15 - ((i * 37) % 7);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    text(ctx, knownPhrase(label), x + w / 2, top + 9, 7.5, '#5EEAD4', 800);
  }

  private whiteboard(ctx: Ctx, x: number, y: number, w: number) {
    fillRR(ctx, x + 3, y + 5, w - 6, 20, 2, '#FFFFFF', '#9CA3AF', 1.5);
    ctx.lineWidth = 1.5;
    const cols = ['#2563EB', '#DC2626', '#16A34A'];
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = cols[i];
      ctx.beginPath();
      ctx.moveTo(x + 9, y + 10 + i * 5);
      ctx.lineTo(x + 9 + (w - 30) * (0.5 + i * 0.2), y + 10 + i * 5);
      ctx.stroke();
    }
    ctx.strokeStyle = '#F59E0B';
    ctx.strokeRect(x + w - 22, y + 9, 12, 10);
  }

  private counter(ctx: Ctx, x: number, y: number, w: number) {
    shadow(ctx, x + w / 2, y + T, w / 2, 4);
    fillRR(ctx, x, y + 2, w, T - 4, 3, '#E5E7EB', '#9CA3AF', 1);
    ctx.fillStyle = '#F3F4F6';
    ctx.fillRect(x + 2, y + 4, w - 4, 8);
    // fregadero
    fillRR(ctx, x + 10, y + 8, 22, 14, 3, '#CBD5E1', '#94A3B8', 1);
    circle(ctx, x + 21, y + 15, 2, '#64748B');
    // cafetera
    fillRR(ctx, x + w - 40, y + 3, 18, 22, 3, '#1F2937');
    fillRR(ctx, x + w - 37, y + 6, 12, 6, 1, '#374151');
    circle(ctx, x + w - 26, y + 18, 1.8, '#EF4444');
    circle(ctx, x + w - 33, y + 19, 3, '#FFFFFF', '#6B3F1F', 1);
    // tazas
    for (let i = 0; i < 3; i++) circle(ctx, x + 52 + i * 12, y + 16, 3.5, ['#F5C518', '#FFFFFF', '#2BB3A3'][i], '#6B7280', 1);
    text(ctx, knownPhrase('CAFÉ'), x + w / 2 + 20, y + 26, 6, '#6B7280', 800);
  }

  private fridge(ctx: Ctx, x: number, y: number, w: number, h: number) {
    shadow(ctx, x + w / 2, y + h, w / 2, 4);
    fillRR(ctx, x + 2, y + 2, w - 4, h - 4, 4, '#D1D5DB', '#6B7280', 1.5);
    ctx.fillStyle = '#9CA3AF';
    ctx.fillRect(x + 3, y + h * 0.38, w - 6, 1.5);
    ctx.fillRect(x + w - 8, y + 8, 2, 10);
    ctx.fillRect(x + w - 8, y + h * 0.5, 2, 14);
  }

  private sofa(ctx: Ctx, x: number, y: number, w: number, h: number, dir: string, variant: number) {
    const col = ['#2BB3A3', '#D9A43A', '#5B3A29'][variant % 3];
    shadow(ctx, x + w / 2, y + h - 2, w / 2, 5);
    fillRR(ctx, x + 1, y + 2, w - 2, h - 4, 7, col, shade(col, -0.2), 1.5);
    const back = shade(col, -0.12);
    if (dir === 'up') fillRR(ctx, x + 1, y + h - 12, w - 2, 9, 5, back);
    if (dir === 'down') fillRR(ctx, x + 1, y + 2, w - 2, 9, 5, back);
    if (dir === 'left') fillRR(ctx, x + w - 12, y + 2, 10, h - 4, 5, back);
    if (dir === 'right') fillRR(ctx, x + 2, y + 2, 10, h - 4, 5, back);
    // cojines
    ctx.strokeStyle = shade(col, -0.18);
    ctx.lineWidth = 1;
    if (dir === 'up' || dir === 'down') for (let i = 1; i < w / T; i++) { ctx.beginPath(); ctx.moveTo(x + i * T, y + 6); ctx.lineTo(x + i * T, y + h - 6); ctx.stroke(); }
    else for (let i = 1; i < h / T; i++) { ctx.beginPath(); ctx.moveTo(x + 6, y + i * T); ctx.lineTo(x + w - 6, y + i * T); ctx.stroke(); }
  }

  private bookshelf(ctx: Ctx, x: number, y: number, w: number) {
    fillRR(ctx, x + 1, y + 2, w - 2, T - 6, 2, '#7A4E2D', '#4A2E18', 1.5);
    const r = rng(x + y);
    const cols = ['#DC2626', '#2563EB', '#F5C518', '#16A34A', '#7C3AED', '#F97316', '#0EA5E9'];
    for (let bx = x + 4; bx < x + w - 6; bx += 5) {
      const bh = 12 + r() * 8;
      ctx.fillStyle = cols[Math.floor(r() * cols.length)];
      ctx.fillRect(bx, y + T - 6 - bh, 4, bh);
    }
  }

  private ranking(ctx: Ctx, x: number, y: number, w: number, h: number, board: 'ventas' | 'citas') {
    const data = this.rankings[board] ?? { title: 'RANKING', subtitle: '', rows: [] as { name: string; value: number; fmt: string }[] };
    // patas
    ctx.fillStyle = '#3A3A3A';
    ctx.fillRect(x + 14, y + h - 6, 3, 8);
    ctx.fillRect(x + w - 17, y + h - 6, 3, 8);
    shadow(ctx, x + w / 2, y + h + 2, w / 2 - 6, 4, 0.22);
    ctx.save();
    ctx.shadowColor = 'rgba(245,197,24,0.55)';
    ctx.shadowBlur = 10;
    fillRR(ctx, x + 2, y + 1, w - 4, h - 4, 5, '#0D0D0F', BRAND.gold, 2);
    ctx.restore();
    text(ctx, knownPhrase(data.title), x + w / 2, y + 10, 8.5, BRAND.gold, 900);
    ctx.fillStyle = 'rgba(245,197,24,0.35)';
    ctx.fillRect(x + 10, y + 16, w - 20, 1);
    const medal = ['#F5C518', '#C9CDD2', '#CD7F32'];
    data.rows.slice(0, 3).forEach((row, i) => {
      const ry = y + 24 + i * 11;
      circle(ctx, x + 14, ry, 4, medal[i]);
      text(ctx, String(i + 1), x + 14, ry + 0.5, 6, '#111', 900);
      text(ctx, row.name, x + 22, ry + 0.5, 7.5, '#F3F4F6', 700, 'left');
      text(ctx, row.fmt === '€' ? moneyOf(row.value) : String(row.value), x + w - 10, ry + 0.5, 7.5, BRAND.goldSoft, 800, 'right');
    });
  }

  private waterCooler(ctx: Ctx, cx: number, cy: number) {
    shadow(ctx, cx, cy + 11, 7, 3);
    fillRR(ctx, cx - 7, cy - 2, 14, 14, 2, '#F3F4F6', '#9CA3AF', 1);
    fillRR(ctx, cx - 6, cy - 15, 12, 14, 5, 'rgba(96,165,250,0.85)', '#3B82F6', 1);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(cx - 3, cy - 12, 2, 8);
  }

  private printer(ctx: Ctx, x: number, y: number) {
    shadow(ctx, x + 16, y + 28, 12, 3);
    fillRR(ctx, x + 3, y + 6, 26, 20, 3, '#E5E7EB', '#6B7280', 1);
    fillRR(ctx, x + 7, y + 3, 18, 6, 1, '#FFFFFF', '#9CA3AF', 1);
    ctx.fillStyle = '#374151';
    ctx.fillRect(x + 7, y + 14, 18, 3);
    circle(ctx, x + 24, y + 21, 1.5, '#22C55E');
  }

  private tree(ctx: Ctx, cx: number, cy: number) {
    shadow(ctx, cx, cy + 12, 10, 4, 0.25);
    ctx.fillStyle = '#6B4423';
    ctx.fillRect(cx - 2, cy + 4, 4, 9);
    ellipse(ctx, cx, cy - 8, 8, 17, '#1F6B35');
    ellipse(ctx, cx - 2, cy - 11, 5, 11, '#2E8B47');
    ellipse(ctx, cx - 3, cy - 15, 2, 5, '#47A862');
  }

  private blossom(ctx: Ctx, cx: number, cy: number) {
    shadow(ctx, cx, cy + 12, 10, 4, 0.25);
    ctx.fillStyle = '#7A4A2A';
    ctx.fillRect(cx - 2, cy - 2, 4, 14);
    circle(ctx, cx, cy - 8, 11, '#EC8DB5');
    circle(ctx, cx - 5, cy - 11, 6, '#F5A8C8');
    circle(ctx, cx + 5, cy - 5, 5, '#E27BA6');
    circle(ctx, cx - 3, cy - 13, 2.5, '#FFD1E3');
  }

  private hedge(ctx: Ctx, x: number, y: number, w: number, h: number) {
    shadow(ctx, x + w / 2, y + h - 2, w / 2, 4, 0.22);
    fillRR(ctx, x + 1, y + 4, w - 2, h - 8, 7, '#2F8F46', '#1F6B35', 1.5);
    for (let i = 0; i < w / 8; i++) circle(ctx, x + 6 + i * 8, y + 9, 3.5, '#3EAA58');
  }

  private streetLamp(ctx: Ctx, cx: number, cy: number) {
    const g = ctx.createRadialGradient(cx, cy - 18, 2, cx, cy - 18, 26);
    g.addColorStop(0, 'rgba(255,236,170,0.5)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 28, cy - 46, 56, 56);
    shadow(ctx, cx, cy + 10, 6, 2.5);
    ctx.fillStyle = '#2B2B2E';
    ctx.fillRect(cx - 1.5, cy - 18, 3, 28);
    fillRR(ctx, cx - 5, cy - 24, 10, 8, 3, '#2B2B2E');
    circle(ctx, cx, cy - 19, 3, '#FFF1B8');
  }

  private pumpkin(ctx: Ctx, cx: number, cy: number) {
    shadow(ctx, cx, cy + 8, 9, 3);
    ellipse(ctx, cx, cy + 2, 10, 8, '#F28C28');
    ellipse(ctx, cx - 4, cy + 2, 4, 7.5, '#F59E3A');
    ellipse(ctx, cx + 4, cy + 2, 4, 7.5, '#E07C1C');
    ctx.fillStyle = '#4D7C0F';
    ctx.fillRect(cx - 1, cy - 8, 3, 4);
  }

  private bench(ctx: Ctx, x: number, y: number, w: number) {
    shadow(ctx, x + w / 2, y + 26, w / 2 - 2, 3);
    for (let i = 0; i < 3; i++) fillRR(ctx, x + 2, y + 8 + i * 5, w - 4, 4, 1, '#B07A47', '#7A4E2D', 0.8);
    ctx.fillStyle = '#3A3A3A';
    ctx.fillRect(x + 5, y + 22, 3, 5);
    ctx.fillRect(x + w - 8, y + 22, 3, 5);
  }

  private rug(ctx: Ctx, x: number, y: number, w: number, h: number, variant: number) {
    const base = variant ? '#7A2E2E' : '#DDE7EA';
    const border = variant ? BRAND.goldDeep : '#9FB8C0';
    fillRR(ctx, x + 2, y + 2, w - 4, h - 4, 6, base, border, 2);
    ctx.save();
    ctx.setLineDash([4, 4]);
    rr(ctx, x + 8, y + 8, w - 16, h - 16, 4);
    ctx.strokeStyle = variant ? 'rgba(245,197,24,0.5)' : 'rgba(80,120,130,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
