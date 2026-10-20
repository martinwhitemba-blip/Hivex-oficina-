/**
 * Definición del mapa de la oficina (datos editables).
 *
 * Coordenadas en TILES (1 tile = 32 px). Los rectángulos de sala incluyen el
 * perímetro de paredes; las puertas son huecos en ese perímetro.
 * Para editar la oficina: mueve salas/objetos aquí. El motor genera la
 * colisión y el render a partir de estos datos.
 *
 * El objeto exportado es JSON puro (se podría cargar desde un .json o desde
 * un futuro editor de mapas sin tocar el motor).
 */
import type { MapDefinition, MapObject } from '../game/types';

const objects: MapObject[] = [];
const add = (...o: MapObject[]) => objects.push(...o);

/** Fila de escritorios con silla debajo. `prefix` genera ids de asiento: atlas-0, atlas-1... */
function deskRow(prefix: string, startIndex: number, xs: number[], y: number, monitors = 2) {
  xs.forEach((x, i) => add({ type: 'desk', x, y, w: 2, h: 1, variant: monitors, seatId: `${prefix}-${startIndex + i}` }));
}

// ───────────────────────── Equipo ATLAS (arriba izquierda) ─────────────────────────
deskRow('atlas', 0, [8, 12, 16], 8);
deskRow('atlas', 3, [8, 12, 16], 13);
add(
  { type: 'tv', x: 10, y: 5, w: 3, text: 'LLAMADAS 128' },
  { type: 'whiteboard', x: 15, y: 5, w: 3 },
  { type: 'plant', x: 7, y: 6 }, { type: 'cactus', x: 21, y: 6 },
  { type: 'tallPlant', x: 7, y: 17 }, { type: 'lamp', x: 21, y: 16 },
  { type: 'printer', x: 20, y: 10 },
);

// ───────────────────────── Equipo VEGA (arriba derecha) ─────────────────────────
deskRow('vega', 0, [51, 55, 59], 8);
deskRow('vega', 3, [51, 55, 59], 13);
add(
  { type: 'tv', x: 53, y: 5, w: 3, text: 'CITAS 36' },
  { type: 'whiteboard', x: 58, y: 5, w: 3 },
  { type: 'plant', x: 64, y: 6 }, { type: 'cactus', x: 50, y: 6 },
  { type: 'tallPlant', x: 64, y: 17 }, { type: 'lamp', x: 63, y: 9 },
  { type: 'waterCooler', x: 63, y: 13 },
);

// ───────────────────────── Sala de reuniones (arriba centro) ─────────────────────────
add({ type: 'rug', x: 30, y: 7, w: 12, h: 5 });
add({ type: 'meetingTable', x: 31, y: 8, w: 10, h: 3 });
[32, 34, 37, 39].forEach((x, i) => {
  add({ type: 'chair', x, y: 7, dir: 'down', seatId: `reunion-${i}` });
  add({ type: 'chair', x, y: 11, dir: 'up', seatId: `reunion-${i + 4}` });
});
add(
  { type: 'chair', x: 30, y: 9, dir: 'right', seatId: 'reunion-8' },
  { type: 'chair', x: 41, y: 9, dir: 'left', seatId: 'reunion-9' },
  { type: 'tv', x: 33, y: 4, w: 6, text: 'Q4 · PIPELINE' },
  { type: 'plant', x: 28, y: 6 }, { type: 'plant', x: 43, y: 6 },
  { type: 'tallPlant', x: 28, y: 12 }, { type: 'lamp', x: 43, y: 12 },
);

// ───────────────────────── Café / Cocina (abajo izquierda) ─────────────────────────
add(
  { type: 'counter', x: 7, y: 29, w: 6, h: 1 },
  { type: 'fridge', x: 19, y: 29, w: 1, h: 2 },
  { type: 'roundTable', x: 9, y: 33, w: 2, h: 2 },
  { type: 'roundTable', x: 16, y: 33, w: 2, h: 2 },
  { type: 'stool', x: 8, y: 33, seatId: 'cafe-0' }, { type: 'stool', x: 11, y: 34, seatId: 'cafe-1' },
  { type: 'stool', x: 15, y: 34, seatId: 'cafe-2' }, { type: 'stool', x: 18, y: 33, seatId: 'cafe-3' },
  { type: 'sofa', x: 8, y: 38, w: 4, h: 1, dir: 'up', variant: 1 },
  { type: 'sofa', x: 15, y: 38, w: 4, h: 1, dir: 'up', variant: 1 },
  { type: 'plant', x: 21, y: 29 }, { type: 'cactus', x: 7, y: 36 }, { type: 'cactus', x: 21, y: 38 },
  { type: 'lamp', x: 13, y: 38 },
);

// ───────────────────────── Zona abierta (abajo centro, sin paredes) ─────────────────────────
deskRow('abierta', 0, [29, 33, 37, 41], 31, 1);
deskRow('abierta', 4, [29, 33, 37, 41], 35, 1);
add({ type: 'tallPlant', x: 27, y: 30 }, { type: 'tallPlant', x: 44, y: 30 }, { type: 'plant', x: 27, y: 38 }, { type: 'plant', x: 44, y: 38 });

