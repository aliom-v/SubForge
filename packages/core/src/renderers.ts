import { createAppError, APP_ERROR_CODES, type SubscriptionTarget } from '@subforge/shared';
import type {
  SubscriptionCompileInput,
  SubscriptionNode,
  SubscriptionRenderContext,
  SubscriptionRuleSet
} from './models';

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

function readNodeParamString(params: SubscriptionNode['params'], key: string): string | null {
  const value = params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNodeParamNumber(params: SubscriptionNode['params'], key: string): number | null {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNodeParamBoolean(params: SubscriptionNode['params'], key: string): boolean | null {
  const value = params?.[key];
  return typeof value === 'boolean' ? value : null;
}

function hasNodeParam(params: SubscriptionNode['params'], key: string): boolean {
  return Boolean(params) && Object.prototype.hasOwnProperty.call(params, key);
}

function toMihomoProxy(node: SubscriptionNode): string {
  const entries = [
    `name: ${JSON.stringify(node.name)}`,
    `type: ${node.protocol}`,
    `server: ${node.server}`,
    `port: ${node.port}`
  ];

  for (const [key, value] of Object.entries(node.credentials ?? {})) {
    entries.push(`${key}: ${JSON.stringify(value)}`);
  }

  for (const [key, value] of Object.entries(node.params ?? {})) {
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
  const lines = ruleSets.flatMap((ruleSet) =>
    ruleSet.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

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

  if (hasNodeParam(params, 'insecure')) {
    handledKeys.add('insecure');
    const insecure = readNodeParamBoolean(params, 'insecure');
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
    transport.type = network;
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

function toSingboxRuleObjects(ruleSets: SubscriptionRuleSet[]): Array<Record<string, unknown>> {
  return ruleSets.flatMap((ruleSet) =>
    ruleSet.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        type: 'logical',
        mode: 'default',
        remark: ruleSet.name,
        rule: line
      }))
  );
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

export const mihomoRenderer: SubscriptionRenderer = {
  target: 'mihomo',
  mimeType: 'text/yaml; charset=utf-8',
  render(context): string {
    const proxiesBlock = context.nodes.length
      ? indentBlock(context.nodes.map(toMihomoProxy).join('\n'), 2)
      : '  []';

    const proxyGroupsBlock = indentBlock(toMihomoProxyGroup(context.nodes), 2);
    const rulesBlock = toMihomoRules(context.ruleSets);

    return replaceTemplateSlots(context.template.content, {
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
