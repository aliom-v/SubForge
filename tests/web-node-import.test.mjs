import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { parseImportedConfig, parseNodeImportText, parseNodeShareLink } = await loadTsModule(
  'packages/core/src/node-import.ts'
);

function encodeVmess(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

test('parseNodeShareLink parses vless share links into node payload', () => {
  const node = parseNodeShareLink(
    'vless://11111111-1111-1111-1111-111111111111@hk-01.example.com:443?security=tls&type=ws&sni=sub.example.com&path=%2Fws#HK%20VLESS'
  );

  assert.equal(node.name, 'HK VLESS');
  assert.equal(node.protocol, 'vless');
  assert.equal(node.server, 'hk-01.example.com');
  assert.equal(node.port, 443);
  assert.deepEqual(node.credentials, { uuid: '11111111-1111-1111-1111-111111111111' });
  assert.deepEqual(node.params, {
    tls: true,
    network: 'ws',
    servername: 'sub.example.com',
    path: '/ws'
  });
});

test('parseNodeShareLink parses trojan share links into node payload', () => {
  const node = parseNodeShareLink(
    'trojan://replace-me@jp-01.example.com:443?sni=sub.example.com#JP%20Trojan'
  );

  assert.equal(node.name, 'JP Trojan');
  assert.equal(node.protocol, 'trojan');
  assert.deepEqual(node.credentials, { password: 'replace-me' });
  assert.deepEqual(node.params, {
    tls: true,
    sni: 'sub.example.com'
  });
});

test('parseNodeShareLink parses vmess share links into node payload', () => {
  const vmessPayload = encodeVmess({
    v: '2',
    ps: 'VMess SG',
    add: 'sg-01.example.com',
    port: '443',
    id: '11111111-1111-1111-1111-111111111111',
    aid: '0',
    net: 'ws',
    path: '/vmess',
    host: 'sub.example.com',
    tls: 'tls',
    sni: 'sub.example.com'
  });
  const node = parseNodeShareLink(`vmess://${vmessPayload}`);

  assert.equal(node.name, 'VMess SG');
  assert.equal(node.protocol, 'vmess');
  assert.equal(node.server, 'sg-01.example.com');
  assert.equal(node.port, 443);
  assert.deepEqual(node.credentials, {
    uuid: '11111111-1111-1111-1111-111111111111',
    alterId: 0
  });
  assert.deepEqual(node.params, {
    tls: true,
    network: 'ws',
    servername: 'sub.example.com',
    path: '/vmess',
    host: 'sub.example.com'
  });
});

test('parseNodeShareLink parses ss share links into node payload', () => {
  const userInfo = Buffer.from('aes-256-gcm:passw0rd', 'utf8').toString('base64');
  const node = parseNodeShareLink(`ss://${userInfo}@ss-01.example.com:8388?plugin=v2ray-plugin#SS%20Node`);

  assert.equal(node.name, 'SS Node');
  assert.equal(node.protocol, 'ss');
  assert.equal(node.server, 'ss-01.example.com');
  assert.equal(node.port, 8388);
  assert.deepEqual(node.credentials, {
    cipher: 'aes-256-gcm',
    password: 'passw0rd'
  });
  assert.deepEqual(node.params, {
    plugin: 'v2ray-plugin'
  });
});

test('parseNodeShareLink parses ssr share links into node payload', () => {
  const encodedPassword = Buffer.from('passw0rd', 'utf8').toString('base64');
  const encodedName = Buffer.from('SSR Node', 'utf8').toString('base64');
  const encodedProtocolParam = Buffer.from('100:replace-me', 'utf8').toString('base64');
  const encodedObfsParam = Buffer.from('sub.example.com', 'utf8').toString('base64');
  const raw = `ssr://${Buffer.from(
    `ssr.example.com:443:auth_aes128_md5:aes-256-cfb:tls1.2_ticket_auth:${encodedPassword}/?remarks=${encodedName}&protoparam=${encodedProtocolParam}&obfsparam=${encodedObfsParam}`,
    'utf8'
  ).toString('base64')}`;
  const node = parseNodeShareLink(raw);

  assert.equal(node.name, 'SSR Node');
  assert.equal(node.protocol, 'ssr');
  assert.equal(node.server, 'ssr.example.com');
  assert.equal(node.port, 443);
  assert.deepEqual(node.credentials, {
    cipher: 'aes-256-cfb',
    password: 'passw0rd',
    protocol: 'auth_aes128_md5',
    obfs: 'tls1.2_ticket_auth'
  });
  assert.deepEqual(node.params, {
    'protocol-param': '100:replace-me',
    'obfs-param': 'sub.example.com'
  });
});

test('parseNodeShareLink parses tuic share links into node payload', () => {
  const node = parseNodeShareLink(
    'tuic://11111111-1111-1111-1111-111111111111:replace-me@tuic.example.com:443?sni=sub.example.com&alpn=h3&congestion_control=bbr&udp_relay_mode=native&zero_rtt_handshake=1#TUIC%20Node'
  );

  assert.equal(node.name, 'TUIC Node');
  assert.equal(node.protocol, 'tuic');
  assert.equal(node.server, 'tuic.example.com');
  assert.equal(node.port, 443);
  assert.deepEqual(node.credentials, {
    uuid: '11111111-1111-1111-1111-111111111111',
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    sni: 'sub.example.com',
    alpn: 'h3',
    'congestion-controller': 'bbr',
    'udp-relay-mode': 'native',
    'reduce-rtt': true
  });
});

test('parseNodeShareLink parses hysteria2 share links into node payload', () => {
  const node = parseNodeShareLink(
    'hysteria2://replace-me@hy2-01.example.com:8443?sni=sub.example.com&obfs=salamander&obfs-password=secret&insecure=1#HY2%20Node'
  );

  assert.equal(node.name, 'HY2 Node');
  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-01.example.com');
  assert.equal(node.port, 8443);
  assert.deepEqual(node.credentials, {
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    obfs: 'salamander',
    'obfs-password': 'secret',
    sni: 'sub.example.com',
    insecure: true
  });
});

test('parseNodeShareLink parses hy2 alias and falls back to default port 443', () => {
  const node = parseNodeShareLink('hy2://replace-me@hy2-02.example.com?sni=sub.example.com#HY2%20Alias');

  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-02.example.com');
  assert.equal(node.port, 443);
  assert.deepEqual(node.credentials, {
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    sni: 'sub.example.com'
  });
});

test('parseNodeShareLink parses hysteria2 authority multi-port share links into port and mport', () => {
  const node = parseNodeShareLink(
    'hysteria2://replace-me@hy2-03.example.com:8443,9443?sni=sub.example.com#HY2%20Multi'
  );

  assert.equal(node.name, 'HY2 Multi');
  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-03.example.com');
  assert.equal(node.port, 8443);
  assert.deepEqual(node.credentials, {
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    sni: 'sub.example.com',
    mport: '8443,9443'
  });
});

test('parseNodeShareLink parses hysteria2 authority port ranges into port and mport', () => {
  const node = parseNodeShareLink(
    'hy2://replace-me@hy2-04.example.com:2000-3000?alpn=h3#HY2%20Range'
  );

  assert.equal(node.name, 'HY2 Range');
  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-04.example.com');
  assert.equal(node.port, 2000);
  assert.deepEqual(node.credentials, {
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    alpn: 'h3',
    mport: '2000-3000'
  });
});

test('parseNodeShareLink keeps explicit hysteria2 query mport over authority multi-port fallback', () => {
  const node = parseNodeShareLink(
    'hysteria2://replace-me@hy2-05.example.com:8443,9443?mport=12000-13000&sni=sub.example.com#HY2%20Query'
  );

  assert.equal(node.port, 8443);
  assert.deepEqual(node.params, {
    sni: 'sub.example.com',
    mport: '12000-13000'
  });
});

test('parseNodeShareLink preserves repeated hysteria2 alpn and pinSHA256 query values as arrays', () => {
  const node = parseNodeShareLink(
    'hysteria2://replace-me@hy2-06.example.com:8443?alpn=h3&alpn=h3-29&pinSHA256=abc&pinSHA256=def#HY2%20Arrays'
  );

  assert.equal(node.port, 8443);
  assert.deepEqual(node.params, {
    alpn: ['h3', 'h3-29'],
    pinSHA256: ['abc', 'def']
  });
});

test('parseNodeShareLink preserves hysteria2 complex userinfo and bandwidth query combinations', () => {
  const node = parseNodeShareLink(
    'hy2://user:pass@hy2-07.example.com:8443?hop-interval=30s&up=80&down=160&upmbps=100&downmbps=200&insecure=0#HY2%20Combo'
  );

  assert.equal(node.name, 'HY2 Combo');
  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-07.example.com');
  assert.equal(node.port, 8443);
  assert.deepEqual(node.credentials, {
    password: 'user:pass'
  });
  assert.deepEqual(node.params, {
    'hop-interval': '30s',
    up: '80',
    down: '160',
    upmbps: '100',
    downmbps: '200'
  });
});

test('parseNodeShareLink preserves hysteria2 explicit mport precedence with repeated arrays and insecure obfs params', () => {
  const node = parseNodeShareLink(
    'hysteria2://replace-me@hy2-08.example.com:8443,9443?mport=12000-13000&alpn=h3&alpn=h3-29&pinSHA256=abc&pinSHA256=def&obfs=salamander&obfs-password=secret%20value&insecure=1#HY2%20Matrix'
  );

  assert.equal(node.name, 'HY2 Matrix');
  assert.equal(node.protocol, 'hysteria2');
  assert.equal(node.server, 'hy2-08.example.com');
  assert.equal(node.port, 8443);
  assert.deepEqual(node.credentials, {
    password: 'replace-me'
  });
  assert.deepEqual(node.params, {
    mport: '12000-13000',
    alpn: ['h3', 'h3-29'],
    pinSHA256: ['abc', 'def'],
    obfs: 'salamander',
    'obfs-password': 'secret value',
    insecure: true
  });
});

test('parseNodeShareLink rejects unsupported hysteria2 query params', () => {
  assert.throws(
    () => parseNodeShareLink('hysteria2://replace-me@hy2-03.example.com:8443?foo=bar&sni=sub.example.com#HY2%20Unsupported'),
    /hysteria2 分享链接包含当前不支持的参数: foo/
  );
});

test('parseNodeImportText parses multiple lines and reports unsupported schemes', () => {
  const vmessPayload = encodeVmess({
    ps: 'VMess Node',
    add: 'vmess.example.com',
    port: '443',
    id: '11111111-1111-1111-1111-111111111111'
  });
  const result = parseNodeImportText([
    'vless://11111111-1111-1111-1111-111111111111@hk.example.com:443#HK',
    `vmess://${vmessPayload}`,
    'wireguard://example.com:443'
  ].join('\n'));

  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.lineCount, 3);
  assert.equal(result.contentEncoding, 'plain_text');
  assert.match(result.errors[0], /当前仅支持 vless:\/\/、trojan:\/\/、vmess:\/\/、ss:\/\/、ssr:\/\/、tuic:\/\/、hysteria2:\/\/ \/ hy2:\/\//);
});

test('parseNodeImportText auto-decodes base64 wrapped subscription text', () => {
  const vmessPayload = encodeVmess({
    ps: 'VMess Node',
    add: 'vmess.example.com',
    port: '443',
    id: '11111111-1111-1111-1111-111111111111'
  });
  const encodedSubscription = Buffer.from(
    [
      'vless://11111111-1111-1111-1111-111111111111@hk.example.com:443#HK',
      `vmess://${vmessPayload}`
    ].join('\n'),
    'utf8'
  ).toString('base64');

  const result = parseNodeImportText(encodedSubscription);

  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 2);
  assert.equal(result.contentEncoding, 'base64_text');
  assert.equal(result.nodes[0].protocol, 'vless');
  assert.equal(result.nodes[1].protocol, 'vmess');
});

