/** Tipos compartidos del mundo. Todo serializable (JSON) para poder sincronizarlo por red más adelante. */

export type StatusId = 'en_linea' | 'ausente' | 'en_reunion' | 'cafe' | 'en_llamada';

export interface StatusDef {
  id: StatusId;
  label: string;
  color: string;
  emoji: string;
}

export type Role = string;

export type Dir = 'up' | 'down' | 'left' | 'right';

export type ZoneKind = 'team' | 'meeting' | 'cafe' | 'private' | 'plaza' | 'open' | 'lounge';

/** Rectángulo en coordenadas de tile (inclusivo en x..x+w-1, y..y+h-1). */
export interface TileRect { x: number; y: number; w: number; h: number }

export interface DoorDef { x: number; y: number; w?: number; h?: number; locked?: boolean }

export interface RoomDef {
  id: string;
  name: string;            // texto mostrado ("Sala de reuniones")
  label?: string;          // placa en la pared ("EQUIPO ATLAS")
  kind: ZoneKind;
  rect: TileRect;          // incluye el perímetro de paredes
  walls: boolean;          // si false es una zona abierta (sin paredes)
  doors?: DoorDef[];
  floor?: string;          // color de suelo
  accent?: string;         // color del rótulo
  labelPos?: { x: number; y: number }; // centro de la placa (tiles)
}

export type ObjectType =
  | 'desk' | 'execDesk' | 'chair' | 'stool' | 'meetingTable' | 'roundTable'
  | 'plant' | 'cactus' | 'tallPlant' | 'lamp' | 'tv' | 'whiteboard' | 'counter'
  | 'fridge' | 'sofa' | 'bookshelf' | 'ranking' | 'waterCooler' | 'printer'
  | 'tree' | 'blossom' | 'hedge' | 'streetLamp' | 'pumpkin' | 'bench' | 'rug';

export interface MapObject {
  type: ObjectType;
  x: number; y: number;      // tile
  w?: number; h?: number;    // en tiles
  dir?: Dir;                 // orientación (sillas, sofás)
  variant?: number;
  text?: string;             // texto de pantallas
  board?: 'ventas' | 'citas';
  seatId?: string;           // si es un asiento con id
}

export interface MapDefinition {
  width: number;   // en tiles
  height: number;
  building: TileRect;
  entrance: { x: number; w: number };
  road: { y: number; h: number };
  plaza: { cx: number; cy: number; r: number }; // en tiles
  rooms: RoomDef[];
  objects: MapObject[];
  spawn: { x: number; y: number };
}

/** Estado de avatar que viajaría por la red. */
export interface AvatarState {
  id: string;
  name: string;
  role: Role;
  x: number; y: number;   // px de mundo (centro de los pies)
  dir: Dir;
  moving: boolean;
  status: StatusId;
  mode: 'walk' | 'car';
  look: AvatarLook;
  sitting?: boolean;
}

export interface AvatarLook {
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;  // corto, largo, moño, rapado
  shirt: string;
  pants: string;
  glasses?: boolean;
  /** Si es true y hay foto, la cara del personaje es esa foto. Por defecto, personaje de juego. */
  usePhoto?: boolean;
  photoUrl?: string | null;
  /** `cara` pega la foto en la cara. `gafete` la lleva en el pecho. Si falta, cara. */
  photoPlacement?: 'cara' | 'gafete';
}
