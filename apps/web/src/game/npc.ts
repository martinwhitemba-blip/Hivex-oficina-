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

type Goal = { kind: 'seat'; seatId: string } | { kind: 'spot'; x: number; y: number } | { kind: 'wander' };

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
    this.nextStatusAt = now + (seed.behaviour === 'chat' ? 90 : 25 + Math.random() * 45) * 1000;
    this.nextLineAt = now + 3000 + Math.random() * 8000;
    this.resolveGoal(true);
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
    } else if (a.status === 'en_linea' && this.seed.behaviour === 'chat' && this.seed.chatSpot) {
      goal = { kind: 'spot', x: this.seed.chatSpot.x * TILE, y: this.seed.chatSpot.y * TILE };
    } else if (a.status === 'en_linea' && this.seed.behaviour === 'wander') {
      goal = { kind: 'wander' };
    } else {
      goal = { kind: 'seat', seatId: this.seed.desk };
    }
    this.goal = goal;

    if (goal.kind === 'seat') {
      const seat = this.world.seats.get(goal.seatId);
      if (!seat) return;
      if (teleport) a.sitAt(seat); else a.goTo(this.world, seat.x, seat.y, true);
    } else if (goal.kind === 'spot') {
      if (teleport) { a.x = goal.x; a.y = goal.y; a.sitting = false; } else a.goTo(this.world, goal.x, goal.y, true);
    } else {
      if (teleport) {
        const p = this.world.randomWalkable({ x: 27, y: 16, w: 18, h: 13 });
        a.x = (p.x + 0.5) * TILE; a.y = (p.y + 0.5) * TILE + 6;
      }
      this.nextWanderAt = performance.now() + 1500;
    }
  }

  update(dt: number, now: number) {
    const a = this.avatar;
    if (now > this.nextStatusAt) {
      this.nextStatusAt = now + (35 + Math.random() * 50) * 1000;
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
        this.nextWanderAt = now + 2500 + Math.random() * 5000;
      }
    }
    if (this.goal.kind === 'wander' && !a.path.length && now > this.nextWanderAt) {
      const p = this.world.randomWalkable();
      if (!a.goTo(this.world, (p.x + 0.5) * TILE, (p.y + 0.5) * TILE + 6)) this.nextWanderAt = now + 1000;
      else this.nextWanderAt = Infinity;
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
