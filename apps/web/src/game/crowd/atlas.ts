import * as THREE from 'three';

const ATLAS = 2048;
const PAD = 4;

interface Slot { u: number; v: number; w: number; h: number; pxW: number; pxH: number }

/**
 * Etiquetas de nombre en una sola textura y un InstancedMesh.
 * Una llamada de dibujo para toda la multitud.
 */
export class NameBatch {
  readonly mesh: THREE.InstancedMesh;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private cursorX = PAD;
  private cursorY = PAD;
  private rowH = 0;
  private slots = new Map<string, Slot>();
  private uv: THREE.InstancedBufferAttribute;
  private dummy = new THREE.Object3D();
  private ndc = new THREE.Vector3();
  private world = new THREE.Vector3();
  private capacity: number;

  constructor(capacity = 180) {
    this.capacity = capacity;
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
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    geo.setAttribute('atlasUv', this.uv);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      uniforms: { map: { value: this.texture } },
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
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.count = 0;
    this.mesh.raycast = () => {};
  }

  sync(
    labels: { text: string; tone: string; self: boolean; x: number; y: number; z: number }[],
    camera: THREE.Camera,
    viewW: number,
    viewH: number,
    fovDeg: number,
  ) {
    const count = Math.min(labels.length, this.capacity);
    const items: { slot: Slot; x: number; y: number; z: number; sx: number; sy: number }[] = [];
    const ndc = this.ndc;
    for (let i = 0; i < count; i++) {
      const label = labels[i];
      const slot = this.slot(label.text, label.tone, label.self);
      ndc.set(label.x, label.y, label.z).project(camera);
      if (ndc.z > 1) continue;
      items.push({
        slot,
        x: label.x,
        y: label.y,
        z: label.z,
        sx: (ndc.x * 0.5 + 0.5) * viewW,
        sy: (-ndc.y * 0.5 + 0.5) * viewH,
      });
    }
    items.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    camera.updateMatrixWorld();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let sy = item.sy;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((box) => Math.abs(box.x - item.sx) < (box.w + item.slot.pxW) / 2 && Math.abs(box.y - sy) < (box.h + item.slot.pxH) / 2 + 2);
        if (!hit) break;
        sy = hit.y - (hit.h + item.slot.pxH) / 2 - 3;
      }
      placed.push({ x: item.sx, y: sy, w: item.slot.pxW, h: item.slot.pxH });
      ndc.set(item.x, item.y, item.z).project(camera);
      const ndcX = (item.sx / viewW) * 2 - 1;
      const ndcY = 1 - (sy / viewH) * 2;
      const world = this.world.set(ndcX, ndcY, ndc.z).unproject(camera);
      const dist = camera.position.distanceTo(world);
      const worldPerPx = (2 * Math.tan((fovDeg * Math.PI) / 360) * dist) / Math.max(1, viewH);
      this.dummy.position.copy(world);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.set(item.slot.pxW * worldPerPx, item.slot.pxH * worldPerPx, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.uv.setXYZW(i, item.slot.u, item.slot.v, item.slot.w, item.slot.h);
    }
    this.mesh.count = items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uv.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }

  private slot(text: string, tone: string, self: boolean) {
    const key = `${text}|${tone}|${self ? 1 : 0}`;
    const cached = this.slots.get(key);
    if (cached) return cached;
    const painted = paintLabel(text, tone, self);
    if (this.cursorX + painted.canvas.width + PAD > ATLAS) {
      this.cursorX = PAD;
      this.cursorY += this.rowH + PAD;
      this.rowH = 0;
    }
    if (this.cursorY + painted.canvas.height + PAD > ATLAS) {
      this.ctx.clearRect(0, 0, ATLAS, ATLAS);
      this.slots.clear();
      this.cursorX = PAD;
      this.cursorY = PAD;
      this.rowH = 0;
    }
    this.ctx.drawImage(painted.canvas, this.cursorX, this.cursorY);
    const slot: Slot = {
      u: this.cursorX / ATLAS,
      v: 1 - (this.cursorY + painted.canvas.height) / ATLAS,
      w: painted.canvas.width / ATLAS,
      h: painted.canvas.height / ATLAS,
      pxW: painted.pxW,
      pxH: painted.pxH,
    };
    this.cursorX += painted.canvas.width + PAD;
    this.rowH = Math.max(this.rowH, painted.canvas.height);
    this.slots.set(key, slot);
    this.texture.needsUpdate = true;
    return slot;
  }
}

function paintLabel(text: string, tone: string, self: boolean) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px Outfit, Sora, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width + 56);
  const h = 44;
  canvas.width = w * 2;
  canvas.height = h * 2;
  ctx.scale(2, 2);
  ctx.font = '600 28px Outfit, Sora, sans-serif';
  roundRect(ctx, 1, 1, w - 2, h - 2, 12);
  ctx.fillStyle = self ? 'rgba(12,12,14,0.94)' : 'rgba(20,20,22,0.86)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = self ? '#F5C518' : 'rgba(255,255,255,0.14)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, h / 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = tone;
  ctx.fill();
  ctx.fillStyle = self ? '#F7DC6F' : '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 30, h / 2 + 1);
  return { canvas, pxW: w / 2, pxH: h / 2 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
