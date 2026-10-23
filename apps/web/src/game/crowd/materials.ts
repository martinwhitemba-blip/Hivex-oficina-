import * as THREE from 'three';

const materials = new Map<string, THREE.Material>();
const geometries = new Map<string, THREE.BufferGeometry>();

export function sharedStandard(color: string, roughness = 0.5, emissive = '#000000', opacity = 1, emissiveIntensity?: number) {
  const intensity = emissiveIntensity ?? (emissive.toLowerCase() !== '#000000' ? 0.45 : 0);
  const key = `std|${color}|${roughness}|${emissive}|${opacity}|${intensity}`;
  const cached = materials.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.06,
    emissive,
    emissiveIntensity: intensity,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
  material.userData.shared = true;
  material.userData.key = key;
  materials.set(key, material);
  return material;
}

export function sharedBasic(key: string, color: string, map?: THREE.Texture | null, opacity = 1) {
  const id = `basic|${key}|${color}|${opacity}|${map?.uuid ?? ''}`;
  const cached = materials.get(id);
  if (cached) return cached as THREE.MeshBasicMaterial;
  const material = new THREE.MeshBasicMaterial({
    color,
    map: map ?? null,
    transparent: opacity < 1 || Boolean(map),
    opacity,
    depthWrite: opacity >= 1 && !map,
    toneMapped: false,
  });
  material.userData.shared = true;
  material.userData.key = id;
  materials.set(id, material);
  return material;
}

export function sharedTextured(key: string, map: THREE.Texture, color: string, roughness: number) {
  const cached = materials.get(key);
  if (cached) return cached as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({ map, color, roughness, metalness: 0 });
  material.userData.shared = true;
  material.userData.key = key;
  materials.set(key, material);
  return material;
}

let shadowMaterial: THREE.MeshBasicMaterial | null = null;

export function shadowProxyMaterial() {
  if (shadowMaterial) return shadowMaterial;
  shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  shadowMaterial.userData.shared = true;
  shadowMaterial.userData.keep = true;
  shadowMaterial.userData.key = 'shadow-proxy';
  materials.set('shadow-proxy', shadowMaterial);
  return shadowMaterial;
}

export function sharedGeo(key: string, build: () => THREE.BufferGeometry) {
  const cached = geometries.get(key);
  if (cached) return cached;
  const geometry = build();
  geometry.userData.shared = true;
  geometries.set(key, geometry);
  return geometry;
}

export function fadedMaterial(material: THREE.Material, opacity: number) {
  const basic = material as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial) {
    return sharedBasic(String(basic.userData.key || basic.uuid), `#${basic.color.getHexString()}`, basic.map, opacity);
  }
  const standard = material as THREE.MeshStandardMaterial;
  return sharedStandard(
    `#${standard.color.getHexString()}`,
    standard.roughness,
    `#${standard.emissive.getHexString()}`,
    opacity,
    standard.emissiveIntensity,
  );
}

export function shadeColor(hex: string, amount: number) {
  const color = new THREE.Color(hex);
  const target = amount < 0 ? new THREE.Color('#000000') : new THREE.Color('#ffffff');
  return `#${color.lerp(target, Math.min(1, Math.abs(amount))).getHexString()}`;
}

export function clearSharedResources() {
  for (const material of materials.values()) {
    const mapped = material as THREE.MeshStandardMaterial;
    mapped.map?.dispose();
    material.dispose();
  }
  materials.clear();
  shadowMaterial = null;
  for (const geometry of geometries.values()) geometry.dispose();
  geometries.clear();
}
