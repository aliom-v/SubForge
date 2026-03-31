import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { default: worker } = await loadTsModule('apps/worker/src/index.ts');
const { signAdminSessionToken } = await loadTsModule('apps/worker/src/security.ts');
const { parseNodeShareLink } = await loadTsModule('packages/core/src/node-import.ts');

class MockPreparedStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.bindings = [];
  }

  bind(...bindings) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.db.first(this.sql, this.bindings);
  }

  async all() {
    return { results: await this.db.all(this.sql, this.bindings) };
  }

  async run() {
    return this.db.run(this.sql, this.bindings);
  }
}

class MockDatabase {
  constructor({
    admins = [],
    users = [],
    nodes = [],
    templates = [],
    remoteSubscriptionSources = [],
    ruleSources = [],
    snapshots = [],
    userNodeMap = []
  } = {}) {
    this.admins = new Map(admins.map((row) => [row.id, { ...row }]));
    this.users = new Map(users.map((row) => [row.id, { ...row }]));
    this.nodes = new Map(nodes.map((row) => [row.id, { ...row }]));
    this.templates = new Map(templates.map((row) => [row.id, { ...row }]));
    this.remoteSubscriptionSources = new Map(remoteSubscriptionSources.map((row) => [row.id, { ...row }]));
    this.ruleSources = new Map(ruleSources.map((row) => [row.id, { ...row }]));
    this.snapshots = snapshots.map((row) => ({ ...row }));
    this.userNodeMap = userNodeMap.map((row) => ({ ...row }));
    this.auditLogs = [];
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) {
      await this.run(statement.sql, statement.bindings);
    }

