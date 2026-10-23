import { PrismaClient } from '@prisma/client';

function datasourceUrl() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw.startsWith('postgres')) return undefined;
  const limit = process.env.PRISMA_CONNECTION_LIMIT || '10';
  const timeout = process.env.PRISMA_POOL_TIMEOUT || '20';
  const url = new URL(raw);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', limit);
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', timeout);
  return url.toString();
}

const url = datasourceUrl();
export const prisma = new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
