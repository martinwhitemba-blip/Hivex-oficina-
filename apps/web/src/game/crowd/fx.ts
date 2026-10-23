import * as THREE from 'three';

const ATLAS = 2048;
const PAD = 4;

interface Slot { u: number; v: number; w: number; h: number; pxW: number; pxH: number }

interface BubbleSpot { text: string; x: number; y: number; z: number }

/**
 * Gestos y bocadillos: tres llamadas de dibujo como mucho
 * (corazones, confeti y un atlas de burbujas), y cero si nadie gesticula.
 */
export class OfficeFx {
  readonly hearts: THREE.InstancedMesh;
  readonly confetti: THREE.InstancedMesh;
  readonly bubbles: THREE.InstancedMesh;
  private heartDummy = new THREE.Object3D();
  private bitDummy = new THREE.Object3D();
  private color = new THREE.Color();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private uv: THREE.InstancedBufferAttribute;
  private bubbleDummy = new THREE.Object3D();
  private ndc = new THREE.Vector3();
  private world = new THREE.Vector3();
  private cursorX = PAD;
  private cursorY = PAD;
  private rowH = 0;
  private slots = new Map<string, Slot>();

  constructor() {
    this.hearts = batch(heartGeometry(), new THREE.MeshBasicMaterial({
      color: '#ff4d6d', transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }), 48);
    this.hearts.renderOrder = 8;
    const bits = new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.confetti = batch(new THREE.PlaneGeometry(1, 1.4), bits, 96);
    this.confetti.renderOrder = 8;

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
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(40 * 4), 4);
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
    this.bubbles = new THREE.InstancedMesh(geo, material, 40);
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 13;
    this.bubbles.count = 0;
    this.bubbles.raycast = () => {};
  }

  sync(input: {
    hearts: { id: string; x: number; y: number; z: number; life: number }[];
    confetti: { id: string; x: number; y: number; z: number; life: number }[];
    bubbles: BubbleSpot[];
    camera: THREE.Camera;
    viewH: number;
    fovDeg: number;
  }) {
    let heart = 0;
    for (const item of input.hearts) {
      if (heart >= 48) break;
      const rise = item.life * 34;
      const spread = Math.sin(item.life * Math.PI);
      for (let n = 0; n < 5 && heart < 48; n++) {
        const angle = hash(item.id, n) * Math.PI * 2;
        this.heartDummy.position.set(
          item.x + Math.cos(angle) * spread * 14,
          item.y + rise + n * 3,
          item.z + Math.sin(angle) * spread * 10,
        );
        this.heartDummy.quaternion.copy(input.camera.quaternion);
        const size = 8 * (1 - item.life * 0.35);
        this.heartDummy.scale.set(size, size, 1);
        this.heartDummy.updateMatrix();
        this.hearts.setMatrixAt(heart, this.heartDummy.matrix);
        heart += 1;
      }
    }
    this.hearts.count = heart;
    this.hearts.instanceMatrix.needsUpdate = true;

    const palette = ['#F5C518', '#FF5A7A', '#3DDC97', '#7AA2FF', '#FFFFFF'];
    let bit = 0;
    for (const item of input.confetti) {
      if (bit >= 96) break;
      for (let n = 0; n < 8 && bit < 96; n++) {
        const spin = hash(item.id, n + 3);
        const angle = spin * Math.PI * 2;
        const fly = item.life * 26;
        this.bitDummy.position.set(
          item.x + Math.cos(angle) * fly,
          item.y + Math.sin(item.life * Math.PI) * 18 + n * 1.5,
          item.z + Math.sin(angle) * fly * 0.6,
        );
        this.bitDummy.quaternion.copy(input.camera.quaternion);
        this.bitDummy.rotateZ(spin * 6 + item.life * 4);
        const size = 3.2 + (n % 3);
        this.bitDummy.scale.set(size, size * 1.3, 1);
        this.bitDummy.updateMatrix();
        this.confetti.setMatrixAt(bit, this.bitDummy.matrix);
        this.confetti.setColorAt(bit, this.color.set(palette[n % palette.length]));
        bit += 1;
      }
    }
    this.confetti.count = bit;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;

    this.syncBubbles(input.bubbles, input.camera, input.viewH, input.fovDeg);
  }

  dispose() {
    for (const mesh of [this.hearts, this.confetti, this.bubbles]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const material = mesh.material as THREE.Material;
      if (!material.userData.shared) material.dispose();
    }
    this.texture.dispose();
  }

  private syncBubbles(bubbles: BubbleSpot[], camera: THREE.Camera, viewH: number, fovDeg: number) {
    const count = Math.min(bubbles.length, 40);
    camera.updateMatrixWorld();
    for (let i = 0; i < count; i++) {
      const item = bubbles[i];
      const slot = this.slot(clip(item.text));
      this.ndc.set(item.x, item.y, item.z).project(camera);
      const dist = camera.position.distanceTo(this.world.set(item.x, item.y, item.z));
      const worldPerPx = (2 * Math.tan((fovDeg * Math.PI) / 360) * dist) / Math.max(1, viewH);
      this.bubbleDummy.position.set(item.x, item.y, item.z);
      this.bubbleDummy.quaternion.copy(camera.quaternion);
      this.bubbleDummy.scale.set(slot.pxW * worldPerPx, slot.pxH * worldPerPx, 1);
      this.bubbleDummy.updateMatrix();
      this.bubbles.setMatrixAt(i, this.bubbleDummy.matrix);
      this.uv.setXYZW(i, slot.u, slot.v, slot.w, slot.h);
    }
    this.bubbles.count = count;
    this.bubbles.instanceMatrix.needsUpdate = true;
    this.uv.needsUpdate = true;
  }

  private slot(text: string) {
    const cached = this.slots.get(text);
    if (cached) return cached;
    const painted = paintBubble(text);
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
    this.slots.set(text, slot);
    this.texture.needsUpdate = true;
    return slot;
  }
}

