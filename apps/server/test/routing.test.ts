import { describe, expect, it } from 'vitest';
import { isPublicJoin, viewForSession } from '../../web/src/routing';

describe('rutas públicas de alta', () => {
  it('unirse, codigo y activar no saltan al panel del dueño', () => {
    expect(isPublicJoin('#/codigo?c=HIVEX2026')).toBe(true);
    expect(isPublicJoin('#/unirse?code=ABC')).toBe(true);
    expect(isPublicJoin('#/activar?code=XYZ')).toBe(true);
    expect(isPublicJoin('#/dueno')).toBe(false);
    expect(viewForSession('#/codigo?c=HIVEX2026', 'propietario')).toBe('codigo');
    expect(viewForSession('#/unirse?code=ABC', 'propietario')).toBe('unirse');
    expect(viewForSession('#/activar?code=XYZ', 'administrador')).toBe('activar');
    expect(viewForSession('#/entrar', 'propietario')).toBe('dueno');
    expect(viewForSession('', 'empleado')).toBe('oficina');
    expect(viewForSession('#/oficina', 'propietario')).toBe('oficina');
  });
});
