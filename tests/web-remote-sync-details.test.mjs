import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  getRemoteSyncDetailEntries,
  getRemoteSyncDetailReason,
  getRemoteSyncIssueCount
} = await loadTsModule('apps/web/src/remote-sync-details.ts');

test('remote sync details exposes preferred entries and readable reason text', () => {
  const entries = getRemoteSyncDetailEntries({
    details: {
      scope: 'fetch',
      stage: 'download',
      reason: 'upstream returned 502',
      upstreamStatus: 502,
      durationMs: 180,
      issueCount: 2,
      customField: {
        retryable: true
      }
    }
  });

  assert.deepEqual(entries, [
    { label: '范围', value: 'fetch' },
    { label: '阶段', value: 'download' },
    { label: '原因', value: 'upstream returned 502' },
    { label: '上游状态', value: '502' },
    { label: '耗时 ms', value: '180' },
    { label: '问题数', value: '2' },
    { label: 'customField', value: '{"retryable":true}' }
  ]);
  assert.equal(
    getRemoteSyncDetailReason({
      details: {
        reason: 'upstream returned 502'
      }
    }),
    'upstream returned 502'
  );
  assert.equal(
    getRemoteSyncIssueCount({
      details: {
        issueCount: 2
      }
    }),
    2
  );
});

test('remote sync details also read persisted source details and fallback issue length', () => {
  assert.equal(
    getRemoteSyncDetailReason({
      lastSyncDetails: {
        errorCode: 'SYNC_TIMEOUT'
      }
    }),
    'SYNC_TIMEOUT'
  );

  assert.equal(
    getRemoteSyncIssueCount({
      lastSyncDetails: {
        issues: [
          { message: 'one' },
          { message: 'two' },
          { message: 'three' }
        ]
      }
    }),
    3
  );

  assert.deepEqual(getRemoteSyncDetailEntries(null), []);
});
