export interface NodeProtocolMetadataValidationInput {
  protocol: string;
  credentials?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
}

export const SUPPORTED_HYSTERIA2_SHARE_LINK_QUERY_KEYS = [
  'obfs',
  'obfs-password',
  'sni',
  'pinSHA256',
  'alpn',
  'mport',
  'hop-interval',
  'up',
  'down',
  'upmbps',
  'downmbps',
  'insecure'
] as const;

const ssComplexParamKeys = ['plugin-opts', 'pluginOpts', 'plugins'] as const;
const supportedHysteria2ObfsValues = new Set(['salamander']);
const supportedHysteria2ShareLinkQueryKeySet = new Set<string>(SUPPORTED_HYSTERIA2_SHARE_LINK_QUERY_KEYS);

function hasOwn(record: Record<string, unknown> | null | undefined, key: string): boolean {
  return Boolean(record) && Object.prototype.hasOwnProperty.call(record, key);
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

export function canonicalizeNodeProtocol(protocol: string): string {
  const normalized = protocol.trim().toLowerCase();
  return normalized === 'hy2' ? 'hysteria2' : normalized;
}

export function findUnsupportedHysteria2ShareLinkQueryKeys(url: URL): string[] {
  const unsupported = new Set<string>();

  url.searchParams.forEach((_, key) => {
    if (!supportedHysteria2ShareLinkQueryKeySet.has(key)) {
      unsupported.add(key);
    }
  });

  return [...unsupported];
}

export function validateNodeProtocolMetadata(input: NodeProtocolMetadataValidationInput): string | null {
  const protocol = canonicalizeNodeProtocol(input.protocol);
  const credentials = input.credentials ?? null;
  const params = input.params ?? null;

  if (protocol === 'ss') {
    const cipher = readNonEmptyString(credentials?.cipher);
    const password = readNonEmptyString(credentials?.password);

    if (!cipher || !password) {
      return 'ss 节点需要 credentials.cipher 和 credentials.password';
    }

    if (hasOwn(params, 'plugin') && !readNonEmptyString(params?.plugin)) {
      return 'ss 节点的 params.plugin 必须是非空字符串';
    }

    const unsupportedKeys = ssComplexParamKeys.filter((key) => hasOwn(params, key));

    if (unsupportedKeys.length > 0) {
      return `ss 节点暂不支持 ${unsupportedKeys.map((key) => `params.${key}`).join(' / ')} 这类复杂 plugin 字段，请继续直接核对原始 JSON`;
    }

    return null;
  }

  if (protocol === 'hysteria2') {
    const password = readNonEmptyString(credentials?.password);

    if (!password) {
      return 'hysteria2 节点需要 credentials.password';
    }

    if (hasOwn(params, 'sni') && !readNonEmptyString(params?.sni)) {
      return 'hysteria2 节点的 params.sni 必须是非空字符串';
    }

    if (hasOwn(params, 'obfs') && !readNonEmptyString(params?.obfs)) {
      return 'hysteria2 节点的 params.obfs 必须是非空字符串';
    }

    const obfs = readNonEmptyString(params?.obfs).toLowerCase();

    if (obfs && !supportedHysteria2ObfsValues.has(obfs)) {
      return 'hysteria2 节点当前仅支持 params.obfs = "salamander"';
    }

    if (hasOwn(params, 'obfs-password') && !readNonEmptyString(params?.['obfs-password'])) {
      return 'hysteria2 节点的 params["obfs-password"] 必须是非空字符串';
    }

    if (hasOwn(params, 'obfs-password') && !obfs) {
      return 'hysteria2 节点提供 params["obfs-password"] 时必须同时提供 params.obfs';
    }

    if (hasOwn(params, 'insecure') && typeof params?.insecure !== 'boolean') {
      return 'hysteria2 节点的 params.insecure 必须是布尔值';
    }

    if (hasOwn(params, 'pinSHA256')) {
      const value = params?.pinSHA256;

      if (!readNonEmptyString(value) && !isStringArray(value)) {
        return 'hysteria2 节点的 params.pinSHA256 必须是字符串或非空字符串数组';
      }
    }

    if (hasOwn(params, 'alpn')) {
      const value = params?.alpn;

      if (!readNonEmptyString(value) && !isStringArray(value)) {
        return 'hysteria2 节点的 params.alpn 必须是字符串或非空字符串数组';
      }
    }

    return null;
  }

  return null;
}
