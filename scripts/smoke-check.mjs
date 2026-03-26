import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'process.exit:0') {
      throw error;
    }
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

const initHelp = await captureModuleOutput('scripts/init-instance.mjs', ['--help']);
assertIncludes(initHelp, '--with-demo', 'init script help demo flag');
assertIncludes(initHelp, '--admin-user <username>', 'init script help admin flag');
assertIncludes(initHelp, 'npm run init:remote', 'init script help remote example');

const runtimePolicy = await captureModuleOutput('scripts/check-runtime.mjs', ['--print-policy']);
assertIncludes(runtimePolicy, 'supported Node.js: >=20 <25', 'runtime policy node range');
assertIncludes(runtimePolicy, 'pinned Node.js in repo: 20', 'runtime policy pinned node');

const d1BackupHelp = await captureModuleOutput('scripts/d1-backup.mjs', ['--help']);
assertIncludes(d1BackupHelp, 'npm run backup:d1', 'd1 backup help root command');
assertIncludes(d1BackupHelp, '--scope full|schema|data', 'd1 backup help scope flag');
assertIncludes(d1BackupHelp, '--encrypt', 'd1 backup help encrypt flag');
assertIncludes(d1BackupHelp, 'D1_BACKUP_ARCHIVE_PASSPHRASE', 'd1 backup help passphrase env');

const d1BackupDecryptHelp = await captureModuleOutput('scripts/d1-backup-decrypt.mjs', ['--help']);
assertIncludes(d1BackupDecryptHelp, 'npm run backup:d1:decrypt', 'd1 backup decrypt help npm command');
assertIncludes(d1BackupDecryptHelp, '--input <backup.enc>', 'd1 backup decrypt help input flag');

const d1RestoreDrillHelp = await captureModuleOutput('scripts/d1-restore-drill.mjs', ['--help']);
assertIncludes(d1RestoreDrillHelp, '--prepare-schema', 'd1 restore drill help prepare schema');
assertIncludes(d1RestoreDrillHelp, 'npm run d1:restore:drill', 'd1 restore drill help npm command');
assertIncludes(d1RestoreDrillHelp, 'backup.sql.enc', 'd1 restore drill encrypted backup help');

const wrangler = readFileSync('wrangler.toml', 'utf8');
assertIncludes(wrangler, 'PREVIEW_CACHE_TTL', 'wrangler vars');
assertIncludes(wrangler, 'SYNC_HTTP_TIMEOUT_MS', 'wrangler vars');
assertIncludes(wrangler, 'ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC', 'wrangler login rate limit vars');
assertIncludes(wrangler, 'SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS', 'wrangler subscription rate limit vars');
assertIncludes(wrangler, '[assets]', 'wrangler assets config');
assertIncludes(wrangler, 'directory = "./apps/web/dist"', 'wrangler assets directory');
assertIncludes(wrangler, 'not_found_handling = "single-page-application"', 'wrangler spa handling');
assertIncludes(wrangler, 'run_worker_first = true', 'wrangler worker-first flag');
assertIncludes(wrangler, 'name = "subforge"', 'wrangler production worker name');
assertIncludes(wrangler, '[env.staging]', 'wrangler staging env');
assertIncludes(wrangler, 'name = "subforge-staging"', 'wrangler staging worker name');
assertIncludes(wrangler, 'database_name = "subforge-staging"', 'wrangler staging d1 name');
assert.ok(!wrangler.includes('YOUR_D1_DATABASE_ID'), 'wrangler should not contain D1 placeholder ids');
assert.ok(!wrangler.includes('YOUR_KV_NAMESPACE_ID'), 'wrangler should not contain KV placeholder ids');

assert.ok(existsSync('package-lock.json'), 'package-lock.json should exist');

const gitignore = readFileSync('.gitignore', 'utf8');
assertIncludes(gitignore, 'backups/d1/', 'gitignore d1 backup artifacts');

