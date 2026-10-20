# HIVEX · Oficina virtual (prototipo · paso 1: mapa con avatares)

Oficina virtual 2D estilo "Gather" para equipos comerciales: mapa por tiles,
avatares, compañeros simulados, proximidad, salas, rankings y modo coche.
Funciona en **PC y móvil** (táctil, joystick, pellizco para zoom, PWA instalable).

> El nombre del producto está en una sola constante: `BRAND_NAME` en `src/config.ts`
> (logos en `src/assets/`, iconos PWA en `public/icons/`).

## Cómo ejecutar

Requisitos: Node 18+.

```bash
npm install
npm run dev        # servidor de desarrollo → http://localhost:5173
npm run build      # genera dist/ (web/PWA) y dist-single/oficina-virtual.html
npm run preview    # sirve dist/ para probar la build (y la instalación PWA)
npm run screenshots   # (opcional) capturas con Chromium headless → screenshots/
```

- **`dist-single/oficina-virtual.html`**: un único archivo con todo dentro (JS, CSS e imágenes).
  Se abre con doble clic, sin internet y sin servidor.
- **`dist/`**: build normal para subir a cualquier hosting estático (Netlify, Vercel, S3…).
  Incluye `manifest.webmanifest`, iconos y un *service worker*, así que en el móvil se puede
  "Añadir a pantalla de inicio" (requiere HTTPS).

## Controles

| Acción | PC | Móvil |
|---|---|---|
| Caminar | `WASD` / flechas | joystick (abajo a la izquierda) |
| Ir a un punto (con búsqueda de camino A*) | clic en el mapa / minimapa | tocar el mapa |
| Ir hasta un compañero | clic en su avatar o botón «Ir» en la lista | tocar su avatar |
| Centrar cámara en un compañero | clic en la lista | tocar en la lista |
| Volver a seguirte | `Esc` / botón ◎ | botón ◎ |
| Zoom | rueda / `+` `−` / botones | pellizco / botones |
| Modo coche (más rápido) | `C` o pastilla «Coche» | pastilla «Coche» |
| Pitar | `H` | botón 📯 |
| Abrir/cerrar despacho privado | `E` junto a la puerta o interruptor en «Salas» | interruptor en «Salas» |
| Reacciones | botón 😊 | botón 😊 |
| Ayuda | `?` o «Ayuda» | botón ? |

## Qué incluye

- **Mapa por tiles (32 px)** definido en `src/data/officeMap.ts` (JSON puro + pequeños helpers):
  Equipo Atlas y Equipo Vega (6 puestos cada uno), plaza central con el emblema HIVEX,
  Sala de reuniones, Café / Cocina, Zona abierta (8 puestos), Despacho privado (con candado),
  zona de descanso, jardín, calle con paso de cebra… Todo dibujado de forma procedural
  (sin sprites ni assets con copyright).
- **Colisiones** con paredes y muebles, puertas, puerta bloqueable.
- **9 compañeros simulados** (SDR, Closer, Director comercial, Customer Success) que se sientan
  en su puesto, van a la sala de reuniones, al café o pasean según su estado
  (En línea, Ausente, En reunión, Café virtual, En llamada). Cambian de estado solos.
- **Proximidad**: círculo alrededor de tu avatar; panel «Conversación cercana: X, Y» con
  volumen simulado por distancia. En salas cerradas (reuniones, despacho) todos los presentes
  comparten conversación. Indicador «Estás en Sala de reuniones».
- **UI**: barra superior con métricas (datos de ejemplo), panel lateral de miembros con rol y
  estado (y selector de tu estado), barra inferior (micro, cámara, reacciones, «Llamada con
  cliente», ayuda), minimapa clicable, «Seguimiento pendiente», pizarras «RANKING HOY» /
  «RANKING CITAS» en el mapa con el top 3.
- **Responsive**: drawer lateral en pantallas estrechas, barras compactas, joystick táctil,
  tap-to-move, pellizco, `devicePixelRatio` hasta 2× para nitidez, cambio de orientación,
  sin scroll/zoom accidental de la página, áreas seguras (notch).

> ⚠️ Todas las métricas, rankings y personas son **datos de ejemplo** (`src/data/sampleData.ts`).

## Arquitectura

