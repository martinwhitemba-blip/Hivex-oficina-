/**
 * Carga de presencia. No entra en CI.
 * BASE_URL=http://127.0.0.1:8787 COMPANIES=100 USERS=2 SECONDS=8 node scripts/load-office.mjs
 */
import { io } from 'socket.io-client';

const base = process.env.BASE_URL || 'http://127.0.0.1:8787';
const companies = Number(process.env.COMPANIES || 100);
const users = Number(process.env.USERS || 2);
const seconds = Number(process.env.SECONDS || 8);

async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-hivex-token': token } : {}) },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status} ${payload.error || ''}`);
  return payload;
}

const stamp = Date.now().toString(36);
const sessions = [];
for (let company = 0; company < companies; company += 1) {
  const owner = await post('/api/auth/registro', {
    name: `Dueño ${company}`,
    email: `dueno-${stamp}-${company}@carga.test`,
    password: 'clave-segura',
    companyName: `Carga ${stamp} ${company}`,
  });
  sessions.push(owner.token);
  for (let person = 1; person < users; person += 1) {
    const invite = await post('/api/invitaciones', {
      email: `persona-${stamp}-${company}-${person}@carga.test`,
      role: 'empleado',
    }, owner.token);
    const accepted = await post(`/api/invitaciones/${invite.code}/aceptar`, {
      name: `Persona ${company}-${person}`,
      password: 'clave-segura',
    });
    sessions.push(accepted.token);
  }
  if ((company + 1) % 10 === 0) console.log(`empresas listas ${company + 1}/${companies}`);
}

let errors = 0;
const sockets = sessions.map((token, index) => {
  const socket = io(base, { auth: { token }, transports: ['websocket'] });
  socket.on('connect_error', () => { errors += 1; });
  socket.on('connect', () => {
    const x = 400 + (index % 20) * 30;
    const y = 400 + (index % 15) * 28;
    socket.emit('office:join', { x, y, dir: 'down', moving: false, status: 'en_linea', mode: 'walk', sitting: false });
  });
  return socket;
});

const started = Date.now();
const timer = setInterval(() => {
  for (const socket of sockets) {
    if (!socket.connected) continue;
    socket.emit('office:state', {
      x: 500 + Math.random() * 200,
      y: 500 + Math.random() * 160,
      dir: 'right',
      moving: true,
      status: 'en_linea',
      mode: 'walk',
      sitting: false,
    });
  }
}, 100);

setTimeout(() => {
  clearInterval(timer);
  const connected = sockets.filter((socket) => socket.connected).length;
  console.log(JSON.stringify({
    companies,
    users,
    sockets: sockets.length,
    connected,
    errors,
    seconds: Math.round((Date.now() - started) / 1000),
  }));
  for (const socket of sockets) socket.close();
  setTimeout(() => process.exit(connected > 0 ? 0 : 1), 200);
}, seconds * 1000);
