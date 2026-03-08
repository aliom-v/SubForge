import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { default: worker } = await loadTsModule('apps/worker/src/index.ts');

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
    return { success: true };
  }
}

class MockDatabase {
  constructor(usersByToken) {
    this.usersByToken = usersByToken;
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('FROM users WHERE token = ?')) {
      return this.usersByToken.get(bindings[0]) ?? null;
    }

    throw new Error(`Unexpected first query in test: ${sql}`);
  }

  async all(sql) {
    throw new Error(`Unexpected all query in test: ${sql}`);
  }
}

class MockKvNamespace {
  constructor(initialEntries = []) {
    this.store = new Map(initialEntries);
    this.deletedKeys = [];
  }

  async get(key) {
    return this.store.get(key) ?? null;
  }

  async put(key, value) {
    this.store.set(key, value);
  }

  async delete(key) {
    this.deletedKeys.push(key);
    this.store.delete(key);
  }
}

function createUserRow(token, overrides = {}) {
  return {
    id: 'usr_demo',
    name: 'Demo User',
    token,
    status: 'active',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    expires_at: null,
    remark: null,
    ...overrides
  };
}

function createEnv({ token, userRow, cachedContent = 'cached-subscription' }) {
  const cacheKey = `sub:mihomo:${token}`;
  const db = new MockDatabase(new Map(userRow ? [[token, userRow]] : []));
  const kv = new MockKvNamespace([[cacheKey, cachedContent]]);

  return {
    env: {
      ASSETS: {
        async fetch() {
          throw new Error('ASSETS.fetch should not be called for subscription tests');
        }
      },
      DB: db,
      SUB_CACHE: kv,
      ADMIN_JWT_SECRET: 'test-secret',
      SUBSCRIPTION_CACHE_TTL: '1800',
      PREVIEW_CACHE_TTL: '120',
      SYNC_HTTP_TIMEOUT_MS: '10000',
      APP_ENV: 'test'
    },
    kv,
    cacheKey
  };
}

async function requestPublicSubscription(env, token) {
  return worker.fetch(new Request(`http://127.0.0.1:8787/s/${token}/mihomo`), env);
}

test('public subscription returns cached content for active users', async () => {
  const token = 'active-token';
  const { env, kv, cacheKey } = createEnv({
    token,
    userRow: createUserRow(token)
  });

  const response = await requestPublicSubscription(env, token);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-subforge-cache'), 'hit');
  assert.equal(response.headers.get('x-subforge-cache-key'), cacheKey);
  assert.equal(await response.text(), 'cached-subscription');
  assert.deepEqual(kv.deletedKeys, []);
});

test('public subscription clears cache and returns 404 when token is missing', async () => {
  const token = 'missing-token';
  const { env, kv, cacheKey } = createEnv({
    token,
    userRow: null
  });

  const response = await requestPublicSubscription(env, token);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'SUBSCRIPTION_USER_NOT_FOUND');
  assert.deepEqual(kv.deletedKeys, [cacheKey]);
  assert.equal(await kv.get(cacheKey), null);
});

test('public subscription clears cache and rejects disabled users on cache hit', async () => {
  const token = 'disabled-token';
  const { env, kv, cacheKey } = createEnv({
    token,
    userRow: createUserRow(token, {
      status: 'disabled'
    })
  });

  const response = await requestPublicSubscription(env, token);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'USER_DISABLED');
  assert.deepEqual(payload.error.details, { userId: 'usr_demo' });
  assert.deepEqual(kv.deletedKeys, [cacheKey]);
  assert.equal(await kv.get(cacheKey), null);
});

test('public subscription clears cache and rejects expired users on cache hit', async () => {
  const token = 'expired-token';
  const { env, kv, cacheKey } = createEnv({
    token,
    userRow: createUserRow(token, {
      expires_at: '2000-01-01T00:00:00.000Z'
    })
  });

  const response = await requestPublicSubscription(env, token);
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'USER_EXPIRED');
  assert.equal(payload.error.details.userId, 'usr_demo');
  assert.equal(payload.error.details.expiresAt, '2000-01-01T00:00:00.000Z');
  assert.deepEqual(kv.deletedKeys, [cacheKey]);
  assert.equal(await kv.get(cacheKey), null);
});
