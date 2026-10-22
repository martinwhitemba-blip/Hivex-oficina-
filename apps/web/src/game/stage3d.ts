/**
 * Oficina en 3D (Three.js). Cámara en perspectiva a ~45°, suelo, paredes
 * con altura, muebles low-poly y personajes con volumen. Si WebGL no arranca,
 * `ok` queda en false y el juego sigue dibujando el plano 2D.
 */
import * as THREE from 'three';
import { PROXIMITY_RADIUS, TILE } from '../config';
import { STATUSES } from '../data/statuses';
import type { Camera } from './camera';
import type { Avatar } from './entities';
import type { AvatarLook, Dir, MapObject } from './types';
import { Cell, type World } from './world';

const CHAR_H = 78;
const WALL_H = 54;
const FOV = 40;
const PITCH = Math.PI / 4;
const YAW: Record<Dir, number> = { down: 0, up: Math.PI, right: -Math.PI / 2, left: Math.PI / 2 };

export interface StageExtras {
  selfId: string;
  path: { x: number; y: number }[];
  marker: { x: number; y: number } | null;
  proximity: boolean;
}

interface Rig {
  anchor: THREE.Group;
  bob: THREE.Group;
  turn: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  key: string;
  yaw: number;
  phase: number;
  lastT: number;
  dim: boolean;
}

interface NameTag {
  sprite: THREE.Sprite;
  key: string;
  w: number;
  h: number;
}

