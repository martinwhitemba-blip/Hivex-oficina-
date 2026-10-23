/** Catálogo de salas y asientos del mapa (sincronizado con apps/web/src/data/officeMap.ts). */

export const MAP_ROOMS: { mapRoomId: string; name: string; label: string }[] = [
  { mapRoomId: 'atlas', name: 'Equipo Atlas', label: 'EQUIPO ATLAS' },
  { mapRoomId: 'vega', name: 'Equipo Vega', label: 'EQUIPO VEGA' },
  { mapRoomId: 'reunion', name: 'Sala de reuniones', label: 'SALA DE REUNIONES' },
  { mapRoomId: 'cafe', name: 'Café / Cocina', label: 'CAFÉ' },
  { mapRoomId: 'abierta', name: 'Zona abierta', label: 'ZONA ABIERTA' },
  { mapRoomId: 'despacho', name: 'Despacho privado', label: 'DIRECCIÓN' },
  { mapRoomId: 'lounge', name: 'Zona de descanso', label: 'DESCANSO' },
];

function seats(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

export const MAP_SEATS = [
  ...seats('atlas', 6),
  ...seats('vega', 6),
  ...seats('reunion', 10),
  ...seats('cafe', 4),
  ...seats('abierta', 8),
  'despacho-0',
];

export function roomIdForSeat(seatId: string) {
  if (seatId.startsWith('atlas')) return 'atlas';
  if (seatId.startsWith('vega')) return 'vega';
  if (seatId.startsWith('reunion')) return 'reunion';
  if (seatId.startsWith('cafe')) return 'cafe';
  if (seatId.startsWith('abierta')) return 'abierta';
  if (seatId.startsWith('despacho')) return 'despacho';
  return '';
}
