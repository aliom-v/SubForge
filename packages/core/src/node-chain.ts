import type { JsonValue } from '@subforge/shared';

export interface ChainNodeLike {
  id: string;
  name: string;
  enabled: boolean;
  params?: Record<string, JsonValue>;
}

export interface NodeChainSummary {
  nodeId: string;
  nodeName: string;
  upstreamProxy: string | null;
  chain: string;
  issue: string | null;
}

export type NodeChainIssueKind =
  | 'empty_reference'
  | 'self_reference'
  | 'node_cycle'
  | 'group_cycle'
  | 'missing_reference'
  | 'disabled_upstream'
  | 'duplicate_node_name'
  | 'duplicate_group_name'
  | 'name_conflict'
  | 'group_has_multiple_candidates'
  | 'group_is_empty'
  | 'provider_reference'
  | 'missing_provider'
  | 'unsupported_group_reference'
  | 'unsupported_builtin_reference';

export interface NodeChainIssue {
  nodeId: string;
  nodeName: string;
  upstreamProxy: string | null;
  chain: string;
  kind: NodeChainIssueKind;
  message: string;
  reference?: string | null;
}

export interface NodeChainValidationInput<TNode extends ChainNodeLike = ChainNodeLike> {
  nodes: TNode[];
  proxyGroups?: Array<Record<string, unknown>>;
  proxyProviders?: string[];
  includeDisabledNodes?: boolean;
  allowProxyGroups?: boolean;
  allowBuiltinReferences?: boolean;
}

export interface NodeChainValidationResult {
  summaries: NodeChainSummary[];
  issues: NodeChainIssue[];
}

interface MihomoProxyGroupEntry {
  name: string;
  type: string;
  proxies: string[];
  providers: string[];
}

interface ResolutionContext<TNode extends ChainNodeLike> {
  nodesByName: Map<string, TNode[]>;
  groupEntriesByName: Map<string, MihomoProxyGroupEntry[]>;
  providerNames: Set<string>;
}

interface ResolutionState<TNode extends ChainNodeLike> {
  rootNode: TNode;
  visitedNodeIds: Set<string>;
  visitedGroupNames: Set<string>;
}

interface ResolutionIssue {
  kind: NodeChainIssueKind;
  message: string;
  reference?: string | null;
}

interface ResolutionResult {
  segments: string[];
  issue: ResolutionIssue | null;
}

const MIHOMO_BUILTIN_REFERENCES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE']);

export function readNodeUpstreamProxyFromRecord(params?: Record<string, JsonValue> | null): string | null {
  const value = params?.upstreamProxy;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateNodeChains<TNode extends ChainNodeLike>(
  input: NodeChainValidationInput<TNode>
): NodeChainValidationResult {
  const context = createResolutionContext(input.nodes, input.proxyGroups ?? [], input.proxyProviders ?? []);
  const summaries = input.nodes
    .filter((node) => input.includeDisabledNodes === true || node.enabled)
    .map((node) => buildSummaryForNode(context, node, input));

  return {
    summaries,
    issues: summaries.flatMap((summary) => {
      if (!summary.issue) {
        return [];
      }

      const resolution = resolveRootIssue(summary.issue);

      return [{
        nodeId: summary.nodeId,
        nodeName: summary.nodeName,
        upstreamProxy: summary.upstreamProxy,
        chain: summary.chain,
        kind: resolution.kind,
        message: summary.issue,
        ...(resolution.reference !== undefined ? { reference: resolution.reference } : {})
      }];
    })
  };
}

export function buildNodeChainSummaries<TNode extends ChainNodeLike>(
  input: NodeChainValidationInput<TNode>
): NodeChainSummary[] {
  return validateNodeChains(input).summaries;
}

function buildSummaryForNode<TNode extends ChainNodeLike>(
  context: ResolutionContext<TNode>,
  node: TNode,
  input: NodeChainValidationInput<TNode>
): NodeChainSummary {
  const upstreamProxy = readNodeUpstreamProxyFromRecord(node.params);

  if (!upstreamProxy) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      upstreamProxy: null,
      chain: node.name,
      issue: null
    };
  }

  const selfMatches = context.nodesByName.get(node.name) ?? [];

  if (
    upstreamProxy === node.name &&
    selfMatches.length === 1 &&
    selfMatches[0]?.id === node.id
  ) {
    return {
      nodeId: node.id,
      nodeName: node.name,
      upstreamProxy,
      chain: `${node.name} -> ${node.name}`,
      issue: `节点不能把自己设为上游：${node.name}`
    };
  }

  const resolved = resolveReferenceChain(context, upstreamProxy, {
    rootNode: node,
    visitedNodeIds: new Set([node.id]),
    visitedGroupNames: new Set()
  }, input);

  return {
    nodeId: node.id,
    nodeName: node.name,
    upstreamProxy,
    chain: [node.name, ...resolved.segments].join(' -> '),
    issue: resolved.issue?.message ?? null
  };
}