export class Stage3D {
  ok = false;
  characterPx = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 8, 9000);
  private keyLight: THREE.DirectionalLight | null = null;
  private actors = new THREE.Group();
  private rigs = new Map<string, Rig>();
  private names = new Map<string, NameTag>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private viewW = 0;
  private viewH = 0;
  private dpr = 1;
  private pathGeo = new THREE.BufferGeometry();
  private pathAttr = new THREE.BufferAttribute(new Float32Array(360), 3);
  private marker: THREE.Mesh | null = null;
  private proxRing: THREE.Mesh | null = null;
  private measureHead = new THREE.Vector3();
  private measureFeet = new THREE.Vector3();
  private plazaLogo: THREE.Mesh | null = null;
  private plazaAt = new THREE.Vector3();

  private constructor() {}

  static mount(gameCanvas: HTMLCanvasElement, world: World): Stage3D {
    const stage = new Stage3D();
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      const gl = renderer.getContext();
      if (!gl) {
        renderer.dispose();
        return stage;
      }
      renderer.setClearColor(0x8ec8ef, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.id = 'stage3d';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
      gameCanvas.insertAdjacentElement('afterend', canvas);
      stage.renderer = renderer;
      stage.buildOffice(world, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
      stage.scene.add(stage.actors);
      stage.pathGeo.setAttribute('position', stage.pathAttr);
      const dots = new THREE.Points(stage.pathGeo, new THREE.PointsMaterial({ color: 0xe0a800, size: 12, sizeAttenuation: true }));
      dots.frustumCulled = false;
      stage.scene.add(dots);
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(14, 1.6, 8, 24),
        new THREE.MeshStandardMaterial({ color: '#F5C518', emissive: '#E0A800', emissiveIntensity: 0.4, roughness: 0.35 }),
      );
      marker.rotation.x = Math.PI / 2;
      marker.visible = false;
      stage.marker = marker;
      stage.scene.add(marker);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PROXIMITY_RADIUS - 3, PROXIMITY_RADIUS, 48),
        new THREE.MeshBasicMaterial({ color: '#F5C518', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      stage.proxRing = ring;
      stage.scene.add(ring);
      stage.ok = true;
      return stage;
    } catch (error) {
      console.error(error);
      return stage;
    }
  }

  pick(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number; avatarId?: string } | null {
    if (!this.ok || rect.width < 2 || rect.height < 2) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.scene], true);
    let ground: { x: number; y: number } | null = null;
    for (const hit of hits) {
      if (hit.object instanceof THREE.Sprite || hit.object instanceof THREE.Points) continue;
      let node: THREE.Object3D | null = hit.object;
      let avatarId = '';
      while (node) {
        if (typeof node.userData.avatarId === 'string') avatarId = node.userData.avatarId;
        node = node.parent;
      }
      if (avatarId) return { x: hit.point.x, y: hit.point.z, avatarId };
      if (!ground) ground = { x: hit.point.x, y: hit.point.z };
    }
    return ground;
  }

  render(avatars: Avatar[], cam: Camera, dpr: number, t: number, faceOf: (look: AvatarLook) => HTMLImageElement | undefined, extras: StageExtras) {
    const renderer = this.renderer;
    if (!renderer || cam.viewW < 2 || cam.viewH < 2) return;
    const ratio = Math.min(dpr, 1.75);
    if (cam.viewW !== this.viewW || cam.viewH !== this.viewH || ratio !== this.dpr) {
      this.viewW = cam.viewW;
      this.viewH = cam.viewH;
      this.dpr = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(cam.viewW, cam.viewH, false);
      this.camera.aspect = cam.viewW / cam.viewH;
      this.camera.updateProjectionMatrix();
    }
    const desired = 72 * (cam.zoom / 0.85);
    const focal = (cam.viewH / 2) / Math.tan((FOV * Math.PI) / 360);
    const dist = (focal * CHAR_H * Math.cos(PITCH)) / Math.max(28, desired);
    const focusX = cam.x;
    const focusZ = cam.y;
    const focusY = 34;
    this.camera.position.set(focusX, focusY + Math.sin(PITCH) * dist, focusZ - Math.cos(PITCH) * dist);
    this.camera.lookAt(focusX, focusY, focusZ);
    this.camera.updateMatrixWorld(true);
    if (this.keyLight) {
      this.keyLight.position.set(focusX + 280, 520, focusZ + 40);
      this.keyLight.target.position.set(focusX, 0, focusZ);
      const shadow = this.keyLight.shadow.camera;
      const span = 520;
      shadow.left = -span;
      shadow.right = span;
      shadow.top = span;
      shadow.bottom = -span;
      shadow.near = 20;
      shadow.far = 1400;
      shadow.updateProjectionMatrix();
    }

    const seen = new Set<string>();
    let nearest = Infinity;
    this.characterPx = 0;
    for (const avatar of avatars) {
      seen.add(avatar.id);
      if (!avatar.look) continue;
      const photo = avatar.look.usePhoto ? faceOf(avatar.look) : undefined;
      const key = `${avatar.mode}|${signature(avatar.look, Boolean(photo))}`;
      let rig = this.rigs.get(avatar.id);
      if (!rig || rig.key !== key) {
        if (rig) this.drop(rig);
        rig = avatar.mode === 'car' ? buildCar(avatar.id) : buildRig(avatar.look, photo, avatar.id, renderer.capabilities.getMaxAnisotropy());
        rig.key = key;
        rig.phase = Math.abs(hash(avatar.id) % 628) / 100;
        this.actors.add(rig.anchor);
        this.rigs.set(avatar.id, rig);
      }
      const dt = Math.min(0.05, Math.max(0, t - (rig.lastT || t)));
      rig.lastT = t;
      rig.anchor.position.set(avatar.x, 0, avatar.y);
      if (avatar.mode === 'car') {
        rig.turn.rotation.y = avatar.carAngle - Math.PI / 2;
        rig.bob.position.y = 0;
      } else {
        const target = YAW[avatar.dir] ?? 0;
        let delta = target - rig.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        rig.yaw += delta * Math.min(1, dt * 10);
        rig.turn.rotation.y = rig.yaw;
        const cycle = t * 11 + rig.phase;
        const walking = avatar.moving && !avatar.sitting && avatar.pace > 0.08;
        const swing = Math.sin(cycle);
        if (avatar.sitting) {
          rig.legL.rotation.x = -1.25;
          rig.legR.rotation.x = -1.25;
          rig.kneeL.rotation.x = 1.35;
          rig.kneeR.rotation.x = 1.35;
          rig.armL.rotation.x = 0.35;
          rig.armR.rotation.x = 0.45;
          rig.bob.position.y = -8;
          rig.bob.rotation.x = 0.08;
        } else {
          const amp = walking ? 0.95 : 0.05;
          rig.legL.rotation.x = swing * amp;
          rig.legR.rotation.x = -swing * amp;
          rig.kneeL.rotation.x = Math.max(0, -swing) * (walking ? 1.25 : 0);
          rig.kneeR.rotation.x = Math.max(0, swing) * (walking ? 1.25 : 0);
          rig.armL.rotation.x = -swing * amp * 0.75;
          rig.armR.rotation.x = swing * amp * 0.75;
          rig.bob.position.y = walking ? Math.abs(swing) * 2.2 : Math.sin(t * 2.2 + rig.phase) * 0.45;
          rig.bob.rotation.x = walking ? 0.1 : 0;
          rig.bob.rotation.z = walking ? swing * 0.04 : 0;
        }
      }
      const dim = avatar.status === 'ausente' || Boolean(avatar.ghost);
      if (dim !== rig.dim) {
        rig.dim = dim;
        rig.anchor.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
          const list = Array.isArray(material) ? material : material ? [material] : [];
          for (const item of list) {
            if (item.userData.keep) continue;
            item.transparent = dim;
            item.opacity = dim ? 0.48 : 1;
          }
        });
      }
      const gap = Math.hypot(avatar.x - focusX, avatar.y - focusZ);
      if (avatar.mode !== 'car' && gap < nearest) {
        nearest = gap;
        this.measureFeet.set(avatar.x, 0, avatar.y).project(this.camera);
        this.measureHead.set(avatar.x, CHAR_H, avatar.y).project(this.camera);
        this.characterPx = Math.abs(this.measureHead.y - this.measureFeet.y) * cam.viewH / 2;
      }
      this.placeName(avatar, extras.selfId, cam.viewW, cam.viewH);
    }
    for (const [id, rig] of this.rigs) {
      if (!seen.has(id)) {
        this.drop(rig);
        this.rigs.delete(id);
        this.names.get(id)?.sprite.material.map?.dispose();
        (this.names.get(id)?.sprite.material as THREE.Material | undefined)?.dispose();
        this.names.get(id)?.sprite.removeFromParent();
        this.names.delete(id);
      }
    }
    if (this.plazaLogo) {
      const dx = this.camera.position.x - this.plazaLogo.position.x;
      const dz = this.camera.position.z - this.plazaLogo.position.z;
      this.plazaLogo.rotation.y = Math.atan2(dx, dz);
    }
    this.stackNames(cam.viewW, cam.viewH);
    this.drawPath(extras.path);
    if (this.marker) {
      this.marker.visible = Boolean(extras.marker);
      if (extras.marker) {
        this.marker.position.set(extras.marker.x, 2, extras.marker.y);
        const pulse = 1 + Math.sin(t * 8) * 0.08;
        this.marker.scale.setScalar(pulse);
      }
    }
    const me = avatars.find((avatar) => avatar.id === extras.selfId);
    if (this.proxRing && me) {
      this.proxRing.visible = extras.proximity;
      this.proxRing.position.set(me.x, 0.8, me.y);
    }
    renderer.render(this.scene, this.camera);
  }

  /** Logo de la empresa, de pie en la plaza. Sin imagen, la plaza queda como está. */
  setPlazaLogo(image: HTMLImageElement | null) {
    if (!this.ok) return;
    if (this.plazaLogo) {
      const material = this.plazaLogo.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      this.plazaLogo.geometry.dispose();
      this.plazaLogo.removeFromParent();
      this.plazaLogo = null;
    }
    if (!image?.complete || !image.naturalWidth) return;
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    texture.anisotropy = 8;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(78, 78),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, depthWrite: false }),
    );
    mesh.position.copy(this.plazaAt);
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.plazaLogo = mesh;
  }

  dispose() {
    for (const rig of this.rigs.values()) this.drop(rig);
    this.rigs.clear();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      list.forEach((item) => mats.add(item));
    });
    geos.forEach((geo) => geo.dispose());
    mats.forEach((material) => {
      const mapped = material as THREE.MeshStandardMaterial;
      mapped.map?.dispose();
      material.dispose();
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.ok = false;
  }

  private buildOffice(world: World, anisotropy: number) {
    const width = world.w * TILE;
    const depth = world.h * TILE;
    this.scene.background = new THREE.Color('#8ec8ef');
    this.scene.fog = new THREE.Fog('#b7dff3', 1400, 4200);
    this.scene.add(new THREE.HemisphereLight(0xfff6e4, 0x3e6a34, 0.72));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const key = new THREE.DirectionalLight(0xfff3d6, 1.35);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.035;
    key.shadow.radius = 2;
    this.scene.add(key, key.target);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight(0x9ecbff, 0.38);
    fill.position.set(-300, 220, -200);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd978, 0.28);
    rim.position.set(180, 160, 320);
    this.scene.add(rim);

    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 400, depth + 400),
      new THREE.MeshStandardMaterial({ map: grassTexture(anisotropy), roughness: 0.95, metalness: 0 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(width / 2, 0, depth / 2);
    grass.receiveShadow = true;
    this.scene.add(grass);

    const road = world.def.road;
    const roadMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, road.h * TILE),
      new THREE.MeshStandardMaterial({ color: '#4B4F58', roughness: 0.85 }),
    );
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(width / 2, 0.04, (road.y + road.h / 2) * TILE);
    roadMesh.receiveShadow = true;
    this.scene.add(roadMesh);

    const building = world.def.building;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(building.w * TILE, 1.2, building.h * TILE),
      new THREE.MeshStandardMaterial({ color: '#F3EFE6', roughness: 0.9 }),
    );
    slab.position.set((building.x + building.w / 2) * TILE, 0.6, (building.y + building.h / 2) * TILE);
    slab.receiveShadow = true;
    this.scene.add(slab);

    for (const room of world.def.rooms) {
      const rect = room.rect;
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry((rect.w - 1.2) * TILE, 0.6, (rect.h - 1.2) * TILE),
        new THREE.MeshStandardMaterial({ color: room.floor || '#F7F1E6', roughness: 0.88 }),
      );
      floor.position.set((rect.x + rect.w / 2) * TILE, 1.15, (rect.y + rect.h / 2) * TILE);
      floor.receiveShadow = true;
      this.scene.add(floor);
    }

    const plaza = world.def.plaza;
    const plazaMesh = new THREE.Mesh(
      new THREE.CircleGeometry(plaza.r * TILE, 40),
      new THREE.MeshStandardMaterial({ color: '#E7D7A1', roughness: 0.8 }),
    );
    plazaMesh.rotation.x = -Math.PI / 2;
    plazaMesh.position.set(plaza.cx * TILE, 1.35, plaza.cy * TILE);
    plazaMesh.receiveShadow = true;
    this.scene.add(plazaMesh);
    const plazaRing = new THREE.Mesh(
      new THREE.TorusGeometry(plaza.r * TILE, 1.4, 8, 40),
      new THREE.MeshStandardMaterial({ color: '#D4AF37', roughness: 0.35, metalness: 0.4 }),
    );
    plazaRing.rotation.x = Math.PI / 2;
    plazaRing.position.set(plaza.cx * TILE, 1.8, plaza.cy * TILE);
    this.scene.add(plazaRing);
    this.plazaAt.set(plaza.cx * TILE, 46, plaza.cy * TILE);

    const walls: { x: number; z: number }[] = [];
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (world.cell(x, y) === Cell.Wall) walls.push({ x, z: y });
      }
    }
    if (walls.length) {
      const geo = new THREE.BoxGeometry(TILE * 0.96, WALL_H, TILE * 0.96);
      const mat = new THREE.MeshStandardMaterial({ color: '#F7F1E4', roughness: 0.78 });
      const mesh = new THREE.InstancedMesh(geo, mat, walls.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.needsUpdate = true;
      const dummy = new THREE.Object3D();
      walls.forEach((wall, index) => {
        dummy.position.set((wall.x + 0.5) * TILE, WALL_H / 2 + 1, (wall.z + 0.5) * TILE);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      this.scene.add(mesh);
      const trimGeo = new THREE.BoxGeometry(TILE * 0.98, 3.2, TILE * 0.98);
      const trimMat = new THREE.MeshStandardMaterial({ color: '#E0A800', roughness: 0.4, metalness: 0.25 });
      const trim = new THREE.InstancedMesh(trimGeo, trimMat, walls.length);
      trim.frustumCulled = false;
      trim.instanceMatrix.needsUpdate = true;
      walls.forEach((wall, index) => {
        dummy.position.set((wall.x + 0.5) * TILE, WALL_H + 2.2, (wall.z + 0.5) * TILE);
        dummy.updateMatrix();
        trim.setMatrixAt(index, dummy.matrix);
      });
      this.scene.add(trim);
    }

    for (const object of world.def.objects) this.scene.add(furnish(object));
  }

  private placeName(avatar: Avatar, selfId: string, viewW: number, viewH: number) {
    const first = avatar.name.split(' ')[0] || avatar.name;
    const text = avatar.id === selfId ? `${first} (tú)` : first;
    const tone = avatar.ghost ? '#6B7280' : (STATUSES[avatar.status]?.color || '#22C55E');
    const key = `${text}|${tone}|${avatar.id === selfId ? 1 : 0}`;
    let tag = this.names.get(avatar.id);
    if (!tag || tag.key !== key) {
      tag?.sprite.removeFromParent();
      (tag?.sprite.material as THREE.SpriteMaterial | undefined)?.map?.dispose();
      (tag?.sprite.material as THREE.Material | undefined)?.dispose();
      const made = makeLabel(text, tone, avatar.id === selfId);
      const material = new THREE.SpriteMaterial({ map: made.texture, transparent: true, depthTest: false });
      material.userData.keep = true;
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 12;
      sprite.raycast = () => {};
      sprite.userData.screenW = made.w;
      sprite.userData.screenH = made.h;
      this.scene.add(sprite);
      tag = { sprite, key, w: made.w, h: made.h };
      this.names.set(avatar.id, tag);
    }
    tag.sprite.position.set(avatar.x, CHAR_H + 16, avatar.y);
    tag.sprite.userData.baseX = avatar.x;
    tag.sprite.userData.baseZ = avatar.y;
    tag.sprite.visible = viewW > 0 && viewH > 0;
  }

  private stackNames(viewW: number, viewH: number) {
    const items: { tag: NameTag; sx: number; sy: number }[] = [];
    for (const tag of this.names.values()) {
      const projected = tag.sprite.position.clone().project(this.camera);
      if (projected.z > 1) {
        tag.sprite.visible = false;
        continue;
      }
      tag.sprite.visible = true;
      items.push({
        tag,
        sx: (projected.x * 0.5 + 0.5) * viewW,
        sy: (-projected.y * 0.5 + 0.5) * viewH,
      });
    }
    items.sort((a, b) => a.sy - b.sy || a.sx - b.sx);
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const item of items) {
      let sy = item.sy;
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((box) => Math.abs(box.x - item.sx) < (box.w + item.tag.w) / 2 && Math.abs(box.y - sy) < (box.h + item.tag.h) / 2 + 3);
        if (!hit) break;
        sy = hit.y - (hit.h + item.tag.h) / 2 - 4;
      }
      placed.push({ x: item.sx, y: sy, w: item.tag.w, h: item.tag.h });
      const depth = item.tag.sprite.position.clone().project(this.camera).z;
      const ndcX = (item.sx / viewW) * 2 - 1;
      const ndcY = 1 - (sy / viewH) * 2;
      const world = new THREE.Vector3(ndcX, ndcY, depth).unproject(this.camera);
      item.tag.sprite.position.copy(world);
      const dist = this.camera.position.distanceTo(world);
      const worldPerPx = (2 * Math.tan((FOV * Math.PI) / 360) * dist) / viewH;
      item.tag.sprite.scale.set(item.tag.w * worldPerPx, item.tag.h * worldPerPx, 1);
    }
  }

  private drawPath(path: { x: number; y: number }[]) {
    const count = Math.min(path.length, 120);
    for (let i = 0; i < count; i++) {
      this.pathAttr.setXYZ(i, path[i].x, 3, path[i].y);
    }
    this.pathAttr.needsUpdate = true;
    this.pathGeo.setDrawRange(0, count);
  }

  private drop(rig: Rig) {
    rig.anchor.removeFromParent();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const maps = new Set<THREE.Texture>();
    rig.anchor.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geos.add(mesh.geometry);
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) mats.add(item);
    });
    mats.forEach((material) => {
      const mapped = material as THREE.MeshStandardMaterial;
      if (mapped.map) maps.add(mapped.map);
      material.dispose();
    });
    maps.forEach((tex) => tex.dispose());
    geos.forEach((geo) => geo.dispose());
  }
}

