import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { default: worker } = await loadTsModule('apps/worker/src/index.ts');
const { hashPassword, signAdminSessionToken } = await loadTsModule('apps/worker/src/security.ts');

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
  constructor({ adminsByUsername = new Map(), adminsById = new Map() } = {}) {
    this.adminsByUsername = new Map(adminsByUsername);
    this.adminsById = new Map(adminsById);
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('FROM admins WHERE username = ?')) {
      return this.adminsByUsername.get(bindings[0]) ?? null;
    }

    if (sql.includes('FROM admins WHERE id = ?')) {
      return this.adminsById.get(bindings[0]) ?? null;
    }

    throw new Error(`Unexpected first query in auth test: ${sql}`);
  }

  async all(sql) {
    throw new Error(`Unexpected all query in auth test: ${sql}`);
  }

  async run(sql, bindings) {
    if (sql.startsWith('UPDATE admins SET session_not_before = ?, updated_at = ? WHERE id = ?')) {
      const [sessionNotBefore, updatedAt, id] = bindings;
      const admin = this.adminsById.get(id);

      if (admin) {
        admin.session_not_before = sessionNotBefore;
        admin.updated_at = updatedAt;
        this.adminsById.set(id, admin);

        if (admin.username) {
          this.adminsByUsername.set(admin.username, admin);
        }
      }

      return { success: true };
    }

    throw new Error(`Unexpected run query in auth test: ${sql}`);
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
    password_hash: 'unused',
    role: 'admin',
    status: 'active',
    session_not_before: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides
  };
}

function createEnv({ adminsByUsername = new Map(), adminsById = new Map(), secret = 'unit-test-secret' } = {}) {
  return {
    ASSETS: {
      async fetch() {
        throw new Error('ASSETS.fetch should not be called in auth tests');
      }
    },
    DB: new MockDatabase({ adminsByUsername, adminsById }),
    SUB_CACHE: new MockKvNamespace(),
    ADMIN_JWT_SECRET: secret,
    SUBSCRIPTION_CACHE_TTL: '1800',
    PREVIEW_CACHE_TTL: '120',
    SYNC_HTTP_TIMEOUT_MS: '10000',
    APP_ENV: 'test'
  };
}

async function requestJson(url, init, env) {
  const response = await worker.fetch(new Request(url, init), env);
  return {
    response,
    payload: await response.json()
  };
}

test('admin login returns a signed token for valid credentials', async () => {
  const passwordHash = await hashPassword('correct-password');
  const adminRow = createAdminRow({ password_hash: passwordHash });
  const env = createEnv({
    adminsByUsername: new Map([[adminRow.username, adminRow]])
  });

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct-password' })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.admin.id, 'adm_demo');
  assert.equal(payload.data.admin.status, 'active');
  assert.match(payload.data.token, /\./);
});

test('admin login rejects invalid passwords', async () => {
  const passwordHash = await hashPassword('correct-password');
  const adminRow = createAdminRow({ password_hash: passwordHash });
  const env = createEnv({
    adminsByUsername: new Map([[adminRow.username, adminRow]])
  });

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' })
    },
    env
  );

  assert.equal(response.status, 401);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNAUTHORIZED');
});

test('admin login rejects disabled admins even when password is correct', async () => {
  const passwordHash = await hashPassword('correct-password');
  const adminRow = createAdminRow({ password_hash: passwordHash, status: 'disabled' });
  const env = createEnv({
    adminsByUsername: new Map([[adminRow.username, adminRow]])
  });

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct-password' })
    },
    env
  );

  assert.equal(response.status, 403);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'FORBIDDEN');
});

test('protected admin routes reject requests without bearer token', async () => {
  const env = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    { method: 'GET' },
    env
  );

  assert.equal(response.status, 401);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNAUTHORIZED');
});

test('protected admin routes reject invalid bearer tokens', async () => {
  const env = createEnv();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: { authorization: 'Bearer invalid.token' }
    },
    env
  );

  assert.equal(response.status, 401);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNAUTHORIZED');
});

test('admin me returns the current admin for valid session tokens', async () => {
  const adminRow = createAdminRow();
  const env = createEnv({
    adminsById: new Map([[adminRow.id, adminRow]])
  });
  const token = await signAdminSessionToken(
    {
      sub: adminRow.id,
      username: adminRow.username,
      role: 'admin'
    },
    env.ADMIN_JWT_SECRET
  );

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.id, 'adm_demo');
  assert.equal(payload.data.username, 'admin');
  assert.equal(payload.data.status, 'active');
});

test('admin me rejects disabled admins even with valid signed tokens', async () => {
  const adminRow = createAdminRow({ status: 'disabled' });
  const env = createEnv({
    adminsById: new Map([[adminRow.id, adminRow]])
  });
  const token = await signAdminSessionToken(
    {
      sub: adminRow.id,
      username: adminRow.username,
      role: 'admin'
    },
    env.ADMIN_JWT_SECRET
  );

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` }
    },
    env
  );

  assert.equal(response.status, 403);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'FORBIDDEN');
});

test('admin me rejects revoked session tokens after logout updates session_not_before', async () => {
  const adminRow = createAdminRow();
  const env = createEnv({
    adminsById: new Map([[adminRow.id, adminRow]]),
    adminsByUsername: new Map([[adminRow.username, adminRow]])
  });
  const token = await signAdminSessionToken(
    {
      sub: adminRow.id,
      username: adminRow.username,
      role: 'admin'
    },
    env.ADMIN_JWT_SECRET
  );

  const logout = await requestJson(
    'http://127.0.0.1:8787/api/admin/logout',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` }
    },
    env
  );

  assert.equal(logout.response.status, 200);
  assert.equal(logout.payload.ok, true);
  assert.equal(logout.payload.data.serverRevocation, true);

  const me = await requestJson(
    'http://127.0.0.1:8787/api/admin/me',
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` }
    },
    env
  );

  assert.equal(me.response.status, 401);
  assert.equal(me.payload.ok, false);
  assert.equal(me.payload.error.code, 'UNAUTHORIZED');
  assert.equal(me.payload.error.message, 'admin session has been revoked');
});
