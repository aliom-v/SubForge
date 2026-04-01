import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const { getRemoteSyncNodeChainDiagnostics } = await loadTsModule(
  'apps/web/src/remote-sync-diagnostics.ts'
);

test('remote sync diagnostics extracts node-chain issues from sync details', () => {
  const diagnostics = getRemoteSyncNodeChainDiagnostics({
    details: {
      scope: 'node_chain',
      operation: 'remote_subscription_source.sync',
      issueCount: 1,
      issues: [
        {
          nodeId: 'node_remote_01',
          nodeName: 'Remote Broken',
          kind: 'missing_reference',
          message: '缺少上游节点或代理组：Transit Missing',
          reference: 'Transit Missing',
          chain: 'Remote Broken -> Transit Missing',
          upstreamProxy: 'Transit Missing'
        }
      ]
    }
  });

  assert.deepEqual(diagnostics, {
    operation: 'remote_subscription_source.sync',
    issueCount: 1,
    issues: [
      {
        nodeId: 'node_remote_01',
        nodeName: 'Remote Broken',
        kind: 'missing_reference',
        message: '缺少上游节点或代理组：Transit Missing',
        reference: 'Transit Missing',
        chain: 'Remote Broken -> Transit Missing',
        upstreamProxy: 'Transit Missing'
      }
    ]
  });
});

test('remote sync diagnostics ignores non node-chain details and malformed issues', () => {
  assert.equal(
    getRemoteSyncNodeChainDiagnostics({
      details: {
        scope: 'fetch',
        issues: []
      }
    }),
    null
  );

  assert.equal(
    getRemoteSyncNodeChainDiagnostics({
      details: {
        scope: 'node_chain',
        issues: [{ message: 'missing fields' }]
      }
    }),
    null
  );
});

test('remote sync diagnostics also reads persisted source details', () => {
  const diagnostics = getRemoteSyncNodeChainDiagnostics({
    lastSyncDetails: {
      scope: 'node_chain',
      operation: 'remote_subscription_source.sync',
      issueCount: 1,
      issues: [
        {
          nodeId: 'node_remote_02',
          nodeName: 'Persisted Broken',
          kind: 'disabled_upstream',
          message: '上游节点已禁用：Transit Disabled',
          reference: 'Transit Disabled',
          chain: 'Persisted Broken -> Transit Disabled',
          upstreamProxy: 'Transit Disabled'
        }
      ]
    }
  });

  assert.equal(diagnostics?.issues[0]?.nodeName, 'Persisted Broken');
  assert.equal(diagnostics?.issues[0]?.kind, 'disabled_upstream');
  assert.equal(diagnostics?.issues[0]?.reference, 'Transit Disabled');
});