function grassTexture(anisotropy: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#69B84A' : '#7BC85A';
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(22, 16);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function furnish(object: MapObject) {
  const w = (object.w ?? 1) * TILE;
  const d = (object.h ?? 1) * TILE;
  const group = new THREE.Group();
  group.position.set(object.x * TILE + w / 2, 0, object.y * TILE + d / 2);
  const kind = object.type;
  if (kind === 'desk' || kind === 'execDesk') {
    const top = box(w * 0.92, 2.4, d * 0.78, '#C4A574');
    top.position.y = kind === 'execDesk' ? 32 : 30;
    group.add(top);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = box(2.2, top.position.y - 1, 2.2, '#8C6A45');
        leg.position.set(sx * (w * 0.38), (top.position.y - 1) / 2, sz * (d * 0.28));
        group.add(leg);
      }
    }
    const monitors = object.variant ?? 1;
    for (let i = 0; i < monitors; i++) {
      const screen = box(14, 10, 1.2, '#16181d', '#7ec8ff');
      screen.position.set((i - (monitors - 1) / 2) * 16, top.position.y + 9, -d * 0.12);
      group.add(screen);
    }
    const chair = box(16, 3, 16, '#2C3140');
    chair.position.set(0, 16, d * 0.55);
    const back = box(16, 16, 2.4, '#2C3140');
    back.position.set(0, 26, d * 0.55 + 7);
    group.add(chair, back);
  } else if (kind === 'chair' || kind === 'stool') {
    group.add(cylinder(kind === 'stool' ? 7 : 8, 3.2, '#3A4154', 0, 16, 0));
    if (kind === 'chair') {
      const back = box(14, 14, 2, '#3A4154');
      back.position.set(0, 24, -6);
      group.add(back);
    }
  } else if (kind === 'meetingTable') {
    const top = box(w * 0.9, 2.4, d * 0.8, '#D7C4A3');
    top.position.y = 28;
    group.add(top);
  } else if (kind === 'roundTable') {
    group.add(cylinder(Math.min(w, d) * 0.42, 2.4, '#D7C4A3', 0, 26, 0));
  } else if (kind === 'plant' || kind === 'tallPlant') {
    const tall = kind === 'tallPlant';
    group.add(cylinder(tall ? 7 : 6, tall ? 8 : 6, '#E7D3B0', 0, tall ? 6 : 4, 0));
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(tall ? 16 : 11, 16, 12), lit('#2F9E44', 0.7));
    leaves.position.y = tall ? 28 : 16;
    leaves.castShadow = true;
    group.add(leaves);
  } else if (kind === 'cactus') {
    const body = box(8, 22, 8, '#3D8C4A');
    body.position.y = 14;
    const arm = box(12, 6, 6, '#3D8C4A');
    arm.position.set(6, 18, 0);
    group.add(body, arm);
  } else if (kind === 'tree' || kind === 'blossom') {
    const trunk = cylinder(4, 18, '#6B4A2E', 0, 16, 0);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), lit(kind === 'blossom' ? '#E59AAD' : '#3E8F45', 0.75));
    canopy.position.y = 34;
    canopy.castShadow = true;
    group.add(trunk, canopy);
  } else if (kind === 'hedge') {
    const hedge = box(w, 16, 12, '#3F8F46');
    hedge.position.y = 8;
    group.add(hedge);
  } else if (kind === 'sofa') {
    const seat = box(w * 0.9, 10, d * 0.7, object.variant === 2 ? '#6B542C' : '#3E4C63');
    seat.position.y = 12;
    const back = box(w * 0.9, 12, 4, object.variant === 2 ? '#5A4624' : '#334056');
    back.position.set(0, 22, -d * 0.28);
    group.add(seat, back);
  } else if (kind === 'bookshelf') {
    const shelf = box(w * 0.92, 36, 10, '#6B4E32');
    shelf.position.y = 20;
    group.add(shelf);
  } else if (kind === 'fridge') {
    const fridge = box(w * 0.8, 42, d * 0.8, '#E7EEF2');
    fridge.position.y = 22;
    group.add(fridge);
  } else if (kind === 'counter') {
    const counter = box(w, 6, d * 0.8, '#D9D3CB');
    counter.position.y = 30;
    group.add(counter);
  } else if (kind === 'tv' || kind === 'whiteboard' || kind === 'ranking') {
    const board = box(w * 0.9, 18, 2, kind === 'tv' ? '#141820' : '#F7F4EE', kind === 'tv' ? '#8FD0FF' : undefined);
    board.position.y = 40;
    group.add(board);
  } else if (kind === 'lamp' || kind === 'streetLamp') {
    const tall = kind === 'streetLamp';
    group.add(cylinder(1.6, tall ? 48 : 28, '#2A2E36', 0, tall ? 28 : 16, 0));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(tall ? 5 : 4, 12, 10), lit('#FFE7A3', 0.3));
    (bulb.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#FFE7A3');
    (bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7;
    bulb.position.y = tall ? 52 : 32;
    group.add(bulb);
  } else if (kind === 'rug') {
    const rug = box(w * 0.92, 0.5, d * 0.92, object.variant === 1 ? '#C4A574' : '#D8E4EA');
    rug.position.y = 1.6;
    rug.castShadow = false;
    group.add(rug);
  } else if (kind === 'pumpkin') {
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(8, 14, 10), lit('#E07A2F', 0.55));
    pumpkin.scale.y = 0.8;
    pumpkin.position.y = 8;
    pumpkin.castShadow = true;
    group.add(pumpkin);
  } else if (kind === 'bench') {
    const bench = box(w * 0.9, 4, 12, '#8C6A45');
    bench.position.y = 14;
    group.add(bench);
  } else if (kind === 'waterCooler') {
    group.add(cylinder(6, 22, '#D5E4EA', 0, 16, 0));
  } else if (kind === 'printer') {
    const printer = box(18, 10, 16, '#E6E8EC');
    printer.position.y = 22;
    group.add(printer);
  } else {
    const fallback = box(w * 0.8, 12, d * 0.8, '#C8C2B8');
    fallback.position.y = 8;
    group.add(fallback);
  }
  return group;
}

