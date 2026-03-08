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
assertIncludes(readme, '节点管理与订阅使用说明', 'README node usage docs');
assertIncludes(readme, '文档导航与阅读顺序', 'README docs navigation docs');
assertIncludes(readme, '分享链接粘贴导入', 'README node import docs');
assertIncludes(readme, '`ss://`', 'README ss import docs');
assertIncludes(readme, '`hysteria2://`', 'README hysteria2 import docs');
assertIncludes(readme, '订阅 URL 做一次性远程抓取预览', 'README node import preview docs');
assertIncludes(readme, 'Base64 包装订阅文本', 'README base64 import docs');
assertIncludes(readme, '远程节点源持续同步', 'README node import limitation docs');
assertIncludes(readme, '结构化字段向导', 'README node guided form docs');
assertIncludes(readme, '多端口 authority 仍未覆盖', 'README hysteria2 multi-port docs');
assertIncludes(readme, 'npx wrangler versions upload', 'README versions upload warning docs');
assertIncludes(readme, 'no such table: admins', 'README D1 missing table docs');
assertIncludes(readme, 'sqlite_master', 'README sqlite_master troubleshooting docs');
assertIncludes(readme, '首次使用 5 分钟路径', 'README quickstart docs');
assertIncludes(readme, '抓取并预览', 'README node preview action docs');
assertIncludes(readme, 'branch preview / non-production build', 'README preview build docs');
assertIncludes(readme, '节点协议示例库', 'README protocol examples docs');
assertIncludes(readme, '导入成功但订阅没变化排障指南', 'README node troubleshooting docs');
assertIncludes(readme, 'API参考与接口约定', 'README api reference docs');
assertIncludes(readme, '节点字段字典', 'README node field dictionary docs');
assertIncludes(readme, '常见错误与返回语义', 'README common error docs');
assertIncludes(readme, '发布前检查清单', 'README release checklist docs');

const deployGuide = readFileSync('docs/部署指南.md', 'utf8');
assertIncludes(deployGuide, 'wrangler@4.45.0+', 'deploy guide wrangler version docs');
assertIncludes(deployGuide, 'npm run build', 'deploy guide build docs');
assertIncludes(deployGuide, 'npm run deploy', 'deploy guide deploy docs');
assertIncludes(deployGuide, 'npm run db:migrations:apply:local', 'deploy guide local migration docs');
assertIncludes(deployGuide, 'npm run db:migrations:apply', 'deploy guide remote migration docs');
assertIncludes(deployGuide, 'npm run dev:worker', 'deploy guide worker dev docs');
assertIncludes(deployGuide, 'npm run dev:web', 'deploy guide web dev docs');
assertIncludes(deployGuide, 'npm run test:smoke', 'deploy guide smoke docs');
assertIncludes(deployGuide, 'npx wrangler versions upload', 'deploy guide versions upload warning docs');
assertIncludes(deployGuide, 'no such table: admins', 'deploy guide D1 missing table docs');
assertIncludes(deployGuide, 'SQL Console', 'deploy guide console docs');
assertIncludes(deployGuide, 'sqlite_master', 'deploy guide sqlite_master docs');
assertIncludes(deployGuide, '加载安装状态', 'deploy guide setup loading docs');
assertIncludes(deployGuide, '001_init.sql', 'deploy guide init migration docs');
assertIncludes(deployGuide, '002_admin_session_revocation.sql', 'deploy guide follow-up migration docs');
assertIncludes(deployGuide, 'Explore data', 'deploy guide explore data warning docs');
assertIncludes(deployGuide, 'Preview 构建要不要先开', 'deploy guide preview env docs');
assertIncludes(deployGuide, '`hy2://`', 'deploy guide hy2 alias docs');
assertIncludes(deployGuide, 'cipher` / `password` / `plugin`', 'deploy guide ss guide scope docs');
assertIncludes(deployGuide, '多端口 authority 也还没覆盖', 'deploy guide hysteria2 multi-port docs');
assertIncludes(deployGuide, '是否完成用户绑定', 'deploy guide subscription troubleshooting docs');
assertIncludes(deployGuide, '节点协议示例库.md', 'deploy guide protocol examples link docs');
assertIncludes(deployGuide, '导入成功但订阅没变化排障指南.md', 'deploy guide troubleshooting link docs');
assertIncludes(deployGuide, '文档导航与阅读顺序.md', 'deploy guide docs navigation link docs');
assertIncludes(deployGuide, 'API参考与接口约定.md', 'deploy guide api reference link docs');
assertIncludes(deployGuide, '节点字段字典.md', 'deploy guide node field dictionary link docs');
assertIncludes(deployGuide, '常见错误与返回语义.md', 'deploy guide common error link docs');
assertIncludes(deployGuide, '发布前检查清单.md', 'deploy guide release checklist link docs');

