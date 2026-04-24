import assert from 'node:assert/strict';
import test from 'node:test';

import { WEB_API_ROUTES } from '../apps/web/src/api-routes.js';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  AppApiError,
  APP_API_ERROR_CODES,
  createRemoteSubscriptionSource,
  deleteNode,
  fetchSetupStatus,
  fetchPreview,
  isAppApiError,
  mutateNodesBatch,
  previewNodeImportFromUrl,
  resetHostedSubscriptionToken,
  syncRemoteSubscriptionSource
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

test('web api client uses centralized route definitions for active single-user operations', async () => {
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
      } else if (pathname === WEB_API_ROUTES.batchNodes.buildPath()) {
        data = {
          action: 'set_enabled',
          nodeIds: ['node_demo', 'node_demo_2'],
          enabled: false,
          affectedCount: 2,
          changedCount: 2
        };
      } else if (pathname === WEB_API_ROUTES.deleteNode.buildPath('node_demo')) {
        data = { deleted: true, nodeId: 'node_demo' };
      } else if (pathname === WEB_API_ROUTES.createRemoteSubscriptionSource.buildPath()) {
        data = {
          id: 'src_demo',
          name: '上游订阅',
          sourceUrl: 'https://example.com/sub.txt',
          enabled: true,
          createdAt: '2026-03-30T00:00:00.000Z',
          updatedAt: '2026-03-31T00:00:00.000Z'
        };
      } else if (pathname === WEB_API_ROUTES.syncRemoteSubscriptionSource.buildPath('src_demo')) {
        data = {
          sourceId: 'src_demo',
          sourceName: '上游订阅',
          sourceUrl: 'https://example.com/sub.txt',
          status: 'success',
          message: 'sync finished',
          changed: true,
          importedAt: '2026-03-31T00:00:00.000Z',
          importedCount: 3,
          createdCount: 2,
          updatedCount: 1,
          unchangedCount: 0,
          duplicateCount: 0,
          disabledCount: 0,
          errorCount: 0,
          lineCount: 3,
          contentEncoding: 'plain_text'
        };
      } else if (pathname === WEB_API_ROUTES.fetchPreview.buildPath('user_demo', 'mihomo')) {
        data = {
          cacheKey: 'preview:user_demo:mihomo',
          mimeType: 'text/yaml',
          content: 'proxies: []',
          metadata: {
            userId: 'user_demo',
            nodeCount: 2,
            templateName: 'auto-mihomo'
          }
        };
      } else if (pathname === WEB_API_ROUTES.resetHostedSubscriptionToken.buildPath()) {
        data = {
          id: 'usr_hosted',
          name: '个人托管订阅',
          token: 'tok_hosted_next',
          status: 'active',
          remark: 'subforge:auto-hosted',
          createdAt: '2026-03-30T00:00:00.000Z',
          updatedAt: '2026-03-31T00:00:00.000Z'
        };
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
      await mutateNodesBatch('demo-token', {
        action: 'set_enabled',
        nodeIds: ['node_demo', 'node_demo_2'],
        enabled: false
      });
      await deleteNode('demo-token', 'node_demo');
      await createRemoteSubscriptionSource('demo-token', {
        name: '上游订阅',
        sourceUrl: 'https://example.com/sub.txt',
        enabled: true
      });
      await syncRemoteSubscriptionSource('demo-token', 'src_demo');
      await fetchPreview('demo-token', 'user_demo', 'mihomo');
      await resetHostedSubscriptionToken('demo-token');
    }
  );

  assert.deepEqual(
    calls.map(({ method, pathname }) => [method, pathname]),
    [
      [WEB_API_ROUTES.previewNodeImport.method, WEB_API_ROUTES.previewNodeImport.buildPath()],
      [WEB_API_ROUTES.batchNodes.method, WEB_API_ROUTES.batchNodes.buildPath()],
      [WEB_API_ROUTES.deleteNode.method, WEB_API_ROUTES.deleteNode.buildPath('node_demo')],
      [WEB_API_ROUTES.createRemoteSubscriptionSource.method, WEB_API_ROUTES.createRemoteSubscriptionSource.buildPath()],
      [WEB_API_ROUTES.syncRemoteSubscriptionSource.method, WEB_API_ROUTES.syncRemoteSubscriptionSource.buildPath('src_demo')],
      [WEB_API_ROUTES.fetchPreview.method, WEB_API_ROUTES.fetchPreview.buildPath('user_demo', 'mihomo')],
      [WEB_API_ROUTES.resetHostedSubscriptionToken.method, WEB_API_ROUTES.resetHostedSubscriptionToken.buildPath()]
    ]
  );

  assert.deepEqual(calls.map(({ authorization }) => authorization), Array(7).fill('Bearer demo-token'));
  assert.equal(calls[0].body, JSON.stringify({ sourceUrl: 'https://example.com/sub.txt' }));
  assert.equal(
    calls[1].body,
    JSON.stringify({
      action: 'set_enabled',
      nodeIds: ['node_demo', 'node_demo_2'],
      enabled: false
    })
  );
  assert.equal(
    calls[2].body,
    null
  );
  assert.equal(
    calls[3].body,
    JSON.stringify({
      name: '上游订阅',
      sourceUrl: 'https://example.com/sub.txt',
      enabled: true
    })
  );
  assert.equal(calls[4].body, null);
  assert.equal(calls[5].body, null);
  assert.equal(calls[6].body, null);
});