function box(w: number, h: number, d: number, color: string, emissive?: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.4, w), Math.max(0.4, h), Math.max(0.4, d)), lit(color, 0.62, emissive));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(radius: number, height: number, color: string, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), lit(color, 0.7));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function lit(color: string, roughness = 0.5, emissive?: string) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.06,
    emissive: emissive || '#000000',
    emissiveIntensity: emissive ? 0.45 : 0,
  });
}

function signature(look: AvatarLook, photo: boolean) {
  return [look.skin, look.hair, look.hairStyle, look.shirt, look.pants, look.glasses ? 1 : 0, photo ? look.photoUrl : ''].join('|');
}

function hash(value: string) {
  let n = 0;
  for (const char of value) n = (n * 33 + char.charCodeAt(0)) >>> 0;
  return n;
}

function shade(hex: string, amount: number) {
  const color = new THREE.Color(hex);
  const target = amount < 0 ? new THREE.Color('#000000') : new THREE.Color('#ffffff');
  return `#${color.lerp(target, Math.min(1, Math.abs(amount))).getHexString()}`;
}

function buildRig(look: AvatarLook, photo: HTMLImageElement | undefined, id: string, anisotropy: number): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const skin = lit(look.skin, 0.55);
  const shirt = lit(look.shirt, 0.48);
  const pants = lit(look.pants, 0.6);
  const shoe = lit('#1A1A1E', 0.4);
  const hairMat = lit(look.hair, 0.45);

  const hip = new THREE.Group();
  hip.position.y = 30;
  turn.add(hip);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), shirt);
  torso.scale.set(19, 16.5, 16);
  torso.position.y = 13;
  torso.castShadow = true;
  hip.add(torso);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(14, 1.7, 8, 22), lit('#F5C518', 0.32));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 4;
  hip.add(belt);

  const legL = leg(pants, shoe, -7.2);
  const legR = leg(pants, shoe, 7.2);
  hip.add(legL.pivot, legR.pivot);
  const armL = arm(skin, lit(shade(look.shirt, -0.18), 0.5), -18);
  const armR = arm(skin, lit(shade(look.shirt, -0.18), 0.5), 18);
  armL.pivot.position.y = 22;
  armR.pivot.position.y = 22;
  hip.add(armL.pivot, armR.pivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(10, 28, 22), skin);
  head.position.y = 66;
  head.castShadow = true;
  turn.add(head);
  if (!photo) {
    turn.add(hairFor(look.hairStyle, hairMat));
    const eyeWhite = lit('#F8F4EE', 0.3);
    const pupil = lit('#1B140F', 0.25);
    for (const side of [-3.1, 3.1]) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(1.45, 12, 10), eyeWhite);
      white.position.set(side, 67, 8.6);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.68, 10, 8), pupil);
      dot.position.set(side, 66.8, 9.8);
      turn.add(white, dot);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.32, 6, 12, Math.PI), lit('#C47A74', 0.45));
    mouth.position.set(0, 62.2, 8.8);
    mouth.rotation.z = Math.PI;
    turn.add(mouth);
    if (look.glasses) {
      const frame = lit('#16161A', 0.25);
      for (const side of [-3.1, 3.1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.22, 8, 16), frame);
        ring.position.set(side, 67, 9.2);
        turn.add(ring);
      }
    }
  } else {
    const cap = hairFor(look.hairStyle === 1 || look.hairStyle === 2 ? look.hairStyle : 0, hairMat);
    cap.position.z = -2.5;
    cap.scale.set(1, 0.72, 0.9);
    turn.add(cap);
    const framed = framedPhoto(photo, anisotropy);
    const face = new THREE.Mesh(new THREE.CircleGeometry(7.4, 28), new THREE.MeshBasicMaterial({ map: framed, toneMapped: false }));
    face.position.set(0, 66.2, 8.2);
    face.userData.avatarId = id;
    const faceRing = new THREE.Mesh(new THREE.TorusGeometry(7.7, 0.72, 8, 28), lit('#F5C518', 0.28));
    faceRing.position.copy(face.position);
    turn.add(face, faceRing);
    const badgeMat = new THREE.SpriteMaterial({ map: framed, transparent: true, depthTest: true });
    badgeMat.userData.keep = true;
    const badge = new THREE.Sprite(badgeMat);
    badge.position.set(0, 46, 16);
    badge.scale.set(30, 30, 1);
    badge.renderOrder = 4;
    turn.add(badge);
  }

  return {
    anchor, bob, turn,
    legL: legL.pivot, legR: legR.pivot, kneeL: legL.knee, kneeR: legR.knee,
    armL: armL.pivot, armR: armR.pivot,
    key: '', yaw: 0, phase: 0, lastT: 0, dim: false,
  };
}