const automationPlan = readFileSync('docs/自动化验证与CI计划.md', 'utf8');
assertIncludes(automationPlan, 'npm test', 'automation plan test command docs');
assertIncludes(automationPlan, 'GitHub Actions', 'automation plan ci docs');
assertIncludes(automationPlan, '第二十二批自动化验证执行清单.md', 'automation plan twenty-second batch docs');
assertIncludes(automationPlan, '第二十三批自动化验证执行清单.md', 'automation plan twenty-third batch docs');
assertIncludes(automationPlan, '第二十五批自动化验证执行清单.md', 'automation plan twenty-fifth batch docs');
assertIncludes(automationPlan, '第二十六批自动化验证执行清单.md', 'automation plan twenty-sixth batch docs');
assertIncludes(automationPlan, '长链路回归', 'automation plan long-chain regression docs');

const implementationPlan = readFileSync('docs/实施方案.md', 'utf8');
assertIncludes(implementationPlan, '`hysteria2://` / `hy2://`', 'implementation plan hysteria2 import docs');
assertIncludes(implementationPlan, '`cipher` / `password` / `plugin`', 'implementation plan ss guide scope docs');
assertIncludes(implementationPlan, '是否已绑定用户', 'implementation plan subscription troubleshooting docs');

const knownIssues = readFileSync('docs/已知问题与修复计划.md', 'utf8');
assertIncludes(knownIssues, 'docs/第二十二批自动化验证执行清单.md', 'known issues twenty-second batch docs');
assertIncludes(knownIssues, 'docs/第二十三批自动化验证执行清单.md', 'known issues twenty-third batch docs');
assertIncludes(knownIssues, 'docs/第二十五批自动化验证执行清单.md', 'known issues twenty-fifth batch docs');
assertIncludes(knownIssues, 'docs/第二十六批自动化验证执行清单.md', 'known issues twenty-sixth batch docs');
assertIncludes(knownIssues, '协议级字段校验补强', 'known issues protocol validation docs');
assertIncludes(knownIssues, '长链路回归', 'known issues long-chain regression docs');

const protocolExamples = readFileSync('docs/节点协议示例库.md', 'utf8');
assertIncludes(protocolExamples, '分享链接示例', 'protocol examples share-link docs');
assertIncludes(protocolExamples, '`hysteria2`', 'protocol examples hysteria2 docs');
assertIncludes(protocolExamples, '结构化字段示例', 'protocol examples structured docs');
assertIncludes(protocolExamples, '常见报错对照', 'protocol examples error glossary docs');
assertIncludes(protocolExamples, 'hysteria2 节点当前仅支持 params.obfs = "salamander"', 'protocol examples hysteria2 error docs');

const nodeTroubleshooting = readFileSync('docs/导入成功但订阅没变化排障指南.md', 'utf8');
assertIncludes(nodeTroubleshooting, '用户”页是否真的完成绑定', 'node troubleshooting binding docs');
assertIncludes(nodeTroubleshooting, '/s/:token/mihomo', 'node troubleshooting public subscription docs');
assertIncludes(nodeTroubleshooting, '未知 query 参数会直接报 unsupported', 'node troubleshooting unsupported docs');
assertIncludes(nodeTroubleshooting, '预览有变化但公开订阅没变化', 'node troubleshooting preview-public branch docs');
assertIncludes(nodeTroubleshooting, '客户端或浏览器是否缓存了旧内容', 'node troubleshooting client cache docs');

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

