import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const { AppApiError, APP_API_ERROR_CODES } = await loadTsModule('apps/web/src/api.ts');
const { getErrorMessage, shouldClearProtectedSession } = await loadTsModule('apps/web/src/error-handling.ts');

test('protected session helper clears only auth failures from protected APIs', () => {
  const unauthorizedError = new AppApiError({
    code: 'UNAUTHORIZED',
    message: 'invalid admin session token',
    status: 401
  });
  const forbiddenError = new AppApiError({
    code: 'FORBIDDEN',
    message: 'admin account is unavailable',
    status: 403
  });
  const internalError = new AppApiError({
    code: 'INTERNAL_ERROR',
    message: 'internal server error',
    status: 500
  });

  assert.equal(shouldClearProtectedSession(unauthorizedError), true);
  assert.equal(shouldClearProtectedSession(forbiddenError), true);
  assert.equal(shouldClearProtectedSession(internalError), false);
  assert.equal(shouldClearProtectedSession(new Error('boom')), false);
});

test('protected session helper preserves user-facing error messages', () => {
  const networkError = new AppApiError({
    code: APP_API_ERROR_CODES.networkError,
    message: 'network request failed'
  });
  const invalidResponseError = new AppApiError({
    code: APP_API_ERROR_CODES.invalidResponse,
    message: 'server returned an invalid response',
    status: 502
  });
  const unauthorizedError = new AppApiError({
    code: 'UNAUTHORIZED',
    message: 'admin session has been revoked',
    status: 401
  });

  assert.equal(getErrorMessage(networkError), '网络请求失败，请稍后重试');
  assert.equal(getErrorMessage(invalidResponseError), '服务返回了不可识别的响应');
  assert.equal(getErrorMessage(unauthorizedError), 'admin session has been revoked');
  assert.equal(getErrorMessage(new Error('plain error')), 'plain error');
  assert.equal(getErrorMessage('unknown'), '发生未知错误');
});
