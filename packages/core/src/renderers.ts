import { createAppError, APP_ERROR_CODES, type SubscriptionTarget } from '@subforge/shared';
import type {
  SubscriptionCompileInput,
  SubscriptionNode,
  SubscriptionRenderContext,
  SubscriptionRuleSet
} from './models';
import {
  normalizeManagedMihomoTemplateContent,
  parseMihomoTemplateStructure,
  updateMihomoTemplateStructure
} from './template-structure';

export interface SubscriptionRenderer {
  target: SubscriptionTarget;
  mimeType: string;
  render(context: SubscriptionRenderContext): string;
}

function indentBlock(content: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return content
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function replaceTemplateSlots(template: string, slots: Record<string, string>): string {
  return Object.entries(slots).reduce((content, [key, value]) => {
    return content.replaceAll(`{{${key}}}`, value);
  }, template);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function readNodeParamString(params: SubscriptionNode['params'], key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNodeParamNumber(params: SubscriptionNode['params'], key: string): number | null {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNodeParamNumberish(params: SubscriptionNode['params'], key: string): number | string | null {
  const numericValue = readNodeParamNumber(params, key);

  if (numericValue !== null) {
    return numericValue;
  }

  const stringValue = readNodeParamString(params, key);

  if (!stringValue) {
    return null;
  }

  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : stringValue;
}

function readNodeParamBoolean(params: SubscriptionNode['params'], key: string): boolean | null {
  const value = params?.[key];
  return typeof value === 'boolean' ? value : null;
}

function readNodeParamStringList(
  params: SubscriptionNode['params'],
  key: string
): string | string[] | null {
  const value = params?.[key];

  if (Array.isArray(value)) {
    const strings = value.flatMap((item) => {
      return typeof item === 'string' && item.trim() ? [item.trim()] : [];
    });

    if (strings.length === 0) {
      return null;
    }

    const firstString = strings[0];

    if (!firstString) {
      return null;
    }

    return strings.length === 1 ? firstString : strings;
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasNodeParam(params: SubscriptionNode['params'], key: string): boolean {
  return Boolean(params) && Object.prototype.hasOwnProperty.call(params, key);
}

function normalizeHysteria2Mport(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^(\d+)\s*-\s*(\d+)$/, '$1:$2'));
}

function collectRuleLines(ruleSets: SubscriptionRuleSet[]): string[] {
  return ruleSets.flatMap((ruleSet) =>
    ruleSet.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function toMihomoProxy(node: SubscriptionNode): string {
  const entries = [`name: ${JSON.stringify(node.name)}`, `type: ${node.protocol}`, `server: ${node.server}`, `port: ${node.port}`];
  const params = node.params ?? {};
  const handledKeys = new Set<string>();

  for (const [key, value] of Object.entries(node.credentials ?? {})) {
    entries.push(`${key}: ${JSON.stringify(value)}`);
  }

  const fingerprint = readNodeParamString(params, 'fp');
  if (fingerprint) {
    handledKeys.add('fp');
    entries.push(`client-fingerprint: ${JSON.stringify(fingerprint)}`);
  }

  if (hasNodeParam(params, 'insecure') || hasNodeParam(params, 'skip-cert-verify')) {
    handledKeys.add('insecure');
    handledKeys.add('skip-cert-verify');
    const insecure = readNodeParamBoolean(params, 'insecure') ?? readNodeParamBoolean(params, 'skip-cert-verify');
    if (insecure !== null) {
      entries.push(`skip-cert-verify: ${JSON.stringify(insecure)}`);
    }
  }

  const publicKey = readNodeParamString(params, 'pbk');
  const shortId = readNodeParamString(params, 'sid');
  if (publicKey || shortId) {
    handledKeys.add('pbk');
    handledKeys.add('sid');
    entries.push('reality-opts:');
    if (publicKey) {
      entries.push(`  public-key: ${JSON.stringify(publicKey)}`);
    }
    if (shortId) {
      entries.push(`  short-id: ${JSON.stringify(shortId)}`);
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (handledKeys.has(key)) {
      continue;
    }
    const outputKey = key === 'upstreamProxy' ? 'dialer-proxy' : key;
    entries.push(`${outputKey}: ${JSON.stringify(value)}`);
  }

  return `- ${entries[0]}\n${entries.slice(1).map((entry) => `  ${entry}`).join('\n')}`;
}

function toMihomoProxyGroup(nodes: SubscriptionNode[]): string {
  return [
    '- name: "Auto"',
    '  type: select',
    '  proxies:',
    ...nodes.map((node) => `    - ${JSON.stringify(node.name)}`)
  ].join('\n');
}

function toMihomoRules(ruleSets: SubscriptionRuleSet[]): string {
  const lines = collectRuleLines(ruleSets);

  if (lines.length === 0) {
    return '  - MATCH,DIRECT';
  }

  return lines.map((line) => `  - ${line}`).join('\n');
}

function toSingboxOutbound(node: SubscriptionNode): Record<string, unknown> {
  const outbound: Record<string, unknown> = {
    tag: node.name,
    type: node.protocol,
    server: node.server,
    server_port: node.port,
    ...(node.credentials ?? {})
  };
  const params = node.params ?? {};
  const handledKeys = new Set<string>();
  const tls: Record<string, unknown> = {};
  const transport: Record<string, unknown> = {};
  const maybeServerName = readNodeParamString(params, 'servername') ?? readNodeParamString(params, 'sni');

  if (hasNodeParam(params, 'tls')) {
    handledKeys.add('tls');
    const enabled = readNodeParamBoolean(params, 'tls');
    if (enabled !== null) {
      tls.enabled = enabled;
    }
  }

  if (maybeServerName) {
    handledKeys.add('servername');
    handledKeys.add('sni');
    tls.server_name = maybeServerName;
  }

  if (hasNodeParam(params, 'alpn')) {
    handledKeys.add('alpn');
    tls.alpn = params.alpn;
  }

  if (hasNodeParam(params, 'insecure') || hasNodeParam(params, 'skip-cert-verify')) {
    handledKeys.add('insecure');
    handledKeys.add('skip-cert-verify');
    const insecure = readNodeParamBoolean(params, 'insecure') ?? readNodeParamBoolean(params, 'skip-cert-verify');
    if (insecure !== null) {
      tls.insecure = insecure;
    }
  }

  const fingerprint = readNodeParamString(params, 'fp');
  if (fingerprint) {
    handledKeys.add('fp');
    tls.utls = { enabled: true, fingerprint };
  }

  const publicKey = readNodeParamString(params, 'pbk');
  const shortId = readNodeParamString(params, 'sid');
  if (publicKey || shortId) {
    handledKeys.add('pbk');
    handledKeys.add('sid');
    tls.reality = {
      ...(publicKey ? { public_key: publicKey } : {}),
      ...(shortId ? { short_id: shortId } : {})
    };
  }

  const network = readNodeParamString(params, 'network');
  const path = readNodeParamString(params, 'path');
  const host = readNodeParamString(params, 'host');
  const serviceName = readNodeParamString(params, 'service_name');

  if (network) {
    handledKeys.add('network');
    if (node.protocol === 'hysteria2') {
      outbound.network = network;
    } else {
      transport.type = network;
    }
  }

  if (path) {
    handledKeys.add('path');
    transport.path = path;
  }

  if (host) {
    handledKeys.add('host');
    transport.headers = { Host: host };
  }

  if (serviceName) {
    handledKeys.add('service_name');
    transport.service_name = serviceName;
  }

  const flow = readNodeParamString(params, 'flow');
  if (flow) {
    handledKeys.add('flow');
    outbound.flow = flow;
  }

  const upstreamProxy = readNodeParamString(params, 'upstreamProxy');
  if (upstreamProxy) {
    handledKeys.add('upstreamProxy');
    outbound.detour = upstreamProxy;
  }

  const congestionController = readNodeParamString(params, 'congestion-controller');
  if (congestionController) {
    handledKeys.add('congestion-controller');
    outbound.congestion_control = congestionController;
  }

  const udpRelayMode = readNodeParamString(params, 'udp-relay-mode');
  if (udpRelayMode) {
    handledKeys.add('udp-relay-mode');
    outbound.udp_relay_mode = udpRelayMode;
  }

  if (hasNodeParam(params, 'disable-sni')) {
    handledKeys.add('disable-sni');
    const disableSni = readNodeParamBoolean(params, 'disable-sni');
    if (disableSni !== null) {
      outbound.disable_sni = disableSni;
    }
  }

  const heartbeat = readNodeParamString(params, 'heartbeat');
  if (heartbeat) {
    handledKeys.add('heartbeat');
    outbound.heartbeat = heartbeat;
  }

  if (hasNodeParam(params, 'reduce-rtt')) {
    handledKeys.add('reduce-rtt');
    const reduceRtt = readNodeParamBoolean(params, 'reduce-rtt');
    if (reduceRtt !== null) {
      outbound.zero_rtt_handshake = reduceRtt;
    }
  }

  if (hasNodeParam(params, 'request-timeout')) {
    handledKeys.add('request-timeout');
    const requestTimeout = readNodeParamNumber(params, 'request-timeout');
    if (requestTimeout !== null) {
      outbound.request_timeout = requestTimeout;
    }
  }

  const obfs = readNodeParamString(params, 'obfs');
  const obfsPassword = readNodeParamString(params, 'obfs-password');
  if (obfs || obfsPassword) {
    handledKeys.add('obfs');
    handledKeys.add('obfs-password');
    outbound.obfs = {
      ...(obfs ? { type: obfs } : {}),
      ...(obfsPassword ? { password: obfsPassword } : {})
    };
  }

  if (node.protocol === 'hysteria2') {
    const pinSha256 = readNodeParamStringList(params, 'pinSHA256');
    if (pinSha256) {
      handledKeys.add('pinSHA256');
      tls.certificate_public_key_sha256 = pinSha256;
    }

    const mport = readNodeParamString(params, 'mport');
    if (mport) {
      handledKeys.add('mport');
      const serverPorts = normalizeHysteria2Mport(mport);

      if (serverPorts.length > 0) {
        outbound.server_ports = serverPorts;
      }
    }

    const hopInterval = readNodeParamString(params, 'hop-interval');
    if (hopInterval) {
      handledKeys.add('hop-interval');
      outbound.hop_interval = hopInterval;
    }

    const upMbps = readNodeParamNumberish(params, 'upmbps') ?? readNodeParamNumberish(params, 'up');
    if (upMbps !== null) {
      handledKeys.add('upmbps');
      handledKeys.add('up');
      outbound.up_mbps = upMbps;
    }

    const downMbps = readNodeParamNumberish(params, 'downmbps') ?? readNodeParamNumberish(params, 'down');
    if (downMbps !== null) {
      handledKeys.add('downmbps');
      handledKeys.add('down');
      outbound.down_mbps = downMbps;
    }
  }

  if (Object.keys(tls).length > 0) {
    outbound.tls = tls;
  }

  if (Object.keys(transport).length > 0) {
    outbound.transport = transport;
  }

  for (const [key, value] of Object.entries(params)) {
    if (!handledKeys.has(key)) {
      outbound[key] = value;
    }
  }

  return outbound;
}

function toSingboxOutboundItems(nodes: SubscriptionNode[]): string {
  return nodes.map((node) => indentBlock(JSON.stringify(toSingboxOutbound(node), null, 2), 4)).join(',\n');
}

function toSingboxOutbounds(nodes: SubscriptionNode[]): string {
  const outbounds = nodes.map((node) => toSingboxOutbound(node));

  return JSON.stringify(outbounds, null, 2);
}

const singboxRuleOptionTokens = new Set(['NO-RESOLVE']);

function buildSingboxRuleAction(targetRaw: string): Record<string, unknown> {
  const target = stripWrappingQuotes(targetRaw);
  const normalized = target.toUpperCase();

  if (normalized === 'REJECT') {
    return { action: 'reject' };
  }

  if (normalized === 'REJECT-DROP') {
    return {
      action: 'reject',
      method: 'drop'
    };
  }

  if (normalized === 'REJECT-TINYGIF' || normalized === 'REJECT-UDP') {
    return { action: 'reject' };
  }

  return {
    action: 'route',
    outbound: normalized === 'DIRECT' ? 'direct' : target
  };
}

function buildStringArrayCondition(field: string, value: string): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value);

  if (!normalized) {
    return null;
  }

  return { [field]: [normalized] };
}

function buildLowercaseStringArrayCondition(field: string, value: string): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  return { [field]: [normalized] };
}

function normalizePortRange(value: string): string {
  return value.replace(/\s+/g, '').replace('-', ':');
}

function buildPortCondition(
  directField: string,
  rangeField: string,
  value: string
): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value);

  if (!normalized) {
    return null;
  }

  if (normalized.includes('-') || normalized.includes(':')) {
    return { [rangeField]: [normalizePortRange(normalized)] };
  }

  const parsed = Number(normalized);

  if (Number.isInteger(parsed) && parsed > 0) {
    return { [directField]: [parsed] };
  }

  return { [rangeField]: [normalized] };
}

function buildNetworkCondition(value: string): Record<string, unknown> | null {
  const items = stripWrappingQuotes(value)
    .split(/[|/]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (items.length === 0) {
    return null;
  }

  return { network: items };
}

function buildClashModeCondition(value: string): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  return { clash_mode: normalized };
}

function buildGeoCondition(
  field: string,
  privateField: string,
  value: string
): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === 'private' || normalized === 'lan') {
    return { [privateField]: true };
  }

  return { [field]: [normalized] };
}

