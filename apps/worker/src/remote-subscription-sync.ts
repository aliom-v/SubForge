import { parseNodeImportText, type NodeImportContentEncoding } from '@subforge/core';
import type { JsonValue, RemoteSubscriptionSourceRecord } from '@subforge/shared';
import { invalidateUsersCaches } from './cache';
import type { Env } from './env';
import {
  createNode,
  listEnabledRemoteSubscriptionSources,
  listNodes,
  listNodesBySource,
  listUserNodeBindings,
  listUsersByNodeId,
  recordRemoteSubscriptionSourceSync,
  replaceUserNodes,
  updateNode
} from './repository';
import {
  createNodeChainValidationError,
  createPendingNodeRecord,
  findIntroducedNodeChainIssues,
  mergeNodeRecords
} from './node-chain-validation';
import { normalizeImportedNodes, planRemoteNodeSync, type ImportedNodeInput } from './node-source';
import { fetchText } from './sync';

function compactRecord(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record as Record<string, unknown>).filter(([, value]) => value !== undefined));
}

function toDetailsRecord(details: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return compactRecord(details) as Record<string, JsonValue>;
}

async function listAffectedUsersByNodeIds(
  env: Env,
  nodeIds: string[]
): Promise<Array<{ id: string; token: string }>> {
  const users = await Promise.all(nodeIds.map((nodeId) => listUsersByNodeId(env.DB, nodeId)));
  const deduped = new Map<string, { id: string; token: string }>();

  for (const group of users) {
    for (const user of group) {
      deduped.set(user.id, user);
    }
  }

  return [...deduped.values()];
}

async function refreshAffectedUserBindings(
  env: Env,
  affectedUsers: Array<{ id: string; token: string }>,
  previousSourceNodeIds: string[],
  nextSourceNodeIds: string[]
): Promise<void> {
  if (affectedUsers.length === 0) {
    return;
  }

  const previousSourceNodeIdSet = new Set(previousSourceNodeIds);
  const dedupedNextSourceNodeIds = [...new Set(nextSourceNodeIds)];

  for (const user of affectedUsers) {
    const bindings = await listUserNodeBindings(env.DB, user.id);
    const nextUserNodeIds = [
      ...bindings.map((binding) => binding.nodeId).filter((nodeId) => !previousSourceNodeIdSet.has(nodeId)),
      ...dedupedNextSourceNodeIds
    ];

    await replaceUserNodes(env.DB, user.id, [...new Set(nextUserNodeIds)]);
  }

  await invalidateUsersCaches(env, affectedUsers);
}

export interface RemoteSubscriptionSourceSyncResult {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: Exclude<RemoteSubscriptionSourceRecord['lastSyncStatus'], null | undefined>;
  message: string;
  changed: boolean;
  importedAt: string;
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
  disabledCount: number;
  errorCount: number;
  lineCount: number;
  contentEncoding?: NodeImportContentEncoding;
  details?: Record<string, JsonValue>;
}

