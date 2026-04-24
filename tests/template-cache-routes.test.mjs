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
  constructor({ adminsById, users, templates }) {
    this.adminsById = new Map(adminsById);
    this.users = users.map((user) => ({ ...user }));
    this.templates = new Map([...templates.entries()].map(([id, row]) => [id, { ...row }]));
    this.auditLogs = [];
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql, bindings) {
    if (sql.includes('FROM admins WHERE id = ?')) {
      return this.adminsById.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM templates WHERE id = ? LIMIT 1')) {
      return this.templates.get(bindings[0]) ?? null;
    }

    if (sql.includes('SELECT * FROM templates WHERE target_type = ? AND enabled = 1')) {
      const targetType = bindings[0];
      const candidates = [...this.templates.values()]
        .filter((template) => template.target_type === targetType && template.enabled === 1)
        .sort((left, right) => {
          const leftKey = `${left.is_default}-${left.version}-${left.created_at}`;
          const rightKey = `${right.is_default}-${right.version}-${right.created_at}`;
          return leftKey < rightKey ? 1 : -1;
        });

      return candidates[0] ?? null;
    }

    throw new Error(`Unexpected first query in template route test: ${sql}`);
  }

  async all(sql) {
    if (sql.includes('SELECT id, token FROM users')) {
      return this.users;
    }

    throw new Error(`Unexpected all query in template route test: ${sql}`);
  }

  async run(sql, bindings) {
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

    if (sql.startsWith('UPDATE templates SET name = ?, content = ?, version = ?, is_default = ?, enabled = ?, updated_at = ? WHERE id = ?')) {
      const [name, content, version, isDefault, enabled, updatedAt, id] = bindings;
      const template = this.templates.get(id);

      if (template) {
        template.name = name;
        template.content = content;
        template.version = version;
        template.is_default = isDefault;
        template.enabled = enabled;
        template.updated_at = updatedAt;
      }

      return { success: true };
    }

    if (sql.startsWith('DELETE FROM templates WHERE id = ?')) {
      const [id] = bindings;
      this.templates.delete(id);
      return { success: true };
    }

    if (sql.startsWith('INSERT INTO audit_logs')) {
      this.auditLogs.push(bindings);
      return { success: true };
    }

    throw new Error(`Unexpected run query in template route test: ${sql}`);
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

async function createRouteHarness() {
  const admin = createAdminRow();
  const env = {
    ASSETS: {
      async fetch() {
        throw new Error('ASSETS.fetch should not be called in template route tests');
      }
    },
    DB: new MockDatabase({
      adminsById: [[admin.id, admin]],
      users: [{ id: 'usr_1', token: 'tok_1' }],
      templates: new Map([
        ['tpl_default', createTemplateRow('tpl_default', { is_default: 1, version: 1 })],
        ['tpl_alt', createTemplateRow('tpl_alt', { is_default: 0, version: 2 })],
        ['tpl_other', createTemplateRow('tpl_other', { target_type: 'singbox', is_default: 1 })]
      ])
    }),
    SUB_CACHE: new MockKvNamespace(),
    ADMIN_JWT_SECRET: 'route-test-secret',
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

async function requestJson(url, init, env) {
  const response = await worker.fetch(new Request(url, init), env);
  return {
    response,
    payload: await response.json()
  };
}

test('setting a new default template invalidates caches for that target', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_alt/set-default',
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
  assert.equal(payload.data.id, 'tpl_alt');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v2:mihomo:tok_1',
    'preview:v2:mihomo:usr_1'
  ]);
});

test('updating the currently effective template invalidates target caches', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_default',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}\n# updated'
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v2:mihomo:tok_1',
    'preview:v2:mihomo:usr_1'
  ]);
});

test('disabling the current default template clears its default flag and invalidates target caches', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_default',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
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
  assert.equal(payload.data.id, 'tpl_default');
  assert.equal(payload.data.isDefault, false);
  assert.equal(payload.data.status, 'disabled');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v2:mihomo:tok_1',
    'preview:v2:mihomo:usr_1'
  ]);
  assert.equal(env.DB.auditLogs.length, 1);
  assert.equal(env.DB.templates.get('tpl_default').enabled, 0);
  assert.equal(env.DB.templates.get('tpl_default').is_default, 0);
});

test('updating a non-effective template does not invalidate caches', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_alt',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Alt Template Renamed'
      })
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
});

test('updating a template rejects non-positive versions', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_default',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        version: 0
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'version must be a positive integer');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.auditLogs.length, 0);
});

test('updating a template rejects marking it default while disabled', async () => {
  const { env, token } = await createRouteHarness();
  env.DB.templates.set('tpl_disabled', createTemplateRow('tpl_disabled', { enabled: 0, is_default: 0 }));

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_disabled',
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        isDefault: true
      })
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'default template must be enabled');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.auditLogs.length, 0);
  assert.equal(env.DB.templates.get('tpl_disabled').is_default, 0);
});

test('setting a missing default template returns 404', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_missing/set-default',
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
  assert.equal(payload.error.message, 'template not found');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.auditLogs.length, 0);
});

test('setting a disabled template as default returns 400', async () => {
  const { env, token } = await createRouteHarness();
  env.DB.templates.set('tpl_disabled', createTemplateRow('tpl_disabled', { enabled: 0, is_default: 0 }));

  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_disabled/set-default',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'VALIDATION_FAILED');
  assert.equal(payload.error.message, 'default template must be enabled');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.auditLogs.length, 0);
  assert.equal(env.DB.templates.get('tpl_disabled').is_default, 0);
});

test('deleting the currently effective template invalidates target caches', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_default',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(env.SUB_CACHE.deletedKeys, [
    'sub:v2:mihomo:tok_1',
    'preview:v2:mihomo:usr_1'
  ]);
});

test('deleting a missing template returns 404', async () => {
  const { env, token } = await createRouteHarness();
  const { response, payload } = await requestJson(
    'http://127.0.0.1:8787/api/templates/tpl_missing',
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`
      }
    },
    env
  );

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NOT_FOUND');
  assert.equal(payload.error.message, 'template not found');
  assert.deepEqual(env.SUB_CACHE.deletedKeys, []);
  assert.equal(env.DB.auditLogs.length, 0);
});
