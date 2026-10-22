/** Rutas públicas de alta. Tienen que pintarse aunque ya haya sesión. */
const PUBLIC_JOIN = new Set(['unirse', 'codigo', 'activar']);

export function hashPath(hash: string) {
  return hash.replace(/^#\//, '').split('?')[0];
}

export function isPublicJoin(hash: string) {
  return PUBLIC_JOIN.has(hashPath(hash));
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
