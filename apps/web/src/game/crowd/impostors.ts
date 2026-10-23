import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonGradient } from './materials';

export interface BillboardSpot { x: number; y: number; color: string; dim: boolean; sitting: boolean }
export interface GhostSpot { x: number; y: number; skin: string; shirt: string; pants: string }
export interface BlobSpot { x: number; y: number }

/** Multitud lejana e inactivos: pocos draws para muchos cuerpos. */
export class CrowdExtras {
  readonly billboards: THREE.InstancedMesh;
  readonly ghostHead: THREE.InstancedMesh;
  readonly ghostBody: THREE.InstancedMesh;
  readonly ghostLegs: THREE.InstancedMesh;
  readonly blobs: THREE.InstancedMesh;
  billboardIds: string[] = [];
  ghostIds: string[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private max: number;

  constructor(max = 220) {
    this.max = max;
    const person = personTexture();
    const boardGeo = new THREE.PlaneGeometry(1, 1);
    const boardMat = new THREE.MeshBasicMaterial({ map: person, transparent: true, depthWrite: false, toneMapped: false });
    this.billboards = makeInstances(boardGeo, boardMat, max);
    this.billboards.renderOrder = 3;

    const ghostMat = (opacity: number) => new THREE.MeshToonMaterial({
      color: '#ffffff', gradientMap: toonGradient(), transparent: true, opacity, depthWrite: false,
    });
    this.ghostHead = makeInstances(seatedHead(), ghostMat(0.45), max);
    this.ghostBody = makeInstances(seatedBody(), ghostMat(0.42), max);
    this.ghostLegs = makeInstances(seatedLegs(), ghostMat(0.4), max);

    const blobGeo = new THREE.CircleGeometry(11, 14);
    blobGeo.rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ color: '#1a1a1e', transparent: true, opacity: 0.28, depthWrite: false });
    this.blobs = makeInstances(blobGeo, blobMat, max);
    this.blobs.renderOrder = 1;
    this.blobs.raycast = () => {};
  }

  sync(input: {
    billboards: (BillboardSpot & { id: string })[];
    ghosts: (GhostSpot & { id: string })[];
    blobs: BlobSpot[];
    camera: THREE.Camera;
  }) {
    const boards = input.billboards.slice(0, this.max);
    this.billboardIds = boards.map((item) => item.id);
    boards.forEach((item, index) => {
      const height = item.sitting ? 42 : 64;
      const width = item.sitting ? 26 : 32;
      this.dummy.position.set(item.x, height / 2, item.y);
      this.dummy.quaternion.copy(input.camera.quaternion);
      this.dummy.scale.set(width, height, 1);
      this.dummy.updateMatrix();
      this.billboards.setMatrixAt(index, this.dummy.matrix);
      this.color.set(item.color);
      if (item.dim) this.color.multiplyScalar(0.45);
      this.billboards.setColorAt(index, this.color);
    });
    this.billboards.count = boards.length;
    this.billboards.instanceMatrix.needsUpdate = true;
    if (this.billboards.instanceColor) this.billboards.instanceColor.needsUpdate = true;

    const ghosts = input.ghosts.slice(0, this.max);
    this.ghostIds = ghosts.map((item) => item.id);
    ghosts.forEach((item, index) => {
      this.dummy.position.set(item.x, 0, item.y);
      this.dummy.quaternion.identity();
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.ghostHead.setMatrixAt(index, this.dummy.matrix);
      this.ghostBody.setMatrixAt(index, this.dummy.matrix);
      this.ghostLegs.setMatrixAt(index, this.dummy.matrix);
      this.ghostHead.setColorAt(index, this.color.set(item.skin));
      this.ghostBody.setColorAt(index, this.color.set(item.shirt));
      this.ghostLegs.setColorAt(index, this.color.set(item.pants));
    });
    for (const mesh of [this.ghostHead, this.ghostBody, this.ghostLegs]) {
      mesh.count = ghosts.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    const blobs = input.blobs.slice(0, this.max);
    blobs.forEach((item, index) => {
      this.dummy.position.set(item.x, 1.7, item.y);
      this.dummy.quaternion.identity();
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.blobs.setMatrixAt(index, this.dummy.matrix);
    });
    this.blobs.count = blobs.length;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.billboards, this.ghostHead, this.ghostBody, this.ghostLegs, this.blobs]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const material = mesh.material as THREE.MeshBasicMaterial & { gradientMap?: THREE.Texture | null };
      if (material.map && !material.map.userData.shared) material.map.dispose();
      if (!material.userData.shared) material.dispose();
    }
  }
}

function makeInstances(geo: THREE.BufferGeometry, material: THREE.Material, max: number) {
  const mesh = new THREE.InstancedMesh(geo, material, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

function personTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 256);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 58, 40, 0, Math.PI * 2);
  ctx.fill();
  round(ctx, 40, 104, 48, 58, 18);
  ctx.fill();
  ctx.fillStyle = '#595959';
  round(ctx, 42, 164, 16, 64, 8);
  ctx.fill();
  round(ctx, 70, 164, 16, 64, 8);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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

function seatedHead() {
  const geo = new THREE.SphereGeometry(11, 8, 6);
  geo.translate(0, 48, 0);
  return geo;
}

function seatedBody() {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  geo.scale(13, 11, 11);
  geo.translate(0, 32, 0);
  return geo;
}

function seatedLegs() {
  const left = new THREE.CapsuleGeometry(3.6, 8, 1, 5);
  left.translate(0, -5, 0);
  left.rotateX(-1.15);
  left.translate(-5, 20, 5);
  const right = new THREE.CapsuleGeometry(3.6, 8, 1, 5);
  right.translate(0, -5, 0);
  right.rotateX(-1.15);
  right.translate(5, 20, 5);
  return mergeGeometries([left, right], false) ?? left;
}
