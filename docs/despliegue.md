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

## En Render (plan gratuito, URL de pruebas)

1. Crea una cuenta en Render y conecta este repositorio.
2. Usa el archivo `render.yaml` (Blueprint). El servicio web y la base PostgreSQL quedan en `plan: free`. No pide `WEB_ORIGIN`: la web y la API salen del mismo servicio, y el servidor usa la variable `RENDER_EXTERNAL_URL` que Render rellena solo. Si más adelante separas la web, entonces sí puedes añadir `WEB_ORIGIN`.
3. Al terminar, Render muestra una URL `https://….onrender.com`. Ábrela: el navegador pedirá un usuario y una contraseña antes de enseñar nada.
4. Salud del servicio: `/api/salud` responde `{"ok":true}` sin esa contraseña, para que el chequeo de Render no falle.
5. Dentro de la app, entra con `martin@hivex.demo` / `hivex-demo`.

El arranque aplica el esquema y vuelve a cargar la empresa de demostración. Se puede ejecutar otra vez: no duplica esa empresa y no borra las demás.

Límites del plan gratuito, para que no pillen por sorpresa:

- El servicio se duerme si nadie entra durante un rato. La primera visita después puede tardar un minuto en despertar.
- La base PostgreSQL gratuita caduca a los 30 días, más o menos. Antes de esa fecha hay que pasar a un plan de pago o exportar los datos.
- Las fotos se guardan en el disco del contenedor. Un redespliegue borra ese disco y las fotos desaparecen. Más adelante se puede usar almacenamiento compatible con S3, con las variables `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY` y `S3_SECRET_KEY`. Hoy no están conectadas: son el sitio donde irá ese cambio.

### Contraseña de la página (no es la de la aplicación)

El staging no es público. Si existen `ACCESS_USER` y `ACCESS_PASSWORD`, todo (la web, la API y el WebSocket) pide HTTP Basic. El usuario del blueprint es `hivex`. La contraseña la genera Render.

Para verla o cambiarla: en el panel de Render, abre el servicio web → Environment. Ahí está `ACCESS_PASSWORD` (Reveal para leerla). Puedes sustituir el valor y guardar; Render redespliega. `ACCESS_USER` se cambia igual.

Para quitar la puerta: borra `ACCESS_USER` y `ACCESS_PASSWORD` (las dos) y guarda. Con una sola de las dos vacía, la puerta no se activa. `/api/salud` nunca pide contraseña.

No rellenes un dominio personalizado en el blueprint. Cuando lo quieras, se añade en el panel de Render, en Custom Domains, y si la web deja de salir del mismo servicio se pone esa dirección en `WEB_ORIGIN`.

## En Railway

1. Nuevo proyecto desde este repositorio. `railway.json` ya indica el Dockerfile y la ruta de salud `/api/salud`.
2. Añade un PostgreSQL y la variable `DATABASE_URL` que te da el plugin.
3. Variables: `JWT_SECRET` (una frase larga), `SERVE_STATIC=1`, `SEED_ON_BOOT=1`, `NODE_ENV=production`.
4. Railway publica `https://….up.railway.app`. Si la web sale del mismo servicio, no hace falta `WEB_ORIGIN`: el servidor ya acepta `RAILWAY_PUBLIC_DOMAIN`.

## En Fly, Vercel o Netlify

- **Un solo contenedor** (Fly): publica el `Dockerfile`. El proceso escucha el puerto de la variable `PORT`. Base de datos PostgreSQL aparte, con `DATABASE_URL`.
- **Web separada de la API** (Vercel o Netlify para la carpeta compilada `apps/web/dist`, y Render/Railway/Fly para la API): la web tiene que poder llamar a la API. En esta beta lo más simple es el contenedor único, que ya sirve las dos cosas y evita líos de CORS y de WebSocket.

## Variables

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | `file:./dev.db` en local, o `postgresql://…` en staging |
| `JWT_SECRET` | Firma de la sesión. Distinta en cada servidor público |
| `WEB_ORIGIN` | Opcional. Orígenes extra del navegador, separados por comas. En Render no hace falta: vale `RENDER_EXTERNAL_URL` y, con la web servida por el mismo proceso, el navegador ya está en el mismo origen |
| `ACCESS_USER`, `ACCESS_PASSWORD` | Si las dos tienen valor, cierran la web, la API y el WebSocket. Vacías, no hay puerta |
| `PORT` | Puerto. El hosting suele inyectarlo |
| `SERVE_STATIC` | `1` para que el API también sirva la web compilada |
| `SEED_ON_BOOT` | `1` vuelve a cargar la empresa demo en cada arranque, sin duplicarla ni borrar las demás |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Opcional. Si faltan, el audio es directo entre navegadores |

El servidor también acepta `RENDER_EXTERNAL_URL` y `RAILWAY_PUBLIC_DOMAIN` como orígenes, para no tener que adivinar el nombre.

## Audio de proximidad

Sin claves de LiveKit verás un aviso: el audio va de navegador a navegador y se oye peor cuando hay mucha gente. Con las tres variables de LiveKit, la oficina pide un token a `/api/medios/token` y usa esa sala. Si el navegador niega el micrófono, la oficina sigue funcionando, solo sin voz.
