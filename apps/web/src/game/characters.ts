import * as THREE from 'three';
import type { AvatarLook, Dir } from './types';
import { fadedMaterial, shadeColor, shadowProxyMaterial, sharedBasic, sharedGeo, sharedStandard } from './crowd/materials';

const YAW: Record<Dir, number> = { down: 0, up: Math.PI, right: -Math.PI / 2, left: Math.PI / 2 };

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
  key: string;
  yaw: number;
  phase: number;
  lastT: number;
  dim: boolean;
  kind: 'full' | 'mid' | 'car';
  owned: THREE.Texture[];
}

export interface PoseInput {
  dir: Dir;
  moving: boolean;
  sitting: boolean;
  pace: number;
  mode: 'walk' | 'car';
  carAngle: number;
}

const faceTextures = new Map<string, THREE.CanvasTexture>();

export function lookKey(mode: string, look: AvatarLook, photo: boolean) {
  return [mode, look.skin, look.hair, look.hairStyle, look.shirt, look.pants, look.glasses ? 1 : 0, photo ? look.photoUrl ?? '' : ''].join('|');
}

export function buildFull(look: AvatarLook, photo: HTMLImageElement | undefined, id: string): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const skin = sharedStandard(look.skin, 0.55);
  const shirt = sharedStandard(look.shirt, 0.48);
  const pants = sharedStandard(look.pants, 0.6);
  const shoe = sharedStandard('#1A1A1E', 0.4);
  const hairMat = sharedStandard(look.hair, 0.45);
  const sleeve = sharedStandard(shadeColor(look.shirt, -0.18), 0.5);

  const hip = new THREE.Group();
  hip.position.y = 30;
  turn.add(hip);
  const torso = new THREE.Mesh(sharedGeo('torso', () => {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    geo.scale(18, 15, 14);
    return geo;
  }), shirt);
  torso.position.y = 12;
  torso.receiveShadow = true;
  hip.add(torso);

  const legsL = limbLeg(pants, shoe, -7);
  const legsR = limbLeg(pants, shoe, 7);
  hip.add(legsL.pivot, legsR.pivot);
  const armsL = limbArm(skin, sleeve, -17);
  const armsR = limbArm(skin, sleeve, 17);
  armsL.pivot.position.y = 20;
  armsR.pivot.position.y = 20;
  hip.add(armsL.pivot, armsR.pivot);

  const head = new THREE.Mesh(sharedGeo('head', () => new THREE.SphereGeometry(10, 12, 10)), skin);
  head.position.y = 64;
  head.receiveShadow = true;
  turn.add(head);
  const hair = new THREE.Mesh(hairGeometry(look.hairStyle), hairMat);
  hair.position.y = 68;
  turn.add(hair);

  const owned: THREE.Texture[] = [];
  if (photo) {
    const framed = framedPhoto(photo);
    owned.push(framed);
    const face = new THREE.Mesh(sharedGeo('face', () => new THREE.CircleGeometry(6.4, 16)), new THREE.MeshBasicMaterial({ map: framed, toneMapped: false }));
    face.position.set(0, 64, 8.6);
    face.userData.avatarId = id;
    turn.add(face);
    const badgeMat = new THREE.SpriteMaterial({ map: framed, transparent: true, depthTest: true });
    badgeMat.userData.keep = true;
    const badge = new THREE.Sprite(badgeMat);
    badge.position.set(0, 44, 16);
    badge.scale.set(16, 16, 1);
    badge.renderOrder = 4;
    turn.add(badge);
  } else {
    const tex = faceTexture(look.skin, Boolean(look.glasses));
    const face = new THREE.Mesh(sharedGeo('face', () => new THREE.CircleGeometry(6.4, 16)), sharedBasic(`face|${look.skin}|${look.glasses ? 1 : 0}`, '#ffffff', tex));
    face.position.set(0, 64, 8.6);
    turn.add(face);
  }

  const shadow = new THREE.Mesh(sharedGeo('shadow-proxy', () => new THREE.CapsuleGeometry(7, 24, 1, 5)), shadowProxyMaterial());
  shadow.position.y = 28;
  shadow.layers.set(1);
  shadow.castShadow = false;
  shadow.visible = false;
  anchor.add(shadow);

  return {
    anchor, bob, turn,
    legL: legsL.pivot, legR: legsR.pivot, kneeL: legsL.knee, kneeR: legsR.knee,
    armL: armsL.pivot, armR: armsR.pivot,
    shadow, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'full', owned,
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
    const geo = new THREE.CapsuleGeometry(8, 16, 2, 6);
    geo.translate(0, 36, 0);
    return geo;
  }), sharedStandard(look.shirt, 0.5));
  const head = new THREE.Mesh(sharedGeo('mid-head', () => {
    const geo = new THREE.SphereGeometry(8, 8, 6);
    geo.translate(0, 58, 0);
    return geo;
  }), sharedStandard(look.skin, 0.55));
  const legs = new THREE.Mesh(sharedGeo('mid-legs', () => {
    const geo = new THREE.CapsuleGeometry(7, 12, 1, 5);
    geo.translate(0, 16, 0);
    return geo;
  }), sharedStandard(look.pants, 0.6));
  const legPivot = new THREE.Group();
  legPivot.add(legs);
  turn.add(body, head, legPivot);
  const empty = new THREE.Group();
  return {
    anchor, bob, turn,
    legL: empty, legR: legPivot, kneeL: empty, kneeR: empty, armL: empty, armR: empty,
    shadow: null, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'mid', owned: [],
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
    shadow: null, key: '', yaw: 0, phase: 0, lastT: 0, dim: false, kind: 'car', owned: [],
  };
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
  if (rig.kind === 'mid') {
    rig.legR.rotation.x = avatar.sitting ? -1.15 : swing * (walking ? 0.45 : 0.04);
    rig.bob.position.y = avatar.sitting ? -8 : walking ? Math.abs(swing) * 1.4 : Math.sin(t * 2.2 + rig.phase) * 0.35;
    return;
  }
  if (avatar.sitting) {
    rig.legL.rotation.x = -1.25;
    rig.legR.rotation.x = -1.25;
    rig.kneeL.rotation.x = 1.35;
    rig.kneeR.rotation.x = 1.35;
    rig.armL.rotation.x = 0.35;
    rig.armR.rotation.x = 0.45;
    rig.armL.rotation.z = 0.15;
    rig.armR.rotation.z = -0.15;
    rig.bob.position.y = -8;
    rig.bob.rotation.x = 0.08;
    return;
  }
  const amp = walking ? 0.95 : 0.05;
  rig.legL.rotation.x = swing * amp;
  rig.legR.rotation.x = -swing * amp;
  rig.kneeL.rotation.x = Math.max(0, -swing) * (walking ? 1.25 : 0);
  rig.kneeR.rotation.x = Math.max(0, swing) * (walking ? 1.25 : 0);
  rig.armL.rotation.x = -swing * amp * 0.75;
  rig.armR.rotation.x = swing * amp * 0.75;
  rig.armL.rotation.z = 0;
  rig.armR.rotation.z = 0;
  rig.bob.position.y = walking ? Math.abs(swing) * 2.2 : Math.sin(t * 2.2 + rig.phase) * 0.45;
  rig.bob.rotation.x = walking ? 0.1 : 0;
  rig.bob.rotation.z = walking ? swing * 0.04 : 0;
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

