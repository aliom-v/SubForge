import {
  AUTO_HOSTED_USER_NAME,
  AUTO_HOSTED_USER_REMARK,
  SUBSCRIPTION_TARGETS,
  type NodeRecord,
  type SubscriptionTarget,
  type TemplateRecord,
  type UserNodeBinding,
  type UserRecord
} from '@subforge/shared';

import type { PreviewPayload } from './api';

export { AUTO_HOSTED_USER_NAME, AUTO_HOSTED_USER_REMARK } from '@subforge/shared';

export interface HostedSubscriptionTargetState {
  target: SubscriptionTarget;
  url: string;
  ok: boolean;
  detail: string;
  previewNodeCount: number | null;
  templateName: string | null;
}

export interface HostedSubscriptionResult {
  userId: string;
  userName: string;
  token: string;
  sourceLabel: string;
  nodeCount: number;
  boundNodeIds: string[];
  effectiveBoundNodeIds: string[];
  unresolvedBoundNodeIds: string[];
  bindingError: string | null;
  targets: HostedSubscriptionTargetState[];
}

export interface HostedDuplicateNameEntry {
  name: string;
  count: number;
}

export interface HostedSubscriptionDiagnostics {
  enabledNodeCount: number;
  boundNodeCount: number;
  effectiveBoundNodeCount: number;
  enabledOnlyNodes: Array<{ id: string; name: string }>;
  disabledBoundNodes: Array<{ id: string; name: string }>;
  missingBoundNodeIds: string[];
  duplicateEnabledNames: HostedDuplicateNameEntry[];
  duplicateHostedNames: HostedDuplicateNameEntry[];
  previewTargets: Array<{
    target: SubscriptionTarget;
    ok: boolean;
    nodeCount: number | null;
    detail: string;
    templateName: string | null;
    mismatch: boolean;
  }>;
  bindingError: string | null;
  hasIssues: boolean;
}

export const AUTO_HOSTED_TEMPLATE_NAMES: Record<SubscriptionTarget, string> = {
  mihomo: 'Auto Hosted Mihomo',
  singbox: 'Auto Hosted Sing-box'
};
export const RESTORED_HOSTED_STATE_LABEL = '当前已保存托管状态';

export function findAutoHostedUser(users: UserRecord[]): UserRecord | null {
  return (
    users.find((user) => user.remark === AUTO_HOSTED_USER_REMARK) ??
    users.find((user) => user.name === AUTO_HOSTED_USER_NAME) ??
    null
  );
}

export function findAutoHostedTemplate(templates: TemplateRecord[], target: SubscriptionTarget): TemplateRecord | null {
  return (
    templates.find((template) => template.targetType === target && template.name === AUTO_HOSTED_TEMPLATE_NAMES[target]) ??
    null
  );
}

export function buildHostedSubscriptionUrl(
  token: string,
  target: SubscriptionTarget,
  origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://127.0.0.1:8787'
): string {
  return `${origin}/s/${encodeURIComponent(token)}/${target}`;
}