test('parseNodeImportText extracts wrapped share links from yaml-like lines', () => {
  const result = parseNodeImportText([
    'proxies:',
    '  - "vless://11111111-1111-1111-1111-111111111111@hk.example.com:443?security=tls#HK"',
    "  - 'trojan://replace-me@jp.example.com:443?sni=sub.example.com#JP'"
  ].join('\n'));

  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 2);
  assert.equal(result.nodes[0].protocol, 'vless');
  assert.equal(result.nodes[1].protocol, 'trojan');
});

test('parseNodeImportText parses clash-like yaml proxy configs', () => {
  const result = parseNodeImportText([
    'mixed-port: 7890',
    'proxies:',
    '  - name: HK',
    '    type: vless',
    '    server: hk.example.com',
    '    port: 443',
    '    uuid: 11111111-1111-1111-1111-111111111111',
    '    tls: true',
    '    servername: sub.example.com',
    '  - name: JP',
    '    type: trojan',
    '    server: jp.example.com',
    '    port: 443',
    '    password: replace-me',
    '    sni: sub.example.com'
  ].join('\n'));

  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 2);
  assert.equal(result.nodes[0].protocol, 'vless');
  assert.equal(result.nodes[1].protocol, 'trojan');
});

test('parseNodeImportText parses mihomo proxy-providers with embedded proxies', () => {
  const result = parseNodeImportText([
    'proxy-providers:',
    '  provider-a:',
    '    type: file',
    '    proxies:',
    '      - name: HK Provider',
    '        type: vless',
    '        server: hk-provider.example.com',
    '        port: 443',
    '        uuid: 11111111-1111-1111-1111-111111111111',
    '        tls: true',
    'proxy-groups:',
    '  - name: Auto',
    '    type: select',
    '    use:',
    '      - provider-a'
  ].join('\n'));

  assert.equal(result.nodes.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 1);
  assert.equal(result.nodes[0].name, 'HK Provider');
  assert.equal(result.nodes[0].protocol, 'vless');
});

