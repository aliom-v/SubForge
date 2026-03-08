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
assertIncludes(wrangler, 'main = "apps/worker/src/index.ts"', 'wrangler worker entry');
assertIncludes(wrangler, '[assets]', 'wrangler assets config');
assertIncludes(wrangler, 'directory = "./apps/web/dist"', 'wrangler assets directory');
assertIncludes(wrangler, 'not_found_handling = "single-page-application"', 'wrangler spa handling');
assertIncludes(wrangler, 'run_worker_first = true', 'wrangler worker-first flag');
assertIncludes(wrangler, 'binding = "DB"', 'wrangler d1 binding');
assertIncludes(wrangler, 'binding = "SUB_CACHE"', 'wrangler kv binding');
assertIncludes(wrangler, 'crons = ["0 * * * *"]', 'wrangler cron config');
assert.ok(!wrangler.includes('YOUR_D1_DATABASE_ID'), 'wrangler should not contain D1 placeholder ids');
assert.ok(!wrangler.includes('YOUR_KV_NAMESPACE_ID'), 'wrangler should not contain KV placeholder ids');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(packageJson.scripts.build, 'npm run build:web', 'root build script');
assert.equal(packageJson.scripts.deploy, 'npm run db:migrations:apply && npm run deploy:worker', 'root deploy script');
assert.equal(
  packageJson.scripts['db:migrations:apply:local'],
  'npm run db:migrations:apply:local --workspace @subforge/worker',
  'root local migration script'
);
assert.equal(packageJson.scripts.test, 'node --test tests/*.test.mjs', 'root test script');
assert.equal(packageJson.scripts['test:smoke'], 'node scripts/smoke-check.mjs', 'smoke script');
assert.ok(packageJson.cloudflare?.bindings?.ADMIN_JWT_SECRET, 'package.json should describe Cloudflare bindings');
assert.equal(packageJson.packageManager, 'npm@11.7.0', 'package manager metadata');

const workerPackageJson = JSON.parse(readFileSync('apps/worker/package.json', 'utf8'));
assert.equal(workerPackageJson.scripts.dev, 'wrangler dev --config ../../wrangler.toml', 'worker dev script');
assert.equal(workerPackageJson.scripts.build, 'wrangler deploy --dry-run --config ../../wrangler.toml', 'worker dry-run build script');
assert.equal(workerPackageJson.scripts.deploy, 'wrangler deploy --config ../../wrangler.toml', 'worker deploy script');
assert.equal(
  workerPackageJson.scripts['db:migrations:apply:local'],
  'wrangler d1 migrations apply DB --local --config ../../wrangler.toml',
  'worker local migration script'
);
assert.equal(workerPackageJson.scripts['db:migrations:apply'], 'wrangler d1 migrations apply DB --remote --config ../../wrangler.toml', 'worker migration script');
assert.match(workerPackageJson.devDependencies.wrangler, /^\^4\./, 'worker should use wrangler v4');
assert.equal(workerPackageJson.dependencies['@subforge/core'], '0.1.0', 'worker should use npm-compatible workspace version for core');
assert.equal(workerPackageJson.dependencies['@subforge/shared'], '0.1.0', 'worker should use npm-compatible workspace version for shared');

const webPackageJson = JSON.parse(readFileSync('apps/web/package.json', 'utf8'));
assert.equal(webPackageJson.dependencies['@subforge/core'], '0.1.0', 'web should use npm-compatible workspace version for core');
assert.equal(webPackageJson.dependencies['@subforge/shared'], '0.1.0', 'web should use npm-compatible workspace version for shared');

const corePackageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
assert.equal(corePackageJson.dependencies['@subforge/shared'], '0.1.0', 'core should use npm-compatible workspace version for shared');