// ───────────────────────── Despacho privado (abajo derecha) ─────────────────────────
add(
  { type: 'rug', x: 56, y: 32, w: 7, h: 5, variant: 1 },
  { type: 'execDesk', x: 58, y: 33, w: 3, h: 1, seatId: 'despacho-0' },
  { type: 'bookshelf', x: 55, y: 29, w: 4, h: 1 }, { type: 'bookshelf', x: 60, y: 29, w: 3, h: 1 },
  { type: 'sofa', x: 57, y: 38, w: 4, h: 1, dir: 'up', variant: 2 },
  { type: 'tallPlant', x: 64, y: 30 }, { type: 'plant', x: 54, y: 38 }, { type: 'lamp', x: 64, y: 38 },
  { type: 'tv', x: 59, y: 28, w: 3, text: 'KPI' },
);

// ───────────────────────── Lounge / pasillos ─────────────────────────
add(
  { type: 'sofa', x: 48, y: 31, w: 1, h: 3, dir: 'left', variant: 0 },
  { type: 'plant', x: 50, y: 30 }, { type: 'cactus', x: 50, y: 38 }, { type: 'lamp', x: 47, y: 38 },
  { type: 'ranking', x: 24, y: 24, w: 4, h: 2, board: 'ventas' },
  { type: 'ranking', x: 44, y: 24, w: 4, h: 2, board: 'citas' },
  { type: 'plant', x: 23, y: 20 }, { type: 'plant', x: 48, y: 20 },
  { type: 'cactus', x: 26, y: 19 }, { type: 'cactus', x: 45, y: 19 },
  { type: 'tallPlant', x: 5, y: 19 }, { type: 'tallPlant', x: 66, y: 19 },
  { type: 'tallPlant', x: 5, y: 27 }, { type: 'tallPlant', x: 66, y: 27 },
  { type: 'plant', x: 32, y: 40 }, { type: 'plant', x: 39, y: 40 },
  { type: 'bench', x: 9, y: 19, w: 3, h: 1 }, { type: 'bench', x: 60, y: 19, w: 3, h: 1 },
);

// ───────────────────────── Exterior: jardín y calle ─────────────────────────
for (let y = 4; y <= 40; y += 4) {
  add({ type: y % 8 === 0 ? 'blossom' : 'tree', x: 1, y }, { type: y % 8 === 0 ? 'tree' : 'blossom', x: 70, y });
}
for (let x = 7; x <= 64; x += 5) add({ type: x % 2 ? 'tree' : 'blossom', x, y: 1 });
[6, 12, 18, 24, 44, 50, 56, 62].forEach((x) => add({ type: 'hedge', x, y: 42, w: 3, h: 1 }));
[10, 22, 49, 61].forEach((x) => add({ type: 'streetLamp', x, y: 43 }));
[4, 15, 28, 43, 56, 67].forEach((x, i) => add({ type: 'pumpkin', x, y: i % 2 ? 50 : 43 }));
[8, 20, 52, 64].forEach((x) => add({ type: x % 3 ? 'tree' : 'blossom', x, y: 50 }));

export const officeMap: MapDefinition = {
  width: 72,
  height: 52,
  building: { x: 4, y: 3, w: 64, h: 39 },
  entrance: { x: 34, w: 4 },
  road: { y: 45, h: 4 },
  plaza: { cx: 36, cy: 22.5, r: 4.4 },
  spawn: { x: 36, y: 27 },
  rooms: [
    {
      id: 'atlas', name: 'Equipo Atlas', label: 'EQUIPO ATLAS', kind: 'team', walls: true,
      rect: { x: 6, y: 5, w: 17, h: 14 },
      doors: [{ x: 22, y: 11, h: 2 }, { x: 13, y: 18, w: 3 }],
      floor: '#F6EEDD', accent: '#2BB3A3', labelPos: { x: 19, y: 18 },
    },
    {
      id: 'vega', name: 'Equipo Vega', label: 'EQUIPO VEGA', kind: 'team', walls: true,
      rect: { x: 49, y: 5, w: 17, h: 14 },
      doors: [{ x: 49, y: 11, h: 2 }, { x: 56, y: 18, w: 3 }],
      floor: '#F1ECF6', accent: '#8B6FD6', labelPos: { x: 53, y: 18 },
    },
    {
      id: 'reunion', name: 'Sala de reuniones', label: 'SALA DE REUNIONES', kind: 'meeting', walls: true,
      rect: { x: 27, y: 4, w: 18, h: 11 },
      doors: [{ x: 35, y: 14, w: 2 }],
      floor: '#EEF4F6', accent: '#3A8FD6', labelPos: { x: 31, y: 14 },
    },
    {
      id: 'cafe', name: 'Café / Cocina', label: 'CAFÉ', kind: 'cafe', walls: true,
      rect: { x: 6, y: 28, w: 17, h: 12 },
      doors: [{ x: 13, y: 28, w: 3 }, { x: 22, y: 33, h: 2 }],
      floor: '#F4E6D4', accent: '#C27A3A', labelPos: { x: 19, y: 28 },
    },
    {
      id: 'despacho', name: 'Despacho privado', label: 'DIRECCIÓN', kind: 'private', walls: true,
      rect: { x: 53, y: 28, w: 13, h: 12 },
      doors: [{ x: 53, y: 33, h: 2, locked: true }],
      floor: '#EFE6D6', accent: '#B8860B', labelPos: { x: 59.5, y: 39 },
    },
    {
      id: 'abierta', name: 'Zona abierta', label: 'ZONA ABIERTA', kind: 'open', walls: false,
      rect: { x: 27, y: 30, w: 18, h: 10 },
      floor: '#F3F0E8', accent: '#2BB3A3', labelPos: { x: 31.5, y: 29.4 },
    },
    {
      id: 'lounge', name: 'Zona de descanso', kind: 'lounge', walls: false,
      rect: { x: 46, y: 29, w: 6, h: 11 },
    },
  ],
  objects,
};