function limbLeg(pants: THREE.Material, shoe: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const thigh = new THREE.Mesh(sharedGeo('thigh', () => new THREE.CapsuleGeometry(4.2, 6, 1, 6)), pants);
  thigh.position.y = -6;
  const knee = new THREE.Group();
  knee.position.y = -11;
  const shin = new THREE.Mesh(sharedGeo('shin', () => new THREE.CapsuleGeometry(3.6, 6, 1, 6)), pants);
  shin.position.y = -6;
  const foot = new THREE.Mesh(sharedGeo('foot', () => new THREE.CapsuleGeometry(2.6, 3.5, 1, 5)), shoe);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(0, -10, 2);
  knee.add(shin, foot);
  pivot.add(thigh, knee);
  return { pivot, knee };
}

function limbArm(skin: THREE.Material, sleeve: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const upper = new THREE.Mesh(sharedGeo('arm', () => new THREE.CapsuleGeometry(3.2, 6, 1, 6)), sleeve);
  upper.position.y = -6;
  const hand = new THREE.Mesh(sharedGeo('hand', () => new THREE.SphereGeometry(2.3, 8, 6)), skin);
  hand.position.y = -12;
  pivot.add(upper, hand);
  return { pivot };
}

function hairGeometry(style: AvatarLook['hairStyle']) {
  return sharedGeo(`hair-${style}`, () => {
    const cap = new THREE.SphereGeometry(10.3, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.48);
    cap.translate(0, 2, 0);
    if (style === 3) cap.scale(1, 0.45, 1);
    else if (style === 2) cap.scale(1.02, 1.18, 1.02);
    else if (style === 1) cap.scale(1.08, 1.22, 1.05);
    return cap;
  });
}

function faceTexture(skin: string, glasses: boolean) {
  const key = `${skin}|${glasses ? 1 : 0}`;
  const cached = faceTextures.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#F8F4EE';
  ctx.beginPath();
  ctx.ellipse(46, 60, 10, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(82, 60, 10, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1B140F';
  ctx.beginPath();
  ctx.arc(48, 62, 4.5, 0, Math.PI * 2);
  ctx.arc(84, 62, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shadeColor(skin, -0.35);
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(34, 42);
  ctx.quadraticCurveTo(46, 36, 58, 44);
  ctx.moveTo(70, 44);
  ctx.quadraticCurveTo(82, 36, 94, 42);
  ctx.stroke();
  ctx.strokeStyle = '#C47A74';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 86, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  if (glasses) {
    ctx.strokeStyle = '#16161A';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(46, 60, 14, 0, Math.PI * 2);
    ctx.arc(82, 60, 14, 0, Math.PI * 2);
    ctx.moveTo(60, 60);
    ctx.lineTo(68, 60);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.shared = true;
  faceTextures.set(key, texture);
  return texture;
}

function framedPhoto(image: CanvasImageSource) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function clearFaceTextures() {
  faceTextures.clear();
}