const readme = readFileSync('README.md', 'utf8');
assertIncludes(readme, 'PREVIEW_CACHE_TTL', 'README env docs');
assertIncludes(readme, '规则源支持 `text` / `yaml` / `json`', 'README sync docs');
assertIncludes(readme, 'Deploy to Cloudflare', 'README deploy button');
assertIncludes(readme, '首次安装向导', 'README setup wizard docs');
assertIncludes(readme, 'wrangler@4.45.0', 'README wrangler version docs');
assertIncludes(readme, 'npm run deploy', 'README deploy command docs');
assertIncludes(readme, 'npm run db:migrations:apply:local', 'README local migration docs');
assertIncludes(readme, 'npm run dev:worker', 'README worker dev docs');
assertIncludes(readme, 'npm run dev:web', 'README web dev docs');
assertIncludes(readme, 'npm run test:smoke', 'README smoke docs');

const deployGuide = readFileSync('docs/部署指南.md', 'utf8');
assertIncludes(deployGuide, 'wrangler@4.45.0+', 'deploy guide wrangler version docs');
assertIncludes(deployGuide, 'npm run build', 'deploy guide build docs');
assertIncludes(deployGuide, 'npm run deploy', 'deploy guide deploy docs');
assertIncludes(deployGuide, 'npm run db:migrations:apply:local', 'deploy guide local migration docs');
assertIncludes(deployGuide, 'npm run dev:worker', 'deploy guide worker dev docs');
assertIncludes(deployGuide, 'npm run dev:web', 'deploy guide web dev docs');
assertIncludes(deployGuide, 'npm run test:smoke', 'deploy guide smoke docs');

const automationPlan = readFileSync('docs/自动化验证与CI计划.md', 'utf8');
assertIncludes(automationPlan, 'npm test', 'automation plan test command docs');
assertIncludes(automationPlan, 'GitHub Actions', 'automation plan ci docs');

const secondBatchPlan = readFileSync('docs/第二批自动化验证执行清单.md', 'utf8');
assertIncludes(secondBatchPlan, '缓存失效 helper', 'second batch plan cache scope');
assertIncludes(secondBatchPlan, '管理员鉴权语义', 'second batch plan auth scope');
assertIncludes(secondBatchPlan, '审计日志脱敏', 'second batch plan audit scope');

const thirdBatchPlan = readFileSync('docs/第三批自动化验证执行清单.md', 'utf8');
assertIncludes(thirdBatchPlan, '模板默认切换', 'third batch plan template scope');
assertIncludes(thirdBatchPlan, '规则源启停', 'third batch plan rule source scope');
assertIncludes(thirdBatchPlan, '规则源同步成功 / 跳过', 'third batch plan sync scope');

const fourthBatchPlan = readFileSync('docs/第四批自动化验证执行清单.md', 'utf8');
assertIncludes(fourthBatchPlan, '同步失败路径', 'fourth batch plan failure scope');
assertIncludes(fourthBatchPlan, '/api/rule-sources/:id/sync', 'fourth batch plan sync route scope');

const fifthBatchPlan = readFileSync('docs/第五批自动化验证执行清单.md', 'utf8');
assertIncludes(fifthBatchPlan, '首次安装与管理员登录闭环', 'fifth batch plan setup scope');
assertIncludes(fifthBatchPlan, '预览与公开订阅 miss 路径', 'fifth batch plan preview and subscription scope');
assertIncludes(fifthBatchPlan, 'health / 静态资源回退 / Cron 触发', 'fifth batch plan deployment smoke scope');

const sixthBatchPlan = readFileSync('docs/第六批自动化验证执行清单.md', 'utf8');
assertIncludes(sixthBatchPlan, '用户写入链路', 'sixth batch plan user write scope');
assertIncludes(sixthBatchPlan, '节点写入链路', 'sixth batch plan node write scope');
assertIncludes(sixthBatchPlan, '模板写入链路', 'sixth batch plan template write scope');

