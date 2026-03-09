import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { decryptBackupFile, readPassphraseFromEnv } from './d1-backup-crypto.mjs';

const defaultPassphraseEnv = 'D1_BACKUP_ARCHIVE_PASSPHRASE';
const helpText = `Usage: node scripts/d1-backup-decrypt.mjs --input <backup.enc> [--output <path>] [--passphrase-env <envName>]

Examples:
  npm run backup:d1:decrypt -- --input ./backups/d1/subforge-production-20260309-120000Z.sql.enc
  npm run backup:d1:decrypt -- --input ./backups/d1/subforge-production-20260309-120000Z.sql.enc --output ./tmp/restore.sql`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      'passphrase-env': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(helpText);
    return;
  }

  if (!values.input) {
    fail('--input is required');
  }

  const passphraseEnv = values['passphrase-env'] ?? defaultPassphraseEnv;
  const passphrase = readPassphraseFromEnv(passphraseEnv);
  const result = decryptBackupFile({
    inputPath: values.input,
    outputPath: values.output,
    passphrase
  });

  console.log('D1 backup decrypted.');
  console.log(`- Input: ${basename(values.input)}`);
  console.log(`- Output: ${result.outputPath}`);
  console.log(`- Passphrase env: ${passphraseEnv}`);
}

await main();
