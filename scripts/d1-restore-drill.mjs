import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { decryptBackupFile, isEncryptedBackupPath, readPassphraseFromEnv } from './d1-backup-crypto.mjs';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const defaultPassphraseEnv = 'D1_BACKUP_ARCHIVE_PASSPHRASE';
const requiredTables = [
  'admins',
  'users',
  'nodes',
  'templates',
  'user_node_map',
  'audit_logs'
];
const environmentMap = {
  production: [],
  staging: ['--env', 'staging']
};
const helpText = `Usage: node scripts/d1-restore-drill.mjs --file <backup.sql|backup.sql.enc> [--environment production|staging] [--prepare-schema] [--persist-to <dir>] [--keep-persist] [--passphrase-env <envName>]

Examples:
  npm run d1:restore:drill -- --file ./backups/d1/subforge-production-20260309-120000Z.sql
  npm run d1:restore:drill -- --file ./backups/d1/subforge-production-data.sql --prepare-schema
  npm run d1:restore:drill -- --file ./backups/d1/subforge-production-20260309-120000Z.sql.enc --passphrase-env ${defaultPassphraseEnv}`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(command, args, options = {}) {
  const display = formatCommand(command, args);
  console.log();
  console.log(`> ${display}`);

  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `Command failed: ${display}`);
  }

  return result.stdout ?? '';
}

function buildPersistDirectory(value) {
  if (value) {
    const resolved = resolve(value);
    mkdirSync(resolved, { recursive: true });
    return { path: resolved, autoCreated: false };
  }

  const path = mkdtempSync(resolve(tmpdir(), 'subforge-d1-restore-'));
  return { path, autoCreated: true };
}

function cleanupPersistDirectory(persistDirectory, keepPersist) {
  if (!persistDirectory.autoCreated || keepPersist) {
    return;
  }

  rmSync(persistDirectory.path, { recursive: true, force: true });
}

function ensureContainsAllTables(output) {
  const missing = requiredTables.filter((tableName) => !output.includes(tableName));
  if (missing.length > 0) {
    throw new Error(`Restore drill missing expected tables: ${missing.join(', ')}`);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      environment: { type: 'string' },
      'prepare-schema': { type: 'boolean' },
      'persist-to': { type: 'string' },
      'keep-persist': { type: 'boolean' },
      'passphrase-env': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(helpText);
    return;
  }

  const file = values.file;
  if (!file) {
    fail('--file is required');
  }

  const backupFile = resolve(file);
  if (!existsSync(backupFile)) {
    fail(`backup file does not exist: ${backupFile}`);
  }

  const environment = values.environment ?? 'production';
  const environmentArgs = environmentMap[environment];
  if (!environmentArgs) {
    fail(`unsupported environment: ${environment}`);
  }

  const persistDirectory = buildPersistDirectory(values['persist-to']);
  const keepPersist = Boolean(values['keep-persist']);
  const prepareSchema = Boolean(values['prepare-schema']);
  const passphraseEnv = values['passphrase-env'] ?? defaultPassphraseEnv;
  const isEncrypted = isEncryptedBackupPath(backupFile);
  let restoreFilePath = backupFile;

  console.log('Starting D1 restore drill...');
  console.log(`- Environment: ${environment}`);
  console.log(`- Backup file: ${backupFile}`);
  console.log(`- Prepare schema: ${prepareSchema ? 'yes' : 'no'}`);
  console.log(`- Persist dir: ${persistDirectory.path}`);
  console.log(`- Encrypted input: ${isEncrypted ? 'yes' : 'no'}`);

  try {
    if (isEncrypted) {
      const passphrase = readPassphraseFromEnv(passphraseEnv);
      const decrypted = decryptBackupFile({
        inputPath: backupFile,
        outputPath: resolve(persistDirectory.path, basename(backupFile, '.enc')),
        passphrase
      });
      restoreFilePath = decrypted.outputPath;
      console.log(`- Decrypted restore file: ${restoreFilePath}`);
      console.log(`- Passphrase env: ${passphraseEnv}`);
    }

    if (prepareSchema) {
      runCommand(npxCommand, [
        'wrangler',
        'd1',
        'migrations',
        'apply',
        'DB',
        '--local',
        ...environmentArgs,
        '--config',
        './wrangler.toml',
        '--persist-to',
        persistDirectory.path
      ]);
    }

    runCommand(npxCommand, [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      ...environmentArgs,
      '--config',
      './wrangler.toml',
      '--persist-to',
      persistDirectory.path,
      '--file',
      restoreFilePath,
      '-y'
    ]);

    const tableOutput = runCommand(npxCommand, [
      'wrangler',
      'd1',
      'execute',
      'DB',
      '--local',
      ...environmentArgs,
      '--config',
      './wrangler.toml',
      '--persist-to',
      persistDirectory.path,
      '--command',
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    ], { capture: true });

    ensureContainsAllTables(tableOutput);

    console.log();
    console.log('D1 restore drill passed.');
    console.log(`- Backup file: ${basename(backupFile)}`);
    console.log(`- Verified tables: ${requiredTables.length}`);
    console.log(`- Persist dir: ${persistDirectory.path}`);
  } finally {
    cleanupPersistDirectory(persistDirectory, keepPersist);
  }
}

await main();
