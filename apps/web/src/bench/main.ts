/**
 * Banco de carga de la oficina 3D. No entra en el build de la app:
 * solo se abre con /bench.html para medir FPS y llamadas de dibujo.
 */
import { TILE } from '../config';
import { officeMap } from '../data/officeMap';
import { Camera } from '../game/camera';
import { localCrowd } from '../game/crowd/load';
import type { StageExtras } from '../game/stage3d';
import { Stage3D } from '../game/stage3d';
import type { Avatar } from '../game/entities';
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
  const pose = params.get('pose') || '';
  const photo = pose ? await portrait() : undefined;
  const focus = avatars[Math.floor(avatars.length / 2)] ?? avatars[0];
  if (pose && pose !== 'pizarra' && pose !== 'multitud') {
    avatars.forEach((avatar, index) => {
      avatar.ghost = false;
      avatar.x = focus.x + (index - 2) * 46;
      avatar.y = focus.y;
      avatar.sitting = false;
      avatar.moving = false;
    });
  }
  arrange(pose, avatars, photo);
  const lookAt = pose === 'pizarra' ? { x: (15 + 1.5) * TILE, y: (5 + 2.2) * TILE } : { x: focus.x, y: focus.y };
  if (pose && pose !== 'multitud') camera.zoom = pose === 'pizarra' ? 2.2 : 4.2;
  else camera.zoom = 0.6;
  camera.follow(lookAt.x, lookAt.y, 0, true);
  const stage = await Stage3D.mount(canvas, world);
  if (pose === 'pizarra') stage.setAreas([{ roomId: 'atlas', areaId: 'atlas' }]);
  const extras = sceneExtras(pose, avatars);
  const pump = (frames: number) => {
    let t = 0;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      t += 1 / 60;
      stage.render(avatars, camera, window.devicePixelRatio || 1, t + 0.4, (look) => (look.usePhoto ? photo : undefined), extras);
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

function arrange(pose: string, avatars: Avatar[], photo: HTMLImageElement | undefined) {
  const [a, b, c] = avatars;
  const until = performance.now() + 60_000;
  if (!a) return;
  if (pose === 'caras' && photo) {
    a.look = { ...a.look, usePhoto: true, photoUrl: 'cara', photoPlacement: 'cara' };
    a.emote = { id: '👋', until };
    if (b) {
      b.look = { ...b.look, usePhoto: true, photoUrl: 'gafete', photoPlacement: 'gafete', glasses: true };
      b.emote = { id: '😉', until };
    }
    if (c) c.emote = { id: '🎉', until };
  }
  if (pose === 'gesto') {
    a.emote = { id: '🙌', until };
    if (b) {
      b.x = a.x + 48;
      b.y = a.y;
      b.emote = { id: '🙌', until };
    }
    if (c) c.emote = { id: '👏', until };
  }
  if (pose === 'burbuja') a.bubble = { text: '¡Voy a por café!', until };
  if (pose === 'tarea') a.sitting = false;
  if (pose === 'paquete' && b) {
    b.x = a.x + 90;
    b.y = a.y;
  }
}

function sceneExtras(pose: string, avatars: Avatar[]): StageExtras {
  const extras: StageExtras = { selfId: avatars[0]?.id || 'bench', selfLabel: '', path: [], marker: null, proximity: false };
  const hero = avatars[0];
  const mate = avatars[1];
  if (pose === 'tarea' && hero) {
    extras.duties = [{
      avatarId: hero.id, taskId: 'carta', title: 'Llamar al cliente oro', time: '1:15',
      overdue: true, done: 1, total: 2, x: hero.x, y: 112, z: hero.y,
    }];
  }
  if (pose === 'burbuja' && hero) extras.duties = [];
  if (pose === 'paquete' && hero && mate) {
    extras.packages = [{ x: (hero.x + mate.x) / 2, y: 78, z: (hero.y + mate.y) / 2 }];
  }
  if (pose === 'pizarra') {
    extras.boardWords = { pending: 'En cola', doing: 'En juego', done: '¡Listo!', mission: 'Misión {n}%' };
    extras.areas = [{ areaId: 'atlas', tally: { pending: 4, doing: 2, done: 7, pct: 60 } }];
  }
  return extras;
}

async function portrait() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2E6BFF';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#F6D7A8';
  ctx.beginPath();
  ctx.arc(64, 54, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1A1420';
  ctx.beginPath();
  ctx.arc(50, 50, 5, 0, Math.PI * 2);
  ctx.arc(78, 50, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1A1420';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(64, 72, 16, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  const image = new Image();
  image.src = canvas.toDataURL();
  await image.decode();
  return image;
}

void main();
