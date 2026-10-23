/**
 * Oficina en 3D. Si WebGL no arranca, `ok` queda en false y el juego sigue en 2D.
 * Los avatares cercanos van a detalle, los lejanos a cartel y los ausentes a instancias.
 */
import * as THREE from 'three';
import { PROXIMITY_RADIUS, TILE } from '../config';
import { STATUSES } from '../data/statuses';
import { probeWebGL } from './webglProbe';
import type { Camera } from './camera';
import type { Avatar } from './entities';
import type { AvatarLook, MapObject } from './types';
import { Cell, type World } from './world';
import { bakeStatic, releaseChunk } from './crowd/bake';
import { NameBatch } from './crowd/atlas';
import { isCoarseMobile } from './crowd/device';
import { CrowdExtras } from './crowd/impostors';
import { clearSharedResources, sharedStandard, sharedTextured } from './crowd/materials';
import { assignLods, type LodTier } from './crowd/rules';
import { govern, startingProfile, type QualityProfile } from './crowd/quality';
import { expressionFor } from './crowd/look';
import { buildCar, buildFull, buildMid, clearFaceTextures, disposeRig, lookKey, poseRig, setDim, setExpression, setShadow, type Rig } from './characters';

const CHAR_H = 68;
const WALL_H = 54;
const FOV = 40;
const PITCH = Math.PI / 4;

export interface StageExtras {
  selfId: string;
  selfLabel?: string;
  path: { x: number; y: number }[];
  marker: { x: number; y: number } | null;
  proximity: boolean;
}

