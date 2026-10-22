/**
 * Personajes 3D sobre el plano 2D. Si WebGL no está, el juego sigue con el canvas.
 * Los pies coinciden con el avatar 2D: la cámara mira desde arriba y el cuerpo
 * se inclina hacia la pantalla para que se vea la cara, el pelo y la ropa.
 */
import * as THREE from 'three';
import type { Camera } from './camera';
import type { Avatar } from './entities';
import type { AvatarLook, Dir } from './types';

const LEAN = -1.02;
const YAW: Record<Dir, number> = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

interface Rig {
  anchor: THREE.Group;
  bob: THREE.Group;
  turn: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  key: string;
  yaw: number;
  phase: number;
  lastT: number;
}

export class Stage3D {
  ok: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1200);
  private keyLight: THREE.DirectionalLight | null = null;
  private rigs = new Map<string, Rig>();
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;

  private constructor(ok: boolean) {
    this.ok = ok;
  }

  static mount(gameCanvas: HTMLCanvasElement): Stage3D {
    const stage = new Stage3D(false);
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      if (!renderer.getContext()) {
        renderer.dispose();
        return stage;
      }
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.14;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.id = 'stage3d';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
      gameCanvas.insertAdjacentElement('afterend', canvas);
      stage.renderer = renderer;
      stage.ok = true;
      stage.scene.add(new THREE.HemisphereLight(0xfff6df, 0x3a3224, 0.72));
      stage.scene.add(new THREE.AmbientLight(0xffffff, 0.28));
      const key = new THREE.DirectionalLight(0xfff4dd, 1.35);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.04;
      key.shadow.radius = 2.5;
      stage.scene.add(key, key.target);
      stage.keyLight = key;
      const rim = new THREE.DirectionalLight(0x9ecbff, 0.72);
      rim.position.set(-140, 90, -80);
      stage.scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffe08a, 0.28);
      fill.position.set(40, 60, 160);
      stage.scene.add(fill);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(8000, 8000),
        new THREE.ShadowMaterial({ opacity: 0.32 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.05;
      ground.receiveShadow = true;
      stage.scene.add(ground);
      stage.ok = true;
      return stage;
    } catch {
      return new Stage3D(false);
    }
  }

  render(avatars: Avatar[], cam: Camera, dpr: number, t: number, faceOf: (look: AvatarLook) => HTMLImageElement | undefined) {
    const renderer = this.renderer;
    if (!renderer) return;
    const cssW = cam.viewW;
    const cssH = cam.viewH;
    const ratio = Math.min(dpr, 1.6);
    if (cssW !== this.viewW || cssH !== this.viewH || ratio !== this.dpr) {
      this.viewW = cssW;
      this.viewH = cssH;
      this.dpr = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(cssW, cssH, false);
    }
    const worldW = cssW / cam.zoom;
    const worldH = cssH / cam.zoom;
    const cx = cam.left + worldW / 2;
    const cz = cam.top + worldH / 2;
    this.camera.left = -worldW / 2;
    this.camera.right = worldW / 2;
    this.camera.top = worldH / 2;
    this.camera.bottom = -worldH / 2;
    this.camera.position.set(cx, 520, cz);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();
    if (this.keyLight) {
      this.keyLight.position.set(cx + 90, 240, cz - 70);
      this.keyLight.target.position.set(cx, 0, cz);
      const span = Math.max(worldW, worldH) * 0.72;
      const shadow = this.keyLight.shadow.camera;
      shadow.left = -span;
      shadow.right = span;
      shadow.top = span;
      shadow.bottom = -span;
      shadow.near = 10;
      shadow.far = 700;
      shadow.updateProjectionMatrix();
    }

    const seen = new Set<string>();
    for (const avatar of avatars) {
      if (avatar.mode === 'car') continue;
      seen.add(avatar.id);
      const photo = avatar.look.usePhoto ? faceOf(avatar.look) : undefined;
      const key = signature(avatar.look, Boolean(photo));
      let rig = this.rigs.get(avatar.id);
      if (!rig || rig.key !== key) {
        if (rig) this.drop(rig);
        rig = buildRig(avatar.look, photo);
        rig.phase = Math.abs(hash(avatar.id) % 628) / 100;
        this.scene.add(rig.anchor);
        this.rigs.set(avatar.id, rig);
      }
      const dt = Math.min(0.05, Math.max(0, t - rig.lastT || 0.016));
      rig.lastT = t;
      rig.anchor.position.set(avatar.x, 0, avatar.y);
      const target = YAW[avatar.dir];
      let delta = target - rig.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      rig.yaw += delta * Math.min(1, dt * 9);
      rig.turn.rotation.y = rig.yaw;
      const cycle = t * 7.4 + rig.phase;
      const walking = avatar.moving && !avatar.sitting && avatar.pace > 0.08;
      const swing = walking ? Math.sin(cycle) * (0.55 + avatar.pace * 0.35) : Math.sin(t * 1.7 + rig.phase) * 0.05;
      if (avatar.sitting) {
        rig.legL.rotation.x = -1.25;
        rig.legR.rotation.x = -1.25;
        rig.armL.rotation.x = 0.25;
        rig.armR.rotation.x = 0.25;
        rig.bob.position.y = 1.2;
      } else {
        rig.legL.rotation.x = swing;
        rig.legR.rotation.x = -swing;
        rig.armL.rotation.x = -swing * 0.8;
        rig.armR.rotation.x = swing * 0.8;
        rig.bob.position.y = walking ? Math.abs(Math.sin(cycle)) * 1.5 : Math.sin(t * 2.1 + rig.phase) * 0.35;
      }
      const dim = avatar.status === 'ausente';
      rig.anchor.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        const list = Array.isArray(material) ? material : material ? [material] : [];
        for (const item of list) {
          if (item.userData.photo) continue;
          item.transparent = dim;
          item.opacity = dim ? 0.5 : 1;
        }
      });
    }
    for (const [id, rig] of this.rigs) {
      if (!seen.has(id)) {
        this.drop(rig);
        this.rigs.delete(id);
      }
    }
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const rig of this.rigs.values()) this.drop(rig);
    this.rigs.clear();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }

  private drop(rig: Rig) {
    rig.anchor.removeFromParent();
    const seen = new Set<THREE.Material>();
    rig.anchor.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) {
        if (seen.has(item)) continue;
        seen.add(item);
        const mapped = item as THREE.MeshBasicMaterial;
        mapped.map?.dispose();
        item.dispose();
      }
    });
  }
}

