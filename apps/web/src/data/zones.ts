import type { MapDefinition, RoomDef } from '../game/types';
import { officeMap } from './officeMap';

const EXTRA: Record<string, RoomDef> = {
  'banda-oeste': { id: 'banda-oeste', name: 'Banda oeste', label: 'OESTE', kind: 'open', walls: false, rect: { x: 7, y: 20, w: 14, h: 7 }, floor: '#E7F0E4', accent: '#86EFAC', labelPos: { x: 14, y: 20.15 } },
  'banda-este': { id: 'banda-este', name: 'Banda este', label: 'ESTE', kind: 'open', walls: false, rect: { x: 50, y: 20, w: 14, h: 7 }, floor: '#E8EEF8', accent: '#93C5FD', labelPos: { x: 57, y: 20.15 } },
  'banda-norte': { id: 'banda-norte', name: 'Banda norte', label: 'NORTE', kind: 'open', walls: false, rect: { x: 28, y: 16, w: 16, h: 3 }, floor: '#F8EFE3', accent: '#F5C518', labelPos: { x: 36, y: 16.05 } },
  'banda-sur': { id: 'banda-sur', name: 'Banda sur', label: 'SUR', kind: 'open', walls: false, rect: { x: 30, y: 27, w: 12, h: 3 }, floor: '#F3E8FF', accent: '#C4B5FD', labelPos: { x: 36, y: 27.05 } },
};

export function cloneOfficeMap(): MapDefinition {
  return structuredClone(officeMap);
}

export function applyRooms(map: MapDefinition, rooms: { mapRoomId: string; name: string; label?: string }[]) {
  for (const room of rooms) {
    let target = map.rooms.find((item) => item.id === room.mapRoomId);
    if (!target && EXTRA[room.mapRoomId]) {
      target = structuredClone(EXTRA[room.mapRoomId]);
      map.rooms.push(target);
    }
    if (!target) continue;
    if (room.name) target.name = room.name;
    if (room.label) target.label = room.label;
  }
}

export const ZONE_LAYOUT = [
  { id: 'atlas', x: 8, y: 8, w: 28, h: 22 },
  { id: 'reunion', x: 38, y: 8, w: 24, h: 18 },
  { id: 'vega', x: 64, y: 8, w: 28, h: 22 },
  { id: 'banda-norte', x: 38, y: 28, w: 24, h: 10 },
  { id: 'banda-oeste', x: 8, y: 32, w: 28, h: 16 },
  { id: 'banda-sur', x: 38, y: 40, w: 24, h: 12 },
  { id: 'abierta', x: 38, y: 54, w: 24, h: 22 },
  { id: 'cafe', x: 8, y: 52, w: 28, h: 24 },
  { id: 'lounge', x: 64, y: 34, w: 14, h: 18 },
  { id: 'banda-este', x: 78, y: 34, w: 14, h: 18 },
  { id: 'despacho', x: 64, y: 54, w: 28, h: 22 },
];
