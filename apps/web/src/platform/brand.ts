export interface Marca {
  nombre: string;
  oficina: string;
  primario: string;
  acento: string;
  logoUrl: string | null;
  poweredBy: string;
}

const INK = '#0B0B0C';

export function applyMarca(marca: Marca | null) {
  const root = document.documentElement;
  const primary = marca?.primario || '#F5C518';
  const accent = marca?.acento || '#E0A800';
  root.style.setProperty('--gold', primary);
  root.style.setProperty('--gold-deep', accent);
  root.style.setProperty('--gold-soft', primary);
  root.style.setProperty('--line', hexAlpha(primary, 0.22));
  const name = marca?.nombre || 'HIVEX';
  const office = marca?.oficina || 'Oficina virtual';
  document.title = marca ? `${name} · ${office}` : 'HIVEX · Oficina virtual';
}

export function readableOnInk(color: string) {
  return contrast(color, INK) >= 3;
}

function contrast(a: string, b: string) {
  const left = rgb(a);
  const right = rgb(b);
  if (!left || !right) return 0;
  const hi = Math.max(lum(left), lum(right));
  const lo = Math.min(lum(left), lum(right));
  return (hi + 0.05) / (lo + 0.05);
}

function rgb(hex: string) {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lum(channels: number[]) {
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(channels[0]) + 0.7152 * lin(channels[1]) + 0.0722 * lin(channels[2]);
}

function hexAlpha(hex: string, alpha: number) {
  const channels = rgb(hex);
  if (!channels) return `rgba(245,197,24,${alpha})`;
  return `rgba(${channels[0]},${channels[1]},${channels[2]},${alpha})`;
}