assert.equal(readFileSync('.npmrc', 'utf8').trim(), 'engine-strict=true', 'repo should enforce engine-strict installs');
assert.equal(readFileSync('.nvmrc', 'utf8').trim(), '20', 'repo should pin Node.js 20 via .nvmrc');
assert.equal(readFileSync('.node-version', 'utf8').trim(), '20', 'repo should pin Node.js 20 via .node-version');

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(packageJson.engines?.node, '>=20.0.0 <25.0.0', 'root node engine range');
assert.equal(packageJson.scripts.build, 'npm run build:web', 'root build script');
assert.equal(packageJson.scripts.deploy, 'npm run db:migrations:apply && npm run deploy:worker', 'root deploy script');
assert.equal(packageJson.scripts['init:local'], 'node scripts/init-instance.mjs --local', 'root local init script');
assert.equal(packageJson.scripts['init:remote'], 'node scripts/init-instance.mjs --remote --deploy', 'root remote init script');
assert.equal(packageJson.scripts.preinstall, 'node scripts/check-runtime.mjs', 'root preinstall runtime guard');
assert.equal(packageJson.scripts['doctor:runtime'], 'node scripts/check-runtime.mjs', 'root runtime doctor script');
assert.equal(packageJson.scripts['test:smoke'], 'node scripts/smoke-check.mjs', 'smoke script');
assert.equal(packageJson.scripts['test:contract'], 'node scripts/openapi-contract-check.mjs', 'contract script');
assert.equal(packageJson.scripts['test:unit'], 'node scripts/run-unit-tests.mjs', 'unit test script');
assert.match(packageJson.devDependencies?.esbuild ?? '', /^\^0\.27\./, 'root should declare esbuild for test helpers');
assert.match(packageJson.devDependencies?.['node-addon-api'] ?? '', /^\^8\./, 'root should declare node-addon-api for sharp source builds');
assert.match(packageJson.devDependencies?.['node-gyp'] ?? '', /^\^11\./, 'root should declare node-gyp for sharp source builds');
assert.equal(packageJson.scripts['ci:verify'], 'npm run test:contract && npm run test:smoke && npm test && npm run test:unit && npm run typecheck && npm run build && npm run build:worker', 'ci verify script');
assert.equal(packageJson.scripts['build:worker:staging'], 'npm run build:staging --workspace @subforge/worker', 'root staging worker build script');
assert.equal(packageJson.scripts['deploy:staging'], 'npm run db:migrations:apply:staging && npm run deploy:worker:staging', 'root staging deploy script');
assert.equal(packageJson.scripts['backup:d1'], 'node scripts/d1-backup.mjs --environment production', 'root production backup script');
assert.equal(packageJson.scripts['backup:d1:staging'], 'node scripts/d1-backup.mjs --environment staging', 'root staging backup script');
assert.equal(packageJson.scripts['backup:d1:schema'], 'node scripts/d1-backup.mjs --environment production --scope schema', 'root schema backup script');
assert.equal(packageJson.scripts['backup:d1:data'], 'node scripts/d1-backup.mjs --environment production --scope data', 'root data backup script');
assert.equal(packageJson.scripts['backup:d1:encrypted'], 'node scripts/d1-backup.mjs --environment production --encrypt', 'root encrypted backup script');
assert.equal(packageJson.scripts['backup:d1:staging:encrypted'], 'node scripts/d1-backup.mjs --environment staging --encrypt', 'root staging encrypted backup script');
assert.equal(packageJson.scripts['backup:d1:decrypt'], 'node scripts/d1-backup-decrypt.mjs', 'root backup decrypt script');
assert.equal(packageJson.scripts['d1:restore:drill'], 'node scripts/d1-restore-drill.mjs', 'root restore drill script');
assert.ok(packageJson.cloudflare?.bindings?.ADMIN_JWT_SECRET, 'package.json should describe Cloudflare bindings');

const webPackageJson = JSON.parse(readFileSync('apps/web/package.json', 'utf8'));
assert.equal(webPackageJson.scripts.dev, 'node ./node_modules/vite/bin/vite.js', 'web dev script');
assert.equal(webPackageJson.scripts.build, 'node ./node_modules/vite/bin/vite.js build', 'web build script');
assert.equal(webPackageJson.scripts.preview, 'node ./node_modules/vite/bin/vite.js preview', 'web preview script');
assert.equal(webPackageJson.dependencies['@subforge/core'], '0.1.0', 'web should use npm-compatible workspace version for core');
assert.equal(webPackageJson.dependencies['@subforge/shared'], '0.1.0', 'web should use npm-compatible workspace version for shared');

const workerPackageJson = JSON.parse(readFileSync('apps/worker/package.json', 'utf8'));
assert.equal(workerPackageJson.dependencies['@subforge/core'], '0.1.0', 'worker should use npm-compatible workspace version for core');
assert.equal(workerPackageJson.dependencies['@subforge/shared'], '0.1.0', 'worker should use npm-compatible workspace version for shared');
assert.equal(workerPackageJson.scripts.prebuild, 'npm run build --workspace @subforge/web', 'worker prebuild should refresh web assets');
assert.equal(workerPackageJson.scripts.build, 'node ../../node_modules/wrangler/bin/wrangler.js deploy --dry-run --env="" --config ../../wrangler.toml', 'worker dry-run build script');
assert.equal(workerPackageJson.scripts['prebuild:staging'], 'npm run build --workspace @subforge/web', 'worker staging prebuild should refresh web assets');
assert.equal(workerPackageJson.scripts['build:staging'], 'node ../../node_modules/wrangler/bin/wrangler.js deploy --dry-run --env staging --config ../../wrangler.toml', 'worker staging dry-run build script');
assert.equal(workerPackageJson.scripts.predeploy, 'npm run build --workspace @subforge/web', 'worker predeploy should refresh web assets');
assert.equal(workerPackageJson.scripts.deploy, 'node ../../node_modules/wrangler/bin/wrangler.js deploy --env="" --config ../../wrangler.toml', 'worker deploy script');
assert.equal(workerPackageJson.scripts['predeploy:staging'], 'npm run build --workspace @subforge/web', 'worker staging predeploy should refresh web assets');
assert.equal(workerPackageJson.scripts['deploy:staging'], 'node ../../node_modules/wrangler/bin/wrangler.js deploy --env staging --config ../../wrangler.toml', 'worker staging deploy script');
assert.equal(workerPackageJson.scripts['db:migrations:apply'], 'node ../../node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --env="" --config ../../wrangler.toml', 'worker migration script');
assert.equal(workerPackageJson.scripts['db:migrations:apply:staging'], 'node ../../node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --env staging --config ../../wrangler.toml', 'worker staging migration script');
assert.match(workerPackageJson.devDependencies.wrangler, /^\^4\./, 'worker should use wrangler v4');

const corePackageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
assert.equal(corePackageJson.dependencies['@subforge/shared'], '0.1.0', 'core should use npm-compatible workspace version for shared');