function createResolutionContext<TNode extends ChainNodeLike>(
  nodes: TNode[],
  proxyGroups: Array<Record<string, unknown>>,
  proxyProviders: string[]
): ResolutionContext<TNode> {
  const nodesByName = new Map<string, TNode[]>();
  const groupEntriesByName = new Map<string, MihomoProxyGroupEntry[]>();
  const providerNames = new Set(proxyProviders.map((item) => item.trim()).filter(Boolean));

  for (const node of nodes) {
    const items = nodesByName.get(node.name) ?? [];
    items.push(node);
    nodesByName.set(node.name, items);
  }

  for (const group of normalizeProxyGroups(proxyGroups)) {
    const items = groupEntriesByName.get(group.name) ?? [];
    items.push(group);
    groupEntriesByName.set(group.name, items);
  }

  return {
    nodesByName,
    groupEntriesByName,
    providerNames
  };
}

function normalizeProxyGroups(proxyGroups: Array<Record<string, unknown>>): MihomoProxyGroupEntry[] {
  return proxyGroups.flatMap((group) => {
    const name = typeof group.name === 'string' ? group.name.trim() : '';

    if (!name) {
      return [];
    }

    return [{
      name,
      type: typeof group.type === 'string' && group.type.trim() ? group.type.trim() : 'select',
      proxies: readStringList(group.proxies),
      providers: readStringList(group.use)
    }];
  });
}

function resolveReferenceChain<TNode extends ChainNodeLike>(
  context: ResolutionContext<TNode>,
  reference: string,
  state: ResolutionState<TNode>,
  input: NodeChainValidationInput<TNode>
): ResolutionResult {
  const normalizedReference = reference.trim();

  if (!normalizedReference) {
    return {
      segments: [],
      issue: {
        kind: 'empty_reference',
        message: '链路引用为空'
      }
    };
  }

  if (MIHOMO_BUILTIN_REFERENCES.has(normalizedReference)) {
    if (input.allowBuiltinReferences === false) {
      return {
        segments: [`[builtin] ${normalizedReference}`],
        issue: {
          kind: 'unsupported_builtin_reference',
          message: `当前输出不支持把内置目标作为上游：${normalizedReference}`,
          reference: normalizedReference
        }
      };
    }

    return {
      segments: [`[builtin] ${normalizedReference}`],
      issue: null
    };
  }

  if (context.providerNames.has(normalizedReference)) {
    return {
      segments: [`[provider] ${normalizedReference}`],
      issue: {
        kind: 'provider_reference',
        message: `链路引用 provider：${normalizedReference}`,
        reference: normalizedReference
      }
    };
  }

  const nodeMatches = context.nodesByName.get(normalizedReference) ?? [];
  const groupMatches = context.groupEntriesByName.get(normalizedReference) ?? [];

  if (nodeMatches.length > 0 && groupMatches.length > 0) {
    return {
      segments: [normalizedReference],
      issue: {
        kind: 'name_conflict',
        message: `名称同时匹配节点和代理组：${normalizedReference}`,
        reference: normalizedReference
      }
    };
  }

  if (groupMatches.length > 0) {
    if (input.allowProxyGroups === false) {
      return {
        segments: [`[group] ${normalizedReference}`],
        issue: {
          kind: 'unsupported_group_reference',
          message: `当前输出不支持把代理组作为上游：${normalizedReference}`,
          reference: normalizedReference
        }
      };
    }

    if (groupMatches.length > 1) {
      return {
        segments: [`[group] ${normalizedReference}`],
        issue: {
          kind: 'duplicate_group_name',
          message: `代理组名称重复：${normalizedReference}`,
          reference: normalizedReference
        }
      };
    }

    const groupMatch = groupMatches[0];

    if (!groupMatch) {
      return {
        segments: [normalizedReference],
        issue: {
          kind: 'missing_reference',
          message: `缺少上游代理组：${normalizedReference}`,
          reference: normalizedReference
        }
      };
    }

    return resolveGroupChain(context, groupMatch, state, input);
  }

  if (nodeMatches.length > 1) {
    return {
      segments: [normalizedReference],
      issue: {
        kind: 'duplicate_node_name',
        message: `上游节点名称重复：${normalizedReference}`,
        reference: normalizedReference
      }
    };
  }

  if (nodeMatches.length === 1) {
    const nodeMatch = nodeMatches[0];

    if (!nodeMatch) {
      return {
        segments: [normalizedReference],
        issue: {
          kind: 'missing_reference',
          message: `缺少上游节点：${normalizedReference}`,
          reference: normalizedReference
        }
      };
    }

    return resolveNodeChain(context, nodeMatch, state, input);
  }

  return {
    segments: [normalizedReference],
    issue: {
      kind: 'missing_reference',
      message: `缺少上游节点或代理组：${normalizedReference}`,
      reference: normalizedReference
    }
  };
}

