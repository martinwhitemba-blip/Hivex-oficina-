/**
 * Compañeros simulados (NPC). Su comportamiento depende del estado:
 *  - En reunión → silla libre en la Sala de reuniones
 *  - Café virtual → taburete libre en el Café
 *  - En línea / En llamada / Ausente → su escritorio
 *  - comportamiento 'wander' pasea; 'chat' charla en la plaza
 * Cambian de estado aleatoriamente cada cierto tiempo (simulación).
 */
import { TILE } from '../config';
import type { MemberSeed } from '../data/sampleData';
import { Avatar } from './entities';
import type { StatusId } from './types';
import type { World } from './world';

const CALL_LINES = ['¿Le viene bien el jueves?', 'Le envío la propuesta', 'Perfecto, agendado ✅', '¿Hablamos a las 18:00?'];
const CAFE_LINES = ['☕', '¿Otro café?', '😄'];

export class SeatPool {
  private taken = new Set<string>();
  constructor(private world: World) {}
  claim(prefix: string): string | null {
    for (const id of this.world.seats.keys()) if (id.startsWith(prefix) && !this.taken.has(id)) { this.taken.add(id); return id; }
    return null;
  }
  reserve(id: string) { this.taken.add(id); }
  release(id: string | null) { if (id) this.taken.delete(id); }
}

type Goal = { kind: 'seat'; seatId: string } | { kind: 'spot'; x: number; y: number } | { kind: 'wander' } | { kind: 'roam' };

export class Npc {
  readonly avatar: Avatar;
  private goal: Goal = { kind: 'wander' };
  private tempSeat: string | null = null;
  private nextStatusAt: number;
  private nextWanderAt = 0;
  private nextLineAt: number;

  constructor(private world: World, private seats: SeatPool, readonly seed: MemberSeed, now: number) {
    const desk = world.seats.get(seed.desk);
    this.avatar = new Avatar(seed.id, seed.name, seed.role, seed.look, desk?.x ?? 0, desk?.y ?? 0);
    this.avatar.status = seed.status;
    this.avatar.isNew = !!seed.isNew;
    seats.reserve(seed.desk);
    this.nextStatusAt = now + (8 + Math.random() * 14) * 1000;
    this.nextLineAt = now + 3000 + Math.random() * 8000;
    this.resolveGoal(seed.status === 'ausente');
    if (this.avatar.status === 'en_linea') {
      this.goal = { kind: 'roam' };
      this.nextWanderAt = now + 250 + Math.random() * 1600;
    }
  }

  setStatus(s: StatusId) {
    if (s === this.avatar.status) return;
    this.avatar.status = s;
    this.resolveGoal(false);
  }

  private resolveGoal(teleport: boolean) {
    const a = this.avatar;
    this.seats.release(this.tempSeat);
    this.tempSeat = null;
    let goal: Goal;
    if (a.status === 'en_reunion') {
      // La directora comercial se reúne en su despacho; el resto en la sala de reuniones.
      if (this.seed.role === 'Director comercial') goal = { kind: 'seat', seatId: this.seed.desk };
      else {
        this.tempSeat = this.seats.claim('reunion-');
        goal = this.tempSeat ? { kind: 'seat', seatId: this.tempSeat } : { kind: 'seat', seatId: this.seed.desk };
      }
    } else if (a.status === 'cafe') {
      this.tempSeat = this.seats.claim('cafe-');
      goal = this.tempSeat ? { kind: 'seat', seatId: this.tempSeat } : { kind: 'wander' };
    } else if (a.status === 'en_linea') {
      goal = { kind: 'roam' };
    } else {
      goal = { kind: 'seat', seatId: this.seed.desk };
    }
    this.goal = goal;

    if (goal.kind === 'seat') {
      const seat = this.world.seats.get(goal.seatId);
      if (!seat) return;
      if (teleport) a.sitAt(seat); else a.goTo(this.world, seat.x, seat.y, true);
    } else {
      this.nextWanderAt = performance.now() + (teleport ? 200 : 500);
    }
  }

  private walkToAnotherRoom() {
    const rooms = this.world.def.rooms.filter((room) => room.rect.w > 4 && room.rect.h > 4);
    const here = this.world.roomAt(this.avatar.x, this.avatar.y);
    const choices = rooms.filter((room) => room.id !== here?.id);
    const pool = choices.length ? choices : rooms;
    const room = pool[Math.floor(Math.random() * pool.length)];
    if (!room) return;
    const rect = {
      x: room.rect.x + 2,
      y: room.rect.y + 2,
      w: Math.max(1, room.rect.w - 4),
      h: Math.max(1, room.rect.h - 4),
    };
    const spot = this.world.randomWalkable(rect);
    const x = (spot.x + 0.5) * TILE;
    const y = (spot.y + 0.5) * TILE + 6;
    if (!this.avatar.goTo(this.world, x, y)) this.nextWanderAt = performance.now() + 700;
    else this.nextWanderAt = Infinity;
  }

  update(dt: number, now: number) {
    const a = this.avatar;
    if (now > this.nextStatusAt) {
      this.nextStatusAt = now + (12 + Math.random() * 16) * 1000;
      this.setStatus(pickStatus());
    }
    const arrived = a.followPath(dt);
    if (arrived) {
      if (this.goal.kind === 'seat') {
        const seat = this.world.seats.get(this.goal.seatId);
        if (seat) a.sitAt(seat);
      } else if (this.goal.kind === 'spot') {
        a.dir = this.seed.id === 'javier' ? 'right' : 'left';
      } else {
        this.nextWanderAt = now + 1400 + Math.random() * 2600;
      }
    }
    if ((this.goal.kind === 'roam' || this.goal.kind === 'wander') && !a.path.length && now > this.nextWanderAt) {
      this.walkToAnotherRoom();
    }
    // frases ocasionales
    if (now > this.nextLineAt) {
      this.nextLineAt = now + 9000 + Math.random() * 14000;
      if (a.status === 'en_llamada') a.say(CALL_LINES[Math.floor(Math.random() * CALL_LINES.length)]);
      else if (a.status === 'cafe') a.say(CAFE_LINES[Math.floor(Math.random() * CAFE_LINES.length)]);
      else if (this.seed.behaviour === 'chat' && a.status === 'en_linea') a.say(this.seed.id === 'javier' ? '¿Cerraste la de ayer?' : '¡Sí! 2.000 € 🎉');
    }
  }
}

function pickStatus(): StatusId {
  const r = Math.random();
  if (r < 0.35) return 'en_linea';
  if (r < 0.6) return 'en_llamada';
  if (r < 0.75) return 'cafe';
  if (r < 0.9) return 'en_reunion';
  return 'ausente';
}
