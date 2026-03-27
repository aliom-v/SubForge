import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { parseNodeImportText, parseNodeShareLink } = await loadTsModule('packages/core/src/node-import.ts');

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

test('parseNodeShareLink rejects hysteria2 multi-port share links for now', () => {
  assert.throws(
    () => parseNodeShareLink('hysteria2://replace-me@hy2-03.example.com:8443,9443?sni=sub.example.com#HY2%20Multi'),
    /hysteria2 分享链接暂不支持多端口/
  );
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
    'ssr://example.com:443'
  ].join('\n'));

  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.lineCount, 3);
  assert.equal(result.contentEncoding, 'plain_text');
  assert.match(result.errors[0], /当前仅支持 vless:\/\/、trojan:\/\/、vmess:\/\/、ss:\/\/、hysteria2:\/\/ \/ hy2:\/\//);
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
