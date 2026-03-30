import type { NodeRecord } from '@subforge/shared';

import type { HostedSubscriptionResult, HostedSubscriptionSyncStatus } from './hosted-state';

export interface SingleUserWorkflowStep {
  id: 'import' | 'adjust' | 'generate';
  title: string;
  status: 'pending' | 'ready' | 'complete' | 'attention';
  detail: string;
}

export function getWorkflowStepStatusLabel(status: SingleUserWorkflowStep['status']): string {
  if (status === 'complete') {
    return '已完成';
  }

  if (status === 'ready') {
    return '可继续';
  }

  if (status === 'attention') {
    return '需处理';
  }

  return '待开始';
}

export function buildSingleUserWorkflowSteps(input: {
  nodes: NodeRecord[];
  hostedSubscriptionSyncStatus: HostedSubscriptionSyncStatus;
  hostedSubscriptionResult: HostedSubscriptionResult | null;
}): SingleUserWorkflowStep[] {
  const totalNodeCount = input.nodes.length;
  const enabledNodeCount = input.nodes.filter((node) => node.enabled).length;

  const importStep: SingleUserWorkflowStep =
    totalNodeCount === 0
      ? {
          id: 'import',
          title: '第 1 步：导入到节点列表',
          status: 'pending',
          detail: '当前还没有节点。先通过节点文本导入、订阅 URL 解析或导入完整配置把节点写入列表。'
        }
      : {
          id: 'import',
          title: '第 1 步：导入到节点列表',
          status: 'complete',
          detail: `当前节点列表共有 ${totalNodeCount} 个节点，说明导入步骤已经完成。`
        };

  const adjustStep: SingleUserWorkflowStep =
    totalNodeCount === 0
      ? {
          id: 'adjust',
          title: '第 2 步：统一调整节点',
          status: 'pending',
          detail: '导入节点后，再统一调整启用状态、节点字段和链式代理关系。'
        }
      : enabledNodeCount === 0
        ? {
            id: 'adjust',
            title: '第 2 步：统一调整节点',
            status: 'attention',
            detail: '当前没有启用节点。至少启用 1 个节点后，才能继续生成托管 URL。'
          }
        : {
            id: 'adjust',
            title: '第 2 步：统一调整节点',
            status: 'ready',
            detail: `当前已有 ${enabledNodeCount} 个启用节点，可以继续执行统一生成托管 URL。`
          };

  let generateStep: SingleUserWorkflowStep;

  if (input.hostedSubscriptionSyncStatus.kind === 'missing') {
    generateStep = {
      id: 'generate',
      title: '第 3 步：统一生成托管 URL',
      status: 'pending',
      detail: '当前还没有已保存的托管绑定。完成前两步后，请执行一次统一生成。'
    };
  } else if (input.hostedSubscriptionSyncStatus.kind === 'in_sync') {
    generateStep = {
      id: 'generate',
      title: '第 3 步：统一生成托管 URL',
      status: 'complete',
      detail: `当前托管绑定已和启用节点保持一致，可直接使用这组托管 URL。`
    };
  } else {
    generateStep = {
      id: 'generate',
      title: '第 3 步：统一生成托管 URL',
      status: 'attention',
      detail: `当前启用节点已经变化，但托管绑定仍是上一版。请重新执行统一生成。`
    };
  }

  return [importStep, adjustStep, generateStep];
}