function buildIpCidrCondition(
  field: string,
  privateField: string,
  value: string
): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(value);

  if (!normalized) {
    return null;
  }

  if (normalized.toLowerCase() === 'private' || normalized.toLowerCase() === 'lan') {
    return { [privateField]: true };
  }

  return { [field]: [normalized] };
}

function buildSingboxRuleMatch(type: string, payload: string): Record<string, unknown> | null {
  switch (type) {
    case 'MATCH':
    case 'FINAL':
      return payload ? null : {};
    case 'DOMAIN':
      return buildStringArrayCondition('domain', payload);
    case 'DOMAIN-SUFFIX':
      return buildStringArrayCondition('domain_suffix', payload);
    case 'DOMAIN-KEYWORD':
      return buildStringArrayCondition('domain_keyword', payload);
    case 'DOMAIN-REGEX':
      return buildStringArrayCondition('domain_regex', payload);
    case 'GEOSITE':
      return buildLowercaseStringArrayCondition('geosite', payload);
    case 'GEOIP':
      return buildGeoCondition('geoip', 'ip_is_private', payload);
    case 'SRC-GEOIP':
      return buildGeoCondition('source_geoip', 'source_ip_is_private', payload);
    case 'IP-CIDR':
    case 'IP-CIDR6':
      return buildIpCidrCondition('ip_cidr', 'ip_is_private', payload);
    case 'SRC-IP-CIDR':
      return buildIpCidrCondition('source_ip_cidr', 'source_ip_is_private', payload);
    case 'PORT':
    case 'DST-PORT':
      return buildPortCondition('port', 'port_range', payload);
    case 'SRC-PORT':
      return buildPortCondition('source_port', 'source_port_range', payload);
    case 'PROCESS-NAME':
      return buildStringArrayCondition('process_name', payload);
    case 'PROCESS-PATH':
      return buildStringArrayCondition('process_path', payload);
    case 'PROCESS-PATH-REGEX':
      return buildStringArrayCondition('process_path_regex', payload);
    case 'PACKAGE-NAME':
      return buildStringArrayCondition('package_name', payload);
    case 'RULE-SET':
      return buildStringArrayCondition('rule_set', payload);
    case 'NETWORK':
      return buildNetworkCondition(payload);
    case 'PROTOCOL':
      return buildLowercaseStringArrayCondition('protocol', payload);
    case 'CLASH-MODE':
      return buildClashModeCondition(payload);
    case 'INBOUND-TAG':
      return buildStringArrayCondition('inbound', payload);
    default:
      return null;
  }
}

