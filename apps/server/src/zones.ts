import { HttpError } from './http';
import { MAP_ROOMS } from './mapCatalog';
import { prisma } from './prisma';

/** Zonas extra que el cliente añade al plano cuando un área las ocupa. */
export const EXTRA_ZONES = [
  { mapRoomId: 'banda-oeste', name: 'Banda oeste', label: 'OESTE' },
  { mapRoomId: 'banda-este', name: 'Banda este', label: 'ESTE' },
  { mapRoomId: 'banda-norte', name: 'Banda norte', label: 'NORTE' },
  { mapRoomId: 'banda-sur', name: 'Banda sur', label: 'SUR' },
] as const;

export const ALL_ZONE_SLOTS = [
  ...MAP_ROOMS.map((room) => ({ mapRoomId: room.mapRoomId, name: room.name, label: room.label })),
  ...EXTRA_ZONES,
];

export async function assignFreeZone(companyId: string, areaId: string, name: string) {
  const used = new Set((await prisma.officeRoom.findMany({ where: { companyId } })).map((room) => room.mapRoomId));
  const slot = ALL_ZONE_SLOTS.find((item) => !used.has(item.mapRoomId));
  if (!slot) throw new HttpError(409, 'No quedan zonas libres en el plano. En esta beta el mapa tiene un número fijo de espacios.');
  const label = name.toLocaleUpperCase('es').slice(0, 22);
  return prisma.officeRoom.create({
    data: { companyId, areaId, mapRoomId: slot.mapRoomId, name, label },
  });
}