function resolveNodeChain<TNode extends ChainNodeLike>(
  context: ResolutionContext<TNode>,
  node: TNode,
  state: ResolutionState<TNode>,
  input: NodeChainValidationInput<TNode>
): ResolutionResult {
  if (state.visitedNodeIds.has(node.id)) {
    const isDirectSelfReference = node.id === state.rootNode.id && state.visitedNodeIds.size === 1;

    return {
      segments: [node.name],
      issue: {
        kind: isDirectSelfReference ? 'self_reference' : 'node_cycle',
        message: isDirectSelfReference ? `节点不能把自己设为上游：${node.name}` : `检测到循环链路：${node.name}`,
        reference: node.name
      }
    };
  }

  if (!node.enabled) {
    return {
      segments: [node.name],
      issue: {
        kind: 'disabled_upstream',
        message: `上游节点已禁用：${node.name}`,
        reference: node.name
      }
    };
  }

  const nextVisitedNodeIds = new Set(state.visitedNodeIds);
  nextVisitedNodeIds.add(node.id);
  const nextUpstream = readNodeUpstreamProxyFromRecord(node.params);

  if (!nextUpstream) {
    return {
      segments: [node.name],
      issue: null
    };
  }

  const resolved = resolveReferenceChain(context, nextUpstream, {
    rootNode: state.rootNode,
    visitedNodeIds: nextVisitedNodeIds,
    visitedGroupNames: new Set(state.visitedGroupNames)
  }, input);

  return {
    segments: [node.name, ...resolved.segments],
    issue: resolved.issue
  };
}

function resolveGroupChain<TNode extends ChainNodeLike>(
  context: ResolutionContext<TNode>,
  group: MihomoProxyGroupEntry,
  state: ResolutionState<TNode>,
  input: NodeChainValidationInput<TNode>
): ResolutionResult {
  if (state.visitedGroupNames.has(group.name)) {
    return {
      segments: [`[group] ${group.name}`],
      issue: {
        kind: 'group_cycle',
        message: `检测到代理组循环：${group.name}`,
        reference: group.name
      }
    };
  }

  const nextVisitedGroupNames = new Set(state.visitedGroupNames);
  nextVisitedGroupNames.add(group.name);
  const prefixes = [`[group] ${group.name}`];
  const candidates = [
    ...group.proxies,
    ...group.providers.map((provider) => `[provider] ${provider}`)
  ];

  if (group.proxies.length === 0 && group.providers.length === 0) {
    return {
      segments: prefixes,
      issue: {
        kind: 'group_is_empty',
        message: `代理组为空：${group.name}`,
        reference: group.name
      }
    };
  }

  if (group.proxies.length === 0 && group.providers.length === 1) {
    const providerName = group.providers[0];

    if (!providerName) {
      return {
        segments: prefixes,
        issue: {
          kind: 'missing_provider',
          message: `代理组引用了空 provider：${group.name}`,
          reference: group.name
        }
      };
    }

    return {
      segments: [...prefixes, `[provider] ${providerName}`],
      issue: context.providerNames.has(providerName)
        ? null
        : {
          kind: 'missing_provider',
          message: `模板里未声明 provider：${providerName}`,
          reference: providerName
        }
    };
  }

  if (candidates.length > 1) {
    return {
      segments: [...prefixes, `{${candidates.join(' | ')}}`],
      issue: {
        kind: 'group_has_multiple_candidates',
        message: `代理组包含多个候选：${group.name}`,
        reference: group.name
      }
    };
  }

  const onlyReference = group.proxies[0];

  if (!onlyReference) {
    return {
      segments: [...prefixes, `{${candidates.join(' | ')}}`],
      issue: null
    };
  }

  const resolved = resolveReferenceChain(context, onlyReference, {
    rootNode: state.rootNode,
    visitedNodeIds: new Set(state.visitedNodeIds),
    visitedGroupNames: nextVisitedGroupNames
  }, input);

  return {
    segments: [...prefixes, ...resolved.segments],
    issue: resolved.issue
  };
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
    : [];
}