function parseSingboxRuleLine(line: string): Record<string, unknown> | null {
  const tokens = line
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  const typeToken = tokens[0];

  if (!typeToken) {
    return null;
  }

  const type = typeToken.toUpperCase();
  let targetIndex = tokens.length - 1;

  while (targetIndex > 0) {
    const token = tokens[targetIndex];

    if (!token || !singboxRuleOptionTokens.has(token.toUpperCase())) {
      break;
    }

    targetIndex -= 1;
  }

  if (targetIndex <= 0) {
    return null;
  }

  const targetToken = tokens[targetIndex];

  if (!targetToken) {
    return null;
  }

  const payload = tokens.slice(1, targetIndex).join(',').trim();
  const match = buildSingboxRuleMatch(type, payload);

  if (!match) {
    return null;
  }

  return {
    ...match,
    ...buildSingboxRuleAction(targetToken)
  };
}

function toSingboxRuleObjects(ruleSets: SubscriptionRuleSet[]): Array<Record<string, unknown>> {
  return collectRuleLines(ruleSets)
    .map((line) => parseSingboxRuleLine(line))
    .filter((rule): rule is Record<string, unknown> => rule !== null);
}

function toSingboxRuleItems(ruleSets: SubscriptionRuleSet[]): string {
  return toSingboxRuleObjects(ruleSets)
    .map((rule) => indentBlock(JSON.stringify(rule, null, 2), 8))
    .join(',\n');
}

