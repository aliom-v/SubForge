import assert from 'node:assert/strict';
import test from 'node:test';

import { WEB_API_ROUTES } from '../apps/web/src/api-routes.js';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  AppApiError,
  APP_API_ERROR_CODES,
  deleteNode,
  deleteRuleSource,
  deleteTemplate,
  deleteUser,
  fetchSetupStatus,
  isAppApiError,
  previewNodeImportFromUrl
} = await loadTsModule('apps/web/src/api.ts');

async function withMockFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('web api client preserves structured backend errors', async () => {
  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'internal server error',
            details: {
              traceId: 'cf-demo'
            }
          }
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        }
      ),
    async () => {
      await assert.rejects(fetchSetupStatus(), (error) => {
        assert.equal(error instanceof AppApiError, true);
        assert.equal(isAppApiError(error), true);
        assert.equal(error.code, 'INTERNAL_ERROR');
        assert.equal(error.status, 500);
        assert.equal(error.message, 'internal server error');
        assert.deepEqual(error.details, { traceId: 'cf-demo' });
        return true;
      });
    }
  );
});

test('web api client wraps non-json error responses as INVALID_RESPONSE', async () => {
  await withMockFetch(
    async () =>
      new Response('<html><body>bad gateway</body></html>', {
        status: 502,
        headers: {
          'content-type': 'text/html; charset=utf-8'
        }
      }),
    async () => {
      await assert.rejects(fetchSetupStatus(), (error) => {
        assert.equal(error instanceof AppApiError, true);
        assert.equal(error.code, APP_API_ERROR_CODES.invalidResponse);
        assert.equal(error.status, 502);
        assert.equal(error.message, 'server returned an invalid response');
        assert.equal(error.details.contentType, 'text/html; charset=utf-8');
        assert.match(error.details.bodyPreview, /bad gateway/i);
        return true;
      });
    }
  );
});

test('web api client wraps network failures as NETWORK_ERROR', async () => {
  await withMockFetch(
    async () => {
      throw new TypeError('fetch failed');
    },
    async () => {
      await assert.rejects(fetchSetupStatus(), (error) => {
        assert.equal(error instanceof AppApiError, true);
        assert.equal(error.code, APP_API_ERROR_CODES.networkError);
        assert.equal(error.status, undefined);
        assert.equal(error.message, 'network request failed');
        assert.equal(error.cause instanceof TypeError, true);
        return true;
      });
    }
  );
});

test('web api client uses centralized route definitions for preview and delete operations', async () => {
  const calls = [];

  await withMockFetch(
    async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init.headers ?? {});
      const method = init.method ?? 'GET';
      const pathname = new URL(url, 'http://localhost').pathname;

      calls.push({
        url,
        pathname,
        method,
        authorization: headers.get('authorization'),
        body: typeof init.body === 'string' ? init.body : null
      });

      let data;

      if (pathname === WEB_API_ROUTES.previewNodeImport.buildPath()) {
        data = {
          sourceUrl: 'https://example.com/sub.txt',
          upstreamStatus: 200,
          durationMs: 143,
          fetchedBytes: 512,
          lineCount: 2,
          contentEncoding: 'plain_text',
          nodes: [],
          errors: []
        };
      } else if (pathname === WEB_API_ROUTES.deleteUser.buildPath('user_demo')) {
        data = { deleted: true, userId: 'user_demo' };
      } else if (pathname === WEB_API_ROUTES.deleteNode.buildPath('node_demo')) {
        data = { deleted: true, nodeId: 'node_demo' };
      } else if (pathname === WEB_API_ROUTES.deleteTemplate.buildPath('tpl_demo')) {
        data = { deleted: true, templateId: 'tpl_demo' };
      } else if (pathname === WEB_API_ROUTES.deleteRuleSource.buildPath('rs_demo')) {
        data = { deleted: true, ruleSourceId: 'rs_demo' };
      } else {
        throw new Error(`unexpected request ${method} ${pathname}`);
      }

      return new Response(JSON.stringify({ ok: true, data }), {
        headers: {
          'content-type': 'application/json; charset=utf-8'
        }
      });
    },
    async () => {
      await previewNodeImportFromUrl('demo-token', 'https://example.com/sub.txt');
      await deleteUser('demo-token', 'user_demo');
      await deleteNode('demo-token', 'node_demo');
      await deleteTemplate('demo-token', 'tpl_demo');
      await deleteRuleSource('demo-token', 'rs_demo');
    }
  );

  assert.deepEqual(
    calls.map(({ method, pathname }) => [method, pathname]),
    [
      [WEB_API_ROUTES.previewNodeImport.method, WEB_API_ROUTES.previewNodeImport.buildPath()],
      [WEB_API_ROUTES.deleteUser.method, WEB_API_ROUTES.deleteUser.buildPath('user_demo')],
      [WEB_API_ROUTES.deleteNode.method, WEB_API_ROUTES.deleteNode.buildPath('node_demo')],
      [WEB_API_ROUTES.deleteTemplate.method, WEB_API_ROUTES.deleteTemplate.buildPath('tpl_demo')],
      [WEB_API_ROUTES.deleteRuleSource.method, WEB_API_ROUTES.deleteRuleSource.buildPath('rs_demo')]
    ]
  );

  assert.deepEqual(calls.map(({ authorization }) => authorization), Array(5).fill('Bearer demo-token'));
  assert.equal(calls[0].body, JSON.stringify({ sourceUrl: 'https://example.com/sub.txt' }));
  assert.equal(calls[1].body, null);
  assert.equal(calls[2].body, null);
  assert.equal(calls[3].body, null);
  assert.equal(calls[4].body, null);
});
