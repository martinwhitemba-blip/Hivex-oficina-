import { getLocale, moneyOf, numOf, t } from '../i18n';

const TOKEN_KEY = 'hivex_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(token: string) { localStorage.setItem(TOKEN_KEY, token); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('X-HIVEX-Token', token);
  headers.set('Accept-Language', getLocale());
  const response = await fetch(path, { ...opts, headers });
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  const keepsSession = path.includes('/api/auth/') || path.includes('/api/invitaciones/') || path.includes('/api/acceso-codigo') || path.includes('/api/activar');
  if (response.status === 401 && !keepsSession) {
    clearToken();
    location.hash = '#/entrar';
    const message = body && typeof body === 'object' && body.error ? String(body.error) : t('errors.auth.required');
    throw new ApiError(401, message);
  }
  if (!response.ok) throw new ApiError(response.status, (body && typeof body === 'object' && body.error) || t('auth.actionFailed'));
  return body as T;
}

export function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function money(n: number) {
  return moneyOf(n);
}

export function num(n: number) {
  return numOf(n);
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  if (h) return t('time.hm', { h, m });
  return t('time.ms', { m, s: r });
}