test('parseNodeImportText parses sing-box outbound configs', () => {
  const result = parseNodeImportText(
    JSON.stringify({
      outbounds: [
        {
          tag: 'HK',
          type: 'vless',
          server: 'hk.example.com',
          server_port: 443,
          uuid: '11111111-1111-1111-1111-111111111111',
          tls: {
            enabled: true,
            server_name: 'sub.example.com'
          },
          transport: {
            type: 'ws',
            path: '/ws',
            headers: {
              Host: 'cdn.example.com'
            }
          }
        },
        {
          tag: 'Auto',
          type: 'selector',
          outbounds: ['HK', 'direct']
        }
      ]
    })
  );

  assert.equal(result.nodes.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 2);
  assert.equal(result.nodes[0].protocol, 'vless');
  assert.deepEqual(result.nodes[0].credentials, {
    uuid: '11111111-1111-1111-1111-111111111111'
  });
  assert.deepEqual(result.nodes[0].params, {
    tls: true,
    servername: 'sub.example.com',
    sni: 'sub.example.com',
    network: 'ws',
    path: '/ws',
    host: 'cdn.example.com'
  });
});

test('parseNodeImportText parses json node collections', () => {
  const result = parseNodeImportText(
    JSON.stringify({
      nodes: [
        {
          name: 'HK',
          protocol: 'vless',
          server: 'hk.example.com',
          port: 443,
          credentials: {
            uuid: '11111111-1111-1111-1111-111111111111'
          },
          params: {
            tls: true
          }
        }
      ]
    })
  );

  assert.equal(result.nodes.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.lineCount, 1);
  assert.equal(result.nodes[0].protocol, 'vless');
});

