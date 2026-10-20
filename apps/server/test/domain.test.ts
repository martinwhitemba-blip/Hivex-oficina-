import { describe, expect, it } from 'vitest';
import { aggregateKpi, buildAlerts, canSeeMetrics, lastWorkdays, scoreOf } from '../src/domain';

describe('métricas y permisos', () => {
  it('suma un indicador por persona y por día', () => {
    const total = aggregateKpi([
      { membershipId: 'a', date: '2026-10-19', values: [{ key: 'llamadas', value: 10 }, { key: 'citas', value: 2 }] },
      { membershipId: 'a', date: '2026-10-16', values: [{ key: 'llamadas', value: 15 }] },
      { membershipId: 'b', date: '2026-10-19', values: [{ key: 'llamadas', value: 3 }] },
    ], 'llamadas');
    expect(total.total).toBe(28);
    expect(total.byMember.get('a')).toBe(25);
    expect(total.byDate.get('2026-10-19')).toBe(13);
  });

  it('avisa en español si faltan jornadas, no se presentan a las citas o no se llega al objetivo', () => {
    const today = '2026-10-20';
    expect(lastWorkdays(3, today)).toEqual(['2026-10-19', '2026-10-16', '2026-10-15']);
    const kpis = [
      { areaId: 'ventas', key: 'llamadas', label: 'Llamadas', targetDaily: 40, higherIsBetter: true },
      { areaId: 'ventas', key: 'citas', label: 'Citas', targetDaily: 5, higherIsBetter: true },
      { areaId: 'ventas', key: 'citas_no_presentadas', label: 'Ausencias', targetDaily: null, higherIsBetter: true },
    ];
    const alerts = buildAlerts({
      today,
      people: [
        { id: 'raul', name: 'Raúl Campos', areaId: 'ventas' },
        { id: 'carmen', name: 'Carmen Ortiz', areaId: 'ventas' },
        { id: 'hugo', name: 'Hugo Peña', areaId: 'ventas' },
      ],
      kpis,
      reports: [
        ...['2026-10-01', '2026-10-02', '2026-10-05'].map((date) => ({
          membershipId: 'carmen',
          date,
          values: [{ key: 'citas', value: 10 }, { key: 'citas_no_presentadas', value: 8 }, { key: 'llamadas', value: 40 }],
        })),
        ...['2026-10-15', '2026-10-16', '2026-10-19'].map((date) => ({
          membershipId: 'hugo',
          date,
          values: [{ key: 'llamadas', value: 10 }, { key: 'citas', value: 2 }, { key: 'citas_no_presentadas', value: 0 }],
        })),
      ],
    });
    expect(alerts.some((alert) => alert.text === 'Raúl Campos no ha pasado el informe de 10 jornadas' || alert.text.includes('Raúl Campos no ha pasado el informe'))).toBe(true);
    expect(alerts.some((alert) => alert.text.includes('Carmen Ortiz') && alert.text.includes('80%'))).toBe(true);
    expect(alerts.some((alert) => alert.text.includes('Hugo Peña') && alert.text.includes('Llamadas'))).toBe(true);
  });

  it('un empleado no ve las métricas de otra área y el propietario sí', () => {
    const empleado = { id: 'e', role: 'empleado', areaId: 'a' };
    const director = { id: 'd', role: 'administrador', areaId: 'a' };
    const dueno = { id: 'o', role: 'propietario', areaId: null };
    const otra = { id: 'x', role: 'empleado', areaId: 'b' };
    expect(canSeeMetrics(empleado, otra)).toBe(false);
    expect(canSeeMetrics(empleado, empleado)).toBe(true);
    expect(canSeeMetrics(director, otra)).toBe(false);
    expect(canSeeMetrics(director, { id: 'c', role: 'empleado', areaId: 'a' })).toBe(true);
    expect(canSeeMetrics(dueno, otra)).toBe(true);
  });

  it('calcula una puntuación entre 0 y 100', () => {
    expect(scoreOf({ workdays: 10, reportDays: 10, targetPct: 1, tasksDone: 2, tasksTotal: 2 })).toBe(100);
    expect(scoreOf({ workdays: 10, reportDays: 0, targetPct: 0, tasksDone: 0, tasksTotal: 4 })).toBe(0);
  });
});
