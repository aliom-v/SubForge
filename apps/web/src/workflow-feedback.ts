import type {
  NodeImportInput,
  NodeImportPayload,
  NodeImportPreviewPayload,
  RemoteSubscriptionSourceSyncPayload
} from './api';
import type { HostedSubscriptionResult, HostedSubscriptionSyncStatus } from './hosted-state';
import type { ImportedNodePayload } from './node-import';

const GENERATE_HOSTED_URL_HINT = '如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”';
const REGENERATE_HOSTED_URL_HINT = '如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”';

export function mapImportedNodesToNodeImportInput(importedNodes: ImportedNodePayload[]): NodeImportInput[] {
  return importedNodes.map((importedNode) => ({
    name: importedNode.name,
    protocol: importedNode.protocol,
    server: importedNode.server,
    port: importedNode.port,
    ...(importedNode.credentials ? { credentials: importedNode.credentials } : {}),
    ...(importedNode.params ? { params: importedNode.params } : {})
  }));
}

export function buildNodeImportSuccessMessage(result: NodeImportPayload, errorCount: number): string {
  return `已处理 ${result.importedCount} 个节点（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 去重 ${
    result.duplicateCount ?? 0
  }）${errorCount > 0 ? `，另有 ${errorCount} 条解析失败未导入` : ''}，已导入到节点列表；${GENERATE_HOSTED_URL_HINT}`;
}

export function buildConfigImportSuccessMessage(result: NodeImportPayload, errorCount: number): string {
  return `已处理 ${result.importedCount} 个节点（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 去重 ${
    result.duplicateCount ?? 0
  }）${errorCount > 0 ? `，另有 ${errorCount} 条解析失败未导入` : ''}，并已更新自动托管模板骨架；${GENERATE_HOSTED_URL_HINT}`;
}

export function buildRemotePreviewMessage(previewResult: NodeImportPreviewPayload): string {
  if (previewResult.nodes.length === 0) {
    return '远程订阅已抓取，但当前没有解析出可导入节点';
  }

  return `远程订阅已抓取，可导入 ${previewResult.nodes.length} 个节点${
    previewResult.errors.length > 0 ? `，另有 ${previewResult.errors.length} 条解析失败` : ''
  }`;
}

export function buildRemoteSubscriptionSourceSaveMessage(syncResult: RemoteSubscriptionSourceSyncPayload): string {
  if (syncResult.status === 'failed') {
    return `自动同步源已保存，但首次同步失败：${syncResult.message}`;
  }

  if (syncResult.changed) {
    return `自动同步源已保存并完成首次同步（新增 ${syncResult.createdCount} / 更新 ${syncResult.updatedCount} / 禁用 ${syncResult.disabledCount}）。${REGENERATE_HOSTED_URL_HINT}`;
  }

  return `自动同步源已保存，当前共 ${syncResult.importedCount} 个节点。${REGENERATE_HOSTED_URL_HINT}`;
}

export function buildRemoteSubscriptionSourceSyncMessage(result: RemoteSubscriptionSourceSyncPayload): string {
  if (result.status === 'failed') {
    return `自动同步失败：${result.message}`;
  }

  if (result.changed) {
    return `自动同步已完成（新增 ${result.createdCount} / 更新 ${result.updatedCount} / 禁用 ${result.disabledCount}）`;
  }

  return `自动同步无变化，共 ${result.importedCount} 个节点`;
}

export function buildHostedGenerationSuccessMessage(result: HostedSubscriptionResult): string {
  return `已按当前启用节点刷新托管 URL（${result.nodeCount} 个节点，${result.targets.filter((target) => target.ok).length}/${result.targets.length} 个目标已通过预览校验）`;
}

export function getHostedSyncStatusLabel(status: HostedSubscriptionSyncStatus): string {
  if (status.kind === 'missing') {
    return '未生成';
  }

  if (status.kind === 'in_sync') {
    return '已同步';
  }

  return '需要重新生成';
}
