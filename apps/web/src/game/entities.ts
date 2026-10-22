/**
 * Entidades: Avatar base (jugador local, NPC simulados y —en el futuro—
 * jugadores remotos). Su estado público es `AvatarState` (serializable).
 */
import { CAR_SPEED, TILE, WALK_SPEED } from '../config';
import { findPath, nearestWalkable, type Pt } from './pathfinding';
import type { AvatarLook, AvatarState, Dir, Role, StatusId } from './types';
import type { Seat, World } from './world';

export class Avatar {
  id: string;
  name: string;
  role: Role;
  look: AvatarLook;
  x: number;
  y: number;
  dir: Dir = 'down';
  moving = false;
  sitting = false;
  status: StatusId = 'en_linea';
  mode: 'walk' | 'car' = 'walk';
  /** Ruta en px de mundo (waypoints). */
  path: Pt[] = [];
  /** Ángulo del coche (rad). */
  carAngle = -Math.PI / 2;
  bubble: { text: string; until: number } | null = null;
  isNew = false;
  /** 0 parado, 1 a velocidad plena. Sube y baja con suavidad. */
  pace = 0;

  constructor(id: string, name: string, role: Role, look: AvatarLook, x: number, y: number) {
    this.id = id; this.name = name; this.role = role; this.look = look; this.x = x; this.y = y;
  }

  get speed() { return this.mode === 'car' ? CAR_SPEED : WALK_SPEED; }

  toState(): AvatarState {
    return { id: this.id, name: this.name, role: this.role, x: this.x, y: this.y, dir: this.dir, moving: this.moving, status: this.status, mode: this.mode, look: this.look, sitting: this.sitting };
  }

  /** Calcula ruta A* hasta un punto en px. Devuelve false si no hay camino. */
  goTo(world: World, tx: number, ty: number, exact = false): boolean {
    const from = { x: Math.floor(this.x / TILE), y: Math.floor(this.y / TILE) };
    const target = nearestWalkable(world, { x: Math.floor(tx / TILE), y: Math.floor(ty / TILE) });
    if (!target) return false;
    const tiles = findPath(world, from, target);
    if (!tiles) return false;
    this.path = tiles.map((p) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE + 6 }));
    if (exact && target.x === Math.floor(tx / TILE) && target.y === Math.floor(ty / TILE)) {
      if (this.path.length) this.path[this.path.length - 1] = { x: tx, y: ty };
      else this.path = [{ x: tx, y: ty }];
    }
    this.sitting = false;
    return true;
  }

  /** Acelera al andar y frena al soltar, en vez de pegar un tirón. */
  glide(dt: number, going: boolean) {
    const target = going ? 1 : 0;
    const k = 1 - Math.exp(-dt * (going ? 8 : 11));
    this.pace += (target - this.pace) * k;
    if (!going && this.pace < 0.04) this.pace = 0;
  }

  /** Avanza por la ruta. Devuelve true si llegó al final en este frame. */
  followPath(dt: number): boolean {
    if (!this.path.length) { this.moving = false; return false; }
    let budget = this.speed * Math.max(0.22, this.pace) * dt * (this.mode === 'car' ? 1 : 0.92);
    while (budget > 0 && this.path.length) {
      const p = this.path[0];
      const dx = p.x - this.x, dy = p.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) this.faceTowards(dx, dy);
      if (d <= budget) { this.x = p.x; this.y = p.y; budget -= d; this.path.shift(); }
      else { this.x += (dx / d) * budget; this.y += (dy / d) * budget; budget = 0; }
    }
    this.moving = this.path.length > 0;
    return this.path.length === 0;
  }

  faceTowards(dx: number, dy: number) {
    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
    else this.dir = dy > 0 ? 'down' : 'up';
    const target = Math.atan2(dy, dx);
    let diff = target - this.carAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.carAngle += diff * 0.25;
  }

  say(text: string, ms = 2500) { this.bubble = { text, until: performance.now() + ms }; }

  sitAt(seat: Seat) {
    this.x = seat.x; this.y = seat.y; this.dir = seat.facing; this.sitting = true; this.path = []; this.moving = false;
  }
}