const readme = readFileSync('README.md', 'utf8');
assertIncludes(readme, 'PREVIEW_CACHE_TTL', 'README env docs');
assertIncludes(readme, 'ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC', 'README login rate limit docs');
assertIncludes(readme, 'SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS', 'README subscription rate limit docs');
assertIncludes(readme, '规则源支持 `text` / `yaml` / `json`', 'README sync docs');
assertIncludes(readme, '错误码', 'README sync error grading docs');
assertIncludes(readme, 'Deploy to Cloudflare', 'README deploy button');
assertIncludes(readme, '首次安装向导', 'README setup wizard docs');
assertIncludes(readme, 'wrangler@4.77.0', 'README wrangler version docs');
assertIncludes(readme, 'npm run deploy', 'README deploy command docs');
assertIncludes(readme, 'npm run init:local', 'README local init docs');
assertIncludes(readme, 'npm run init:remote', 'README remote init docs');
assertIncludes(readme, 'npm run test:unit', 'README unit test docs');
assertIncludes(readme, 'npm run ci:verify', 'README ci verify docs');
assertIncludes(readme, 'release/*', 'README release branch strategy docs');
assertIncludes(readme, 'FAILURE_WEBHOOK_URL', 'README failure webhook docs');
assertIncludes(readme, 'npm ci', 'README npm ci docs');
assertIncludes(readme, '发布与回滚 checklist', 'README release rollback docs');
assertIncludes(readme, 'D1 备份 / 恢复 SOP', 'README d1 backup restore docs');
assertIncludes(readme, '.github/workflows/d1-backup.yml', 'README d1 backup workflow docs');
assertIncludes(readme, 'npm run d1:restore:drill', 'README restore drill docs');
assertIncludes(readme, 'D1_BACKUP_ARCHIVE_PASSPHRASE', 'README backup passphrase docs');
assertIncludes(readme, 'D1_BACKUP_ARCHIVE_S3_URI', 'README backup object storage docs');
assertIncludes(readme, 'D1_BACKUP_ARCHIVE_ENDPOINT_URL', 'README backup endpoint docs');
assertIncludes(readme, 'aws s3 cp', 'README backup object storage command docs');
assertIncludes(readme, 'bucket lifecycle', 'README backup lifecycle docs');
assertIncludes(readme, 'npm run backup:d1:decrypt', 'README backup decrypt docs');
assertIncludes(readme, '节点页支持 JSON 批量导入', 'README node import docs');
assertIncludes(readme, '远程节点源', 'README remote node sync docs');
assertIncludes(readme, '>=20 <25', 'README runtime range docs');
assertIncludes(readme, 'Node.js 25+', 'README unsupported runtime docs');
assertIncludes(readme, 'libvips', 'README sharp libvips docs');
assertIncludes(readme, 'docs/限流与安全策略.md', 'README security guide entry');
assertIncludes(readme, 'docs/API错误码与响应头说明.md', 'README api guide entry');
assertIncludes(readme, 'docs/API错误响应示例库.md', 'README api error examples guide entry');
assertIncludes(readme, 'docs/排障与常见问题.md', 'README troubleshooting guide entry');
assertIncludes(readme, 'docs/API接口矩阵与OpenAPI草案.md', 'README api matrix guide entry');
assertIncludes(readme, 'openapi.yaml', 'README openapi guide entry');
assertIncludes(readme, 'docs/数据模型与表结构说明.md', 'README data model guide entry');
assertIncludes(readme, 'docs/架构图与ER图.md', 'README architecture guide entry');
assertIncludes(readme, 'docs/运维Runbook与告警处理.md', 'README runbook guide entry');
assertIncludes(readme, 'CHANGELOG.md', 'README changelog entry');
assertIncludes(readme, 'docs/INDEX.md', 'README docs index entry');

