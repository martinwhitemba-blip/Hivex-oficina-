/**
 * Configuración global de la app.
 * Para renombrar el producto basta con cambiar BRAND_NAME (y los logos en src/assets/).
 */
export const BRAND_NAME = 'HIVEX';
export const BRAND_TAGLINE = 'Oficina virtual';
export const OFFICE_NAME = 'Oficina principal';

/** Tamaño del tile en píxeles de mundo. */
export const TILE = 32;

/** Radio (px de mundo) para considerar a alguien "cerca" (conversación de proximidad). */
export const PROXIMITY_RADIUS = TILE * 3.6;

/** Velocidades en px/segundo. */
export const WALK_SPEED = 150;
export const CAR_SPEED = 340;

/** Paleta de marca HIVEX (UI). El suelo de la oficina se mantiene claro. */
export const BRAND = {
  gold: '#F5C518',
  goldDeep: '#E0A800',
  goldSoft: '#F7DC6F',
  silver: '#C9CDD2',
  black: '#0B0B0C',
  panel: '#141416',
};
