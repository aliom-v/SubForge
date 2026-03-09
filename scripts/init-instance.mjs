import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const helpText = `Usage: node scripts/init-instance.mjs [--local|--remote] [--deploy] [--with-demo] [--admin-user <username> --admin-password <password>] [--skip-smoke] [--skip-migrations]

Examples:
  npm run init:local
  npm run init:local -- --admin-user admin --admin-password your-password --with-demo
  npm run init:remote -- --admin-user admin --admin-password your-password`;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function formatCommand(command, args) {
  return [command, ...args].join(' ');
}

function runCommand(command, args, options = {}) {
  const display = formatCommand(command, args);
  console.log(`\n> ${display}`);

  const result = spawnSync(command, args, {
    stdio: options.input == null ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
    input: options.input
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${display}`);
  }
}

function captureCommand(command, args) {
  const display = formatCommand(command, args);
  const result = spawnSync(command, args, {
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || `Command failed: ${display}`);
  }

  return result.stdout;
}

function extractDemoTokens(sql) {
  return sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-- ') && line.includes(': '))
    .map((line) => line.slice(3));
}

function printSummary({ mode, deployed, adminUsername, demoTokens }) {
  console.log('\nSubForge initialization complete.');
  console.log(`- Mode: ${mode}`);

  if (deployed) {
    console.log('- Deploy: completed');
  }

  if (adminUsername) {
    console.log(`- Seeded admin: ${adminUsername}`);
  } else {
    console.log('- Seeded admin: skipped');
  }

  if (demoTokens.length > 0) {
    console.log('- Demo data: imported');
    for (const tokenLine of demoTokens) {
      console.log(`  ${tokenLine}`);
    }
  } else {
    console.log('- Demo data: skipped');
  }

  console.log('\nNext steps:');

  if (mode === 'local') {
    console.log('- Start Worker: npm run dev:worker');
    console.log('- Start Web: npm run dev:web');
    console.log('- Check setup status: http://127.0.0.1:8787/api/setup/status');
    if (!adminUsername) {
      console.log('- Create the first admin in the setup wizard after opening the web UI');
    }
    return;
  }

  console.log('- Verify the deployed service: GET /health and GET /api/setup/status');
  if (!adminUsername) {
    console.log('- Create the first admin from the deployed web setup wizard');
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      deploy: { type: 'boolean' },
      'with-demo': { type: 'boolean' },
      'skip-smoke': { type: 'boolean' },
      'skip-migrations': { type: 'boolean' },
      'admin-user': { type: 'string' },
      'admin-password': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(helpText);
    return;
  }

  if (values.local && values.remote) {
    fail('choose either --local or --remote');
  }

  const mode = values.remote ? 'remote' : 'local';
  const scopeFlag = mode === 'remote' ? '--remote' : '--local';
  const adminUsername = values['admin-user'];
  const adminPassword = values['admin-password'];
  const withDemo = Boolean(values['with-demo']);
  const shouldDeploy = mode === 'remote' && Boolean(values.deploy);

  if (values.deploy && mode !== 'remote') {
    fail('--deploy can only be used together with --remote');
  }

  if (shouldDeploy && values['skip-migrations']) {
    fail('--deploy already applies migrations through npm run deploy');
  }

  if ((adminUsername && !adminPassword) || (!adminUsername && adminPassword)) {
    fail('--admin-user and --admin-password must be provided together');
  }

  console.log(`Initializing SubForge in ${mode} mode...`);

  if (!values['skip-smoke']) {
    runCommand(npmCommand, ['run', 'test:smoke']);
  }

  if (shouldDeploy) {
    runCommand(npmCommand, ['run', 'build']);
    runCommand(npmCommand, ['run', 'deploy']);
  } else if (!values['skip-migrations']) {
    runCommand(npxCommand, ['wrangler', 'd1', 'migrations', 'apply', 'DB', scopeFlag, '--config', './wrangler.toml']);
  }

  if (adminUsername && adminPassword) {
    const adminSql = captureCommand(process.execPath, ['scripts/generate-admin.mjs', adminUsername, adminPassword]);
    runCommand(npxCommand, ['wrangler', 'd1', 'execute', 'DB', scopeFlag, '--config', './wrangler.toml', '--file', '-'], {
      input: adminSql
    });
  }

  let demoTokens = [];

  if (withDemo) {
    const demoSql = captureCommand(process.execPath, ['scripts/generate-demo-seed.mjs']);
    demoTokens = extractDemoTokens(demoSql);
    runCommand(npxCommand, ['wrangler', 'd1', 'execute', 'DB', scopeFlag, '--config', './wrangler.toml', '--file', '-'], {
      input: demoSql
    });
  }

  printSummary({
    mode,
    deployed: shouldDeploy,
    adminUsername,
    demoTokens
  });
}

await main();
