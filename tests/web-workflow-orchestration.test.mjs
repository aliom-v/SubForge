import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  runConfigImportWorkflow,
  runHostedGenerationWorkflow,
  runNodeImportWorkflow,
  runRemoteSubscriptionSourceSaveWorkflow
} = await loadTsModule('apps/web/src/workflow-orchestration.ts');

test('workflow orchestration imports parsed nodes, refreshes resources, and runs success cleanup after refresh', async () => {
  const calls = [];

  const outcome = await runNodeImportWorkflow({
    importedNodes: [
      {
        name: 'HK Edge',
        protocol: 'vless',
        server: 'hk.example.com',
        port: 443,
        credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
        params: { tls: true },
        source: 'vless://demo'
      }
    ],
    errorCount: 1,
    importNodes: async (nodes) => {
      calls.push(['importNodes', nodes]);
      return {
        importedCount: 1,
        importedAt: '2026-03-30T00:00:00.000Z',
        createdCount: 1,
        updatedCount: 0,
        duplicateCount: 0
      };
    },
    refreshResources: async () => {
      calls.push(['refreshResources']);
    },
    onImported: async () => {
      calls.push(['onImported']);
    }
  });

  assert.deepEqual(calls, [
    [
      'importNodes',
      [
        {
          name: 'HK Edge',
          protocol: 'vless',
          server: 'hk.example.com',
          port: 443,
          credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
          params: { tls: true }
        }
      ]
    ],
    ['refreshResources'],
    ['onImported']
  ]);
  assert.equal(
    outcome.message,
    '已处理 1 个节点（新增 1 / 更新 0 / 去重 0），另有 1 条解析失败未导入，已导入到节点列表；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”'
  );
});

test('workflow orchestration rejects empty parsed node imports', async () => {
  await assert.rejects(
    () =>
      runNodeImportWorkflow({
        importedNodes: [],
        errorCount: 0,
        importNodes: async () => ({
          importedCount: 0,
          importedAt: '2026-03-30T00:00:00.000Z'
        }),
        refreshResources: async () => {}
      }),
    /没有可导入的节点/
  );
});

test('workflow orchestration imports full config, refreshes templates, and refreshes again after template maintenance', async () => {
  const calls = [];
  const parsedConfigImport = {
    format: 'mihomo_yaml',
    targetType: 'mihomo',
    nodes: [
      {
        name: 'HK Config',
        protocol: 'trojan',
        server: 'trojan.example.com',
        port: 443,
        credentials: { password: 'replace-me' },
        params: { sni: 'sub.example.com' },
        source: 'trojan://demo'
      }
    ],
    templateContent: 'proxies:\n{{proxies}}',
    suggestedTemplateName: 'Imported Mihomo Config',
    errors: ['line 2'],
    warnings: ['warning 1']
  };

  const outcome = await runConfigImportWorkflow({
    parsedConfigImport,
    importNodes: async (nodes) => {
      calls.push(['importNodes', nodes]);
      return {
        importedCount: 1,
        importedAt: '2026-03-30T00:00:00.000Z',
        createdCount: 1,
        updatedCount: 0,
        duplicateCount: 0
      };
    },
    refreshResources: async () => {
      const templates = [{ id: 'tpl_mihomo_auto' }];
      calls.push(['refreshResources', templates]);
      return { templates };
    },
    ensureAutoHostedTemplates: async (templates, importedConfig) => {
      calls.push(['ensureAutoHostedTemplates', templates, importedConfig]);
    }
  });

  assert.deepEqual(calls, [
    [
      'importNodes',
      [
        {
          name: 'HK Config',
          protocol: 'trojan',
          server: 'trojan.example.com',
          port: 443,
          credentials: { password: 'replace-me' },
          params: { sni: 'sub.example.com' }
        }
      ]
    ],
    ['refreshResources', [{ id: 'tpl_mihomo_auto' }]],
    ['ensureAutoHostedTemplates', [{ id: 'tpl_mihomo_auto' }], parsedConfigImport],
    ['refreshResources', [{ id: 'tpl_mihomo_auto' }]]
  ]);
  assert.equal(
    outcome.message,
    '已处理 1 个节点（新增 1 / 更新 0 / 去重 0），另有 1 条解析失败未导入，并已更新自动托管模板骨架；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”'
  );
});

