import crypto from 'node:crypto';

export interface S3Settings {
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
  endpoint: string;
  ready: boolean;
}

export function s3Settings(env: NodeJS.ProcessEnv = process.env): S3Settings {
  const bucket = env.S3_BUCKET?.trim() || '';
  const accessKey = env.S3_ACCESS_KEY?.trim() || '';
  const secretKey = env.S3_SECRET_KEY?.trim() || '';
  const endpoint = env.S3_ENDPOINT?.trim().replace(/\/$/, '') || '';
  const region = env.S3_REGION?.trim() || (endpoint ? 'auto' : 'us-east-1');
  return { bucket, accessKey, secretKey, region, endpoint, ready: Boolean(bucket && accessKey && secretKey) };
}

function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function hashHex(bytes: Buffer | string) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function encodeKey(key: string) {
  return key.split('/').filter((part) => part && part !== '.' && part !== '..').map(encodeURIComponent).join('/');
}

/** Firma AWS4. Sirve para S3 y para R2: cambia el host, no el algoritmo. */
export function signS3Request(input: {
  method: string;
  host: string;
  path: string;
  body: Buffer;
  now: Date;
  settings: S3Settings;
  contentType?: string;
}) {
  const amz = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const payload = hashHex(input.body);
  const headers: [string, string][] = [
    ['host', input.host],
    ['x-amz-content-sha256', payload],
    ['x-amz-date', amz],
  ];
  if (input.contentType) headers.push(['content-type', input.contentType]);
  headers.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonical = headers.map(([name, value]) => `${name}:${value}\n`).join('');
  const signed = headers.map(([name]) => name).join(';');
  const request = [input.method, input.path, '', canonical, signed, payload].join('\n');
  const scope = `${day}/${input.settings.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hashHex(request)}`;
  const kDate = hmac(`AWS4${input.settings.secretKey}`, day);
  const kRegion = hmac(kDate, input.settings.region);
  const kService = hmac(kRegion, 's3');
  const signature = crypto.createHmac('sha256', hmac(kService, 'aws4_request')).update(toSign, 'utf8').digest('hex');
  return {
    amz,
    payload,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.settings.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

export function s3Target(settings: S3Settings, key: string) {
  const pathKey = encodeKey(key);
  if (settings.endpoint) {
    const endpoint = new URL(settings.endpoint);
    const path = `/${settings.bucket}/${pathKey}`;
    return { host: endpoint.host, url: `${endpoint.origin}${path}`, path };
  }
  const host = `${settings.bucket}.s3.${settings.region}.amazonaws.com`;
  const path = `/${pathKey}`;
  return { host, url: `https://${host}${path}`, path };
}

export async function s3Send(method: string, key: string, body: Buffer, contentType: string | undefined, settings: S3Settings) {
  const target = s3Target(settings, key);
  const signed = signS3Request({
    method,
    host: target.host,
    path: target.path,
    body,
    now: new Date(),
    settings,
    contentType,
  });
  const headers: Record<string, string> = {
    authorization: signed.authorization,
    'x-amz-content-sha256': signed.payload,
    'x-amz-date': signed.amz,
  };
  if (contentType) headers['content-type'] = contentType;
  const response = await fetch(target.url, {
    method,
    headers,
    body: method === 'GET' || method === 'DELETE' ? undefined : new Uint8Array(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status >= 300) {
    const error = new Error(`s3 ${response.status}`);
    throw error;
  }
  if (method === 'GET') return Buffer.from(await response.arrayBuffer());
  return Buffer.alloc(0);
}