function framedPhoto(image: CanvasImageSource) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fillStyle = '#F5C518';
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, 18, 18, 220, 220);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function signature(look: AvatarLook, photo: boolean) {
  return [look.skin, look.hair, look.hairStyle, look.shirt, look.pants, look.glasses ? 1 : 0, photo ? look.photoUrl : ''].join('|');
}

function hash(value: string) {
  let n = 0;
  for (const char of value) n = (n * 33 + char.charCodeAt(0)) >>> 0;
  return n;
}

function lit(color: string, roughness = 0.46, metalness = 0.06) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  material.userData.photo = false;
  return material;
}

function buildRig(look: AvatarLook, photo?: HTMLImageElement): Rig {
  const anchor = new THREE.Group();
  const bob = new THREE.Group();
  bob.rotation.x = LEAN;
  bob.scale.setScalar(1.18);
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);

  const skin = lit(look.skin, 0.58, 0.02);
  const shirt = lit(look.shirt, 0.5, 0.08);
  const shirtDark = lit(shade(look.shirt, -0.18), 0.52, 0.05);
  const pants = lit(look.pants, 0.62, 0.04);
  const shoe = lit('#1A1A1E', 0.4, 0.2);
  const gold = lit('#F5C518', 0.32, 0.45);
  const hair = lit(look.hair, 0.4, 0.12);

  const legL = limb(pants, shoe, gold, -2.35);
  const legR = limb(pants, shoe, gold, 2.35);
  turn.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(5.1, 7.2, 6, 16), shirt);
  torso.position.y = 22.5;
  torso.castShadow = true;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.45, 8, 18), shirtDark);
  collar.position.set(0, 27.2, 1.2);
  collar.rotation.x = Math.PI / 2.4;
  const hem = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.3, 5.2), gold);
  hem.position.set(0, 16.6, 0.4);
  turn.add(torso, collar, hem);

  const armL = arm(skin, shirtDark, -6.4);
  const armR = arm(skin, shirtDark, 6.4);
  turn.add(armL, armR);

  const head = new THREE.Mesh(new THREE.SphereGeometry(6.35, 28, 22), skin);
  head.position.y = 35.4;
  head.scale.set(1, 1.06, 0.96);
  head.castShadow = true;
  turn.add(head);
  if (!photo) {
    turn.add(hairFor(look.hairStyle, hair));
    const eyeWhite = lit('#F8F4EE', 0.3, 0.02);
    const pupil = lit('#1B140F', 0.25, 0.05);
    for (const side of [-1.7, 1.7]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), eyeWhite);
      white.position.set(side, 35.7, 5.55);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), pupil);
      dot.position.set(side, 35.55, 6.35);
      turn.add(white, dot);
    }
    const brow = lit(shade(look.hair, -0.05), 0.5, 0.05);
    const leftBrow = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.3), brow);
    leftBrow.position.set(-1.7, 37.15, 5.9);
    leftBrow.rotation.z = 0.15;
    const rightBrow = leftBrow.clone();
    rightBrow.position.x = 1.7;
    rightBrow.rotation.z = -0.15;
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.16, 6, 12, Math.PI), lit('#C47A74', 0.45, 0.02));
    mouth.position.set(0, 33.35, 5.7);
    mouth.rotation.x = Math.PI;
    mouth.rotation.z = Math.PI;
    turn.add(leftBrow, rightBrow, mouth);
    if (look.glasses) {
      const frame = lit('#16161A', 0.25, 0.55);
      for (const side of [-1.75, 1.75]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.16, 8, 18), frame);
        ring.position.set(side, 35.6, 6.15);
        turn.add(ring);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.16), frame);
      bridge.position.set(0, 35.7, 6.1);
      turn.add(bridge);
    }
  } else {
    const framed = framedPhoto(photo);
    const faceMat = new THREE.SpriteMaterial({ map: framed, depthTest: false });
    faceMat.userData.photo = true;
    const face = new THREE.Sprite(faceMat);
    face.position.set(0, 35.6, 4);
    face.scale.set(14.5, 14.5, 1);
    face.renderOrder = 3;
    const badge = new THREE.Sprite(faceMat);
    badge.position.set(0, 51, 0.5);
    badge.scale.set(12, 12, 1);
    badge.renderOrder = 4;
    const cap = hairFor(look.hairStyle === 1 || look.hairStyle === 2 ? look.hairStyle : 0, hair);
    cap.scale.set(1.02, 0.42, 1.02);
    cap.position.y = 1.4;
    turn.add(cap, face, badge);
  }

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(7.2, 20),
    new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.22, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.12;
  anchor.add(blob);

  return { anchor, bob, turn, legL, legR, armL, armR, key: signature(look, Boolean(photo)), yaw: 0, phase: 0, lastT: 0 };
}

