import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarLook, Dir } from './types';
import type { Expression } from './crowd/look';
import { photoSpot } from './crowd/look';
import { fadedMaterial, outlineMaterial, shadeColor, shadowProxyMaterial, sharedBasic, sharedGeo, sharedStandard, sharedToon } from './crowd/materials';

const YAW: Record<Dir, number> = { down: Math.PI, up: 0, right: Math.PI / 2, left: -Math.PI / 2 };

export interface Rig {
  anchor: THREE.Group;
  bob: THREE.Group;
  turn: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  shadow: THREE.Mesh | null;
  face: THREE.Mesh | null;
  key: string;
  yaw: number;
  phase: number;
  lastT: number;
  dim: boolean;
  kind: 'full' | 'mid' | 'car';
  owned: THREE.Texture[];
  skin: string;
  glasses: boolean;
  expression: Expression;
  /** La foto tapa la cara: el gesto no puede cambiarla. */
  photoFace: boolean;
}

export interface PoseInput {
  dir: Dir;
  moving: boolean;
  sitting: boolean;
  pace: number;
  mode: 'walk' | 'car';
  carAngle: number;
  emote?: { id: string; until: number } | null;
}

const faceTextures = new Map<string, THREE.CanvasTexture>();

export function lookKey(mode: string, look: AvatarLook, photo: boolean) {
  const spot = photo ? photoSpot(look.photoPlacement) : '';
  return [mode, look.skin, look.hair, look.hairStyle, look.shirt, look.pants, look.glasses ? 1 : 0, spot, photo ? look.photoUrl ?? '' : ''].join('|');
}

export function buildFull(look: AvatarLook, photo: HTMLImageElement | undefined, id: string): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const skin = sharedToon(look.skin);
  const shirt = sharedToon(look.shirt);
  const pants = sharedToon(look.pants);
  const shoe = sharedToon('#1A1A1E');
  const hairMat = sharedToon(look.hair);
  const sleeve = sharedToon(shadeColor(look.shirt, -0.18));

  const hip = new THREE.Group();
  hip.position.y = 22;
  turn.add(hip);
  const torso = new THREE.Mesh(sharedGeo('chibi-torso', () => {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    geo.scale(14, 11, 12);
    return geo;
  }), shirt);
  torso.position.y = 10;
  torso.receiveShadow = true;
  hip.add(torso);

  const legsL = limbLeg(pants, shoe, -6.2);
  const legsR = limbLeg(pants, shoe, 6.2);
  hip.add(legsL.pivot, legsR.pivot);
  const armsL = limbArm(skin, sleeve, -12.5);
  const armsR = limbArm(skin, sleeve, 12.5);
  armsL.pivot.position.y = 14;
  armsR.pivot.position.y = 14;
  hip.add(armsL.pivot, armsR.pivot);

  const head = new THREE.Mesh(sharedGeo('chibi-head', () => new THREE.SphereGeometry(13, 14, 12)), skin);
  head.position.y = 52;
  head.receiveShadow = true;
  turn.add(head);
  const hair = new THREE.Mesh(hairGeometry(look.hairStyle), hairMat);
  hair.position.y = 56;
  turn.add(hair);

  const shell = new THREE.Mesh(outlineGeometry(), outlineMaterial());
  shell.raycast = () => {};
  turn.add(shell);

  const owned: THREE.Texture[] = [];
  const spot = photo ? photoSpot(look.photoPlacement) : 'cara';
  const photoFace = Boolean(photo) && spot === 'cara';
  let face: THREE.Mesh;
  if (photo && photoFace) {
    const framed = framedPhoto(photo, 'circle');
    owned.push(framed);
    face = new THREE.Mesh(sharedGeo('chibi-face', () => new THREE.CircleGeometry(8.2, 18)), new THREE.MeshBasicMaterial({ map: framed, toneMapped: false }));
    face.userData.photo = true;
  } else {
    const tex = faceTexture(look.skin, Boolean(look.glasses), 'neutral');
    face = new THREE.Mesh(
      sharedGeo('chibi-face', () => new THREE.CircleGeometry(8.2, 18)),
      sharedBasic(`face|${look.skin}|${look.glasses ? 1 : 0}|neutral`, '#ffffff', tex),
    );
  }
  face.position.set(0, 51, 12.2);
  face.userData.avatarId = id;
  turn.add(face);

  if (photo && spot === 'gafete') {
    const framed = framedPhoto(photo, 'card');
    owned.push(framed);
    const badgeMat = new THREE.SpriteMaterial({ map: framed, transparent: true, depthTest: true });
    badgeMat.userData.keep = true;
    const badge = new THREE.Sprite(badgeMat);
    badge.position.set(0, 34, 13);
    badge.scale.set(11, 14, 1);
    badge.renderOrder = 4;
    turn.add(badge);
  }

  const shadow = new THREE.Mesh(sharedGeo('shadow-proxy', () => new THREE.CapsuleGeometry(7, 22, 1, 5)), shadowProxyMaterial());
  shadow.position.y = 26;
  shadow.layers.set(1);
  shadow.castShadow = false;
  shadow.visible = false;
  anchor.add(shadow);

  return {
    anchor, bob, turn,
    legL: legsL.pivot, legR: legsR.pivot, kneeL: legsL.knee, kneeR: legsR.knee,
    armL: armsL.pivot, armR: armsR.pivot,
    shadow, face, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'full', owned,
    skin: look.skin, glasses: Boolean(look.glasses), expression: 'neutral', photoFace,
  };
}