    return [];
  }

  async first(sql, bindings) {
    if (sql.includes('FROM admins WHERE id = ?')) {
      return this.admins.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM users WHERE id = ? LIMIT 1')) {
      return this.users.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM users WHERE token = ? LIMIT 1')) {
      return [...this.users.values()].find((row) => row.token === bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM nodes WHERE id = ? LIMIT 1')) {
      return this.nodes.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM templates WHERE id = ? LIMIT 1')) {
      return this.templates.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM rule_sources WHERE id = ? LIMIT 1')) {
      return this.ruleSources.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM rule_snapshots WHERE rule_source_id = ? ORDER BY created_at DESC LIMIT 1')) {
      const rows = this.snapshots
        .filter((row) => row.rule_source_id === bindings[0])
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
      return rows[0] ?? null;
    }

    if (sql.includes('SELECT * FROM remote_subscription_sources WHERE id = ? LIMIT 1')) {
      return this.remoteSubscriptionSources.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM remote_subscription_sources WHERE source_url = ? LIMIT 1')) {
      return [...this.remoteSubscriptionSources.values()].find((row) => row.source_url === bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM templates WHERE target_type = ? AND enabled = 1')) {
      const targetType = bindings[0];
      const candidates = [...this.templates.values()]
        .filter((row) => row.target_type === targetType && row.enabled === 1)
        .sort((left, right) => {
          if (left.is_default !== right.is_default) {
            return right.is_default - left.is_default;
          }

          if (left.version !== right.version) {
            return right.version - left.version;
          }

          return left.created_at < right.created_at ? 1 : -1;
        });

      return candidates[0] ?? null;
    }

    throw new Error(`Unexpected first query in worker write integration test: ${sql}`);
  }

  async all(sql, bindings) {
    if (sql.includes('SELECT n.*') && sql.includes('FROM nodes n') && sql.includes('INNER JOIN user_node_map')) {
      const userId = bindings[0];
      const nodeIds = this.userNodeMap
        .filter((row) => row.user_id === userId && row.enabled === 1)
        .map((row) => row.node_id);

      return nodeIds
        .map((nodeId) => this.nodes.get(nodeId))
        .filter((row) => row && row.enabled === 1)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('FROM rule_snapshots rs') && sql.includes('INNER JOIN rule_sources rsrc')) {
      return this.snapshots
        .map((snapshot) => {
          const source = this.ruleSources.get(snapshot.rule_source_id);
          return source && source.enabled === 1 ? { ...snapshot, name: source.name, format: source.format } : null;
        })
        .filter(Boolean)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT u.id, u.token') && sql.includes('INNER JOIN user_node_map unm')) {
      const nodeId = bindings[0];
      return this.userNodeMap
        .filter((row) => row.node_id === nodeId && row.enabled === 1)
        .map((row) => this.users.get(row.user_id))
        .filter(Boolean)
        .map((user) => ({
          id: user.id,
          token: user.token
        }));
    }

    if (sql.includes('SELECT id, token FROM users')) {
      return [...this.users.values()].map((user) => ({
        id: user.id,
        token: user.token
      }));
    }

    if (sql.includes('SELECT * FROM users ORDER BY created_at DESC')) {
      return [...this.users.values()].sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT * FROM user_node_map WHERE user_id = ?')) {
      const userId = bindings[0];
      return this.userNodeMap
        .filter((row) => row.user_id === userId)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT * FROM nodes WHERE source_type = ? ORDER BY created_at DESC')) {
      const [sourceType] = bindings;
      return [...this.nodes.values()]
        .filter((row) => row.source_type === sourceType)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT * FROM nodes WHERE source_type = ? AND source_id = ? ORDER BY created_at DESC')) {
      const [sourceType, sourceId] = bindings;
      return [...this.nodes.values()]
        .filter((row) => row.source_type === sourceType && row.source_id === sourceId)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT * FROM remote_subscription_sources ORDER BY created_at DESC')) {
      return [...this.remoteSubscriptionSources.values()].sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    }

    if (sql.includes('SELECT * FROM remote_subscription_sources WHERE enabled = 1')) {
      return [...this.remoteSubscriptionSources.values()].filter((row) => row.enabled === 1);
    }

    throw new Error(`Unexpected all query in worker write integration test: ${sql}`);
  }

  async run(sql, bindings) {
    if (sql.startsWith('UPDATE users SET name = ?, status = ?, expires_at = ?, remark = ?, updated_at = ? WHERE id = ?')) {
      const [name, status, expiresAt, remark, updatedAt, id] = bindings;
      const user = this.users.get(id);

      if (user) {
        user.name = name;
        user.status = status;
        user.expires_at = expiresAt;
        user.remark = remark;
        user.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('UPDATE users SET token = ?, updated_at = ? WHERE id = ?')) {
      const [token, updatedAt, id] = bindings;
      const user = this.users.get(id);

      if (user) {
        user.token = token;
        user.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('DELETE FROM users WHERE id = ?')) {
      const [id] = bindings;
      this.users.delete(id);
      this.userNodeMap = this.userNodeMap.filter((row) => row.user_id !== id);
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM user_node_map WHERE user_id = ?')) {
      const [userId] = bindings;
      this.userNodeMap = this.userNodeMap.filter((row) => row.user_id !== userId);
      return { success: true };
    }

    if (sql.startsWith('INSERT INTO user_node_map')) {
      const [id, userId, nodeId, enabled, createdAt] = bindings;
      this.userNodeMap.push({
        id,
        user_id: userId,
        node_id: nodeId,
        enabled,
        created_at: createdAt
      });
      return { success: true };
    }

    if (sql.startsWith('INSERT INTO nodes')) {
      const [id, name, protocol, server, port, credentialsJson, paramsJson, sourceType, sourceId, enabled, lastSyncAt, createdAt, updatedAt] = bindings;
      this.nodes.set(id, {
        id,
        name,
        protocol,
        server,
        port,
        credentials_json: credentialsJson,
        params_json: paramsJson,
        source_type: sourceType,
        source_id: sourceId,
        enabled,
        last_sync_at: lastSyncAt,
        created_at: createdAt,
        updated_at: updatedAt
      });
      return { success: true };
    }

    if (sql.startsWith('UPDATE nodes SET name = ?, protocol = ?, server = ?, port = ?, credentials_json = ?, params_json = ?, source_type = ?, source_id = ?, enabled = ?, last_sync_at = ?, updated_at = ? WHERE id = ?')) {
      const [name, protocol, server, port, credentialsJson, paramsJson, sourceType, sourceId, enabled, lastSyncAt, updatedAt, id] = bindings;
      const node = this.nodes.get(id);

      if (node) {
        node.name = name;
        node.protocol = protocol;
        node.server = server;
        node.port = port;
        node.credentials_json = credentialsJson;
        node.params_json = paramsJson;
        node.source_type = sourceType;
        node.source_id = sourceId;
        node.enabled = enabled;
        node.last_sync_at = lastSyncAt;
        node.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('DELETE FROM nodes WHERE id = ?')) {
      const [id] = bindings;
      this.nodes.delete(id);
      return { success: true };
    }

    if (sql.startsWith('UPDATE templates SET is_default = 0')) {
      const [, targetType] = bindings;

      for (const template of this.templates.values()) {
        if (template.target_type === targetType) {
          template.is_default = 0;
        }
      }

      return { success: true };
    }

    if (sql.startsWith('UPDATE templates SET is_default = 1')) {
      const [, id] = bindings;
      const template = this.templates.get(id);

      if (template) {
        template.is_default = 1;
      }

      return { success: true };
    }

    if (sql.startsWith('INSERT INTO templates')) {
      const [id, name, targetType, content, version, isDefault, enabled, createdAt, updatedAt] = bindings;
      this.templates.set(id, {
        id,
        name,
        target_type: targetType,
        content,
        version,
        is_default: isDefault,
        enabled,
        created_at: createdAt,
        updated_at: updatedAt
      });
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM templates WHERE id = ?')) {
      const [id] = bindings;
      this.templates.delete(id);
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM rule_sources WHERE id = ?')) {
      const [id] = bindings;
      this.ruleSources.delete(id);
      this.snapshots = this.snapshots.filter((row) => row.rule_source_id !== id);
      return { success: true };
    }

    if (sql.startsWith('UPDATE rule_sources SET name = ?, source_url = ?, format = ?, enabled = ?, updated_at = ? WHERE id = ?')) {
      const [name, sourceUrl, format, enabled, updatedAt, id] = bindings;
      const ruleSource = this.ruleSources.get(id);

      if (ruleSource) {
        ruleSource.name = name;
        ruleSource.source_url = sourceUrl;
        ruleSource.format = format;
        ruleSource.enabled = enabled;
        ruleSource.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('UPDATE rule_sources SET last_sync_at = ?, last_sync_status = ?, failure_count = ?, updated_at = ? WHERE id = ?')) {
      const [lastSyncAt, status, failureCount, updatedAt, id] = bindings;
      const ruleSource = this.ruleSources.get(id);

      if (ruleSource) {
        ruleSource.last_sync_at = lastSyncAt;
        ruleSource.last_sync_status = status;
        ruleSource.failure_count = failureCount;
        ruleSource.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('INSERT INTO rule_snapshots')) {
      const [id, ruleSourceId, contentHash, content, createdAt] = bindings;
      this.snapshots.push({
        id,
        rule_source_id: ruleSourceId,
        content_hash: contentHash,
        content,
        created_at: createdAt
      });
      return { success: true };
    }

    if (sql.startsWith('INSERT INTO remote_subscription_sources')) {
      const [id, name, sourceUrl, enabled, lastSyncAt, lastSyncStatus, failureCount, createdAt, updatedAt] = bindings;
      this.remoteSubscriptionSources.set(id, {
        id,
        name,
        source_url: sourceUrl,
        enabled,
        last_sync_at: lastSyncAt,
        last_sync_status: lastSyncStatus,
        failure_count: failureCount,
        created_at: createdAt,
        updated_at: updatedAt
      });
      return { success: true };
    }

    if (sql.startsWith('UPDATE remote_subscription_sources SET name = ?, source_url = ?, enabled = ?, updated_at = ? WHERE id = ?')) {
      const [name, sourceUrl, enabled, updatedAt, sourceId] = bindings;
      const source = this.remoteSubscriptionSources.get(sourceId);

      if (source) {
        source.name = name;
        source.source_url = sourceUrl;
        source.enabled = enabled;
        source.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('UPDATE remote_subscription_sources SET last_sync_at = ?, last_sync_status = ?, failure_count = ?, updated_at = ? WHERE id = ?')) {
      const [lastSyncAt, status, failureCount, updatedAt, sourceId] = bindings;
      const source = this.remoteSubscriptionSources.get(sourceId);

      if (source) {
        source.last_sync_at = lastSyncAt;
        source.last_sync_status = status;
        source.failure_count = failureCount;
        source.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('INSERT INTO sync_logs')) {
      return { success: true };
    }

    if (sql.startsWith('DELETE FROM remote_subscription_sources WHERE id = ?')) {
      this.remoteSubscriptionSources.delete(bindings[0]);
      return { success: true };
    }

    if (sql.startsWith('INSERT INTO audit_logs')) {
      this.auditLogs.push(bindings);
      return { success: true };
    }

    throw new Error(`Unexpected run query in worker write integration test: ${sql}`);
  }
}

class MockKvNamespace {
  constructor(initialEntries = []) {
    this.store = new Map(initialEntries);
    this.deletedKeys = [];
    this.putCalls = [];
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async put(key, value, options) {
    this.putCalls.push({ key, value, options });
    this.store.set(key, value);
  }

  async delete(key) {
    this.deletedKeys.push(key);
    this.store.delete(key);
  }
}

function createAdminRow(overrides = {}) {
  return {
    id: 'adm_demo',
    username: 'admin',
    role: 'admin',
    status: 'active',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createUserRow(overrides = {}) {
  return {
    id: 'usr_demo',
    name: 'Demo User',
    token: 'tok_demo',
    status: 'active',
    expires_at: null,
    remark: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createNodeRow(id, overrides = {}) {
  return {
    id,
    name: id,
    protocol: 'vless',
    server: `${id}.example.com`,
    port: 443,
    source_type: 'manual',
    source_id: null,
    enabled: 1,
    credentials_json: JSON.stringify({
      uuid: `uuid-${id}`
    }),
    params_json: JSON.stringify({
      tls: true
    }),
    last_sync_at: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createTemplateRow(id, overrides = {}) {
  const targetType = overrides.target_type ?? 'mihomo';
  const defaultContent =
    targetType === 'singbox'
      ? '{\n  "outbounds": [\n{{outbound_items}}\n  ],\n  "route": {\n    "rules": {{rules}}\n  }\n}'
      : 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}';

  return {
    id,
    name: id,
    target_type: targetType,
    content: defaultContent,
    version: 1,
    is_default: 0,
    enabled: 1,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createRuleSourceRow(id, overrides = {}) {
  return {
    id,
    name: id,
    source_url: `https://example.com/${id}.txt`,
    format: 'text',
    enabled: 1,
    last_sync_at: null,
    last_sync_status: null,
    failure_count: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createRemoteSubscriptionSourceRow(id, overrides = {}) {
  return {
    id,
    name: id,
    source_url: `https://example.com/${id}.txt`,
    enabled: 1,
    last_sync_at: null,
    last_sync_status: null,
    failure_count: 0,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createSnapshotRow(id, overrides = {}) {
  return {
    id,
    rule_source_id: 'rs_demo',
    content_hash: `hash-${id}`,
    content: 'DOMAIN-SUFFIX,example.com,DIRECT',
    created_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createEnv({
  admins = [createAdminRow()],
  users = [createUserRow()],
  nodes = [
    createNodeRow('node_hk_01', { name: 'HK Edge 01', server: 'hk-01.example.com' }),
    createNodeRow('node_sg_01', { name: 'SG Edge 01', server: 'sg-01.example.com' })
  ],
  templates = [
    createTemplateRow('tpl_default', { is_default: 1, name: 'Mihomo Default' }),
    createTemplateRow('tpl_alt', { is_default: 0, version: 2, name: 'Alt Template' }),
    createTemplateRow('tpl_singbox', { target_type: 'singbox', is_default: 1, name: 'Singbox Default' })
  ],
  remoteSubscriptionSources = [],
  ruleSources = [createRuleSourceRow('rs_demo', { name: 'Default Rules' })],
  snapshots = [createSnapshotRow('snap_demo')],
  userNodeMap = [{ id: 'unm_1', user_id: 'usr_demo', node_id: 'node_hk_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }],
  cacheEntries = []
} = {}) {
  const db = new MockDatabase({
    admins,
    users,
    nodes,
    templates,
    remoteSubscriptionSources,
    ruleSources,
    snapshots,
    userNodeMap
  });
  const kv = new MockKvNamespace(cacheEntries);

  return {
    env: {
      ASSETS: {
        async fetch() {
          throw new Error('ASSETS.fetch should not be called in worker write integration tests');
        }
      },
      DB: db,
      SUB_CACHE: kv,
      ADMIN_JWT_SECRET: 'worker-write-secret',
      SUBSCRIPTION_CACHE_TTL: '1800',
      PREVIEW_CACHE_TTL: '120',
      SYNC_HTTP_TIMEOUT_MS: '10000',
      APP_ENV: 'test'
    },
    db,
    kv
  };
}

async function requestJson(url, init, env) {
  const response = await worker.fetch(new Request(url, init), env);
  return {
    response,
    payload: await response.json()
  };
}

async function requestSubscription(env, token, target = 'mihomo') {
  return worker.fetch(new Request(`http://127.0.0.1:8787/s/${token}/${target}`), env);
}

async function requestPreview(env, adminToken, userId = 'usr_demo', target = 'mihomo') {
  return requestJson(
    `http://127.0.0.1:8787/api/preview/${userId}/${target}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );
}

const singboxExampleRulePattern = /"domain_suffix": \[\s*"example\.com"\s*\]/;
const singboxUpdatedExampleRulePattern = /"domain_suffix": \[\s*"updated\.example\.com"\s*\]/;

async function createNodeFromShareLink(env, adminToken, shareLink) {
  const importedNode = parseNodeShareLink(shareLink);

  return requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: importedNode.name,
        protocol: importedNode.protocol,
        server: importedNode.server,
        port: importedNode.port,
        credentials: importedNode.credentials,
        params: importedNode.params
      })
    },
    env
  );
}

async function withMockFetch(handler, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;

  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createAdminToken(env) {
  const admin = [...env.DB.admins.values()][0];
  return signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );
}

function parseAuditPayload(bindings) {
  return JSON.parse(bindings[5]);
}

function auditAction(bindings) {
  return bindings[2];
}

function captureWriteState(db) {
  return {
    users: db.users.size,
    nodes: db.nodes.size,
    templates: db.templates.size,
    remoteSubscriptionSources: db.remoteSubscriptionSources.size,
    ruleSources: db.ruleSources.size,
    userNodeBindings: db.userNodeMap.length,
    auditLogs: db.auditLogs.length
  };
}

test('previewing node import from subscription URL fetches content, parses nodes, and writes audit log', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const ssUserInfo = Buffer.from('aes-256-gcm:passw0rd', 'utf8').toString('base64');

  await withMockFetch(
    async () =>
      new Response(
        [
          'vless://11111111-1111-1111-1111-111111111111@hk.example.com:443?security=tls&type=ws#HK',
          `ss://${ssUserInfo}@ss.example.com:8388#SS`,
          'trojan://replace-me@jp.example.com:443?sni=sub.example.com#JP',
          'hysteria2://replace-me@hy2.example.com:8443?sni=sub.example.com#HY2'
        ].join('\n'),
        { status: 200 }
      ),
    async () => {
      const { response, payload } = await requestJson(
        'http://127.0.0.1:8787/api/node-import/preview',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sourceUrl: 'https://example.com/subscription.txt'
          })
        },
        env
      );

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.sourceUrl, 'https://example.com/subscription.txt');
      assert.equal(payload.data.upstreamStatus, 200);
      assert.equal(payload.data.lineCount, 4);
      assert.equal(payload.data.nodes.length, 4);
      assert.equal(payload.data.errors.length, 0);
      assert.equal(payload.data.nodes[0].protocol, 'vless');
      assert.equal(payload.data.nodes[1].protocol, 'ss');
      assert.equal(payload.data.nodes[2].protocol, 'trojan');
      assert.equal(payload.data.nodes[3].protocol, 'hysteria2');
      assert.equal(db.auditLogs.length, 1);
      assert.equal(auditAction(db.auditLogs[0]), 'node_import.preview');
      assert.equal(parseAuditPayload(db.auditLogs[0]).sourceUrl, 'https://example.com/subscription.txt');
      assert.equal(parseAuditPayload(db.auditLogs[0]).nodeCount, 4);
      assert.equal(parseAuditPayload(db.auditLogs[0]).errorCount, 0);
      assert.deepEqual(kv.deletedKeys, []);
    }
  );
});

test('previewing node import rejects invalid subscription URLs', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/node-import/preview',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sourceUrl: 'ftp://example.com/subscription.txt'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'sourceUrl must be a valid http/https URL');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('previewing node import surfaces upstream fetch failures', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  await withMockFetch(
    async () => new Response('bad gateway', { status: 502 }),
    async () => {
      const { response, payload } = await requestJson(
        'http://127.0.0.1:8787/api/node-import/preview',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sourceUrl: 'https://example.com/subscription.txt'
          })
        },
        env
      );

      assert.equal(response.status, 400);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, 'VALIDATION_FAILED');
      assert.equal(payload.error.message, 'upstream returned 502');
      assert.deepEqual(captureWriteState(db), initialState);
      assert.deepEqual(kv.deletedKeys, []);
    }
  );
});

test('previewing node import auto-decodes base64 wrapped subscription responses', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const encodedSubscription = Buffer.from(
    [
      'vless://11111111-1111-1111-1111-111111111111@hk.example.com:443#HK',
      'trojan://replace-me@jp.example.com:443?sni=sub.example.com#JP'
    ].join('\n'),
    'utf8'
  ).toString('base64');

  await withMockFetch(
    async () => new Response(encodedSubscription, { status: 200 }),
    async () => {
      const { response, payload } = await requestJson(
        'http://127.0.0.1:8787/api/node-import/preview',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sourceUrl: 'https://example.com/base64-subscription.txt'
          })
        },
        env
      );

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.contentEncoding, 'base64_text');
      assert.equal(payload.data.lineCount, 2);
      assert.equal(payload.data.nodes.length, 2);
      assert.equal(payload.data.errors.length, 0);
      assert.equal(db.auditLogs.length, 1);
      assert.equal(auditAction(db.auditLogs[0]), 'node_import.preview');
      assert.equal(parseAuditPayload(db.auditLogs[0]).contentEncoding, 'base64_text');
      assert.deepEqual(kv.deletedKeys, []);
    }
  );
});

test('syncing a saved remote subscription source rewires bound users to the latest source nodes', async () => {
  const { env, db, kv } = createEnv({
    nodes: [
      createNodeRow('node_manual_01', { name: 'Manual Keep', server: 'manual.example.com' }),
      createNodeRow('node_remote_old', {
        name: 'Remote Old',
        server: 'old.example.com',
        source_type: 'remote',
        source_id: 'rss_demo',
        credentials_json: JSON.stringify({
          uuid: 'remote-old-uuid'
        })
      })
    ],
    remoteSubscriptionSources: [
      createRemoteSubscriptionSourceRow('rss_demo', {
        name: 'My Remote Subscription',
        source_url: 'https://example.com/subscription.txt'
      })
    ],
    userNodeMap: [
      { id: 'unm_manual', user_id: 'usr_demo', node_id: 'node_manual_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' },
      { id: 'unm_remote_old', user_id: 'usr_demo', node_id: 'node_remote_old', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }
    ]
  });
  const adminToken = await createAdminToken(env);
  const initialPreview = await requestPreview(env, adminToken);
  const initialSubscription = await requestSubscription(env, 'tok_demo');
  const initialSubscriptionBody = await initialSubscription.text();

  assert.equal(initialPreview.response.status, 200);
  assert.equal(initialPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(initialSubscription.status, 200);
  assert.equal(initialSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(initialPreview.payload.data.content, initialSubscriptionBody);
  assert.match(initialSubscriptionBody, /Remote Old/);
  assert.doesNotMatch(initialSubscriptionBody, /Remote New/);

  await withMockFetch(
    async () =>
      new Response(
        'vless://11111111-1111-1111-1111-111111111111@new.example.com:443?security=tls&type=ws#Remote New',
        { status: 200 }
      ),
    async () => {
      const { response, payload } = await requestJson(
        'http://127.0.0.1:8787/api/remote-subscription-sources/rss_demo/sync',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`
          }
        },
        env
      );

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.status, 'success');
      assert.equal(payload.data.createdCount, 1);
      assert.equal(payload.data.updatedCount, 0);
      assert.equal(payload.data.disabledCount, 1);
    }
  );

  const activeRemoteNodes = [...db.nodes.values()].filter((row) => row.source_type === 'remote' && row.source_id === 'rss_demo' && row.enabled === 1);
  assert.equal(activeRemoteNodes.length, 1);
  assert.equal(activeRemoteNodes[0].server, 'new.example.com');
  assert.equal(db.nodes.get('node_remote_old')?.enabled, 0);
  assert.equal(db.remoteSubscriptionSources.get('rss_demo')?.last_sync_status, 'success');

  const boundNodeIds = db.userNodeMap
    .filter((row) => row.user_id === 'usr_demo' && row.enabled === 1)
    .map((row) => row.node_id)
    .sort();
  assert.deepEqual(boundNodeIds, ['node_manual_01', activeRemoteNodes[0].id].sort());
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'remote_subscription_source.sync');

  const nextPreview = await requestPreview(env, adminToken);
  const nextSubscription = await requestSubscription(env, 'tok_demo');
  const nextSubscriptionBody = await nextSubscription.text();

  assert.equal(nextPreview.response.status, 200);
  assert.equal(nextPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(nextSubscription.status, 200);
  assert.equal(nextSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(nextPreview.payload.data.content, nextSubscriptionBody);
  assert.match(nextSubscriptionBody, /Remote New/);
  assert.doesNotMatch(nextSubscriptionBody, /Remote Old/);
});

test('creating a user rejects missing names', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        remark: 'missing name'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'name is required');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a user rejects invalid expiration datetimes', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Demo User',
        expiresAt: 'not-a-datetime'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'expiresAt must be a valid datetime string');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects missing required fields', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Incomplete Node',
        protocol: 'vless',
        server: 'node.example.com'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'name, protocol, server and port are required');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects invalid ports', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Invalid Port Node',
        protocol: 'vless',
        server: 'node.example.com',
        port: 70000
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'port must be an integer between 1 and 65535');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects remote sourceType until node-source sync exists', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Remote Node',
        protocol: 'vless',
        server: 'remote.example.com',
        port: 443,
        sourceType: 'remote'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'remote sourceType is not supported yet');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects unknown sourceType values', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Invalid SourceType Node',
        protocol: 'vless',
        server: 'invalid.example.com',
        port: 443,
        sourceType: 'imported'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'sourceType must be manual or remote');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects sourceId on manual nodes', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Manual Node',
        protocol: 'vless',
        server: 'manual.example.com',
        port: 443,
        sourceId: 'ns_remote_01'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'sourceId is not supported for manual nodes');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects non-object credentials payloads', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Invalid Metadata Node',
        protocol: 'vless',
        server: 'meta.example.com',
        port: 443,
        credentials: ['uuid-1']
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'credentials must be a JSON object or null');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node accepts credentials and params objects', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Manual VLESS Node',
        protocol: 'vless',
        server: 'vless.example.com',
        port: 443,
        credentials: {
          uuid: '11111111-1111-1111-1111-111111111111'
        },
        params: {
          tls: true,
          network: 'ws'
        }
      })
    },
    env
  );

  assert.equal(response.status, 201);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.name, 'Manual VLESS Node');
  assert.equal(payload.data.credentials.uuid, '11111111-1111-1111-1111-111111111111');
  assert.equal(payload.data.params.network, 'ws');
  assert.equal(db.nodes.size, 3);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'node.create');
  assert.equal(parseAuditPayload(db.auditLogs[0]).name, 'Manual VLESS Node');
  assert.equal(parseAuditPayload(db.auditLogs[0]).protocol, 'vless');
  const createdNode = [...db.nodes.values()].find((node) => node.name === 'Manual VLESS Node');
  assert.ok(createdNode);
  assert.equal(createdNode.credentials_json, JSON.stringify({ uuid: '11111111-1111-1111-1111-111111111111' }));
  assert.equal(createdNode.params_json, JSON.stringify({ tls: true, network: 'ws' }));
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects ss metadata that misses password', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Broken SS Node',
        protocol: 'ss',
        server: 'ss.example.com',
        port: 8388,
        credentials: {
          cipher: 'aes-256-gcm'
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'ss 节点需要 credentials.cipher 和 credentials.password');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects hysteria2 metadata with unsupported obfs values', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Broken HY2 Node',
        protocol: 'hy2',
        server: 'hy2.example.com',
        port: 443,
        credentials: {
          password: 'replace-me'
        },
        params: {
          obfs: 'shadowtls'
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'hysteria2 节点当前仅支持 params.obfs = "salamander"');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a node rejects hysteria2 metadata with invalid bandwidth fields', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Broken HY2 Bandwidth Node',
        protocol: 'hysteria2',
        server: 'hy2.example.com',
        port: 443,
        credentials: {
          password: 'replace-me'
        },
        params: {
          upmbps: false
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'hysteria2 节点的 params.upmbps 必须是非空字符串或数字');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a template rejects missing required fields', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Incomplete Template',
        targetType: 'mihomo'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'name, targetType and content are required');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a template rejects invalid target types', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Bad Target Template',
        targetType: 'clash',
        content: 'proxies:\n{{proxies}}'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'targetType must be mihomo or singbox');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a template rejects non-positive versions', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Bad Version Template',
        targetType: 'mihomo',
        content: 'proxies:\n{{proxies}}',
        version: 0
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'version must be a positive integer');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a default template rejects disabled state', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Disabled Default Template',
        targetType: 'mihomo',
        content: 'proxies:\n{{proxies}}',
        isDefault: true,
        enabled: false
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'default template must be enabled');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a rule source rejects missing required fields', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Incomplete Source'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'name, sourceUrl and format are required');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a rule source rejects invalid formats', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Bad Format Source',
        sourceUrl: 'https://example.com/rules.txt',
        format: 'toml'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'format must be text, yaml or json');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('creating a rule source rejects invalid urls', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const initialState = captureWriteState(db);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Bad Url Source',
        sourceUrl: 'ftp://example.com/rules.txt',
        format: 'text'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'sourceUrl must be a valid http/https URL');
  assert.deepEqual(captureWriteState(db), initialState);
  assert.deepEqual(kv.deletedKeys, []);
});

test('updating a user rejects invalid status values', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        status: 'paused'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'status must be active or disabled');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a user rejects invalid expiration datetimes', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        expiresAt: 'not-a-datetime'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'expiresAt must be a valid datetime string');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('deleting a missing user returns 404 without writing audit logs', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_missing',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.equal(payload.error.message, 'user not found');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('reset-token invalidates old and new caches, writes audit log, and shifts subscription access to the new token', async () => {
  const oldToken = 'tok_demo';
  const { env, kv, db } = createEnv({
    cacheEntries: [
      [`sub:mihomo:${oldToken}`, 'old-subscription'],
      [`preview:mihomo:usr_demo`, '{"cached":true}'],
      [`sub:singbox:${oldToken}`, 'old-singbox'],
      [`preview:singbox:usr_demo`, '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/reset-token',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'user-agent': 'worker-write-test'
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.notEqual(payload.data.token, oldToken);
  assert.deepEqual(kv.deletedKeys, [
    `sub:mihomo:${oldToken}`,
    'preview:mihomo:usr_demo',
    `sub:singbox:${oldToken}`,
    'preview:singbox:usr_demo',
    `sub:mihomo:${payload.data.token}`,
    'preview:mihomo:usr_demo',
    `sub:singbox:${payload.data.token}`,
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'user.reset_token');
  assert.deepEqual(parseAuditPayload(db.auditLogs[0]), {
    tokenReset: true,
    name: 'Demo User',
    previousTokenSuffix: '[REDACTED]',
    currentTokenSuffix: '[REDACTED]',
    _request: {
      ip: null,
      country: null,
      colo: null,
      userAgent: 'worker-write-test',
      method: 'POST',
      path: '/api/users/usr_demo/reset-token',
      rayId: null
    }
  });

  const oldResponse = await requestSubscription(env, oldToken);
  const oldPayload = await oldResponse.json();
  assert.equal(oldResponse.status, 404);
  assert.equal(oldPayload.error.code, 'SUBSCRIPTION_USER_NOT_FOUND');

  const nextResponse = await requestSubscription(env, payload.data.token);
  const nextBody = await nextResponse.text();
  assert.equal(nextResponse.status, 200);
  assert.equal(nextResponse.headers.get('x-subforge-cache'), 'miss');
  assert.match(nextBody, /HK Edge 01/);
});

test('hosted-subscription reset-token rotates the internal hosted token and invalidates old subscription URLs', async () => {
  const oldToken = 'tok_hosted';
  const hostedUser = createUserRow({
    id: 'usr_hosted',
    name: '个人托管订阅',
    token: oldToken,
    remark: 'subforge:auto-hosted'
  });
  const { env, kv, db } = createEnv({
    users: [hostedUser],
    userNodeMap: [{ id: 'unm_hosted', user_id: 'usr_hosted', node_id: 'node_hk_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }],
    cacheEntries: [
      [`sub:mihomo:${oldToken}`, 'old-subscription'],
      ['preview:mihomo:usr_hosted', '{"cached":true}'],
      [`sub:singbox:${oldToken}`, 'old-singbox'],
      ['preview:singbox:usr_hosted', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/hosted-subscription/reset-token',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'user-agent': 'worker-write-test'
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.notEqual(payload.data.token, oldToken);
  assert.deepEqual(kv.deletedKeys, [
    `sub:mihomo:${oldToken}`,
    'preview:mihomo:usr_hosted',
    `sub:singbox:${oldToken}`,
    'preview:singbox:usr_hosted',
    `sub:mihomo:${payload.data.token}`,
    'preview:mihomo:usr_hosted',
    `sub:singbox:${payload.data.token}`,
    'preview:singbox:usr_hosted'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'hosted_subscription.reset_token');
  assert.deepEqual(parseAuditPayload(db.auditLogs[0]), {
    tokenReset: true,
    name: '个人托管订阅',
    previousTokenSuffix: '[REDACTED]',
    currentTokenSuffix: '[REDACTED]',
    _request: {
      ip: null,
      country: null,
      colo: null,
      userAgent: 'worker-write-test',
      method: 'POST',
      path: '/api/hosted-subscription/reset-token',
      rayId: null
    }
  });

  const oldResponse = await requestSubscription(env, oldToken);
  const oldPayload = await oldResponse.json();
  assert.equal(oldResponse.status, 404);
  assert.equal(oldPayload.error.code, 'SUBSCRIPTION_USER_NOT_FOUND');

  const nextResponse = await requestSubscription(env, payload.data.token);
  const nextBody = await nextResponse.text();
  assert.equal(nextResponse.status, 200);
  assert.equal(nextResponse.headers.get('x-subforge-cache'), 'miss');
  assert.match(nextBody, /HK Edge 01/);
});

test('deleting a user invalidates caches, writes audit log, and makes the old token unreachable', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.deleted, true);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'user.delete');
  assert.equal(db.users.has('usr_demo'), false);
  assert.deepEqual(db.userNodeMap, []);

  const nextResponse = await requestSubscription(env, 'tok_demo');
  const nextPayload = await nextResponse.json();
  assert.equal(nextResponse.status, 404);
  assert.equal(nextPayload.error.code, 'SUBSCRIPTION_USER_NOT_FOUND');
});

test('binding nodes rejects missing users before changing bindings or writing audit logs', async () => {
  const { env, kv, db } = createEnv({
    users: []
  });
  const adminToken = await createAdminToken(env);
  const originalBindings = db.userNodeMap.map((row) => ({ ...row }));

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_missing/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: ['node_sg_01']
      })
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.equal(payload.error.message, 'user not found');
  assert.deepEqual(db.userNodeMap, originalBindings);
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('binding nodes rejects unknown node ids before mutating state', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);
  const originalBindings = db.userNodeMap.map((row) => ({ ...row }));

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: ['node_sg_01', 'node_missing', 'node_sg_01', '']
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.match(payload.error.message, /node_missing/);
  assert.deepEqual(db.userNodeMap, originalBindings);
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('binding new nodes invalidates caches, writes audit log, and changes subsequent preview output', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: ['', 'node_sg_01', 'node_sg_01']
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.nodeIds, ['node_sg_01']);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'user.bind_nodes');
  assert.deepEqual(parseAuditPayload(db.auditLogs[0]).nodeIds, ['node_sg_01']);

  const preview = await requestPreview(env, adminToken);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.match(preview.payload.data.content, /SG Edge 01/);
  assert.doesNotMatch(preview.payload.data.content, /HK Edge 01/);
});

test('binding changes keep preview and public subscription aligned for the same user and target', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const initialPreview = await requestPreview(env, adminToken);
  const initialSubscription = await requestSubscription(env, 'tok_demo');
  const initialSubscriptionBody = await initialSubscription.text();

  assert.equal(initialPreview.response.status, 200);
  assert.equal(initialPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(initialSubscription.status, 200);
  assert.equal(initialSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(initialPreview.payload.data.content, initialSubscriptionBody);
  assert.match(initialSubscriptionBody, /HK Edge 01/);
  assert.doesNotMatch(initialSubscriptionBody, /SG Edge 01/);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: ['node_sg_01']
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.nodeIds, ['node_sg_01']);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'user.bind_nodes');

  const nextPreview = await requestPreview(env, adminToken);
  const nextSubscription = await requestSubscription(env, 'tok_demo');
  const nextSubscriptionBody = await nextSubscription.text();

  assert.equal(nextPreview.response.status, 200);
  assert.equal(nextPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(nextSubscription.status, 200);
  assert.equal(nextSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(nextPreview.payload.data.content, nextSubscriptionBody);
  assert.match(nextSubscriptionBody, /SG Edge 01/);
  assert.doesNotMatch(nextSubscriptionBody, /HK Edge 01/);
});

test('share-link import -> create -> bind -> preview works for ss and hysteria2 nodes', async () => {
  const { env, kv, db } = createEnv({
    userNodeMap: [],
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const ssCreate = await createNodeFromShareLink(
    env,
    adminToken,
    'ss://YWVzLTI1Ni1nY206cGFzc3cwcmQ=@ss-01.example.com:8388?plugin=v2ray-plugin#SS%20Imported'
  );
  const hy2Create = await createNodeFromShareLink(
    env,
    adminToken,
    'hysteria2://replace-me@hy2-01.example.com:8443?sni=sub.example.com&obfs=salamander&obfs-password=secret#HY2%20Imported'
  );

  assert.equal(ssCreate.response.status, 201);
  assert.equal(ssCreate.payload.ok, true);
  assert.equal(ssCreate.payload.data.protocol, 'ss');
  assert.equal(hy2Create.response.status, 201);
  assert.equal(hy2Create.payload.ok, true);
  assert.equal(hy2Create.payload.data.protocol, 'hysteria2');

  const bindResult = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: [ssCreate.payload.data.id, hy2Create.payload.data.id]
      })
    },
    env
  );

  assert.equal(bindResult.response.status, 200);
  assert.equal(bindResult.payload.ok, true);
  assert.deepEqual(bindResult.payload.data.nodeIds, [ssCreate.payload.data.id, hy2Create.payload.data.id]);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);

  const preview = await requestPreview(env, adminToken);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.match(preview.payload.data.content, /SS Imported/);
  assert.match(preview.payload.data.content, /HY2 Imported/);
  assert.match(preview.payload.data.content, /type: ss/);
  assert.match(preview.payload.data.content, /type: hysteria2/);
  assert.equal(db.userNodeMap.length, 2);
});

test('share-link import -> create -> bind -> preview/public work for ssr and tuic nodes', async () => {
  const { env, kv, db } = createEnv({
    userNodeMap: [],
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);
  const ssrPassword = Buffer.from('passw0rd', 'utf8').toString('base64');
  const ssrName = Buffer.from('SSR Imported', 'utf8').toString('base64');
  const ssrProtocolParam = Buffer.from('100:replace-me', 'utf8').toString('base64');
  const ssrObfsParam = Buffer.from('sub.example.com', 'utf8').toString('base64');
  const ssrShareLink = `ssr://${Buffer.from(
    `ssr.example.com:443:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:${ssrPassword}/?remarks=${ssrName}&protoparam=${ssrProtocolParam}&obfsparam=${ssrObfsParam}`,
    'utf8'
  ).toString('base64')}`;

  const ssrCreate = await createNodeFromShareLink(
    env,
    adminToken,
    ssrShareLink
  );
  const tuicCreate = await createNodeFromShareLink(
    env,
    adminToken,
    'tuic://11111111-1111-1111-1111-111111111111:replace-me@tuic-01.example.com:443?sni=sub.example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native&zero_rtt_handshake=1#TUIC%20Imported'
  );

  assert.equal(ssrCreate.response.status, 201);
  assert.equal(ssrCreate.payload.ok, true);
  assert.equal(ssrCreate.payload.data.protocol, 'ssr');
  assert.equal(tuicCreate.response.status, 201);
  assert.equal(tuicCreate.payload.ok, true);
  assert.equal(tuicCreate.payload.data.protocol, 'tuic');

  const bindResult = await requestJson(
    'http://127.0.0.1:8787/api/users/usr_demo/nodes',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        nodeIds: [ssrCreate.payload.data.id, tuicCreate.payload.data.id]
      })
    },
    env
  );

  assert.equal(bindResult.response.status, 200);
  assert.equal(bindResult.payload.ok, true);
  assert.deepEqual(bindResult.payload.data.nodeIds, [ssrCreate.payload.data.id, tuicCreate.payload.data.id]);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);

  const preview = await requestPreview(env, adminToken);
  const subscription = await requestSubscription(env, 'tok_demo');
  const subscriptionBody = await subscription.text();
  const singboxPreview = await requestPreview(env, adminToken, 'usr_demo', 'singbox');
  const singboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const singboxSubscriptionBody = await singboxSubscription.text();

  assert.equal(preview.response.status, 200);
  assert.equal(preview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(subscription.status, 200);
  assert.equal(subscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(preview.payload.data.content, subscriptionBody);
  assert.match(subscriptionBody, /SSR Imported/);
  assert.match(subscriptionBody, /TUIC Imported/);
  assert.match(subscriptionBody, /type: ssr/);
  assert.match(subscriptionBody, /type: tuic/);
  assert.equal(singboxPreview.response.status, 200);
  assert.equal(singboxPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(singboxSubscription.status, 200);
  assert.equal(singboxSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(singboxPreview.payload.data.content, singboxSubscriptionBody);
  assert.match(singboxSubscriptionBody, /"tag": "SSR Imported"/);
  assert.match(singboxSubscriptionBody, /"tag": "TUIC Imported"/);
  assert.match(singboxSubscriptionBody, /"type": "ssr"/);
  assert.match(singboxSubscriptionBody, /"type": "tuic"/);
  assert.equal(db.userNodeMap.length, 2);
});

test('updating a node rejects invalid ports', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        port: 70000
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'port must be an integer between 1 and 65535');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects remote sourceType until node-source sync exists', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sourceType: 'remote'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'remote sourceType is not supported yet');
  assert.equal(db.nodes.get('node_hk_01').source_type, 'manual');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects non-object params payloads', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        params: ['bad']
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'params must be a JSON object or null');
  assert.notEqual(db.nodes.get('node_hk_01').params_json, null);
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects invalid hysteria2 metadata', async () => {
  const { env, kv, db } = createEnv({
    nodes: [
      createNodeRow('node_hy2_01', {
        name: 'HY2 Edge 01',
        protocol: 'hysteria2',
        server: 'hy2-01.example.com',
        credentials_json: JSON.stringify({ password: 'replace-me' }),
        params_json: JSON.stringify({ sni: 'sub.example.com' })
      })
    ],
    userNodeMap: [{ id: 'unm_1', user_id: 'usr_demo', node_id: 'node_hy2_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hy2_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        params: {
          insecure: 'true'
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'hysteria2 节点的 params.insecure 必须是布尔值');
  assert.equal(db.nodes.get('node_hy2_01').params_json, JSON.stringify({ sni: 'sub.example.com' }));
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects invalid hysteria2 mport metadata', async () => {
  const { env, kv, db } = createEnv({
    nodes: [
      createNodeRow('node_hy2_02', {
        name: 'HY2 Edge 02',
        protocol: 'hysteria2',
        server: 'hy2-02.example.com',
        credentials_json: JSON.stringify({ password: 'replace-me' }),
        params_json: JSON.stringify({ sni: 'sub.example.com' })
      })
    ],
    userNodeMap: [{ id: 'unm_2', user_id: 'usr_demo', node_id: 'node_hy2_02', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hy2_02',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        params: {
          mport: ''
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'hysteria2 节点的 params.mport 必须是非空字符串');
  assert.equal(db.nodes.get('node_hy2_02').params_json, JSON.stringify({ sni: 'sub.example.com' }));
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects invalid hysteria2 network metadata', async () => {
  const { env, kv, db } = createEnv({
    nodes: [
      createNodeRow('node_hy2_03', {
        name: 'HY2 Edge 03',
        protocol: 'hysteria2',
        server: 'hy2-03.example.com',
        credentials_json: JSON.stringify({ password: 'replace-me' }),
        params_json: JSON.stringify({ sni: 'sub.example.com' })
      })
    ],
    userNodeMap: [{ id: 'unm_3', user_id: 'usr_demo', node_id: 'node_hy2_03', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hy2_03',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        params: {
          network: 'ws'
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'hysteria2 节点的 params.network 当前仅支持 "tcp" 或 "udp"');
  assert.equal(db.nodes.get('node_hy2_03').params_json, JSON.stringify({ sni: 'sub.example.com' }));
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node rejects invalid tuic metadata', async () => {
  const { env, kv, db } = createEnv({
    nodes: [
      createNodeRow('node_tuic_01', {
        name: 'TUIC Edge 01',
        protocol: 'tuic',
        server: 'tuic-01.example.com',
        credentials_json: JSON.stringify({
          uuid: '11111111-1111-1111-1111-111111111111',
          password: 'replace-me'
        }),
        params_json: JSON.stringify({ sni: 'sub.example.com' })
      })
    ],
    userNodeMap: [{ id: 'unm_1', user_id: 'usr_demo', node_id: 'node_tuic_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_tuic_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        params: {
          insecure: 'true'
        }
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'tuic 节点的 params.insecure 必须是布尔值');
  assert.equal(db.nodes.get('node_tuic_01').params_json, JSON.stringify({ sni: 'sub.example.com' }));
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a missing node returns 404 without writing audit logs', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_missing',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Missing Node'
      })
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.equal(payload.error.message, 'node not found');
  assert.deepEqual(kv.deletedKeys, []);
  assert.equal(db.auditLogs.length, 0);
});

test('updating a node accepts null credentials and params to clear stored metadata', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        credentials: null,
        params: null
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, 'node_hk_01');
  assert.equal(payload.data.credentials, undefined);
  assert.equal(payload.data.params, undefined);
  assert.equal(db.nodes.get('node_hk_01').credentials_json, null);
  assert.equal(db.nodes.get('node_hk_01').params_json, null);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'node.update');
});

test('updating a node invalidates affected caches, writes audit log, and changes subsequent preview and subscription output', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'HK Edge Updated',
        server: 'hk-updated.example.com'
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.name, 'HK Edge Updated');
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'node.update');
  assert.equal(parseAuditPayload(db.auditLogs[0]).name, 'HK Edge Updated');

  const preview = await requestPreview(env, adminToken);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.match(preview.payload.data.content, /HK Edge Updated/);
  assert.doesNotMatch(preview.payload.data.content, /HK Edge 01/);

  const subscription = await requestSubscription(env, 'tok_demo');
  const content = await subscription.text();
  assert.equal(subscription.status, 200);
  assert.match(content, /HK Edge Updated/);
  assert.doesNotMatch(content, /HK Edge 01/);
});

test('deleting a node invalidates affected caches, writes audit log, and leaves the user without available nodes', async () => {
  const { env, kv, db } = createEnv({
    nodes: [createNodeRow('node_hk_01', { name: 'HK Edge 01', server: 'hk-01.example.com' })],
    userNodeMap: [{ id: 'unm_1', user_id: 'usr_demo', node_id: 'node_hk_01', enabled: 1, created_at: '2026-03-08T00:00:00.000Z' }],
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/nodes/node_hk_01',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.deleted, true);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'node.delete');

  const nextResponse = await requestSubscription(env, 'tok_demo');
  const nextPayload = await nextResponse.json();
  assert.equal(nextResponse.status, 400);
  assert.equal(nextPayload.error.code, 'NO_NODES_AVAILABLE');
});

test('creating a new default template invalidates target caches, writes audit log, and changes subsequent subscription output', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);
  const nextTemplateContent =
    '# NEW DEFAULT TEMPLATE\nproxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}';

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Mihomo New Default',
        targetType: 'mihomo',
        content: nextTemplateContent,
        isDefault: true,
        version: 3
      })
    },
    env
  );

  assert.equal(response.status, 201);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.name, 'Mihomo New Default');
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'template.create');
  assert.equal(parseAuditPayload(db.auditLogs[0]).targetType, 'mihomo');

  const nextResponse = await requestSubscription(env, 'tok_demo');
  const nextBody = await nextResponse.text();
  assert.equal(nextResponse.status, 200);
  assert.match(nextBody, /NEW DEFAULT TEMPLATE/);
});

test('setting a different default template changes subsequent preview and public subscription output', async () => {
  const { env, kv, db } = createEnv({
    templates: [
      createTemplateRow('tpl_default', { is_default: 1, name: 'Mihomo Default' }),
      createTemplateRow('tpl_alt', {
        is_default: 0,
        version: 2,
        name: 'Alt Template',
        content: '# ALT TEMPLATE\nproxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}'
      }),
      createTemplateRow('tpl_singbox', { target_type: 'singbox', is_default: 1, name: 'Singbox Default' })
    ]
  });
  const adminToken = await createAdminToken(env);

  const initialPreview = await requestPreview(env, adminToken);
  const initialSubscription = await requestSubscription(env, 'tok_demo');
  const initialSubscriptionBody = await initialSubscription.text();

  assert.equal(initialPreview.response.status, 200);
  assert.equal(initialPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(initialSubscription.status, 200);
  assert.equal(initialSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(initialPreview.payload.data.content, initialSubscriptionBody);
  assert.doesNotMatch(initialSubscriptionBody, /ALT TEMPLATE/);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_alt/set-default',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, 'tpl_alt');
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'template.set_default');
  assert.equal(parseAuditPayload(db.auditLogs[0]).previousTemplateId, 'tpl_default');

  const nextPreview = await requestPreview(env, adminToken);
  const nextSubscription = await requestSubscription(env, 'tok_demo');
  const nextSubscriptionBody = await nextSubscription.text();

  assert.equal(nextPreview.response.status, 200);
  assert.equal(nextPreview.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(nextSubscription.status, 200);
  assert.equal(nextSubscription.headers.get('x-subforge-cache'), 'miss');
  assert.equal(nextPreview.payload.data.content, nextSubscriptionBody);
  assert.match(nextSubscriptionBody, /ALT TEMPLATE/);
});

test('deleting the effective template invalidates target caches, writes audit log, and changes subsequent subscription output', async () => {
  const { env, kv, db } = createEnv({
    templates: [
      createTemplateRow('tpl_default', { is_default: 1, name: 'Mihomo Default' }),
      createTemplateRow('tpl_alt', {
        is_default: 0,
        version: 2,
        name: 'Alt Template',
        content: '# ALT TEMPLATE\nproxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}'
      }),
      createTemplateRow('tpl_singbox', { target_type: 'singbox', is_default: 1, name: 'Singbox Default' })
    ],
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_default',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.deleted, true);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'template.delete');

  const nextResponse = await requestSubscription(env, 'tok_demo');
  const nextBody = await nextResponse.text();
  assert.equal(nextResponse.status, 200);
  assert.match(nextBody, /ALT TEMPLATE/);
});

test('deleting a rule source invalidates caches, writes audit log, and removes its rules from subsequent output', async () => {
  const { env, kv, db } = createEnv({
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"cached":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"cached":true}']
    ]
  });
  const adminToken = await createAdminToken(env);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources/rs_demo',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.deleted, true);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'rule_source.delete');
  assert.equal(db.ruleSources.has('rs_demo'), false);
  assert.deepEqual(db.snapshots, []);

  const nextResponse = await requestSubscription(env, 'tok_demo');
  const nextBody = await nextResponse.text();
  assert.equal(nextResponse.status, 200);
  assert.doesNotMatch(nextBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.match(nextBody, /MATCH,DIRECT/);

  const nextSingboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const nextSingboxBody = await nextSingboxSubscription.text();
  assert.equal(nextSingboxSubscription.status, 200);
  assert.doesNotMatch(nextSingboxBody, singboxExampleRulePattern);
});

test('changing rule source enabled status invalidates caches, writes audit log, and changes subsequent subscription output', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const initialSubscription = await requestSubscription(env, 'tok_demo');
  const initialBody = await initialSubscription.text();
  assert.equal(initialSubscription.status, 200);
  assert.match(initialBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  const initialSingboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const initialSingboxBody = await initialSingboxSubscription.text();
  assert.equal(initialSingboxSubscription.status, 200);
  assert.match(initialSingboxBody, singboxExampleRulePattern);

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources/rs_demo',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        enabled: false
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.enabled, false);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'rule_source.update');
  assert.equal(parseAuditPayload(db.auditLogs[0]).enabled, false);

  const nextSubscription = await requestSubscription(env, 'tok_demo');
  const nextBody = await nextSubscription.text();
  assert.equal(nextSubscription.status, 200);
  assert.doesNotMatch(nextBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.match(nextBody, /MATCH,DIRECT/);

  const nextSingboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const nextSingboxBody = await nextSingboxSubscription.text();
  assert.equal(nextSingboxSubscription.status, 200);
  assert.doesNotMatch(nextSingboxBody, singboxExampleRulePattern);
});

test('syncing a rule source invalidates caches, writes audit log, and changes subsequent subscription output', async () => {
  const { env, kv, db } = createEnv();
  const adminToken = await createAdminToken(env);

  const initialSubscription = await requestSubscription(env, 'tok_demo');
  const initialBody = await initialSubscription.text();
  assert.equal(initialSubscription.status, 200);
  assert.match(initialBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.doesNotMatch(initialBody, /DOMAIN-SUFFIX,updated\.example\.com,DIRECT/);
  const initialSingboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const initialSingboxBody = await initialSingboxSubscription.text();
  assert.equal(initialSingboxSubscription.status, 200);
  assert.match(initialSingboxBody, singboxExampleRulePattern);
  assert.doesNotMatch(initialSingboxBody, singboxUpdatedExampleRulePattern);

  await withMockFetch(
    async () =>
      new Response('DOMAIN-SUFFIX,updated.example.com,DIRECT\nMATCH,DIRECT', {
        status: 200
      }),
    async () => {
      const { response, payload } = await requestJson(
        'http://127.0.0.1:8787/api/rule-sources/rs_demo/sync',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`
          }
        },
        env
      );

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.status, 'success');
      assert.equal(payload.data.changed, true);
      assert.equal(payload.data.ruleCount, 2);
    }
  );

  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
  assert.equal(db.auditLogs.length, 1);
  assert.equal(auditAction(db.auditLogs[0]), 'rule_source.sync');
  assert.equal(parseAuditPayload(db.auditLogs[0]).status, 'success');
  assert.equal(parseAuditPayload(db.auditLogs[0]).changed, true);
  assert.equal(db.ruleSources.get('rs_demo')?.last_sync_status, 'success');
  assert.equal(db.snapshots.length, 2);

  const nextSubscription = await requestSubscription(env, 'tok_demo');
  const nextBody = await nextSubscription.text();
  assert.equal(nextSubscription.status, 200);
  assert.doesNotMatch(nextBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.match(nextBody, /DOMAIN-SUFFIX,updated\.example\.com,DIRECT/);

  const nextSingboxSubscription = await requestSubscription(env, 'tok_demo', 'singbox');
  const nextSingboxBody = await nextSingboxSubscription.text();
  assert.equal(nextSingboxSubscription.status, 200);
  assert.doesNotMatch(nextSingboxBody, singboxExampleRulePattern);
  assert.match(nextSingboxBody, singboxUpdatedExampleRulePattern);
});
