import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  canonicalizeNodeProtocol,
  findUnsupportedHysteria2ShareLinkQueryKeys,
  validateNodeProtocolMetadata
} from './node-protocol-validation';
import { buildImportedNodeWarnings } from './node-diagnostics';

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

const supportedShareLinkSchemes = [
  'vless://',
  'trojan://',
  'vmess://',
  'ss://',
  'ssr://',
  'tuic://',
  'hysteria2://',
  'hy2://'
] as const;
const supportedStructuredNodeProtocols = new Set(['vless', 'trojan', 'vmess', 'ss', 'ssr', 'tuic', 'hysteria2']);
const ignoredSingboxOutboundTypes = new Set(['selector', 'urltest', 'direct', 'block', 'dns']);
const supportedShareLinkMessage =
  '当前仅支持 vless://、trojan://、vmess://、ss://、ssr://、tuic://、hysteria2:// / hy2:// 分享链接';

export interface ImportedConfigPayload {
  format: 'mihomo_yaml' | 'singbox_json';
  targetType: 'mihomo' | 'singbox';
  nodes: ImportedNodePayload[];
  templateContent: string;
  suggestedTemplateName: string;
  errors: string[];
  warnings: string[];
}

interface StructuredNodeImportResult {
  nodes: ImportedNodePayload[];
  errors: string[];
  lineCount: number;
}

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeUnknownBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  return maybeBoolean(typeof value === 'string' ? value : null);
}

function readNonEmptyStringArray(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const strings = value.flatMap((item) => {
      const normalized = readNonEmptyString(item);
      return normalized ? [normalized] : [];
    });

    return strings.length > 0 ? strings : null;
  }

  const single = readNonEmptyString(value);
  return single ? [single] : null;
}

function readRecordValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function readRecordString(record: Record<string, unknown>, keys: string[]): string | null {
  return readNonEmptyString(readRecordValue(record, keys));
}

function readRecordNumber(record: Record<string, unknown>, keys: string[]): number | null {
  const value = readRecordValue(record, keys);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readRecordBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  return normalizeUnknownBoolean(readRecordValue(record, keys));
}

function readRecordObject(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  const value = readRecordValue(record, keys);
  return isObjectRecord(value) ? value : null;
}

function readRecordStringArray(record: Record<string, unknown>, keys: string[]): string[] | null {
  return readNonEmptyStringArray(readRecordValue(record, keys));
}

function setOptionalValue(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return;
  }

  if (Array.isArray(value) && value.length === 0) {
    return;
  }

  target[key] = value;
}

function canonicalizeImportedProtocol(protocol: string): string {
  return canonicalizeNodeProtocol(protocol.trim().toLowerCase());
}

function isSupportedShareLink(line: string): boolean {
  return supportedShareLinkSchemes.some((scheme) => line.startsWith(scheme));
}

function trimWrappedQuotes(value: string): string {
  let current = value.trim();

  while (
    current.length >= 2 &&
    ((current.startsWith('"') && current.endsWith('"')) ||
      (current.startsWith("'") && current.endsWith("'")) ||
      (current.startsWith('`') && current.endsWith('`')))
  ) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

function stripTrailingShareLinkPunctuation(value: string): string {
  let current = value.trim();

  while (/[)"'\],;}]+$/.test(current)) {
    current = current.slice(0, -1).trimEnd();
  }

  return trimWrappedQuotes(current);
}

function extractSupportedShareLink(line: string): string | null {
  const trimmed = trimWrappedQuotes(line.trim());

  if (isSupportedShareLink(trimmed)) {
    return stripTrailingShareLinkPunctuation(trimmed);
  }

  const match = trimmed.match(/(?:vless|trojan|vmess|ssr|ss|tuic|hysteria2|hy2):\/\/\S+/i);

  if (!match) {
    return null;
  }

  const extracted = stripTrailingShareLinkPunctuation(match[0]);
  return isSupportedShareLink(extracted) ? extracted : null;
}

function extractShareLinkLikeCandidate(line: string): string | null {
  const trimmed = trimWrappedQuotes(line.trim());
  const match = trimmed.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/);

  if (!match) {
    return null;
  }

  return stripTrailingShareLinkPunctuation(match[0]);
}

function collectSupportedShareLinks(lines: string[]): string[] {
  const collected: string[] = [];

  for (const line of lines) {
    const extracted = extractSupportedShareLink(line);

    if (extracted) {
      collected.push(extracted);
    }
  }

  return collected;
}

function looksLikeBase64SubscriptionText(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');

  if (!normalized || normalized.includes('://') || normalized.length < 16) {
    return false;
  }

  return /^[A-Za-z0-9+/_=-]+$/.test(normalized);
}

function looksLikeHtmlDocument(value: string): boolean {
  const trimmed = value.trim().toLowerCase();

  return (
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<head') ||
    trimmed.includes('<body')
  );
}

function looksLikeClashLikeConfig(lines: string[]): boolean {
  const normalized = lines.map((line) => line.trim().toLowerCase());
  const hasTopLevelKey = normalized.some((line) =>
    /^(proxies|proxy-groups|proxy-providers|mixed-port|redir-port|tproxy-port|socks-port|allow-lan|mode|dns|rules):/.test(
      line
    )
  );
  const hasNamedListItem = normalized.some((line) => line.startsWith('- name:'));

  return hasTopLevelKey && hasNamedListItem;
}

function parseYamlSafely(content: string): unknown | null {
  try {
    return parseYaml(content) as unknown;
  } catch {
    return null;
  }
}

