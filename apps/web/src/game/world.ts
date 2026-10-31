/**
 * World: construye la rejilla de colisión, los asientos y las zonas a partir
 * de la definición del mapa. No sabe nada de render ni de UI.
 */
import { TILE } from '../config';
import type { DoorDef, MapDefinition, MapObject, RoomDef } from './types';

export const enum Cell { Floor = 0, Wall = 1, Solid = 2, Door = 3, Outside = 4 }

export interface Seat { id: string; x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' }

/** Objetos que NO bloquean el paso. */
const WALKABLE_OBJECTS = new Set(['chair', 'stool', 'rug', 'tv', 'whiteboard']);

export class World {
  readonly def: MapDefinition;
  readonly w: number;
  readonly h: number;
  /** Tipo base de cada celda (suelo/pared/puerta/exterior). */
  readonly cells: Uint8Array;
  /** Bloqueado por objeto sólido. */
  readonly blocked: Uint8Array;
  readonly seats = new Map<string, Seat>();
  readonly lockedDoors: { room: RoomDef; door: DoorDef }[] = [];
  private privateLocked = true;

  constructor(def: MapDefinition) {
    this.def = def;
    this.w = def.width;
    this.h = def.height;
    this.cells = new Uint8Array(this.w * this.h).fill(Cell.Outside);
    this.blocked = new Uint8Array(this.w * this.h);
    this.build();
  }

  private idx(x: number, y: number) { return y * this.w + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  cell(x: number, y: number): Cell { return this.inBounds(x, y) ? this.cells[this.idx(x, y)] : Cell.Wall; }

  private build() {
    const b = this.def.building;
    // Interior del edificio = suelo; perímetro = pared.
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
        this.cells[this.idx(x, y)] = edge ? Cell.Wall : Cell.Floor;
      }
    // Entrada principal (abajo).
    for (let x = this.def.entrance.x; x < this.def.entrance.x + this.def.entrance.w; x++)
      this.cells[this.idx(x, b.y + b.h - 1)] = Cell.Door;

    for (const room of this.def.rooms) {
      if (!room.walls) continue;
      const r = room.rect;
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
          if (edge) this.cells[this.idx(x, y)] = Cell.Wall;
        }
      for (const d of room.doors ?? []) {
        for (let y = d.y; y < d.y + (d.h ?? 1); y++)
          for (let x = d.x; x < d.x + (d.w ?? 1); x++) this.cells[this.idx(x, y)] = Cell.Door;
        if (d.locked) this.lockedDoors.push({ room, door: d });
      }
    }

    for (const o of this.def.objects) {
      if (!WALKABLE_OBJECTS.has(o.type)) this.markSolid(o);
      this.registerSeat(o);
    }
  }

  private markSolid(o: MapObject) {
    const w = o.w ?? 1, h = o.h ?? 1;
    for (let y = o.y; y < o.y + h; y++)
      for (let x = o.x; x < o.x + w; x++) if (this.inBounds(x, y)) this.blocked[this.idx(x, y)] = 1;
  }

  private registerSeat(o: MapObject) {
    if (!o.seatId) return;
    const w = o.w ?? 1;
    if (o.type === 'desk' || o.type === 'execDesk') {
      // Silla centrada debajo del escritorio, mirando hacia el monitor.
      this.seats.set(o.seatId, { id: o.seatId, x: (o.x + w / 2) * TILE, y: (o.y + 1) * TILE + 24, facing: 'up' });
    } else {
      const dir = o.dir ?? 'down';
      this.seats.set(o.seatId, { id: o.seatId, x: (o.x + 0.5) * TILE, y: o.y * TILE + 26, facing: dir });
    }
  }

  isPrivateLocked() { return this.privateLocked; }
  setPrivateLocked(v: boolean) { this.privateLocked = v; }

  isLockedDoorTile(tx: number, ty: number) {
    if (!this.privateLocked) return false;
    return this.lockedDoors.some(({ door: d }) => tx >= d.x && tx < d.x + (d.w ?? 1) && ty >= d.y && ty < d.y + (d.h ?? 1));
  }

  /** ¿Se puede pisar el tile? */
  walkableTile(tx: number, ty: number): boolean {
    if (!this.inBounds(tx, ty)) return false;
    const c = this.cells[this.idx(tx, ty)];
    if (c === Cell.Wall) return false;
    if (this.blocked[this.idx(tx, ty)]) return false;
    if (c === Cell.Door && this.isLockedDoorTile(tx, ty)) return false;
    return true;
  }

  /** Colisión de un círculo pequeño (pies del avatar) contra la rejilla. */
  canStand(px: number, py: number, radius = 9): boolean {
    const pts = [[px - radius, py - radius * 0.6], [px + radius, py - radius * 0.6], [px - radius, py + 2], [px + radius, py + 2]];
    for (const [x, y] of pts) if (!this.walkableTile(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    return true;
  }

  /** Sala / zona que contiene el punto (px). Prioriza salas con paredes. */
  roomAt(px: number, py: number): RoomDef | null {
    const tx = px / TILE, ty = py / TILE;
    let best: RoomDef | null = null;
    for (const r of this.def.rooms) {
      const q = r.rect;
      if (tx >= q.x + (r.walls ? 1 : 0) && ty >= q.y + (r.walls ? 1 : 0) && tx < q.x + q.w - (r.walls ? 1 : 0) && ty < q.y + q.h - (r.walls ? 1 : 0)) {
        if (!best || (r.walls && !best.walls)) best = r;
      }
    }
    if (best) return best;
    const p = this.def.plaza;
    if (Math.hypot(tx - p.cx, ty - p.cy) <= p.r) return { id: 'plaza', name: 'Plaza central', kind: 'plaza', walls: false, rect: { x: 0, y: 0, w: 0, h: 0 } };
    return null;
  }

  isOutside(px: number, py: number) {
    return this.cell(Math.floor(px / TILE), Math.floor(py / TILE)) === Cell.Outside;
  }

  /** Tile caminable aleatorio dentro de un rectángulo (para NPC que pasean). */
  randomWalkable(rect = this.def.building, rnd = Math.random): { x: number; y: number } {
    for (let i = 0; i < 200; i++) {
      const x = rect.x + Math.floor(rnd() * rect.w), y = rect.y + Math.floor(rnd() * rect.h);
      if (this.walkableTile(x, y) && this.cell(x, y) === Cell.Floor && this.walkableTile(x + 1, y) && this.walkableTile(x - 1, y)) return { x, y };
    }
    return { x: this.def.spawn.x, y: this.def.spawn.y };
  }
}