export interface HostedSubscriptionSyncStatus {
  kind: 'missing' | 'in_sync' | 'out_of_sync';
  detail: string;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function buildDuplicateNameEntries(names: string[]): HostedDuplicateNameEntry[] {
  const counts = new Map<string, number>();

  for (const name of names) {
    const normalized = name.trim();

    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .map(([name, count]) => ({ name, count }));
}

export function getHostedSubscriptionSyncStatus(
  hostedSubscriptionResult: HostedSubscriptionResult | null,
  nodes: NodeRecord[]
): HostedSubscriptionSyncStatus {
  if (!hostedSubscriptionResult) {
    return {
      kind: 'missing',
      detail: '当前还没有已保存的托管绑定。请先完成导入和调整，再执行“使用当前启用节点生成托管 URL”。'
    };
  }

  if (hostedSubscriptionResult.bindingError) {
    return {
      kind: 'out_of_sync',
      detail: `当前托管绑定读取失败：${hostedSubscriptionResult.bindingError}。请先刷新数据，必要时重新执行“使用当前启用节点生成托管 URL”。`
    };
  }

  const enabledNodeIds = dedupeStrings(nodes.filter((node) => node.enabled).map((node) => node.id)).sort();
  const hostedNodeIds = dedupeStrings(hostedSubscriptionResult.boundNodeIds).sort();

  if (enabledNodeIds.length === hostedNodeIds.length && enabledNodeIds.every((nodeId, index) => nodeId === hostedNodeIds[index])) {
    return {
      kind: 'in_sync',
      detail: `当前启用节点与已托管绑定一致，可直接使用这组托管 URL。`
    };
  }

  return {
    kind: 'out_of_sync',
    detail: `当前启用节点与已托管绑定不一致。若要让客户端拿到最新节点，请重新执行“使用当前启用节点生成托管 URL”。`
  };
}

export function buildHostedSubscriptionDiagnostics(
  hostedSubscriptionResult: HostedSubscriptionResult | null,
  nodes: NodeRecord[]
): HostedSubscriptionDiagnostics | null {
  if (!hostedSubscriptionResult) {
    return null;
  }

  const enabledNodes = nodes.filter((node) => node.enabled);
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const boundNodes = hostedSubscriptionResult.boundNodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is NodeRecord => Boolean(node));
  const disabledBoundNodes = boundNodes
    .filter((node) => !node.enabled)
    .map((node) => ({ id: node.id, name: node.name }));
  const boundNodeIdSet = new Set(hostedSubscriptionResult.boundNodeIds);
  const enabledOnlyNodes = enabledNodes
    .filter((node) => !boundNodeIdSet.has(node.id))
    .map((node) => ({ id: node.id, name: node.name }));
  const previewTargets = hostedSubscriptionResult.targets.map((target) => ({
    target: target.target,
    ok: target.ok,
    nodeCount: target.previewNodeCount,
    detail: target.detail,
    templateName: target.templateName,
    mismatch:
      target.ok &&
      target.previewNodeCount != null &&
      target.previewNodeCount !== hostedSubscriptionResult.nodeCount
  }));
  const duplicateEnabledNames = buildDuplicateNameEntries(enabledNodes.map((node) => node.name));
  const duplicateHostedNames = buildDuplicateNameEntries(
    hostedSubscriptionResult.effectiveBoundNodeIds
      .map((nodeId) => nodeById.get(nodeId)?.name ?? '')
      .filter(Boolean)
  );

  return {
    enabledNodeCount: enabledNodes.length,
    boundNodeCount: hostedSubscriptionResult.boundNodeIds.length,
    effectiveBoundNodeCount: hostedSubscriptionResult.nodeCount,
    enabledOnlyNodes,
    disabledBoundNodes,
    missingBoundNodeIds: [...hostedSubscriptionResult.unresolvedBoundNodeIds],
    duplicateEnabledNames,
    duplicateHostedNames,
    previewTargets,
    bindingError: hostedSubscriptionResult.bindingError,
    hasIssues:
      Boolean(hostedSubscriptionResult.bindingError) ||
      enabledOnlyNodes.length > 0 ||
      disabledBoundNodes.length > 0 ||
      hostedSubscriptionResult.unresolvedBoundNodeIds.length > 0 ||
      duplicateEnabledNames.length > 0 ||
      duplicateHostedNames.length > 0 ||
      previewTargets.some((target) => target.mismatch)
  };
}

export async function resolveCurrentHostedSubscriptionResult(input: {
  resources: {
    users: UserRecord[];
    nodes: NodeRecord[];
  };
  fetchUserNodeBindings: (userId: string) => Promise<UserNodeBinding[]>;
  fetchPreview: (userId: string, target: SubscriptionTarget) => Promise<PreviewPayload>;
  formatErrorMessage: (error: unknown) => string;
  sourceLabel?: string;
  origin?: string;
}): Promise<HostedSubscriptionResult | null> {
  const managedUser = findAutoHostedUser(input.resources.users);

  if (!managedUser) {
    return null;
  }

  let enabledBindingNodeIds: string[] = [];
  let bindingError: string | null = null;

  try {
    const bindings = await input.fetchUserNodeBindings(managedUser.id);
    enabledBindingNodeIds = dedupeStrings(bindings.filter((item) => item.enabled).map((item) => item.nodeId));
  } catch (error) {
    bindingError = input.formatErrorMessage(error);
  }

  const nodeById = new Map(input.resources.nodes.map((node) => [node.id, node] as const));
  const enabledBindingNodeIdSet = new Set(enabledBindingNodeIds);
  const activeBoundNodes = input.resources.nodes.filter((node) => node.enabled && enabledBindingNodeIdSet.has(node.id));
  const activeBoundNodeIds = activeBoundNodes.map((node) => node.id);
  const unresolvedBoundNodeIds = enabledBindingNodeIds.filter((nodeId) => !nodeById.has(nodeId));

  const targets = await Promise.all(
    SUBSCRIPTION_TARGETS.map(async (target): Promise<HostedSubscriptionTargetState> => {
      const url = buildHostedSubscriptionUrl(managedUser.token, target, input.origin);

      if (bindingError) {
        return {
          target,
          url,
          ok: false,
          detail: `当前托管绑定读取失败：${bindingError}`,
          previewNodeCount: null,
          templateName: null
        };
      }

      try {
        const previewResult = await input.fetchPreview(managedUser.id, target);
        return {
          target,
          url,
          ok: true,
          detail: `${previewResult.metadata.nodeCount} 个节点，托管输出检查通过`,
          previewNodeCount: previewResult.metadata.nodeCount,
          templateName: previewResult.metadata.templateName
        };
      } catch (error) {
        return {
          target,
          url,
          ok: false,
          detail: input.formatErrorMessage(error),
          previewNodeCount: null,
          templateName: null
        };
      }
    })
  );

  return {
    userId: managedUser.id,
    userName: managedUser.name,
    token: managedUser.token,
    sourceLabel: input.sourceLabel ?? RESTORED_HOSTED_STATE_LABEL,
    nodeCount: activeBoundNodes.length,
    boundNodeIds: enabledBindingNodeIds,
    effectiveBoundNodeIds: activeBoundNodeIds,
    unresolvedBoundNodeIds,
    bindingError,
    targets
  };
}
