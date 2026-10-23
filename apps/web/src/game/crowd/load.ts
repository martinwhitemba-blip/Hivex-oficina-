import { Avatar } from '../entities';
import type { AvatarLook } from '../types';

const SKINS = ['#F1C7A5', '#E0AC85', '#C68B62', '#8D5A3B', '#F3D2B8'];
const HAIR = ['#1F1A17', '#5B3A29', '#B45309', '#111111', '#A16207'];
const SHIRTS = ['#2563EB', '#DB2777', '#059669', '#7C3AED', '#EA580C', '#E0A800', '#0EA5E9'];
const PANTS = ['#1F2937', '#111827', '#2D3142'];
const NAMES = ['Ana', 'Luis', 'Noa', 'Leo', 'Mia', 'Eva', 'Iker', 'Zoe', 'Otto', 'Luz', 'Nora', 'Teo', 'Gala', 'Ron', 'Paz'];

function look(index: number): AvatarLook {
  return {
    skin: SKINS[index % SKINS.length],
    hair: HAIR[index % HAIR.length],
    hairStyle: (index % 4) as 0 | 1 | 2 | 3,
    shirt: SHIRTS[index % SHIRTS.length],
    pants: PANTS[index % PANTS.length],
    glasses: index % 5 === 0,
  };
}

/** Compañeros locales para el modo carga. No viajan por la red. */
export function localCrowd(count: number, originX: number, originY: number) {
  const avatars: Avatar[] = [];
  const safe = Math.max(0, Math.min(400, Math.floor(count)));
  const columns = Math.max(1, Math.ceil(Math.sqrt(safe)));
  const gap = 40;
  for (let i = 0; i < safe; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const avatar = new Avatar(
      `crowd-${i}`,
      `${NAMES[i % NAMES.length]} ${i + 1}`,
      'SDR',
      look(i),
      originX + col * gap,
      originY + row * gap,
    );
    avatar.crowd = true;
    avatar.moving = i % 3 !== 0;
    avatar.ghost = i % 5 === 0;
    avatar.sitting = avatar.ghost || i % 11 === 0;
    avatar.dir = (['down', 'up', 'left', 'right'] as const)[i % 4];
    if (i % 17 === 0) avatar.status = 'ausente';
    avatars.push(avatar);
  }
  return avatars;
}