function toSingboxRules(ruleSets: SubscriptionRuleSet[]): string {
  const rules = toSingboxRuleObjects(ruleSets);

  return JSON.stringify(rules, null, 2);
}

const mihomoBuiltinReferences = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE']);

function sanitizeStaticMihomoTemplate(content: string, nodeNames: string[]): string {
  try {
    let nextContent = content;
    let parsed = parseMihomoTemplateStructure(nextContent);

    if (parsed.useDynamicProxies && parsed.staticProxies.length > 0) {
      nextContent = normalizeManagedMihomoTemplateContent(nextContent);
      parsed = parseMihomoTemplateStructure(nextContent);
    }

    if (parsed.useDynamicProxyGroups || parsed.proxyGroups.length === 0) {
      return nextContent;
    }

    const groupNames = new Set(
      parsed.proxyGroups
        .map((group) => (typeof group.name === 'string' ? group.name.trim() : ''))
        .filter(Boolean)
    );
    const nodeNameSet = new Set(nodeNames.map((name) => name.trim()).filter(Boolean));
    const providerNameSet = new Set(parsed.proxyProviders.map((name) => name.trim()).filter(Boolean));
    const nextProxyGroups = parsed.proxyGroups.map((group) => {
      const nextGroup = JSON.parse(JSON.stringify(group)) as Record<string, unknown>;

      if (Array.isArray(nextGroup.proxies)) {
        nextGroup.proxies = nextGroup.proxies.filter((item) => {
          if (typeof item !== 'string') {
            return true;
          }

          const normalized = item.trim();
          return (
            !normalized ||
            mihomoBuiltinReferences.has(normalized) ||
            nodeNameSet.has(normalized) ||
            groupNames.has(normalized) ||
            providerNameSet.has(normalized)
          );
        });
      }

      if (Array.isArray(nextGroup.use)) {
        nextGroup.use = nextGroup.use.filter((item) => {
          if (typeof item !== 'string') {
            return true;
          }

          const normalized = item.trim();
          return !normalized || providerNameSet.has(normalized);
        });
      }

      return nextGroup;
    });

    if (JSON.stringify(nextProxyGroups) === JSON.stringify(parsed.proxyGroups)) {
      return nextContent;
    }

    return updateMihomoTemplateStructure(nextContent, {
      useDynamicProxies: parsed.useDynamicProxies,
      useDynamicProxyGroups: parsed.useDynamicProxyGroups,
      useDynamicRules: parsed.useDynamicRules,
      proxyGroups: nextProxyGroups,
      rules: parsed.rules
    });
  } catch {
    return content;
  }
}