```
src/
├─ config.ts              Marca (BRAND_NAME), tamaño de tile, radios, velocidades, colores
├─ main.ts                Arranque: crea Game + UI, PWA, favicon
├─ data/
│  ├─ officeMap.ts        Definición editable del mapa (salas, puertas, objetos, asientos)
│  ├─ sampleData.ts       DATOS DE EJEMPLO: miembros, métricas, rankings
│  └─ statuses.ts         Estados (etiqueta, color)
├─ game/
│  ├─ types.ts            Tipos serializables (AvatarState viaja por red)
│  ├─ world.ts            Rejilla de colisión, asientos, salas, puerta con llave
│  ├─ pathfinding.ts      A* (8 direcciones, sin cortar esquinas)
│  ├─ entities.ts         Avatar (movimiento, rutas, bocadillos, coche)
│  ├─ npc.ts              Comportamiento de compañeros simulados + reserva de asientos
│  ├─ camera.ts           Cámara con seguimiento suave y zoom
│  ├─ input.ts            Teclado + eje virtual (joystick)
│  ├─ mapRenderer.ts      Render estático del mapa a un canvas offscreen (una vez)
│  ├─ avatarRenderer.ts   Avatares, coche, etiquetas, bocadillos, retratos
│  └─ game.ts             Bucle, proximidad, salas, eventos para la UI, punteros/pellizco
├─ net/transport.ts       Interfaz PresenceTransport (+ LocalTransport) → multijugador
├─ media/proximityMedia.ts Interfaz ProximityMediaProvider (+ simulado) → WebRTC/LiveKit
├─ audio/horn.ts          Claxon con WebAudio
└─ ui/                    UI HTML/CSS sobre el canvas (ui.ts, minimap.ts, joystick.ts, icons.ts)
```

- **Render**: Canvas 2D. El mapa estático se pinta una sola vez (a 2×) y cada frame solo se
  copia la zona visible; encima se dibujan avatares (ordenados por Y), círculo de proximidad,
  puerta/candado y efectos.
- **Desacople UI ↔ juego**: la UI llama a métodos públicos de `Game` (`moveTo`, `toggleCar`,
  `focusMember`, `setPlayerStatus`…) y escucha eventos (`proximity`, `room`, `car`, `lock`…).
- **Puntos de enganche para multijugador**:
  - `PresenceTransport` (`src/net/transport.ts`): el juego ya envía tu `AvatarState` ~10 Hz y
    crea/interpola avatares remotos al recibir estados. Basta con implementar la interfaz
    con Socket.IO / Colyseus / WebSocket (hay un ejemplo comentado).
  - `ProximityMediaProvider` (`src/media/proximityMedia.ts`): cada frame recibe la lista de
    personas cercanas con su volumen (0–1). Ahí se conecta LiveKit (esqueleto comentado).
- **Editar la oficina**: mueve/añade salas y objetos en `officeMap.ts`. Las colisiones, asientos
  (`seatId`) y el minimapa se generan solos.

## Hoja de ruta (siguientes pasos)

1. **Multijugador en tiempo real**: servidor Colyseus (salas con estado autoritativo) o
   Socket.IO; implementar `PresenceTransport`; interpolación ya preparada.
2. **Audio/vídeo por proximidad con WebRTC** vía **LiveKit** (SFU): token por usuario desde el
   backend, suscripción/volumen según distancia, burbujas de vídeo sobre los avatares,
   compartir pantalla.
3. **Autenticación** (p. ej. Supabase Auth / Clerk / Auth.js) y perfiles con avatar personalizable.
4. **Roles y permisos**: propietario, director comercial, closer, SDR; llaves de despachos.
5. **Dashboard y rankings reales**: ventas, citas, llamadas desde el CRM (GoHighLevel, HubSpot…),
   gamificación, informes de jornada.
6. **Telefonía integrada** (Twilio / Aircall / Ringover): «Llamada con cliente», marcador,
   guiones de llamada, estado «En llamada» automático.
7. **Editor de mapas** visual (arrastrar muebles, crear salas) que exporte el JSON del mapa.
8. Chat, avisos, agenda, notificaciones push (PWA) y modo oscuro/noche del mapa.

## Licencia / assets

Todo el arte del mapa es procedural (código). El logo HIVEX es propiedad de HIVEX
(hivexlatam.com) y se usa como marca del producto.
