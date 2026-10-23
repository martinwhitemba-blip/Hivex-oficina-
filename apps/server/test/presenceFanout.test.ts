import { describe, expect, it } from 'vitest';
import { fanoutPresence, INTEREST_RADIUS, INTEREST_UNDER } from '../src/presenceFanout';

describe('reparto de presencia por empresa', () => {
  const office = [
    { id: 'yo', areaId: 'atlas', x: 0, y: 0 },
    { id: 'cerca', areaId: 'vega', x: 100, y: 40 },
    { id: 'lejos', areaId: 'vega', x: INTEREST_RADIUS + 80, y: 0 },
    { id: 'misma', areaId: 'atlas', x: 4000, y: 4000 },
  ];

  it('con poca gente emite a toda la sala y no incluye al emisor', () => {
    const plan = fanoutPresence(office, 'yo', { x: 0, y: 0, areaId: 'atlas' }, INTEREST_UNDER);
    expect(plan.mode).toBe('room');
    expect(plan.targets.map((item) => item.id)).toEqual(['cerca', 'lejos', 'misma']);
  });

  it('con la sala llena solo avisa a quien está cerca o en la misma área', () => {
    const plan = fanoutPresence(office, 'yo', { x: 0, y: 0, areaId: 'atlas' }, INTEREST_UNDER + 1);
    expect(plan.mode).toBe('interest');
    expect(plan.targets.map((item) => item.id).sort()).toEqual(['cerca', 'misma']);
  });

  it('no ve sockets de otra empresa: el índice que recibe ya es solo su sala', () => {
    const soloAtlas = office.filter((item) => item.areaId === 'atlas');
    const plan = fanoutPresence(soloAtlas, 'yo', { x: 0, y: 0, areaId: 'atlas' }, 80);
    expect(plan.targets.every((item) => item.areaId === 'atlas')).toBe(true);
    expect(plan.targets.some((item) => item.id === 'lejos')).toBe(false);
  });
});
