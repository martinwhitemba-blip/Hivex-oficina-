import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarLook, Dir } from './types';
import type { Expression } from './crowd/look';
import { photoSpot } from './crowd/look';
import { fadedMaterial, outlineMaterial, shadeColor, shadowProxyMaterial, sharedGeo, sharedStandard, sharedToon, sharedVertexBasic } from './crowd/materials';

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

  const head = new THREE.Mesh(humanHeadGeometry(), skin);
  head.name = 'head';
  head.receiveShadow = true;
  turn.add(head);
  const hair = new THREE.Mesh(hairGeometry(look.hairStyle), hairMat);
  hair.name = 'hair';
  hair.position.y = 56;
  turn.add(hair);

  const shell = new THREE.Mesh(outlineGeometry(), outlineMaterial());
  shell.name = 'outline';
  shell.raycast = () => {};
  turn.add(shell);

  const owned: THREE.Texture[] = [];
  const spot = photo ? photoSpot(look.photoPlacement) : 'cara';
  const photoFace = Boolean(photo) && spot === 'cara';
  let face: THREE.Mesh;
  if (photo && photoFace) {
    const framed = framedPhoto(photo, 'circle');
    owned.push(framed);
    const material = new THREE.MeshBasicMaterial({
      map: framed,
      transparent: true,
      depthWrite: true,
      alphaTest: 0.45,
      toneMapped: false,
    });
    face = new THREE.Mesh(sharedGeo('chibi-photo', () => new THREE.CircleGeometry(9.6, 22)), material);
    face.position.set(0, 51.5, 13.9);
    face.userData.photo = true;
  } else {
    face = new THREE.Mesh(featureGeometry('neutral', Boolean(look.glasses)), sharedVertexBasic());
  }
  face.name = 'face';
  face.userData.avatarId = id;
  face.renderOrder = 2;
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
  const head = new THREE.Mesh(midHeadGeometry(), sharedToon(look.skin, 1, true));
  head.name = 'mid-head';
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
  if (!rig.face || rig.photoFace || rig.kind !== 'full' || rig.expression === expression) return;
  rig.expression = expression;
  rig.face.geometry = featureGeometry(expression, rig.glasses);
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

const SCLERA = new THREE.Color('#F7F4EF');
const PUPIL = new THREE.Color('#1B140F');
const BROW = new THREE.Color('#32261C');
const LIP = new THREE.Color('#D46570');
const MOUTH_IN = new THREE.Color('#6E1E2C');
const GLINT = new THREE.Color('#FFFFFF');
const FRAME = new THREE.Color('#17171B');
const BLUSH = new THREE.Color('#E47B86');
const EYE_X = 3.55;
const EYE_Y = 54.45;
const EYE_Z = 10.15;

/** Cráneo, mentón y nariz del mismo tono. Una sola malla. */
function humanHeadGeometry() {
  return sharedGeo('chibi-head', () => mergeParts([
    shaped(new THREE.SphereGeometry(11.15, 16, 13), 1.04, 1.16, 0.88, 0, 54.2, -0.2),
    shaped(new THREE.SphereGeometry(7.4, 12, 10), 1.08, 0.74, 0.92, 0, 45.4, 3.8),
    shaped(new THREE.SphereGeometry(1.72, 10, 8), 0.78, 0.66, 1.2, 0, 50.15, 10.15),
    shaped(new THREE.SphereGeometry(1.2, 8, 6), 0.55, 1.15, 0.8, 0, 51.7, 9.55),
  ]));
}

function midHeadGeometry() {
  return sharedGeo('mid-head', () => {
    const skin = new THREE.Color('#ffffff');
    const head = new THREE.SphereGeometry(10, 10, 8);
    head.translate(0, 50, 0);
    const parts = [tint(head, skin)];
    parts.push(tint(shaped(new THREE.SphereGeometry(1.7, 8, 6), 0.85, 0.7, 1.25, 0, 49.15, 10.15), skin));
    for (const side of [-1, 1]) {
      parts.push(tint(shaped(new THREE.SphereGeometry(1.45, 8, 6), 1, 1.12, 0.55, side * 2.75, 51.15, 10.35), PUPIL));
    }
    parts.push(tint(shaped(new THREE.SphereGeometry(1.2, 8, 6), 1.9, 0.85, 0.58, 0, 47.2, 10.65), PUPIL));
    return mergeParts(parts);
  });
}

