import type { RemoteSubscriptionSourceSyncPayload } from './api';
import type { RemoteSubscriptionSourceRecord } from '@subforge/shared';

export interface RemoteSyncNodeChainIssue {
  nodeId: string;
  nodeName: string;
  kind: string;
  message: string;
  reference: string | null;
  chain: string | null;
  upstreamProxy: string | null;
}

export interface RemoteSyncNodeChainDiagnostics {
  operation: string | null;
  issueCount: number;
  issues: RemoteSyncNodeChainIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readIssue(value: unknown): RemoteSyncNodeChainIssue | null {
  if (!isRecord(value)) {
    return null;
  }

  const nodeId = readString(value.nodeId);
  const kind = readString(value.kind);
  const message = readString(value.message);

  if (!nodeId || !kind || !message) {
    return null;
  }

  return {
    nodeId,
    nodeName: readString(value.nodeName) ?? nodeId,
    kind,
    message,
    reference: readString(value.reference),
    chain: readString(value.chain),
    upstreamProxy: readString(value.upstreamProxy)
  };
}

export function getRemoteSyncNodeChainDiagnostics(
  result:
    | Pick<RemoteSubscriptionSourceSyncPayload, 'details'>
    | Pick<RemoteSubscriptionSourceRecord, 'lastSyncDetails'>
    | null
    | undefined
): RemoteSyncNodeChainDiagnostics | null {
  let details: unknown = null;

  if (result && 'details' in result) {
    details = result.details;
  } else if (result && 'lastSyncDetails' in result) {
    details = result.lastSyncDetails;
  }

  if (!isRecord(details) || details.scope !== 'node_chain' || !Array.isArray(details.issues)) {
    return null;
  }

  const issues = details.issues.map(readIssue).filter((issue): issue is RemoteSyncNodeChainIssue => issue !== null);

  if (issues.length === 0) {
    return null;
  }

  return {
    operation: readString(details.operation),
    issueCount: typeof details.issueCount === 'number' && Number.isFinite(details.issueCount) ? details.issueCount : issues.length,
    issues
  };
}