const nodeUsageGuide = readFileSync('docs/节点管理与订阅使用说明.md', 'utf8');
assertIncludes(nodeUsageGuide, '当前仓库中的节点管理能力以“手动录入 + 分享链接导入 + 订阅 URL 远程预览导入” 为主', 'node usage guide manual scope');
assertIncludes(nodeUsageGuide, '当前支持的是“一次性导入预览”', 'node usage guide import limitation');
assertIncludes(nodeUsageGuide, 'Base64 包装订阅文本', 'node usage guide base64 import docs');
assertIncludes(nodeUsageGuide, '`ss://`', 'node usage guide ss import docs');
assertIncludes(nodeUsageGuide, '`hysteria2://`', 'node usage guide hysteria2 import docs');
assertIncludes(nodeUsageGuide, '协议都支持了吗', 'node usage guide protocol faq docs');
assertIncludes(nodeUsageGuide, '后台实际点按顺序', 'node usage guide click path docs');
assertIncludes(nodeUsageGuide, '模板', 'node usage guide template step docs');
assertIncludes(nodeUsageGuide, '创建完成后应该看到什么', 'node usage guide expected result docs');
assertIncludes(nodeUsageGuide, '结构化字段和 JSON 以哪个为准', 'node usage guide guided sync docs');
assertIncludes(nodeUsageGuide, '抓取并预览', 'node usage guide preview action docs');
assertIncludes(nodeUsageGuide, '文档导航与阅读顺序.md', 'node usage guide docs navigation link docs');
assertIncludes(nodeUsageGuide, '批量创建 N 个节点', 'node usage guide batch import docs');
assertIncludes(nodeUsageGuide, '远程来源', 'node usage guide remote summary docs');
assertIncludes(nodeUsageGuide, 'Clash / sing-box 全量配置', 'node usage guide unsupported config docs');
assertIncludes(nodeUsageGuide, '修改 `vless` / `trojan` / `vmess` / `ss` / `hysteria2` 协议向导', 'node usage guide guided sync docs');
assertIncludes(nodeUsageGuide, '当前向导与导入的实际映射', 'node usage guide protocol mapping docs');
assertIncludes(nodeUsageGuide, 'authority 里的多端口写法当前还不支持', 'node usage guide hysteria2 multi-port docs');
assertIncludes(nodeUsageGuide, 'API参考与接口约定.md', 'node usage guide api reference link docs');
assertIncludes(nodeUsageGuide, '节点字段字典.md', 'node usage guide node field dictionary link docs');
assertIncludes(nodeUsageGuide, '常见错误与返回语义.md', 'node usage guide common error link docs');
assertIncludes(nodeUsageGuide, '发布前检查清单.md', 'node usage guide release checklist link docs');

const protocolMatrix = readFileSync('docs/协议支持矩阵与落地计划.md', 'utf8');
assertIncludes(protocolMatrix, '当前协议支持矩阵', 'protocol matrix current support docs');
assertIncludes(protocolMatrix, '`hysteria2`', 'protocol matrix hysteria2 docs');
assertIncludes(protocolMatrix, '结构化协议向导', 'protocol matrix guided scope docs');
assertIncludes(protocolMatrix, '推荐的下一阶段顺序', 'protocol matrix roadmap docs');
assertIncludes(protocolMatrix, '后续补协议时的落地清单', 'protocol matrix landing checklist docs');
assertIncludes(protocolMatrix, '第二十二批自动化验证执行清单.md', 'protocol matrix twenty-second batch docs');
assertIncludes(protocolMatrix, 'packages/core/src/node-import.ts', 'protocol matrix parser touchpoint docs');
assertIncludes(protocolMatrix, '文档写法约束', 'protocol matrix wording rules docs');
assertIncludes(protocolMatrix, '| `ss` | 支持 | 支持 | 支持 | 支持 | 支持 |', 'protocol matrix ss all-layer docs');
assertIncludes(protocolMatrix, '| `hysteria2` | 支持 | 支持 | 支持 | 支持 | 支持 |', 'protocol matrix hysteria2 all-layer docs');
assertIncludes(protocolMatrix, '当前已知细粒度限制', 'protocol matrix protocol caveat docs');
assertIncludes(protocolMatrix, '多端口写法当前还不支持', 'protocol matrix hysteria2 multi-port docs');

const fourteenthBatchPlan = readFileSync('docs/第十四批自动化验证执行清单.md', 'utf8');
assertIncludes(fourteenthBatchPlan, '节点管理可用性补强', 'fourteenth batch plan node usability scope');
assertIncludes(fourteenthBatchPlan, 'credentials', 'fourteenth batch plan metadata scope');

