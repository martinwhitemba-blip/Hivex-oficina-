import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), '.env'));
loadEnvFile(path.resolve(process.cwd(), '../../.env'));

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:./dev.db';
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Falta JWT_SECRET. Defínelo en las variables del hosting, sin usar un dominio propio.');
  }
  process.env.JWT_SECRET = 'dev-only-cambia-este-secreto';
}

export const env = {
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  port: Number(process.env.PORT || 8787),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads')),
  serveStatic: process.env.SERVE_STATIC === '1',
  webDist: path.resolve(process.env.WEB_DIST || path.join(process.cwd(), '../web/dist')),
  nodeEnv: process.env.NODE_ENV || 'development',
  livekitUrl: process.env.LIVEKIT_URL || '',
  livekitKey: process.env.LIVEKIT_API_KEY || '',
  livekitSecret: process.env.LIVEKIT_API_SECRET || '',
};

/** Orígenes CORS. Nunca incluye un dominio de marca fijo: solo localhost y lo que venga por entorno. */
export function allowedOrigins(): Set<string> {
  const list = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ]);
  const add = (value?: string) => {
    if (!value) return;
    for (const part of value.split(',')) {
      const v = part.trim().replace(/\/$/, '');
      if (v) list.add(v);
    }
  };
  add(process.env.WEB_ORIGIN);
  // Render inyecta la URL pública del servicio. No hace falta pedir WEB_ORIGIN al crear el blueprint.
  add(process.env.RENDER_EXTERNAL_URL);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) add(`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
  return list;
}
