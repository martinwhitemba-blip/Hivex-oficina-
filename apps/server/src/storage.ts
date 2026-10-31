import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';
import { s3Send, s3Settings } from './storageS3';

/** Disco local, o S3/R2 si hay cubo y las dos claves. Las claves no se escriben en el log. */
export interface ObjectStorage {
  kind: 'local' | 's3';
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements ObjectStorage {
  kind = 'local' as const;
  constructor(private root: string) {}

  async put(key: string, bytes: Buffer) {
    const absolute = this.resolve(key);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
  }

  async get(key: string) {
    const absolute = this.resolve(key);
    if (!fs.existsSync(absolute)) throw new Error('archivo ausente');
    return fs.readFileSync(absolute);
  }

  async remove(key: string) {
    const absolute = this.resolve(key);
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  }

  private resolve(key: string) {
    const clean = key.split('/').filter((part) => part && part !== '.' && part !== '..').join(path.sep);
    const absolute = path.resolve(this.root, clean);
    const root = path.resolve(this.root);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error('ruta fuera del almacén');
    return absolute;
  }
}

class S3Storage implements ObjectStorage {
  kind = 's3' as const;
  constructor(private settings: ReturnType<typeof s3Settings>) {}

  async put(key: string, bytes: Buffer, contentType?: string) {
    await s3Send('PUT', key, bytes, contentType || 'application/octet-stream', this.settings);
  }

  async get(key: string) {
    return s3Send('GET', key, Buffer.alloc(0), undefined, this.settings);
  }

  async remove(key: string) {
    await s3Send('DELETE', key, Buffer.alloc(0), undefined, this.settings);
  }
}

function createStorage(): ObjectStorage {
  const settings = s3Settings();
  if ((process.env.S3_BUCKET || process.env.S3_ENDPOINT) && !settings.ready) {
    console.warn('S3_BUCKET está definido, pero faltan S3_ACCESS_KEY o S3_SECRET_KEY. Los archivos siguen en el disco local.');
  }
  if (settings.ready) return new S3Storage(settings);
  return new LocalDiskStorage(env.uploadDir);
}

export const storage: ObjectStorage = createStorage();
