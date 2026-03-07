import { webcrypto } from 'node:crypto';

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createRandomToken(length = 16) {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hashPassword(password, salt = createRandomToken(16)) {
  const iterations = 100000;
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await webcrypto.subtle.deriveBits(
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

function createId(prefix) {
  return `${prefix}_${createRandomToken(10)}`;
}

async function main() {
  const [, , username, password] = process.argv;

  if (!username || !password) {
    console.error('Usage: node scripts/generate-admin.mjs <username> <password>');
    process.exit(1);
  }

  const id = createId('adm');
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const sql = [
    'INSERT INTO admins (id, username, password_hash, role, status, created_at, updated_at)',
    `VALUES ('${id}', '${username.replace(/'/g, "''")}', '${passwordHash.replace(/'/g, "''")}', 'admin', 'active', '${now}', '${now}');`
  ].join('\n');

  console.log(sql);
}

await main();
