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
  assert.equal(result.data.cacheKey, 'sub:v2:mihomo:demo-token');
  assert.equal(result.data.metadata.userId, 'usr_demo');
  assert.equal(result.data.metadata.nodeCount, 1);
  assert.match(result.data.content, /HK Edge 01/);
  assert.match(result.data.content, /MATCH,DIRECT/);
  assert.doesNotMatch(result.data.content, /Disabled Edge/);
});

test('compileSubscription strips stale proxy-group references from dynamic mihomo templates before rendering', () => {
  const result = compileSubscription(
    createCompileInput({
      template: {
        content: `proxies:
{{proxies}}
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - Legacy Static
      - HK Edge 01
rules:
  - MATCH,DIRECT`
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /HK Edge 01/);
  assert.doesNotMatch(result.data.content, /Legacy Static/);
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

test('compileSubscription renders the default mihomo fallback rule', () => {
  const result = compileSubscription(createCompileInput());

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /MATCH,DIRECT/);
});

test('compileSubscription rejects missing upstream references', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_missing_upstream',
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
            upstreamProxy: 'Transit Missing'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for missing upstream reference');
  }

  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.equal(result.error.details?.scope, 'node_chain');
  assert.equal(result.error.details?.issueCount, 1);
  assert.equal(result.error.details?.issues?.[0]?.kind, 'missing_reference');
  assert.equal(result.error.details?.issues?.[0]?.reference, 'Transit Missing');
});

test('compileSubscription rejects self-referential upstream nodes', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_self',
          name: 'Self Chain',
          protocol: 'vless',
          server: 'self-chain.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true,
            upstreamProxy: 'Self Chain'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for self-referential upstream');
  }

  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.equal(result.error.details?.issues?.[0]?.kind, 'self_reference');
  assert.equal(result.error.details?.issues?.[0]?.reference, 'Self Chain');
});

test('compileSubscription rejects cyclic upstream nodes', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_cycle_a',
          name: 'Cycle A',
          protocol: 'trojan',
          server: 'cycle-a.example.com',
          port: 443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          },
          params: {
            upstreamProxy: 'Cycle B'
          }
        },
        {
          id: 'node_cycle_b',
          name: 'Cycle B',
          protocol: 'vless',
          server: 'cycle-b.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true,
            upstreamProxy: 'Cycle A'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for cyclic upstream nodes');
  }

  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.equal(result.error.details?.scope, 'node_chain');
  assert.ok((result.error.details?.issueCount ?? 0) >= 1);
  assert.ok(result.error.details?.issues?.some((issue) => issue.kind === 'node_cycle'));
});

test('compileSubscription rejects disabled upstream nodes', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_disabled_parent',
          name: 'Transit Disabled',
          protocol: 'trojan',
          server: 'transit-disabled.example.com',
          port: 443,
          enabled: false,
          credentials: {
            password: 'replace-me'
          }
        },
        {
          id: 'node_enabled_child',
          name: 'HK Child',
          protocol: 'vless',
          server: 'hk-child.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true,
            upstreamProxy: 'Transit Disabled'
          }
        }
      ]
    })
  );

  assert.equal(result.ok, false);

  if (result.ok) {
    throw new Error('expected failure for disabled upstream node');
  }

  assert.equal(result.error.code, 'VALIDATION_FAILED');
  assert.equal(result.error.details?.issues?.[0]?.kind, 'disabled_upstream');
  assert.equal(result.error.details?.issues?.[0]?.reference, 'Transit Disabled');
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

test('compileSubscription maps insecure metadata to mihomo skip-cert-verify fields', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'mihomo',
      nodes: [
        {
          id: 'node_tuic_modern',
          name: 'TUIC Modern',
          protocol: 'tuic',
          server: 'tuic-modern.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111',
            password: 'replace-me'
          },
          params: {
            insecure: true
          }
        },
        {
          id: 'node_tuic_legacy',
          name: 'TUIC Legacy',
          protocol: 'tuic',
          server: 'tuic-legacy.example.com',
          port: 443,
          enabled: true,
          credentials: {
            uuid: '22222222-2222-2222-2222-222222222222',
            password: 'replace-me'
          },
          params: {
            'skip-cert-verify': true
          }
        }
      ]
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /name: "TUIC Modern"/);
  assert.match(result.data.content, /name: "TUIC Legacy"/);
  assert.match(result.data.content, /skip-cert-verify: true/);
  assert.doesNotMatch(result.data.content, /\n\s+insecure: true/);
});