function leg(pants: THREE.Material, shoe: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(4.6, 7, 4, 8), pants);
  thigh.position.y = -7;
  thigh.castShadow = true;
  const knee = new THREE.Group();
  knee.position.y = -12;
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(4.1, 6.5, 4, 8), pants);
  shin.position.y = -6;
  shin.castShadow = true;
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(3.2, 4.5, 3, 8), shoe);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(0, -11, 2.4);
  foot.castShadow = true;
  knee.add(shin, foot);
  pivot.add(thigh, knee);
  return { pivot, knee };
}

function arm(skin: THREE.Material, sleeve: THREE.Material, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0, 0);
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(3.6, 7, 3, 8), sleeve);
  upper.position.y = -6;
  upper.castShadow = true;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 10), skin);
  hand.position.y = -12;
  pivot.add(upper, hand);
  return { pivot };
}

function hairFor(style: AvatarLook['hairStyle'], material: THREE.Material) {
  const group = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(10.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.48), material);
  cap.position.y = 70;
  cap.castShadow = true;
  group.add(cap);
  if (style === 1) {
    const lock = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 12, 3, 8), material);
    lock.position.set(-9, 56, -1);
    lock.rotation.z = 0.2;
    const other = lock.clone();
    other.position.x = 9;
    other.rotation.z = -0.2;
    group.add(lock, other);
  } else if (style === 2) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 12), material);
    bun.position.set(0, 76, -2);
    group.add(bun);
  } else if (style === 3) {
    cap.scale.set(1, 0.45, 1);
    cap.position.y = 70;
  }
  return group;
}

