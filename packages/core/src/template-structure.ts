import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const MIHOMO_PROXIES_MARKER = '__SUBFORGE_TEMPLATE_MIHOMO_PROXIES__';
const MIHOMO_PROXY_GROUPS_MARKER = '__SUBFORGE_TEMPLATE_MIHOMO_PROXY_GROUPS__';
const MIHOMO_RULES_MARKER = '__SUBFORGE_TEMPLATE_MIHOMO_RULES__';
const SINGBOX_OUTBOUNDS_MARKER = '__SUBFORGE_TEMPLATE_SINGBOX_OUTBOUNDS__';
const SINGBOX_RULES_MARKER = '__SUBFORGE_TEMPLATE_SINGBOX_RULES__';
const TEMPLATE_PLACEHOLDER_KEY = '__subforge_template_placeholder';

export interface MihomoTemplateStructure {
  useDynamicProxies: boolean;
  useDynamicProxyGroups: boolean;
  useDynamicRules: boolean;
  staticProxies: Array<Record<string, unknown>>;
  proxyGroups: Array<Record<string, unknown>>;
  proxyProviders: string[];
  rules: string[];
  warnings: string[];
}

export interface SingboxTemplateStructure {
  useDynamicOutbounds: boolean;
  useDynamicRules: boolean;
  staticOutbounds: Array<Record<string, unknown>>;
  routeRules: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface MihomoTemplateStructureUpdate {
  useDynamicProxies: boolean;
  useDynamicProxyGroups: boolean;
  useDynamicRules: boolean;
  proxyGroups: Array<Record<string, unknown>>;
  rules: string[];
}

export interface SingboxTemplateStructureUpdate {
  useDynamicOutbounds: boolean;
  useDynamicRules: boolean;
  staticOutbounds: Array<Record<string, unknown>>;
  routeRules: Array<Record<string, unknown>>;
}

interface ParsedMihomoTemplateDocument {
  root: Record<string, unknown>;
  structure: MihomoTemplateStructure;
}

interface ParsedSingboxTemplateDocument {
  root: Record<string, unknown>;
  structure: SingboxTemplateStructure;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonLike<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceYamlMarkerBlock(template: string, key: string, marker: string, replacement: string): string {
  const pattern = new RegExp(`^([ \\t]*${key}:)\\s*(?:\"${marker}\"|'${marker}'|${marker})\\s*$`, 'm');
  return template.replace(pattern, `$1\n${replacement}`);
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

function toParseableMihomoTemplate(content: string): string {
  return content
    .replace(/^([ \t]*proxies:)\s*\n[ \t]*\{\{proxies\}\}\s*$/m, `$1 "${MIHOMO_PROXIES_MARKER}"`)
    .replace(/^([ \t]*proxy-groups:)\s*\n[ \t]*\{\{proxy_groups\}\}\s*$/m, `$1 "${MIHOMO_PROXY_GROUPS_MARKER}"`)
    .replace(/^([ \t]*rules:)\s*\n[ \t]*\{\{rules\}\}\s*$/m, `$1 "${MIHOMO_RULES_MARKER}"`);
}

function createPlaceholderRecord(value: string): Record<string, string> {
  return { [TEMPLATE_PLACEHOLDER_KEY]: value };
}

function isPlaceholderRecord(value: unknown, placeholder: string): boolean {
  return isObjectRecord(value) && value[TEMPLATE_PLACEHOLDER_KEY] === placeholder;
}

function toParseableSingboxTemplate(content: string): string {
  return content
    .replace(/"outbounds"\s*:\s*\{\{outbounds\}\}/g, `"outbounds": [${JSON.stringify(createPlaceholderRecord('outbounds'))}]`)
    .replace(/\{\{outbound_items_with_leading_comma\}\}/g, `, ${JSON.stringify(createPlaceholderRecord('outbound_items'))}`)
    .replace(/\{\{outbound_items\}\}/g, JSON.stringify(createPlaceholderRecord('outbound_items')))
    .replace(/"rules"\s*:\s*\{\{rules\}\}/g, `"rules": [${JSON.stringify(createPlaceholderRecord('rules'))}]`)
    .replace(/\{\{rules_with_leading_comma\}\}/g, `, ${JSON.stringify(createPlaceholderRecord('rule_items'))}`);
}

function parseMihomoTemplateDocument(content: string): ParsedMihomoTemplateDocument {
  let parsed: unknown;

  try {
    parsed = parseYaml(toParseableMihomoTemplate(content)) as unknown;
  } catch {
    throw new Error('当前模板不是合法的 Mihomo YAML，结构化助手暂时无法解析');
  }

  if (!isObjectRecord(parsed)) {
    throw new Error('当前模板不是合法的 Mihomo YAML 对象，结构化助手暂时无法解析');
  }

  const warnings: string[] = [];
  const staticProxies: Array<Record<string, unknown>> = [];
  const proxyGroups: Array<Record<string, unknown>> = [];
  const proxyProviders: string[] = [];
  const rules: string[] = [];
  const proxiesValue = parsed.proxies;
  const proxyGroupsValue = parsed['proxy-groups'];
  const proxyProvidersValue = parsed['proxy-providers'];
  const rulesValue = parsed.rules;

  if (Array.isArray(proxiesValue)) {
    for (const item of proxiesValue) {
      if (isObjectRecord(item)) {
        staticProxies.push(cloneJsonLike(item));
      } else {
        warnings.push('检测到无法识别的 proxy 条目，结构化助手已忽略该条目。');
      }
    }
  } else if (proxiesValue !== undefined && proxiesValue !== MIHOMO_PROXIES_MARKER) {
    warnings.push('当前模板的 proxies 不是列表结构，结构化助手不会改写这部分内容。');
  }

  if (Array.isArray(proxyGroupsValue)) {
    for (const item of proxyGroupsValue) {
      if (isObjectRecord(item)) {
        proxyGroups.push(cloneJsonLike(item));
      } else {
        warnings.push('检测到无法识别的 proxy-group 条目，结构化助手已忽略该条目。');
      }
    }
  } else if (proxyGroupsValue !== undefined && proxyGroupsValue !== MIHOMO_PROXY_GROUPS_MARKER) {
    warnings.push('当前模板的 proxy-groups 不是列表结构，结构化助手不会改写这部分内容。');
  }

  if (isObjectRecord(proxyProvidersValue)) {
    for (const key of Object.keys(proxyProvidersValue)) {
      if (key.trim()) {
        proxyProviders.push(key.trim());
      }
    }
  } else if (proxyProvidersValue !== undefined) {
    warnings.push('当前模板的 proxy-providers 不是对象结构，结构化助手不会改写这部分内容。');
  }

  if (Array.isArray(rulesValue)) {
    for (const item of rulesValue) {
      if (typeof item === 'string' && item.trim()) {
        rules.push(item.trim());
      } else if (item != null) {
        warnings.push('检测到非字符串的 Mihomo rule，结构化助手已忽略该条目。');
      }
    }
  } else if (rulesValue !== undefined && rulesValue !== MIHOMO_RULES_MARKER) {
    warnings.push('当前模板的 rules 不是字符串列表，结构化助手不会改写这部分内容。');
  }

  if (!content.includes('{{proxies}}')) {
    warnings.push('当前模板未包含 {{proxies}} 动态节点占位符，订阅输出不会自动注入节点。');
  }

  return {
    root: parsed,
    structure: {
      useDynamicProxies: content.includes('{{proxies}}'),
      useDynamicProxyGroups: content.includes('{{proxy_groups}}'),
      useDynamicRules: content.includes('{{rules}}'),
      staticProxies,
      proxyGroups,
      proxyProviders,
      rules,
      warnings
    }
  };
}

function parseSingboxTemplateDocument(content: string): ParsedSingboxTemplateDocument {
  let parsed: unknown;

  try {
    parsed = JSON.parse(toParseableSingboxTemplate(content)) as unknown;
  } catch {
    throw new Error('当前模板不是合法的 sing-box JSON，结构化助手暂时无法解析');
  }

  if (!isObjectRecord(parsed)) {
    throw new Error('当前模板不是合法的 sing-box JSON 对象，结构化助手暂时无法解析');
  }

  const warnings: string[] = [];
  const staticOutbounds: Array<Record<string, unknown>> = [];
  const routeRules: Array<Record<string, unknown>> = [];
  const outboundsValue = parsed.outbounds;

  if (Array.isArray(outboundsValue)) {
    for (const item of outboundsValue) {
      if (isPlaceholderRecord(item, 'outbounds') || isPlaceholderRecord(item, 'outbound_items')) {
        continue;
      }

      if (isObjectRecord(item)) {
        staticOutbounds.push(cloneJsonLike(item));
      } else {
        warnings.push('检测到无法识别的 outbound 条目，结构化助手已忽略该条目。');
      }
    }
  } else if (outboundsValue !== undefined) {
    warnings.push('当前模板的 outbounds 不是数组结构，结构化助手不会改写这部分内容。');
  }

  if (isObjectRecord(parsed.route)) {
    if (Array.isArray(parsed.route.rules)) {
      for (const item of parsed.route.rules) {
        if (isPlaceholderRecord(item, 'rules') || isPlaceholderRecord(item, 'rule_items')) {
          continue;
        }

        if (isObjectRecord(item)) {
          routeRules.push(cloneJsonLike(item));
        } else {
          warnings.push('检测到无法识别的 route.rules 条目，结构化助手已忽略该条目。');
        }
      }
    } else if (parsed.route.rules !== undefined) {
      warnings.push('当前模板的 route.rules 不是数组结构，结构化助手不会改写这部分内容。');
    }
  } else if (parsed.route !== undefined) {
    warnings.push('当前模板的 route 不是对象结构，结构化助手不会改写 route.rules。');
  }

  if (
    !content.includes('{{outbound_items}}') &&
    !content.includes('{{outbound_items_with_leading_comma}}') &&
    !content.includes('{{outbounds}}')
  ) {
    warnings.push('当前模板未包含动态 outbounds 占位符，订阅输出不会自动注入节点。');
  }

  return {
    root: parsed,
    structure: {
      useDynamicOutbounds:
        content.includes('{{outbound_items}}') ||
        content.includes('{{outbound_items_with_leading_comma}}') ||
        content.includes('{{outbounds}}'),
      useDynamicRules: content.includes('{{rules}}') || content.includes('{{rules_with_leading_comma}}'),
      staticOutbounds,
      routeRules,
      warnings
    }
  };
}

export function parseMihomoTemplateStructure(content: string): MihomoTemplateStructure {
  return parseMihomoTemplateDocument(content).structure;
}

export function normalizeManagedMihomoTemplateContent(content: string): string {
  const parsed = parseMihomoTemplateDocument(content).structure;

  return updateMihomoTemplateStructure(content, {
    useDynamicProxies: true,
    useDynamicProxyGroups: parsed.useDynamicProxyGroups,
    useDynamicRules: parsed.useDynamicRules,
    proxyGroups: parsed.proxyGroups,
    rules: parsed.rules
  });
}

export function updateMihomoTemplateStructure(
  content: string,
  next: MihomoTemplateStructureUpdate
): string {
  const { root } = parseMihomoTemplateDocument(content);
  const templateObject: Record<string, unknown> = cloneJsonLike(root);

  if (next.useDynamicProxies) {
    templateObject.proxies = MIHOMO_PROXIES_MARKER;
  }

  templateObject['proxy-groups'] = next.useDynamicProxyGroups ? MIHOMO_PROXY_GROUPS_MARKER : cloneJsonLike(next.proxyGroups);
  templateObject.rules = next.useDynamicRules ? MIHOMO_RULES_MARKER : next.rules.map((item) => item.trim()).filter(Boolean);

  let rendered = stringifyYaml(templateObject, { lineWidth: 0 });

  if (next.useDynamicProxies) {
    rendered = replaceYamlMarkerBlock(rendered, 'proxies', MIHOMO_PROXIES_MARKER, '{{proxies}}');
  }

  if (next.useDynamicProxyGroups) {
    rendered = replaceYamlMarkerBlock(rendered, 'proxy-groups', MIHOMO_PROXY_GROUPS_MARKER, '{{proxy_groups}}');
  }

  if (next.useDynamicRules) {
    rendered = replaceYamlMarkerBlock(rendered, 'rules', MIHOMO_RULES_MARKER, '{{rules}}');
  }

  return rendered;
}

export function parseSingboxTemplateStructure(content: string): SingboxTemplateStructure {
  return parseSingboxTemplateDocument(content).structure;
}

export function updateSingboxTemplateStructure(
  content: string,
  next: SingboxTemplateStructureUpdate
): string {
  const { root } = parseSingboxTemplateDocument(content);
  const templateObject: Record<string, unknown> = cloneJsonLike(root);
  const staticOutbounds = cloneJsonLike(next.staticOutbounds);
  const routeRules = cloneJsonLike(next.routeRules);

  templateObject.outbounds = next.useDynamicOutbounds ? SINGBOX_OUTBOUNDS_MARKER : staticOutbounds;

  const route = isObjectRecord(templateObject.route) ? templateObject.route : {};
  route.rules = next.useDynamicRules ? SINGBOX_RULES_MARKER : routeRules;
  templateObject.route = route;

  let rendered = JSON.stringify(templateObject, null, 2);

  if (next.useDynamicOutbounds) {
    rendered = rendered.replace(
      `"outbounds": "${SINGBOX_OUTBOUNDS_MARKER}"`,
      staticOutbounds.length > 0
        ? `"outbounds": [\n${staticOutbounds.map((item) => formatJsonBlockLines(item, 4)).join(',\n')}{{outbound_items_with_leading_comma}}\n  ]`
        : '"outbounds": [\n{{outbound_items}}\n  ]'
    );
  }

  if (next.useDynamicRules) {
    rendered = rendered.replace(
      `"rules": "${SINGBOX_RULES_MARKER}"`,
      routeRules.length > 0
        ? `"rules": [\n${routeRules.map((item) => formatJsonBlockLines(item, 8)).join(',\n')}{{rules_with_leading_comma}}\n      ]`
        : '"rules": {{rules}}'
    );
  }

  return rendered;
}