function limb(pants: THREE.Material, shoe: THREE.Material, gold: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 16.2, 0);
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(1.65, 6.4, 4, 10), pants);
  leg.position.y = -4.6;
  leg.castShadow = true;
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(1.55, 1.4, 3, 8), shoe);
  foot.position.set(0, -8.6, 0.7);
  foot.rotation.x = Math.PI / 2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.28, 1.5), gold);
  stripe.position.set(0, -8.15, 1.15);
  pivot.add(leg, foot, stripe);
  return pivot;
}

function arm(skin: THREE.Material, sleeve: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 26.4, 0);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(1.35, 4.2, 3, 8), sleeve);
  upper.position.y = -3.2;
  upper.castShadow = true;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 10), skin);
  hand.position.y = -6.3;
  pivot.add(upper, hand);
  return pivot;
}

function hairFor(style: AvatarLook['hairStyle'], material: THREE.Material) {
  const group = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(6.55, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), material);
  cap.position.y = 37.1;
  cap.castShadow = true;
  group.add(cap);
  if (style === 1) {
    const lock = new THREE.Mesh(new THREE.CapsuleGeometry(1.7, 8, 3, 8), material);
    lock.position.set(-5.4, 30.5, -0.4);
    lock.rotation.z = 0.25;
    const other = lock.clone();
    other.position.x = 5.4;
    other.rotation.z = -0.25;
    group.add(lock, other);
  } else if (style === 2) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12), material);
    bun.position.set(0, 42.6, -1.2);
    group.add(bun);
  } else if (style === 3) {
    cap.scale.set(1, 0.55, 1);
  }
  return group;
}

function shade(hex: string, amount: number) {
  const color = new THREE.Color(hex);
  const target = amount < 0 ? new THREE.Color('#000000') : new THREE.Color('#ffffff');
  return `#${color.lerp(target, Math.min(1, Math.abs(amount))).getHexString()}`;
}
