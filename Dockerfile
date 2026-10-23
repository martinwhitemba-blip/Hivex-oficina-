# Imagen pensada para el plan gratuito de Render (poca RAM en el build).
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=384 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
# El plan free tiene unos 512 MB. El swap evita que npm o Vite mueran en el pico.
RUN dd if=/dev/zero of=/swap bs=1M count=768 status=none && chmod 600 /swap && mkswap /swap && swapon /swap || true
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts
COPY apps/server apps/server
COPY apps/web apps/web
# El cliente y el servidor importan packages/i18n por ruta. Sin esta copia
# tsc y esbuild salen con status 1 (no encuentran el módulo).
COPY packages packages
RUN npm run build -w @hivex/web && npm run build -w @hivex/server

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    SERVE_STATIC=1 \
    WEB_DIST=/app/apps/web/dist \
    UPLOAD_DIR=/tmp/hivex-uploads \
    PORT=8787 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/server/scripts apps/server/scripts
COPY --from=build /app/apps/server/src apps/server/src
COPY --from=build /app/apps/web/dist apps/web/dist
# La semilla arranca con tsx sobre el fuente, y domain.ts importa i18n.
COPY --from=build /app/packages packages
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh && mkdir -p /tmp/hivex-uploads
EXPOSE 8787
CMD ["sh", "/app/docker/entrypoint.sh"]
