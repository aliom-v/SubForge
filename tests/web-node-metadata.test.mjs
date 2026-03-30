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
  assert.equal(detectNodeProtocolPreset('ssr'), 'ssr');
  assert.equal(detectNodeProtocolPreset('tuic'), 'tuic');
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

test('createNodeProtocolGuideState reads existing guided metadata into fields', () => {
  const vless = createNodeProtocolGuideState('vless', {
    credentials: { uuid: 'uuid-1' },
    params: { tls: true, network: 'ws', servername: 'sub.example.com', path: '/ws' }
  });

  assert.equal(vless.primaryCredential, 'uuid-1');
  assert.equal(vless.tls, true);
  assert.equal(vless.network, 'ws');
  assert.equal(vless.servername, 'sub.example.com');
  assert.equal(vless.path, '/ws');

  const ssr = createNodeProtocolGuideState('ssr', {
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
  });

  assert.equal(ssr.primaryCredential, 'aes-256-cfb');
  assert.equal(ssr.secondaryCredential, 'replace-me');
  assert.equal(ssr.protocolName, 'auth_aes128_md5');
  assert.equal(ssr.obfs, 'tls1.2_ticket_auth');
  assert.equal(ssr.protocolParam, '100:replace-me');
  assert.equal(ssr.obfsParam, 'sub.example.com');

  const tuic = createNodeProtocolGuideState('tuic', {
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
      heartbeat: '10s',
      'request-timeout': 8000,
      'reduce-rtt': true
    }
  });

  assert.equal(tuic.primaryCredential, '11111111-1111-1111-1111-111111111111');
  assert.equal(tuic.secondaryCredential, 'replace-me');
  assert.equal(tuic.sni, 'sub.example.com');
  assert.equal(tuic.alpn, 'h3');
  assert.equal(tuic.congestionController, 'bbr');
  assert.equal(tuic.udpRelayMode, 'native');
  assert.equal(tuic.disableSni, true);
  assert.equal(tuic.heartbeat, '10s');
  assert.equal(tuic.requestTimeout, '8000');
  assert.equal(tuic.reduceRtt, true);
});

