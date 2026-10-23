# API de HIVEX (beta)

Todas las rutas de datos empiezan por `/api` y exigen sesión, salvo el alta, el acceso, aceptar una invitación y el webhook de métricas. La aplicación manda el JWT en la cabecera `X-HIVEX-Token`. `Authorization: Bearer <token>` sigue valiendo cuando el sitio no tiene puerta de acceso. Si activas `ACCESS_USER` y `ACCESS_PASSWORD`, `Authorization` queda para esa contraseña HTTP Basic y la sesión va solo en `X-HIVEX-Token`. Cada fila de negocio lleva `companyId`. Un token de una empresa no lee ni escribe datos de otra.

`GET /api/salud` → `{ "ok": true, "servicio": "hivex-beta" }`.

## Sesión

- `POST /api/auth/registro` `{ email, password, name, companyName }` crea la empresa, el propietario y un plan Starter en prueba de 14 días.
- `POST /api/auth/entrar` `{ email, password }`.
- `GET /api/auth/yo` devuelve la sesión.
- `POST /api/invitaciones` crea un código de 14 días. No envía correo. La respuesta incluye `enlace` (`#/unirse?code=`). Si el `jobTitleId` o el `areaId` ya no existen, responde 404 en español.
- `POST /api/invitaciones/:code/aceptar` `{ name, password }`.
- `POST /api/acceso-codigo` `{ code, name, email, password }` es público. Si el código está activo, crea un empleado sin área ni puesto, o entra si ese correo ya es de esa empresa. No envía correo. Un correo de otra empresa responde 409. Código inexistente o apagado: 404. Demasiados intentos desde la misma IP: 429.
- `GET /api/empresa/codigo-acceso`, `PATCH /api/empresa/codigo-acceso` `{ enabled }` y `POST /api/empresa/codigo-acceso/regenerar` los usan el propietario y el administrador. La respuesta trae `code`, `enabled` y `enlace` (`#/codigo?c=`).

Si el plan no admite más personas, la respuesta es **409** con un texto en español que indica el tope y remite a Plan y uso.

## Métricas desde fuera

El propietario ve la clave en Ajustes de integración (`GET /api/integraciones`) o, en la demo, usa `hx_demo_clave_publica`.

```http
POST /api/integraciones/metricas
X-API-Key: hx_demo_clave_publica
Content-Type: application/json

{
  "email": "hugo@hivex.demo",
  "date": "2026-10-20",
  "metrics": { "llamadas": 12, "citas": 2 },
  "note": "Desde el CRM"
}
```

La clave identifica a la empresa. El correo tiene que ser de una persona de esa empresa. Las claves de métrica tienen que existir en el área de esa persona.

## Panel del dueño

- `GET /api/dueno` estado en vivo (personas, áreas, tareas).
- `GET /api/dueno/auditoria`
- `POST /api/dueno/tareas/:id/reasignar` `{ assigneeId }`
- `POST /api/dueno/personas/:id/area` `{ areaId }` (solo propietario)
- El mismo estado llega por el socket en el evento `panel:state` después de `panel:sync` o de cualquier cambio.

## Planes

- `GET /api/plan` uso frente a límites.
- `POST /api/plan` `{ code: "starter" | "pro" | "empresa" }` cambia el plan **sin cobro**.

`PaymentProvider` (`apps/server/src/payments.ts`) reserva `createCheckout` y `handleWebhook` para una pasarela posterior (Stripe). La implementación actual lanza un error claro y no cobra.

## Captación (sin marcador)

- `GET /api/captacion` contadores vacíos y el texto de «Próximamente».
- `POST /api/captacion/activar` crea el área plantilla Llamadas y una zona, si el plan lo permite.

`TelephonyProvider` (`apps/server/src/telephony.ts`) reserva:

- `placeCall` para salir por Zadarma o Twilio
- `handleWebhook` para el estado de la llamada
- `assignLead` para el reparto

Hoy el proveedor está desactivado y no abre llamadas.

## Oficina en vivo

Socket.IO con `auth.token` igual al JWT.

- `office:join` / `office:state` / `office:leave` presencia del avatar
- `office:lock` puerta del despacho
- `chat:send` `{ body, areaId }` (`areaId` vacío = general)
- `dm:send` `{ to, body }` mensaje directo. `to` es el id de una persona de la misma empresa. El servidor lo guarda y emite `dm:message` solo a quien escribe y a quien recibe, y solo si su socket es de esa `companyId`.
- `webrtc:signal` retransmite la señal de audio directo

## Mensajes directos

- `GET /api/directos` lista a los compañeros de tu empresa, con el no leído y el último texto.
- `GET /api/directos/:id` hilo con esa persona y marca como leídos los que te llegaron. 404 si no es de tu empresa.
- `POST /api/directos/:id` `{ body }` envía y persiste el mensaje.
- `presence:ping` suma tiempo conectado (como máximo 60 s por aviso)
- `panel:sync` pide un `panel:state`