const seventhBatchPlan = readFileSync('docs/第七批自动化验证执行清单.md', 'utf8');
assertIncludes(seventhBatchPlan, '首次安装向导的校验边界', 'seventh batch plan setup validation scope');
assertIncludes(seventhBatchPlan, 'Worker 网关与退出语义边界', 'seventh batch plan gateway scope');
assertIncludes(seventhBatchPlan, '本地部署前 smoke 配置校验', 'seventh batch plan smoke scope');

const eleventhBatchPlan = readFileSync('docs/第十一批自动化验证执行清单.md', 'utf8');
assertIncludes(eleventhBatchPlan, '节点写接口的未实现字段语义收紧', 'eleventh batch plan node semantics scope');
assertIncludes(eleventhBatchPlan, 'sourceType', 'eleventh batch plan sourceType scope');
assertIncludes(eleventhBatchPlan, 'credentials', 'eleventh batch plan metadata scope');

const twelfthBatchPlan = readFileSync('docs/第十二批自动化验证执行清单.md', 'utf8');
assertIncludes(twelfthBatchPlan, '默认模板只能指向启用模板', 'twelfth batch plan default-template scope');
assertIncludes(twelfthBatchPlan, 'set-default', 'twelfth batch plan set-default scope');

const thirteenthBatchPlan = readFileSync('docs/第十三批自动化验证执行清单.md', 'utf8');
assertIncludes(thirteenthBatchPlan, '禁用中的默认模板不会继续保留默认标记', 'thirteenth batch plan invariant scope');
assertIncludes(thirteenthBatchPlan, 'PATCH /api/templates/:id', 'thirteenth batch plan patch scope');

const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
assertIncludes(ciWorkflow, 'npm ci', 'ci install step');
assertIncludes(ciWorkflow, 'npm run typecheck', 'ci typecheck step');
assertIncludes(ciWorkflow, 'npm run build', 'ci build step');
assertIncludes(ciWorkflow, 'npm run test:smoke', 'ci smoke step');
assertIncludes(ciWorkflow, 'npm test', 'ci test step');

const webApi = readFileSync('apps/web/src/api.ts', 'utf8');
assertIncludes(webApi, "const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';", 'web api same-origin default');
assertIncludes(webApi, "mode: 'client_only' | 'server_revoked';", 'web api logout mode');

const viteConfig = readFileSync('apps/web/vite.config.ts', 'utf8');
assertIncludes(viteConfig, "'/api': 'http://127.0.0.1:8787'", 'vite api proxy');
assertIncludes(viteConfig, "'/s': 'http://127.0.0.1:8787'", 'vite subscription proxy');

const workerIndex = readFileSync('apps/worker/src/index.ts', 'utf8');
assertIncludes(workerIndex, 'handleSetupStatus', 'worker setup status handler');
assertIncludes(workerIndex, 'handleSetupBootstrap', 'worker setup bootstrap handler');
assertIncludes(workerIndex, 'admin session has been revoked', 'worker revoked-session guard');
assertIncludes(workerIndex, "mode: 'server_revoked'", 'worker logout response mode');
assertIncludes(workerIndex, 'remote sourceType is not supported yet', 'worker node source validation');
assertIncludes(workerIndex, 'must be a JSON object or null', 'worker node metadata validation message');
assertIncludes(workerIndex, 'readNullableObjectField', 'worker node metadata validation helper');
assertIncludes(workerIndex, 'default template must be enabled', 'worker template default-state validation');
assertIncludes(workerIndex, 'return await handleApiRequest(request, env, segments.slice(1));', 'worker api await handling');
assertIncludes(workerIndex, 'return await env.ASSETS.fetch(request);', 'worker assets fallback');

const revocationMigration = readFileSync('migrations/002_admin_session_revocation.sql', 'utf8');
assertIncludes(revocationMigration, 'ALTER TABLE admins ADD COLUMN session_not_before TEXT;', 'revocation migration');

console.log('Smoke checks passed.');