function buildCar(id: string): Rig {
  const anchor = new THREE.Group();
  anchor.userData.avatarId = id;
  const bob = new THREE.Group();
  anchor.add(bob);
  const turn = new THREE.Group();
  bob.add(turn);
  const body = box(22, 10, 40, '#E0A800');
  body.position.y = 12;
  const cabin = box(18, 8, 18, '#1B1E27');
  cabin.position.set(0, 20, -2);
  turn.add(body, cabin);
  for (const x of [-10, 10]) {
    for (const z of [-12, 12]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 3, 12), lit('#1A1A1E', 0.4));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 4, z);
      turn.add(wheel);
    }
  }
  const empty = new THREE.Group();
  return { anchor, bob, turn, legL: empty, legR: empty, kneeL: empty, kneeR: empty, armL: empty, armR: empty, key: '', yaw: 0, phase: 0, lastT: 0, dim: false };
}

function framedPhoto(image: CanvasImageSource, anisotropy: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#8A6A12';
  ctx.beginPath();
  ctx.arc(512, 512, 500, 0, Math.PI * 2);
  ctx.fill();
  const ring = ctx.createRadialGradient(512, 512, 340, 512, 512, 500);
  ring.addColorStop(0, '#FFF1B0');
  ring.addColorStop(0.45, '#F5C518');
  ring.addColorStop(1, '#C4920A');
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(512, 512, 500, 0, Math.PI * 2);
  ctx.arc(512, 512, 360, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(512, 512, 352, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, 160, 160, 704, 704);
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function makeLabel(text: string, status: string, self: boolean) {
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
  ctx.fillStyle = status;
  ctx.fill();
  ctx.fillStyle = self ? '#F7DC6F' : '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 30, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, w: w / 2, h: h / 2 };
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
