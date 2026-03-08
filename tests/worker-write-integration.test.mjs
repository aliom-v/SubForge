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
    ruleSources = [],
    snapshots = [],
    userNodeMap = []
  } = {}) {
    this.admins = new Map(admins.map((row) => [row.id, { ...row }]));
    this.users = new Map(users.map((row) => [row.id, { ...row }]));
    this.nodes = new Map(nodes.map((row) => [row.id, { ...row }]));
    this.templates = new Map(templates.map((row) => [row.id, { ...row }]));
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

    if (sql.includes('SELECT * FROM user_node_map WHERE user_id = ?')) {
      const userId = bindings[0];
      return this.userNodeMap
        .filter((row) => row.user_id === userId)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
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

    if (sql.startsWith('UPDATE nodes SET name = ?, protocol = ?, server = ?, port = ?, credentials_json = ?, params_json = ?, source_type = ?, source_id = ?, enabled = ?, updated_at = ? WHERE id = ?')) {
      const [name, protocol, server, port, credentialsJson, paramsJson, sourceType, sourceId, enabled, updatedAt, id] = bindings;
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
  return {
    id,
    name: id,
    target_type: 'mihomo',
    content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}',
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

async function requestSubscription(env, token) {
  return worker.fetch(new Request(`http://127.0.0.1:8787/s/${token}/mihomo`), env);
}

async function requestPreview(env, adminToken, userId = 'usr_demo') {
  return requestJson(
    `http://127.0.0.1:8787/api/preview/${userId}/mihomo`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${adminToken}`
      }
    },
    env
  );
}

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
    previousTokenRedacted: true,
    currentTokenRedacted: true,
    _request: {
      ip: null,
      country: null,
      colo: null,
      userAgent: 'worker-write-test'
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

test('updating a node invalidates affected caches, writes audit log, and changes subsequent subscription output', async () => {
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

  const subscription = await requestSubscription(env, 'tok_demo');
  const content = await subscription.text();
  assert.equal(subscription.status, 200);
  assert.match(content, /HK Edge Updated/);
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
});
