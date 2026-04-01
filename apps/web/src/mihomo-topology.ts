import { buildNodeChainSummaries as buildSharedNodeChainSummaries, type NodeChainSummary } from '@subforge/core';
import type { NodeRecord } from '@subforge/shared';

export type { NodeChainSummary } from '@subforge/core';

export function buildNodeChainSummaries(
  nodes: NodeRecord[],
  proxyGroups: Array<Record<string, unknown>>,
  proxyProviders: string[]
): NodeChainSummary[] {
  return buildSharedNodeChainSummaries({
    nodes,
    proxyGroups,
    proxyProviders,
    includeDisabledNodes: true,
    allowProxyGroups: true,
    allowBuiltinReferences: true
  });
}
