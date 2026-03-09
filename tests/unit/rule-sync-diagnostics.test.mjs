import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuleSourceContentPreview,
  buildRuleSourceSyncDiagnostics
} from '../../apps/worker/src/rule-sync-diagnostics.ts';

test('buildRuleSourceContentPreview keeps first non-empty lines and truncates long content', () => {
  const preview = buildRuleSourceContentPreview(`\n\nline-1\nline-2\nline-3\nline-4\nline-5`, 3, 18);

  assert.equal(preview, 'line-1\nline-2\nlin…');
});

test('buildRuleSourceSyncDiagnostics returns parse guidance for unsupported json shape', () => {
  const diagnostics = buildRuleSourceSyncDiagnostics({
    errorCode: 'UNSUPPORTED_JSON_SHAPE',
    format: 'json',
    sourceShape: 'object:meta|items',
    content: JSON.stringify({ meta: { version: 1 }, items: [{ foo: 'bar' }] })
  });

  assert.equal(diagnostics.retryable, false);
  assert.match(diagnostics.operatorHint ?? '', /object:meta\|items/);
  assert.ok(Array.isArray(diagnostics.supportedShapes));
  assert.ok(diagnostics.supportedShapes.length >= 3);
  assert.match(diagnostics.contentPreview ?? '', /"meta"/);
});

test('buildRuleSourceSyncDiagnostics classifies upstream 503 as retryable', () => {
  const diagnostics = buildRuleSourceSyncDiagnostics({
    errorCode: 'UPSTREAM_HTTP_ERROR',
    format: 'yaml',
    upstreamStatus: 503
  });

  assert.equal(diagnostics.retryable, true);
  assert.match(diagnostics.operatorHint ?? '', /稍后重试/);
});
