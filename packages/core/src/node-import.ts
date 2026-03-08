import {
  findUnsupportedHysteria2ShareLinkQueryKeys,
  validateNodeProtocolMetadata
} from './node-protocol-validation';

export interface ImportedNodePayload {
  name: string;
  protocol: string;
  server: string;
  port: number;
  credentials: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
  source: string;
}

export interface ParsedNodeImportResult {
  nodes: ImportedNodePayload[];
  errors: string[];
  lineCount: number;
  contentEncoding: NodeImportContentEncoding;
}

export type NodeImportContentEncoding = 'plain_text' | 'base64_text';

function decodeComponent(value: string): string {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padding = normalized.length % 4;

  return padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), '=');
}

function decodeBase64Utf8(value: string): string {
  const normalized = normalizeBase64(value);

  if (typeof atob !== 'function') {
    throw new Error('当前运行环境不支持 Base64 解码');
  }

  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getNonEmptyLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSupportedShareLink(line: string): boolean {
  return (
    line.startsWith('vless://') ||
    line.startsWith('trojan://') ||
    line.startsWith('vmess://') ||
    line.startsWith('ss://') ||
    line.startsWith('hysteria2://') ||
    line.startsWith('hy2://')
  );
}

function looksLikeBase64SubscriptionText(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');

  if (!normalized || normalized.includes('://') || normalized.length < 16) {
    return false;
  }

  return /^[A-Za-z0-9+/_=-]+$/.test(normalized);
}

function normalizeNodeImportLines(value: string): { lines: string[]; contentEncoding: NodeImportContentEncoding } {
  const lines = getNonEmptyLines(value);

  if (lines.length === 0 || lines.some(isSupportedShareLink)) {
    return { lines, contentEncoding: 'plain_text' };
  }

  if (!looksLikeBase64SubscriptionText(value.trim())) {
    return { lines, contentEncoding: 'plain_text' };
  }

  try {
    const decoded = decodeBase64Utf8(value.trim());
    const decodedLines = getNonEmptyLines(decoded);

    if (decodedLines.some(isSupportedShareLink)) {
      return {
        lines: decodedLines,
        contentEncoding: 'base64_text'
      };
    }
  } catch {
  }

  return { lines, contentEncoding: 'plain_text' };
}

function parsePort(value: string, protocol: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${protocol} 分享链接缺少合法端口`);
  }

  return port;
}

function maybeBoolean(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === '1' || normalized === 'true' || normalized === 'tls') {
    return true;
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'none') {
    return false;
  }

  return null;
}

function setQueryString(target: Record<string, unknown>, key: string, value: string | null): void {
  if (value !== null && value !== '') {
    target[key] = value;
  }
}

function setQueryStrings(target: Record<string, unknown>, key: string, values: string[]): void {
  const filtered = values.filter((value) => value !== '');

  if (filtered.length === 1) {
    target[key] = filtered[0];
  }

  if (filtered.length > 1) {
    target[key] = filtered;
  }
}

function combineUrlUserInfo(url: URL): string {
  const username = decodeComponent(url.username);
  const password = decodeComponent(url.password);

  if (username && password) {
    return `${username}:${password}`;
  }

  return username || password;
}

function looksLikeHysteria2MultiPortShareLink(raw: string): boolean {
  const match = raw.match(/^(?:hysteria2|hy2):\/\/([^/?#]+)/i);

  if (!match) {
    return false;
  }

  const authority = match[1] ?? '';

  if (!authority) {
    return false;
  }

  const atIndex = authority.lastIndexOf('@');
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
  const colonIndex = hostPort.lastIndexOf(':');

  if (colonIndex < 0) {
    return false;
  }

  const portText = hostPort.slice(colonIndex + 1);
  return portText.includes(',') || portText.includes('-');
}

function validateImportedNodePayload(node: ImportedNodePayload): ImportedNodePayload {
  const validationError = validateNodeProtocolMetadata({
    protocol: node.protocol,
    credentials: node.credentials,
    params: node.params
  });

  if (validationError) {
    throw new Error(validationError);
  }

  return node;
}

function parseSsUserInfo(value: string): { cipher: string; password: string } {
  const normalized = decodeComponent(value);
  const plainText = normalized.includes(':') ? normalized : decodeBase64Utf8(normalized);
  const separatorIndex = plainText.indexOf(':');
  const cipher = separatorIndex > 0 ? plainText.slice(0, separatorIndex).trim() : '';
  const password = separatorIndex > 0 ? plainText.slice(separatorIndex + 1) : '';

  if (!cipher || !password) {
    throw new Error('ss 分享链接缺少合法 cipher/password');
  }

  return {
    cipher,
    password: decodeComponent(password)
  };
}

function parseSsShareLink(raw: string): ImportedNodePayload {
  const withoutScheme = raw.slice('ss://'.length);
  const hashIndex = withoutScheme.indexOf('#');
  const beforeHash = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme;
  const name = hashIndex >= 0 ? decodeComponent(withoutScheme.slice(hashIndex + 1)) : '';
  const queryIndex = beforeHash.indexOf('?');
  const authority = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  let userInfoPart = '';
  let serverPart = '';
  const authorityAtIndex = authority.lastIndexOf('@');

  if (authorityAtIndex >= 0) {
    userInfoPart = authority.slice(0, authorityAtIndex);
    serverPart = authority.slice(authorityAtIndex + 1);
  } else {
    const decodedAuthority = decodeBase64Utf8(authority);
    const decodedAtIndex = decodedAuthority.lastIndexOf('@');

    if (decodedAtIndex < 0) {
      throw new Error('ss 分享链接缺少服务器地址');
    }

    userInfoPart = decodedAuthority.slice(0, decodedAtIndex);
    serverPart = decodedAuthority.slice(decodedAtIndex + 1);
  }

  const { cipher, password } = parseSsUserInfo(userInfoPart);
  const endpoint = new URL(`ss://placeholder@${serverPart}`);
  const params: Record<string, unknown> = {};

  setQueryString(params, 'plugin', query ? decodeComponent(new URLSearchParams(query).get('plugin') ?? '') : null);

  return validateImportedNodePayload({
    name: name || decodeComponent(endpoint.hostname),
    protocol: 'ss',
    server: decodeComponent(endpoint.hostname),
    port: parsePort(endpoint.port, 'ss'),
    credentials: {
      cipher,
      password
    },
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  });
}

function parseVlessShareLink(raw: string): ImportedNodePayload {
  const url = new URL(raw);
  const uuid = decodeComponent(url.username);

  if (!uuid) {
    throw new Error('vless 分享链接缺少 UUID');
  }

  const params: Record<string, unknown> = {};
  const tls = maybeBoolean(url.searchParams.get('security'));

  if (tls === true) {
    params.tls = true;
  }

  setQueryString(params, 'network', url.searchParams.get('type'));
  setQueryString(params, 'servername', url.searchParams.get('servername') ?? url.searchParams.get('sni'));
  setQueryString(params, 'path', url.searchParams.get('path'));
  setQueryString(params, 'host', url.searchParams.get('host'));
  setQueryString(params, 'flow', url.searchParams.get('flow'));
  setQueryString(params, 'alpn', url.searchParams.get('alpn'));
  setQueryString(params, 'fp', url.searchParams.get('fp'));
  setQueryString(params, 'pbk', url.searchParams.get('pbk'));
  setQueryString(params, 'sid', url.searchParams.get('sid'));

  return {
    name: decodeComponent(url.hash.slice(1)) || decodeComponent(url.hostname),
    protocol: 'vless',
    server: decodeComponent(url.hostname),
    port: parsePort(url.port, 'vless'),
    credentials: { uuid },
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  };
}

function parseTrojanShareLink(raw: string): ImportedNodePayload {
  const url = new URL(raw);
  const password = decodeComponent(url.username);

  if (!password) {
    throw new Error('trojan 分享链接缺少 password');
  }

  const params: Record<string, unknown> = {};
  const tls = maybeBoolean(url.searchParams.get('security'));

  if (tls !== false) {
    params.tls = true;
  }

  setQueryString(params, 'sni', url.searchParams.get('sni') ?? url.searchParams.get('peer'));
  setQueryString(params, 'network', url.searchParams.get('type'));
  setQueryString(params, 'path', url.searchParams.get('path'));
  setQueryString(params, 'host', url.searchParams.get('host'));
  setQueryString(params, 'alpn', url.searchParams.get('alpn'));
  setQueryString(params, 'fp', url.searchParams.get('fp'));

  return {
    name: decodeComponent(url.hash.slice(1)) || decodeComponent(url.hostname),
    protocol: 'trojan',
    server: decodeComponent(url.hostname),
    port: parsePort(url.port, 'trojan'),
    credentials: { password },
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  };
}

function parseVmessShareLink(raw: string): ImportedNodePayload {
  const encoded = raw.slice('vmess://'.length).trim();
  const decoded = decodeBase64Utf8(encoded);
  const parsed = JSON.parse(decoded) as Record<string, unknown>;

  const server = typeof parsed.add === 'string' ? parsed.add.trim() : '';
  const uuid = typeof parsed.id === 'string' ? parsed.id.trim() : '';

  if (!server) {
    throw new Error('vmess 分享链接缺少服务器地址');
  }

  if (!uuid) {
    throw new Error('vmess 分享链接缺少 UUID');
  }

  const params: Record<string, unknown> = {};
  const tls = maybeBoolean(typeof parsed.tls === 'string' ? parsed.tls : null);

  if (tls === true) {
    params.tls = true;
  }

  setQueryString(params, 'network', typeof parsed.net === 'string' ? parsed.net : null);
  setQueryString(params, 'servername', typeof parsed.sni === 'string' ? parsed.sni : null);
  setQueryString(params, 'path', typeof parsed.path === 'string' ? parsed.path : null);
  setQueryString(params, 'host', typeof parsed.host === 'string' ? parsed.host : null);
  setQueryString(params, 'alpn', typeof parsed.alpn === 'string' ? parsed.alpn : null);
  setQueryString(params, 'fp', typeof parsed.fp === 'string' ? parsed.fp : null);

  const credentials: Record<string, unknown> = {
    uuid
  };

  if (typeof parsed.aid === 'string' && parsed.aid.trim()) {
    const alterId = Number(parsed.aid);
    credentials.alterId = Number.isInteger(alterId) ? alterId : parsed.aid;
  }

  return {
    name: typeof parsed.ps === 'string' && parsed.ps.trim() ? parsed.ps : server,
    protocol: 'vmess',
    server,
    port: parsePort(String(parsed.port ?? ''), 'vmess'),
    credentials,
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  };
}

function parseHysteria2ShareLink(raw: string): ImportedNodePayload {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    if (looksLikeHysteria2MultiPortShareLink(raw)) {
      throw new Error('hysteria2 分享链接暂不支持多端口');
    }

    throw new Error('hysteria2 分享链接格式不合法');
  }

  if (!url.hostname) {
    throw new Error('hysteria2 分享链接缺少服务器地址');
  }

  const unsupportedQueryKeys = findUnsupportedHysteria2ShareLinkQueryKeys(url);

  if (unsupportedQueryKeys.length > 0) {
    throw new Error(`hysteria2 分享链接包含当前不支持的参数: ${unsupportedQueryKeys.join(', ')}`);
  }

  const params: Record<string, unknown> = {};
  const insecure = maybeBoolean(url.searchParams.get('insecure'));

  setQueryString(params, 'obfs', url.searchParams.get('obfs'));
  setQueryString(params, 'obfs-password', url.searchParams.get('obfs-password'));
  setQueryString(params, 'sni', url.searchParams.get('sni'));
  setQueryStrings(params, 'pinSHA256', url.searchParams.getAll('pinSHA256'));
  setQueryString(params, 'alpn', url.searchParams.get('alpn'));
  setQueryString(params, 'mport', url.searchParams.get('mport'));
  setQueryString(params, 'hop-interval', url.searchParams.get('hop-interval'));
  setQueryString(params, 'up', url.searchParams.get('up'));
  setQueryString(params, 'down', url.searchParams.get('down'));
  setQueryString(params, 'upmbps', url.searchParams.get('upmbps'));
  setQueryString(params, 'downmbps', url.searchParams.get('downmbps'));

  if (insecure === true) {
    params.insecure = true;
  }

  const password = combineUrlUserInfo(url);

  return validateImportedNodePayload({
    name: decodeComponent(url.hash.slice(1)) || decodeComponent(url.hostname),
    protocol: 'hysteria2',
    server: decodeComponent(url.hostname),
    port: url.port ? parsePort(url.port, 'hysteria2') : 443,
    credentials: password ? { password } : null,
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  });
}