function collectNestedNodeItems(record: Record<string, unknown>, key: string): unknown[] {
  const container = record[key];

  if (!isObjectRecord(container)) {
    return [];
  }

  const items: unknown[] = [];

  for (const value of Object.values(container)) {
    if (!isObjectRecord(value)) {
      continue;
    }

    if (Array.isArray(value.proxies)) {
      items.push(...value.proxies);
      continue;
    }

    if (Array.isArray(value.nodes)) {
      items.push(...value.nodes);
      continue;
    }

    if (Array.isArray(value.servers)) {
      items.push(...value.servers);
    }
  }

  return items;
}

function getYamlNodeCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isObjectRecord(parsed)) {
    return [];
  }

  if (Array.isArray(parsed.proxies)) {
    return parsed.proxies;
  }

  if (Array.isArray(parsed.nodes)) {
    return parsed.nodes;
  }

  if (Array.isArray(parsed.servers)) {
    return parsed.servers;
  }

  const providerItems = collectNestedNodeItems(parsed, 'proxy-providers');

  if (providerItems.length > 0) {
    return providerItems;
  }

  return [];
}

function looksLikeProxyProviderOnlyYaml(parsed: unknown): boolean {
  return (
    isObjectRecord(parsed) &&
    !Array.isArray(parsed.proxies) &&
    isObjectRecord(parsed['proxy-providers'])
  );
}

function looksLikeSingboxLikeConfig(value: string, lines: string[]): boolean {
  const trimmed = value.trim();
  const normalizedLines = lines.map((line) => line.trim().toLowerCase());

  if (
    normalizedLines.some((line) => /^(outbounds|inbounds|route|dns|experimental):/.test(line)) &&
    normalizedLines.some((line) => line.startsWith('- type:'))
  ) {
    return true;
  }

  if (!trimmed.startsWith('{')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false;
    }

    const record = parsed as Record<string, unknown>;
    return ['outbounds', 'inbounds', 'route', 'dns'].some((key) => key in record);
  } catch {
    return false;
  }
}

function looksLikeJsonNodeCollection(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          !Array.isArray(item) &&
          ('name' in item || 'protocol' in item || 'server' in item || 'port' in item)
      );
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return false;
    }

    const record = parsed as Record<string, unknown>;

    return (
      ('nodes' in record && Array.isArray(record.nodes)) ||
      ('proxies' in record && Array.isArray(record.proxies)) ||
      ('servers' in record && Array.isArray(record.servers))
    );
  } catch {
    return false;
  }
}

function buildUnsupportedImportHint(content: string, lines: string[]): string | null {
  if (looksLikeHtmlDocument(content)) {
    return '当前内容看起来是 HTML 页面，不是订阅分享链接；请先检查订阅 URL 是否正确，或是否被登录页 / 鉴权页 / 重定向拦截。';
  }

  const parsedYaml = parseYamlSafely(content);

  if (looksLikeProxyProviderOnlyYaml(parsedYaml)) {
    return '当前内容看起来是 Clash / Mihomo 的 proxy-providers 配置，本地没有可直接导入的 proxies。若只想保留模板骨架，请使用“导入完整配置”；若想导入节点，请粘贴 provider 返回的 YAML 或订阅内容。';
  }

  if (looksLikeClashLikeConfig(lines)) {
    return '当前内容看起来是 Clash / Mihomo 配置，但没有找到可导入的 proxies，或其中没有当前支持的协议。';
  }

  if (looksLikeSingboxLikeConfig(content, lines)) {
    return '当前内容看起来是 sing-box 配置，但没有找到可导入的 outbounds，或其中没有当前支持的协议。';
  }

  if (looksLikeJsonNodeCollection(content)) {
    return '当前内容看起来是 JSON 节点清单，但节点字段不完整，无法导入。';
  }

  return null;
}

