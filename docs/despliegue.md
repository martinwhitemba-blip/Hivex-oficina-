# Cómo poner HIVEX en marcha

Esta guía es para alguien que no programa a diario. La beta **no usa un dominio propio**. En el ordenador se abre en `localhost`. En un hosting de pruebas la dirección la pone el propio servicio (algo como `https://NOMBRE.onrender.com` o `https://NOMBRE.up.railway.app`). El dominio de la marca se puede añadir más adelante, en el panel de ese hosting, cuando quieras. No hace falta tocarlo ahora.

No hay una dirección pública desplegada en este repositorio: hace falta una cuenta del hosting y sus credenciales, y aquí no están.

## En tu ordenador (lo más simple)

Necesitas Node 20 o superior.

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

- La oficina y los paneles: http://localhost:5173
- La API: http://localhost:8787 (el navegador la usa a través del puerto 5173)

Empresa de demostración:

- Correo: `martin@hivex.demo`
- Contraseña: `hivex-demo`

También entran Hugo, Lucía, Carmen, Martín, Luis, Naomi y Maite con el mismo dominio de correo de la demo y la misma contraseña. Por ejemplo `hugo@hivex.demo`.

Los números de esa empresa están marcados como demostración.

Para parar, cierra la terminal. Los datos quedan en un archivo SQLite dentro de `apps/server/prisma/`.

## Con Docker (base de datos incluida)

```bash
docker compose up --build
```

Abre http://localhost:8787 . El mismo servidor entrega la web y la API. La primera vez crea la empresa de demostración (`SEED_ON_BOOT=1`).

## En Render (un clic, URL de pruebas)

1. Crea una cuenta en Render y conecta este repositorio.
2. Usa el archivo `render.yaml` (Blueprint). Crea el servicio web y la base PostgreSQL.
3. Render te dará una URL `https://….onrender.com`. Cópiala en la variable `WEB_ORIGIN` (con `https://`, sin barra final) y vuelve a desplegar. Así el navegador puede hablar con la API.
4. Salud del servicio: `/api/salud` debe responder `{"ok":true}`.
5. Entra con `martin@hivex.demo` / `hivex-demo`.

No rellenes un dominio personalizado en el blueprint. Cuando lo quieras, se añade en el panel de Render, en Custom Domains, y se vuelve a poner esa dirección en `WEB_ORIGIN`.

## En Railway

1. Nuevo proyecto desde este repositorio. `railway.json` ya indica el Dockerfile y la ruta de salud `/api/salud`.
2. Añade un PostgreSQL y la variable `DATABASE_URL` que te da el plugin.
3. Variables: `JWT_SECRET` (una frase larga), `SERVE_STATIC=1`, `SEED_ON_BOOT=1`, `NODE_ENV=production`.
4. Cuando Railway muestre la URL `https://….up.railway.app`, ponla en `WEB_ORIGIN` y redeploy.

## En Fly, Vercel o Netlify

- **Un solo contenedor** (Fly): publica el `Dockerfile`. El proceso escucha el puerto de la variable `PORT`. Base de datos PostgreSQL aparte, con `DATABASE_URL`.
- **Web separada de la API** (Vercel o Netlify para la carpeta compilada `apps/web/dist`, y Render/Railway/Fly para la API): la web tiene que poder llamar a la API. En esta beta lo más simple es el contenedor único, que ya sirve las dos cosas y evita líos de CORS y de WebSocket.

## Variables

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | `file:./dev.db` en local, o `postgresql://…` en staging |
| `JWT_SECRET` | Firma de la sesión. Distinta en cada servidor público |
| `WEB_ORIGIN` | Dirección del navegador, separada por comas si hay varias |
| `PORT` | Puerto. El hosting suele inyectarlo |
| `SERVE_STATIC` | `1` para que el API también sirva la web compilada |
| `SEED_ON_BOOT` | `1` solo la primera vez, para cargar la demo |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Opcional. Si faltan, el audio es directo entre navegadores |

El servidor también acepta `RENDER_EXTERNAL_URL` y `RAILWAY_PUBLIC_DOMAIN` como orígenes, para no tener que adivinar el nombre.

## Audio de proximidad

Sin claves de LiveKit verás un aviso: el audio va de navegador a navegador y se oye peor cuando hay mucha gente. Con las tres variables de LiveKit, la oficina pide un token a `/api/medios/token` y usa esa sala. Si el navegador niega el micrófono, la oficina sigue funcionando, solo sin voz.
