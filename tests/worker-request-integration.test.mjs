import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { default: worker } = await loadTsModule('apps/worker/src/index.ts');
const { signAdminSessionToken } = await loadTsModule('apps/worker/src/security.ts');

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
    templates = [],
    nodes = [],
    userNodeMap = [],
    ruleSources = [],
    snapshots = []
  } = {}) {
    this.admins = new Map(admins.map((row) => [row.id, { ...row }]));
    this.users = new Map(users.map((row) => [row.id, { ...row }]));
    this.templates = new Map(templates.map((row) => [row.id, { ...row }]));
    this.nodes = new Map(nodes.map((row) => [row.id, { ...row }]));
    this.userNodeMap = userNodeMap.map((row) => ({ ...row }));
    this.ruleSources = new Map(ruleSources.map((row) => [row.id, { ...row }]));
    this.snapshots = snapshots.map((row) => ({ ...row }));
    this.syncLogs = [];
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('SELECT COUNT(*) AS count FROM admins LIMIT 1')) {
      return { count: this.admins.size };
    }

    if (sql.includes('SELECT * FROM admins WHERE username = ? LIMIT 1')) {
      return [...this.admins.values()].find((row) => row.username === bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM admins WHERE id = ? LIMIT 1')) {
      return this.admins.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM users WHERE token = ? LIMIT 1')) {
      return [...this.users.values()].find((row) => row.token === bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM users WHERE id = ? LIMIT 1')) {
      return this.users.get(bindings[0]) ?? null;
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

    if (sql.includes('SELECT * FROM rule_sources WHERE id = ? LIMIT 1')) {
      return this.ruleSources.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM rule_snapshots WHERE rule_source_id = ?')) {
      const rows = this.snapshots
        .filter((row) => row.rule_source_id === bindings[0])
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
      return rows[0] ?? null;
    }

    throw new Error(`Unexpected first query in worker integration test: ${sql}`);
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
          return source ? { ...snapshot, name: source.name, format: source.format, enabled: source.enabled } : null;
        })
        .filter((row) => row && row.enabled === 1)
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1))
        .map(({ enabled, ...row }) => row);
    }

    if (sql.includes('SELECT * FROM rule_sources WHERE enabled = 1')) {
      return [...this.ruleSources.values()].filter((row) => row.enabled === 1);
    }

    if (sql.includes('SELECT id, token FROM users')) {
      return [...this.users.values()].map((row) => ({
        id: row.id,
        token: row.token
      }));
    }

    throw new Error(`Unexpected all query in worker integration test: ${sql}`);
  }

  async run(sql, bindings) {
    if (sql.startsWith('INSERT INTO admins')) {
      const [id, username, passwordHash, role, status, createdAt, updatedAt] = bindings;
      this.admins.set(id, {
        id,
        username,
        password_hash: passwordHash,
        role,
        status,
        created_at: createdAt,
        updated_at: updatedAt
      });
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

    if (sql.startsWith('UPDATE rule_sources SET last_sync_at = ?, last_sync_status = ?, failure_count = ?, updated_at = ? WHERE id = ?')) {
      const [lastSyncAt, status, failureCount, updatedAt, sourceId] = bindings;
      const source = this.ruleSources.get(sourceId);

      if (source) {
        source.last_sync_at = lastSyncAt;
        source.last_sync_status = status;
        source.failure_count = failureCount;
        source.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('INSERT INTO sync_logs')) {
      this.syncLogs.push(bindings);
      return { success: true };
    }

    throw new Error(`Unexpected run query in worker integration test: ${sql}`);
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

class MockAssets {
  constructor() {
    this.requests = [];
  }

  async fetch(request) {
    this.requests.push({
      method: request.method,
      url: request.url
    });

    const pathname = new URL(request.url).pathname;
    const isHtml = !pathname.startsWith('/assets/');

    return new Response(`asset:${request.method}:${pathname}`, {
      status: 200,
      headers: {
        'content-type': isHtml ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8',
        'cache-control': isHtml ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
        'x-assets-method': request.method
      }
    });
  }
}

function createAdminRow(overrides = {}) {
  return {
    id: 'adm_demo',
    username: 'admin',
    password_hash: 'unused',
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

function createTemplateRow(overrides = {}) {
  return {
    id: 'tpl_mihomo',
    name: 'Mihomo Default',
    target_type: 'mihomo',
    content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}',
    version: 1,
    is_default: 1,
    enabled: 1,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createNodeRow(overrides = {}) {
  return {
    id: 'node_hk_01',
    name: 'HK Edge 01',
    protocol: 'vless',
    server: 'hk-01.example.com',
    port: 443,
    source_type: 'manual',
    source_id: null,
    enabled: 1,
    credentials_json: JSON.stringify({
      uuid: '11111111-1111-1111-1111-111111111111'
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

function createRuleSourceRow(overrides = {}) {
  return {
    id: 'rs_demo',
    name: 'Default Rules',
    source_url: 'https://example.com/rules.txt',
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

function createSnapshotRow(overrides = {}) {
  return {
    id: 'snap_demo',
    rule_source_id: 'rs_demo',
    content_hash: 'hash_demo',
    content: 'DOMAIN-SUFFIX,example.com,DIRECT',
    created_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createEnv({
  admins = [createAdminRow()],
  users = [createUserRow()],
  templates = [createTemplateRow()],
  nodes = [createNodeRow()],
  userNodeMap = [{ user_id: 'usr_demo', node_id: 'node_hk_01', enabled: 1 }],
  ruleSources = [createRuleSourceRow()],
  snapshots = [createSnapshotRow()],
  cacheEntries = []
} = {}) {
  const assets = new MockAssets();
  const db = new MockDatabase({
    admins,
    users,
    templates,
    nodes,
    userNodeMap,
    ruleSources,
    snapshots
  });
  const kv = new MockKvNamespace(cacheEntries);

  return {
    env: {
      ASSETS: assets,
      DB: db,
      SUB_CACHE: kv,
      ADMIN_JWT_SECRET: 'worker-integration-secret',
      SUBSCRIPTION_CACHE_TTL: '1800',
      PREVIEW_CACHE_TTL: '120',
      SYNC_HTTP_TIMEOUT_MS: '10000',
      APP_ENV: 'test'
    },
    db,
    kv,
    assets
  };
}

async function requestJson(url, init, env) {
  const response = await worker.fetch(new Request(url, init), env);
  return {
    response,
    payload: await response.json()
  };
}

async function signAdminToken(env, admin = [...env.DB.admins.values()][0]) {
  return signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );
}

async function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('setup status, bootstrap, login and admin me complete the first-install auth loop', async () => {
  const { env, db } = createEnv({
    admins: [],
    users: [],
    templates: [],
    nodes: [],
    userNodeMap: [],
    ruleSources: [],
    snapshots: []
  });

  const statusBefore = await requestJson('http://127.0.0.1:8787/api/setup/status', { method: 'GET' }, env);
  assert.equal(statusBefore.response.status, 200);
  assert.equal(statusBefore.payload.data.initialized, false);
  assert.equal(statusBefore.payload.data.adminCount, 0);

  const bootstrap = await requestJson(
    'http://127.0.0.1:8787/api/setup/bootstrap',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'correct-password'
      })
    },
    env
  );

  assert.equal(bootstrap.response.status, 201);
  assert.equal(bootstrap.payload.data.initialized, true);
  assert.equal(bootstrap.payload.data.admin.username, 'admin');
  assert.match(bootstrap.payload.data.token, /\./);
  assert.equal(db.admins.size, 1);

  const statusAfter = await requestJson('http://127.0.0.1:8787/api/setup/status', { method: 'GET' }, env);
  assert.equal(statusAfter.response.status, 200);
  assert.equal(statusAfter.payload.data.initialized, true);
  assert.equal(statusAfter.payload.data.adminCount, 1);

  const bootstrapAgain = await requestJson(
    'http://127.0.0.1:8787/api/setup/bootstrap',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'correct-password'
      })
    },
    env
  );

  assert.equal(bootstrapAgain.response.status, 403);
  assert.equal(bootstrapAgain.payload.error.code, 'FORBIDDEN');

  const login = await requestJson(
    'http://127.0.0.1:8787/api/admin/login',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'correct-password'
      })
    },
    env
  );

  assert.equal(login.response.status, 200);
  assert.equal(login.payload.data.admin.username, 'admin');
  assert.match(login.payload.data.token, /\./);

  const me = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${login.payload.data.token}`
      }
    },
    env
  );

  assert.equal(me.response.status, 200);
  assert.equal(me.payload.data.username, 'admin');
  assert.equal(me.payload.data.status, 'active');
});

test('preview request compiles on miss, writes cache, and returns hit on the second request', async () => {
  const { env, kv } = createEnv();
  const token = await signAdminToken(env);

  const first = await requestJson(
    'http://127.0.0.1:8787/api/preview/usr_demo/mihomo',
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get('x-subforge-preview-cache'), 'miss');
  assert.equal(first.response.headers.get('x-subforge-cache-scope'), 'preview');
  assert.equal(first.payload.data.cacheKey, 'preview:mihomo:usr_demo');
  assert.match(first.payload.data.content, /HK Edge 01/);
  assert.match(first.payload.data.content, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.equal(kv.putCalls.length, 1);
  assert.equal(kv.putCalls[0].key, 'preview:mihomo:usr_demo');

  const second = await requestJson(
    'http://127.0.0.1:8787/api/preview/usr_demo/mihomo',
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(second.response.status, 200);
  assert.equal(second.response.headers.get('x-subforge-preview-cache'), 'hit');
  assert.equal(second.payload.data.cacheKey, 'preview:mihomo:usr_demo');
  assert.equal(second.payload.data.content, first.payload.data.content);
  assert.equal(kv.putCalls.length, 1);
});

test('public subscription request compiles on miss, writes cache, and returns hit on the second request', async () => {
  const { env, kv } = createEnv();
  const subscriptionCacheWrites = () => kv.putCalls.filter((call) => call.key === 'sub:mihomo:tok_demo');

  const first = await worker.fetch(new Request('http://127.0.0.1:8787/s/tok_demo/mihomo'), env);
  const firstBody = await first.text();

  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-subforge-cache'), 'miss');
  assert.equal(first.headers.get('x-subforge-cache-scope'), 'subscription');
  assert.match(firstBody, /HK Edge 01/);
  assert.match(firstBody, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.equal(subscriptionCacheWrites().length, 1);

  const second = await worker.fetch(new Request('http://127.0.0.1:8787/s/tok_demo/mihomo'), env);
  const secondBody = await second.text();

  assert.equal(second.status, 200);
  assert.equal(second.headers.get('x-subforge-cache'), 'hit');
  assert.equal(secondBody, firstBody);
  assert.equal(subscriptionCacheWrites().length, 1);
});

test('health endpoint returns JSON and GET or HEAD non-api requests fall back to assets', async () => {
  const { env, assets } = createEnv();

  const health = await requestJson('http://127.0.0.1:8787/health', { method: 'GET' }, env);
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.service, 'SubForge');
  assert.equal(health.payload.env, 'test');
  assert.equal(health.payload.cacheKeyExample, 'sub:mihomo:demo-token');

  const getAsset = await worker.fetch(new Request('http://127.0.0.1:8787/dashboard'), env);
  assert.equal(getAsset.status, 200);
  assert.equal(await getAsset.text(), 'asset:GET:/dashboard');
  assert.equal(getAsset.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
  assert.equal(getAsset.headers.get('pragma'), 'no-cache');
  assert.equal(getAsset.headers.get('expires'), '0');
  assert.equal(getAsset.headers.get('x-subforge-asset-cache'), 'html-no-store');

  const headAsset = await worker.fetch(new Request('http://127.0.0.1:8787/dashboard', { method: 'HEAD' }), env);
  assert.equal(headAsset.status, 200);
  assert.equal(headAsset.headers.get('x-assets-method'), 'HEAD');
  assert.equal(headAsset.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');

  const cssAsset = await worker.fetch(new Request('http://127.0.0.1:8787/assets/index.css'), env);
  assert.equal(cssAsset.status, 200);
  assert.equal(await cssAsset.text(), 'asset:GET:/assets/index.css');
  assert.equal(cssAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(cssAsset.headers.get('x-subforge-asset-cache'), null);

  assert.equal(assets.requests.length, 3);
  assert.deepEqual(
    assets.requests.map((entry) => entry.method),
    ['GET', 'HEAD', 'GET']
  );
});

test('unknown runtime errors return a structured 500 internal error response', async () => {
  const { env } = createEnv();
  env.ASSETS = {
    async fetch() {
      throw new Error('asset pipeline exploded');
    }
  };

  const { response, payload } = await requestJson('http://127.0.0.1:8787/dashboard', { method: 'GET' }, env);

  assert.equal(response.status, 500);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INTERNAL_ERROR');
  assert.equal(payload.error.message, 'internal server error');
});

test('scheduled delegates sync work to waitUntil and processes only enabled rule sources', async () => {
  const enabledSource = createRuleSourceRow({
    id: 'rs_enabled',
    name: 'Enabled Rules',
    source_url: 'https://example.com/enabled.txt',
    enabled: 1
  });
  const disabledSource = createRuleSourceRow({
    id: 'rs_disabled',
    name: 'Disabled Rules',
    source_url: 'https://example.com/disabled.txt',
    enabled: 0
  });
  const { env, db, kv } = createEnv({
    ruleSources: [enabledSource, disabledSource],
    snapshots: [],
    cacheEntries: [
      ['sub:mihomo:tok_demo', 'cached'],
      ['preview:mihomo:usr_demo', '{"ok":true}'],
      ['sub:singbox:tok_demo', 'cached'],
      ['preview:singbox:usr_demo', '{"ok":true}']
    ]
  });
  const waitUntilCalls = [];
  const requestedUrls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    await withMockFetch(
      async (input) => {
        requestedUrls.push(typeof input === 'string' ? input : input.url);
        return new Response('MATCH,DIRECT', { status: 200 });
      },
      async () => {
        await worker.scheduled(
          { scheduledTime: 1234567890 },
          env,
          {
            waitUntil(promise) {
              waitUntilCalls.push(promise);
            }
          }
        );

        assert.equal(waitUntilCalls.length, 1);
        await waitUntilCalls[0];
      }
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(requestedUrls, ['https://example.com/enabled.txt']);
  assert.equal(db.snapshots.length, 1);
  assert.equal(db.syncLogs.length, 1);
  assert.equal(db.ruleSources.get('rs_enabled')?.last_sync_status, 'success');
  assert.equal(db.ruleSources.get('rs_disabled')?.last_sync_status, null);
  assert.deepEqual(kv.deletedKeys, [
    'sub:mihomo:tok_demo',
    'preview:mihomo:usr_demo',
    'sub:singbox:tok_demo',
    'preview:singbox:usr_demo'
  ]);
});
