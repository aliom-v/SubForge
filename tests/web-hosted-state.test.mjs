import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  AUTO_HOSTED_USER_NAME,
  AUTO_HOSTED_USER_REMARK,
  RESTORED_HOSTED_STATE_LABEL,
  getHostedSubscriptionSyncStatus,
  resolveCurrentHostedSubscriptionResult
} = await loadTsModule('apps/web/src/hosted-state.ts');

function createHostedUser(overrides = {}) {
  return {
    id: 'usr_hosted',
    name: AUTO_HOSTED_USER_NAME,
    token: 'tok_hosted',
    status: 'active',
    remark: AUTO_HOSTED_USER_REMARK,
    createdAt: '2026-03-30T00:00:00.000Z',
    ...overrides
  };
}

function createNode(id, enabled) {
  return {
    id,
    name: `Node ${id}`,
    protocol: 'vless',
    server: `${id}.example.com`,
    port: 443,
    sourceType: 'manual',
    enabled,
    createdAt: '2026-03-30T00:00:00.000Z'
  };
}

test('hosted state resolver rebuilds current hosted URLs from saved resources and bindings', async () => {
  const previewCalls = [];
  const result = await resolveCurrentHostedSubscriptionResult({
    resources: {
      users: [createHostedUser()],
      nodes: [createNode('node_enabled', true), createNode('node_disabled', false)]
    },
    fetchUserNodeBindings: async () => [
      {
        id: 'bind_enabled',
        userId: 'usr_hosted',
        nodeId: 'node_enabled',
        enabled: true,
        createdAt: '2026-03-30T00:00:00.000Z'
      },
      {
        id: 'bind_disabled',
        userId: 'usr_hosted',
        nodeId: 'node_disabled',
        enabled: true,
        createdAt: '2026-03-30T00:00:00.000Z'
      }
    ],
    fetchPreview: async (userId, target) => {
      previewCalls.push({ userId, target });
      return {
        cacheKey: `preview:${target}`,
        mimeType: 'text/plain; charset=utf-8',
        content: `${target}-content`,
        metadata: {
          userId,
          nodeCount: 1,
          ruleSetCount: 0,
          templateName: `Auto ${target}`
        }
      };
    },
    formatErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    origin: 'https://sub.example.com'
  });

  assert.ok(result);
  assert.equal(result.sourceLabel, RESTORED_HOSTED_STATE_LABEL);
  assert.equal(result.nodeCount, 1);
  assert.deepEqual(result.boundNodeIds, ['node_enabled']);
  assert.equal(result.userId, 'usr_hosted');
  assert.equal(result.token, 'tok_hosted');
  assert.deepEqual(previewCalls, [
    { userId: 'usr_hosted', target: 'mihomo' },
    { userId: 'usr_hosted', target: 'singbox' }
  ]);
  assert.deepEqual(
    result.targets.map((target) => ({ target: target.target, url: target.url, ok: target.ok, detail: target.detail })),
    [
      {
        target: 'mihomo',
        url: 'https://sub.example.com/s/tok_hosted/mihomo',
        ok: true,
        detail: '1 个节点，托管输出检查通过'
      },
      {
        target: 'singbox',
        url: 'https://sub.example.com/s/tok_hosted/singbox',
        ok: true,
        detail: '1 个节点，托管输出检查通过'
      }
    ]
  );
});

test('hosted state sync status reports when current enabled nodes are already hosted', () => {
  const status = getHostedSubscriptionSyncStatus(
    {
      userId: 'usr_hosted',
      userName: AUTO_HOSTED_USER_NAME,
      token: 'tok_hosted',
      sourceLabel: RESTORED_HOSTED_STATE_LABEL,
      nodeCount: 1,
      boundNodeIds: ['node_enabled'],
      targets: []
    },
    [createNode('node_enabled', true), createNode('node_disabled', false)]
  );

  assert.deepEqual(status, {
    kind: 'in_sync',
    detail: '当前启用节点与已托管绑定一致，可直接使用这组托管 URL。'
  });
});

test('hosted state sync status reports when current enabled nodes need regeneration', () => {
  const status = getHostedSubscriptionSyncStatus(
    {
      userId: 'usr_hosted',
      userName: AUTO_HOSTED_USER_NAME,
      token: 'tok_hosted',
      sourceLabel: RESTORED_HOSTED_STATE_LABEL,
      nodeCount: 1,
      boundNodeIds: ['node_old'],
      targets: []
    },
    [createNode('node_new', true)]
  );

  assert.deepEqual(status, {
    kind: 'out_of_sync',
    detail: '当前启用节点与已托管绑定不一致。若要让客户端拿到最新节点，请重新执行“使用当前启用节点生成托管 URL”。'
  });
});

test('hosted state resolver reports binding lookup failures without throwing away hosted URLs', async () => {
  let previewCallCount = 0;
  const result = await resolveCurrentHostedSubscriptionResult({
    resources: {
      users: [createHostedUser()],
      nodes: [createNode('node_enabled', true)]
    },
    fetchUserNodeBindings: async () => {
      throw new Error('bindings temporarily unavailable');
    },
    fetchPreview: async () => {
      previewCallCount += 1;
      throw new Error('preview should not run when bindings fail');
    },
    formatErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
    origin: 'https://sub.example.com'
  });

  assert.ok(result);
  assert.equal(result.nodeCount, 0);
  assert.equal(previewCallCount, 0);
  assert.deepEqual(
    result.targets.map((target) => ({ target: target.target, url: target.url, ok: target.ok, detail: target.detail })),
    [
      {
        target: 'mihomo',
        url: 'https://sub.example.com/s/tok_hosted/mihomo',
        ok: false,
        detail: '当前托管绑定读取失败：bindings temporarily unavailable'
      },
      {
        target: 'singbox',
        url: 'https://sub.example.com/s/tok_hosted/singbox',
        ok: false,
        detail: '当前托管绑定读取失败：bindings temporarily unavailable'
      }
    ]
  );
});