export function buildMid(look: AvatarLook, id: string): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const body = new THREE.Mesh(sharedGeo('mid-body', () => {
    const geo = new THREE.CapsuleGeometry(7, 12, 2, 6);
    geo.translate(0, 30, 0);
    return geo;
  }), sharedToon(look.shirt));
  const head = new THREE.Mesh(sharedGeo('mid-head', () => {
    const geo = new THREE.SphereGeometry(10, 8, 6);
    geo.translate(0, 50, 0);
    return geo;
  }), sharedToon(look.skin));
  const legs = new THREE.Mesh(sharedGeo('mid-legs', () => {
    const geo = new THREE.CapsuleGeometry(6, 8, 1, 5);
    geo.translate(0, 14, 0);
    return geo;
  }), sharedToon(look.pants));
  const legPivot = new THREE.Group();
  legPivot.add(legs);
  turn.add(body, head, legPivot);
  const empty = new THREE.Group();
  return {
    anchor, bob, turn,
    legL: empty, legR: legPivot, kneeL: empty, kneeR: empty, armL: empty, armR: empty,
    shadow: null, face: null, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'mid', owned: [],
    skin: look.skin, glasses: false, expression: 'neutral', photoFace: false,
  };
}

export function buildCar(id: string): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const body = new THREE.Mesh(sharedGeo('car-body', () => new THREE.BoxGeometry(22, 10, 40)), sharedStandard('#E0A800', 0.45));
  body.position.y = 12;
  const cabin = new THREE.Mesh(sharedGeo('car-cabin', () => new THREE.BoxGeometry(18, 8, 18)), sharedStandard('#1B1E27', 0.4));
  cabin.position.set(0, 20, -2);
  turn.add(body, cabin);
  const wheelGeo = sharedGeo('car-wheel', () => new THREE.CylinderGeometry(4, 4, 3, 8));
  const wheelMat = sharedStandard('#1A1A1E', 0.4);
  for (const x of [-10, 10]) {
    for (const z of [-12, 12]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 4, z);
      turn.add(wheel);
    }
  }
  const empty = new THREE.Group();
  return {
    anchor, bob, turn, legL: empty, legR: empty, kneeL: empty, kneeR: empty, armL: empty, armR: empty,
    shadow: null, face: null, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'car', owned: [],
    skin: '', glasses: false, expression: 'neutral', photoFace: false,
  };
}

export function setExpression(rig: Rig, expression: Expression) {
  if (!rig.face || rig.photoFace || rig.expression === expression) return;
  rig.expression = expression;
  const tex = faceTexture(rig.skin, rig.glasses, expression);
  rig.face.material = sharedBasic(`face|${rig.skin}|${rig.glasses ? 1 : 0}|${expression}`, '#ffffff', tex);
}

