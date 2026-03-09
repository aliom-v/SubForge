import type { RuleSourceFormat } from '@subforge/shared';

export interface RuleSourceSyncDetails {
  sourceUrl: string;
  format: RuleSourceFormat;
  durationMs: number;
  stage?: 'fetch' | 'parse' | 'compare';
  severity?: 'info' | 'warning' | 'error';
  errorCode?: string;
  parser?: RuleSourceFormat;
  contentType?: string;
  sourceShape?: string;
  rawLineCount?: number;
  extractedRuleCount?: number;
  duplicateRuleCount?: number;
  ignoredLineCount?: number;
  upstreamStatus?: number;
  fetchedBytes?: number;
  ruleCount?: number;
  contentHash?: string;
  reason?: string;
  retryable?: boolean;
  operatorHint?: string;
  supportedShapes?: string[];
  contentPreview?: string;
}

interface BuildRuleSourceSyncDiagnosticsInput {
  errorCode?: string;
  format: RuleSourceFormat;
  upstreamStatus?: number;
  sourceShape?: string;
  content?: string;
}

const SUPPORTED_RULE_SOURCE_SHAPES: Record<RuleSourceFormat, string[]> = {
  text: [
    '纯文本：每行一条规则，例如 DOMAIN-SUFFIX,example.com,Proxy',
    '纯文本支持注释行和空行，非规则内容会被忽略'
  ],
  yaml: [
    'YAML 列表：rules: ["DOMAIN-SUFFIX,example.com,Proxy"]',
    'YAML 列表：rules:\n  - DOMAIN-SUFFIX,example.com,Proxy',
    'YAML 块文本：payload: |\n  DOMAIN-SUFFIX,example.com,Proxy'
  ],
  json: [
    'JSON 数组：["DOMAIN-SUFFIX,example.com,Proxy"]',
    'JSON 对象：{"rules":["DOMAIN-SUFFIX,example.com,Proxy"]}',
    'JSON 结构化对象：{"type":"DOMAIN-SUFFIX","value":"example.com","action":"Proxy"}'
  ]
};

function buildHttpErrorHint(upstreamStatus?: number): { retryable?: boolean; operatorHint: string } {
  if (upstreamStatus === 404) {
    return {
      retryable: false,
      operatorHint: '请检查规则源 URL 是否正确，并确认上游文件路径没有变更'
    };
  }

  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return {
      retryable: false,
      operatorHint: '上游可能需要鉴权或拒绝了当前请求，请确认源地址是否可匿名访问'
    };
  }

  if (upstreamStatus === 429) {
    return {
      retryable: true,
      operatorHint: '上游返回了限流，请稍后重试或降低同步频率'
    };
  }

  if (typeof upstreamStatus === 'number' && upstreamStatus >= 500) {
    return {
      retryable: true,
      operatorHint: '上游服务当前异常，可稍后重试并检查源站日志或可用性'
    };
  }

  return {
    retryable: false,
    operatorHint: '请检查上游返回状态、访问权限和返回内容是否符合预期'
  };
}

function buildNoValidRulesHint(format: RuleSourceFormat): string {
  if (format === 'text') {
    return '请确认上游内容是逐行规则文本，而不是说明文字、HTML 页面或空白占位内容';
  }

  if (format === 'yaml') {
    return '请确认 YAML 中存在 rules / payload 字段，且字段内能提取出规则字符串';
  }

  return '请确认 JSON 中存在规则字符串数组、rules / payload / data / items 字段，或带 type/value/action 的结构化规则对象';
}

export function buildRuleSourceContentPreview(content: string, maxLines = 4, maxChars = 240): string | undefined {
  const normalized = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

export function buildRuleSourceSyncDiagnostics(
  input: BuildRuleSourceSyncDiagnosticsInput
): Pick<RuleSourceSyncDetails, 'retryable' | 'operatorHint' | 'supportedShapes' | 'contentPreview'> {
  const diagnostics: Pick<RuleSourceSyncDetails, 'retryable' | 'operatorHint' | 'supportedShapes' | 'contentPreview'> = {};
  const supportedShapes = SUPPORTED_RULE_SOURCE_SHAPES[input.format];
  const contentPreview = input.content ? buildRuleSourceContentPreview(input.content) : undefined;

  if (contentPreview) {
    diagnostics.contentPreview = contentPreview;
  }

  switch (input.errorCode) {
    case 'FETCH_TIMEOUT': {
      diagnostics.retryable = true;
      diagnostics.operatorHint = '请检查上游响应速度，或适当增大 SYNC_HTTP_TIMEOUT_MS';
      return diagnostics;
    }
    case 'FETCH_NETWORK_ERROR': {
      diagnostics.retryable = true;
      diagnostics.operatorHint = '请检查上游域名解析、TLS 证书和 Worker 到上游的网络连通性';
      return diagnostics;
    }
    case 'UPSTREAM_HTTP_ERROR': {
      const httpHint = buildHttpErrorHint(input.upstreamStatus);
      diagnostics.retryable = httpHint.retryable;
      diagnostics.operatorHint = httpHint.operatorHint;
      return diagnostics;
    }
    case 'EMPTY_UPSTREAM_CONTENT': {
      diagnostics.retryable = false;
      diagnostics.operatorHint = '上游请求成功但没有返回规则内容，请确认文件不是空文件或占位响应';
      diagnostics.supportedShapes = supportedShapes;
      return diagnostics;
    }
    case 'INVALID_JSON': {
      diagnostics.retryable = false;
      diagnostics.operatorHint = '请确认规则源格式选择为 JSON，且上游实际返回的是合法 JSON 文本';
      diagnostics.supportedShapes = supportedShapes;
      return diagnostics;
    }
    case 'UNSUPPORTED_JSON_SHAPE': {
      diagnostics.retryable = false;
      diagnostics.operatorHint = input.sourceShape
        ? `当前检测到的 JSON 结构为 ${input.sourceShape}，请改成支持的规则结构`
        : '当前 JSON 结构无法提取规则，请改成支持的规则结构';
      diagnostics.supportedShapes = supportedShapes;
      return diagnostics;
    }
    case 'NO_VALID_RULES': {
      diagnostics.retryable = false;
      diagnostics.operatorHint = buildNoValidRulesHint(input.format);
      diagnostics.supportedShapes = supportedShapes;
      return diagnostics;
    }
    default:
      return diagnostics;
  }
}
