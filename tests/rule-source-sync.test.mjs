import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { runEnabledRuleSourceSync, syncRuleSourceNow } = await loadTsModule('apps/worker/src/sync.ts');

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
  constructor({ ruleSources, users, snapshots = [] }) {
    this.ruleSources = new Map([...ruleSources.entries()].map(([id, row]) => [id, { ...row }]));
    this.users = users.map((user) => ({ ...user }));
    this.snapshots = snapshots.map((snapshot) => ({ ...snapshot }));
    this.syncLogs = [];
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('SELECT * FROM rule_snapshots WHERE rule_source_id = ?')) {
      const rows = this.snapshots
        .filter((snapshot) => snapshot.rule_source_id === bindings[0])
        .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
      return rows[0] ?? null;
    }

    if (sql.includes('SELECT * FROM rule_sources WHERE id = ? LIMIT 1')) {
      return this.ruleSources.get(bindings[0]) ?? null;
    }

    throw new Error(`Unexpected first query in sync test: ${sql}`);
  }

  async all(sql) {
    if (sql.includes('SELECT * FROM rule_sources WHERE enabled = 1')) {
      return [...this.ruleSources.values()].filter((source) => source.enabled === 1);
    }

    if (sql.includes('SELECT id, token FROM users')) {
      return this.users;
    }

    throw new Error(`Unexpected all query in sync test: ${sql}`);
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

    throw new Error(`Unexpected run query in sync test: ${sql}`);
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

function createEnv({ ruleSources, users, snapshots } = {}) {
  return {
    DB: new MockDatabase({
      ruleSources,
      users: users ?? [{ id: 'usr_1', token: 'tok_1' }],
      snapshots
    }),
    SUB_CACHE: new MockKvNamespace(),
    ASSETS: {
      async fetch() {
        throw new Error('ASSETS.fetch should not be called in sync tests');
      }
    },
    ADMIN_JWT_SECRET: 'sync-secret',
    SUBSCRIPTION_CACHE_TTL: '1800',
    PREVIEW_CACHE_TTL: '120',
    SYNC_HTTP_TIMEOUT_MS: '10000',
    APP_ENV: 'test'
  };
}

async function sha256Hex(content) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function toRuleSourceRecord(source) {
  return {
    id: source.id,
    name: source.name,
    sourceUrl: source.source_url,
    format: source.format,
    enabled: true,
    failureCount: source.failure_count,
    createdAt: source.created_at,
    updatedAt: source.updated_at
  };
}

function parseSyncLogDetails(bindings) {
  return JSON.parse(bindings[5]);
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

test('syncRuleSourceNow updates snapshot and invalidates all user caches when content changes', async () => {
  const source = createRuleSourceRow('rs_1');
  const env = createEnv({
    ruleSources: new Map([[source.id, source]]),
    users: [{ id: 'usr_1', token: 'tok_1' }]
  });

  const result = await withMockFetch(
    async () =>
      new Response('DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,DIRECT', {
        status: 200
      }),
    () => syncRuleSourceNow(env, toRuleSourceRecord(source))
  );

  assert.equal(result.status, 'success');
  assert.equal(result.changed, true);
  assert.equal(result.ruleCount, 2);
  assert.equal(env.DB.snapshots.length, 1);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:mihomo:tok_1',
    'preview:mihomo:usr_1',
    'sub:singbox:tok_1',
    'preview:singbox:usr_1'
  ]);
});

test('syncRuleSourceNow skips unchanged content without invalidating caches', async () => {
  const source = createRuleSourceRow('rs_1');
  const normalizedContent = 'DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,DIRECT';
  const contentHash = await sha256Hex(normalizedContent);
  const env = createEnv({
    ruleSources: new Map([[source.id, source]]),
    snapshots: [
      {
        id: 'snap_1',
        rule_source_id: source.id,
        content_hash: contentHash,
        content: normalizedContent,
        created_at: '2026-03-08T01:00:00.000Z'
      }
    ]
  });

  const result = await withMockFetch(
    async () =>
      new Response('DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,DIRECT', {
        status: 200
      }),
    () => syncRuleSourceNow(env, toRuleSourceRecord(source))
  );

  assert.equal(result.status, 'skipped');
  assert.equal(result.changed, false);
  assert.equal(env.DB.snapshots.length, 1);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
});