export const mihomoRenderer: SubscriptionRenderer = {
  target: 'mihomo',
  mimeType: 'text/yaml; charset=utf-8',
  render(context): string {
    const templateContent = sanitizeStaticMihomoTemplate(
      context.template.content,
      context.nodes.map((node) => node.name)
    );
    const proxiesBlock = context.nodes.length
      ? indentBlock(context.nodes.map(toMihomoProxy).join('\n'), 2)
      : '  []';

    const proxyGroupsBlock = indentBlock(toMihomoProxyGroup(context.nodes), 2);
    const rulesBlock = toMihomoRules(context.ruleSets);

    return replaceTemplateSlots(templateContent, {
      proxies: proxiesBlock,
      proxy_groups: proxyGroupsBlock,
      rules: rulesBlock
    });
  }
};

export const singboxRenderer: SubscriptionRenderer = {
  target: 'singbox',
  mimeType: 'application/json; charset=utf-8',
  render(context): string {
    const outboundItems = toSingboxOutboundItems(context.nodes);
    const ruleItems = toSingboxRuleItems(context.ruleSets);
    return replaceTemplateSlots(context.template.content, {
      outbounds: indentBlock(toSingboxOutbounds(context.nodes), 2).trimStart(),
      outbound_items: outboundItems,
      outbound_items_with_leading_comma: outboundItems ? `,\n${outboundItems}` : '',
      rules: indentBlock(toSingboxRules(context.ruleSets), 6).trimStart(),
      rules_with_leading_comma: ruleItems ? `,\n${ruleItems}` : ''
    });
  }
};

const renderers: Record<SubscriptionTarget, SubscriptionRenderer> = {
  mihomo: mihomoRenderer,
  singbox: singboxRenderer
};

export function getRenderer(target: SubscriptionTarget): SubscriptionRenderer | undefined {
  return renderers[target];
}

export function getSupportedRendererTargets(): SubscriptionTarget[] {
  return Object.keys(renderers) as SubscriptionTarget[];
}

export function assertRendererAvailable(input: SubscriptionCompileInput): SubscriptionRenderer | AppError {
  const renderer = getRenderer(input.target);

  if (!renderer) {
    return new AppError(
      createAppError(APP_ERROR_CODES.rendererNotFound, 'renderer is not registered', {
        target: input.target
      })
    );
  }

  return renderer;
}

export class AppError extends Error {
  readonly payload;

  constructor(payload: ReturnType<typeof createAppError>) {
    super(payload.message);
    this.name = 'AppError';
    this.payload = payload;
  }
}
