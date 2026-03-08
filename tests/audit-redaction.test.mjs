import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { sanitizeAuditPayload } = await loadTsModule('apps/worker/src/audit.ts');
const { listAuditLogs } = await loadTsModule('apps/worker/src/repository.ts');

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
  constructor({ auditLogRows = [] } = {}) {
    this.auditLogRows = auditLogRows;
  }

  prepare(sql) {
    return new MockPreparedStatement(this, sql);
  }

  async first(sql) {
    throw new Error(`Unexpected first query in audit test: ${sql}`);
  }

  async all(sql) {
    if (sql.includes('FROM audit_logs') && sql.includes('LEFT JOIN admins')) {
      return this.auditLogRows;
    }

    throw new Error(`Unexpected all query in audit test: ${sql}`);
  }
}

test('sanitizeAuditPayload redacts sensitive keys in nested objects and arrays', () => {
  const payload = sanitizeAuditPayload({
    token: 'user-token',
    passwordHash: 'secret-hash',
    nested: {
      refreshToken: 'refresh-me',
      plain: 'keep-me'
    },
    headers: [
      {
        authorization: 'Bearer top-secret'
      },
      {
        note: 'safe'
      }
    ],
    remark: 'visible'
  });

  assert.deepEqual(payload, {
    token: '[REDACTED]',
    passwordHash: '[REDACTED]',
    nested: {
      refreshToken: '[REDACTED]',
      plain: 'keep-me'
    },
    headers: [
      {
        authorization: '[REDACTED]'
      },
      {
        note: 'safe'
      }
    ],
    remark: 'visible'
  });
});

test('sanitizeAuditPayload preserves non-secret boolean flags even when keys include token words', () => {
  const payload = sanitizeAuditPayload({
    tokenReset: true,
    previousTokenRedacted: true,
    currentTokenRedacted: false,
    nested: {
      refreshToken: 'refresh-me',
      tokenValid: true
    }
  });

  assert.deepEqual(payload, {
    tokenReset: true,
    previousTokenRedacted: true,
    currentTokenRedacted: false,
    nested: {
      refreshToken: '[REDACTED]',
      tokenValid: true
    }
  });
});

test('listAuditLogs re-sanitizes payloads loaded from historical audit rows', async () => {
  const db = new MockDatabase({
    auditLogRows: [
      {
        id: 'audit_1',
        actor_admin_id: 'adm_1',
        actor_admin_username: 'admin',
        action: 'user.reset_token',
        target_type: 'user',
        target_id: 'usr_1',
        payload_json: JSON.stringify({
          token: 'raw-token',
          tokenReset: true,
          nested: {
            password: 'raw-password'
          },
          items: [
            {
              authorization: 'Bearer raw'
            }
          ],
          safe: 'visible'
        }),
        created_at: '2026-03-08T00:00:00.000Z'
      }
    ]
  });

  const logs = await listAuditLogs(db);

  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorAdminUsername, 'admin');
  assert.equal(logs[0].action, 'user.reset_token');
  assert.deepEqual(logs[0].payload, {
    token: '[REDACTED]',
    tokenReset: true,
    nested: {
      password: '[REDACTED]'
    },
    items: [
      {
        authorization: '[REDACTED]'
      }
    ],
    safe: 'visible'
  });
});