test('parseImportedConfig builds mihomo template content and preserves upstream proxy relationships', () => {
  const result = parseImportedConfig([
    'proxies:',
    '  - name: Transit Node',
    '    type: trojan',
    '    server: transit.example.com',
    '    port: 443',
    '    password: transit-password',
    '  - name: HK Relay',
    '    type: vless',
    '    server: hk.example.com',
    '    port: 443',
    '    uuid: 11111111-1111-1111-1111-111111111111',
    '    tls: true',
    '    dialer-proxy: Transit Node',
    'proxy-groups:',
    '  - name: Auto',
    '    type: select',
    '    proxies:',
    '      - HK Relay',
    'rules:',
    '  - MATCH,DIRECT'
  ].join('\n'));

  assert.ok(result);

  if (!result) {
    throw new Error('expected mihomo config import result');
  }

  assert.equal(result.targetType, 'mihomo');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[1].params.upstreamProxy, 'Transit Node');
  assert.match(result.templateContent, /{{proxies}}/);
  assert.match(result.templateContent, /proxy-groups:/);
  assert.match(result.templateContent, /MATCH,DIRECT/);
});

test('parseImportedConfig preserves mihomo reality options from nested reality-opts blocks', () => {
  const result = parseImportedConfig([
    'proxies:',
    '  - name: Reality Node',
    '    type: vless',
    '    server: reality.example.com',
    '    port: 443',
    '    uuid: 11111111-1111-1111-1111-111111111111',
    '    tls: true',
    '    servername: www.cloudflare.com',
    '    client-fingerprint: chrome',
    '    reality-opts:',
    '      public-key: demo-public-key',
    '      short-id: demo-short-id',
    'rules:',
    '  - MATCH,DIRECT'
  ].join('\n'));

  assert.ok(result);

  if (!result) {
    throw new Error('expected mihomo config import result');
  }

  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.nodes[0].params, {
    tls: true,
    servername: 'www.cloudflare.com',
    fp: 'chrome',
    pbk: 'demo-public-key',
    sid: 'demo-short-id'
  });
});