function resolveRootIssue(issue: string): Pick<NodeChainIssue, 'kind' | 'reference'> {
  if (issue.startsWith('节点不能把自己设为上游：')) {
    return {
      kind: 'self_reference',
      reference: issue.slice('节点不能把自己设为上游：'.length).trim()
    };
  }

  if (issue.startsWith('检测到循环链路：')) {
    return {
      kind: 'node_cycle',
      reference: issue.slice('检测到循环链路：'.length).trim()
    };
  }

  if (issue.startsWith('检测到代理组循环：')) {
    return {
      kind: 'group_cycle',
      reference: issue.slice('检测到代理组循环：'.length).trim()
    };
  }

  if (issue.startsWith('缺少上游节点或代理组：')) {
    return {
      kind: 'missing_reference',
      reference: issue.slice('缺少上游节点或代理组：'.length).trim()
    };
  }

  if (issue.startsWith('缺少上游节点：')) {
    return {
      kind: 'missing_reference',
      reference: issue.slice('缺少上游节点：'.length).trim()
    };
  }

  if (issue.startsWith('缺少上游代理组：')) {
    return {
      kind: 'missing_reference',
      reference: issue.slice('缺少上游代理组：'.length).trim()
    };
  }

  if (issue.startsWith('上游节点已禁用：')) {
    return {
      kind: 'disabled_upstream',
      reference: issue.slice('上游节点已禁用：'.length).trim()
    };
  }

  if (issue.startsWith('上游节点名称重复：')) {
    return {
      kind: 'duplicate_node_name',
      reference: issue.slice('上游节点名称重复：'.length).trim()
    };
  }

  if (issue.startsWith('代理组名称重复：')) {
    return {
      kind: 'duplicate_group_name',
      reference: issue.slice('代理组名称重复：'.length).trim()
    };
  }

  if (issue.startsWith('名称同时匹配节点和代理组：')) {
    return {
      kind: 'name_conflict',
      reference: issue.slice('名称同时匹配节点和代理组：'.length).trim()
    };
  }

  if (issue.startsWith('代理组包含多个候选：')) {
    return {
      kind: 'group_has_multiple_candidates',
      reference: issue.slice('代理组包含多个候选：'.length).trim()
    };
  }

  if (issue.startsWith('代理组为空：')) {
    return {
      kind: 'group_is_empty',
      reference: issue.slice('代理组为空：'.length).trim()
    };
  }

  if (issue.startsWith('模板里未声明 provider：')) {
    return {
      kind: 'missing_provider',
      reference: issue.slice('模板里未声明 provider：'.length).trim()
    };
  }

  if (issue.startsWith('链路引用 provider：')) {
    return {
      kind: 'provider_reference',
      reference: issue.slice('链路引用 provider：'.length).trim()
    };
  }

  if (issue.startsWith('当前输出不支持把代理组作为上游：')) {
    return {
      kind: 'unsupported_group_reference',
      reference: issue.slice('当前输出不支持把代理组作为上游：'.length).trim()
    };
  }

  if (issue.startsWith('当前输出不支持把内置目标作为上游：')) {
    return {
      kind: 'unsupported_builtin_reference',
      reference: issue.slice('当前输出不支持把内置目标作为上游：'.length).trim()
    };
  }

  if (issue === '链路引用为空') {
    return {
      kind: 'empty_reference',
      reference: null
    };
  }

  return {
    kind: 'missing_reference'
  };
}