export function poseRig(rig: Rig, avatar: PoseInput, t: number) {
  const dt = Math.min(0.05, Math.max(0, t - (rig.lastT || t)));
  rig.lastT = t;
  if (rig.kind === 'car') {
    rig.turn.rotation.y = avatar.carAngle - Math.PI / 2;
    rig.bob.position.y = 0;
    return;
  }
  const target = YAW[avatar.dir] ?? 0;
  let delta = target - rig.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  rig.yaw += delta * Math.min(1, dt * 10);
  rig.turn.rotation.y = rig.yaw;
  const cycle = t * 11 + rig.phase;
  const walking = avatar.moving && !avatar.sitting && avatar.pace > 0.08;
  const swing = Math.sin(cycle);
  const emote = liveEmote(avatar);
  if (rig.kind === 'mid') {
    rig.legR.rotation.x = avatar.sitting ? -1.15 : swing * (walking ? 0.45 : 0.04);
    rig.bob.position.y = avatar.sitting ? -6 : walking ? Math.abs(swing) * 1.4 : Math.sin(t * 2.2 + rig.phase) * 0.35;
    if (emote) rig.bob.position.y += Math.sin(t * 12) * 1.1;
    return;
  }
  if (avatar.sitting) {
    rig.legL.rotation.x = -1.45;
    rig.legR.rotation.x = -1.45;
    rig.kneeL.rotation.x = 1.55;
    rig.kneeR.rotation.x = 1.55;
    rig.bob.position.y = -6;
    rig.bob.rotation.x = 0.16;
    rig.bob.rotation.z = 0;
    if (!poseEmote(rig, emote, t, true)) restArms(rig, 0.85, 0.28);
    return;
  }
  const amp = walking ? 0.95 : 0.05;
  rig.legL.rotation.x = swing * amp;
  rig.legR.rotation.x = -swing * amp;
  rig.kneeL.rotation.x = Math.max(0, -swing) * (walking ? 1.25 : 0);
  rig.kneeR.rotation.x = Math.max(0, swing) * (walking ? 1.25 : 0);
  rig.bob.position.y = walking ? Math.abs(swing) * 2.2 : Math.sin(t * 2.2 + rig.phase) * 0.45;
  rig.bob.rotation.x = walking ? 0.1 : 0;
  rig.bob.rotation.z = walking ? swing * 0.04 : 0;
  if (!poseEmote(rig, emote, t, false)) {
    rig.armL.rotation.x = -swing * amp * 0.75;
    rig.armR.rotation.x = swing * amp * 0.75;
    rig.armL.rotation.y = 0;
    rig.armR.rotation.y = 0;
    rig.armL.rotation.z = 0;
    rig.armR.rotation.z = 0;
  }
}

export function setDim(rig: Rig, dim: boolean) {
  if (rig.dim === dim) return;
  rig.dim = dim;
  rig.anchor.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(obj as THREE.Sprite).isSprite) return;
    const current = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!current || Array.isArray(current)) return;
    if (current.userData.keep) {
      if (!current.userData.shared) {
        current.transparent = true;
        current.opacity = dim ? 0.48 : 1;
      }
      return;
    }
    const base = (mesh.userData.baseMaterial as THREE.Material | undefined) ?? current;
    mesh.userData.baseMaterial = base;
    if (!base.userData.shared) {
      base.transparent = dim;
      base.opacity = dim ? 0.48 : 1;
      base.depthWrite = !dim;
      mesh.material = base;
      return;
    }
    mesh.material = dim ? fadedMaterial(base, 0.48) : base;
  });
}

export function setShadow(rig: Rig, on: boolean) {
  if (!rig.shadow) return;
  rig.shadow.visible = on;
  rig.shadow.castShadow = on;
}

export function disposeRig(rig: Rig) {
  rig.anchor.removeFromParent();
  const owned = new Set(rig.owned);
  rig.anchor.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh && !(obj as THREE.Sprite).isSprite) return;
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of list) {
      if (material.userData.shared) continue;
      const mapped = material as THREE.MeshBasicMaterial;
      if (mapped.map && !mapped.map.userData.shared && !owned.has(mapped.map)) mapped.map.dispose();
      material.dispose();
    }
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
  });
  for (const texture of owned) texture.dispose();
  rig.owned = [];
}

