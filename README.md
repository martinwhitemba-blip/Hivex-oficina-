# HIVEX · beta

Sistema operativo de capital humano: una oficina virtual 2D y la gestión de la empresa en la misma aplicación. Cada empresa define sus áreas y sus personas. El dueño ve, en el momento, qué está haciendo cada una.

Oro sobre negro. Toda la interfaz está en español.

## Qué incluye

- Alta de empresa, sesión y roles: propietario, director de área y empleado. Puestos configurables (SDR, Closer, director comercial, y los que quieras).
- Invitación por enlace. No se envía correo: la pantalla da el enlace y un botón para copiarlo. Permisos: el empleado ve lo suyo, el director su área, el propietario toda la empresa.
- Áreas, equipos, colores e indicadores libres. Cada área nueva ocupa una zona del plano.
- Editor sencillo: nombre de sala, área de la sala y quién se sienta en cada puesto.
- Fichas con personaje de juego (colores, pelo, ropa) y foto opcional. La foto solo sustituye la cara si la persona activa «Usar mi foto como avatar». Importación CSV o Excel.
- Informe de jornada, fichaje, tareas (pendiente / en curso / hecho) y puntos.
- Panel de mi negocio: rankings, ritmo diario, objetivo contra real, alertas en español y exportación CSV.
- Panel del dueño: personas en vivo (área, tarea, estado y tiempo), mapa de áreas, reasignar, mover y auditoría. Diseño en `docs/panel-del-dueno.md`.
- Oficina multijugador por WebSocket, con personajes 3D (caminan, esperan y giran; la foto, si está activa, va en la cara y en una chapa). Si el navegador no tiene WebGL, se ve el personaje 2D. Pulsa un compañero para abrirle un mensaje directo. Audio de proximidad directo entre navegadores, o LiveKit si configuras las claves. El interruptor «Compañeros de demostración» los hace pasear entre áreas.
- Chat con canales y la lista Directos (no leídos). Los mensajes directos se guardan y no salen de la empresa.
- Planes Starter, Pro y Empresa con topes de personas y áreas. Pantalla Plan y uso. Sin cobro todavía.
- Módulo de captación marcado como **Próximamente** (modelos y área Llamadas listos, sin telefonía).

## Probarlo en local

Node 20 o más.

```bash
cp .env.example .env
npm install
npm run setup
npm run dev
```

Abre http://localhost:5173

| | |
|---|---|
| Dueño de la demo | `martin@hivex.demo` / `hivex-demo` |
| Entrar con código | `HIVEX2026` en `#/codigo?c=HIVEX2026` |
| También | `hugo@`, `lucia@`, `carmen@`, `martin.soto@`, `luis@`, `naomi@`, `maite@` en `hivex.demo`, misma contraseña |
| Clave de métricas | `hx_demo_clave_publica` |

La empresa de demostración trae Proveeduría, Logística, Recursos Humanos, Facturación, Ventas y el resto de áreas, con Martín, Luis, Naomi, Maite y Hugo y una tarea en curso cada uno. Los informes de 30 días están marcados como demostración.

Comandos: `npm test`, `npm run typecheck`, `npm run build`.

## Dónde se publica

Esta beta no tiene dominio propio. El blueprint de Render publica https://hivex.onrender.com y la página es pública (solo el login de la aplicación). Los pasos, para quien no desarrolla, están en `docs/despliegue.md`, incluido cómo volver a poner una contraseña de sitio. El dominio de marca se puede enganchar después, en el panel de ese hosting.

Archivos listos para un clic: `Dockerfile`, `docker-compose.yml`, `render.yaml`, `railway.json`.

## Documentos

- `docs/despliegue.md` — local, Docker, Render y Railway
- `docs/panel-del-dueno.md` — diseño del panel
- `docs/api.md` — sesión, webhook de métricas, planes y telefonía futura
