import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Une la oficina estática por material: un draw por color, no uno por mueble. */
export function bakeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.geometry) return;
    const material = mesh.material as THREE.Material;
    if (Array.isArray(material)) return;
    const key = String(material.userData.key || material.uuid);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material, geos: [] };
      buckets.set(key, bucket);
    }
    bucket.geos.push(coreGeometry(mesh.geometry, mesh.matrixWorld));
  });
  const baked = new THREE.Group();
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geos, false);
    bucket.geos.forEach((geo) => geo.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    baked.add(mesh);
  }
  return baked;
}

export function releaseChunk(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData.shared) mesh.geometry.dispose();
  });
}

function coreGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attr = source.getAttribute(name);
    if (attr) geo.setAttribute(name, attr.clone());
  }
  if (source.index) geo.setIndex(source.index.clone());
  geo.applyMatrix4(matrix);
  return geo;
}
