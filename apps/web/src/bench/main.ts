/**
 * Banco de carga de la oficina 3D. No entra en el build de la app:
 * solo se abre con /bench.html para medir FPS y llamadas de dibujo.
 */
import { TILE } from '../config';
import { officeMap } from '../data/officeMap';
import { Camera } from '../game/camera';
import { localCrowd } from '../game/crowd/load';
import { Stage3D } from '../game/stage3d';
import { World } from '../game/world';

async function main() {
  const params = new URLSearchParams(location.search);
  const count = Math.max(1, Math.min(400, Number(params.get('n') || 100)));
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const world = new World(officeMap);
  const camera = new Camera(officeMap.width * TILE, officeMap.height * TILE);
  const fit = () => {
    camera.resize(window.innerWidth, window.innerHeight);
    camera.setZoom(0.6);
  };
  fit();
  window.addEventListener('resize', fit);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const originX = officeMap.plaza.cx * TILE - ((columns - 1) * 40) / 2;
  const originY = officeMap.plaza.cy * TILE - ((columns - 1) * 40) / 2;
  const avatars = localCrowd(count, originX, originY);
  const focus = avatars[Math.floor(avatars.length / 2)] ?? avatars[0];
  camera.follow(focus.x, focus.y, 0, true);
  const stage = await Stage3D.mount(canvas, world);
  const extras = { selfId: 'bench', path: [] as { x: number; y: number }[], marker: null, proximity: false };
  const pump = (frames: number) => {
    let t = 0;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      t += 1 / 60;
      stage.render(avatars, camera, window.devicePixelRatio || 1, t, () => undefined, extras);
    }
    return (performance.now() - start) / frames;
  };
  const finish = (frameMs: number) => {
    const stats = stage.stats();
    const gl = (document.getElementById('stage3d') as HTMLCanvasElement | null)?.getContext('webgl2')
      || (document.getElementById('stage3d') as HTMLCanvasElement | null)?.getContext('webgl');
    const renderer = gl ? String(gl.getParameter(gl.RENDERER)) : '';
    (window as unknown as { __hivexBench: unknown }).__hivexBench = {
      ok: stage.ok,
      count,
      fps: frameMs > 0 ? Math.round((1000 / frameMs) * 10) / 10 : 0,
      frameMs: Math.round(frameMs * 100) / 100,
      calls: stats.calls,
      triangles: stats.triangles,
      pixelRatio: stats.pixelRatio,
      shadows: stats.shadows,
      tier: stats.tier,
      full: stats.full,
      mid: stats.mid,
      ghosts: stats.ghosts,
      billboards: stats.billboards,
      mobile: stats.mobile,
      renderer,
      dpr: window.devicePixelRatio,
      view: { w: window.innerWidth, h: window.innerHeight },
    };
  };
  (window as unknown as { __hivexBench: unknown }).__hivexBench = { ok: false, pending: true };
  if (!stage.ok) {
    finish(0);
    return;
  }
  pump(8);
  finish(pump(24));
}

void main();