test('compileSubscription maps detour and transport fields for sing-box templates', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
      nodes: [
        {
          id: 'node_transit_singbox',
          name: 'Transit',
          protocol: 'trojan',
          server: 'transit.example.com',
          port: 443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          }
        },
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
            'skip-cert-verify': true,
            'congestion-controller': 'bbr',
            'udp-relay-mode': 'native',
            'disable-sni': true,
            'request-timeout': 8000,
            'reduce-rtt': true,
            upstreamProxy: 'Transit'
          }
        }
      ],
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
  const outbound = parsed.outbounds.find((item) => item.tag === 'HK TUIC');

  assert.ok(outbound);
  assert.equal(outbound.detour, 'Transit');
  assert.equal(outbound.tls.server_name, 'sub.example.com');
  assert.deepEqual(outbound.tls.alpn, ['h3']);
  assert.equal(outbound.tls.insecure, true);
  assert.equal(outbound.congestion_control, 'bbr');
  assert.equal(outbound.udp_relay_mode, 'native');
  assert.equal(outbound.disable_sni, true);
  assert.equal(outbound.request_timeout, 8000);
  assert.equal(outbound.zero_rtt_handshake, true);
});

test('compileSubscription preserves ssr and hysteria2 metadata in mihomo output', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'mihomo',
      nodes: [
        {
          id: 'node_ssr',
          name: 'SSR Edge',
          protocol: 'ssr',
          server: 'ssr.example.com',
          port: 443,
          enabled: true,
          credentials: {
            cipher: 'aes-256-cfb',
            password: 'replace-me',
            protocol: 'auth_aes128_md5',
            obfs: 'tls1.2_ticket_auth'
          },
          params: {
            'protocol-param': '100:replace-me',
            'obfs-param': 'sub.example.com'
          }
        },
        {
          id: 'node_hy2',
          name: 'HY2 Edge',
          protocol: 'hysteria2',
          server: 'hy2.example.com',
          port: 8443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          },
          params: {
            sni: 'sub.example.com',
            obfs: 'salamander',
            'obfs-password': 'secret',
            pinSHA256: 'abc',
            mport: '8443,9443',
            'hop-interval': '30s',
            up: '80',
            down: '160',
            upmbps: '100',
            downmbps: '200'
          }
        }
      ],
      template: {
        id: 'tpl_mihomo_matrix',
        name: 'Mihomo Matrix',
        target: 'mihomo',
        content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}',
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /name: "SSR Edge"/);
  assert.match(result.data.content, /type: ssr/);
  assert.match(result.data.content, /protocol-param: "100:replace-me"/);
  assert.match(result.data.content, /obfs-param: "sub.example.com"/);
  assert.match(result.data.content, /name: "HY2 Edge"/);
  assert.match(result.data.content, /type: hysteria2/);
  assert.match(result.data.content, /obfs-password: "secret"/);
  assert.match(result.data.content, /pinSHA256: "abc"/);
  assert.match(result.data.content, /mport: "8443,9443"/);
  assert.match(result.data.content, /hop-interval: "30s"/);
  assert.match(result.data.content, /\n\s+up: "80"/);
  assert.match(result.data.content, /\n\s+down: "160"/);
  assert.match(result.data.content, /upmbps: "100"/);
  assert.match(result.data.content, /downmbps: "200"/);
});

test('compileSubscription removes stale static proxy-group references from imported mihomo templates', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'mihomo',
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
          }
        },
        {
          id: 'node_us_01',
          name: 'US Edge 01',
          protocol: 'trojan',
          server: 'us-01.example.com',
          port: 443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          }
        }
      ],
      template: {
        id: 'tpl_mihomo_imported',
        name: 'Imported Mihomo',
        target: 'mihomo',
        content: `mixed-port: 7890
proxies:
{{proxies}}
proxy-groups:
  - name: "🚀 节点选择"
    type: select
    proxies:
      - DIRECT
      - "HK Edge 01"
      - "US Edge 01"
      - "Stale Edge 01"
  - name: "⚡ 自动选择"
    type: url-test
    proxies:
      - "HK Edge 01"
      - "US Edge 01"
      - "Stale Edge 01"
    url: "https://www.gstatic.com/generate_204"
    interval: 300
rules:
{{rules}}`,
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /HK Edge 01/);
  assert.match(result.data.content, /US Edge 01/);
  assert.doesNotMatch(result.data.content, /Stale Edge 01/);
});

