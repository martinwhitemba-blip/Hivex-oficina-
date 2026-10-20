// Renombra la salida del build single-file a dist-single/oficina-virtual.html
import { renameSync, existsSync } from 'node:fs';
const from = 'dist-single/index.html';
const to = 'dist-single/oficina-virtual.html';
if (existsSync(from)) { renameSync(from, to); console.log('✔ Single-file listo:', to); }