test('workflow orchestration saves remote subscription source, runs first sync, and refreshes resources', async () => {
  const calls = [];

  const outcome = await runRemoteSubscriptionSourceSaveWorkflow({
    sourceName: 'Demo Source',
    sourceUrl: 'https://example.com/sub.txt',
    createRemoteSubscriptionSource: async (input) => {
      calls.push(['createRemoteSubscriptionSource', input]);
      return { id: 'rss_demo' };
    },
    syncRemoteSubscriptionSource: async (sourceId) => {
      calls.push(['syncRemoteSubscriptionSource', sourceId]);
      return {
        sourceId,
        sourceName: 'Demo Source',
        sourceUrl: 'https://example.com/sub.txt',
        status: 'success',
        message: 'subscription updated (3 nodes)',
        changed: true,
        importedAt: '2026-03-30T00:00:00.000Z',
        importedCount: 3,
        createdCount: 1,
        updatedCount: 1,
        unchangedCount: 1,
        duplicateCount: 0,
        disabledCount: 1,
        errorCount: 0,
        lineCount: 3
      };
    },
    refreshResources: async () => {
      calls.push(['refreshResources']);
    }
  });

  assert.deepEqual(calls, [
    ['createRemoteSubscriptionSource', { name: 'Demo Source', sourceUrl: 'https://example.com/sub.txt' }],
    ['syncRemoteSubscriptionSource', 'rss_demo'],
    ['refreshResources']
  ]);
  assert.equal(
    outcome.message,
    '自动同步源已保存并完成首次同步（新增 1 / 更新 1 / 禁用 1）。如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”'
  );
});

test('workflow orchestration generates hosted subscriptions from enabled nodes and refreshes after binding', async () => {
  const calls = [];
  const resources = { nodes: [{ id: 'node_disabled', enabled: false }, { id: 'node_enabled', enabled: true }] };

  const outcome = await runHostedGenerationWorkflow({
    currentResources: resources,
    nodeRecords: resources.nodes,
    ensureHostedSubscriptions: async (input) => {
      calls.push(['ensureHostedSubscriptions', input]);
      return {
        userId: 'usr_hosted',
        userName: '个人托管订阅',
        token: 'tok_hosted',
        sourceLabel: input.sourceLabel,
        nodeCount: input.nodeRecords.length,
        boundNodeIds: ['node_enabled'],
        targets: [
          { target: 'mihomo', url: 'https://sub.example.com/s/tok_hosted/mihomo', ok: true, detail: '1 个节点，托管输出检查通过' },
          { target: 'singbox', url: 'https://sub.example.com/s/tok_hosted/singbox', ok: true, detail: '1 个节点，托管输出检查通过' }
        ]
      };
    },
    refreshResources: async () => {
      calls.push(['refreshResources']);
    }
  });

  assert.deepEqual(calls, [
    [
      'ensureHostedSubscriptions',
      {
        currentResources: resources,
        sourceLabel: '当前启用节点',
        nodeRecords: [{ id: 'node_enabled', enabled: true }]
      }
    ],
    ['refreshResources']
  ]);
  assert.equal(outcome.hostedResult.nodeCount, 1);
  assert.equal(outcome.message, '已按当前启用节点刷新托管 URL（1 个节点，2/2 个目标已通过预览校验）');
});

test('workflow orchestration rejects hosted generation when there are no enabled nodes', async () => {
  await assert.rejects(
    () =>
      runHostedGenerationWorkflow({
        currentResources: { nodes: [] },
        nodeRecords: [{ id: 'node_disabled', enabled: false }],
        ensureHostedSubscriptions: async () => {
          throw new Error('should not run');
        },
        refreshResources: async () => {}
      }),
    /当前没有启用节点，无法生成托管订阅/
  );
});
