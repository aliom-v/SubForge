import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  invalidateAllUserCaches,
  invalidateNodeAffectedCaches,
  invalidateUserCaches
} = await loadTsModule('apps/worker/src/cache.ts');

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
  constructor({ userCacheRefs = [], usersByNodeId = new Map() } = {}) {
    this.userCacheRefs = userCacheRefs;
    this.usersByNodeId = usersByNodeId;
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql) {
    throw new Error(`Unexpected first query in cache test: ${sql}`);
  }

  async all(sql, bindings) {
    if (sql.includes('SELECT id, token FROM users')) {
      return this.userCacheRefs;
    }

    if (sql.includes('FROM users u') && sql.includes('INNER JOIN user_node_map unm')) {
      return this.usersByNodeId.get(bindings[0]) ?? [];
    }

    throw new Error(`Unexpected all query in cache test: ${sql}`);
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

function createEnv(options = {}) {
  const SUB_CACHE = new MockKvNamespace();

  return {
    DB: new MockDatabase(options),
    SUB_CACHE
  };
}

test('invalidateUserCaches clears both subscription and preview caches for all targets by default', async () => {
  const env = createEnv();

  await invalidateUserCaches(env, { id: 'usr_1', token: 'tok_1' });

  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v3:mihomo:tok_1',
    'preview:v3:mihomo:usr_1',
    'sub:v3:singbox:tok_1',
    'preview:v3:singbox:usr_1'
  ]);
});

test('invalidateUserCaches only clears the requested target when targets are provided', async () => {
  const env = createEnv();

  await invalidateUserCaches(env, { id: 'usr_2', token: 'tok_2' }, ['mihomo']);

  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v3:mihomo:tok_2',
    'preview:v3:mihomo:usr_2'
  ]);
});

test('invalidateAllUserCaches clears caches for every listed user', async () => {
  const env = createEnv({
    userCacheRefs: [
      { id: 'usr_a', token: 'tok_a' },
      { id: 'usr_b', token: 'tok_b' }
    ]
  });

  await invalidateAllUserCaches(env, ['singbox']);

  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v3:singbox:tok_a',
    'preview:v3:singbox:usr_a',
    'sub:v3:singbox:tok_b',
    'preview:v3:singbox:usr_b'
  ]);
});

test('invalidateNodeAffectedCaches clears caches for users bound to the affected node', async () => {
  const env = createEnv({
    usersByNodeId: new Map([
      [
        'node_1',
        [
          { id: 'usr_x', token: 'tok_x' },
          { id: 'usr_y', token: 'tok_y' }
        ]
      ]
    ])
  });

  await invalidateNodeAffectedCaches(env, 'node_1', ['mihomo']);

  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v3:mihomo:tok_x',
    'preview:v3:mihomo:usr_x',
    'sub:v3:mihomo:tok_y',
    'preview:v3:mihomo:usr_y'
  ]);
});
