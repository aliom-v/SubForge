import { mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { encryptBackupFile, readPassphraseFromEnv } from './d1-backup-crypto.mjs';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const defaultPassphraseEnv = 'D1_BACKUP_ARCHIVE_PASSPHRASE';
const environmentMap = {
  production: {
    databaseName: 'subforge',
    wranglerEnvArgs: []
  },
  staging: {
    databaseName: 'subforge-staging',
    wranglerEnvArgs: ['--env', 'staging']
  }
};
const scopeMap = {
  full: [],
  schema: ['--no-data'],
  data: ['--no-schema']
};
const helpText = `Usage: node scripts/d1-backup.mjs [--environment production|staging] [--scope full|schema|data] [--local|--remote] [--output <path>] [--output-dir <dir>] [--label <suffix>] [--encrypt] [--delete-plain] [--passphrase-env <envName>]

Examples:
  npm run backup:d1
  npm run backup:d1:staging
  npm run backup:d1 -- --scope schema
  npm run backup:d1 -- --encrypt --passphrase-env ${defaultPassphraseEnv}
  npm run backup:d1 -- --environment production --label gha-${process.pid}`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(command, args) {
  const display = formatCommand(command, args);
  console.log();
  console.log(`> ${display}`);

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${display}`);
  }
}

function sanitizeSegment(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function buildTimestamp() {
  return new Date().toISOString().replace(/:/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

function resolveMode(values) {
  if (values.local && values.remote) {
    fail('choose either --local or --remote');
  }

  if (values.local) {
    return 'local';
  }

  return 'remote';
}

function buildOutputPath({ environment, scope, output, outputDir, label }) {
  if (output) {
    const resolved = resolve(output);
    mkdirSync(dirname(resolved), { recursive: true });
    return resolved;
  }

  const timestamp = buildTimestamp();
  const filename = [
    'subforge',
    environment,
    scope === 'full' ? null : scope,
    timestamp,
    label ? sanitizeSegment(label) : null
  ]
    .filter(Boolean)
    .join('-') + '.sql';
  const resolvedDir = resolve(outputDir);
  mkdirSync(resolvedDir, { recursive: true });
  return resolve(resolvedDir, filename);
}

async function main() {
  const { values } = parseArgs({
    options: {
      environment: { type: 'string' },
      scope: { type: 'string' },
      output: { type: 'string' },
      'output-dir': { type: 'string' },
      label: { type: 'string' },
      encrypt: { type: 'boolean' },
      'delete-plain': { type: 'boolean' },
      'passphrase-env': { type: 'string' },
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(helpText);
    return;
  }

  const environment = values.environment ?? 'production';
  const scope = values.scope ?? 'full';
  const mode = resolveMode(values);
  const outputPath = buildOutputPath({
    environment,
    scope,
    output: values.output,
    outputDir: values['output-dir'] ?? 'backups/d1',
    label: values.label
  });

  const environmentConfig = environmentMap[environment];
  if (!environmentConfig) {
    fail(`unsupported environment: ${environment}`);
  }

  const scopeArgs = scopeMap[scope];
  if (!scopeArgs) {
    fail(`unsupported scope: ${scope}`);
  }

  if (values['delete-plain'] && !values.encrypt) {
    fail('--delete-plain requires --encrypt');
  }

  const modeArgs = mode === 'local' ? ['--local'] : ['--remote'];
  const args = [
    'wrangler',
    'd1',
    'export',
    environmentConfig.databaseName,
    ...modeArgs,
    ...environmentConfig.wranglerEnvArgs,
    '--config',
    './wrangler.toml',
    '--output',
    outputPath,
    ...scopeArgs
  ];

  console.log('Preparing D1 backup...');
  console.log(`- Environment: ${environment}`);
  console.log(`- Database: ${environmentConfig.databaseName}`);
  console.log(`- Mode: ${mode}`);
  console.log(`- Scope: ${scope}`);
  console.log(`- Output: ${outputPath}`);
  console.log(`- Encrypt: ${values.encrypt ? 'yes' : 'no'}`);

  runCommand(npxCommand, args);

  if (values.encrypt) {
    const passphraseEnv = values['passphrase-env'] ?? defaultPassphraseEnv;
    const passphrase = readPassphraseFromEnv(passphraseEnv);
    const archive = encryptBackupFile({
      inputPath: outputPath,
      passphrase,
      removeInput: Boolean(values['delete-plain'])
    });

    console.log();
    console.log('D1 backup encrypted.');
    console.log(`- Archive: ${archive.outputPath}`);
    console.log(`- Checksum: ${archive.checksumPath}`);
    console.log(`- Passphrase env: ${passphraseEnv}`);

    return;
  }

  console.log();
  console.log('D1 backup complete.');
  console.log(`- File: ${outputPath}`);
  console.log(`- Filename: ${basename(outputPath)}`);
}

await main();
