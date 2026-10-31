/**
 * Carga el .env de la raíz del repo y ejecuta el comando.
 * Prisma CLI no lo ve solo, porque el paquete vive en apps/server.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = { ...process.env };
const file = path.join(root, '.env');
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (env[key] === undefined) env[key] = value;
  }
}
if (!env.DATABASE_URL) env.DATABASE_URL = 'file:./dev.db';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Uso: node scripts/with-root-env.mjs <comando> [args]');
  process.exit(1);
}
const result = spawnSync(cmd, args, { stdio: 'inherit', env });
process.exit(result.status ?? 1);
