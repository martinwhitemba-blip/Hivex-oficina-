import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

/** Disco local hoy. S3_BUCKET y el resto de S3_* quedan reservados para objeto remoto. */
export interface ObjectStorage {
  put(key: string, bytes: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements ObjectStorage {
  constructor(private root: string) {}

  async put(key: string, bytes: Buffer) {
    const absolute = this.resolve(key);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
  }

  async remove(key: string) {
    const absolute = this.resolve(key);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  }

  private resolve(key: string) {
    const clean = key.split('/').filter((part) => part && part !== '.' && part !== '..').join(path.sep);
    return path.join(this.root, clean);
  }
}

function createStorage(): ObjectStorage {
  if (process.env.S3_BUCKET || process.env.S3_ENDPOINT) {
    console.warn('S3_BUCKET está definido, pero el almacenamiento remoto todavía no está conectado. Las fotos y los logos siguen en el disco local.');
  }
  return new LocalDiskStorage(env.uploadDir);
}

export const storage: ObjectStorage = createStorage();
