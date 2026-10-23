import * as THREE from 'three';
import { TILE } from '../../config';
import type { MapObject, RoomDef } from '../types';
import type { AreaTally } from './taskState';

const ATLAS = 2048;
const CELL_W = 512;
const CELL_H = 288;
const COLS = 4;

export interface BoardWords {
  pending: string;
  doing: string;
  done: string;
  mission: string;
}

export interface RoomLink { roomId: string; areaId: string | null }

/**
 * Una pizarra por sala, todas en la misma textura y la misma llamada de dibujo.
 */
export class RoomBoards {
  readonly mesh: THREE.InstancedMesh;
  readonly ids: string[];
  private area = new Map<string, string | null>();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private uv: THREE.InstancedBufferAttribute;
  private signature = '';

  constructor(rooms: RoomDef[], objects: MapObject[]) {
    this.ids = rooms.map((room) => room.id);
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS;
    this.canvas.height = ATLAS;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(rooms.length * 4), 4);
    geo.setAttribute('atlasUv', this.uv);
    this.mesh = new THREE.InstancedMesh(geo, boardMaterial(this.texture), Math.max(1, rooms.length));
    this.mesh.count = rooms.length;
    this.mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    rooms.forEach((room, index) => {
      const spot = placeBoard(room, objects);
      dummy.position.set(spot.x, 46, spot.z);
      dummy.rotation.set(0, spot.rot, 0);
      dummy.scale.set(86, 48, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(index, dummy.matrix);
      const col = index % COLS;
      const row = Math.floor(index / COLS);
      this.uv.setXYZW(index, (col * CELL_W) / ATLAS, 1 - ((row + 1) * CELL_H) / ATLAS, CELL_W / ATLAS, CELL_H / ATLAS);
      this.area.set(room.id, null);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.paint(new Map(), { pending: '', doing: '', done: '', mission: '' });
  }

  setAreas(links: RoomLink[]) {
    for (const link of links) this.area.set(link.roomId, link.areaId);
    this.signature = '';
  }

  areaId(instanceId: number) {
    const roomId = this.ids[instanceId];
    if (!roomId) return null;
    return this.area.get(roomId) ?? null;
  }

  sync(tallies: Map<string, AreaTally>, words: BoardWords) {
    const signature = JSON.stringify({ words, rows: this.ids.map((id) => [id, this.area.get(id), tallies.get(this.area.get(id) || '') || null]) });
    if (signature === this.signature) return;
    this.signature = signature;
    this.paint(tallies, words);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private paint(tallies: Map<string, AreaTally>, words: BoardWords) {
    this.ids.forEach((roomId, index) => {
      const tally = tallies.get(this.area.get(roomId) || '') || { pending: 0, doing: 0, done: 0, pct: null };
      paintBoard(this.ctx, index, tally, words);
    });
    this.texture.needsUpdate = true;
  }
}

function placeBoard(room: RoomDef, objects: MapObject[]) {
  const found = objects.find((object) => object.type === 'whiteboard' && inside(room, object.x, object.y));
  if (found) {
    return {
      x: (found.x + (found.w ?? 1) / 2) * TILE,
      z: (found.y + 1.25) * TILE,
      rot: 0,
    };
  }
  return {
    x: (room.rect.x + room.rect.w / 2) * TILE,
    z: (room.rect.y + 1.35) * TILE,
    rot: 0,
  };
}

function inside(room: RoomDef, x: number, y: number) {
  const rect = room.rect;
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function paintBoard(ctx: CanvasRenderingContext2D, index: number, tally: AreaTally, words: BoardWords) {
  const x = (index % COLS) * CELL_W;
  const y = Math.floor(index / COLS) * CELL_H;
  ctx.clearRect(x, y, CELL_W, CELL_H);
  round(ctx, x + 8, y + 8, CELL_W - 16, CELL_H - 16, 28);
  ctx.fillStyle = '#F7F1E4';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#E0A800';
  ctx.stroke();
  const cols = [
    { n: tally.pending, label: words.pending, color: '#C9842A' },
    { n: tally.doing, label: words.doing, color: '#2F8FDB' },
    { n: tally.done, label: words.done, color: '#1F9D62' },
  ];
  cols.forEach((col, i) => {
    const cx = x + 36 + i * 160;
    ctx.fillStyle = col.color;
    ctx.font = '800 64px Outfit, Sora, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(String(col.n), cx, y + 36);
    ctx.font = '700 22px Outfit, Sora, sans-serif';
    ctx.fillStyle = '#3A3128';
    ctx.fillText(col.label, cx, y + 112);
  });
  const pct = tally.pct == null ? 0 : Math.max(0, Math.min(100, tally.pct));
  ctx.fillStyle = '#3A3128';
  ctx.font = '700 24px Outfit, Sora, sans-serif';
  ctx.fillText(words.mission.replace('{n}', tally.pct == null ? '—' : String(Math.round(pct))), x + 36, y + 176);
  round(ctx, x + 36, y + 220, CELL_W - 72, 22, 11);
  ctx.fillStyle = '#E6DCC8';
  ctx.fill();
  if (pct > 0) {
    round(ctx, x + 36, y + 220, Math.max(22, ((CELL_W - 72) * pct) / 100), 22, 11);
    ctx.fillStyle = '#F5C518';
    ctx.fill();
  }
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function boardMaterial(map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: { map: { value: map } },
    vertexShader: `
      attribute vec4 atlasUv;
      varying vec2 vUv;
      void main() {
        vUv = atlasUv.xy + uv * atlasUv.zw;
        #ifdef USE_INSTANCING
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        #endif
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        vec4 color = texture2D(map, vUv);
        if (color.a < 0.04) discard;
        color.rgb = pow(color.rgb, vec3(2.2));
        gl_FragColor = color;
      }
    `,
  });
}
