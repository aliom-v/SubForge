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
const supportedHysteria2NetworkValues = new Set(['tcp', 'udp']);
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

function isNonEmptyStringOrNumber(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  return readNonEmptyString(value).length > 0;
}

export function canonicalizeNodeProtocol(protocol: string): string {
  const normalized = protocol.trim().toLowerCase();

  if (normalized === 'hy2') {
    return 'hysteria2';
  }

  if (normalized === 'shadowsocks') {
    return 'ss';
  }

  if (normalized === 'shadowsocksr') {
    return 'ssr';
  }

  return normalized;
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

  if (hasOwn(params, 'upstreamProxy') && !readNonEmptyString(params?.upstreamProxy)) {
    return '节点的 params.upstreamProxy 必须是非空字符串';
  }

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

    if (hasOwn(params, 'network') && !readNonEmptyString(params?.network)) {
      return 'hysteria2 节点的 params.network 必须是非空字符串';
    }

    const network = readNonEmptyString(params?.network).toLowerCase();

    if (network && !supportedHysteria2NetworkValues.has(network)) {
      return 'hysteria2 节点的 params.network 当前仅支持 "tcp" 或 "udp"';
    }

    if (hasOwn(params, 'mport') && !readNonEmptyString(params?.mport)) {
      return 'hysteria2 节点的 params.mport 必须是非空字符串';
    }

    if (hasOwn(params, 'hop-interval') && !readNonEmptyString(params?.['hop-interval'])) {
      return 'hysteria2 节点的 params["hop-interval"] 必须是非空字符串';
    }

    if (hasOwn(params, 'up') && !isNonEmptyStringOrNumber(params?.up)) {
      return 'hysteria2 节点的 params.up 必须是非空字符串或数字';
    }

    if (hasOwn(params, 'down') && !isNonEmptyStringOrNumber(params?.down)) {
      return 'hysteria2 节点的 params.down 必须是非空字符串或数字';
    }

    if (hasOwn(params, 'upmbps') && !isNonEmptyStringOrNumber(params?.upmbps)) {
      return 'hysteria2 节点的 params.upmbps 必须是非空字符串或数字';
    }

    if (hasOwn(params, 'downmbps') && !isNonEmptyStringOrNumber(params?.downmbps)) {
      return 'hysteria2 节点的 params.downmbps 必须是非空字符串或数字';
    }

    return null;
  }

  if (protocol === 'ssr') {
    const cipher = readNonEmptyString(credentials?.cipher);
    const password = readNonEmptyString(credentials?.password);
    const ssrProtocol = readNonEmptyString(credentials?.protocol);
    const obfs = readNonEmptyString(credentials?.obfs);

    if (!cipher || !password || !ssrProtocol || !obfs) {
      return 'ssr 节点需要 credentials.cipher、credentials.password、credentials.protocol 和 credentials.obfs';
    }

    if (hasOwn(params, 'protocol-param') && !readNonEmptyString(params?.['protocol-param'])) {
      return 'ssr 节点的 params["protocol-param"] 必须是非空字符串';
    }

    if (hasOwn(params, 'obfs-param') && !readNonEmptyString(params?.['obfs-param'])) {
      return 'ssr 节点的 params["obfs-param"] 必须是非空字符串';
    }

    return null;
  }

  if (protocol === 'tuic') {
    const uuid = readNonEmptyString(credentials?.uuid);
    const password = readNonEmptyString(credentials?.password);

    if (!uuid || !password) {
      return 'tuic 节点需要 credentials.uuid 和 credentials.password';
    }

    if (hasOwn(params, 'sni') && !readNonEmptyString(params?.sni)) {
      return 'tuic 节点的 params.sni 必须是非空字符串';
    }

    if (hasOwn(params, 'alpn')) {
      const value = params?.alpn;

      if (!readNonEmptyString(value) && !isStringArray(value)) {
        return 'tuic 节点的 params.alpn 必须是字符串或非空字符串数组';
      }
    }

    if (hasOwn(params, 'udp-relay-mode') && !readNonEmptyString(params?.['udp-relay-mode'])) {
      return 'tuic 节点的 params["udp-relay-mode"] 必须是非空字符串';
    }

    if (hasOwn(params, 'congestion-controller') && !readNonEmptyString(params?.['congestion-controller'])) {
      return 'tuic 节点的 params["congestion-controller"] 必须是非空字符串';
    }

    if (hasOwn(params, 'disable-sni') && typeof params?.['disable-sni'] !== 'boolean') {
      return 'tuic 节点的 params["disable-sni"] 必须是布尔值';
    }

    if (hasOwn(params, 'insecure') && typeof params?.insecure !== 'boolean') {
      return 'tuic 节点的 params.insecure 必须是布尔值';
    }

    if (hasOwn(params, 'heartbeat') && !readNonEmptyString(params?.heartbeat)) {
      return 'tuic 节点的 params.heartbeat 必须是非空字符串';
    }

    if (hasOwn(params, 'request-timeout') && typeof params?.['request-timeout'] !== 'number') {
      return 'tuic 节点的 params["request-timeout"] 必须是数字';
    }

    if (hasOwn(params, 'reduce-rtt') && typeof params?.['reduce-rtt'] !== 'boolean') {
      return 'tuic 节点的 params["reduce-rtt"] 必须是布尔值';
    }

    return null;
  }

  return null;
}