const fifteenthBatchPlan = readFileSync('docs/第十五批自动化验证执行清单.md', 'utf8');
assertIncludes(fifteenthBatchPlan, '节点协议向导补强', 'fifteenth batch plan node guided scope');
assertIncludes(fifteenthBatchPlan, 'vless', 'fifteenth batch plan protocol scope');

const sixteenthBatchPlan = readFileSync('docs/第十六批自动化验证执行清单.md', 'utf8');
assertIncludes(sixteenthBatchPlan, '分享链接导入补强', 'sixteenth batch plan node import scope');
assertIncludes(sixteenthBatchPlan, 'vmess://', 'sixteenth batch plan vmess scope');

const seventeenthBatchPlan = readFileSync('docs/第十七批自动化验证执行清单.md', 'utf8');
assertIncludes(seventeenthBatchPlan, '订阅 URL 远程抓取预览导入', 'seventeenth batch plan remote import scope');
assertIncludes(seventeenthBatchPlan, 'node-import/preview', 'seventeenth batch plan route scope');

const eighteenthBatchPlan = readFileSync('docs/第十八批自动化验证执行清单.md', 'utf8');
assertIncludes(eighteenthBatchPlan, 'Base64 订阅文本解包补强', 'eighteenth batch plan base64 import scope');
assertIncludes(eighteenthBatchPlan, 'base64_text', 'eighteenth batch plan encoding scope');

const nineteenthBatchPlan = readFileSync('docs/第十九批自动化验证执行清单.md', 'utf8');
assertIncludes(nineteenthBatchPlan, '`ss://` 分享链接导入补强', 'nineteenth batch plan ss import scope');
assertIncludes(nineteenthBatchPlan, '`ss://`', 'nineteenth batch plan protocol scope');

const twentiethBatchPlan = readFileSync('docs/第二十批自动化验证执行清单.md', 'utf8');
assertIncludes(twentiethBatchPlan, '协议支持矩阵与落地路线文档补强', 'twentieth batch plan docs scope');
assertIncludes(twentiethBatchPlan, '协议支持矩阵', 'twentieth batch plan matrix scope');

const twentyFirstBatchPlan = readFileSync('docs/第二十一批自动化验证执行清单.md', 'utf8');
assertIncludes(twentyFirstBatchPlan, '`ss` 向导与 `hysteria2` 导入文档细化', 'twenty-first batch plan docs scope');
assertIncludes(twentyFirstBatchPlan, '字段映射', 'twenty-first batch plan mapping scope');
assertIncludes(twentyFirstBatchPlan, '多端口', 'twenty-first batch plan multi-port scope');

const twentySecondBatchPlan = readFileSync('docs/第二十二批自动化验证执行清单.md', 'utf8');
assertIncludes(twentySecondBatchPlan, '实际落地结果', 'twenty-second batch plan docs scope');
assertIncludes(twentySecondBatchPlan, '`hysteria2` 结构化协议向导', 'twenty-second batch plan hysteria2 guide scope');
assertIncludes(twentySecondBatchPlan, '协议级字段校验', 'twenty-second batch plan protocol validation scope');
assertIncludes(twentySecondBatchPlan, '节点协议示例库', 'twenty-second batch plan example library scope');
assertIncludes(twentySecondBatchPlan, '长链路回归', 'twenty-second batch plan long-chain regression scope');
assertIncludes(twentySecondBatchPlan, '排障指南', 'twenty-second batch plan troubleshooting scope');

const twentyThirdBatchPlan = readFileSync('docs/第二十三批自动化验证执行清单.md', 'utf8');
assertIncludes(twentyThirdBatchPlan, '文档增强结果', 'twenty-third batch plan docs scope');
assertIncludes(twentyThirdBatchPlan, '常见报错对照', 'twenty-third batch plan error glossary scope');
assertIncludes(twentyThirdBatchPlan, '预览有变化但公开订阅没变化', 'twenty-third batch plan preview-public scope');
assertIncludes(twentyThirdBatchPlan, '部署指南', 'twenty-third batch plan deploy guide scope');

