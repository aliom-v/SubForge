import {
  parseMihomoTemplateStructure,
  validateNodeChains,
  type NodeChainIssue
} from '@subforge/core';
import { createAppError, type AppErrorShape, type NodeRecord } from '@subforge/shared';
import { getDefaultTemplateByTarget } from './repository';

export type NodeChainValidationOperation =
  | 'node.create'
  | 'node.update'
  | 'node.import'
  | 'remote_subscription_source.sync';

function buildNodeChainIssueKey(
  issue: Pick<NodeChainIssue, 'nodeId' | 'kind' | 'reference' | 'message'>
): string {
  return [issue.nodeId, issue.kind, issue.reference ?? '', issue.message].join('::');
}

async function readMihomoNodeChainContext(db: D1Database): Promise<{
  proxyGroups: Array<Record<string, unknown>>;
  proxyProviders: string[];
}> {
  const template = await getDefaultTemplateByTarget(db, 'mihomo');

  if (!template) {
    return {
      proxyGroups: [],
      proxyProviders: []
    };
  }

  try {
    const parsed = parseMihomoTemplateStructure(template.content);
    return {
      proxyGroups: parsed.proxyGroups,
      proxyProviders: parsed.proxyProviders
    };
  } catch {
    return {
      proxyGroups: [],
      proxyProviders: []
    };
  }
}

export async function findIntroducedNodeChainIssues(
  db: D1Database,
  currentNodes: NodeRecord[],
  nextNodes: NodeRecord[]
): Promise<NodeChainIssue[]> {
  const { proxyGroups, proxyProviders } = await readMihomoNodeChainContext(db);
  const currentIssues = validateNodeChains({
    nodes: currentNodes,
    proxyGroups,
    proxyProviders,
    includeDisabledNodes: true,
    allowProxyGroups: false,
    allowBuiltinReferences: false
  }).issues;
  const nextIssues = validateNodeChains({
    nodes: nextNodes,
    proxyGroups,
    proxyProviders,
    includeDisabledNodes: true,
    allowProxyGroups: false,
    allowBuiltinReferences: false
  }).issues;
  const currentIssueKeys = new Set(currentIssues.map(buildNodeChainIssueKey));

  return nextIssues.filter((issue) => !currentIssueKeys.has(buildNodeChainIssueKey(issue)));
}

export function createNodeChainValidationError(
  issues: NodeChainIssue[],
  operation: NodeChainValidationOperation
): AppErrorShape {
  return createAppError('VALIDATION_FAILED', 'node chain validation failed', {
    scope: 'node_chain',
    operation,
    issueCount: issues.length,
    issues
  });
}

export function createPendingNodeRecord(
  input: Omit<NodeRecord, 'createdAt' | 'updatedAt'> &
    Partial<Pick<NodeRecord, 'createdAt' | 'updatedAt'>>
): NodeRecord {
  return {
    ...input,
    createdAt: input.createdAt ?? '',
    updatedAt: input.updatedAt ?? ''
  };
}

export function mergeNodeRecords(
  currentNodes: NodeRecord[],
  input: {
    replacements?: NodeRecord[] | undefined;
    additions?: NodeRecord[] | undefined;
  }
): NodeRecord[] {
  const replacementMap = new Map((input.replacements ?? []).map((node) => [node.id, node]));
  const merged = currentNodes.map((node) => replacementMap.get(node.id) ?? node);

  return [...merged, ...(input.additions ?? [])];
}
