import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { compileSubscription } = await loadTsModule('packages/core/src/compile.ts');

function createCompileInput(overrides = {}) {
  const baseInput = {
    target: 'mihomo',
    user: {
      id: 'usr_demo',
      name: 'Demo User',
      token: 'demo-token',
      status: 'active'
    },
    nodes: [
      {
        id: 'node_hk_01',
        name: 'HK Edge 01',
        protocol: 'vless',
        server: 'hk-01.example.com',
        port: 443,
        enabled: true,
        credentials: {
          uuid: '11111111-1111-1111-1111-111111111111'
        },
        params: {
          tls: true
        }
      },
      {
        id: 'node_disabled',
        name: 'Disabled Edge',
        protocol: 'trojan',
        server: 'disabled.example.com',
        port: 443,
        enabled: false
      }
    ],
    ruleSets: [
      {
        id: 'rules_default',
        name: 'Default Rules',
        format: 'text',
        content: 'DOMAIN-SUFFIX,example.com,DIRECT',
        sourceId: 'rs_default'
      }
    ],
    template: {
      id: 'tpl_mihomo',
      name: 'Mihomo Default',
      target: 'mihomo',
      content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}',
      version: 1,
      isDefault: true
    }
  };

  return {
    ...baseInput,
    ...overrides,
    user: {
      ...baseInput.user,
      ...(overrides.user ?? {})
    },
    nodes: overrides.nodes ?? baseInput.nodes,
    ruleSets: overrides.ruleSets ?? baseInput.ruleSets,
    template: {
      ...baseInput.template,
      ...(overrides.template ?? {})
    }
  };
}

test('compileSubscription returns compiled mihomo content for active users', () => {
  const result = compileSubscription(createCompileInput());

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.equal(result.data.mimeType, 'text/yaml; charset=utf-8');
  assert.equal(result.data.cacheKey, 'sub:mihomo:demo-token');
  assert.equal(result.data.metadata.userId, 'usr_demo');
  assert.equal(result.data.metadata.nodeCount, 1);
  assert.equal(result.data.metadata.ruleSetCount, 1);
  assert.match(result.data.content, /HK Edge 01/);
  assert.match(result.data.content, /DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.doesNotMatch(result.data.content, /Disabled Edge/);
});

test('compileSubscription rejects disabled users', () => {
  const result = compileSubscription(
    createCompileInput({
      user: {
        status: 'disabled'
      }
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for disabled user');
  }

  assert.equal(result.error.code, 'USER_DISABLED');
  assert.deepEqual(result.error.details, { userId: 'usr_demo' });
});

test('compileSubscription rejects expired users', () => {
  const result = compileSubscription(
    createCompileInput({
      user: {
        expiresAt: '2000-01-01T00:00:00.000Z'
      }
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for expired user');
  }

  assert.equal(result.error.code, 'USER_EXPIRED');
  assert.equal(result.error.details?.userId, 'usr_demo');
  assert.equal(result.error.details?.expiresAt, '2000-01-01T00:00:00.000Z');
});

test('compileSubscription rejects subscriptions without enabled nodes', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_disabled_only',
          name: 'Disabled Only',
          protocol: 'vless',
          server: 'disabled-only.example.com',
          port: 443,
          enabled: false
        }
      ]
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for missing enabled nodes');
  }

  assert.equal(result.error.code, 'NO_NODES_AVAILABLE');
  assert.deepEqual(result.error.details, { userId: 'usr_demo' });
});

test('compileSubscription falls back to MATCH,DIRECT when rules are empty', () => {
  const result = compileSubscription(
    createCompileInput({
      ruleSets: [
        {
          id: 'rules_empty',
          name: 'Empty Rules',
          format: 'text',
          content: '\n   \n',
          sourceId: 'rs_empty'
        }
      ]
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /MATCH,DIRECT/);
});

test('compileSubscription maps upstreamProxy to dialer-proxy for mihomo output', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_transit',
          name: 'Transit Node',
          protocol: 'trojan',
          server: 'transit.example.com',
          port: 443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          }
        },
        {
          id: 'node_hk_chain',
          name: 'HK Chain',
          protocol: 'vless',
          server: 'hk-chain.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true,
            upstreamProxy: 'Transit Node'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /dialer-proxy: "Transit Node"/);
});

test('compileSubscription maps reality metadata to mihomo-specific fields', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_reality',
          name: 'Reality Node',
          protocol: 'vless',
          server: 'reality.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true,
            servername: 'www.cloudflare.com',
            fp: 'chrome',
            pbk: 'demo-public-key',
            sid: 'demo-short-id'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /client-fingerprint: "chrome"/);
  assert.match(result.data.content, /reality-opts:\n\s+public-key: "demo-public-key"\n\s+short-id: "demo-short-id"/);
  assert.doesNotMatch(result.data.content, /\n\s+fp: "chrome"/);
  assert.doesNotMatch(result.data.content, /\n\s+pbk: "demo-public-key"/);
  assert.doesNotMatch(result.data.content, /\n\s+sid: "demo-short-id"/);
});

