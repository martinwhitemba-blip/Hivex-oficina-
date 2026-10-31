import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';

export const ACCESS_REALM = 'HIVEX beta';

export function gateEnabled() {
  return Boolean(process.env.ACCESS_USER && process.env.ACCESS_PASSWORD);
}

/** Compara secretos sin filtrar la longitud ni el contenido por el tiempo. */
export function secretEqual(left: string, right: string) {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function requestAllowed(req: { url?: string; headers: IncomingHttpHeaders }) {
  if (!gateEnabled()) return true;
  const path = (req.url || '/').split('?')[0];
  if (path === '/api/salud') return true;
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return false;
  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  const user = decoded.slice(0, split);
  const password = decoded.slice(split + 1);
  return secretEqual(user, process.env.ACCESS_USER || '') && secretEqual(password, process.env.ACCESS_PASSWORD || '');
}

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/** Cubre el cambio a WebSocket, que no pasa por las rutas de Fastify. */
export function installAccessGate(server: Server) {
  const previous = server.listeners('upgrade').slice() as UpgradeListener[];
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket, head) => {
    if (!requestAllowed(req)) {
      const body = 'Acceso restringido';
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        `WWW-Authenticate: Basic realm="${ACCESS_REALM}", charset="UTF-8"\r\n` +
        'Content-Type: text/plain; charset=utf-8\r\n' +
        'Connection: close\r\n' +
        `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
      socket.destroy();
      return;
    }
    for (const listener of previous) listener.call(server, req, socket, head);
  });
}