/** Ojos, cejas y boca en relieve, por delante de la piel. El gesto solo cambia la geometría. */
function featureGeometry(expression: Expression, glasses: boolean) {
  return sharedGeo(`feat|${expression}|${glasses ? 1 : 0}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const surprised = expression === 'surprised';
    const happy = expression === 'happy';
    const wink = expression === 'wink';
    const eyeScale = surprised ? 1.24 : 1;
    if (happy) {
      closedEye(parts, -EYE_X, EYE_Y, EYE_Z);
      closedEye(parts, EYE_X, EYE_Y, EYE_Z);
    } else if (wink) {
      openEye(parts, -EYE_X, EYE_Y, EYE_Z, 1);
      closedEye(parts, EYE_X, EYE_Y, EYE_Z);
    } else {
      openEye(parts, -EYE_X, EYE_Y, EYE_Z, eyeScale);
      openEye(parts, EYE_X, EYE_Y, EYE_Z, eyeScale);
    }
    const browY = surprised ? EYE_Y + 1.95 : EYE_Y + 1.5;
    const tilt = surprised ? 0.42 : happy ? -0.16 : 0.1;
    browBar(parts, -EYE_X, browY, 11.35, -tilt);
    browBar(parts, EYE_X, browY, 11.35, tilt);
    if (surprised) openMouth(parts);
    else smile(parts, happy || wink ? 2.35 : 2.0, happy || wink ? 0.5 : 0.44, happy || wink);
    if (happy || wink) {
      parts.push(tint(shaped(new THREE.SphereGeometry(1.15, 8, 6), 1.2, 0.72, 0.38, -6.15, 50.5, 9.85), BLUSH));
      parts.push(tint(shaped(new THREE.SphereGeometry(1.15, 8, 6), 1.2, 0.72, 0.38, 6.15, 50.5, 9.85), BLUSH));
    }
    nostril(parts, -0.4);
    nostril(parts, 0.4);
    if (glasses) addGlasses(parts, surprised ? 1.18 : 1);
    return mergeParts(parts);
  });
}

function openEye(parts: THREE.BufferGeometry[], x: number, y: number, z: number, scale: number) {
  parts.push(tint(shaped(new THREE.SphereGeometry(1.95 * scale, 12, 10), 1.04, 1.16, 0.54, x, y, z), SCLERA));
  parts.push(tint(shaped(new THREE.SphereGeometry(0.82 * scale, 10, 8), 1, 1.08, 0.62, x, y - 0.05 * scale, z + 0.92 * scale), PUPIL));
  parts.push(tint(shaped(new THREE.SphereGeometry(0.28 * scale, 6, 5), 1, 1, 0.7, x + 0.42 * scale, y + 0.42 * scale, z + 1.28 * scale), GLINT));
}

function closedEye(parts: THREE.BufferGeometry[], x: number, y: number, z: number) {
  const arc = new THREE.TorusGeometry(1.35, 0.58, 6, 14, Math.PI);
  arc.translate(x, y - 0.05, z + 1.15);
  parts.push(tint(arc, BROW));
}

function browBar(parts: THREE.BufferGeometry[], x: number, y: number, z: number, tilt: number) {
  const geo = new THREE.SphereGeometry(0.82, 8, 6);
  geo.scale(2.15, 0.4, 0.5);
  geo.rotateZ(tilt);
  geo.translate(x, y, z);
  parts.push(tint(geo, BROW));
}

function smile(parts: THREE.BufferGeometry[], radius: number, tube: number, wide: boolean) {
  if (wide) parts.push(tint(shaped(new THREE.SphereGeometry(1.25, 8, 6), 1.65, 0.55, 0.48, 0, 47.7, 10.85), MOUTH_IN));
  const lip = new THREE.TorusGeometry(radius, tube, 6, 16, Math.PI);
  lip.rotateZ(Math.PI);
  lip.translate(0, 48.15, 11.3);
  parts.push(tint(lip, LIP));
}

function openMouth(parts: THREE.BufferGeometry[]) {
  parts.push(tint(shaped(new THREE.SphereGeometry(1.05, 10, 8), 1.05, 1.2, 0.5, 0, 47.7, 10.7), MOUTH_IN));
  const lip = new THREE.TorusGeometry(1.2, 0.42, 6, 16);
  lip.translate(0, 47.7, 11.35);
  parts.push(tint(lip, LIP));
}

function nostril(parts: THREE.BufferGeometry[], x: number) {
  parts.push(tint(shaped(new THREE.SphereGeometry(0.24, 6, 4), 1, 0.7, 0.6, x, 49.75, 12.15), PUPIL));
}

function addGlasses(parts: THREE.BufferGeometry[], scale: number) {
  for (const side of [-1, 1]) {
    const ring = new THREE.TorusGeometry(2.15 * scale, 0.16, 5, 16);
    ring.translate(side * EYE_X, EYE_Y, 11.85);
    parts.push(tint(ring, FRAME));
  }
  parts.push(tint(shaped(new THREE.SphereGeometry(0.55, 6, 4), 1.7, 0.32, 0.4, 0, EYE_Y, 11.8), FRAME));
}

function shaped(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number, x: number, y: number, z: number) {
  geo.scale(sx, sy, sz);
  geo.translate(x, y, z);
  return geo;
}

function tint(geo: THREE.BufferGeometry, color: THREE.Color) {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function mergeParts(parts: THREE.BufferGeometry[]) {
  const merged = mergeGeometries(parts, false);
  if (!merged) return parts[0];
  for (const part of parts) part.dispose();
  return merged;
}

function hairGeometry(style: AvatarLook['hairStyle']) {
  return sharedGeo(`chibi-hair-${style}`, () => {
    const cap = new THREE.SphereGeometry(11.6, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.translate(0, 2.0, -2.3);
    if (style === 3) cap.scale(1.02, 0.4, 1);
    else if (style === 2) cap.scale(1.03, 1.12, 1.03);
    else if (style === 1) cap.scale(1.06, 1.18, 1.04);
    return cap;
  });
}

function outlineGeometry() {
  return sharedGeo('chibi-outline', () => mergeParts([
    shaped(new THREE.SphereGeometry(11.15 * 1.07, 12, 10), 1.04, 1.16, 0.88, 0, 54.2, -0.2),
    shaped(new THREE.SphereGeometry(7.4 * 1.07, 10, 8), 1.08, 0.74, 0.92, 0, 45.4, 3.8),
    shaped(new THREE.SphereGeometry(1.72 * 1.14, 8, 6), 0.78, 0.66, 1.2, 0, 50.15, 10.15),
    shaped(new THREE.SphereGeometry(1, 10, 8), 14 * 1.09, 11 * 1.09, 12 * 1.09, 0, 32, 0),
  ]));
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