const deployGuide = readFileSync('docs/部署指南.md', 'utf8');
assertIncludes(deployGuide, 'wrangler@4.77.0', 'deploy guide wrangler version docs');
assertIncludes(deployGuide, 'npm run build', 'deploy guide build docs');
assertIncludes(deployGuide, 'npm run deploy', 'deploy guide deploy docs');
assertIncludes(deployGuide, 'npm run init:local', 'deploy guide local init docs');
assertIncludes(deployGuide, 'npm run init:remote', 'deploy guide remote init docs');
assertIncludes(deployGuide, 'npm run test:unit', 'deploy guide unit test docs');
assertIncludes(deployGuide, 'npm run ci:verify', 'deploy guide ci verify docs');
assertIncludes(deployGuide, 'npm run deploy:staging', 'deploy guide staging deploy docs');
assertIncludes(deployGuide, 'FAILURE_WEBHOOK_URL', 'deploy guide failure webhook docs');
assertIncludes(deployGuide, 'release/*', 'deploy guide release branch docs');
assertIncludes(deployGuide, 'package-lock.json', 'deploy guide lockfile docs');
assertIncludes(deployGuide, 'npm ci', 'deploy guide npm ci docs');
assertIncludes(deployGuide, 'workflow_dispatch', 'deploy guide workflow dispatch docs');
assertIncludes(deployGuide, 'git_ref', 'deploy guide git ref docs');
assertIncludes(deployGuide, 'wrangler d1 export subforge --remote', 'deploy guide d1 export docs');
assertIncludes(deployGuide, 'wrangler d1 execute DB --remote', 'deploy guide d1 restore docs');
assertIncludes(deployGuide, 'npm run backup:d1', 'deploy guide d1 backup script docs');
assertIncludes(deployGuide, 'npm run d1:restore:drill', 'deploy guide restore drill docs');
assertIncludes(deployGuide, 'npm run backup:d1:decrypt', 'deploy guide backup decrypt docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_PASSPHRASE', 'deploy guide backup passphrase docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_S3_URI', 'deploy guide backup object storage uri docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_ENDPOINT_URL', 'deploy guide backup endpoint docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_AWS_REGION', 'deploy guide backup region docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_SSE', 'deploy guide backup sse docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_KMS_KEY_ID', 'deploy guide backup kms docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_STORAGE_CLASS', 'deploy guide backup storage class docs');
assertIncludes(deployGuide, 'D1_BACKUP_ARCHIVE_AWS_ACCESS_KEY_ID', 'deploy guide backup access key docs');
assertIncludes(deployGuide, 'aws s3 cp', 'deploy guide backup object storage command docs');
assertIncludes(deployGuide, 'bucket lifecycle', 'deploy guide backup lifecycle docs');
assertIncludes(deployGuide, '.github/workflows/d1-backup.yml', 'deploy guide d1 backup workflow docs');
assertIncludes(deployGuide, '03:15 UTC', 'deploy guide d1 backup schedule docs');
assertIncludes(deployGuide, '.sha256', 'deploy guide backup checksum docs');
assertIncludes(deployGuide, '参数是数据库名，不是绑定名', 'deploy guide d1 export name note');
assertIncludes(deployGuide, '空库 / 新库', 'deploy guide empty db restore note');
assertIncludes(deployGuide, '没有自动 down migration', 'deploy guide rollback boundary docs');
assertIncludes(deployGuide, 'GitHub Actions', 'deploy guide github actions docs');
assertIncludes(deployGuide, 'Dashboard 首次部署前确认清单', 'deploy guide dashboard checklist docs');
assertIncludes(deployGuide, '绑定 / Secret / 调度对照', 'deploy guide binding matrix docs');
assertIncludes(deployGuide, '部署后首轮排障观察点', 'deploy guide first-troubleshooting docs');
assertIncludes(deployGuide, '节点 JSON 批量导入', 'deploy guide node import docs');
assertIncludes(deployGuide, '远程节点源', 'deploy guide remote node sync docs');
assertIncludes(deployGuide, 'Node.js `20`', 'deploy guide pinned node docs');
assertIncludes(deployGuide, 'Node.js 25+', 'deploy guide unsupported runtime docs');
assertIncludes(deployGuide, '阶段、错误码', 'deploy guide sync error details docs');
assertIncludes(deployGuide, 'operatorHint', 'deploy guide sync operator hint docs');
assertIncludes(deployGuide, 'ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC', 'deploy guide login rate limit vars');
assertIncludes(deployGuide, 'SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS', 'deploy guide subscription rate limit vars');
assertIncludes(deployGuide, 'npm test', 'deploy guide request-level test docs');
assertIncludes(deployGuide, '必须从 `main` 分支上下文触发', 'deploy guide production dispatch guard docs');
assertIncludes(deployGuide, 'cache-control` 已是 `no-store, max-age=0, must-revalidate`', 'deploy guide html no-store troubleshooting docs');

const securityGuide = readFileSync('docs/限流与安全策略.md', 'utf8');
assertIncludes(securityGuide, '管理员登录失败限流', 'security guide admin login section');
assertIncludes(securityGuide, '公开订阅频控', 'security guide subscription section');
assertIncludes(securityGuide, 'TOO_MANY_REQUESTS', 'security guide too many requests docs');

const apiGuide = readFileSync('docs/API错误码与响应头说明.md', 'utf8');
assertIncludes(apiGuide, 'Authorization: Bearer', 'api guide bearer auth docs');
assertIncludes(apiGuide, 'x-subforge-cache-key', 'api guide cache header docs');
assertIncludes(apiGuide, 'docs/API错误响应示例库.md', 'api guide example library entry');
assertIncludes(apiGuide, '当前 Worker 对未识别异常已提供稳定的结构化 `500` JSON：`INTERNAL_ERROR`', 'api guide 5xx note');
assertIncludes(apiGuide, 'TOO_MANY_REQUESTS', 'api guide error code docs');
assertIncludes(apiGuide, 'x-subforge-asset-cache: html-no-store', 'api guide html asset cache marker docs');
assertIncludes(apiGuide, 'cache-control: no-store, max-age=0, must-revalidate', 'api guide html no-store header docs');

const apiErrorExamplesGuide = readFileSync('docs/API错误响应示例库.md', 'utf8');
assertIncludes(apiErrorExamplesGuide, '400 Bad Request', 'api error examples bad request docs');
assertIncludes(apiErrorExamplesGuide, 'missing bearer token', 'api error examples unauthorized docs');
assertIncludes(apiErrorExamplesGuide, 'subscription token or template not found', 'api error examples subscription not found docs');
assertIncludes(apiErrorExamplesGuide, 'too many login attempts, please retry later', 'api error examples login rate limit docs');
assertIncludes(apiErrorExamplesGuide, '当前仓库现在已经承诺一个最小应用层 JSON 5xx 契约', 'api error examples 5xx note');