const twentyFourthBatchPlan = readFileSync('docs/第二十四批自动化验证执行清单.md', 'utf8');
assertIncludes(twentyFourthBatchPlan, '文档入口优化结果', 'twenty-fourth batch plan docs scope');
assertIncludes(twentyFourthBatchPlan, '统一文档导航页', 'twenty-fourth batch plan navigation scope');
assertIncludes(twentyFourthBatchPlan, 'README', 'twenty-fourth batch plan readme scope');
assertIncludes(twentyFourthBatchPlan, 'smoke', 'twenty-fourth batch plan smoke scope');

const twentyFifthBatchPlan = readFileSync('docs/第二十五批自动化验证执行清单.md', 'utf8');
assertIncludes(twentyFifthBatchPlan, 'API参考与接口约定.md', 'twenty-fifth batch plan api scope');
assertIncludes(twentyFifthBatchPlan, '节点字段字典.md', 'twenty-fifth batch plan field dictionary scope');
assertIncludes(twentyFifthBatchPlan, '常见错误与返回语义.md', 'twenty-fifth batch plan error semantics scope');
assertIncludes(twentyFifthBatchPlan, '开发 / 运维 / 运营', 'twenty-fifth batch plan role-based navigation scope');
assertIncludes(twentyFifthBatchPlan, 'smoke', 'twenty-fifth batch plan smoke scope');

const twentySixthBatchPlan = readFileSync('docs/第二十六批自动化验证执行清单.md', 'utf8');
assertIncludes(twentySixthBatchPlan, '状态码速查', 'twenty-sixth batch plan status code scope');
assertIncludes(twentySixthBatchPlan, '完整请求 / 响应示例', 'twenty-sixth batch plan api examples scope');
assertIncludes(twentySixthBatchPlan, '`ss` / `hysteria2` 导入字段映射表', 'twenty-sixth batch plan field mapping scope');
assertIncludes(twentySixthBatchPlan, '发布前检查清单.md', 'twenty-sixth batch plan release checklist scope');
assertIncludes(twentySixthBatchPlan, 'smoke', 'twenty-sixth batch plan smoke scope');

const apiReference = readFileSync('docs/API参考与接口约定.md', 'utf8');
assertIncludes(apiReference, '统一约定', 'api reference conventions docs');
assertIncludes(apiReference, '按资源分组的状态码速查', 'api reference status code table docs');
assertIncludes(apiReference, 'GET /api/setup/status', 'api reference setup status route');
assertIncludes(apiReference, 'POST /api/node-import/preview', 'api reference node import preview route');
assertIncludes(apiReference, '完整请求 / 响应示例', 'api reference full example docs');
assertIncludes(apiReference, 'POST /api/nodes', 'api reference create node route');
assertIncludes(apiReference, 'GET /s/:token/:target', 'api reference public subscription route');
assertIncludes(apiReference, '整组替换', 'api reference replace binding semantics');

const nodeFieldDictionary = readFileSync('docs/节点字段字典.md', 'utf8');
assertIncludes(nodeFieldDictionary, '节点统一结构', 'node field dictionary structure docs');
assertIncludes(nodeFieldDictionary, 'credentials', 'node field dictionary credentials docs');
assertIncludes(nodeFieldDictionary, 'params', 'node field dictionary params docs');
assertIncludes(nodeFieldDictionary, '导入字段 -> 最终 metadata 对照', 'node field dictionary mapping table docs');
assertIncludes(nodeFieldDictionary, '`ss` 导入字段 -> 最终 metadata 对照', 'node field dictionary ss mapping docs');
assertIncludes(nodeFieldDictionary, '`hysteria2` / `hy2` 导入字段 -> 最终 metadata 对照', 'node field dictionary hysteria2 mapping docs');
assertIncludes(nodeFieldDictionary, '`hy2` 会归一化为 `hysteria2`', 'node field dictionary hy2 canonicalization docs');
assertIncludes(nodeFieldDictionary, 'authority 里的多端口写法当前还不支持', 'node field dictionary hysteria2 multi-port docs');

const commonErrors = readFileSync('docs/常见错误与返回语义.md', 'utf8');
assertIncludes(commonErrors, 'AppErrorShape', 'common errors app error shape docs');
assertIncludes(commonErrors, '看到这个错误先去看哪份文档', 'common errors doc routing docs');
assertIncludes(commonErrors, 'missing bearer token', 'common errors auth docs');
assertIncludes(commonErrors, 'remote sourceType is not supported yet', 'common errors node source docs');
assertIncludes(commonErrors, '容易误解的成功语义', 'common errors success semantics docs');
assertIncludes(commonErrors, 'GET /s/:token/:target', 'common errors public subscription docs');
assertIncludes(commonErrors, 'docs/发布前检查清单.md', 'common errors release checklist link docs');

