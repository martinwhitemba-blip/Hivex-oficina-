# Fase 3

Todo esto funciona sin claves. Las variables solo hacen falta para el modo real.

## Archivos de tareas

| Variable | Para qué |
| --- | --- |
| `S3_BUCKET` | Nombre del cubo |
| `S3_ACCESS_KEY` | Clave de acceso |
| `S3_SECRET_KEY` | Clave secreta |
| `S3_ENDPOINT` | Opcional. En R2 es `https://<cuenta>.r2.cloudflarestorage.com` |
| `S3_REGION` | Opcional. Con endpoint, por defecto `auto`. En S3 de AWS, por ejemplo `eu-west-1` |

Si falta el cubo o una de las dos claves, fotos y archivos se quedan en `UPLOAD_DIR`.

## Asistente del dueño

| Variable | Para qué |
| --- | --- |
| `HIVEX_AI_BASE_URL` | URL compatible con OpenAI, por ejemplo `https://api.openai.com/v1` |
| `HIVEX_AI_API_KEY` | Clave de ese servicio |
| `HIVEX_AI_MODEL` | Opcional. Por defecto `gpt-4o-mini` |

Sin las dos primeras, el asistente responde en modo básico con las tareas y la carga de esa empresa.

## Conexiones

No hay variables de Slack ni de Google. Cada empresa pega una URL https pública en Conexiones.

- Formato Slack: el cuerpo es `{ "text": "..." }`, el de un incoming webhook.
- Formato genérico: `{ "event", "companyId", "taskId", "title", "at" }`. La cabecera `X-Hivex-Signature` es el HMAC SHA-256 del cuerpo con el secreto que se enseña una sola vez.

Google Calendar no tiene acceso con cuenta de Google. Un puente puede crear el evento a partir del aviso genérico. Hace falta que Martin decida si más adelante quiere la pantalla de permiso de Google y de Slack (hace falta el identificador de una aplicación, que no tenemos).

Las URLs privadas, de metadatos y sin https se rechazan. En los tests se permite http solo para hosts públicos.
