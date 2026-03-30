import type { NodeImportInput, NodeImportPayload, RemoteSubscriptionSourceSyncPayload } from './api';
import type { HostedSubscriptionResult } from './hosted-state';
import type { ImportedConfigPayload, ImportedNodePayload } from './node-import';
import {
  buildConfigImportSuccessMessage,
  buildHostedGenerationSuccessMessage,
  buildNodeImportSuccessMessage,
  buildRemoteSubscriptionSourceSaveMessage,
  mapImportedNodesToNodeImportInput
} from './workflow-feedback';

export async function runNodeImportWorkflow(input: {
  importedNodes: ImportedNodePayload[];
  errorCount: number;
  importNodes: (nodes: NodeImportInput[]) => Promise<NodeImportPayload>;
  refreshResources: () => Promise<unknown>;
  onImported?: () => void | Promise<void>;
}): Promise<{ result: NodeImportPayload; message: string }> {
  if (input.importedNodes.length === 0) {
    throw new Error('没有可导入的节点');
  }

  const result = await input.importNodes(mapImportedNodesToNodeImportInput(input.importedNodes));
  await input.refreshResources();
  await input.onImported?.();

  return {
    result,
    message: buildNodeImportSuccessMessage(result, input.errorCount)
  };
}

export async function runConfigImportWorkflow<TTemplate>(input: {
  parsedConfigImport: ImportedConfigPayload;
  importNodes: (nodes: NodeImportInput[]) => Promise<NodeImportPayload>;
  refreshResources: () => Promise<{ templates: TTemplate[] }>;
  ensureAutoHostedTemplates: (templates: TTemplate[], importedConfig: ImportedConfigPayload) => Promise<void>;
}): Promise<{ result: NodeImportPayload; message: string }> {
  const result = await input.importNodes(mapImportedNodesToNodeImportInput(input.parsedConfigImport.nodes));
  const nextResources = await input.refreshResources();
  await input.ensureAutoHostedTemplates(nextResources.templates, input.parsedConfigImport);
  await input.refreshResources();

  return {
    result,
    message: buildConfigImportSuccessMessage(result, input.parsedConfigImport.errors.length)
  };
}

export async function runRemoteSubscriptionSourceSaveWorkflow<TSource extends { id: string }>(input: {
  sourceName: string;
  sourceUrl: string;
  createRemoteSubscriptionSource: (input: { name: string; sourceUrl: string }) => Promise<TSource>;
  syncRemoteSubscriptionSource: (sourceId: string) => Promise<RemoteSubscriptionSourceSyncPayload>;
  refreshResources: () => Promise<unknown>;
}): Promise<{ syncResult: RemoteSubscriptionSourceSyncPayload; message: string }> {
  const source = await input.createRemoteSubscriptionSource({
    name: input.sourceName,
    sourceUrl: input.sourceUrl
  });
  const syncResult = await input.syncRemoteSubscriptionSource(source.id);
  await input.refreshResources();

  return {
    syncResult,
    message: buildRemoteSubscriptionSourceSaveMessage(syncResult)
  };
}

interface EnabledNodeLike {
  enabled: boolean;
}

export async function runHostedGenerationWorkflow<TResources, TNodeRecord extends EnabledNodeLike>(input: {
  currentResources: TResources;
  nodeRecords: TNodeRecord[];
  ensureHostedSubscriptions: (input: {
    currentResources: TResources;
    sourceLabel: string;
    nodeRecords: TNodeRecord[];
  }) => Promise<HostedSubscriptionResult>;
  refreshResources: () => Promise<unknown>;
  sourceLabel?: string;
}): Promise<{ hostedResult: HostedSubscriptionResult; message: string }> {
  const enabledNodes = input.nodeRecords.filter((node) => node.enabled);

  if (enabledNodes.length === 0) {
    throw new Error('当前没有启用节点，无法生成托管订阅');
  }

  const hostedResult = await input.ensureHostedSubscriptions({
    currentResources: input.currentResources,
    sourceLabel: input.sourceLabel ?? '当前启用节点',
    nodeRecords: enabledNodes
  });
  await input.refreshResources();

  return {
    hostedResult,
    message: buildHostedGenerationSuccessMessage(hostedResult)
  };
}