const releaseChecklist = readFileSync('docs/发布前检查清单.md', 'utf8');
assertIncludes(releaseChecklist, 'GET /health', 'release checklist health docs');
assertIncludes(releaseChecklist, 'POST /api/node-import/preview', 'release checklist import preview docs');
assertIncludes(releaseChecklist, 'x-subforge-preview-cache: miss', 'release checklist preview cache docs');
assertIncludes(releaseChecklist, 'x-subforge-cache: hit', 'release checklist subscription cache docs');
assertIncludes(releaseChecklist, '最小发布通过口径', 'release checklist release gate docs');

const docsNavigation = readFileSync('docs/文档导航与阅读顺序.md', 'utf8');
assertIncludes(docsNavigation, '第一次接手这个项目应该看哪里', 'docs navigation onboarding docs');
assertIncludes(docsNavigation, '按场景跳转', 'docs navigation scenario docs');
assertIncludes(docsNavigation, '按角色阅读路径', 'docs navigation role-based docs');
assertIncludes(docsNavigation, '开发者', 'docs navigation developer docs');
assertIncludes(docsNavigation, '部署 / 运维', 'docs navigation ops docs');
assertIncludes(docsNavigation, '运营 / 后台使用', 'docs navigation operator docs');
assertIncludes(docsNavigation, '核心文档分工', 'docs navigation roles docs');
assertIncludes(docsNavigation, 'docs/部署指南.md', 'docs navigation deploy link docs');
assertIncludes(docsNavigation, 'docs/导入成功但订阅没变化排障指南.md', 'docs navigation troubleshooting link docs');
assertIncludes(docsNavigation, 'docs/API参考与接口约定.md', 'docs navigation api reference link docs');
assertIncludes(docsNavigation, 'docs/节点字段字典.md', 'docs navigation node field dictionary link docs');
assertIncludes(docsNavigation, 'docs/常见错误与返回语义.md', 'docs navigation common error link docs');
assertIncludes(docsNavigation, 'docs/发布前检查清单.md', 'docs navigation release checklist link docs');

const roadmap = readFileSync('.omx/plans/2026-03-07-subforge-roadmap.md', 'utf8');
assertIncludes(roadmap, 'docs/第二十二批自动化验证执行清单.md', 'roadmap twenty-second batch docs');
assertIncludes(roadmap, 'docs/第二十三批自动化验证执行清单.md', 'roadmap twenty-third batch docs');
assertIncludes(roadmap, 'docs/第二十四批自动化验证执行清单.md', 'roadmap twenty-fourth batch docs');
assertIncludes(roadmap, 'docs/第二十五批自动化验证执行清单.md', 'roadmap twenty-fifth batch docs');
assertIncludes(roadmap, 'docs/第二十六批自动化验证执行清单.md', 'roadmap twenty-sixth batch docs');
assertIncludes(roadmap, '协议级校验', 'roadmap protocol validation docs');
assertIncludes(roadmap, '独立排障文档', 'roadmap troubleshooting docs');
assertIncludes(roadmap, '发布前检查清单', 'roadmap release checklist docs');

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
assertIncludes(workerIndex, 'handleNodeImportPreview', 'worker node import preview handler');
assertIncludes(workerIndex, 'must be a JSON object or null', 'worker node metadata validation message');
assertIncludes(workerIndex, 'readNullableObjectField', 'worker node metadata validation helper');
assertIncludes(workerIndex, 'default template must be enabled', 'worker template default-state validation');
assertIncludes(workerIndex, 'return await handleApiRequest(request, env, segments.slice(1));', 'worker api await handling');
assertIncludes(workerIndex, 'return await env.ASSETS.fetch(request);', 'worker assets fallback');

const revocationMigration = readFileSync('migrations/002_admin_session_revocation.sql', 'utf8');
assertIncludes(revocationMigration, 'ALTER TABLE admins ADD COLUMN session_not_before TEXT;', 'revocation migration');

console.log('Smoke checks passed.');
