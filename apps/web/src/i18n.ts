import {
  LANG_NAMES,
  LOCALES,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  normalizeLocale,
  resolveLocale,
  translate,
  type Locale,
  type MessageKey,
} from '../../../packages/i18n/src/index';

const PIN = 'hivex.locale.pin';
const SAVED = 'hivex.locale';
let current: Locale = 'es';

export type { Locale, MessageKey };
export { LANG_NAMES, LOCALES, normalizeLocale };

export function getLocale() {
  return current;
}

export function t(key: MessageKey, vars?: Record<string, string | number>) {
  return translate(current, key, vars);
}

export function formatWhen(value: Date | string | number) {
  return formatDateTime(current, value);
}

export function formatClock(value: Date | string | number) {
  return formatTime(current, value);
}

export function moneyOf(value: number) {
  return formatMoney(current, value);
}

export function numOf(value: number, digits = 1) {
  return formatNumber(current, value, digits);
}

export function bootLocale(hints: { user?: string | null; company?: string | null } = {}) {
  const pinned = localStorage.getItem(PIN) === '1';
  const saved = localStorage.getItem(SAVED);
  apply(resolveLocale({
    user: pinned ? saved : hints.user,
    company: hints.company,
    navigatorLanguages: navigator.languages,
  }));
}

export function pinLocale(locale: Locale) {
  localStorage.setItem(PIN, '1');
  localStorage.setItem(SAVED, locale);
  apply(locale);
}

function apply(locale: Locale) {
  current = locale;
  document.documentElement.lang = locale;
  const text = document.getElementById('boot-error-text');
  const button = document.getElementById('boot-reload');
  const panel = document.getElementById('boot-error');
  if (text && panel?.hidden) text.textContent = t('common.bootFail');
  if (button) button.textContent = t('common.reload');
}

export function langSelect() {
  const options = LOCALES.map((code) => `<option value="${code}"${code === current ? ' selected' : ''}>${LANG_NAMES[code]}</option>`).join('');
  return `<select class="lang-switch" aria-label="${t('lang.label')}">${options}</select>`;
}

const ROLES: Record<string, MessageKey> = {
  Propietario: 'role.owner',
  Administrador: 'role.admin',
  Empleado: 'role.employee',
};

export function roleName(label: string) {
  const key = ROLES[label];
  return key ? t(key) : label;
}

const KNOWN: Record<string, MessageKey> = {
  'EQUIPO ATLAS': 'map.plaque.atlas',
  'EQUIPO VEGA': 'map.plaque.vega',
  'SALA DE REUNIONES': 'map.plaque.meeting',
  'CAFÉ': 'map.plaque.cafe',
  DIRECCIÓN: 'map.plaque.direction',
  'ZONA ABIERTA': 'map.plaque.open',
  'Equipo Atlas': 'map.name.atlas',
  'Equipo Vega': 'map.name.vega',
  'Sala de reuniones': 'map.name.meeting',
  'Café / Cocina': 'map.name.cafe',
  'Despacho privado': 'map.name.private',
  'Zona abierta': 'map.name.open',
  'Zona de descanso': 'map.name.lounge',
  'Plaza central': 'office.plaza',
  'RANKING HOY': 'map.rank.today',
  Importe: 'map.rank.amount',
  'RANKING CITAS': 'map.rank.meetings',
  Citas: 'map.rank.meetingsSub',
  'Audio y vídeo de proximidad con LiveKit.': 'media.livekit',
  'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET en el servidor.': 'media.p2p',
  'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET.': 'media.p2pClient',
  'El micrófono está apagado. Actívalo cuando quieras hablar con quien tengas cerca.': 'media.micOff',
  'No se pudo abrir el micrófono. El audio de proximidad está desactivado en este navegador.': 'media.micFail',
  'La cámara en grupo funciona mejor con LiveKit. En modo directo solo se comparte el audio.': 'media.camGroup',
  'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LiveKit.': 'media.p2pShort',
  'Audio simulado: no se transmite a otras personas.': 'media.simulated',
};

export function knownPhrase(text: string) {
  const calls = /^LLAMADAS\s+(\d+)$/.exec(text);
  if (calls) return t('map.tv.calls', { n: calls[1] });
  const meetings = /^CITAS\s+(\d+)$/.exec(text);
  if (meetings) return t('map.tv.meetings', { n: meetings[1] });
  const key = KNOWN[text];
  return key ? t(key) : text;
}

export function statusText(id: string) {
  const key = `status.${id}` as MessageKey;
  const value = t(key);
  return value === key ? id : value;
}
