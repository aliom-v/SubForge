import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  buildConfigImportSuccessMessage,
  buildHostedGenerationSuccessMessage,
  buildNodeImportSuccessMessage,
  buildRemotePreviewMessage,
  buildRemoteSubscriptionSourceSaveMessage,
  buildRemoteSubscriptionSourceSyncMessage,
  getHostedSyncStatusLabel,
  mapImportedNodesToNodeImportInput
} = await loadTsModule('apps/web/src/workflow-feedback.ts');

test('workflow feedback maps imported nodes into node import payloads', () => {
  const result = mapImportedNodesToNodeImportInput([
    {
      name: 'HK Edge',
      protocol: 'vless',
      server: 'hk.example.com',
      port: 443,
      credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
      params: { tls: true },
      source: 'vless://demo'
    }
  ]);

  assert.deepEqual(result, [
    {
      name: 'HK Edge',
      protocol: 'vless',
      server: 'hk.example.com',
      port: 443,
      credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
      params: { tls: true }
    }
  ]);
});

test('workflow feedback builds node import and config import success messages', () => {
  const baseResult = {
    importedCount: 3,
    importedAt: '2026-03-30T00:00:00.000Z',
    createdCount: 1,
    updatedCount: 1,
    duplicateCount: 1
  };

  assert.equal(
    buildNodeImportSuccessMessage(baseResult, 2),
    '已处理 3 个节点（新增 1 / 更新 1 / 去重 1），另有 2 条解析失败未导入，已导入到节点列表；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”'
  );
  assert.equal(
    buildConfigImportSuccessMessage(baseResult, 0),
    '已处理 3 个节点（新增 1 / 更新 1 / 去重 1），并已更新自动托管模板骨架；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”'
  );
});

test('workflow feedback builds remote preview summary message', () => {
  assert.equal(
    buildRemotePreviewMessage({
      sourceUrl: 'https://example.com/sub.txt',
      upstreamStatus: 200,
      durationMs: 120,
      fetchedBytes: 256,
      lineCount: 3,
      contentEncoding: 'plain_text',
      nodes: [{ name: 'HK Edge', protocol: 'vless', server: 'hk.example.com', port: 443, credentials: null, params: null, source: 'demo' }],
      errors: ['bad line']
    }),
    '远程订阅已抓取，可导入 1 个节点，另有 1 条解析失败'
  );
  assert.equal(
    buildRemotePreviewMessage({
      sourceUrl: 'https://example.com/sub.txt',
      upstreamStatus: 200,
      durationMs: 120,
      fetchedBytes: 256,
      lineCount: 0,
      contentEncoding: 'plain_text',
      nodes: [],
      errors: []
    }),
    '远程订阅已抓取，但当前没有解析出可导入节点'
  );
});

test('workflow feedback builds remote subscription save and sync messages', () => {
  const syncResult = {
    sourceId: 'rss_demo',
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

  assert.equal(
    buildRemoteSubscriptionSourceSaveMessage(syncResult),
    '自动同步源已保存并完成首次同步（新增 1 / 更新 1 / 禁用 1）。如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”'
  );
  assert.equal(
    buildRemoteSubscriptionSourceSyncMessage(syncResult),
    '自动同步已完成（新增 1 / 更新 1 / 禁用 1）'
  );
  assert.equal(
    buildRemoteSubscriptionSourceSaveMessage({ ...syncResult, changed: false }),
    '自动同步源已保存，当前共 3 个节点。如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”'
  );
  assert.equal(
    buildRemoteSubscriptionSourceSyncMessage({ ...syncResult, changed: false }),
    '自动同步无变化，共 3 个节点'
  );
  assert.equal(
    buildRemoteSubscriptionSourceSaveMessage({ ...syncResult, status: 'failed', message: 'upstream content is empty' }),
    '自动同步源已保存，但首次同步失败：upstream content is empty'
  );
});

test('workflow feedback builds hosted generation success message and status labels', () => {
  assert.equal(
    buildHostedGenerationSuccessMessage({
      userId: 'usr_hosted',
      userName: '个人托管订阅',
      token: 'tok_hosted',
      sourceLabel: '当前启用节点',
      nodeCount: 2,
      boundNodeIds: ['node_a', 'node_b'],
      targets: [
        { target: 'mihomo', url: 'https://sub.example.com/s/tok_hosted/mihomo', ok: true, detail: '2 个节点，托管输出检查通过' },
        { target: 'singbox', url: 'https://sub.example.com/s/tok_hosted/singbox', ok: false, detail: 'template missing' }
      ]
    }),
    '已按当前启用节点刷新托管 URL（2 个节点，1/2 个目标已通过预览校验）'
  );

  assert.equal(getHostedSyncStatusLabel({ kind: 'missing', detail: 'missing' }), '未生成');
  assert.equal(getHostedSyncStatusLabel({ kind: 'in_sync', detail: 'ok' }), '已同步');
  assert.equal(getHostedSyncStatusLabel({ kind: 'out_of_sync', detail: 'stale' }), '需要重新生成');
});
