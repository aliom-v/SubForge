import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileSubscription,
  getBootstrapCacheKeyExamples,
  getBootstrapSubscriptionExamples,
  getServiceMetadata,
  getSupportedRendererTargets
} from '../../packages/core/src/index.ts';
import { APP_ERROR_CODES, buildSubscriptionCacheKey } from '../../packages/shared/src/index.ts';

function createBaseInput(target = 'mihomo') {
  return {
    target,
    user: {
      id: 'usr_demo',
      name: 'Demo User',
      token: 'demo-token',
      status: 'active'
    },
    nodes: [
      {
        id: 'node_enabled',
        name: 'HK Edge 01',
        protocol: 'vless',
        server: 'hk-01.example.com',
        port: 443,
        enabled: true,
        credentials: {
          uuid: '11111111-1111-1111-1111-111111111111'
        },
        params: {
          tls: true,
          network: 'ws'
        }
      },
      {
        id: 'node_disabled',
        name: 'Disabled Edge',
        protocol: 'trojan',
        server: 'disabled.example.com',
        port: 8443,
        enabled: false,
        credentials: {
          password: 'ignore-me'
        }
      }
    ],
    template:
      target === 'mihomo'
        ? {
            id: 'tpl_mihomo',
            name: 'Default Mihomo',
            target: 'mihomo',
            version: 1,
            isDefault: true,
            content: ['mixed-port: 7890', 'mode: rule', 'proxies:', '{{proxies}}', 'proxy-groups:', '{{proxy_groups}}', 'rules:', '{{rules}}'].join('\n')
          }
        : {
            id: 'tpl_singbox',
            name: 'Default Singbox',
            target: 'singbox',
            version: 1,
            isDefault: true,
            content: ['{', '  "outbounds": {{outbounds}},', '  "route": {', '    "rules": {{rules}}', '  }', '}'].join('\n')
          }
  };
}

test('bootstrap helpers expose supported targets and examples', () => {
  assert.deepEqual(getSupportedRendererTargets(), ['mihomo', 'singbox']);

  const metadata = getServiceMetadata();
  assert.equal(metadata.name, 'SubForge');
  assert.match(metadata.version, /^0\.1\.0/);

  const cacheKeys = getBootstrapCacheKeyExamples('demo-token');
  assert.equal(cacheKeys.mihomo, buildSubscriptionCacheKey('mihomo', 'demo-token'));
  assert.equal(cacheKeys.singbox, buildSubscriptionCacheKey('singbox', 'demo-token'));

  const examples = getBootstrapSubscriptionExamples();
  assert.match(examples.mihomo, /proxies:/);
  assert.match(examples.mihomo, /MATCH,DIRECT/);
  assert.match(examples.singbox, /"outbounds"/);
  assert.match(examples.singbox, /"rules"/);
});

test('compileSubscription renders mihomo output and filters disabled nodes', () => {
  const result = compileSubscription(createBaseInput('mihomo'));

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(result.data.mimeType, 'text/yaml; charset=utf-8');
  assert.equal(result.data.cacheKey, buildSubscriptionCacheKey('mihomo', 'demo-token'));
  assert.equal(result.data.metadata.nodeCount, 1);
  assert.equal(result.data.metadata.templateName, 'Default Mihomo');
  assert.match(result.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.data.content, /name: "HK Edge 01"/);
  assert.doesNotMatch(result.data.content, /Disabled Edge/);
  assert.match(result.data.content, /MATCH,DIRECT/);
});

test('compileSubscription renders singbox output as valid JSON', () => {
  const result = compileSubscription(createBaseInput('singbox'));

  assert.equal(result.ok, true);

  if (!result.ok) {
    return;
  }

  assert.equal(result.data.mimeType, 'application/json; charset=utf-8');

  const payload = JSON.parse(result.data.content);
  assert.equal(payload.outbounds.length, 1);
  assert.equal(payload.outbounds[0].tag, 'HK Edge 01');
  assert.equal(payload.outbounds[0].server, 'hk-01.example.com');
  assert.deepEqual(payload.route.rules, []);
});

test('compileSubscription returns structured validation errors', async (t) => {
  await t.test('disabled user is rejected', () => {
    const input = createBaseInput('mihomo');
    input.user.status = 'disabled';
    const result = compileSubscription(input);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, APP_ERROR_CODES.userDisabled);
  });

  await t.test('expired user is rejected', () => {
    const input = createBaseInput('mihomo');
    input.user.expiresAt = '2000-01-01T00:00:00.000Z';
    const result = compileSubscription(input);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, APP_ERROR_CODES.userExpired);
  });

  await t.test('empty enabled node set is rejected', () => {
    const input = createBaseInput('mihomo');
    input.nodes = input.nodes.map((node) => ({ ...node, enabled: false }));
    const result = compileSubscription(input);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, APP_ERROR_CODES.noNodesAvailable);
  });

  await t.test('template target mismatch is rejected', () => {
    const input = createBaseInput('mihomo');
    input.template.target = 'singbox';
    const result = compileSubscription(input);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, APP_ERROR_CODES.templateTargetMismatch);
  });

  await t.test('missing renderer returns renderer not found', () => {
    const input = createBaseInput('mihomo');
    input.target = 'surge';
    input.template.target = 'surge';
    const result = compileSubscription(input);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, APP_ERROR_CODES.rendererNotFound);
  });
});
