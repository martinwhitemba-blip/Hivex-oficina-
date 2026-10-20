/** A* sobre la rejilla de tiles (8 direcciones, sin cortar esquinas). */
import type { World } from './world';

export interface Pt { x: number; y: number }

export function findPath(world: World, from: Pt, to: Pt, maxNodes = 6000): Pt[] | null {
  if (!world.walkableTile(to.x, to.y)) return null;
  const W = world.w;
  const key = (x: number, y: number) => y * W + x;
  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const open: { k: number; f: number }[] = [];
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const start = key(from.x, from.y);
  g.set(start, 0);
  open.push({ k: start, f: h(from.x, from.y) });
  const closed = new Set<number>();
  let expanded = 0;

  while (open.length) {
    // Cola de prioridad simple (mapas pequeños: suficiente).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k } = open.splice(bi, 1)[0];
    if (closed.has(k)) continue;
    closed.add(k);
    const cx = k % W, cy = (k / W) | 0;
    if (cx === to.x && cy === to.y) {
      const path: Pt[] = [];
      let cur: number | undefined = k;
      while (cur !== undefined && cur !== start) { path.push({ x: cur % W, y: (cur / W) | 0 }); cur = came.get(cur); }
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!world.walkableTile(nx, ny)) continue;
        if (dx && dy && (!world.walkableTile(cx + dx, cy) || !world.walkableTile(cx, cy + dy))) continue;
        const nk = key(nx, ny);
        const ng = (g.get(k) ?? 0) + (dx && dy ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, k);
          open.push({ k: nk, f: ng + h(nx, ny) });
        }
      }
  }
  return null;
}

/** Busca el tile caminable más cercano a uno dado (para clics sobre muebles). */
export function nearestWalkable(world: World, p: Pt, maxR = 4): Pt | null {
  if (world.walkableTile(p.x, p.y)) return p;
  for (let r = 1; r <= maxR; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (world.walkableTile(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy };
      }
  return null;
}
