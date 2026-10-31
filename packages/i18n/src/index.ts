import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';

export const LOCALES = ['es', 'en', 'fr', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export type Catalog = typeof es;

type Join<A extends string, B extends string> = A extends '' ? B : `${A}.${B}`;
type Leaves<T, P extends string = ''> = T extends string
  ? P
  : T extends { one: string; other: string }
    ? P
    : { [K in keyof T & string]: Leaves<T[K], Join<P, K>> }[keyof T & string];

export type MessageKey = Leaves<Catalog>;

const catalogs: Record<Locale, Catalog> = { es, en, fr, de };

const INTL_TAG: Record<Locale, string> = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE' };
const CURRENCY: Record<Locale, string> = { es: 'EUR', en: 'USD', fr: 'EUR', de: 'EUR' };

const spanishErrors = new Map<string, string>();

function indexSpanish(node: unknown, path: string) {
  if (typeof node === 'string') {
    if (!node.includes('{') && !spanishErrors.has(node)) spanishErrors.set(node, path);
    return;
  }
  if (!node || typeof node !== 'object' || ('one' in node && 'other' in node)) return;
  for (const [key, value] of Object.entries(node)) indexSpanish(value, path ? `${path}.${key}` : key);
}
indexSpanish(es.errors, 'errors');

export function normalizeLocale(input: string | null | undefined): Locale | null {
  if (!input) return null;
  const tag = input.trim().toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : null;
}

function firstLocale(list: readonly string[] | null | undefined): Locale | null {
  if (!list) return null;
  for (const item of list) {
    const hit = normalizeLocale(item);
    if (hit) return hit;
  }
  return null;
}

export function resolveLocale(input: {
  user?: string | null;
  company?: string | null;
  acceptLanguage?: string | null;
  navigatorLanguages?: readonly string[] | null;
}): Locale {
  const header = input.acceptLanguage?.split(',').map((part) => part.split(';')[0]?.trim() || '') ?? [];
  return normalizeLocale(input.user)
    || normalizeLocale(input.company)
    || firstLocale(header)
    || firstLocale(input.navigatorLanguages)
    || 'es';
}

function dig(node: unknown, key: string): unknown {
  let cur: unknown = node;
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function fill(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (vars[name] == null ? '' : String(vars[name])));
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>) {
  const node = dig(catalogs[locale], key) ?? dig(catalogs.es, key);
  if (typeof node === 'string') return fill(node, vars);
  if (node && typeof node === 'object' && 'other' in (node as object)) {
    const forms = node as { one?: string; other: string } & Record<string, string>;
    const n = Number(vars?.n ?? 0);
    const rule = new Intl.PluralRules(INTL_TAG[locale]).select(n);
    return fill(forms[rule] || forms.other, { ...vars, n });
  }
  return key;
}

export function formatNumber(locale: Locale, value: number, digits = 1) {
  return new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: digits }).format(value);
}

export function formatMoney(locale: Locale, value: number, currency = CURRENCY[locale]) {
  return new Intl.NumberFormat(INTL_TAG[locale], { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatDate(locale: Locale, value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(locale: Locale, value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatTime(locale: Locale, value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(INTL_TAG[locale], { timeStyle: 'short' }).format(date);
}

export function codeForSpanish(message: string) {
  return spanishErrors.get(message) || null;
}

export function localizeError(locale: Locale, message: string, code?: string, params?: Record<string, string | number>) {
  const key = (code || codeForSpanish(message) || '') as MessageKey;
  if (!key || !key.startsWith('errors.')) return { code: 'raw', error: message };
  return { code: key.slice('errors.'.length), error: translate(locale, key, params) };
}

export function renderEmail(locale: Locale, kind: 'invite' | 'activation', vars: Record<string, string | number>) {
  const subject = translate(locale, `mail.${kind}.subject` as MessageKey, vars);
  const text = translate(locale, `mail.${kind}.text` as MessageKey, vars);
  const system = systemMessage(locale, 'mail.chat.joined', vars);
  const html = `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>`;
  return { subject, text, html, system };
}

export function systemMessage(locale: Locale, key: MessageKey, vars?: Record<string, string | number>) {
  return translate(locale, key, vars);
}

export function screenCopy(locale: Locale) {
  return {
    entrance: translate(locale, 'auth.enterTitle'),
    hero: translate(locale, 'auth.heroEm'),
    office: translate(locale, 'office.helpTitle'),
    owner: translate(locale, 'owner.title'),
    team: translate(locale, 'team.title'),
    chat: translate(locale, 'chat.title'),
    help: translate(locale, 'office.walk'),
  };
}

function flatten(node: unknown, path = '', into: Record<string, string> = {}) {
  if (typeof node === 'string') {
    into[path] = node;
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  if ('one' in node && 'other' in node) {
    into[`${path}.one`] = String((node as { one: string }).one);
    into[`${path}.other`] = String((node as { other: string }).other);
    return into;
  }
  for (const [key, value] of Object.entries(node)) flatten(value, path ? `${path}.${key}` : key, into);
  return into;
}

export function parityIssues() {
  const base = flatten(es);
  const issues: string[] = [];
  for (const code of ['en', 'fr', 'de'] as const) {
    const flat = flatten(catalogs[code]);
    for (const key of Object.keys(base)) if (!(key in flat)) issues.push(`${code} falta ${key}`);
    for (const key of Object.keys(flat)) if (!(key in base)) issues.push(`${code} sobra ${key}`);
    for (const key of Object.keys(base)) {
      if (typeof flat[key] === 'string' && !flat[key].trim()) issues.push(`${code} vacío ${key}`);
    }
  }
  return issues;
}

export const LANG_NAMES: Record<Locale, string> = { es: 'Español', en: 'English', fr: 'Français', de: 'Deutsch' };