const troubleshootingGuide = readFileSync('docs/排障与常见问题.md', 'utf8');
assertIncludes(troubleshootingGuide, 'Unexpected token', 'troubleshooting guide html-response docs');
assertIncludes(troubleshootingGuide, '429', 'troubleshooting guide rate limit docs');
assertIncludes(troubleshootingGuide, 'npm ci', 'troubleshooting guide npm ci docs');
assertIncludes(troubleshootingGuide, 'x-subforge-cache-key', 'troubleshooting guide cache header docs');
assertIncludes(troubleshootingGuide, 'libvips', 'troubleshooting guide sharp libvips docs');
assertIncludes(troubleshootingGuide, '页面还是旧后台', 'troubleshooting guide stale admin ui docs');
assertIncludes(troubleshootingGuide, 'x-subforge-asset-cache', 'troubleshooting guide asset cache marker docs');

const apiMatrixGuide = readFileSync('docs/API接口矩阵与OpenAPI草案.md', 'utf8');
assertIncludes(apiMatrixGuide, '/api/users', 'api matrix users route docs');
assertIncludes(apiMatrixGuide, '/api/nodes/import/remote', 'api matrix remote node route docs');
assertIncludes(apiMatrixGuide, 'openapi.yaml', 'api matrix formal openapi docs');
assertIncludes(apiMatrixGuide, 'docs/API错误响应示例库.md', 'api matrix error example docs');
assertIncludes(apiMatrixGuide, '关键请求 / 成功 / 错误 examples', 'api matrix example coverage docs');
assertIncludes(apiMatrixGuide, 'OpenAPI', 'api matrix openapi draft docs');

assert.ok(existsSync('openapi.yaml'), 'openapi.yaml should exist');
assert.ok(existsSync('scripts/openapi-contract-check.mjs'), 'openapi contract check script should exist');
const openapiContractScript = readFileSync('scripts/openapi-contract-check.mjs', 'utf8');
assertIncludes(openapiContractScript, 'PreviewMetadata schema should exist', 'openapi contract preview metadata check');
assertIncludes(openapiContractScript, 'apps/web/src/api-routes.js', 'openapi contract web api check');
assertIncludes(openapiContractScript, 'should be public', 'openapi contract public auth check');

const openapiSpec = readFileSync('openapi.yaml', 'utf8');
assertIncludes(openapiSpec, 'openapi: 3.1.0', 'openapi version');
assertIncludes(openapiSpec, '/api/users:', 'openapi users path');
assertIncludes(openapiSpec, '/api/nodes/import/remote:', 'openapi remote node path');
assertIncludes(openapiSpec, '/api/rule-sources/{ruleSourceId}/sync:', 'openapi rule source sync path');
assertIncludes(openapiSpec, '/api/preview/{userId}/{target}:', 'openapi preview path');
assertIncludes(openapiSpec, '/s/{token}/{target}:', 'openapi public subscription path');
assertIncludes(openapiSpec, 'bearerAuth', 'openapi bearer auth');
assertIncludes(openapiSpec, 'x-subforge-cache-key', 'openapi cache header');
assertIncludes(openapiSpec, 'invalidJsonBody', 'openapi bad request example');
assertIncludes(openapiSpec, 'missingBearerToken', 'openapi unauthorized example');
assertIncludes(openapiSpec, 'setupAlreadyCompleted', 'openapi forbidden example');
assertIncludes(openapiSpec, 'subscriptionUserNotFound', 'openapi not found example');
assertIncludes(openapiSpec, 'tooManyLoginAttempts', 'openapi rate limit example');
assertIncludes(openapiSpec, 'healthyDevelopment', 'openapi health success example');
assertIncludes(openapiSpec, 'setupInitialized', 'openapi setup status success example');
assertIncludes(openapiSpec, 'bootstrapSuccess', 'openapi bootstrap success example');
assertIncludes(openapiSpec, 'loginSuccess', 'openapi login success example');
assertIncludes(openapiSpec, 'createUserRequest', 'openapi create user request example');
assertIncludes(openapiSpec, 'wrappedNodeImportPayload', 'openapi node import payload example');
assertIncludes(openapiSpec, 'remoteSyncChanged', 'openapi remote node import success example');
assertIncludes(openapiSpec, 'templateCreated', 'openapi template success example');
assertIncludes(openapiSpec, 'ruleSourceSyncUpdated', 'openapi rule source sync success example');
assertIncludes(openapiSpec, 'previewMiss', 'openapi preview success example');
assertIncludes(openapiSpec, 'mihomoSubscription', 'openapi public yaml example');
assertIncludes(openapiSpec, 'PreviewMetadata:', 'openapi preview metadata schema');
assertIncludes(openapiSpec, 'TOO_MANY_REQUESTS', 'openapi error codes');

const dataModelGuide = readFileSync('docs/数据模型与表结构说明.md', 'utf8');
assertIncludes(dataModelGuide, 'rule_snapshots', 'data model rule snapshots docs');
assertIncludes(dataModelGuide, 'idx_rule_snapshots_hash', 'data model index docs');
assertIncludes(dataModelGuide, 'docs/架构图与ER图.md', 'data model architecture guide entry');

const architectureGuide = readFileSync('docs/架构图与ER图.md', 'utf8');
assertIncludes(architectureGuide, 'Mermaid', 'architecture guide mermaid docs');
assertIncludes(architectureGuide, 'apps/web', 'architecture guide web layer');
assertIncludes(architectureGuide, 'apps/worker', 'architecture guide worker layer');
assertIncludes(architectureGuide, 'SUB_CACHE', 'architecture guide kv cache');
assertIncludes(architectureGuide, 'GitHub Actions', 'architecture guide backup plane');
assertIncludes(architectureGuide, 'rule_snapshots', 'architecture guide rule snapshots entity');
assertIncludes(architectureGuide, 'user_node_map', 'architecture guide user node mapping');
assertIncludes(architectureGuide, 'erDiagram', 'architecture guide er diagram');
assertIncludes(architectureGuide, 'flowchart LR', 'architecture guide runtime diagram');

