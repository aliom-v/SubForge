import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const { buildSingleUserWorkflowSteps, getWorkflowStepStatusLabel } = await loadTsModule(
  'apps/web/src/workflow-progress.ts'
);

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

test('workflow progress reports pending steps before any nodes are imported', () => {
  const steps = buildSingleUserWorkflowSteps({
    nodes: [],
    hostedSubscriptionSyncStatus: {
      kind: 'missing',
      detail: '当前还没有已保存的托管绑定。请先完成导入和调整，再执行“使用当前启用节点生成托管 URL”。'
    },
    hostedSubscriptionResult: null
  });

  assert.deepEqual(
    steps.map((step) => ({ id: step.id, status: step.status })),
    [
      { id: 'import', status: 'pending' },
      { id: 'adjust', status: 'pending' },
      { id: 'generate', status: 'pending' }
    ]
  );
});

test('workflow progress reports ready adjustment state and complete generation when hosted state is in sync', () => {
  const steps = buildSingleUserWorkflowSteps({
    nodes: [createNode('node_a', true), createNode('node_b', false)],
    hostedSubscriptionSyncStatus: {
      kind: 'in_sync',
      detail: '当前启用节点与已托管绑定一致，可直接使用这组托管 URL。'
    },
    hostedSubscriptionResult: {
      userId: 'usr_hosted',
      userName: '个人托管订阅',
      token: 'tok_hosted',
      sourceLabel: '当前已保存托管状态',
      nodeCount: 1,
      boundNodeIds: ['node_a'],
      targets: []
    }
  });

  assert.deepEqual(
    steps.map((step) => ({ id: step.id, status: step.status })),
    [
      { id: 'import', status: 'complete' },
      { id: 'adjust', status: 'ready' },
      { id: 'generate', status: 'complete' }
    ]
  );
});

test('workflow progress reports attention when nodes exist but none are enabled or hosted state is stale', () => {
  const steps = buildSingleUserWorkflowSteps({
    nodes: [createNode('node_a', false)],
    hostedSubscriptionSyncStatus: {
      kind: 'out_of_sync',
      detail: '当前启用节点与已托管绑定不一致。若要让客户端拿到最新节点，请重新执行“使用当前启用节点生成托管 URL”。'
    },
    hostedSubscriptionResult: {
      userId: 'usr_hosted',
      userName: '个人托管订阅',
      token: 'tok_hosted',
      sourceLabel: '当前已保存托管状态',
      nodeCount: 1,
      boundNodeIds: ['node_old'],
      targets: []
    }
  });

  assert.deepEqual(
    steps.map((step) => ({ id: step.id, status: step.status })),
    [
      { id: 'import', status: 'complete' },
      { id: 'adjust', status: 'attention' },
      { id: 'generate', status: 'attention' }
    ]
  );
});

test('workflow progress exposes stable labels for step statuses', () => {
  assert.equal(getWorkflowStepStatusLabel('pending'), '待开始');
  assert.equal(getWorkflowStepStatusLabel('ready'), '可继续');
  assert.equal(getWorkflowStepStatusLabel('complete'), '已完成');
  assert.equal(getWorkflowStepStatusLabel('attention'), '需处理');
});