test('serializeNodeProtocolGuideState builds guided metadata objects', () => {
  const trojan = serializeNodeProtocolGuideState('trojan', {
    primaryCredential: 'replace-me',
    secondaryCredential: '',
    alterId: '',
    protocolName: '',
    protocolParam: '',
    tls: true,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: 'sub.example.com',
    obfs: '',
    obfsPassword: '',
    obfsParam: '',
    alpn: '',
    insecure: false,
    congestionController: '',
    udpRelayMode: '',
    disableSni: false,
    heartbeat: '',
    requestTimeout: '',
    reduceRtt: false
  });

  assert.deepEqual(trojan, {
    credentials: { password: 'replace-me' },
    params: { tls: true, sni: 'sub.example.com' }
  });

  const vmess = serializeNodeProtocolGuideState('vmess', {
    primaryCredential: 'uuid-1',
    secondaryCredential: '',
    alterId: '0',
    protocolName: '',
    protocolParam: '',
    tls: true,
    network: 'ws',
    plugin: '',
    servername: 'sub.example.com',
    path: '/vmess',
    sni: '',
    obfs: '',
    obfsPassword: '',
    obfsParam: '',
    alpn: '',
    insecure: false,
    congestionController: '',
    udpRelayMode: '',
    disableSni: false,
    heartbeat: '',
    requestTimeout: '',
    reduceRtt: false
  });

  assert.deepEqual(vmess, {
    credentials: { uuid: 'uuid-1', alterId: 0 },
    params: { tls: true, network: 'ws', servername: 'sub.example.com', path: '/vmess' }
  });

  const ss = serializeNodeProtocolGuideState('ss', {
    primaryCredential: 'aes-256-gcm',
    secondaryCredential: 'replace-me',
    alterId: '',
    protocolName: '',
    protocolParam: '',
    tls: false,
    network: '',
    plugin: 'v2ray-plugin',
    servername: '',
    path: '',
    sni: '',
    obfs: '',
    obfsPassword: '',
    obfsParam: '',
    alpn: '',
    insecure: false,
    congestionController: '',
    udpRelayMode: '',
    disableSni: false,
    heartbeat: '',
    requestTimeout: '',
    reduceRtt: false
  });

  assert.deepEqual(ss, {
    credentials: { cipher: 'aes-256-gcm', password: 'replace-me' },
    params: { plugin: 'v2ray-plugin' }
  });

  const ssr = serializeNodeProtocolGuideState('ssr', {
    primaryCredential: 'aes-256-cfb',
    secondaryCredential: 'replace-me',
    alterId: '',
    protocolName: 'auth_aes128_md5',
    protocolParam: '100:replace-me',
    tls: false,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: '',
    obfs: 'tls1.2_ticket_auth',
    obfsPassword: '',
    obfsParam: 'sub.example.com',
    alpn: '',
    insecure: false,
    congestionController: '',
    udpRelayMode: '',
    disableSni: false,
    heartbeat: '',
    requestTimeout: '',
    reduceRtt: false
  });

  assert.deepEqual(ssr, {
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
  });

  const tuic = serializeNodeProtocolGuideState('tuic', {
    primaryCredential: '11111111-1111-1111-1111-111111111111',
    secondaryCredential: 'replace-me',
    alterId: '',
    protocolName: '',
    protocolParam: '',
    tls: false,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: 'sub.example.com',
    obfs: '',
    obfsPassword: '',
    obfsParam: '',
    alpn: 'h3',
    insecure: false,
    congestionController: 'bbr',
    udpRelayMode: 'native',
    disableSni: true,
    heartbeat: '10s',
    requestTimeout: '8000',
    reduceRtt: true
  });

  assert.deepEqual(tuic, {
    credentials: {
      uuid: '11111111-1111-1111-1111-111111111111',
      password: 'replace-me'
    },
    params: {
      sni: 'sub.example.com',
      alpn: 'h3',
      'congestion-controller': 'bbr',
      'udp-relay-mode': 'native',
      'disable-sni': true,
      heartbeat: '10s',
      'request-timeout': 8000,
      'reduce-rtt': true
    }
  });

  const hysteria2 = serializeNodeProtocolGuideState('hysteria2', {
    primaryCredential: 'replace-me',
    secondaryCredential: '',
    alterId: '',
    protocolName: '',
    protocolParam: '',
    tls: false,
    network: '',
    plugin: '',
    servername: '',
    path: '',
    sni: 'sub.example.com',
    obfs: 'salamander',
    obfsPassword: 'secret',
    obfsParam: '',
    alpn: 'h3',
    insecure: true,
    congestionController: '',
    udpRelayMode: '',
    disableSni: false,
    heartbeat: '',
    requestTimeout: '',
    reduceRtt: false
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
  assert.match(getNodeMetadataExamples('ssr').credentials, /protocol/);
  assert.match(getNodeMetadataExamples('trojan').credentials, /password/);
  assert.match(getNodeMetadataExamples('tuic').params, /congestion-controller/);
  assert.match(getNodeMetadataExamples('vmess').credentials, /alterId/);
  assert.match(getNodeMetadataExamples('vless').params, /servername/);
  assert.match(getNodeMetadataExamples('hysteria2').params, /obfs/);
});

test('validateNodeProtocolMetadata validates ss, ssr, tuic and hysteria2 common fields', () => {
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
      protocol: 'ssr',
      credentials: {
        cipher: 'aes-256-cfb',
        password: 'replace-me',
        protocol: 'auth_aes128_md5',
        obfs: 'tls1.2_ticket_auth'
      },
      params: { 'protocol-param': '100:replace-me' }
    }),
    null
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'tuic',
      credentials: { uuid: 'uuid-1', password: 'replace-me' },
      params: { 'request-timeout': '8000' }
    }),
    'tuic 节点的 params["request-timeout"] 必须是数字'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'tuic',
      credentials: { uuid: 'uuid-1', password: 'replace-me' },
      params: { insecure: 'true' }
    }),
    'tuic 节点的 params.insecure 必须是布尔值'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { network: 'ws' }
    }),
    'hysteria2 节点的 params.network 当前仅支持 "tcp" 或 "udp"'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { mport: '' }
    }),
    'hysteria2 节点的 params.mport 必须是非空字符串'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { upmbps: false }
    }),
    'hysteria2 节点的 params.upmbps 必须是非空字符串或数字'
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: { sni: 'sub.example.com', obfs: 'salamander', 'obfs-password': 'secret', insecure: true }
    }),
    null
  );

  assert.equal(
    validateNodeProtocolMetadata({
      protocol: 'hysteria2',
      credentials: { password: 'replace-me' },
      params: {
        sni: 'sub.example.com',
        obfs: 'salamander',
        'obfs-password': 'secret',
        insecure: true,
        network: 'tcp',
        mport: '8443,9443',
        'hop-interval': '30s',
        up: 80,
        down: '160',
        upmbps: '100',
        downmbps: 200
      }
    }),
    null
  );
});