const runbookGuide = readFileSync('docs/运维Runbook与告警处理.md', 'utf8');
assertIncludes(runbookGuide, '/health', 'runbook health check docs');
assertIncludes(runbookGuide, 'Unexpected token', 'runbook html fallback docs');
assertIncludes(runbookGuide, 'npm run ci:verify', 'runbook ci verify docs');
assertIncludes(runbookGuide, 'npm run deploy', 'runbook deploy docs');
assertIncludes(runbookGuide, 'release/*', 'runbook release branch docs');
assertIncludes(runbookGuide, 'workflow_dispatch', 'runbook workflow dispatch docs');
assertIncludes(runbookGuide, 'git_ref', 'runbook git ref docs');
assertIncludes(runbookGuide, 'npm run backup:d1', 'runbook d1 export docs');
assertIncludes(runbookGuide, 'wrangler d1 execute DB --remote', 'runbook d1 restore docs');
assertIncludes(runbookGuide, 'npm run backup:d1', 'runbook d1 backup script docs');
assertIncludes(runbookGuide, 'npm run d1:restore:drill', 'runbook restore drill docs');
assertIncludes(runbookGuide, 'npm run backup:d1:decrypt', 'runbook backup decrypt docs');
assertIncludes(runbookGuide, 'D1_BACKUP_ARCHIVE_PASSPHRASE', 'runbook backup passphrase docs');
assertIncludes(runbookGuide, 'D1_BACKUP_ARCHIVE_S3_URI', 'runbook backup object storage uri docs');
assertIncludes(runbookGuide, 'D1_BACKUP_ARCHIVE_ENDPOINT_URL', 'runbook backup endpoint docs');
assertIncludes(runbookGuide, 'D1_BACKUP_ARCHIVE_SSE', 'runbook backup sse docs');
assertIncludes(runbookGuide, 'D1_BACKUP_ARCHIVE_KMS_KEY_ID', 'runbook backup kms docs');
assertIncludes(runbookGuide, 'aws s3 cp', 'runbook backup object storage command docs');
assertIncludes(runbookGuide, 'bucket lifecycle', 'runbook backup lifecycle docs');
assertIncludes(runbookGuide, '.github/workflows/d1-backup.yml', 'runbook d1 backup workflow docs');
assertIncludes(runbookGuide, '03:15 UTC', 'runbook d1 backup schedule docs');
assertIncludes(runbookGuide, '.sha256', 'runbook backup checksum docs');
assertIncludes(runbookGuide, 'full export 同时包含 schema + data', 'runbook d1 full export note');
assertIncludes(runbookGuide, '异地加密保存', 'runbook d1 retention docs');
assertIncludes(runbookGuide, '没有自动化 D1 down migration', 'runbook rollback boundary docs');
assertIncludes(runbookGuide, 'failure-alert.yml', 'runbook failure alert workflow docs');
assertIncludes(runbookGuide, 'FAILURE_WEBHOOK_URL', 'runbook failure webhook docs');

const changelog = readFileSync('CHANGELOG.md', 'utf8');
assertIncludes(changelog, '[0.1.0]', 'changelog initial release entry');
assertIncludes(changelog, '管理员登录失败限流', 'changelog security docs');
assertIncludes(changelog, 'openapi.yaml', 'changelog openapi docs');
assertIncludes(changelog, 'docs/API错误响应示例库.md', 'changelog api error examples docs');
assertIncludes(changelog, 'docs/架构图与ER图.md', 'changelog architecture docs');
assertIncludes(changelog, 'D1_BACKUP_ARCHIVE_S3_URI', 'changelog backup object storage docs');
assertIncludes(changelog, 'bucket lifecycle', 'changelog backup lifecycle docs');
assertIncludes(changelog, 'contract -> smoke -> npm test -> test:unit -> typecheck -> build -> build:worker', 'changelog ci verify docs');

const docsIndex = readFileSync('docs/INDEX.md', 'utf8');
assertIncludes(docsIndex, '文档导航', 'docs index title');
assertIncludes(docsIndex, 'docs/部署指南.md', 'docs index deploy entry');
assertIncludes(docsIndex, 'Dashboard / Git 导入', 'docs index deploy description');
assertIncludes(docsIndex, 'staging / production', 'docs index branch strategy docs');
assertIncludes(docsIndex, 'failure summary / webhook', 'docs index failure alert docs');
assertIncludes(docsIndex, '发布 / 回滚 checklist', 'docs index release rollback docs');
assertIncludes(docsIndex, 'D1 备份 / 恢复 SOP', 'docs index d1 backup docs');
assertIncludes(docsIndex, '自动化 D1 定期备份脚本 / 恢复演练', 'docs index d1 backup automation docs');
assertIncludes(docsIndex, '备份产物异地加密归档 / 对象存储同步 / 生命周期管理', 'docs index d1 archive lifecycle docs');
assertIncludes(docsIndex, '生命周期告警', 'docs index next-doc suggestion');
assertIncludes(docsIndex, 'npm run ci:verify', 'docs index ci verify description');
assertIncludes(docsIndex, 'docs/API接口矩阵与OpenAPI草案.md', 'docs index api matrix entry');
assertIncludes(docsIndex, 'docs/API错误响应示例库.md', 'docs index api error examples entry');
assertIncludes(docsIndex, 'openapi.yaml', 'docs index openapi entry');
assertIncludes(docsIndex, 'docs/架构图与ER图.md', 'docs index architecture entry');