export class Stage3D {
  ok = false;
  characterPx = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 8, 9000);
  private keyLight: THREE.DirectionalLight | null = null;
  private actors = new THREE.Group();
  private full = new Map<string, Rig>();
  private mids = new Map<string, Rig>();
  private names: NameBatch;
  private crowd: CrowdExtras;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private viewW = 0;
  private viewH = 0;
  private pathGeo = new THREE.BufferGeometry();
  private pathAttr = new THREE.BufferAttribute(new Float32Array(360), 3);
  private marker: THREE.Mesh | null = null;
  private proxRing: THREE.Mesh | null = null;
  private measureHead = new THREE.Vector3();
  private measureFeet = new THREE.Vector3();
  private plazaLogo: THREE.Mesh | null = null;
  private plazaAt = new THREE.Vector3();
  private mobile = false;
  private deviceCap = 1;
  private profile: QualityProfile = startingProfile({ mobile: false, devicePixelRatio: 1 });
  private frameStamp = 0;
  private samples: number[] = [];
  private fps = 0;
  private fullCount = 0;
  private midCount = 0;
  private ghostCount = 0;
  private boardCount = 0;
  private scratch: { id: string; dist: number; ghost: boolean }[] = [];
  private labels: { text: string; tone: string; self: boolean; x: number; y: number; z: number }[] = [];
  private boards: { id: string; x: number; y: number; color: string; dim: boolean; sitting: boolean }[] = [];
  private ghosts: { id: string; x: number; y: number; skin: string; shirt: string; pants: string }[] = [];
  private blobs: { x: number; y: number }[] = [];

  private constructor() {
    this.names = new NameBatch();
    this.crowd = new CrowdExtras();
  }

  static async mount(gameCanvas: HTMLCanvasElement, world: World): Promise<Stage3D> {
    const stage = new Stage3D();
    const ready = await probeWebGL(2000);
    if (!ready) return stage;
    try {
      stage.mobile = isCoarseMobile();
      stage.deviceCap = window.devicePixelRatio || 1;
      stage.profile = startingProfile({ mobile: stage.mobile, devicePixelRatio: stage.deviceCap });
      const renderer = new THREE.WebGLRenderer({
        antialias: !stage.mobile,
        alpha: false,
        powerPreference: 'high-performance',
      });
      const gl = renderer.getContext();
      if (!gl) {
        renderer.dispose();
        return stage;
      }
      renderer.setClearColor(0x8ec8ef, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.shadowMap.enabled = stage.profile.shadows;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.id = 'stage3d';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
      gameCanvas.insertAdjacentElement('afterend', canvas);
      stage.renderer = renderer;
      stage.buildOffice(world, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
      stage.scene.add(stage.actors, stage.names.mesh, stage.crowd.billboards, stage.crowd.ghostHead, stage.crowd.ghostBody, stage.crowd.ghostLegs, stage.crowd.blobs);
      stage.pathGeo.setAttribute('position', stage.pathAttr);
      const dots = new THREE.Points(stage.pathGeo, new THREE.PointsMaterial({ color: 0xe0a800, size: 12, sizeAttenuation: true }));
      dots.frustumCulled = false;
      stage.scene.add(dots);
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(14, 1.6, 6, 18),
        sharedStandard('#F5C518', 0.35, '#E0A800'),
      );
      marker.rotation.x = Math.PI / 2;
      marker.visible = false;
      stage.marker = marker;
      stage.scene.add(marker);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PROXIMITY_RADIUS - 3, PROXIMITY_RADIUS, 32),
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
      stage.dispose();
      return stage;
    }
  }

  stats() {
    const info = this.renderer?.info.render;
    return {
      calls: info?.calls ?? 0,
      triangles: info?.triangles ?? 0,
      ok: this.ok,
      fps: this.fps,
      pixelRatio: this.profile.pixelRatio,
      shadows: this.profile.shadows,
      tier: this.profile.tier,
      full: this.fullCount,
      mid: this.midCount,
      ghosts: this.ghostCount,
      billboards: this.boardCount,
      mobile: this.mobile,
    };
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
      if (hit.object === this.names.mesh || hit.object === this.crowd.blobs) continue;
      const instanced = this.instanceId(hit.object, hit.instanceId);
      if (instanced) return { x: hit.point.x, y: hit.point.z, avatarId: instanced };
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
    if (this.frameStamp === 0) {
      this.deviceCap = dpr;
      this.mobile = isCoarseMobile();
      this.profile = startingProfile({ mobile: this.mobile, devicePixelRatio: dpr });
    }
    this.noteFrame();
    if (cam.viewW !== this.viewW || cam.viewH !== this.viewH) {
      this.viewW = cam.viewW;
      this.viewH = cam.viewH;
      this.applyProfile();
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
      this.keyLight.castShadow = this.profile.shadows;
      const shadow = this.keyLight.shadow.camera;
      const span = 420;
      shadow.left = -span;
      shadow.right = span;
      shadow.top = span;
      shadow.bottom = -span;
      shadow.near = 20;
      shadow.far = 1400;
      shadow.updateProjectionMatrix();
    }

    this.scratch.length = 0;
    for (const avatar of avatars) {
      if (!avatar.look) continue;
      this.scratch.push({ id: avatar.id, dist: Math.hypot(avatar.x - focusX, avatar.y - focusZ), ghost: Boolean(avatar.ghost) });
    }
    const slots = assignLods(this.scratch, this.profile);
    const seenFull = new Set<string>();
    const seenMid = new Set<string>();
    this.labels.length = 0;
    this.boards.length = 0;
    this.ghosts.length = 0;
    this.blobs.length = 0;
    this.fullCount = 0;
    this.midCount = 0;
    this.ghostCount = 0;
    this.boardCount = 0;
    this.characterPx = 0;
    let nearest = Infinity;

    for (const avatar of avatars) {
      if (!avatar.look) continue;
      const slot = slots.get(avatar.id);
      const tier: LodTier = !slot ? 'hidden' : avatar.mode === 'car' && slot.tier !== 'hidden' && slot.tier !== 'billboard' && slot.tier !== 'ghost' ? 'full' : slot.tier;
      const gap = Math.hypot(avatar.x - focusX, avatar.y - focusZ);
      if (tier === 'hidden') continue;
      if (tier === 'full') {
        const photo = avatar.look.usePhoto ? faceOf(avatar.look) : undefined;
        const key = lookKey(avatar.mode === 'car' ? 'car' : 'full', avatar.look, Boolean(photo));
        const rig = this.placeRig(this.full, avatar.id, key, () => avatar.mode === 'car' ? buildCar(avatar.id) : buildFull(avatar.look, photo, avatar.id));
        this.drop(this.mids, avatar.id);
        seenFull.add(avatar.id);
        this.fullCount += 1;
        rig.anchor.position.set(avatar.x, 0, avatar.y);
        rig.anchor.visible = true;
        poseRig(rig, avatar, t);
        if (rig.kind === 'full') {
          const emote = avatar.emote && avatar.emote.until > performance.now() ? avatar.emote.id : null;
          setExpression(rig, expressionFor(emote));
        }
        setDim(rig, avatar.status === 'ausente');
        setShadow(rig, Boolean(slot?.shadow) && this.profile.shadows);
        if (avatar.mode !== 'car' && gap < nearest) {
          nearest = gap;
          this.measureFeet.set(avatar.x, 0, avatar.y).project(this.camera);
          this.measureHead.set(avatar.x, CHAR_H, avatar.y).project(this.camera);
          this.characterPx = Math.abs(this.measureHead.y - this.measureFeet.y) * cam.viewH / 2;
        }
      } else if (tier === 'mid') {
        const key = lookKey('mid', avatar.look, false);
        const rig = this.placeRig(this.mids, avatar.id, key, () => buildMid(avatar.look, avatar.id));
        this.drop(this.full, avatar.id);
        seenMid.add(avatar.id);
        this.midCount += 1;
        rig.anchor.position.set(avatar.x, 0, avatar.y);
        rig.anchor.visible = true;
        poseRig(rig, avatar, t);
        setDim(rig, avatar.status === 'ausente');
      } else if (tier === 'ghost') {
        this.drop(this.full, avatar.id);
        this.drop(this.mids, avatar.id);
        this.ghosts.push({ id: avatar.id, x: avatar.x, y: avatar.y, skin: avatar.look.skin, shirt: avatar.look.shirt, pants: avatar.look.pants });
        this.ghostCount += 1;
      } else {
        this.drop(this.full, avatar.id);
        this.drop(this.mids, avatar.id);
        this.boards.push({
          id: avatar.id,
          x: avatar.x,
          y: avatar.y,
          color: avatar.look.shirt,
          dim: avatar.status === 'ausente',
          sitting: avatar.sitting,
        });
        this.boardCount += 1;
      }
      if (tier !== 'full' || !slot?.shadow) this.blobs.push({ x: avatar.x, y: avatar.y });
      const first = avatar.name.split(' ')[0] || avatar.name;
      const text = avatar.id === extras.selfId ? `${first} ${extras.selfLabel || ''}`.trim() : first;
      const tone = avatar.ghost ? '#6B7280' : (STATUSES[avatar.status]?.color || '#22C55E');
      this.labels.push({ text, tone, self: avatar.id === extras.selfId, x: avatar.x, y: avatar.sitting || avatar.ghost ? 56 : CHAR_H + 14, z: avatar.y });
    }
    for (const id of this.full.keys()) if (!seenFull.has(id)) this.drop(this.full, id);
    for (const id of this.mids.keys()) if (!seenMid.has(id)) this.drop(this.mids, id);

    this.crowd.sync({ billboards: this.boards, ghosts: this.ghosts, blobs: this.blobs, camera: this.camera });
    this.names.sync(this.labels, this.camera, cam.viewW, cam.viewH, FOV);
    if (this.plazaLogo) {
      const dx = this.camera.position.x - this.plazaLogo.position.x;
      const dz = this.camera.position.z - this.plazaLogo.position.z;
      this.plazaLogo.rotation.y = Math.atan2(dx, dz);
    }
    this.drawPath(extras.path);
    if (this.marker) {
      this.marker.visible = Boolean(extras.marker);
      if (extras.marker) {
        this.marker.position.set(extras.marker.x, 2, extras.marker.y);
        this.marker.scale.setScalar(1 + Math.sin(t * 8) * 0.08);
      }
    }
    const me = avatars.find((avatar) => avatar.id === extras.selfId);
    if (this.proxRing && me) {
      this.proxRing.visible = extras.proximity;
      this.proxRing.position.set(me.x, 0.8, me.y);
    }
    renderer.render(this.scene, this.camera);
  }

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
    for (const rig of this.full.values()) disposeRig(rig);
    for (const rig of this.mids.values()) disposeRig(rig);
    this.full.clear();
    this.mids.clear();
    this.names.dispose();
    this.crowd.dispose();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) {
        if (item.userData.shared) continue;
        const mapped = item as THREE.MeshBasicMaterial;
        if (mapped.map && !mapped.map.userData.shared) mapped.map.dispose();
        item.dispose();
      }
    });
    clearFaceTextures();
    clearSharedResources();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.ok = false;
  }

  private noteFrame() {
    const now = performance.now();
    if (this.frameStamp) {
      const frame = now - this.frameStamp;
      this.samples.push(frame);
      if (this.samples.length >= 24) {
        const avg = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
        this.fps = avg > 0 ? Math.round(1000 / avg) : 0;
        const next = govern(this.profile, avg, { mobile: this.mobile, devicePixelRatio: this.deviceCap });
        this.samples = [];
        if (next.tier !== this.profile.tier || next.pixelRatio !== this.profile.pixelRatio || next.shadows !== this.profile.shadows) {
          this.profile = next;
          this.applyProfile();
        }
      }
    }
    this.frameStamp = now;
  }

  private applyProfile() {
    const renderer = this.renderer;
    if (!renderer || this.viewW < 2) return;
    renderer.shadowMap.enabled = this.profile.shadows;
    if (this.keyLight) this.keyLight.castShadow = this.profile.shadows;
    renderer.setPixelRatio(this.profile.pixelRatio);
    renderer.setSize(this.viewW, this.viewH, false);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
  }

  private placeRig(map: Map<string, Rig>, id: string, key: string, build: () => Rig) {
    let rig = map.get(id);
    if (!rig || rig.key !== key) {
      const yaw = rig?.yaw ?? 0;
      const phase = rig?.phase ?? (Math.abs(hash(id) % 628) / 100);
      if (rig) disposeRig(rig);
      rig = build();
      rig.key = key;
      rig.yaw = yaw;
      rig.phase = phase;
      this.actors.add(rig.anchor);
      map.set(id, rig);
    }
    return rig;
  }

  private drop(map: Map<string, Rig>, id: string) {
    const rig = map.get(id);
    if (!rig) return;
    disposeRig(rig);
    map.delete(id);
  }

  private instanceId(object: THREE.Object3D, instanceId: number | undefined) {
    if (instanceId == null) return '';
    if (object === this.crowd.billboards) return this.crowd.billboardIds[instanceId] || '';
    if (object === this.crowd.ghostHead || object === this.crowd.ghostBody || object === this.crowd.ghostLegs) {
      return this.crowd.ghostIds[instanceId] || '';
    }
    return '';
  }

  private buildOffice(world: World, anisotropy: number) {
    const width = world.w * TILE;
    const depth = world.h * TILE;
    this.scene.background = new THREE.Color('#8ec8ef');
    this.scene.fog = new THREE.Fog('#b7dff3', 1400, 4200);
    this.scene.add(new THREE.HemisphereLight(0xfff6e4, 0x3e6a34, 0.72));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const key = new THREE.DirectionalLight(0xfff3d6, 1.35);
    key.castShadow = this.profile.shadows;
    key.layers.enable(1);
    key.shadow.mapSize.set(512, 512);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.04;
    this.scene.add(key, key.target);
    this.keyLight = key;
    const fill = new THREE.DirectionalLight(0x9ecbff, 0.38);
    fill.position.set(-300, 220, -200);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd978, 0.28);
    rim.position.set(180, 160, 320);
    this.scene.add(rim);

    const ground = new THREE.Group();
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(width + 400, depth + 400), grassMaterial(anisotropy));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(width / 2, 0, depth / 2);
    ground.add(grass);
    const road = world.def.road;
    const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, road.h * TILE), sharedStandard('#4B4F58', 0.85));
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.set(width / 2, 0.04, (road.y + road.h / 2) * TILE);
    ground.add(roadMesh);
    const building = world.def.building;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(building.w * TILE, 1.2, building.h * TILE), sharedStandard('#F3EFE6', 0.9));
    slab.position.set((building.x + building.w / 2) * TILE, 0.6, (building.y + building.h / 2) * TILE);
    ground.add(slab);
    const plaza = world.def.plaza;
    const plazaMesh = new THREE.Mesh(new THREE.CircleGeometry(plaza.r * TILE, 28), sharedStandard('#E7D7A1', 0.8));
    plazaMesh.rotation.x = -Math.PI / 2;
    plazaMesh.position.set(plaza.cx * TILE, 1.35, plaza.cy * TILE);
    const plazaRing = new THREE.Mesh(new THREE.TorusGeometry(plaza.r * TILE, 1.4, 6, 28), sharedStandard('#D4AF37', 0.35));
    plazaRing.rotation.x = Math.PI / 2;
    plazaRing.position.set(plaza.cx * TILE, 1.8, plaza.cy * TILE);
    ground.add(plazaMesh, plazaRing);
    this.plazaAt.set(plaza.cx * TILE, 46, plaza.cy * TILE);

    for (const room of world.def.rooms) {
      const rect = room.rect;
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry((rect.w - 1.2) * TILE, 0.6, (rect.h - 1.2) * TILE),
        sharedStandard(room.floor || '#F7F1E6', 0.88),
      );
      floor.position.set((rect.x + rect.w / 2) * TILE, 1.15, (rect.y + rect.h / 2) * TILE);
      ground.add(floor);
    }
    for (const object of world.def.objects) ground.add(furnish(object));
    this.scene.add(this.finishChunk(ground));

    const walls: { x: number; z: number }[] = [];
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (world.cell(x, y) === Cell.Wall) walls.push({ x, z: y });
      }
    }
    if (walls.length) {
      const geo = new THREE.BoxGeometry(TILE * 0.96, WALL_H, TILE * 0.96);
      const mesh = new THREE.InstancedMesh(geo, sharedStandard('#F7F1E4', 0.78), walls.length);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      const trim = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE * 0.98, 3.2, TILE * 0.98), sharedStandard('#E0A800', 0.4), walls.length);
      trim.frustumCulled = false;
      const dummy = new THREE.Object3D();
      walls.forEach((wall, index) => {
        dummy.position.set((wall.x + 0.5) * TILE, WALL_H / 2 + 1, (wall.z + 0.5) * TILE);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        dummy.position.set((wall.x + 0.5) * TILE, WALL_H + 2.2, (wall.z + 0.5) * TILE);
        dummy.updateMatrix();
        trim.setMatrixAt(index, dummy.matrix);
      });
      this.scene.add(mesh, trim);
    }
  }

  private finishChunk(group: THREE.Group) {
    const baked = bakeStatic(group);
    releaseChunk(group);
    return baked;
  }

  private drawPath(path: { x: number; y: number }[]) {
    const count = Math.min(path.length, 120);
    for (let i = 0; i < count; i++) this.pathAttr.setXYZ(i, path[i].x, 3, path[i].y);
    this.pathAttr.needsUpdate = true;
    this.pathGeo.setDrawRange(0, count);
  }
}