function liveEmote(avatar: PoseInput) {
  if (!avatar.emote || avatar.emote.until <= performance.now()) return '';
  return avatar.emote.id;
}

function restArms(rig: Rig, x: number, z: number) {
  rig.armL.rotation.set(x, 0, z);
  rig.armR.rotation.set(x, 0, -z);
}

function poseEmote(rig: Rig, emote: string, t: number, sitting: boolean) {
  const name = emote.toLowerCase();
  const wave = name.includes('wave') || name.includes('👋');
  const clap = name.includes('clap') || name.includes('👏');
  const high = name.includes('high') || name.includes('🙌') || name.includes('choca');
  if (!wave && !clap && !high) return false;
  if (wave) {
    const flap = Math.sin(t * 14);
    rig.armR.rotation.set(-0.35, 0, -2.15 + flap * 0.42);
    rig.armL.rotation.set(sitting ? 0.7 : 0.12, 0, sitting ? 0.2 : 0.05);
    return true;
  }
  if (clap) {
    const hit = Math.abs(Math.sin(t * 11));
    rig.armL.rotation.set(-1.2, 0.25, 0.62 - hit * 0.5);
    rig.armR.rotation.set(-1.2, -0.25, -0.62 + hit * 0.5);
    return true;
  }
  const pulse = Math.sin(t * 8) * 0.06;
  rig.armR.rotation.set(-0.85, 0, -1.65 + pulse);
  rig.armL.rotation.set(sitting ? 0.7 : 0.1, 0, sitting ? 0.18 : 0.04);
  return true;
}

function limbLeg(pants: THREE.Material, shoe: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const thigh = new THREE.Mesh(sharedGeo('chibi-thigh', () => new THREE.CapsuleGeometry(3.5, 4, 1, 6)), pants);
  thigh.position.y = -4.5;
  const knee = new THREE.Group();
  knee.position.y = -8.5;
  const shin = new THREE.Mesh(sharedGeo('chibi-shin', () => new THREE.CapsuleGeometry(3, 4, 1, 6)), pants);
  shin.position.y = -4.5;
  const foot = new THREE.Mesh(sharedGeo('chibi-foot', () => new THREE.CapsuleGeometry(2.2, 2.6, 1, 5)), shoe);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(0, -8, 1.6);
  knee.add(shin, foot);
  pivot.add(thigh, knee);
  return { pivot, knee };
}

function limbArm(skin: THREE.Material, sleeve: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const upper = new THREE.Mesh(sharedGeo('chibi-arm', () => new THREE.CapsuleGeometry(2.6, 4, 1, 6)), sleeve);
  upper.position.y = -4.5;
  const hand = new THREE.Mesh(sharedGeo('chibi-hand', () => new THREE.SphereGeometry(2.5, 8, 6)), skin);
  hand.position.y = -9.2;
  pivot.add(upper, hand);
  return { pivot };
}

function hairGeometry(style: AvatarLook['hairStyle']) {
  return sharedGeo(`chibi-hair-${style}`, () => {
    const cap = new THREE.SphereGeometry(13.5, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.46);
    cap.translate(0, 2.2, 0);
    if (style === 3) cap.scale(1, 0.42, 1);
    else if (style === 2) cap.scale(1.02, 1.16, 1.02);
    else if (style === 1) cap.scale(1.08, 1.2, 1.04);
    return cap;
  });
}

function outlineGeometry() {
  return sharedGeo('chibi-outline', () => {
    const head = new THREE.SphereGeometry(13 * 1.075, 12, 10);
    head.translate(0, 52, 0);
    const torso = new THREE.SphereGeometry(1, 10, 8);
    torso.scale(14 * 1.09, 11 * 1.09, 12 * 1.09);
    torso.translate(0, 32, 0);
    const merged = mergeGeometries([head, torso], false);
    if (!merged) {
      torso.dispose();
      return head;
    }
    head.dispose();
    torso.dispose();
    return merged;
  });
}