test('compileSubscription maps detour and transport fields for sing-box templates', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
      nodes: [
        {
          id: 'node_singbox',
          name: 'HK TUIC',
          protocol: 'tuic',
          server: 'tuic.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111',
            password: 'replace-me'
          },
          params: {
            sni: 'sub.example.com',
            alpn: ['h3'],
            'congestion-controller': 'bbr',
            'udp-relay-mode': 'native',
            'disable-sni': true,
            'request-timeout': 8000,
            'reduce-rtt': true,
            upstreamProxy: 'Transit'
          }
        }
      ],
      ruleSets: [],
      template: {
        id: 'tpl_singbox',
        name: 'Imported Sing-box',
        target: 'singbox',
        content: '{\n  "outbounds": [\n{{outbound_items}}\n  ],\n  "route": {\n      "rules": {{rules}}\n  }\n}',
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  const parsed = JSON.parse(result.data.content);

  assert.equal(parsed.outbounds[0].detour, 'Transit');
  assert.equal(parsed.outbounds[0].tls.server_name, 'sub.example.com');
  assert.deepEqual(parsed.outbounds[0].tls.alpn, ['h3']);
  assert.equal(parsed.outbounds[0].congestion_control, 'bbr');
  assert.equal(parsed.outbounds[0].udp_relay_mode, 'native');
  assert.equal(parsed.outbounds[0].disable_sni, true);
  assert.equal(parsed.outbounds[0].request_timeout, 8000);
  assert.equal(parsed.outbounds[0].zero_rtt_handshake, true);
});

test('compileSubscription appends dynamic sing-box rules and outbounds after static entries', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
      nodes: [
        {
          id: 'node_static_append',
          name: 'HK VLESS',
          protocol: 'vless',
          server: 'hk.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true
          }
        }
      ],
      template: {
        id: 'tpl_singbox_append',
        name: 'Sing-box Static Append',
        target: 'singbox',
        content: '{\n  "outbounds": [\n    {\n      "tag": "direct",\n      "type": "direct"\n    }{{outbound_items_with_leading_comma}}\n  ],\n  "route": {\n    "rules": [\n      {\n        "outbound": "direct",\n        "ip_is_private": true\n      }{{rules_with_leading_comma}}\n    ]\n  }\n}',
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  const parsed = JSON.parse(result.data.content);

  assert.equal(parsed.outbounds[0].tag, 'direct');
  assert.equal(parsed.outbounds[1].tag, 'HK VLESS');
  assert.equal(parsed.route.rules[0].outbound, 'direct');
  assert.equal(parsed.route.rules[1].action, 'route');
  assert.equal(parsed.route.rules[1].outbound, 'direct');
  assert.deepEqual(parsed.route.rules[1].domain_suffix, ['example.com']);
});

test('compileSubscription converts common Clash rules into structured sing-box route rules', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
      ruleSets: [
        {
          id: 'rules_structured',
          name: 'Structured Rules',
          format: 'text',
          content: [
            'RULE-SET,github,GitHub Proxy',
            'GEOIP,private,DIRECT',
            'DOMAIN-KEYWORD,openai,AI Proxy',
            'PROCESS-NAME,steam.exe,Game Proxy',
            'DOMAIN,ads.example,REJECT-DROP',
            'MATCH,DIRECT'
          ].join('\n'),
          sourceId: 'rs_structured'
        }
      ],
      template: {
        id: 'tpl_singbox_rules',
        name: 'Sing-box Rules',
        target: 'singbox',
        content: '{\n  "outbounds": [\n{{outbound_items}}\n  ],\n  "route": {\n    "rules": {{rules}},\n    "rule_set": [\n      {\n        "tag": "github",\n        "type": "inline",\n        "rules": []\n      }\n    ]\n  }\n}',
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  const parsed = JSON.parse(result.data.content);

  assert.deepEqual(parsed.route.rules[0], {
    rule_set: ['github'],
    action: 'route',
    outbound: 'GitHub Proxy'
  });
  assert.deepEqual(parsed.route.rules[1], {
    ip_is_private: true,
    action: 'route',
    outbound: 'direct'
  });
  assert.deepEqual(parsed.route.rules[2], {
    domain_keyword: ['openai'],
    action: 'route',
    outbound: 'AI Proxy'
  });
  assert.deepEqual(parsed.route.rules[3], {
    process_name: ['steam.exe'],
    action: 'route',
    outbound: 'Game Proxy'
  });
  assert.deepEqual(parsed.route.rules[4], {
    domain: ['ads.example'],
    action: 'reject',
    method: 'drop'
  });
  assert.deepEqual(parsed.route.rules[5], {
    action: 'route',
    outbound: 'direct'
  });
});
