import type { FastifyRequest } from 'fastify';
import { HttpError } from './http';

const WINDOW_MS = 12 * 60 * 1000;
const MAX_HITS = 18;
const hits = new Map<string, number[]>();

export function clientIp(req: FastifyRequest) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const hop = raw?.split(',')[0]?.trim();
  return hop || req.ip || 'desconocida';
}

export function assertJoinRate(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    throw new HttpError(429, 'Demasiados intentos. Espera unos minutos y vuelve a probar.');
  }
  recent.push(now);
  hits.set(ip, recent);
}

export function resetJoinRate() {
  hits.clear();
}
