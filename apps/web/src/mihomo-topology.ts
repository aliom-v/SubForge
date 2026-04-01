import type { NodeRecord } from '@subforge/shared';

export interface NodeChainSummary {
  nodeId: string;
  nodeName: string;
  upstreamProxy: string | null;
  chain: string;
  issue: string | null;
}

interface MihomoProxyGroupEntry {
  name: string;
  type: string;
  proxies: string[];
  providers: string[];
}

interface ResolutionContext {
  nodesByName: Map<string, NodeRecord[]>;
  groupEntriesByName: Map<string, MihomoProxyGroupEntry[]>;
  providerNames: Set<string>;
}

const MIHOMO_BUILTIN_REFERENCES = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE']);

export function buildNodeChainSummaries(
  nodes: NodeRecord[],
  proxyGroups: Array<Record<string, unknown>>,
  proxyProviders: string[]
): NodeChainSummary[] {
  const context = createResolutionContext(nodes, proxyGroups, proxyProviders);

  return nodes.map((node) => {
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

    const resolved = resolveReferenceChain(context, upstreamProxy, {
      visitedNodeIds: new Set([node.id]),
      visitedGroupNames: new Set()
    });

    return {
      nodeId: node.id,
      nodeName: node.name,
      upstreamProxy,
      chain: [node.name, ...resolved.segments].join(' -> '),
      issue: resolved.issue
    };
  });
}

export function readNodeUpstreamProxyFromRecord(params?: Record<string, unknown> | null): string | null {
  const value = params?.upstreamProxy;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createResolutionContext(
  nodes: NodeRecord[],
  proxyGroups: Array<Record<string, unknown>>,
  proxyProviders: string[]
): ResolutionContext {
  const nodesByName = new Map<string, NodeRecord[]>();
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

function resolveReferenceChain(
  context: ResolutionContext,
  reference: string,
  state: {
    visitedNodeIds: Set<string>;
    visitedGroupNames: Set<string>;
  }
): { segments: string[]; issue: string | null } {
  const normalizedReference = reference.trim();

  if (!normalizedReference) {
    return {
      segments: [],
      issue: '链路引用为空'
    };
  }

  if (MIHOMO_BUILTIN_REFERENCES.has(normalizedReference)) {
    return {
      segments: [`[builtin] ${normalizedReference}`],
      issue: null
    };
  }

  if (context.providerNames.has(normalizedReference)) {
    return {
      segments: [`[provider] ${normalizedReference}`],
      issue: `链路引用 provider：${normalizedReference}`
    };
  }

  const nodeMatches = context.nodesByName.get(normalizedReference) ?? [];
  const groupMatches = context.groupEntriesByName.get(normalizedReference) ?? [];

  if (nodeMatches.length > 0 && groupMatches.length > 0) {
    return {
      segments: [normalizedReference],
      issue: `名称同时匹配节点和代理组：${normalizedReference}`
    };
  }

  if (groupMatches.length > 1) {
    return {
      segments: [`[group] ${normalizedReference}`],
      issue: `代理组名称重复：${normalizedReference}`
    };
  }

  if (groupMatches.length === 1) {
    const [groupMatch] = groupMatches;

    if (!groupMatch) {
      return {
        segments: [normalizedReference],
        issue: `缺少上游代理组：${normalizedReference}`
      };
    }

    return resolveGroupChain(context, groupMatch, state);
  }

  if (nodeMatches.length > 1) {
    return {
      segments: [normalizedReference],
      issue: `上游节点名称重复：${normalizedReference}`
    };
  }

  if (nodeMatches.length === 1) {
    const [nodeMatch] = nodeMatches;

    if (!nodeMatch) {
      return {
        segments: [normalizedReference],
        issue: `缺少上游节点：${normalizedReference}`
      };
    }

    return resolveNodeChain(context, nodeMatch, state);
  }

  return {
    segments: [normalizedReference],
    issue: `缺少上游节点或代理组：${normalizedReference}`
  };
}

function resolveNodeChain(
  context: ResolutionContext,
  node: NodeRecord,
  state: {
    visitedNodeIds: Set<string>;
    visitedGroupNames: Set<string>;
  }
): { segments: string[]; issue: string | null } {
  if (state.visitedNodeIds.has(node.id)) {
    return {
      segments: [node.name],
      issue: `检测到循环链路：${node.name}`
    };
  }

  if (!node.enabled) {
    return {
      segments: [node.name],
      issue: `上游节点已禁用：${node.name}`
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
    visitedNodeIds: nextVisitedNodeIds,
    visitedGroupNames: new Set(state.visitedGroupNames)
  });

  return {
    segments: [node.name, ...resolved.segments],
    issue: resolved.issue
  };
}

function resolveGroupChain(
  context: ResolutionContext,
  group: MihomoProxyGroupEntry,
  state: {
    visitedNodeIds: Set<string>;
    visitedGroupNames: Set<string>;
  }
): { segments: string[]; issue: string | null } {
  if (state.visitedGroupNames.has(group.name)) {
    return {
      segments: [`[group] ${group.name}`],
      issue: `检测到代理组循环：${group.name}`
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
      issue: `代理组为空：${group.name}`
    };
  }

  if (group.proxies.length === 0 && group.providers.length === 1) {
    const providerName = group.providers[0];

    if (!providerName) {
      return {
        segments: prefixes,
        issue: `代理组引用了空 provider：${group.name}`
      };
    }

    return {
      segments: [...prefixes, `[provider] ${providerName}`],
      issue: context.providerNames.has(providerName) ? null : `模板里未声明 provider：${providerName}`
    };
  }

  if (candidates.length > 1) {
    return {
      segments: [...prefixes, `{${candidates.join(' | ')}}`],
      issue: `代理组包含多个候选：${group.name}`
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
    visitedNodeIds: new Set(state.visitedNodeIds),
    visitedGroupNames: nextVisitedGroupNames
  });

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
