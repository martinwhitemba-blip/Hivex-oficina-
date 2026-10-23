/** Gobernador de calidad a partir del tiempo de frame. Puro, sin DOM. */

export interface QualityProfile {
  tier: number;
  pixelRatio: number;
  shadows: boolean;
  fullCap: number;
  midCap: number;
  near: number;
  mid: number;
  ghostHide: number;
  shadowCap: number;
}

export interface DeviceHint {
  mobile: boolean;
  devicePixelRatio: number;
}

const FULL = [12, 8, 4, 2];
const MID = [16, 12, 8, 4];
const NEAR = [300, 220, 160, 110];
const FAR = [680, 520, 380, 260];
const GHOST = [1100, 800, 520, 360];
const FACTOR = [1, 0.85, 0.7, 0.55];

export function startingProfile(device: DeviceHint): QualityProfile {
  return realize(device.mobile ? 1 : 0, device);
}

export function govern(current: QualityProfile, averageFrameMs: number, device: DeviceHint): QualityProfile {
  const target = device.mobile ? 33 : 16.7;
  if (averageFrameMs > target * 1.35 && current.tier < 3) return realize(current.tier + 1, device);
  const floor = 0;
  if (averageFrameMs < target * 0.65 && current.tier > floor) return realize(current.tier - 1, device);
  return current;
}

function realize(tier: number, device: DeviceHint): QualityProfile {
  const clamped = Math.max(0, Math.min(3, tier));
  const cap = device.mobile ? 1.25 : 1.75;
  const base = Math.min(cap, Math.max(1, device.devicePixelRatio || 1));
  return {
    tier: clamped,
    pixelRatio: Math.max(0.7, Math.round(base * FACTOR[clamped] * 100) / 100),
    shadows: device.mobile ? false : clamped < 2,
    fullCap: FULL[clamped],
    midCap: MID[clamped],
    near: NEAR[clamped],
    mid: FAR[clamped],
    ghostHide: GHOST[clamped],
    shadowCap: 12,
  };
}
