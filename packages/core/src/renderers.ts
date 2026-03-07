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
    entries.push(`${key}: ${JSON.stringify(value)}`);
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

function toSingboxOutbounds(nodes: SubscriptionNode[]): string {
  const outbounds = nodes.map((node) => ({
    tag: node.name,
    type: node.protocol,
    server: node.server,
    server_port: node.port,
    ...node.credentials,
    ...node.params
  }));

  return JSON.stringify(outbounds, null, 2);
}

function toSingboxRules(ruleSets: SubscriptionRuleSet[]): string {
  const rules = ruleSets.flatMap((ruleSet) =>
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
    return replaceTemplateSlots(context.template.content, {
      outbounds: indentBlock(toSingboxOutbounds(context.nodes), 2).trimStart(),
      rules: indentBlock(toSingboxRules(context.ruleSets), 6).trimStart()
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
