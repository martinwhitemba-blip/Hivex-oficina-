# Eventos de la oficina

La pista 3D puede escuchar estos eventos en el socket de la sesión. El servidor los manda **solo a la sala `empresa:{companyId}`**. Quien está en otra empresa no los ve. La presencia (`office:state`, `office:join`, `office:leave`) sigue como hasta ahora.

Nada de esto lleva marca de otra herramienta. Son cartas, misiones y gestos de la oficina.

## `task:update`

Se emite al crear, editar, mover de columna o borrar una tarea (también una subtarea).

```json
{
  "taskId": "clx…",
  "companyId": "clx…",
  "title": "Llamar al cliente oro",
  "status": "pendiente",
  "areaId": "clx…",
  "assigneeId": "clx… o null",
  "parentId": "clx… o null",
  "priority": "baja | media | alta",
  "dueDate": "2026-10-24 o null",
  "sort": 0,
  "weeklyGoalId": "clx… o null",
  "updatedAt": "2026-10-23T12:00:00.000Z",
  "deleted": false
}
```

`deleted: true` significa que la carta ya no existe. `dueDate` es el día `AAAA-MM-DD`, guardado a las 12:00 UTC. `parentId` identifica un paso de la lista; si es `null`, es una misión de primer nivel.

## `task:handoff`

Se emite cuando cambia la persona asignada (al crear con alguien, al reasignar desde el tablero o desde la torre).

```json
{
  "fromMembershipId": "clx… o null",
  "toMembershipId": "clx… o null",
  "taskId": "clx…"
}
```

`fromMembershipId` es `null` si la carta no tenía dueño. `toMembershipId` es `null` si se queda sin asignar.

## `goal:progress`

Se emite cuando el avance de una `WeeklyGoal` cambia: al cerrar una carta de primer nivel, al guardar un indicador o al ajustar una misión manual. Solo a la sala de esa empresa.

```json
{
  "goalId": "clx…",
  "companyId": "clx…",
  "weekStart": "2026-10-19",
  "metric": "tareas | kpi | manual",
  "current": 3,
  "target": 5,
  "pct": 60,
  "areaId": "clx… o null",
  "membershipId": "clx… o null",
  "awarded": false
}
```

`pct` va de 0 a 100. `awarded` pasa a `true` la vez que la misión llega al 100 % y reparte puntos e insignia. Una misión es de un área (`areaId`) o de una persona (`membershipId`).

## `office:emote`

Relé. El cliente envía y el servidor lo reexpide a la misma sala. **No se guarda.**

Cliente → servidor:

```json
{ "emote": "👋" }
```

Servidor → sala `empresa:{companyId}`:

```json
{ "membershipId": "clx…", "emote": "👋", "at": "2026-10-23T12:00:00.000Z" }
```

El texto se recorta a 16 caracteres. Si llega vacío, se ignora.

## `office:bubble`

Igual que el emote: relé, sin persistencia.

Cliente → servidor:

```json
{ "text": "¡Voy a por café!" }
```

Servidor → sala:

```json
{ "membershipId": "clx…", "text": "¡Voy a por café!", "at": "2026-10-23T12:00:00.000Z" }
```

El texto se recorta a 140 caracteres.

## `notify:new` y `notify:read`

La campana no va a toda la sala: llega solo a los sockets de esa persona dentro de la empresa, para que varias pestañas coincidan. El resto de la oficina no ve el aviso.

`notify:new`:

```json
{
  "id": "clx…",
  "kind": "assignment | due_soon | overdue | mention | achievement | handoff",
  "payload": { "taskId": "clx…", "title": "Llamar al cliente oro" },
  "createdAt": "2026-10-23T12:00:00.000Z",
  "unread": 3
}
```

`payload` es un objeto. Según el `kind` puede traer `title`, `fromName`, `dueDate`, `excerpt`, `code` o `points`. `unread` es el total sin leer de esa persona.

`notify:read`:

```json
{ "ids": ["clx…"], "unread": 2 }
```

El cliente puede montar el contador sin tocar el escenario 3D:

- `mountNotifyBadge(elemento)` en `apps/web/src/platform/notifyUnread.ts`
- `window.__hivexNotify.total()`, `.refresh()` y `.mount(elemento)`
- el evento de ventana `hivex-notify` con `detail` igual al número
- un nodo `[data-hivex-notify]` o `#hivex-notify-mount` en la barra de la oficina

## `photoPlacement`

En `Membership`, `cara` o `gafete` (por defecto `cara`). No va dentro de `look`: viaja al lado.

- `GET /api/auth/yo` → `membership.photoPlacement`
- `GET /api/empleados/:id` y el directorio de `GET /api/oficina/hud` → `photoPlacement`
- `PATCH /api/empleados/:id` con `{ "photoPlacement": "cara" | "gafete" }` desde el perfil
- cada `office:state` lo incluye junto a `look`: `{ "look": { … }, "photoPlacement": "cara" }`

La pista 3D puede leerlo sin cambiar el resto del estado. Quien ya está conectado lo recibe en el siguiente `office:join` o `office:state`.

## Límite

`office:emote` y `office:bubble` aceptan **como mucho uno por segundo y por persona**, cada uno por su lado. El que llega antes de tiempo se tira sin aviso y sin guardarlo. El resto de eventos de esta página no tiene ese límite: salen de una acción guardada (tarea o misión).