function normalizeNodeImportLines(value: string): {
  lines: string[];
  rawLines: string[];
  contentEncoding: NodeImportContentEncoding;
  contentForHint: string;
  hasSupportedLinks: boolean;
} {
  const lines = getNonEmptyLines(value);
  const extracted = collectSupportedShareLinks(lines);

  if (lines.length === 0) {
    return { lines, rawLines: lines, contentEncoding: 'plain_text', contentForHint: value, hasSupportedLinks: false };
  }

  if (extracted.length > 0) {
    return { lines: extracted, rawLines: lines, contentEncoding: 'plain_text', contentForHint: value, hasSupportedLinks: true };
  }

  if (!looksLikeBase64SubscriptionText(value.trim())) {
    return { lines, rawLines: lines, contentEncoding: 'plain_text', contentForHint: value, hasSupportedLinks: false };
  }

  try {
    const decoded = decodeBase64Utf8(value.trim());
    const decodedLines = getNonEmptyLines(decoded);
    const extractedDecoded = collectSupportedShareLinks(decodedLines);

    if (extractedDecoded.length > 0) {
      return {
        lines: extractedDecoded,
        rawLines: decodedLines,
        contentEncoding: 'base64_text',
        contentForHint: decoded,
        hasSupportedLinks: true
      };
    }

    return {
      lines: decodedLines,
      rawLines: decodedLines,
      contentEncoding: 'base64_text',
      contentForHint: decoded,
      hasSupportedLinks: false
    };
  } catch {
  }

  return { lines, rawLines: lines, contentEncoding: 'plain_text', contentForHint: value, hasSupportedLinks: false };
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

function splitShareLinkAuthority(authority: string): {
  userInfoPrefix: string;
  host: string;
  portText: string | null;
} | null {
  if (!authority) {
    return null;
  }

  const atIndex = authority.lastIndexOf('@');
  const userInfoPrefix = atIndex >= 0 ? authority.slice(0, atIndex + 1) : '';
  const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;

  if (!hostPort) {
    return null;
  }

  if (hostPort.startsWith('[')) {
    const closingBracketIndex = hostPort.indexOf(']');

    if (closingBracketIndex < 0) {
      return null;
    }

    const host = hostPort.slice(0, closingBracketIndex + 1);
    const remainder = hostPort.slice(closingBracketIndex + 1);

    if (!remainder) {
      return { userInfoPrefix, host, portText: null };
    }

    if (!remainder.startsWith(':')) {
      return null;
    }

    return {
      userInfoPrefix,
      host,
      portText: remainder.slice(1) || null
    };
  }

  const colonIndex = hostPort.lastIndexOf(':');

  if (colonIndex < 0) {
    return { userInfoPrefix, host: hostPort, portText: null };
  }

  const host = hostPort.slice(0, colonIndex);
  const portText = hostPort.slice(colonIndex + 1);

  if (!host) {
    return null;
  }

  return {
    userInfoPrefix,
    host,
    portText: portText || null
  };
}

function normalizeHysteria2AuthorityMultiPortShareLink(raw: string): {
  normalizedRaw: string;
  authorityMultiPort: string;
} | null {
  const match = raw.match(/^((?:hysteria2|hy2):\/\/)([^/?#]+)(.*)$/i);

  if (!match) {
    return null;
  }

  const scheme = match[1] ?? '';
  const authority = match[2] ?? '';
  const suffix = match[3] ?? '';

  if (!authority) {
    return null;
  }

  const parsedAuthority = splitShareLinkAuthority(authority);

  if (!parsedAuthority?.portText) {
    return null;
  }

  const authorityMultiPort = parsedAuthority.portText;

  if (!authorityMultiPort.includes(',') && !authorityMultiPort.includes('-')) {
    return null;
  }

  const primaryPortMatch = authorityMultiPort.match(/^\d+/);

  if (!primaryPortMatch) {
    return null;
  }

  return {
    normalizedRaw: `${scheme}${parsedAuthority.userInfoPrefix}${parsedAuthority.host}:${primaryPortMatch[0]}${suffix}`,
    authorityMultiPort
  };
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

function buildImportedNodePayload(input: {
  name: string;
  protocol: string;
  server: string;
  port: number;
  credentials?: Record<string, unknown> | null;
  params?: Record<string, unknown> | null;
  source: string;
}): ImportedNodePayload {
  const normalizedProtocol = canonicalizeImportedProtocol(input.protocol);

  if (!supportedStructuredNodeProtocols.has(normalizedProtocol)) {
    throw new Error(`当前暂不支持 ${input.protocol} 协议导入`);
  }

  return validateImportedNodePayload({
    name: input.name.trim(),
    protocol: normalizedProtocol,
    server: input.server.trim(),
    port: input.port,
    credentials: input.credentials ?? null,
    params: input.params ?? null,
    source: input.source
  });
}

function readClashHost(record: Record<string, unknown>): string | null {
  const wsOptions = readRecordObject(record, ['ws-opts', 'wsOpts']);
  const headers = wsOptions ? readRecordObject(wsOptions, ['headers']) : null;

  return (
    readRecordString(record, ['host']) ??
    (headers ? readRecordString(headers, ['Host', 'host']) : null)
  );
}

function readClashPath(record: Record<string, unknown>): string | null {
  const wsOptions = readRecordObject(record, ['ws-opts', 'wsOpts']);
  return readRecordString(record, ['path']) ?? (wsOptions ? readRecordString(wsOptions, ['path']) : null);
}

function buildCommonClashParams(record: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const realityOptions = readRecordObject(record, ['reality-opts', 'realityOpts']);

  setOptionalValue(params, 'tls', readRecordBoolean(record, ['tls']));
  setOptionalValue(params, 'udp', readRecordBoolean(record, ['udp']));
  setOptionalValue(params, 'network', readRecordString(record, ['network', 'net']));
  setOptionalValue(params, 'servername', readRecordString(record, ['servername', 'server-name', 'serverName', 'sni']));
  setOptionalValue(params, 'sni', readRecordString(record, ['sni']));
  setOptionalValue(params, 'path', readClashPath(record));
  setOptionalValue(params, 'host', readClashHost(record));
  setOptionalValue(params, 'alpn', readRecordStringArray(record, ['alpn']) ?? readRecordString(record, ['alpn']));
  setOptionalValue(params, 'fp', readRecordString(record, ['client-fingerprint', 'clientFingerprint', 'fp']));
  setOptionalValue(params, 'flow', readRecordString(record, ['flow']));
  setOptionalValue(
    params,
    'pbk',
    readRecordString(record, ['public-key', 'publicKey', 'pbk']) ??
      (realityOptions ? readRecordString(realityOptions, ['public-key', 'publicKey']) : null)
  );
  setOptionalValue(
    params,
    'sid',
    readRecordString(record, ['short-id', 'shortId', 'sid']) ??
      (realityOptions ? readRecordString(realityOptions, ['short-id', 'shortId']) : null)
  );
  setOptionalValue(params, 'upstreamProxy', readRecordString(record, ['dialer-proxy', 'dialerProxy']));
  setOptionalValue(
    params,
    'insecure',
    readRecordBoolean(record, ['skip-cert-verify', 'skipCertVerify', 'insecure'])
  );

  return params;
}

function parseClashProxyRecord(record: Record<string, unknown>): ImportedNodePayload {
  const protocolRaw = readRecordString(record, ['type']);

  if (!protocolRaw) {
    throw new Error('代理缺少 type');
  }

  const protocol = canonicalizeImportedProtocol(protocolRaw);
  const name = readRecordString(record, ['name']) ?? readRecordString(record, ['server']) ?? 'Imported Node';
  const server = readRecordString(record, ['server']);
  const port = readRecordNumber(record, ['port']);

  if (!server || !port) {
    throw new Error('代理缺少合法的 server / port');
  }

  const params = buildCommonClashParams(record);
  let credentials: Record<string, unknown> | null = null;

  if (protocol === 'vless' || protocol === 'vmess') {
    const uuid = readRecordString(record, ['uuid', 'id']);

    if (!uuid) {
      throw new Error(`${protocol} 代理缺少 uuid`);
    }

    credentials = { uuid };

    const alterId = readRecordNumber(record, ['alterId', 'alter-id', 'aid']);

    if (protocol === 'vmess' && alterId !== null) {
      credentials.alterId = alterId;
    }
  } else if (protocol === 'trojan') {
    const password = readRecordString(record, ['password']);

    if (!password) {
      throw new Error('trojan 代理缺少 password');
    }

    credentials = { password };
  } else if (protocol === 'ss') {
    const cipher = readRecordString(record, ['cipher', 'method']);
    const password = readRecordString(record, ['password']);

    if (!cipher || !password) {
      throw new Error('ss 代理缺少 cipher / password');
    }

    credentials = { cipher, password };
    setOptionalValue(params, 'plugin', readRecordString(record, ['plugin']));
  } else if (protocol === 'ssr') {
    const cipher = readRecordString(record, ['cipher', 'method']);
    const password = readRecordString(record, ['password']);
    const ssrProtocol = readRecordString(record, ['protocol']);
    const obfs = readRecordString(record, ['obfs']);

    if (!cipher || !password || !ssrProtocol || !obfs) {
      throw new Error('ssr 代理缺少 cipher / password / protocol / obfs');
    }

    credentials = {
      cipher,
      password,
      protocol: ssrProtocol,
      obfs
    };
    setOptionalValue(params, 'protocol-param', readRecordString(record, ['protocol-param', 'protocolParam']));
    setOptionalValue(params, 'obfs-param', readRecordString(record, ['obfs-param', 'obfsParam']));
  } else if (protocol === 'tuic') {
    const uuid = readRecordString(record, ['uuid']);
    const password = readRecordString(record, ['password', 'token']);

    if (!uuid || !password) {
      throw new Error('tuic 代理缺少 uuid / password');
    }

    credentials = { uuid, password };
    setOptionalValue(params, 'sni', readRecordString(record, ['sni', 'servername', 'server-name']));
    setOptionalValue(params, 'alpn', readRecordStringArray(record, ['alpn']) ?? readRecordString(record, ['alpn']));
    setOptionalValue(params, 'congestion-controller', readRecordString(record, ['congestion-controller', 'congestionController']));
    setOptionalValue(params, 'udp-relay-mode', readRecordString(record, ['udp-relay-mode', 'udpRelayMode']));
    setOptionalValue(params, 'disable-sni', readRecordBoolean(record, ['disable-sni', 'disableSni']));
    setOptionalValue(params, 'heartbeat', readRecordString(record, ['heartbeat']));
    setOptionalValue(params, 'reduce-rtt', readRecordBoolean(record, ['reduce-rtt', 'reduceRtt']));
    setOptionalValue(params, 'request-timeout', readRecordNumber(record, ['request-timeout', 'requestTimeout']));
  } else if (protocol === 'hysteria2') {
    const password = readRecordString(record, ['password', 'auth']);

    if (!password) {
      throw new Error('hysteria2 代理缺少 password');
    }

    credentials = { password };
    setOptionalValue(params, 'sni', readRecordString(record, ['sni']));
    setOptionalValue(params, 'obfs', readRecordString(record, ['obfs']));
    setOptionalValue(params, 'obfs-password', readRecordString(record, ['obfs-password', 'obfsPassword']));
    setOptionalValue(params, 'insecure', readRecordBoolean(record, ['insecure']));
    setOptionalValue(params, 'pinSHA256', readRecordStringArray(record, ['pinSHA256']) ?? readRecordString(record, ['pinSHA256']));
    setOptionalValue(params, 'alpn', readRecordStringArray(record, ['alpn']) ?? readRecordString(record, ['alpn']));
    setOptionalValue(params, 'mport', readRecordString(record, ['mport']));
    setOptionalValue(params, 'hop-interval', readRecordString(record, ['hop-interval', 'hopInterval']));
    setOptionalValue(params, 'up', readRecordStringish(record, ['up']));
    setOptionalValue(params, 'down', readRecordStringish(record, ['down']));
    setOptionalValue(params, 'upmbps', readRecordStringish(record, ['upmbps']));
    setOptionalValue(params, 'downmbps', readRecordStringish(record, ['downmbps']));
  }

  return buildImportedNodePayload({
    name,
    protocol,
    server,
    port,
    credentials,
    params: Object.keys(params).length > 0 ? params : null,
    source: JSON.stringify(record)
  });
}

function parseGenericNodeRecord(record: Record<string, unknown>): ImportedNodePayload {
  const protocolRaw = readRecordString(record, ['protocol', 'type']);

  if (!protocolRaw) {
    throw new Error('节点缺少 protocol');
  }

  const protocol = canonicalizeImportedProtocol(protocolRaw);
  const name = readRecordString(record, ['name', 'tag']) ?? readRecordString(record, ['server']) ?? 'Imported Node';
  const server = readRecordString(record, ['server', 'address']);
  const port = readRecordNumber(record, ['port', 'server_port']);

  if (!server || !port) {
    throw new Error('节点缺少合法的 server / port');
  }

  const credentials = readRecordObject(record, ['credentials']) ?? null;
  const params = readRecordObject(record, ['params']) ?? null;

  return buildImportedNodePayload({
    name,
    protocol,
    server,
    port,
    credentials,
    params,
    source: JSON.stringify(record)
  });
}

function readSingboxTransportHost(transport: Record<string, unknown>): string | null {
  const headers = readRecordObject(transport, ['headers']);

  return (
    readRecordString(transport, ['host']) ??
    (headers ? readRecordString(headers, ['Host', 'host']) : null)
  );
}

function readRecordStringish(record: Record<string, unknown>, keys: string[]): string | null {
  const stringValue = readRecordString(record, keys);

  if (stringValue) {
    return stringValue;
  }

  const numericValue = readRecordNumber(record, keys);

  if (numericValue !== null) {
    return String(numericValue);
  }

  return null;
}

function readSingboxHysteria2ServerPorts(record: Record<string, unknown>): string | null {
  const ports = readRecordStringArray(record, ['server_ports', 'serverPorts']);

  if (!ports) {
    return null;
  }

  const normalized = ports
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/^(\d+)\s*:\s*(\d+)$/, '$1-$2'));

  return normalized.length > 0 ? normalized.join(',') : null;
}

function buildCommonSingboxParams(record: Record<string, unknown>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const tls = readRecordObject(record, ['tls']);
  const transport = readRecordObject(record, ['transport']);

  setOptionalValue(params, 'upstreamProxy', readRecordString(record, ['detour']));

  if (tls) {
    setOptionalValue(params, 'tls', readRecordBoolean(tls, ['enabled']));
    setOptionalValue(params, 'servername', readRecordString(tls, ['server_name', 'serverName']));
    setOptionalValue(params, 'sni', readRecordString(tls, ['server_name', 'serverName']));
    setOptionalValue(params, 'alpn', readRecordStringArray(tls, ['alpn']) ?? readRecordString(tls, ['alpn']));
    setOptionalValue(params, 'insecure', readRecordBoolean(tls, ['insecure']));

    const utls = readRecordObject(tls, ['utls']);
    const reality = readRecordObject(tls, ['reality']);

    if (utls) {
      setOptionalValue(params, 'fp', readRecordString(utls, ['fingerprint']));
    }

    if (reality) {
      setOptionalValue(params, 'pbk', readRecordString(reality, ['public_key', 'publicKey']));
      setOptionalValue(params, 'sid', readRecordString(reality, ['short_id', 'shortId']));
    }
  }

  if (transport) {
    setOptionalValue(params, 'network', readRecordString(transport, ['type']));
    setOptionalValue(params, 'path', readRecordString(transport, ['path']));
    setOptionalValue(params, 'host', readSingboxTransportHost(transport));
    setOptionalValue(params, 'service_name', readRecordString(transport, ['service_name', 'serviceName']));
  }

  return params;
}

function parseSingboxOutboundRecord(record: Record<string, unknown>): ImportedNodePayload | null {
  const typeRaw = readRecordString(record, ['type']);

  if (!typeRaw) {
    throw new Error('outbound 缺少 type');
  }

  const type = canonicalizeImportedProtocol(typeRaw);

  if (ignoredSingboxOutboundTypes.has(type)) {
    return null;
  }

  const name = readRecordString(record, ['tag', 'name']) ?? readRecordString(record, ['server']) ?? 'Imported Node';
  const server = readRecordString(record, ['server']);
  const port = readRecordNumber(record, ['server_port', 'port']);

  if (!server || !port) {
    throw new Error('outbound 缺少合法的 server / server_port');
  }

  const params = buildCommonSingboxParams(record);
  let credentials: Record<string, unknown> | null = null;

  if (type === 'vless' || type === 'vmess') {
    const uuid = readRecordString(record, ['uuid']);

    if (!uuid) {
      throw new Error(`${type} outbound 缺少 uuid`);
    }

    credentials = { uuid };
    const alterId = readRecordNumber(record, ['alter_id', 'alterId']);

    if (type === 'vmess' && alterId !== null) {
      credentials.alterId = alterId;
    }

    setOptionalValue(params, 'flow', readRecordString(record, ['flow']));
  } else if (type === 'trojan') {
    const password = readRecordString(record, ['password']);

    if (!password) {
      throw new Error('trojan outbound 缺少 password');
    }

    credentials = { password };
  } else if (type === 'ss') {
    const cipher = readRecordString(record, ['method', 'cipher']);
    const password = readRecordString(record, ['password']);

    if (!cipher || !password) {
      throw new Error('shadowsocks outbound 缺少 method / password');
    }

    credentials = { cipher, password };
    setOptionalValue(params, 'plugin', readRecordString(record, ['plugin']));
  } else if (type === 'tuic') {
    const uuid = readRecordString(record, ['uuid']);
    const password = readRecordString(record, ['password', 'token']);

    if (!uuid || !password) {
      throw new Error('tuic outbound 缺少 uuid / password');
    }

    credentials = { uuid, password };
    setOptionalValue(params, 'sni', readRecordString(record, ['server_name', 'serverName']));
    setOptionalValue(params, 'alpn', readRecordStringArray(record, ['alpn']) ?? readRecordString(record, ['alpn']));
    setOptionalValue(params, 'congestion-controller', readRecordString(record, ['congestion_control', 'congestionController']));
    setOptionalValue(params, 'udp-relay-mode', readRecordString(record, ['udp_relay_mode', 'udpRelayMode']));
    setOptionalValue(params, 'disable-sni', readRecordBoolean(record, ['disable_sni', 'disableSni']));
    setOptionalValue(params, 'heartbeat', readRecordString(record, ['heartbeat']));
    setOptionalValue(params, 'request-timeout', readRecordNumber(record, ['request_timeout', 'requestTimeout']));
    setOptionalValue(params, 'reduce-rtt', readRecordBoolean(record, ['zero_rtt_handshake', 'zeroRttHandshake']));
  } else if (type === 'hysteria2') {
    const password = readRecordString(record, ['password']);

    if (!password) {
      throw new Error('hysteria2 outbound 缺少 password');
    }

    credentials = { password };
    const obfs = readRecordObject(record, ['obfs']);
    const tls = readRecordObject(record, ['tls']);
    if (obfs) {
      setOptionalValue(params, 'obfs', readRecordString(obfs, ['type']));
      setOptionalValue(params, 'obfs-password', readRecordString(obfs, ['password']));
    }
    if (tls) {
      setOptionalValue(
        params,
        'pinSHA256',
        readRecordStringArray(tls, ['certificate_public_key_sha256', 'certificatePublicKeySha256'])
      );
    }
    setOptionalValue(params, 'network', readRecordString(record, ['network']));
    setOptionalValue(params, 'mport', readSingboxHysteria2ServerPorts(record));
    setOptionalValue(params, 'hop-interval', readRecordString(record, ['hop_interval', 'hopInterval']));
    setOptionalValue(params, 'upmbps', readRecordStringish(record, ['up_mbps', 'upMbps']));
    setOptionalValue(params, 'downmbps', readRecordStringish(record, ['down_mbps', 'downMbps']));
  }

  return buildImportedNodePayload({
    name,
    protocol: type,
    server,
    port,
    credentials,
    params: Object.keys(params).length > 0 ? params : null,
    source: JSON.stringify(record)
  });
}

function parseStructuredNodeList(
  items: unknown[],
  label: string,
  parser: (record: Record<string, unknown>) => ImportedNodePayload | null
): StructuredNodeImportResult {
  const nodes: ImportedNodePayload[] = [];
  const errors: string[] = [];

  for (const [index, item] of items.entries()) {
    if (!isObjectRecord(item)) {
      errors.push(`第 ${index + 1} 个${label}必须是对象`);
      continue;
    }

    try {
      const parsed = parser(item);

      if (parsed) {
        nodes.push(parsed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知解析错误';
      errors.push(`第 ${index + 1} 个${label}：${message}`);
    }
  }

  return {
    nodes,
    errors,
    lineCount: items.length
  };
}

function tryParseJsonNodeImportContent(content: string): StructuredNodeImportResult | null {
  const trimmed = content.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    return parseStructuredNodeList(parsed, '个节点', parseGenericNodeRecord);
  }

  if (!isObjectRecord(parsed)) {
    return null;
  }

  if (Array.isArray(parsed.outbounds)) {
    const result = parseStructuredNodeList(parsed.outbounds, '个 outbound', parseSingboxOutboundRecord);

    if (result.nodes.length === 0 && result.errors.length === 0) {
      result.errors.push('当前 sing-box 配置里没有可导入的代理 outbound。');
    }

    return result;
  }

  if (Array.isArray(parsed.proxies)) {
    return parseStructuredNodeList(parsed.proxies, '个代理', parseClashProxyRecord);
  }

  if (Array.isArray(parsed.nodes)) {
    return parseStructuredNodeList(parsed.nodes, '个节点', parseGenericNodeRecord);
  }

  if (Array.isArray(parsed.servers)) {
    return parseStructuredNodeList(parsed.servers, '个节点', parseGenericNodeRecord);
  }

  return null;
}

function tryParseYamlNodeImportContent(content: string): StructuredNodeImportResult | null {
  const parsed = parseYamlSafely(content);

  if (parsed == null) {
    return null;
  }

  const nodeCandidates = getYamlNodeCandidates(parsed);

  if (nodeCandidates.length > 0) {
    return parseStructuredNodeList(nodeCandidates, '个代理', parseClashProxyRecord);
  }

  return null;
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

function parseSsrShareLink(raw: string): ImportedNodePayload {
  const encoded = raw.slice('ssr://'.length).trim();
  const decoded = decodeBase64Utf8(encoded);
  const separatorIndex = decoded.indexOf('/?');
  const mainPart = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const queryPart = separatorIndex >= 0 ? decoded.slice(separatorIndex + 2) : '';
  const segments = mainPart.split(':');

  if (segments.length < 6) {
    throw new Error('ssr 分享链接格式不合法');
  }

  const [server, portRaw, protocolRaw, methodRaw, obfsRaw, passwordEncoded] = segments;
  const serverName = server?.trim() ?? '';
  const protocol = protocolRaw?.trim() ?? '';
  const cipher = methodRaw?.trim() ?? '';
  const obfs = obfsRaw?.trim() ?? '';

  if (!serverName || !protocol || !cipher || !obfs || !passwordEncoded) {
    throw new Error('ssr 分享链接缺少必要字段');
  }

  const params = new URLSearchParams(queryPart);
  const password = decodeBase64Utf8(passwordEncoded);
  const name = params.get('remarks') ? decodeBase64Utf8(params.get('remarks') as string) : serverName;
  const extraParams: Record<string, unknown> = {};

  if (params.get('protoparam')) {
    setOptionalValue(extraParams, 'protocol-param', decodeBase64Utf8(params.get('protoparam') as string));
  }

  if (params.get('obfsparam')) {
    setOptionalValue(extraParams, 'obfs-param', decodeBase64Utf8(params.get('obfsparam') as string));
  }

  if (params.get('group')) {
    setOptionalValue(extraParams, 'group', decodeBase64Utf8(params.get('group') as string));
  }

  return buildImportedNodePayload({
    name,
    protocol: 'ssr',
    server: serverName,
    port: parsePort(portRaw ?? '', 'ssr'),
    credentials: {
      cipher,
      password,
      protocol,
      obfs
    },
    params: Object.keys(extraParams).length > 0 ? extraParams : null,
    source: raw
  });
}

function parseTuicShareLink(raw: string): ImportedNodePayload {
  const url = new URL(raw);
  const uuid = decodeComponent(url.username);
  const password = decodeComponent(url.password);

  if (!uuid || !password) {
    throw new Error('tuic 分享链接缺少 uuid / password');
  }

  const params: Record<string, unknown> = {};

  setOptionalValue(params, 'sni', url.searchParams.get('sni'));
  setOptionalValue(params, 'alpn', url.searchParams.getAll('alpn').length > 1 ? url.searchParams.getAll('alpn') : url.searchParams.get('alpn'));
  setOptionalValue(params, 'congestion-controller', url.searchParams.get('congestion_control') ?? url.searchParams.get('congestion-controller'));
  setOptionalValue(params, 'udp-relay-mode', url.searchParams.get('udp_relay_mode') ?? url.searchParams.get('udp-relay-mode'));
  setOptionalValue(params, 'disable-sni', maybeBoolean(url.searchParams.get('disable_sni') ?? url.searchParams.get('disable-sni')));
  setOptionalValue(params, 'heartbeat', url.searchParams.get('heartbeat'));
  setOptionalValue(params, 'request-timeout', url.searchParams.get('request_timeout') ? Number(url.searchParams.get('request_timeout')) : null);
  setOptionalValue(
    params,
    'reduce-rtt',
    maybeBoolean(url.searchParams.get('zero_rtt_handshake') ?? url.searchParams.get('reduce-rtt'))
  );

  return buildImportedNodePayload({
    name: decodeComponent(url.hash.slice(1)) || decodeComponent(url.hostname),
    protocol: 'tuic',
    server: decodeComponent(url.hostname),
    port: parsePort(url.port, 'tuic'),
    credentials: { uuid, password },
    params: Object.keys(params).length > 0 ? params : null,
    source: raw
  });
}

function parseHysteria2ShareLink(raw: string): ImportedNodePayload {
  const normalizedMultiPortShareLink = normalizeHysteria2AuthorityMultiPortShareLink(raw);
  let url: URL;

  try {
    url = new URL(normalizedMultiPortShareLink?.normalizedRaw ?? raw);
  } catch {
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
  setQueryStrings(params, 'alpn', url.searchParams.getAll('alpn'));
  setQueryString(params, 'mport', url.searchParams.get('mport') || normalizedMultiPortShareLink?.authorityMultiPort || null);
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

  if (normalized.startsWith('ssr://')) {
    return parseSsrShareLink(normalized);
  }

  if (normalized.startsWith('tuic://')) {
    return parseTuicShareLink(normalized);
  }

  if (normalized.startsWith('hysteria2://') || normalized.startsWith('hy2://')) {
    return parseHysteria2ShareLink(normalized);
  }

  throw new Error(supportedShareLinkMessage);
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceYamlMarkerBlock(template: string, key: string, marker: string, replacement: string): string {
  const pattern = new RegExp(`^${key}:\\s*(?:"${marker}"|'${marker}'|${marker})\\s*$`, 'm');
  return template.replace(pattern, `${key}:\n${replacement}`);
}

function formatJsonBlockLines(value: unknown, spaces: number): string {
  return indentBlockLike(JSON.stringify(value, null, 2), spaces);
}

function indentBlockLike(content: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function isImportableSingboxOutboundRecord(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }

  const typeRaw = readRecordString(value, ['type']);

  if (!typeRaw) {
    return false;
  }

  const type = canonicalizeImportedProtocol(typeRaw);
  return supportedStructuredNodeProtocols.has(type) && !ignoredSingboxOutboundTypes.has(type);
}

function buildMihomoImportedTemplate(content: string): ImportedConfigPayload | null {
  const parsed = parseYamlSafely(content);

  if (!isObjectRecord(parsed)) {
    return null;
  }

  const hasMihomoShape =
    Array.isArray(parsed.proxies) ||
    Array.isArray(parsed['proxy-groups']) ||
    Array.isArray(parsed.rules) ||
    isObjectRecord(parsed['proxy-providers']);

  if (!hasMihomoShape) {
    return null;
  }

  const nodeCandidates = getYamlNodeCandidates(parsed);
  const nodeResult =
    nodeCandidates.length > 0
      ? parseStructuredNodeList(nodeCandidates, '个代理', parseClashProxyRecord)
      : { nodes: [], errors: [], lineCount: 0 };
  const warnings: string[] = [];
  const templateObject = cloneJsonLike(parsed);

  const hadProxyGroups = Array.isArray(templateObject['proxy-groups']);
  const hadRules = Array.isArray(templateObject.rules);
  const hadLocalProxies = Array.isArray(templateObject.proxies);
  const hasProxyProviders = isObjectRecord(templateObject['proxy-providers']);

  templateObject.proxies = '__SUBFORGE_MIHOMO_PROXIES__';
  warnings.push(...buildImportedNodeWarnings(nodeResult.nodes));

  if (!hadLocalProxies && hasProxyProviders) {
    warnings.push('检测到当前配置主要引用 proxy-providers，本地没有可直接导入的 proxies；已保留模板骨架，并注入动态 proxies 占位符。');
  }

  if (!hadProxyGroups) {
    templateObject['proxy-groups'] = '__SUBFORGE_MIHOMO_PROXY_GROUPS__';
    warnings.push('原配置未包含 proxy-groups，已注入默认代理组占位符。');
  }

  if (!hadRules) {
    templateObject.rules = '__SUBFORGE_MIHOMO_RULES__';
    warnings.push('原配置未包含 rules，已注入默认规则占位符。');
  }

  let templateContent = stringifyYaml(templateObject, { lineWidth: 0 });
  templateContent = replaceYamlMarkerBlock(templateContent, 'proxies', '__SUBFORGE_MIHOMO_PROXIES__', '{{proxies}}');
  templateContent = replaceYamlMarkerBlock(
    templateContent,
    'proxy-groups',
    '__SUBFORGE_MIHOMO_PROXY_GROUPS__',
    '{{proxy_groups}}'
  );
  templateContent = replaceYamlMarkerBlock(templateContent, 'rules', '__SUBFORGE_MIHOMO_RULES__', '{{rules}}');

  return {
    format: 'mihomo_yaml',
    targetType: 'mihomo',
    nodes: nodeResult.nodes,
    templateContent,
    suggestedTemplateName: 'Imported Mihomo Config',
    errors: nodeResult.errors,
    warnings
  };
}

function buildSingboxImportedTemplate(content: string): ImportedConfigPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }

  if (!isObjectRecord(parsed) || !Array.isArray(parsed.outbounds)) {
    return null;
  }

  const nodeResult = parseStructuredNodeList(parsed.outbounds, '个 outbound', parseSingboxOutboundRecord);
  const staticOutbounds = parsed.outbounds.filter((item) => !isImportableSingboxOutboundRecord(item));
  const templateObject = cloneJsonLike(parsed);
  const warnings: string[] = [];
  const staticOutboundsBlock =
    staticOutbounds.length > 0 ? staticOutbounds.map((item) => formatJsonBlockLines(item, 4)).join(',\n') : '';

  templateObject.outbounds = '__SUBFORGE_SINGBOX_OUTBOUNDS__';
  warnings.push(...buildImportedNodeWarnings(nodeResult.nodes));

  if (!isObjectRecord(templateObject.route)) {
    templateObject.route = { rules: '__SUBFORGE_SINGBOX_RULES__' };
    warnings.push('原配置未包含 route.rules，已注入规则占位符。');
  } else if (!Array.isArray(templateObject.route.rules)) {
    templateObject.route.rules = '__SUBFORGE_SINGBOX_RULES__';
    warnings.push('原配置未包含 route.rules，已注入规则占位符。');
  }

  let templateContent = JSON.stringify(templateObject, null, 2);
  templateContent = templateContent.replace(
    '"outbounds": "__SUBFORGE_SINGBOX_OUTBOUNDS__"',
    staticOutbounds.length > 0
      ? `"outbounds": [\n${staticOutboundsBlock}{{outbound_items_with_leading_comma}}\n  ]`
      : '"outbounds": [\n{{outbound_items}}\n  ]'
  );
  templateContent = templateContent.replace('"rules": "__SUBFORGE_SINGBOX_RULES__"', '"rules": {{rules}}');

  return {
    format: 'singbox_json',
    targetType: 'singbox',
    nodes: nodeResult.nodes,
    templateContent,
    suggestedTemplateName: 'Imported Sing-box Config',
    errors: nodeResult.errors,
    warnings
  };
}

export function parseImportedConfig(value: string): ImportedConfigPayload | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return buildSingboxImportedTemplate(trimmed) ?? buildMihomoImportedTemplate(trimmed);
}

export function parseNodeImportText(value: string): ParsedNodeImportResult {
  const normalized = normalizeNodeImportLines(value);

  if (!normalized.hasSupportedLinks) {
    const structuredResult =
      tryParseJsonNodeImportContent(normalized.contentForHint) ?? tryParseYamlNodeImportContent(normalized.contentForHint);

    if (structuredResult) {
      return {
        nodes: structuredResult.nodes,
        errors: structuredResult.errors,
        lineCount: structuredResult.lineCount,
        contentEncoding: normalized.contentEncoding
      };
    }

    const unsupportedImportHint = buildUnsupportedImportHint(normalized.contentForHint, normalized.lines);

    if (normalized.lines.length > 0 && unsupportedImportHint) {
      return {
        nodes: [],
        errors: [unsupportedImportHint],
        lineCount: normalized.lines.length,
        contentEncoding: normalized.contentEncoding
      };
    }
  }

  const nodes: ImportedNodePayload[] = [];
  const errors: string[] = [];
  const unsupportedShareLinkLikeLineIndexes = normalized.hasSupportedLinks
    ? normalized.rawLines.flatMap((line, index) => {
        const candidate = extractShareLinkLikeCandidate(line);

        if (!candidate || isSupportedShareLink(candidate)) {
          return [];
        }

        return [index];
      })
    : [];

  for (const [index, line] of normalized.lines.entries()) {
    try {
      nodes.push(parseNodeShareLink(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知解析错误';
      errors.push(`第 ${index + 1} 行：${message}`);
    }
  }

  for (const index of unsupportedShareLinkLikeLineIndexes) {
    errors.push(`第 ${index + 1} 行：${supportedShareLinkMessage}`);
  }

  const lineCount =
    normalized.hasSupportedLinks
      ? normalized.rawLines.filter((line) => extractShareLinkLikeCandidate(line) !== null).length
      : normalized.lines.length;

  return {
    nodes,
    errors,
    lineCount,
    contentEncoding: normalized.contentEncoding
  };
}