test('parseImportedConfig keeps mihomo proxy-provider skeletons even when there are no local proxies', () => {
  const result = parseImportedConfig([
    'proxy-providers:',
    '  provider-a:',
    '    type: http',
    '    url: https://example.com/provider.yaml',
    '    path: ./providers/provider-a.yaml',
    '    interval: 3600',
    'proxy-groups:',
    '  - name: Auto',
    '    type: select',
    '    use:',
    '      - provider-a',
    'rules:',
    '  - MATCH,Auto'
  ].join('\n'));

  assert.ok(result);

  if (!result) {
    throw new Error('expected mihomo provider config import result');
  }

  assert.equal(result.targetType, 'mihomo');
  assert.equal(result.nodes.length, 0);
  assert.match(result.templateContent, /proxy-providers:/);
  assert.match(result.templateContent, /\{\{proxies\}\}/);
  assert.match(result.templateContent, /use:/);
  assert.match(result.warnings.join('\n'), /proxy-providers/);
});

test('parseImportedConfig builds mihomo template content for ssr and hysteria2 proxies', () => {
  const result = parseImportedConfig([
    'proxies:',
    '  - name: SSR Relay',
    '    type: ssr',
    '    server: ssr.example.com',
    '    port: 443',
    '    cipher: aes-256-cfb',
    '    password: replace-me',
    '    protocol: auth_aes128_md5',
    '    obfs: tls1.2_ticket_auth',
    '    protocol-param: 100:replace-me',
    '    obfs-param: sub.example.com',
    '  - name: HY2 Relay',
    '    type: hysteria2',
    '    server: hy2.example.com',
    '    port: 8443',
    '    password: replace-me',
    '    sni: sub.example.com',
    '    obfs: salamander',
    '    obfs-password: secret',
    '    pinSHA256: abc',
    '    mport: 8443,9443',
    '    hop-interval: 30s',
    '    up: 80',
    '    down: 160',
    '    upmbps: 100',
    '    downmbps: 200',
    'proxy-groups:',
    '  - name: Auto',
    '    type: select',
    '    proxies:',
    '      - SSR Relay',
    '      - HY2 Relay',
    'rules:',
    '  - MATCH,DIRECT'
  ].join('\n'));

  assert.ok(result);

  if (!result) {
    throw new Error('expected mihomo protocol matrix import result');
  }

  assert.equal(result.targetType, 'mihomo');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].protocol, 'ssr');
  assert.equal(result.nodes[1].protocol, 'hysteria2');
  assert.deepEqual(result.nodes[0].credentials, {
    cipher: 'aes-256-cfb',
    password: 'replace-me',
    protocol: 'auth_aes128_md5',
    obfs: 'tls1.2_ticket_auth'
  });
  assert.deepEqual(result.nodes[0].params, {
    'protocol-param': '100:replace-me',
    'obfs-param': 'sub.example.com'
  });
  assert.deepEqual(result.nodes[1].params, {
    servername: 'sub.example.com',
    sni: 'sub.example.com',
    obfs: 'salamander',
    'obfs-password': 'secret',
    pinSHA256: ['abc'],
    mport: '8443,9443',
    'hop-interval': '30s',
    up: '80',
    down: '160',
    upmbps: '100',
    downmbps: '200'
  });
  assert.match(result.templateContent, /{{proxies}}/);
  assert.match(result.templateContent, /SSR Relay/);
  assert.match(result.templateContent, /HY2 Relay/);
});

test('parseImportedConfig normalizes mihomo tuic skip-cert-verify into params.insecure', () => {
  const result = parseImportedConfig([
    'proxies:',
    '  - name: TUIC Relay',
    '    type: tuic',
    '    server: tuic.example.com',
    '    port: 443',
    '    uuid: 11111111-1111-1111-1111-111111111111',
    '    password: replace-me',
    '    sni: sub.example.com',
    '    alpn:',
    '      - h3',
    '    skip-cert-verify: true',
    '    congestion-controller: bbr',
    '    udp-relay-mode: native',
    '    reduce-rtt: true',
    '    request-timeout: 8000',
    'proxy-groups:',
    '  - name: Auto',
    '    type: select',
    '    proxies:',
    '      - TUIC Relay',
    'rules:',
    '  - MATCH,DIRECT'
  ].join('\n'));

  assert.ok(result);

  if (!result) {
    throw new Error('expected mihomo tuic import result');
  }

  assert.equal(result.targetType, 'mihomo');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].protocol, 'tuic');
  assert.deepEqual(result.nodes[0].params, {
    servername: 'sub.example.com',
    sni: 'sub.example.com',
    alpn: ['h3'],
    insecure: true,
    'congestion-controller': 'bbr',
    'udp-relay-mode': 'native',
    'reduce-rtt': true,
    'request-timeout': 8000
  });
  assert.equal(result.nodes[0].params['skip-cert-verify'], undefined);
});

