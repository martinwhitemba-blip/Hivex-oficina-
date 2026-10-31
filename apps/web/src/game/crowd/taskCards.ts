import * as THREE from 'three';
import type { DutyCard } from './taskState';

const ATLAS = 2048;
const CELL_W = 192;
const CELL_H = 84;
const COLS = Math.floor(ATLAS / CELL_W);
const CAP = COLS * Math.floor(ATLAS / CELL_H);

/** Una sola llamada de dibujo para la carta de tarea de cada avatar. */
export class TaskCards {
  readonly mesh: THREE.InstancedMesh;
  taskOf: string[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private uv: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private world = new THREE.Vector3();
  private index = new Map<string, number>();
  private signature = new Map<string, string>();
  private next = 0;

  constructor() {
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
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    geo.setAttribute('atlasUv', this.uv);
    this.mesh = new THREE.InstancedMesh(geo, atlasMaterial(this.texture), CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.count = 0;
  }

  sync(cards: (DutyCard & { x: number; y: number; z: number })[], camera: THREE.Camera, viewH: number, fovDeg: number) {
    const shown = cards.slice(0, CAP);
    this.taskOf = shown.map((card) => card.taskId);
    camera.updateMatrixWorld();
    shown.forEach((card, i) => {
      const cell = this.cell(card);
      const dist = camera.position.distanceTo(this.world.set(card.x, card.y, card.z));
      const worldPerPx = (2 * Math.tan((fovDeg * Math.PI) / 360) * dist) / Math.max(1, viewH);
      this.dummy.position.set(card.x, card.y, card.z);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.set(CELL_W * 0.42 * worldPerPx, CELL_H * 0.42 * worldPerPx, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const col = cell % COLS;
      const row = Math.floor(cell / COLS);
      this.uv.setXYZW(i, (col * CELL_W) / ATLAS, 1 - ((row + 1) * CELL_H) / ATLAS, CELL_W / ATLAS, CELL_H / ATLAS);
    });
    this.mesh.count = shown.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uv.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private cell(card: DutyCard) {
    let cell = this.index.get(card.avatarId);
    if (cell == null) {
      cell = this.next % CAP;
      this.next += 1;
      this.index.set(card.avatarId, cell);
    }
    const signature = `${card.title}|${card.time}|${card.overdue ? 1 : 0}|${card.done}|${card.total}`;
    if (this.signature.get(card.avatarId) !== signature) {
      this.signature.set(card.avatarId, signature);
      paintCard(this.ctx, cell, card);
      this.texture.needsUpdate = true;
    }
    return cell;
  }
}

function paintCard(ctx: CanvasRenderingContext2D, cell: number, card: DutyCard) {
  const x = (cell % COLS) * CELL_W;
  const y = Math.floor(cell / COLS) * CELL_H;
  ctx.clearRect(x, y, CELL_W, CELL_H);
  const late = card.overdue;
  round(ctx, x + 4, y + 4, CELL_W - 8, CELL_H - 8, 14);
  ctx.fillStyle = late ? '#3A1420' : 'rgba(18,16,22,0.92)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = late ? '#FF4D6A' : '#F5C518';
  ctx.stroke();
  ctx.fillStyle = late ? '#FFD0D8' : '#FFF8E8';
  ctx.font = '700 22px Outfit, Sora, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(trim(ctx, card.title || '…', CELL_W - 78), x + 14, y + 12);
  ctx.fillStyle = late ? '#FF8FA3' : '#F5C518';
  ctx.font = '700 18px Outfit, Sora, sans-serif';
  ctx.fillText(card.time, x + CELL_W - 62, y + 14);
  if (card.total > 0) {
    const barX = x + 14;
    const barY = y + 50;
    const barW = CELL_W - 28;
    round(ctx, barX, barY, barW, 10, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fill();
    const filled = Math.max(0, Math.min(1, card.done / card.total)) * barW;
    if (filled > 0) {
      round(ctx, barX, barY, Math.max(10, filled), 10, 5);
      ctx.fillStyle = late ? '#FF4D6A' : '#3DDC97';
      ctx.fill();
    }
  }
}

function trim(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function atlasMaterial(map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
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
