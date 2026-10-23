/**
 * ⚠️ DATOS DE EJEMPLO (FAKE) ⚠️
 * Todo lo de este archivo es inventado para el prototipo: miembros, ventas,
 * citas y rankings. En producción vendrá del backend / CRM.
 */
import type { AvatarLook, Role, StatusId } from '../game/types';

export interface MemberSeed {
  id: string;
  name: string;
  role: Role;
  status: StatusId;
  desk: string;           // seatId del escritorio asignado
  look: AvatarLook;
  /** Comportamiento simulado: 'desk' se queda en su puesto, 'wander' pasea, 'chat' charla en la plaza. */
  behaviour: 'desk' | 'wander' | 'chat';
  chatSpot?: { x: number; y: number }; // tile, para 'chat'
  isNew?: boolean;
}

const L = (skin: string, hair: string, hairStyle: AvatarLook['hairStyle'], shirt: string, pants = '#2D3142', glasses = false): AvatarLook =>
  ({ skin, hair, hairStyle, shirt, pants, glasses });

/** DATOS DE EJEMPLO: compañeros simulados (NPC). */
export const SAMPLE_MEMBERS: MemberSeed[] = [
  { id: 'lucia',   name: 'Lucía Fernández', role: 'Director comercial', status: 'en_reunion', desk: 'despacho-0', behaviour: 'desk', look: L('#F1C7A5', '#5B3A29', 1, '#1F2937', '#111827', true) },
  { id: 'javier',  name: 'Javier Ruiz',     role: 'Closer', status: 'en_linea',   desk: 'atlas-1',   behaviour: 'chat', chatSpot: { x: 33.2, y: 20.6 }, look: L('#E0AC85', '#1F1A17', 0, '#2563EB') },
  { id: 'carmen',  name: 'Carmen Ortiz',    role: 'SDR',    status: 'en_linea',   desk: 'atlas-0',   behaviour: 'chat', chatSpot: { x: 34.6, y: 20.2 }, look: L('#F3D2B8', '#B45309', 1, '#DB2777'), isNew: true },
  { id: 'diego',   name: 'Diego Navarro',   role: 'SDR',    status: 'en_llamada', desk: 'atlas-3',   behaviour: 'desk', look: L('#C68B62', '#2B2118', 3, '#059669') },
  { id: 'sofia',   name: 'Sofía Morales',   role: 'Closer', status: 'en_llamada', desk: 'vega-0',    behaviour: 'desk', look: L('#F5D0B5', '#111111', 2, '#7C3AED', '#1F2937', true) },
  { id: 'andres',  name: 'Andrés Vidal',    role: 'SDR',    status: 'cafe',       desk: 'vega-4',    behaviour: 'desk', look: L('#D9A27E', '#6B4F3A', 0, '#EA580C') },
  { id: 'valeria', name: 'Valeria Castro',  role: 'Closer', status: 'en_linea',   desk: 'abierta-1', behaviour: 'wander', look: L('#8D5A3B', '#0F0F0F', 1, '#0EA5E9') },
  { id: 'pablo',   name: 'Pablo Herrera',   role: 'SDR',    status: 'ausente',    desk: 'vega-2',    behaviour: 'desk', look: L('#EBC0A0', '#A16207', 0, '#64748B'), isNew: true },
  { id: 'marta',   name: 'Marta Gil',       role: 'Customer Success', status: 'en_reunion', desk: 'abierta-5', behaviour: 'desk', look: L('#F0C9A8', '#7F1D1D', 2, '#16A34A') },
];

/** DATOS DE EJEMPLO: miembros desconectados (solo aparecen en la lista). */
export const SAMPLE_OFFLINE: { name: string; role: Role }[] = [
  { name: 'Adrián López', role: 'SDR' },
  { name: 'Elena Prieto', role: 'Closer' },
  { name: 'Raúl Campos', role: 'SDR' },
  { name: 'Nuria Sanz', role: 'Closer' },
];

/** DATOS DE EJEMPLO: métricas del día para la barra superior. */
export const SAMPLE_STATS = {
  ventasHoy: 1,
  importeHoy: 2000,
  citasHoy: 36,
  proximaCita: { hora: '20:00', con: 'Francisco' },
  seguimientoPendiente: 33,
  reunionesRestantes: 0,
};

/** DATOS DE EJEMPLO: rankings que se pintan en las pizarras del mapa. */
export const SAMPLE_RANKINGS = {
  ventas: {
    title: 'RANKING HOY',
    subtitle: 'Ventas (€)',
    rows: [
      { name: 'Sofía M.', value: 2000, fmt: '€' },
      { name: 'Javier R.', value: 1450, fmt: '€' },
      { name: 'Valeria C.', value: 900, fmt: '€' },
      { name: 'Andrés V.', value: 400, fmt: '€' },
    ],
  },
  citas: {
    title: 'RANKING CITAS',
    subtitle: 'Citas agendadas',
    rows: [
      { name: 'Carmen O.', value: 9, fmt: '' },
      { name: 'Diego N.', value: 7, fmt: '' },
      { name: 'Pablo H.', value: 6, fmt: '' },
      { name: 'Andrés V.', value: 5, fmt: '' },
    ],
  },
};

/** DATOS DE EJEMPLO: jugador local por defecto. */
export const SAMPLE_PLAYER = {
  id: 'me',
  name: 'Martin White',
  role: 'Propietario' as Role,
  look: L('#EFC3A0', '#3B2A20', 0, '#E0A800', '#1F2937') as AvatarLook,
};

/** Formatea 2000 → "2.000 €" (es-ES no agrupa números de 4 cifras por defecto). */
export const fmtNum = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const fmtEuro = (n: number) => fmtNum(n) + ' €';