test('syncRuleSourceNow records upstream status on non-2xx failures without invalidating caches', async () => {
  const source = createRuleSourceRow('rs_1');
  const env = createEnv({
    ruleSources: new Map([[source.id, source]])
  });

  const result = await withMockFetch(
    async () =>
      new Response('bad gateway', {
        status: 502
      }),
    () => syncRuleSourceNow(env, toRuleSourceRecord(source))
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.changed, false);
  assert.equal(result.message, 'upstream returned 502');
  assert.equal(result.details?.upstreamStatus, 502);
  assert.equal(result.details?.fetchedBytes, new TextEncoder().encode('bad gateway').byteLength);
  assert.equal(env.DB.snapshots.length, 0);
  assert.equal(env.DB.ruleSources.get(source.id)?.failure_count, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.deepEqual(parseSyncLogDetails(env.DB.syncLogs[0]), {
    sourceUrl: 'https://example.com/rules.txt',
    format: 'text',
    durationMs: result.details?.durationMs,
    upstreamStatus: 502,
    fetchedBytes: new TextEncoder().encode('bad gateway').byteLength,
    reason: 'upstream returned 502'
  });
});

test('syncRuleSourceNow reports empty upstream content with structured failure details', async () => {
  const source = createRuleSourceRow('rs_1');
  const env = createEnv({
    ruleSources: new Map([[source.id, source]])
  });

  const result = await withMockFetch(
    async () =>
      new Response('   \n', {
        status: 200
      }),
    () => syncRuleSourceNow(env, toRuleSourceRecord(source))
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.changed, false);
  assert.equal(result.message, 'empty upstream content');
  assert.equal(result.details?.upstreamStatus, 200);
  assert.equal(result.details?.fetchedBytes, 0);
  assert.equal(result.details?.reason, 'empty upstream content');
  assert.equal(env.DB.syncLogs.length, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
});

test('syncRuleSourceNow preserves upstream metadata when parsing fails', async () => {
  const source = createRuleSourceRow('rs_json', {
    format: 'json',
    source_url: 'https://example.com/rules.json'
  });
  const env = createEnv({
    ruleSources: new Map([[source.id, source]])
  });

  const result = await withMockFetch(
    async () =>
      new Response('{"foo":"bar"}', {
        status: 200
      }),
    () => syncRuleSourceNow(env, toRuleSourceRecord(source))
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.changed, false);
  assert.equal(result.message, 'json rule source is not in a supported shape');
  assert.equal(result.details?.upstreamStatus, 200);
  assert.equal(result.details?.fetchedBytes, new TextEncoder().encode('{"foo":"bar"}').byteLength);
  assert.equal(env.DB.snapshots.length, 0);
  assert.equal(env.DB.ruleSources.get(source.id)?.failure_count, 1);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.syncLogs.length, 1);
  assert.deepEqual(parseSyncLogDetails(env.DB.syncLogs[0]), {
    sourceUrl: 'https://example.com/rules.json',
    format: 'json',
    durationMs: result.details?.durationMs,
    upstreamStatus: 200,
    fetchedBytes: new TextEncoder().encode('{"foo":"bar"}').byteLength,
    reason: 'json rule source is not in a supported shape'
  });
});

test('runEnabledRuleSourceSync only processes enabled rule sources', async () => {
  const enabledSource = createRuleSourceRow('rs_enabled', { enabled: 1, source_url: 'https://example.com/enabled.txt' });
  const disabledSource = createRuleSourceRow('rs_disabled', { enabled: 0, source_url: 'https://example.com/disabled.txt' });
  const env = createEnv({
    ruleSources: new Map([
      [enabledSource.id, enabledSource],
      [disabledSource.id, disabledSource]
    ])
  });
  const requestedUrls = [];

  const results = await withMockFetch(
    async (input) => {
      requestedUrls.push(typeof input === 'string' ? input : input.url);
      return new Response('MATCH,DIRECT', { status: 200 });
    },
    () => runEnabledRuleSourceSync(env)
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].sourceId, 'rs_enabled');
  assert.deepEqual(requestedUrls, ['https://example.com/enabled.txt']);
});
