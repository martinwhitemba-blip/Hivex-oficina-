import type { StatusDef, StatusId } from '../game/types';

export const STATUSES: Record<StatusId, StatusDef> = {
  en_linea:   { id: 'en_linea',   label: 'En línea',     color: '#22C55E', emoji: '🟢' },
  ausente:    { id: 'ausente',    label: 'Ausente',      color: '#F59E0B', emoji: '🌙' },
  en_reunion: { id: 'en_reunion', label: 'En reunión',   color: '#EF4444', emoji: '📅' },
  cafe:       { id: 'cafe',       label: 'Café virtual', color: '#A16207', emoji: '☕' },
  en_llamada: { id: 'en_llamada', label: 'En llamada',   color: '#8B5CF6', emoji: '📞' },
};

export const STATUS_ORDER: StatusId[] = ['en_linea', 'ausente', 'en_reunion', 'cafe', 'en_llamada'];
