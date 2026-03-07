import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

function assertIncludes(content, expected, label) {
  assert.ok(content.includes(expected), `${label} should include: ${expected}`);
}

async function captureModuleOutput(relativePath, argv = []) {
  const logs = [];
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  process.argv = ['node', relativePath, ...argv];
  console.log = (...args) => {
    logs.push(args.join(' '));
  };
  console.error = (...args) => {
    logs.push(args.join(' '));
  };
  process.exit = ((code) => {
    throw new Error(`process.exit:${code ?? 0}`);
  });

  try {
    const url = pathToFileURL(`${process.cwd()}/${relativePath}`);
    await import(`${url.href}?ts=${Date.now()}`);
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return logs.join('\n');
}

const adminSql = await captureModuleOutput('scripts/generate-admin.mjs', ['admin', 'demo-password']);
assertIncludes(adminSql, 'INSERT INTO admins', 'admin seed output');
assertIncludes(adminSql, "'admin'", 'admin seed username');
assertIncludes(adminSql, 'pbkdf2$', 'admin seed password hash');

const demoSql = await captureModuleOutput('scripts/generate-demo-seed.mjs');
for (const tableName of ['users', 'nodes', 'templates', 'rule_sources', 'rule_snapshots', 'user_node_map']) {
  assertIncludes(demoSql, `INSERT INTO ${tableName}`, 'demo seed output');
}
assertIncludes(demoSql, '-- Demo tokens', 'demo seed tokens header');
assertIncludes(demoSql, 'Demo Alice', 'demo seed user A');
assertIncludes(demoSql, 'Demo Bob', 'demo seed user B');

const wrangler = readFileSync('wrangler.toml', 'utf8');
assertIncludes(wrangler, 'PREVIEW_CACHE_TTL', 'wrangler vars');
assertIncludes(wrangler, 'SYNC_HTTP_TIMEOUT_MS', 'wrangler vars');
assertIncludes(wrangler, '[assets]', 'wrangler assets config');
assertIncludes(wrangler, 'directory = "./apps/web/dist"', 'wrangler assets directory');
assertIncludes(wrangler, 'not_found_handling = "single-page-application"', 'wrangler spa handling');
assert.ok(!wrangler.includes('YOUR_D1_DATABASE_ID'), 'wrangler should not contain D1 placeholder ids');
assert.ok(!wrangler.includes('YOUR_KV_NAMESPACE_ID'), 'wrangler should not contain KV placeholder ids');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts.deploy, 'npm run build:web && npm run db:migrations:apply && npm run deploy:worker', 'root deploy script');
assert.equal(packageJson.scripts.build, 'npm run build:web && npm run build:worker', 'root build script');
assert.equal(packageJson.scripts['test:smoke'], 'node scripts/smoke-check.mjs', 'smoke script');
assert.ok(packageJson.cloudflare?.bindings?.ADMIN_JWT_SECRET, 'package.json should describe Cloudflare bindings');

const readme = readFileSync('README.md', 'utf8');
assertIncludes(readme, 'PREVIEW_CACHE_TTL', 'README env docs');
assertIncludes(readme, '规则源支持 `text` / `yaml` / `json`', 'README sync docs');
assertIncludes(readme, 'Deploy to Cloudflare', 'README deploy button');
assertIncludes(readme, '首次安装向导', 'README setup wizard docs');

const webApi = readFileSync('apps/web/src/api.ts', 'utf8');
assertIncludes(webApi, "const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';", 'web api same-origin default');

const viteConfig = readFileSync('apps/web/vite.config.ts', 'utf8');
assertIncludes(viteConfig, "'/api': 'http://127.0.0.1:8787'", 'vite api proxy');
assertIncludes(viteConfig, "'/s': 'http://127.0.0.1:8787'", 'vite subscription proxy');

const workerIndex = readFileSync('apps/worker/src/index.ts', 'utf8');
assertIncludes(workerIndex, 'handleSetupStatus', 'worker setup status handler');
assertIncludes(workerIndex, 'handleSetupBootstrap', 'worker setup bootstrap handler');

console.log('Smoke checks passed.');