test('compileSubscription strips mixed static proxies before injecting mihomo nodes', () => {
  const result = compileSubscription(
    createCompileInput({
      nodes: [
        {
          id: 'node_legacy',
          name: 'Legacy Node',
          protocol: 'trojan',
          server: 'current.example.com',
          port: 443,
          enabled: true,
          credentials: {
            password: 'current-pass'
          }
        }
      ],
      template: {
        id: 'tpl_mihomo_mixed_static',
        name: 'Imported Mixed Mihomo',
        target: 'mihomo',
        content: `proxies:
  - name: Legacy Node
    type: trojan
    server: stale.example.com
    port: 443
    password: stale-pass
{{proxies}}
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - Legacy Node
rules:
{{rules}}`,
        version: 1,
        isDefault: true
      }
    })
  );

  assert.equal(result.ok, true);

  if (!result.ok) {
    throw new Error(`expected success, received ${result.error.code}`);
  }

  assert.match(result.data.content, /current\.example\.com/);
  assert.doesNotMatch(result.data.content, /stale\.example\.com/);
  assert.equal([...result.data.content.matchAll(/name: "?Legacy Node"?/g)].length, 1);
});

test('compileSubscription maps hysteria2 tls and obfs fields for sing-box templates', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
      nodes: [
        {
          id: 'node_hy2_singbox',
          name: 'HY2 Singbox',
          protocol: 'hysteria2',
          server: 'hy2.example.com',
          port: 8443,
          enabled: true,
          credentials: {
            password: 'replace-me'
          },
          params: {
            sni: 'sub.example.com',
            network: 'udp',
            insecure: true,
            obfs: 'salamander',
            'obfs-password': 'secret',
            pinSHA256: ['abc', 'def'],
            mport: '8443,9443',
            'hop-interval': '30s',
            up: '80',
            down: '160',
            upmbps: '100',
            downmbps: '200'
          }
        }
      ],
      template: {
        id: 'tpl_singbox_hy2',
        name: 'Imported HY2 Sing-box',
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

  assert.equal(parsed.outbounds[0].type, 'hysteria2');
  assert.equal(parsed.outbounds[0].tls.server_name, 'sub.example.com');
  assert.equal(parsed.outbounds[0].tls.insecure, true);
  assert.equal(parsed.outbounds[0].network, 'udp');
  assert.deepEqual(parsed.outbounds[0].tls.certificate_public_key_sha256, ['abc', 'def']);
  assert.equal(parsed.outbounds[0].obfs.type, 'salamander');
  assert.equal(parsed.outbounds[0].obfs.password, 'secret');
  assert.deepEqual(parsed.outbounds[0].server_ports, ['8443', '9443']);
  assert.equal(parsed.outbounds[0].hop_interval, '30s');
  assert.equal(parsed.outbounds[0].up_mbps, 100);
  assert.equal(parsed.outbounds[0].down_mbps, 200);
  assert.equal(parsed.outbounds[0].pinSHA256, undefined);
  assert.equal(parsed.outbounds[0].mport, undefined);
  assert.equal(parsed.outbounds[0].transport, undefined);
  assert.equal(parsed.outbounds[0]['hop-interval'], undefined);
  assert.equal(parsed.outbounds[0].up, undefined);
  assert.equal(parsed.outbounds[0].down, undefined);
  assert.equal(parsed.outbounds[0].upmbps, undefined);
  assert.equal(parsed.outbounds[0].downmbps, undefined);
});

test('compileSubscription appends sing-box outbounds after static entries without injecting dynamic rules', () => {
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
  assert.equal(parsed.route.rules.length, 1);
});

test('compileSubscription renders an empty sing-box dynamic rules placeholder', () => {
  const result = compileSubscription(
    createCompileInput({
      target: 'singbox',
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
  assert.deepEqual(parsed.route.rules, []);
  assert.deepEqual(parsed.route.rule_set, [
    {
      tag: 'github',
      type: 'inline',
      rules: []
    }
  ]);
});
