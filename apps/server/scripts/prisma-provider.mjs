/**
 * Ajusta el provider de Prisma según DATABASE_URL.
 * file:… → sqlite. postgres… → postgresql.
 * Así la misma schema sirve en local y en staging.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema.prisma');
const url = process.env.DATABASE_URL || 'file:./dev.db';
const provider = url.startsWith('postgres') ? 'postgresql' : 'sqlite';
const text = fs.readFileSync(schemaPath, 'utf8');
const next = text.replace(/provider\s*=\s*"(sqlite|postgresql)"/, `provider = "${provider}"`);
if (next !== text) fs.writeFileSync(schemaPath, next);
console.log(`[prisma] provider=${provider}`);