export function parseNodeShareLink(raw: string): ImportedNodePayload {
  const normalized = raw.trim();

  if (!normalized) {
    throw new Error('分享链接不能为空');
  }

  if (normalized.startsWith('vless://')) {
    return parseVlessShareLink(normalized);
  }

  if (normalized.startsWith('trojan://')) {
    return parseTrojanShareLink(normalized);
  }

  if (normalized.startsWith('vmess://')) {
    return parseVmessShareLink(normalized);
  }

  if (normalized.startsWith('ss://')) {
    return parseSsShareLink(normalized);
  }

  if (normalized.startsWith('hysteria2://') || normalized.startsWith('hy2://')) {
    return parseHysteria2ShareLink(normalized);
  }

  throw new Error('当前仅支持 vless://、trojan://、vmess://、ss://、hysteria2:// / hy2:// 分享链接');
}

export function parseNodeImportText(value: string): ParsedNodeImportResult {
  const normalized = normalizeNodeImportLines(value);

  const nodes: ImportedNodePayload[] = [];
  const errors: string[] = [];

  for (const [index, line] of normalized.lines.entries()) {
    try {
      nodes.push(parseNodeShareLink(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知解析错误';
      errors.push(`第 ${index + 1} 行：${message}`);
    }
  }

  return {
    nodes,
    errors,
    lineCount: normalized.lines.length,
    contentEncoding: normalized.contentEncoding
  };
}
