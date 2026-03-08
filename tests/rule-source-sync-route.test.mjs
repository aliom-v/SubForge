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
  constructor({ adminsById, users, ruleSources, snapshots = [] }) {
    this.adminsById = new Map(adminsById);
    this.users = users.map((user) => ({ ...user }));
    this.ruleSources = new Map([...ruleSources.entries()].map(([id, row]) => [id, { ...row }]));
    this.snapshots = snapshots.map((snapshot) => ({ ...snapshot }));
    this.syncLogs = [];
    this.auditLogs = [];
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('FROM admins WHERE id = ?')) {
      return this.adminsById.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM rule_sources WHERE id = ? LIMIT 1')) {
      return this.ruleSources.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM rule_snapshots WHERE rule_source_id = ?')) {
      const rows = this.snapshots
        .filter((snapshot) => snapshot.rule_source_id === bindings[0])
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
      return rows[0] ?? null;
    }

    throw new Error(`Unexpected first query in sync route test: ${sql}`);
  }

  async all(sql) {
    if (sql.includes('SELECT id, token FROM users')) {
      return this.users;
    }

    throw new Error(`Unexpected all query in sync route test: ${sql}`);
  }

  async run(sql, bindings) {
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

    if (sql.startsWith('INSERT INTO audit_logs')) {
      this.auditLogs.push(bindings);
      return { success: true };
    }

    throw new Error(`Unexpected run query in sync route test: ${sql}`);
  }
}

class MockKvNamespace {
  constructor() {
    this.deletedKeys = [];
  }

  async get() {
    return null;
  }

  async put() {
  }

  async delete(key) {
    this.deletedKeys.push(key);
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

function createRuleSourceRow(id, overrides = {}) {
  return {
    id,
    name: id,
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

async function createRouteHarness({ ruleSources } = {}) {
  const admin = createAdminRow();
  const env = {
    ASSETS: {
      async fetch() {
        throw new Error('ASSETS.fetch should not be called in sync route tests');
      }
    },
    DB: new MockDatabase({
      adminsById: [[admin.id, admin]],
      users: [{ id: 'usr_1', token: 'tok_1' }],
      ruleSources:
        ruleSources ??
        new Map([
          ['rs_1', createRuleSourceRow('rs_1')]
        ])
    }),
    SUB_CACHE: new MockKvNamespace(),
    ADMIN_JWT_SECRET: 'sync-route-secret',
    SUBSCRIPTION_CACHE_TTL: '1800',
    PREVIEW_CACHE_TTL: '120',
    SYNC_HTTP_TIMEOUT_MS: '10000',
    APP_ENV: 'test'
  };

  const token = await signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: 'admin'
    },
    env.ADMIN_JWT_SECRET
  );

  return { env, token };
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

async function requestJson(url, init, env) {
  const response = await worker.fetch(new Request(url, init), env);
  return {
    response,
    payload: await response.json()
  };
}

function parseAuditPayload(bindings) {
  return JSON.parse(bindings[5]);
}

test('POST /api/rule-sources/:id/sync returns success payload and writes audit log', async () => {
  const { env, token } = await createRouteHarness();

  const { response, payload } = await withMockFetch(
    async () =>
      new Response('DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,DIRECT', {
        status: 200
      }),
    () =>
      requestJson(
        'http://127.0.0.1:8787/api/rule-sources/rs_1/sync',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'user-agent': 'sync-route-test'
          }
        },
        env
      )
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, 'success');
  assert.equal(payload.data.changed, true);
  assert.equal(payload.data.ruleCount, 2);
  assert.equal(payload.data.details.upstreamStatus, 200);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.equal(env.DB.auditLogs.length, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:mihomo:tok_1',
    'preview:mihomo:usr_1',
    'sub:singbox:tok_1',
    'preview:singbox:usr_1'
  ]);

  const auditPayload = parseAuditPayload(env.DB.auditLogs[0]);
  assert.equal(auditPayload.status, 'success');
  assert.equal(auditPayload.changed, true);
  assert.equal(auditPayload.ruleCount, 2);
  assert.equal(auditPayload.details.upstreamStatus, 200);
  assert.equal(auditPayload._request.userAgent, 'sync-route-test');
});

test('POST /api/rule-sources/:id/sync returns failed payload and preserves failure details', async () => {
  const { env, token } = await createRouteHarness();

  const { response, payload } = await withMockFetch(
    async () =>
      new Response('bad gateway', {
        status: 502
      }),
    () =>
      requestJson(
        'http://127.0.0.1:8787/api/rule-sources/rs_1/sync',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'user-agent': 'sync-route-test'
          }
        },
        env
      )
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.status, 'failed');
  assert.equal(payload.data.changed, false);
  assert.equal(payload.data.message, 'upstream returned 502');
  assert.equal(payload.data.details.upstreamStatus, 502);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.equal(env.DB.auditLogs.length, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);

  const auditPayload = parseAuditPayload(env.DB.auditLogs[0]);
  assert.equal(auditPayload.status, 'failed');
  assert.equal(auditPayload.changed, false);
  assert.equal(auditPayload.ruleCount, 0);
  assert.equal(auditPayload.details.upstreamStatus, 502);
  assert.equal(auditPayload.details.reason, 'upstream returned 502');
});

test('POST /api/rule-sources/:id/sync returns 404 for missing rule source', async () => {
  const { env, token } = await createRouteHarness({
    ruleSources: new Map()
  });

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/rule-sources/missing/sync',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.equal(env.DB.syncLogs.length, 0);
  assert.equal(env.DB.auditLogs.length, 0);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
});
