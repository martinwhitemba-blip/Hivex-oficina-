#!/bin/sh
set -eu
cd /app/apps/server
# Idempotente: ajusta el provider, alinea el esquema y, si se pide, rehace solo la empresa demo.
node scripts/prisma-provider.mjs
npx prisma generate
npx prisma db push --accept-data-loss
if [ "${SEED_ON_BOOT:-0}" = "1" ]; then
  npx tsx prisma/seed.ts
fi
cd /app
exec node apps/server/dist/index.js
