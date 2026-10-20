import { buildApp } from './app';
import { ensurePlans } from './billing';
import { env } from './env';

await ensurePlans();
const { app } = await buildApp();
await app.listen({ port: env.port, host: '0.0.0.0' });
console.log(`HIVEX beta escuchando en el puerto ${env.port}`);
