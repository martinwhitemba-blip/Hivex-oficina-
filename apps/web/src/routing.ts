/** Rutas públicas de alta. Tienen que pintarse aunque ya haya sesión. */
const PUBLIC_JOIN = new Set(['unirse', 'codigo', 'activar']);
const AUTH_SCREENS = new Set(['registro', 'unirse', 'entrar', 'codigo', 'oficina', 'activar']);

/**
 * Primer tramo de la ruta, sin query y sin barra final.
 * El tramo se compara en minúsculas; el resto (un id) se deja igual.
 */
export function hashPath(hash: string) {
  let raw = hash.trim();
  if (raw.startsWith('#')) raw = raw.slice(1);
  if (raw.startsWith('/')) raw = raw.slice(1);
  raw = raw.split('?')[0].replace(/\/+$/, '');
  const slash = raw.indexOf('/');
  if (slash === -1) return raw.toLowerCase();
  return raw.slice(0, slash).toLowerCase() + raw.slice(slash);
}

export function isPublicJoin(hash: string) {
  return PUBLIC_JOIN.has(hashPath(hash));
}

export function isPublicForm(hash: string) {
  return hashPath(hash) === 'formulario';
}

/** Pantallas de entrada que no hay que reescribir a #/entrar. */
export function isAuthScreen(hash: string) {
  return AUTH_SCREENS.has(hashPath(hash));
}

export type AuthMode = 'registro' | 'unirse' | 'codigo' | 'activar' | 'entrar';

export function authMode(hash: string): AuthMode {
  const path = hashPath(hash);
  if (path === 'registro' || path === 'unirse' || path === 'codigo' || path === 'activar') return path;
  return 'entrar';
}

/**
 * Vista de una sesión ya iniciada.
 * unirse / codigo / activar no se convierten en el panel del dueño.
 */
export function viewForSession(hash: string, role: string | undefined) {
  if (isPublicJoin(hash)) return hashPath(hash);
  const raw = hashPath(hash);
  if (raw === 'oficina') return 'oficina';
  if (!raw || raw === 'entrar' || raw === 'registro') return role === 'empleado' ? 'oficina' : 'dueno';
  return raw;
}