function batch(geo: THREE.BufferGeometry, material: THREE.Material, max: number) {
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.raycast = () => {};
  return mesh;
}

function heartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.25);
  shape.bezierCurveTo(0, 0.55, -0.55, 0.55, -0.55, 0.12);
  shape.bezierCurveTo(-0.55, -0.28, 0, -0.42, 0, -0.72);
  shape.bezierCurveTo(0, -0.42, 0.55, -0.28, 0.55, 0.12);
  shape.bezierCurveTo(0.55, 0.55, 0, 0.55, 0, 0.25);
  return new THREE.ShapeGeometry(shape);
}

function hash(id: string, salt: number) {
  let n = salt * 17 + 3;
  for (let i = 0; i < id.length; i++) n = (n * 33 + id.charCodeAt(i)) % 997;
  return (n % 997) / 997;
}

function clip(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 72) return clean;
  return `${clean.slice(0, 71)}…`;
}

function paintBubble(text: string) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 26px Outfit, Sora, sans-serif';
  const lines = wrap(ctx, text, 260);
  const widest = Math.max(80, ...lines.map((line) => ctx.measureText(line).width));
  const w = Math.ceil(widest + 36);
  const h = lines.length * 32 + 36;
  canvas.width = w * 2;
  canvas.height = h * 2;
  ctx.scale(2, 2);
  ctx.font = '600 26px Outfit, Sora, sans-serif';
  round(ctx, 2, 2, w - 4, h - 16, 16);
  ctx.fillStyle = 'rgba(255,250,240,0.96)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#F5C518';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - 8, h - 16);
  ctx.lineTo(w / 2, h - 2);
  ctx.lineTo(w / 2 + 8, h - 16);
  ctx.closePath();
  ctx.fillStyle = '#F5C518';
  ctx.fill();
  ctx.fillStyle = '#1A1420';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => ctx.fillText(line, 18, 20 + index * 32));
  return { canvas, pxW: w / 2, pxH: h / 2 };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
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
