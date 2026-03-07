import { webcrypto } from 'node:crypto';

const now = new Date().toISOString();

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createRandomToken(length = 12) {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function createId(prefix) {
  return `${prefix}_${createRandomToken(8)}`;
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function sql(strings) {
  return strings.join('\n');
}

function insert(table, columns, values) {
  return `${sql([
    `INSERT INTO ${table} (${columns.join(', ')})`,
    `VALUES (${values.map((value) => (value === null ? 'NULL' : `'${escapeSql(value)}'`)).join(', ')});`
  ])}`;
}

const userA = { id: createId('usr'), token: createRandomToken(24), name: 'Demo Alice' };
const userB = { id: createId('usr'), token: createRandomToken(24), name: 'Demo Bob' };
const nodeA = { id: createId('node'), name: 'HK Edge Demo', protocol: 'vless', server: 'hk-demo.example.com', port: '443' };
const nodeB = { id: createId('node'), name: 'JP Edge Demo', protocol: 'trojan', server: 'jp-demo.example.com', port: '443' };
const templateMihomo = {
  id: createId('tpl'),
  name: 'Default Mihomo',
  targetType: 'mihomo',
  content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}'
};
const templateSingbox = {
  id: createId('tpl'),
  name: 'Default Singbox',
  targetType: 'singbox',
  content: '{\n  "outbounds": {{outbounds}},\n  "route": {\n    "rules": {{rules}}\n  }\n}'
};
const ruleSource = { id: createId('rs'), name: 'Demo Rules', sourceUrl: 'https://example.com/rules.txt', format: 'text' };
const ruleSnapshot = { id: createId('snap'), ruleSourceId: ruleSource.id, contentHash: createRandomToken(24), content: 'MATCH,DIRECT' };
const bindingA = { id: createId('unm'), userId: userA.id, nodeId: nodeA.id };
const bindingB = { id: createId('unm'), userId: userA.id, nodeId: nodeB.id };
const bindingC = { id: createId('unm'), userId: userB.id, nodeId: nodeB.id };

const statements = [
  insert('users', ['id', 'name', 'token', 'status', 'expires_at', 'remark', 'created_at', 'updated_at'], [userA.id, userA.name, userA.token, 'active', null, 'demo user', now, now]),
  insert('users', ['id', 'name', 'token', 'status', 'expires_at', 'remark', 'created_at', 'updated_at'], [userB.id, userB.name, userB.token, 'active', null, 'demo user', now, now]),
  insert('nodes', ['id', 'name', 'protocol', 'server', 'port', 'credentials_json', 'params_json', 'source_type', 'source_id', 'enabled', 'last_sync_at', 'created_at', 'updated_at'], [nodeA.id, nodeA.name, nodeA.protocol, nodeA.server, nodeA.port, JSON.stringify({ uuid: '11111111-1111-1111-1111-111111111111' }), JSON.stringify({ tls: true, network: 'ws' }), 'manual', null, '1', null, now, now]),
  insert('nodes', ['id', 'name', 'protocol', 'server', 'port', 'credentials_json', 'params_json', 'source_type', 'source_id', 'enabled', 'last_sync_at', 'created_at', 'updated_at'], [nodeB.id, nodeB.name, nodeB.protocol, nodeB.server, nodeB.port, JSON.stringify({ password: 'demo-password' }), JSON.stringify({ sni: 'subforge.example.com' }), 'manual', null, '1', null, now, now]),
  insert('templates', ['id', 'name', 'target_type', 'content', 'version', 'is_default', 'enabled', 'created_at', 'updated_at'], [templateMihomo.id, templateMihomo.name, templateMihomo.targetType, templateMihomo.content, '1', '1', '1', now, now]),
  insert('templates', ['id', 'name', 'target_type', 'content', 'version', 'is_default', 'enabled', 'created_at', 'updated_at'], [templateSingbox.id, templateSingbox.name, templateSingbox.targetType, templateSingbox.content, '1', '1', '1', now, now]),
  insert('rule_sources', ['id', 'name', 'source_url', 'format', 'enabled', 'last_sync_at', 'last_sync_status', 'failure_count', 'created_at', 'updated_at'], [ruleSource.id, ruleSource.name, ruleSource.sourceUrl, ruleSource.format, '1', now, 'success', '0', now, now]),
  insert('rule_snapshots', ['id', 'rule_source_id', 'content_hash', 'content', 'created_at'], [ruleSnapshot.id, ruleSnapshot.ruleSourceId, ruleSnapshot.contentHash, ruleSnapshot.content, now]),
  insert('user_node_map', ['id', 'user_id', 'node_id', 'enabled', 'created_at'], [bindingA.id, bindingA.userId, bindingA.nodeId, '1', now]),
  insert('user_node_map', ['id', 'user_id', 'node_id', 'enabled', 'created_at'], [bindingB.id, bindingB.userId, bindingB.nodeId, '1', now]),
  insert('user_node_map', ['id', 'user_id', 'node_id', 'enabled', 'created_at'], [bindingC.id, bindingC.userId, bindingC.nodeId, '1', now])
];

console.log(statements.join('\n\n'));
console.log('\n-- Demo tokens');
console.log(`-- ${userA.name}: ${userA.token}`);
console.log(`-- ${userB.name}: ${userB.token}`);