export async function syncRemoteSubscriptionSourceNow(
  env: Env,
  source: RemoteSubscriptionSourceRecord
): Promise<RemoteSubscriptionSourceSyncResult> {
  const importedAt = new Date().toISOString();
  const startedAt = Date.now();
  const currentNodes = await listNodes(env.DB);
  const existingSourceNodes = currentNodes.filter(
    (node) => node.sourceType === 'remote' && (node.sourceId ?? null) === source.id
  );
  const existingSourceNodeIds = existingSourceNodes.map((node) => node.id);
  const affectedUsers = await listAffectedUsersByNodeIds(env, existingSourceNodeIds);
  let upstream: Awaited<ReturnType<typeof fetchText>> | null = null;

  try {
    upstream = await fetchText(source.sourceUrl, Number(env.SYNC_HTTP_TIMEOUT_MS || '10000'));

    if (!upstream.text) {
      const message = 'upstream content is empty';
      const details = toDetailsRecord({
        sourceUrl: source.sourceUrl,
        durationMs: upstream.durationMs,
        upstreamStatus: upstream.status,
        fetchedBytes: upstream.fetchedBytes,
        ...(upstream.contentType ? { contentType: upstream.contentType } : {}),
        reason: message
      });
      await recordRemoteSubscriptionSourceSync(env.DB, source.id, 'failed', message, details);
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.sourceUrl,
        status: 'failed',
        message,
        changed: false,
        importedAt,
        importedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
        disabledCount: 0,
        errorCount: 0,
        lineCount: 0,
        details
      };
    }

    const parsed = parseNodeImportText(upstream.text);

    if (parsed.nodes.length === 0) {
      const message = parsed.errors[0] ?? 'no nodes parsed from upstream subscription';
      const details = toDetailsRecord({
        sourceUrl: source.sourceUrl,
        durationMs: upstream.durationMs,
        upstreamStatus: upstream.status,
        fetchedBytes: upstream.fetchedBytes,
        ...(upstream.contentType ? { contentType: upstream.contentType } : {}),
        lineCount: parsed.lineCount,
        contentEncoding: parsed.contentEncoding,
        errorCount: parsed.errors.length,
        ...(parsed.errors.length > 0 ? { errorSummary: parsed.errors.slice(0, 5).join(' | ') } : {}),
        reason: message
      });
      await recordRemoteSubscriptionSourceSync(env.DB, source.id, 'failed', message, details);
      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.sourceUrl,
        status: 'failed',
        message,
        changed: false,
        importedAt,
        importedCount: 0,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount: 0,
        disabledCount: 0,
        errorCount: parsed.errors.length,
        lineCount: parsed.lineCount,
        contentEncoding: parsed.contentEncoding,
        details
      };
    }

    const importedNodes: ImportedNodeInput[] = parsed.nodes.map((node) => ({
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      ...(node.credentials ? { credentials: node.credentials as Record<string, JsonValue> } : {}),
      ...(node.params ? { params: node.params as Record<string, JsonValue> } : {})
    }));
    const { nodes: dedupedNodes, duplicateCount } = normalizeImportedNodes(importedNodes, 'remote', source.id);
    const plan = planRemoteNodeSync(existingSourceNodes, dedupedNodes);
    const staleToDisable = plan.stale.filter((node) => node.enabled);
    const introducedIssues = await findIntroducedNodeChainIssues(
      env.DB,
      currentNodes,
      mergeNodeRecords(currentNodes, {
        replacements: [
          ...plan.updated.map((update) =>
            createPendingNodeRecord({
              ...update.current,
              ...update.next,
              id: update.current.id,
              createdAt: update.current.createdAt,
              updatedAt: update.current.updatedAt,
              lastSyncAt: importedAt
            })
          ),
          ...staleToDisable.map((node) =>
            createPendingNodeRecord({
              ...node,
              enabled: false,
              lastSyncAt: importedAt
            })
          )
        ],
        additions: plan.created.map((node, index) =>
          createPendingNodeRecord({
            id: `__pending_remote_node_${source.id}_${index}__`,
            ...node,
            lastSyncAt: importedAt
          })
        )
      })
    );

    if (introducedIssues.length > 0) {
      const validationError = createNodeChainValidationError(
        introducedIssues,
        'remote_subscription_source.sync'
      );
      const details = toDetailsRecord({
        sourceUrl: source.sourceUrl,
        durationMs: Date.now() - startedAt,
        upstreamStatus: upstream.status,
        fetchedBytes: upstream.fetchedBytes,
        ...(upstream.contentType ? { contentType: upstream.contentType } : {}),
        lineCount: parsed.lineCount,
        contentEncoding: parsed.contentEncoding,
        importedCount: dedupedNodes.length,
        duplicateCount,
        errorCount: parsed.errors.length + introducedIssues.length,
        ...(parsed.errors.length > 0 ? { errorSummary: parsed.errors.slice(0, 5).join(' | ') } : {}),
        ...(validationError.details as Record<string, JsonValue>),
        reason: validationError.message
      });
      await recordRemoteSubscriptionSourceSync(env.DB, source.id, 'failed', validationError.message, details);

      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.sourceUrl,
        status: 'failed',
        message: validationError.message,
        changed: false,
        importedAt,
        importedCount: dedupedNodes.length,
        createdCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        duplicateCount,
        disabledCount: 0,
        errorCount: parsed.errors.length + introducedIssues.length,
        lineCount: parsed.lineCount,
        contentEncoding: parsed.contentEncoding,
        details
      };
    }

    for (const node of plan.created) {
      await createNode(env.DB, {
        ...node,
        lastSyncAt: importedAt
      });
    }

    for (const update of plan.updated) {
      await updateNode(env.DB, update.current.id, {
        ...update.next,
        lastSyncAt: importedAt
      });
    }

    for (const staleNode of staleToDisable) {
      await updateNode(env.DB, staleNode.id, {
        enabled: false,
        lastSyncAt: importedAt
      });
    }

    const nextEnabledSourceNodes = (await listNodesBySource(env.DB, 'remote', source.id)).filter((node) => node.enabled);
    await refreshAffectedUserBindings(
      env,
      affectedUsers,
      existingSourceNodeIds,
      nextEnabledSourceNodes.map((node) => node.id)
    );

    const changed = plan.created.length + plan.updated.length + staleToDisable.length > 0;
    const status: Exclude<RemoteSubscriptionSourceRecord['lastSyncStatus'], null | undefined> = changed ? 'success' : 'skipped';
    const message = changed
      ? `subscription updated (${dedupedNodes.length} nodes)`
      : `subscription unchanged (${dedupedNodes.length} nodes)`;
    const details = toDetailsRecord({
      sourceUrl: source.sourceUrl,
      durationMs: Date.now() - startedAt,
      upstreamStatus: upstream.status,
      fetchedBytes: upstream.fetchedBytes,
      ...(upstream.contentType ? { contentType: upstream.contentType } : {}),
      lineCount: parsed.lineCount,
      contentEncoding: parsed.contentEncoding,
      importedCount: dedupedNodes.length,
      createdCount: plan.created.length,
      updatedCount: plan.updated.length,
      unchangedCount: plan.unchanged.length,
      duplicateCount,
      disabledCount: staleToDisable.length,
      errorCount: parsed.errors.length,
      ...(parsed.errors.length > 0 ? { errorSummary: parsed.errors.slice(0, 5).join(' | ') } : {})
    });

    await recordRemoteSubscriptionSourceSync(env.DB, source.id, status, message, details);

    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.sourceUrl,
      status,
      message,
      changed,
      importedAt,
      importedCount: dedupedNodes.length,
      createdCount: plan.created.length,
      updatedCount: plan.updated.length,
      unchangedCount: plan.unchanged.length,
      duplicateCount,
      disabledCount: staleToDisable.length,
      errorCount: parsed.errors.length,
      lineCount: parsed.lineCount,
      contentEncoding: parsed.contentEncoding,
      details
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'remote subscription sync failed';
    const details = toDetailsRecord({
      sourceUrl: source.sourceUrl,
      durationMs: Date.now() - startedAt,
      ...(upstream ? { upstreamStatus: upstream.status, fetchedBytes: upstream.fetchedBytes } : {}),
      ...(upstream?.contentType ? { contentType: upstream.contentType } : {}),
      reason: message
    });
    await recordRemoteSubscriptionSourceSync(env.DB, source.id, 'failed', message, details);

    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.sourceUrl,
      status: 'failed',
      message,
      changed: false,
      importedAt,
      importedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      duplicateCount: 0,
      disabledCount: 0,
      errorCount: 0,
      lineCount: 0,
      details
    };
  }
}

export async function runEnabledRemoteSubscriptionSourceSync(
  env: Env
): Promise<RemoteSubscriptionSourceSyncResult[]> {
  const sources = await listEnabledRemoteSubscriptionSources(env.DB);
  const results: RemoteSubscriptionSourceSyncResult[] = [];

  for (const source of sources) {
    results.push(await syncRemoteSubscriptionSourceNow(env, source));
  }

  return results;
}
