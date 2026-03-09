import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const MAGIC = Buffer.from('SFD1ENC1', 'utf8');
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ALGORITHM = 'aes-256-gcm';

export function isEncryptedBackupPath(filePath) {
  return filePath.endsWith('.enc');
}

export function resolveEncryptedBackupPath(filePath) {
  return isEncryptedBackupPath(filePath) ? resolve(filePath) : `${resolve(filePath)}.enc`;
}

export function resolveDecryptedBackupPath(filePath) {
  const resolved = resolve(filePath);
  if (isEncryptedBackupPath(resolved)) {
    return resolved.slice(0, -4);
  }

  return `${resolved}.decrypted.sql`;
}

export function readPassphraseFromEnv(envName) {
  const passphrase = process.env[envName];
  if (!passphrase) {
    throw new Error(`Missing required passphrase env: ${envName}`);
  }

  return passphrase;
}

function deriveKey(passphrase, salt) {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

function buildChecksum(content, fileName) {
  const digest = createHash('sha256').update(content).digest('hex');
  return {
    digest,
    text: `${digest}  ${fileName}
`
  };
}

export function encryptBackupFile({ inputPath, outputPath, passphrase, removeInput = false }) {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolveEncryptedBackupPath(outputPath ?? resolvedInput);
  const plaintext = readFileSync(resolvedInput);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encrypted = Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]);
  writeFileSync(resolvedOutput, encrypted);

  const checksumPath = `${resolvedOutput}.sha256`;
  const checksum = buildChecksum(encrypted, basename(resolvedOutput));
  writeFileSync(checksumPath, checksum.text);

  if (removeInput) {
    unlinkSync(resolvedInput);
  }

  return {
    outputPath: resolvedOutput,
    checksumPath,
    checksum: checksum.digest
  };
}

export function decryptBackupFile({ inputPath, outputPath, passphrase }) {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath ?? resolveDecryptedBackupPath(resolvedInput));
  const encrypted = readFileSync(resolvedInput);
  const minimumLength = MAGIC.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH;

  if (encrypted.length < minimumLength) {
    throw new Error('Encrypted backup file is too small to be valid.');
  }

  const magic = encrypted.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error('Unsupported encrypted backup format.');
  }

  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_LENGTH;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + TAG_LENGTH;

  const salt = encrypted.subarray(saltStart, ivStart);
  const iv = encrypted.subarray(ivStart, tagStart);
  const authTag = encrypted.subarray(tagStart, ciphertextStart);
  const ciphertext = encrypted.subarray(ciphertextStart);
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  writeFileSync(resolvedOutput, plaintext);

  return {
    outputPath: resolvedOutput
  };
}