test('parseImportedConfig builds sing-box template content and preserves static outbounds', () => {
  const result = parseImportedConfig(
    JSON.stringify({
      outbounds: [
        {
          tag: 'Transit',
          type: 'trojan',
          server: 'transit.example.com',
          server_port: 443,
          password: 'transit-password'
        },
        {
          tag: 'HK',
          type: 'vless',
          server: 'hk.example.com',
          server_port: 443,
          uuid: '11111111-1111-1111-1111-111111111111',
          detour: 'Transit',
          tls: {
            enabled: true,
            server_name: 'sub.example.com'
          },
          transport: {
            type: 'ws',
            path: '/ws',
            headers: {
              Host: 'cdn.example.com'
            }
          }
        },
        {
          tag: 'Auto',
          type: 'selector',
          outbounds: ['HK', 'Transit', 'direct']
        }
      ],
      route: {
        rules: [{ action: 'route', outbound: 'direct' }]
      }
    })
  );

  assert.ok(result);

  if (!result) {
    throw new Error('expected sing-box config import result');
  }

  assert.equal(result.targetType, 'singbox');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[1].params.upstreamProxy, 'Transit');
  assert.match(result.templateContent, /{{outbound_items_with_leading_comma}}/);
  assert.match(result.templateContent, /"tag": "Auto"/);
  assert.match(result.templateContent, /"outbound": "direct"/);
});

test('parseImportedConfig builds sing-box template content for tuic and hysteria2 outbounds', () => {
  const result = parseImportedConfig(
    JSON.stringify({
      outbounds: [
        {
          tag: 'Transit',
          type: 'direct'
        },
        {
          tag: 'TUIC Edge',
          type: 'tuic',
          server: 'tuic.example.com',
          server_port: 443,
          uuid: '11111111-1111-1111-1111-111111111111',
          password: 'replace-me',
          detour: 'Transit',
          tls: {
            enabled: true,
            server_name: 'sub.example.com',
            alpn: ['h3'],
            insecure: true
          },
          congestion_control: 'bbr',
          udp_relay_mode: 'native',
          request_timeout: 8000,
          zero_rtt_handshake: true
        },
        {
          tag: 'HY2 Edge',
          type: 'hysteria2',
          server: 'hy2.example.com',
          server_port: 8443,
          network: 'tcp',
          server_ports: ['8443', '9443'],
          hop_interval: '30s',
          up_mbps: 100,
          down_mbps: '200',
          password: 'replace-me',
          tls: {
            enabled: true,
            server_name: 'hy2.example.com',
            insecure: true,
            certificate_public_key_sha256: ['abc', 'def']
          },
          obfs: {
            type: 'salamander',
            password: 'secret'
          }
        }
      ],
      route: {
        rules: [{ action: 'route', outbound: 'direct' }]
      }
    })
  );

  assert.ok(result);

  if (!result) {
    throw new Error('expected sing-box protocol matrix import result');
  }

  assert.equal(result.targetType, 'singbox');
  assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes[0].protocol, 'tuic');
  assert.equal(result.nodes[0].params.upstreamProxy, 'Transit');
  assert.deepEqual(result.nodes[0].params.alpn, ['h3']);
  assert.equal(result.nodes[0].params['congestion-controller'], 'bbr');
  assert.equal(result.nodes[0].params['udp-relay-mode'], 'native');
  assert.equal(result.nodes[0].params.insecure, true);
  assert.equal(result.nodes[0].params['request-timeout'], 8000);
  assert.equal(result.nodes[0].params['reduce-rtt'], true);
  assert.equal(result.nodes[1].protocol, 'hysteria2');
  assert.deepEqual(result.nodes[1].params, {
    tls: true,
    servername: 'hy2.example.com',
    sni: 'hy2.example.com',
    insecure: true,
    network: 'tcp',
    pinSHA256: ['abc', 'def'],
    mport: '8443,9443',
    'hop-interval': '30s',
    upmbps: '100',
    downmbps: '200',
    obfs: 'salamander',
    'obfs-password': 'secret'
  });
  assert.match(result.templateContent, /{{outbound_items_with_leading_comma}}/);
  assert.match(result.templateContent, /"action": "route"/);
});