function hash(value: string) {
  let n = 0;
  for (const char of value) n = (n * 33 + char.charCodeAt(0)) >>> 0;
  return n;
}

function grassMaterial(anisotropy: number) {
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
  return sharedTextured('grass', texture, '#ffffff', 0.95);
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
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(tall ? 16 : 11, 8, 6), lit('#2F9E44', 0.7));
    leaves.position.y = tall ? 28 : 16;
    group.add(leaves);
  } else if (kind === 'cactus') {
    const body = box(8, 22, 8, '#3D8C4A');
    body.position.y = 14;
    const arm = box(12, 6, 6, '#3D8C4A');
    arm.position.set(6, 18, 0);
    group.add(body, arm);
  } else if (kind === 'tree' || kind === 'blossom') {
    const trunk = cylinder(4, 18, '#6B4A2E', 0, 16, 0);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(18, 8, 6), lit(kind === 'blossom' ? '#E59AAD' : '#3E8F45', 0.75));
    canopy.position.y = 34;
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
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(tall ? 5 : 4, 8, 6), lit('#FFE7A3', 0.3, '#FFE7A3', 0.7));
    bulb.position.y = tall ? 52 : 32;
    group.add(bulb);
  } else if (kind === 'rug') {
    const rug = box(w * 0.92, 0.5, d * 0.92, object.variant === 1 ? '#C4A574' : '#D8E4EA');
    rug.position.y = 1.6;
    group.add(rug);
  } else if (kind === 'pumpkin') {
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(8, 8, 6), lit('#E07A2F', 0.55));
    pumpkin.scale.y = 0.8;
    pumpkin.position.y = 8;
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
  return new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.4, w), Math.max(0.4, h), Math.max(0.4, d)),
    lit(color, 0.62, emissive),
  );
}

function cylinder(radius: number, height: number, color: string, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 8), lit(color, 0.7));
  mesh.position.set(x, y, z);
  return mesh;
}

function lit(color: string, roughness = 0.5, emissive?: string, emissiveIntensity?: number) {
  return sharedStandard(color, roughness, emissive || '#000000', 1, emissiveIntensity);
}
