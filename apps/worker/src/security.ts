import type { AdminRole } from '@subforge/shared';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AdminSessionPayload {
  sub: string;
  username: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;

  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

export function createId(prefix: string): string {
  return `${prefix}_${createRandomToken(10)}`;
}

export function createRandomToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function hashPassword(password: string, salt = createRandomToken(16)): Promise<string> {
  const iterations = 100000;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations
    },
    keyMaterial,
    256
  );

  return `pbkdf2$${iterations}$${salt}$${toBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, iterationsRaw, salt, expectedHash] = storedHash.split('$');

  if (scheme !== 'pbkdf2' || !iterationsRaw || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsRaw);

  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const calculated = await hashPasswordWithSalt(password, salt, iterations);
  return timingSafeEqual(calculated, expectedHash);
}

async function hashPasswordWithSalt(password: string, salt: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations
    },
    keyMaterial,
    256
  );

  return toBase64Url(new Uint8Array(bits));
}

export async function signAdminSessionToken(
  payload: Omit<AdminSessionPayload, 'exp' | 'iat'>,
  secret: string,
  ttlSeconds = 24 * 60 * 60
): Promise<string> {
  const issuedAt = Date.now();
  const sessionPayload: AdminSessionPayload = {
    ...payload,
    iat: issuedAt,
    exp: Math.floor(issuedAt / 1000) + ttlSeconds
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(sessionPayload)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload));

  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAdminSessionToken(
  token: string,
  secret: string
): Promise<AdminSessionPayload | null> {
  try {
    const [encodedPayload, encodedSignature] = token.split('.');

    if (!encodedPayload || !encodedSignature) {
      return null;
    }

    const key = await importHmacKey(secret);
    const verified = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(encodedSignature),
      encoder.encode(encodedPayload)
    );

    if (!verified) {
      return null;
    }

    const rawPayload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as Partial<AdminSessionPayload>;

    if (typeof rawPayload.exp !== 'number' || !Number.isFinite(rawPayload.exp)) {
      return null;
    }

    if (rawPayload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      sub: String(rawPayload.sub ?? ''),
      username: String(rawPayload.username ?? ''),
      role: rawPayload.role as AdminRole,
      iat: typeof rawPayload.iat === 'number' && Number.isFinite(rawPayload.iat) ? rawPayload.iat : 0,
      exp: rawPayload.exp
    };
  } catch {
    return null;
  }
}