function faceTexture(skin: string, glasses: boolean, expression: Expression) {
  const key = `${skin}|${glasses ? 1 : 0}|${expression}`;
  const cached = faceTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  paintFace(ctx, expression);
  if (glasses) paintGlasses(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.shared = true;
  faceTextures.set(key, texture);
  return texture;
}

function paintFace(ctx: CanvasRenderingContext2D, expression: Expression) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const blush = expression === 'happy' || expression === 'wink';
  if (blush) {
    ctx.fillStyle = 'rgba(232, 112, 122, 0.55)';
    ctx.beginPath();
    ctx.ellipse(68, 168, 22, 12, 0, 0, Math.PI * 2);
    ctx.ellipse(188, 168, 22, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#3A2418';
  ctx.fillStyle = '#3A2418';
  ctx.lineWidth = 7;
  if (expression === 'surprised') {
    brow(ctx, 78, 78, 108, 64);
    brow(ctx, 178, 64, 148, 78);
  } else if (expression === 'happy' || expression === 'wink') {
    brow(ctx, 72, 86, 112, 72);
    brow(ctx, 184, 72, 144, 86);
  } else {
    brow(ctx, 70, 84, 112, 78);
    brow(ctx, 186, 78, 144, 84);
  }
  if (expression === 'happy') {
    eyeArc(ctx, 86, 118, 22, true);
    eyeArc(ctx, 170, 118, 22, true);
  } else if (expression === 'wink') {
    eyeOpen(ctx, 86, 118);
    eyeArc(ctx, 170, 120, 20, true);
  } else if (expression === 'surprised') {
    eyeOpen(ctx, 86, 116, 16);
    eyeOpen(ctx, 170, 116, 16);
  } else {
    eyeOpen(ctx, 86, 118, 13);
    eyeOpen(ctx, 170, 118, 13);
  }
  ctx.strokeStyle = '#C46A6A';
  ctx.fillStyle = '#E88984';
  ctx.lineWidth = 6;
  if (expression === 'surprised') {
    ctx.beginPath();
    ctx.ellipse(128, 176, 12, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (expression === 'happy' || expression === 'wink') {
    ctx.beginPath();
    ctx.arc(128, 158, 28, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#E88984';
    ctx.beginPath();
    ctx.ellipse(128, 182, 14, 8, 0, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(128, 168, 18, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
  }
}

function brow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 10, x1, y1);
  ctx.stroke();
}

function eyeOpen(ctx: CanvasRenderingContext2D, x: number, y: number, r = 13) {
  ctx.fillStyle = '#F7F1EA';
  ctx.beginPath();
  ctx.ellipse(x, y, r + 4, r + 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2A1A12';
  ctx.beginPath();
  ctx.arc(x + 1, y + 1, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(x + 4, y - 3, 3.2, 0, Math.PI * 2);
  ctx.fill();
}

function eyeArc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, smile: boolean) {
  ctx.strokeStyle = '#3A2418';
  ctx.lineWidth = 7;
  ctx.beginPath();
  if (smile) ctx.arc(x, y + 6, r, 1.15 * Math.PI, 1.85 * Math.PI);
  else ctx.arc(x, y, r, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function paintGlasses(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#16161A';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(52, 96, 64, 46, 16);
  ctx.roundRect(140, 96, 64, 46, 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(116, 118);
  ctx.lineTo(140, 118);
  ctx.moveTo(52, 114);
  ctx.lineTo(36, 108);
  ctx.moveTo(204, 114);
  ctx.lineTo(220, 108);
  ctx.stroke();
}

function framedPhoto(image: CanvasImageSource, shape: 'circle' | 'card') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = shape === 'card' ? 320 : 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (shape === 'card') {
    roundRect(ctx, 28, 16, 200, 288, 28);
    ctx.fillStyle = '#F4EFE4';
    ctx.fill();
    ctx.strokeStyle = '#C4920A';
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, 52, 40, 152, 152, 18);
    ctx.clip();
    ctx.drawImage(image, 52, 40, 152, 152);
    ctx.restore();
    ctx.fillStyle = '#F5C518';
    roundRect(ctx, 64, 214, 128, 18, 8);
    ctx.fill();
    ctx.fillStyle = '#C4920A';
    roundRect(ctx, 78, 246, 100, 12, 6);
    ctx.fill();
  } else {
    ctx.fillStyle = '#C4920A';
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#F5C518';
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(128, 128, 96, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(image, 32, 32, 192, 192);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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

export function clearFaceTextures() {
  faceTextures.clear();
}
