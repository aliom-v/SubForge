import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { sanitizeAuditPayload } = await loadTsModule('apps/worker/src/audit.ts');

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
