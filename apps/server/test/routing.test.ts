import { describe, expect, it } from 'vitest';
import { authMode, isPublicJoin, viewForSession } from '../../web/src/routing';

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
    expect(isPublicJoin('#/Codigo?c=HIVEX2026')).toBe(true);
    expect(isPublicJoin('#/unirse/')).toBe(true);
    expect(viewForSession('#/Unirse?code=ABC', 'propietario')).toBe('unirse');
    expect(viewForSession('#/codigo/', 'empleado')).toBe('codigo');
    expect(viewForSession('#/equipo/AbC', 'propietario')).toBe('equipo/AbC');
    expect(authMode('#/Codigo?c=HIVEX2026')).toBe('codigo');
    expect(authMode('#/unirse?code=ABC')).toBe('unirse');
    expect(authMode('#/entrar')).toBe('entrar');
  });
});
