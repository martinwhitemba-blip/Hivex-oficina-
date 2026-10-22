# Arquitectura para muchas empresas a la vez

HIVEX es un solo servicio (web y API) con los datos separados por empresa. La oficina 3D no cambia: cada persona entra en la sala de su empresa y solo ve a los suyos.

## Inquilino

Toda lectura y escritura de negocio lleva `companyId`. El filtro común está en `apps/server/src/tenant.ts` (`companyScope`). Un identificador de otra empresa responde 404, no con los datos ajenos. La sesión es un JWT sin estado en el servidor: el proceso no guarda la sesión, así que se puede repetir detrás de un balanceador.

Módulos ya separados del archivo de rutas: marcas (`branding.ts`), altas (`peopleImport.ts`), archivos (`storage.ts`), mensajes directos (`direct.ts`), planes (`billing.ts`) y presencia (`socket.ts`).

## Base de datos

En local se usa SQLite. Si `DATABASE_URL` empieza por `postgres`, Prisma abre un pool con `PRISMA_CONNECTION_LIMIT` (por defecto 10) y `PRISMA_POOL_TIMEOUT` (por defecto 20 segundos), salvo que la URL ya traiga esos parámetros.

Índices por `companyId` en áreas, puestos, invitaciones, salas, activaciones, tareas, informes, chat, auditoría y el resto de tablas calientes. El puesto de una persona se busca por `(companyId, membershipId)`. El directorio de directos ya no hace una consulta por compañero: una sola lectura trae los últimos mensajes.

Las listas aceptan `take` y `cursor`. Sin esos parámetros, personas y áreas siguen devolviendo el array de siempre para no romper la pantalla. El chat de la interfaz pide `take=80` y recibe `{ items, next }`.

## Presencia

Cada conexión entra en la sala `empresa:{companyId}`. La posición se reenvía como mucho unas 12 veces por segundo. Con 40 personas o menos en línea, toda la empresa ve a todas. A partir de ahí solo se reenvía a quien está en la misma área o a menos de unos cientos de píxeles, para que una oficina pequeña no se quede vacía.

Si `REDIS_URL` tiene valor, Socket.IO usa el adaptador de Redis y varios procesos comparten esas salas. Sin esa variable, un solo proceso basta y no hace falta Redis.

## Archivos

Fotos y logos pasan por `ObjectStorage` (`storage.ts`) y hoy se escriben en disco (`UPLOAD_DIR`). `S3_BUCKET` y `S3_ENDPOINT` están reservados: si aparecen, el proceso avisa y sigue en disco. No hay cliente de objeto remoto conectado.

## Prueba de carga

No forma parte de los tests automáticos. Contra un servidor ya arrancado:

```bash
BASE_URL=http://127.0.0.1:8787 COMPANIES=100 USERS=2 SECONDS=8 node scripts/load-office.mjs
```

Crea empresas de prueba, abre un socket por persona y mueve a cada una. Imprime cuántas conexiones aguantaron y errores. Empieza con pocas empresas si la máquina es justa.

## Qué sigue haciendo falta pagar

Esto corre hoy en el plan gratuito de Render, con SQLite en el disco del contenedor y sin Redis.

Para 100 empresas a la vez, de verdad, hace falta:

- Un plan de Render de pago (o equivalente) con más de una instancia y disco que no se borre en cada despliegue. El plan gratis se duerme y pierde el disco.
- Postgres gestionado. Delante, PgBouncer (o el pooler del proveedor) además del `connection_limit` de Prisma. SQLite no sirve para varios procesos.
- Redis gestionado, y `REDIS_URL`, en cuanto haya más de un proceso de la API. Si no, la presencia de una instancia no llega a la otra.
- Almacén de objetos (S3, R2 o compatible) para fotos y logos. Hoy el disco local se pierde al redesplegar. Las variables `S3_*` son el sitio, todavía sin código que las use.
- El cobro de los planes sigue siendo un aviso: no hay pasarela. Subir de plan no cobra.

LiveKit, si se quiere audio de varias personas a la vez, también es un servicio aparte. Sin sus claves, la oficina usa audio directo entre navegadores.