const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
assertIncludes(ciWorkflow, 'workflow_dispatch:', 'ci manual trigger');
assertIncludes(ciWorkflow, 'cancel-in-progress: true', 'ci concurrency cancel');
assertIncludes(ciWorkflow, 'cache-dependency-path: package-lock.json', 'ci cache dependency path');
assertIncludes(ciWorkflow, 'npm ci', 'ci npm ci command');
assertIncludes(ciWorkflow, 'npm run ci:verify', 'ci verify command');

const deployWorkflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const d1BackupWorkflow = readFileSync('.github/workflows/d1-backup.yml', 'utf8');
const failureAlertWorkflow = readFileSync('.github/workflows/failure-alert.yml', 'utf8');
const backupCrypto = readFileSync('scripts/d1-backup-crypto.mjs', 'utf8');
assertIncludes(deployWorkflow, 'release/**', 'deploy release branch trigger');
assertIncludes(deployWorkflow, 'target_environment', 'deploy workflow target input');
assertIncludes(deployWorkflow, 'npm run deploy:staging', 'deploy workflow staging command');
assertIncludes(deployWorkflow, 'environment: ${{ needs.plan.outputs.github_environment }}', 'deploy workflow dynamic environment');
assertIncludes(deployWorkflow, 'cache-dependency-path: package-lock.json', 'deploy cache dependency path');
assertIncludes(deployWorkflow, 'npm ci', 'deploy npm ci command');
assertIncludes(deployWorkflow, 'npm run ci:verify', 'deploy verify command');
assertIncludes(deployWorkflow, 'cloudflare/wrangler-action@v3', 'deploy wrangler action');
assertIncludes(deployWorkflow, 'CLOUDFLARE_API_TOKEN', 'deploy api token secret');
assertIncludes(deployWorkflow, 'CLOUDFLARE_ACCOUNT_ID', 'deploy account secret');
assertIncludes(deployWorkflow, 'ADMIN_JWT_SECRET', 'deploy runtime secret');
assertIncludes(deployWorkflow, 'Validate Cloudflare deployment secrets', 'deploy secret validation step');
assertIncludes(deployWorkflow, 'npm run deploy', 'deploy root deploy command');
assertIncludes(d1BackupWorkflow, 'schedule:', 'd1 backup schedule trigger');
assertIncludes(d1BackupWorkflow, 'workflow_dispatch:', 'd1 backup manual trigger');
assertIncludes(d1BackupWorkflow, 'backup_scope', 'd1 backup scope input');
assertIncludes(d1BackupWorkflow, 'npm run backup:d1', 'd1 backup npm script');
assertIncludes(d1BackupWorkflow, 'actions/upload-artifact@v4', 'd1 backup artifact upload');
assertIncludes(d1BackupWorkflow, 'CLOUDFLARE_API_TOKEN', 'd1 backup api token secret');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_PASSPHRASE', 'd1 backup passphrase secret');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_S3_URI', 'd1 backup object storage uri');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_ENDPOINT_URL', 'd1 backup object storage endpoint');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_SSE', 'd1 backup object storage sse');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_KMS_KEY_ID', 'd1 backup object storage kms');
assertIncludes(d1BackupWorkflow, 'D1_BACKUP_ARCHIVE_STORAGE_CLASS', 'd1 backup object storage class');
assertIncludes(d1BackupWorkflow, '--encrypt --delete-plain --passphrase-env D1_BACKUP_ARCHIVE_PASSPHRASE', 'd1 backup encryption command');
assertIncludes(d1BackupWorkflow, 's3 cp backups/d1/', 'd1 backup object storage copy command');
assertIncludes(d1BackupWorkflow, '--sse-kms-key-id', 'd1 backup object storage kms cli flag');
assertIncludes(d1BackupWorkflow, 'Bucket lifecycle should be configured on the target bucket / prefix outside this repo.', 'd1 backup object storage lifecycle summary');
assertIncludes(d1BackupWorkflow, '.sha256', 'd1 backup checksum artifact');
assertIncludes(d1BackupWorkflow, "cron: '15 3 * * *'", 'd1 backup schedule cron');
assertIncludes(failureAlertWorkflow, 'workflow_run:', 'failure alert workflow trigger');
assertIncludes(failureAlertWorkflow, 'D1 Backup', 'failure alert d1 backup workflow');
assertIncludes(failureAlertWorkflow, 'FAILURE_WEBHOOK_URL', 'failure alert webhook secret');
assertIncludes(failureAlertWorkflow, 'curl --fail --show-error --silent', 'failure alert curl command');

assertIncludes(backupCrypto, 'aes-256-gcm', 'backup crypto algorithm');
assertIncludes(backupCrypto, 'createCipheriv', 'backup crypto encrypt helper');
assertIncludes(backupCrypto, 'createDecipheriv', 'backup crypto decrypt helper');

