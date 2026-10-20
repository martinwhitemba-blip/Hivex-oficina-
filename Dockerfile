FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV SERVE_STATIC=1
ENV WEB_DIST=/app/apps/web/dist
ENV UPLOAD_DIR=/app/uploads
ENV PORT=8787
COPY --from=build /app /app
RUN chmod +x /app/docker/entrypoint.sh
EXPOSE 8787
CMD ["sh", "/app/docker/entrypoint.sh"]
