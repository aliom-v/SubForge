import type { JsonValue, NodeRecord } from '@subforge/shared';

import type { NodeEditorState } from './app-types';

export interface NodeChainIssueLike {
  nodeId: string;
  kind: string;
  reference?: string | null;
  message: string;
}

export interface NodeUpstreamOption {
  value: string;
  label: string;
  disabled?: boolean;
  legacy?: boolean;
}

export function createNodeEditorState(node: NodeRecord): NodeEditorState {
  const upstreamProxy =
    typeof node.params?.upstreamProxy === 'string'
      ? node.params.upstreamProxy.trim()
      : '';
  const paramsText = node.params
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(node.params).filter(([key]) => key !== 'upstreamProxy')
        ),
        null,
        2
      )
    : '';

  return {
    nodeId: node.id,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: String(node.port),
    enabled: node.enabled,
    upstreamProxy,
    credentialsText: node.credentials ? JSON.stringify(node.credentials, null, 2) : '',
    paramsText: paramsText === '{}' ? '' : paramsText
  };
}

export function parseOptionalJsonObjectInput(
  value: string,
  fieldName: string
): Record<string, JsonValue> | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${fieldName} 必须是合法 JSON 对象`);
  }

  if (parsed === null) {
    return null;
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`);
  }

  return parsed as Record<string, JsonValue>;
}

export function buildNodeEditorParams(
  params: Record<string, JsonValue> | null,
  upstreamProxy: string
): Record<string, JsonValue> | null {
  const nextParams = { ...(params ?? {}) };
  delete nextParams.upstreamProxy;

  if (upstreamProxy.trim()) {
    nextParams.upstreamProxy = upstreamProxy.trim();
  }

  return Object.keys(nextParams).length > 0 ? nextParams : null;
}

export function buildNodeEditorDraft(
  currentNode: NodeRecord,
  editor: Pick<NodeEditorState, 'name' | 'protocol' | 'server' | 'enabled'>,
  port: number,
  credentials: Record<string, JsonValue> | null,
  params: Record<string, JsonValue> | null
): NodeRecord {
  const nextNode: NodeRecord = {
    ...currentNode,
    name: editor.name,
    protocol: editor.protocol,
    server: editor.server,
    port,
    enabled: editor.enabled
  };

  if (credentials) {
    nextNode.credentials = credentials;
  } else {
    delete nextNode.credentials;
  }

  if (params) {
    nextNode.params = params;
  } else {
    delete nextNode.params;
  }

  return nextNode;
}

export function buildNodeChainIssueKey(issue: NodeChainIssueLike): string {
  return [issue.nodeId, issue.kind, issue.reference ?? '', issue.message].join('::');
}

export function extractNodeChainIssueMessages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['节点链路校验失败'];
  }

  const messages = value.flatMap((item) => {
    if (
      typeof item === 'object' &&
      item !== null &&
      'message' in item &&
      typeof item.message === 'string'
    ) {
      return [item.message];
    }

    return [];
  });

  return messages.length > 0 ? messages : ['节点链路校验失败'];
}

export function buildNodeUpstreamOptions(
  nodes: NodeRecord[],
  editor: Pick<NodeEditorState, 'nodeId' | 'upstreamProxy'>
): NodeUpstreamOption[] {
  const grouped = new Map<string, { enabled: boolean; count: number }>();

  for (const node of nodes) {
    if (node.id === editor.nodeId) {
      continue;
    }

    const name = node.name.trim();

    if (!name) {
      continue;
    }

    const current = grouped.get(name) ?? { enabled: false, count: 0 };
    grouped.set(name, {
      enabled: current.enabled || node.enabled,
      count: current.count + 1
    });
  }

  const options: NodeUpstreamOption[] = [...grouped.entries()].map(([name, info]) => {
    if (info.count > 1) {
      return {
        value: name,
        label: `${name}（同名 ${info.count} 个，先清理重复）`,
        disabled: true
      };
    }

    return {
      value: name,
      label: info.enabled ? name : `${name}（已禁用）`,
      disabled: !info.enabled
    };
  });
  const currentUpstream = editor.upstreamProxy.trim();

  if (currentUpstream && !grouped.has(currentUpstream)) {
    options.unshift({
      value: currentUpstream,
      label: `当前值（历史引用）: ${currentUpstream}`,
      legacy: true
    });
  }

  return options;
}
