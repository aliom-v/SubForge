import {
  SUBSCRIPTION_TARGETS,
  type NodeRecord,
  type SubscriptionTarget,
  type TemplateRecord,
  type UserNodeBinding,
  type UserRecord
} from '@subforge/shared';

import type { PreviewPayload } from './api';

export interface HostedSubscriptionTargetState {
  target: SubscriptionTarget;
  url: string;
  ok: boolean;
  detail: string;
}

export interface HostedSubscriptionResult {
  userId: string;
  userName: string;
  token: string;
  sourceLabel: string;
  nodeCount: number;
  boundNodeIds: string[];
  targets: HostedSubscriptionTargetState[];
}

export const AUTO_HOSTED_USER_NAME = '个人托管订阅';
export const AUTO_HOSTED_USER_REMARK = 'subforge:auto-hosted';
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

  const enabledNodeIds = [...new Set(nodes.filter((node) => node.enabled).map((node) => node.id))].sort();
  const hostedNodeIds = [...new Set(hostedSubscriptionResult.boundNodeIds)].sort();

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
    enabledBindingNodeIds = bindings.filter((item) => item.enabled).map((item) => item.nodeId);
  } catch (error) {
    bindingError = input.formatErrorMessage(error);
  }

  const enabledBindingNodeIdSet = new Set(enabledBindingNodeIds);
  const activeBoundNodes = input.resources.nodes.filter((node) => node.enabled && enabledBindingNodeIdSet.has(node.id));

  const targets = await Promise.all(
    SUBSCRIPTION_TARGETS.map(async (target): Promise<HostedSubscriptionTargetState> => {
      const url = buildHostedSubscriptionUrl(managedUser.token, target, input.origin);

      if (bindingError) {
        return {
          target,
          url,
          ok: false,
          detail: `当前托管绑定读取失败：${bindingError}`
        };
      }

      try {
        const previewResult = await input.fetchPreview(managedUser.id, target);
        return {
          target,
          url,
          ok: true,
          detail: `${previewResult.metadata.nodeCount} 个节点，托管输出检查通过`
        };
      } catch (error) {
        return {
          target,
          url,
          ok: false,
          detail: input.formatErrorMessage(error)
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
    boundNodeIds: activeBoundNodes.map((node) => node.id),
    targets
  };
}
