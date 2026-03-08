import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  createNodeProtocolGuideState,
  detectNodeProtocolPreset,
  getNodeMetadataExamples,
  parseNodeMetadataText,
  serializeNodeProtocolGuideState
} = await loadTsModule('apps/web/src/node-metadata.ts');
const { canonicalizeNodeProtocol, validateNodeProtocolMetadata } = await loadTsModule(
  'packages/core/src/node-protocol-validation.ts'
);

test('detectNodeProtocolPreset recognizes common guided protocols', () => {
  assert.equal(detectNodeProtocolPreset('vless'), 'vless');
  assert.equal(detectNodeProtocolPreset(' TROJAN '), 'trojan');
  assert.equal(detectNodeProtocolPreset('vmess'), 'vmess');
  assert.equal(detectNodeProtocolPreset('ss'), 'ss');
  assert.equal(detectNodeProtocolPreset('hysteria2'), 'hysteria2');
  assert.equal(detectNodeProtocolPreset('hy2'), 'hysteria2');
  assert.equal(canonicalizeNodeProtocol(' hy2 '), 'hysteria2');
});

test('parseNodeMetadataText accepts objects and rejects arrays', () => {
  assert.deepEqual(parseNodeMetadataText('', 'credentials'), { value: null });
  assert.deepEqual(parseNodeMetadataText('null', 'params'), { value: null });
  assert.deepEqual(parseNodeMetadataText('{"uuid":"demo"}', 'credentials'), { value: { uuid: 'demo' } });
  assert.equal(
    parseNodeMetadataText('["uuid"]', 'credentials').error,
    'credentials 必须是合法的 JSON 对象；留空或填写 null 表示清空'
  );
});

test('createNodeProtocolGuideState reads existing vless metadata into guided fields', () => {
  const state = createNodeProtocolGuideState('vless', {
    credentials: { uuid: 'uuid-1' },
    params: { tls: true, network: 'ws', servername: 'sub.example.com', path: '/ws' }
  });

  assert.equal(state.primaryCredential, 'uuid-1');
  assert.equal(state.tls, true);
  assert.equal(state.network, 'ws');
  assert.equal(state.servername, 'sub.example.com');
  assert.equal(state.path, '/ws');
});

test('createNodeProtocolGuideState reads existing ss metadata into guided fields', () => {
  const state = createNodeProtocolGuideState('ss', {
    credentials: { cipher: 'aes-256-gcm', password: 'replace-me' },
    params: { plugin: 'v2ray-plugin' }
  });

  assert.equal(state.primaryCredential, 'aes-256-gcm');
  assert.equal(state.secondaryCredential, 'replace-me');
  assert.equal(state.plugin, 'v2ray-plugin');
});

test('createNodeProtocolGuideState reads existing hysteria2 metadata into guided fields', () => {
  const state = createNodeProtocolGuideState('hysteria2', {
    credentials: { password: 'replace-me' },
    params: {
      sni: 'sub.example.com',
      obfs: 'salamander',
      'obfs-password': 'secret',
      alpn: 'h3',
      insecure: true
    }
  });

  assert.equal(state.primaryCredential, 'replace-me');
  assert.equal(state.sni, 'sub.example.com');
  assert.equal(state.obfs, 'salamander');
  assert.equal(state.obfsPassword, 'secret');
  assert.equal(state.alpn, 'h3');
  assert.equal(state.insecure, true);
});

test('serializeNodeProtocolGuideState builds trojan and vmess metadata objects', () => {
  const trojan = serializeNodeProtocolGuideState('trojan', {
    primaryCredential: 'replace-me',
    secondaryCredential: '',
    alterId: '',
    tls: true,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: 'sub.example.com',
    obfs: '',
    obfsPassword: '',
    alpn: '',
    insecure: false
  });

  assert.deepEqual(trojan, {
    credentials: { password: 'replace-me' },
    params: { tls: true, sni: 'sub.example.com' }
  });

  const vmess = serializeNodeProtocolGuideState('vmess', {
    primaryCredential: 'uuid-1',
    secondaryCredential: '',
    alterId: '0',
    tls: true,
    network: 'ws',
    plugin: '',
    servername: 'sub.example.com',
    path: '/vmess',
    sni: '',
    obfs: '',
    obfsPassword: '',
    alpn: '',
    insecure: false
  });

  assert.deepEqual(vmess, {
    credentials: { uuid: 'uuid-1', alterId: 0 },
    params: { tls: true, network: 'ws', servername: 'sub.example.com', path: '/vmess' }
  });

  const ss = serializeNodeProtocolGuideState('ss', {
    primaryCredential: 'aes-256-gcm',
    secondaryCredential: 'replace-me',
    alterId: '',
    tls: false,
    network: '',
    plugin: 'v2ray-plugin',
    servername: '',
    path: '',
    sni: '',
    obfs: '',
    obfsPassword: '',
    alpn: '',
    insecure: false
  });

  assert.deepEqual(ss, {
    credentials: { cipher: 'aes-256-gcm', password: 'replace-me' },
    params: { plugin: 'v2ray-plugin' }
  });

  const hysteria2 = serializeNodeProtocolGuideState('hysteria2', {
    primaryCredential: 'replace-me',
    secondaryCredential: '',
    alterId: '',
    tls: false,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: 'sub.example.com',
    obfs: 'salamander',
    obfsPassword: 'secret',
    alpn: 'h3',
    insecure: true
  });

  assert.deepEqual(hysteria2, {
    credentials: { password: 'replace-me' },
    params: {
      sni: 'sub.example.com',
      obfs: 'salamander',
      'obfs-password': 'secret',
      alpn: 'h3',
      insecure: true
    }
  });
});

test('getNodeMetadataExamples returns protocol-specific samples', () => {
  assert.match(getNodeMetadataExamples('ss').credentials, /cipher/);
  assert.match(getNodeMetadataExamples('trojan').credentials, /password/);
  assert.match(getNodeMetadataExamples('vmess').credentials, /alterId/);
  assert.match(getNodeMetadataExamples('vless').params, /servername/);
  assert.match(getNodeMetadataExamples('hysteria2').params, /obfs/);
});

test('validateNodeProtocolMetadata validates ss and hysteria2 common fields', () => {
  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'ss',
      credentials: { cipher: 'aes-256-gcm' },
      params: null
    }),
    'ss 节点需要 credentials.cipher 和 credentials.password'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { obfs: 'shadowtls' }
    }),
    'hysteria2 节点当前仅支持 params.obfs = "salamander"'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { sni: 'sub.example.com', obfs: 'salamander', 'obfs-password': 'secret', insecure: true }
    }),
    null
  );
});
