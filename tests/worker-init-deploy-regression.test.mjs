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
  constructor({ admins = [] } = {}) {
    this.admins = new Map(admins.map((row) => [row.id, { ...row }]));
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('SELECT COUNT(*) AS count FROM admins LIMIT 1')) {
      return { count: this.admins.size };
    }

    if (sql.includes('SELECT * FROM admins WHERE id = ? LIMIT 1')) {
      return this.admins.get(bindings[0]) ?? null;
    }

    throw new Error(`Unexpected first query in init/deploy regression test: ${sql}`);
  }

  async all(sql) {
    throw new Error(`Unexpected all query in init/deploy regression test: ${sql}`);
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

    if (sql.startsWith('UPDATE admins SET session_not_before = ?, updated_at = ? WHERE id = ?')) {
      const [sessionNotBefore, updatedAt, id] = bindings;
      const admin = this.admins.get(id);

      if (admin) {
        admin.session_not_before = sessionNotBefore;
        admin.updated_at = updatedAt;
      }

      return { success: true };
    }

    throw new Error(`Unexpected run query in init/deploy regression test: ${sql}`);
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

    return new Response('asset-fallback', { status: 200 });
  }
}

class MockKvNamespace {
  async get() {
    return null;
  }

  async put() {
  }

  async delete() {
  }
}

function createAdminRow(overrides = {}) {
  return {
    id: 'adm_demo',
    username: 'admin',
    role: 'admin',
    status: 'active',
    session_not_before: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createEnv({ admins = [] } = {}) {
  const assets = new MockAssets();

  return {
    env: {
      ASSETS: assets,
      DB: new MockDatabase({ admins }),
      SUB_CACHE: new MockKvNamespace(),
      ADMIN_JWT_SECRET: 'init-deploy-secret',
      SUBSCRIPTION_CACHE_TTL: '1800',
      PREVIEW_CACHE_TTL: '120',
      SYNC_HTTP_TIMEOUT_MS: '10000',
      APP_ENV: 'test'
    },
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

async function createAdminToken(env, admin = [...env.DB.admins.values()][0]) {
  return signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );
}

test('setup bootstrap rejects invalid JSON payloads', async () => {
  const { env } = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/setup/bootstrap',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"username":'
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'request body must be valid JSON');
});

test('setup bootstrap rejects usernames shorter than three characters', async () => {
  const { env } = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/setup/bootstrap',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: 'ad',
        password: 'correct-password'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'username must be at least 3 characters');
});

test('setup bootstrap rejects passwords shorter than eight characters', async () => {
  const { env } = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/setup/bootstrap',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'short'
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'password must be at least 8 characters');
});

test('admin logout revokes the current session on the server', async () => {
  const admin = createAdminRow();
  const { env } = createEnv({ admins: [admin] });
  const token = await createAdminToken(env, admin);
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/logout',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.loggedOut, true);
  assert.equal(payload.data.serverRevocation, true);
  assert.equal(payload.data.mode, 'server_revoked');
  assert.ok(payload.data.revokedAt);

  const me = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(me.response.status, 401);
  assert.equal(me.payload.ok, false);
  assert.equal(me.payload.error.code, 'UNAUTHORIZED');
  assert.equal(me.payload.error.message, 'admin session has been revoked');
});

test('OPTIONS returns preflight response with CORS headers', async () => {
  const { env } = createEnv();
  const response = await worker.fetch(
    new Request('http://127.0.0.1:8787/api/users', {
      method: 'OPTIONS'
    }),
    env
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET,POST,PATCH,DELETE,OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type,authorization');
});

test('non-GET non-HEAD non-api requests return 404 instead of falling back to assets', async () => {
  const { env, assets } = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/dashboard',
    {
      method: 'POST'
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.deepEqual(assets.requests, []);
});
