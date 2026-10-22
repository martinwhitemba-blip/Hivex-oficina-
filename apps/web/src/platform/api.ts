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
  const response = await fetch(path, { ...opts, headers });
  const keepsSession = path.includes('/api/auth/') || path.includes('/api/invitaciones/') || path.includes('/api/acceso-codigo');
  if (response.status === 401 && !keepsSession) {
    clearToken();
    location.hash = '#/entrar';
    throw new ApiError(401, 'Inicia sesión para continuar');
  }
  const type = response.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response.status, (body && body.error) || 'No se pudo completar la acción');
  return body as T;
}

export function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function money(n: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(n) + ' €';
}

export function num(n: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n);
}

export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(r).padStart(2, '0')} s`;
}
