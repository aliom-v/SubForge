import type { NodeRecord } from '@subforge/shared';

import type { NodeChainSummary } from './mihomo-topology';

export type NodeFilterMode = 'all' | 'enabled' | 'disabled' | 'manual' | 'remote' | 'duplicates' | 'chain_issues';

export interface NodeDuplicateGroup {
  fingerprint: string;
  nodes: NodeRecord[];
  keepNodeId: string;
  deleteNodeIds: string[];
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  return value;
}

function normalizeJsonRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
  );
}

export function buildNodeIdentityFingerprint(
  node: Pick<NodeRecord, 'protocol' | 'server' | 'port' | 'credentials' | 'params'>
): string {
  return JSON.stringify({
    protocol: node.protocol.trim().toLowerCase(),
    server: node.server.trim().toLowerCase(),
    port: node.port,
    credentials: normalizeJsonRecord(node.credentials),
    params: normalizeJsonRecord(node.params)
  });
}

function getNodeDuplicateKeepRank(node: NodeRecord): [number, number, number, string] {
  const enabledRank = node.enabled ? 0 : 1;
  const sourceRank = node.sourceType === 'remote' ? 0 : 1;
  const timestamp = Date.parse(node.updatedAt ?? node.createdAt);
  const timeRank = Number.isFinite(timestamp) ? -timestamp : 0;
  return [enabledRank, sourceRank, timeRank, node.id];
}

export function buildNodeDuplicateGroups(nodes: NodeRecord[]): NodeDuplicateGroup[] {
  const grouped = new Map<string, NodeRecord[]>();

  for (const node of nodes) {
    const fingerprint = buildNodeIdentityFingerprint(node);
    const current = grouped.get(fingerprint) ?? [];
    current.push(node);
    grouped.set(fingerprint, current);
  }

  return [...grouped.entries()]
    .map(([fingerprint, groupedNodes]) => {
      const sortedNodes = [...groupedNodes].sort((left, right) => {
        const leftRank = getNodeDuplicateKeepRank(left);
        const rightRank = getNodeDuplicateKeepRank(right);

        for (let index = 0; index < leftRank.length; index += 1) {
          const leftValue = leftRank[index];
          const rightValue = rightRank[index];

          if (leftValue === undefined || rightValue === undefined || leftValue === rightValue) {
            continue;
          }

          return leftValue < rightValue ? -1 : 1;
        }

        return 0;
      });

      return {
        fingerprint,
        nodes: sortedNodes,
        keepNodeId: sortedNodes[0]?.id ?? '',
        deleteNodeIds: sortedNodes.slice(1).map((node) => node.id)
      };
    })
    .filter((group) => group.nodes.length > 1)
    .sort((left, right) => {
      const leftName = left.nodes[0]?.name ?? '';
      const rightName = right.nodes[0]?.name ?? '';
      return right.nodes.length - left.nodes.length || leftName.localeCompare(rightName);
    });
}

export function buildDuplicateNodeIdSet(groups: NodeDuplicateGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.nodes.map((node) => node.id)));
}

function buildNodeSearchText(node: NodeRecord, summary: NodeChainSummary | undefined): string {
  return [
    node.name,
    node.protocol,
    node.server,
    String(node.port),
    node.sourceType,
    node.enabled ? 'enabled' : 'disabled',
    summary?.chain ?? '',
    summary?.upstreamProxy ?? '',
    summary?.issue ?? ''
  ]
    .join(' ')
    .toLowerCase();
}

export function filterNodeRecords(input: {
  nodes: NodeRecord[];
  summariesById: Map<string, NodeChainSummary>;
  filterMode: NodeFilterMode;
  searchText: string;
  duplicateNodeIds: Set<string>;
}): NodeRecord[] {
  const normalizedSearchText = input.searchText.trim().toLowerCase();

  return input.nodes.filter((node) => {
    const summary = input.summariesById.get(node.id);

    if (input.filterMode === 'enabled' && !node.enabled) {
      return false;
    }

    if (input.filterMode === 'disabled' && node.enabled) {
      return false;
    }

    if (input.filterMode === 'manual' && node.sourceType !== 'manual') {
      return false;
    }

    if (input.filterMode === 'remote' && node.sourceType !== 'remote') {
      return false;
    }

    if (input.filterMode === 'duplicates' && !input.duplicateNodeIds.has(node.id)) {
      return false;
    }

    if (input.filterMode === 'chain_issues' && !summary?.issue) {
      return false;
    }

    if (!normalizedSearchText) {
      return true;
    }

    return buildNodeSearchText(node, summary).includes(normalizedSearchText);
  });
}
