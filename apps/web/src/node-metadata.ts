import type { NodeRecord } from '@subforge/shared';
import { canonicalizeNodeProtocol } from './node-protocol-validation';

export const COMMON_NODE_PROTOCOLS = ['vless', 'trojan', 'vmess', 'hysteria2', 'ss'] as const;

export type NodeProtocolPreset = 'custom' | 'hysteria2' | 'ss' | 'trojan' | 'vless' | 'vmess';

export interface NodeProtocolGuideState {
  primaryCredential: string;
  secondaryCredential: string;
  alterId: string;
  tls: boolean;
  network: string;
  plugin: string;
  servername: string;
  path: string;
  sni: string;
  obfs: string;
  obfsPassword: string;
  alpn: string;
  insecure: boolean;
}

const emptyNodeProtocolGuideState: NodeProtocolGuideState = {
  primaryCredential: '',
  secondaryCredential: '',
  alterId: '',
  tls: false,
  network: '',
  plugin: '',
  servername: '',
  path: '',
  sni: '',
  obfs: '',
  obfsPassword: '',
  alpn: '',
  insecure: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown> | null | undefined, key: string): boolean {
  return Boolean(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readNumericString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

export function detectNodeProtocolPreset(protocol: string): NodeProtocolPreset {
  switch (canonicalizeNodeProtocol(protocol)) {
    case 'hysteria2':
      return 'hysteria2';
    case 'ss':
      return 'ss';
    case 'trojan':
      return 'trojan';
    case 'vmess':
      return 'vmess';
    case 'vless':
      return 'vless';
    default:
      return 'custom';
  }
}

export function parseNodeMetadataText(
  value: string,
  label: 'credentials' | 'params'
): { value: Record<string, unknown> | null; error?: string } {
  const normalized = value.trim();

  if (!normalized || normalized === 'null') {
    return { value: null };
  }

  try {
    const parsed = JSON.parse(normalized);

    if (parsed === null) {
      return { value: null };
    }

    if (isRecord(parsed)) {
      return { value: parsed };
    }
  } catch {
  }

  return {
    value: null,
    error: `${label} 必须是合法的 JSON 对象；留空或填写 null 表示清空`
  };
}

export function formatNodeMetadataText(value?: NodeRecord['credentials'] | NodeRecord['params'] | Record<string, unknown> | null): string {
  return value ? JSON.stringify(value, null, 2) : '';
}

export function getNodeMetadataExamples(protocol: string): { credentials: string; params: string } {
  switch (detectNodeProtocolPreset(protocol)) {
    case 'hysteria2':
      return {
        credentials: '{\n  "password": "replace-me"\n}',
        params: '{\n  "sni": "sub.example.com",\n  "obfs": "salamander",\n  "obfs-password": "replace-me",\n  "alpn": "h3",\n  "insecure": false\n}'
      };
    case 'ss':
      return {
        credentials: '{\n  "cipher": "aes-256-gcm",\n  "password": "replace-me"\n}',
        params: '{\n  "plugin": "v2ray-plugin"\n}'
      };
    case 'trojan':
      return {
        credentials: '{\n  "password": "replace-me"\n}',
        params: '{\n  "tls": true,\n  "sni": "sub.example.com"\n}'
      };
    case 'vmess':
      return {
        credentials: '{\n  "uuid": "11111111-1111-1111-1111-111111111111",\n  "alterId": 0\n}',
        params: '{\n  "tls": true,\n  "network": "ws",\n  "servername": "sub.example.com",\n  "path": "/vmess"\n}'
      };
    case 'vless':
      return {
        credentials: '{\n  "uuid": "11111111-1111-1111-1111-111111111111"\n}',
        params: '{\n  "tls": true,\n  "network": "ws",\n  "servername": "sub.example.com",\n  "path": "/ws"\n}'
      };
    case 'custom':
    default:
      return {
        credentials: '{\n  "key": "value"\n}',
        params: '{\n  "tls": true,\n  "custom": "value"\n}'
      };
  }
}

export function createNodeProtocolGuideState(
  protocol: string,
  input?: {
    credentials?: Record<string, unknown> | null;
    params?: Record<string, unknown> | null;
  }
): NodeProtocolGuideState {
  const credentials = input?.credentials ?? null;
  const params = input?.params ?? null;

  switch (detectNodeProtocolPreset(protocol)) {
    case 'hysteria2':
      return {
        ...emptyNodeProtocolGuideState,
        primaryCredential: readString(credentials?.password),
        sni: readString(params?.sni),
        obfs: readString(params?.obfs),
        obfsPassword: readString(params?.['obfs-password']),
        alpn: Array.isArray(params?.alpn) ? readString(params?.alpn[0]) : readString(params?.alpn),
        insecure: hasOwn(params, 'insecure') ? readBoolean(params?.insecure) : false
      };
    case 'ss':
      return {
        ...emptyNodeProtocolGuideState,
        primaryCredential: readString(credentials?.cipher),
        secondaryCredential: readString(credentials?.password),
        plugin: readString(params?.plugin)
      };
    case 'trojan':
      return {
        ...emptyNodeProtocolGuideState,
        primaryCredential: readString(credentials?.password),
        tls: hasOwn(params, 'tls') ? readBoolean(params?.tls) : false,
        sni: readString(params?.sni)
      };
    case 'vmess':
      return {
        ...emptyNodeProtocolGuideState,
        primaryCredential: readString(credentials?.uuid),
        alterId: hasOwn(credentials, 'alterId') ? readNumericString(credentials?.alterId) : '',
        tls: hasOwn(params, 'tls') ? readBoolean(params?.tls) : false,
        network: readString(params?.network),
        servername: readString(params?.servername),
        path: readString(params?.path)
      };
    case 'vless':
      return {
        ...emptyNodeProtocolGuideState,
        primaryCredential: readString(credentials?.uuid),
        tls: hasOwn(params, 'tls') ? readBoolean(params?.tls) : false,
        network: readString(params?.network),
        servername: readString(params?.servername),
        path: readString(params?.path)
      };
    case 'custom':
    default:
      return { ...emptyNodeProtocolGuideState };
  }
}

export function serializeNodeProtocolGuideState(
  protocol: string,
  state: NodeProtocolGuideState
): { credentials: Record<string, unknown> | null; params: Record<string, unknown> | null } {
  const credentials: Record<string, unknown> = {};
  const params: Record<string, unknown> = {};
  const primaryCredential = state.primaryCredential.trim();
  const secondaryCredential = state.secondaryCredential.trim();
  const network = state.network.trim();
  const plugin = state.plugin.trim();
  const servername = state.servername.trim();
  const path = state.path.trim();
  const sni = state.sni.trim();
  const obfs = state.obfs.trim();
  const obfsPassword = state.obfsPassword.trim();
  const alpn = state.alpn.trim();
  const alterId = state.alterId.trim();

  switch (detectNodeProtocolPreset(protocol)) {
    case 'hysteria2':
      if (primaryCredential) {
        credentials.password = primaryCredential;
      }
      if (obfs) {
        params.obfs = obfs;
      }
      if (obfsPassword) {
        params['obfs-password'] = obfsPassword;
      }
      if (alpn) {
        params.alpn = alpn;
      }
      if (state.insecure) {
        params.insecure = true;
      }
      break;
    case 'ss':
      if (primaryCredential) {
        credentials.cipher = primaryCredential;
      }
      if (secondaryCredential) {
        credentials.password = secondaryCredential;
      }
      if (plugin) {
        params.plugin = plugin;
      }
      break;
    case 'trojan':
      if (primaryCredential) {
        credentials.password = primaryCredential;
      }
      break;
    case 'vmess':
      if (primaryCredential) {
        credentials.uuid = primaryCredential;
      }
      if (alterId) {
        const parsed = Number(alterId);
        credentials.alterId = Number.isInteger(parsed) ? parsed : alterId;
      }
      break;
    case 'vless':
      if (primaryCredential) {
        credentials.uuid = primaryCredential;
      }
      break;
    case 'custom':
    default:
      return { credentials: null, params: null };
  }

  if (state.tls) {
    params.tls = true;
  }

  if (network) {
    params.network = network;
  }

  if (servername) {
    params.servername = servername;
  }

  if (path) {
    params.path = path;
  }

  if (sni) {
    params.sni = sni;
  }

  return {
    credentials: Object.keys(credentials).length > 0 ? credentials : null,
    params: Object.keys(params).length > 0 ? params : null
  };
}

export function summarizeNodeMetadata(node: NodeRecord): string {
  return summarizeNodeMetadataParts(node.credentials, node.params);
}

export function summarizeNodeMetadataParts(
  credentials?: Record<string, unknown> | null,
  params?: Record<string, unknown> | null
): string {
  const details = [];

  if (credentials && Object.keys(credentials).length > 0) {
    details.push(`credentials: ${Object.keys(credentials).join(', ')}`);
  }

  if (params && Object.keys(params).length > 0) {
    details.push(`params: ${Object.keys(params).join(', ')}`);
  }

  return details.length > 0 ? details.join(' | ') : '仅基础字段';
}