const webApi = readFileSync('apps/web/src/api.ts', 'utf8');
assertIncludes(webApi, 'const API_BASE_URL =', 'web api base url constant');
assertIncludes(webApi, 'VITE_API_BASE_URL', 'web api env override');
assertIncludes(webApi, "??\n  '';", 'web api same-origin default');
const webApiRoutes = readFileSync('apps/web/src/api-routes.js', 'utf8');
assertIncludes(webApiRoutes, '/api/nodes/import/remote', 'web api remote node route');

const viteConfig = readFileSync('apps/web/vite.config.ts', 'utf8');
assertIncludes(viteConfig, "'/api': 'http://127.0.0.1:8787'", 'vite api proxy');
assertIncludes(viteConfig, "'/s': 'http://127.0.0.1:8787'", 'vite subscription proxy');

const workerIndex = readFileSync('apps/worker/src/index.ts', 'utf8');
assertIncludes(workerIndex, 'handleSetupStatus', 'worker setup status handler');
assertIncludes(workerIndex, 'handleSetupBootstrap', 'worker setup bootstrap handler');
assertIncludes(workerIndex, 'handleNodeImport', 'worker node import handler');
assertIncludes(workerIndex, 'handleRemoteNodeImport', 'worker remote node import handler');
assertIncludes(workerIndex, 'TOO_MANY_REQUESTS', 'worker too many requests error handling');
assertIncludes(workerIndex, 'subscription request rate limit exceeded', 'worker subscription rate limit message');
assertIncludes(workerIndex, 'node.import', 'worker node import audit action');
assertIncludes(workerIndex, 'node.import_remote', 'worker remote node import audit action');
assertIncludes(workerIndex, 'buildUserAuditPayload', 'worker audit payload helpers');
assertIncludes(workerIndex, 'rayId', 'worker audit request ray id');
assertIncludes(workerIndex, 'handleAssetRequest(request, env);', 'worker assets fallback wrapper');
assertIncludes(workerIndex, "cache-control', 'no-store, max-age=0, must-revalidate'", 'worker html asset cache control');
assertIncludes(workerIndex, "x-subforge-asset-cache', 'html-no-store'", 'worker html asset cache marker');

const rateLimit = readFileSync('apps/worker/src/rate-limit.ts', 'utf8');
assertIncludes(rateLimit, 'peekAdminLoginRateLimit', 'worker admin login rate limit helper');
assertIncludes(rateLimit, 'consumeSubscriptionRateLimit', 'worker subscription rate limit helper');

const sharedDomain = readFileSync('packages/shared/src/domain.ts', 'utf8');
assertIncludes(sharedDomain, 'targetDisplayName?: string | null;', 'shared audit target display field');
assertIncludes(sharedDomain, 'requestMeta?: AuditRequestMeta | null;', 'shared audit request meta field');

const workerRepository = readFileSync('apps/worker/src/repository.ts', 'utf8');
assertIncludes(workerRepository, 'target_display_name', 'worker audit target display query');
assertIncludes(workerRepository, 'mapAuditRequestMeta', 'worker audit request meta mapping');

const webApp = readFileSync('apps/web/src/App.tsx', 'utf8');
assertIncludes(webApp, 'formatAuditActionLabel', 'web audit action formatter');
assertIncludes(webApp, 'renderAuditRequest', 'web audit request renderer');

const workerSyncDiagnostics = readFileSync('apps/worker/src/rule-sync-diagnostics.ts', 'utf8');
assertIncludes(workerSyncDiagnostics, 'operatorHint', 'worker sync operator hint field');
assertIncludes(workerSyncDiagnostics, 'contentPreview', 'worker sync content preview field');

const workerSync = readFileSync('apps/worker/src/sync.ts', 'utf8');
assertIncludes(workerSync, 'FETCH_TIMEOUT', 'worker sync timeout grading');
assertIncludes(workerSync, 'UNSUPPORTED_JSON_SHAPE', 'worker sync json shape grading');
assertIncludes(workerSync, 'duplicateRuleCount', 'worker sync parse metrics');
assertIncludes(workerSync, 'buildRuleSourceSyncDiagnostics', 'worker sync diagnostics helper usage');

const webSync = readFileSync('apps/web/src/App.tsx', 'utf8');
assertIncludes(webSync, 'formatSyncErrorCodeLabel', 'web sync error code formatter');
assertIncludes(webSync, 'supportedShapes', 'web sync supported shapes rendering');
assertIncludes(webSync, 'className="page auth-page"', 'web auth view should render the auth-page layout');

const webStyles = readFileSync('apps/web/src/styles.css', 'utf8');
assertIncludes(
  webStyles,
  'grid-template-columns: minmax(0, 1.2fr) minmax(320px, 420px);',
  'web auth-page desktop split layout'
);
assertIncludes(webStyles, 'align-items: start;', 'web auth-page should align to top instead of centering');
assertIncludes(webStyles, 'padding-top: clamp(48px, 10vh, 112px);', 'web auth-page top spacing');
assertIncludes(webStyles, '.auth-page .auth-card {', 'web auth card auth-page override');
assertIncludes(webStyles, 'justify-self: end;', 'web auth card should dock to the side on desktop');
assertIncludes(webStyles, '.auth-page .hero {', 'web auth hero auth-page override');
assertIncludes(webStyles, 'grid-template-columns: 1fr;', 'web auth-page mobile single-column layout');
assertIncludes(webStyles, 'justify-self: stretch;', 'web auth card should stretch on mobile');
assert.ok(!webStyles.includes('align-content: center;'), 'web auth-page should not vertically center the login layout');

console.log('Smoke checks passed.');
