import type { JsonValue, RemoteSubscriptionSourceRecord } from '@subforge/shared';

import type { RemoteSubscriptionSourceSyncPayload } from './api';

export interface RemoteSyncDetailEntry {
  label: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

export function getRemoteSyncDetailEntries(
  result:
    | Pick<RemoteSubscriptionSourceSyncPayload, 'details'>
    | Pick<RemoteSubscriptionSourceRecord, 'lastSyncDetails'>
    | Record<string, JsonValue>
    | null
    | undefined
): RemoteSyncDetailEntry[] {
  const details =
    result && 'details' in result
      ? result.details
      : result && 'lastSyncDetails' in result
        ? result.lastSyncDetails
        : result;

  if (!isRecord(details)) {
    return [];
  }

  const detailRecord = details as Record<string, JsonValue>;
  const entries: RemoteSyncDetailEntry[] = [];
  const preferredFields: Array<[string, string]> = [
    ['scope', '范围'],
    ['operation', '操作'],
    ['stage', '阶段'],
    ['errorCode', '错误码'],
    ['reason', '原因'],
    ['upstreamStatus', '上游状态'],
    ['durationMs', '耗时 ms'],
    ['fetchedBytes', '体积 bytes'],
    ['contentType', '内容类型'],
    ['contentEncoding', '内容编码'],
    ['lineCount', '有效行'],
    ['importedCount', '节点数'],
    ['createdCount', '新增'],
    ['updatedCount', '更新'],
    ['disabledCount', '禁用'],
    ['duplicateCount', '去重'],
    ['issueCount', '问题数']
  ];

  for (const [key, label] of preferredFields) {
    const value = detailRecord[key];

    if (value === undefined || value === null || key === 'issues') {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      entries.push({ label, value: String(value) });
    }
  }

  for (const [key, value] of Object.entries(detailRecord)) {
    if (preferredFields.some(([preferredKey]) => preferredKey === key) || value === undefined || value === null || key === 'issues') {
      continue;
    }

    entries.push({
      label: key,
      value: formatValue(value)
    });
  }

  return entries;
}

export function getRemoteSyncDetailReason(
  result:
    | Pick<RemoteSubscriptionSourceSyncPayload, 'details'>
    | Pick<RemoteSubscriptionSourceRecord, 'lastSyncDetails'>
    | null
    | undefined
): string | null {
  const details =
    result && 'details' in result
      ? result.details
      : result && 'lastSyncDetails' in result
        ? result.lastSyncDetails
        : null;

  if (!isRecord(details)) {
    return null;
  }

  return readString(details.reason) ?? readString(details.message) ?? readString(details.errorCode) ?? null;
}

export function getRemoteSyncIssueCount(
  result:
    | Pick<RemoteSubscriptionSourceSyncPayload, 'details'>
    | Pick<RemoteSubscriptionSourceRecord, 'lastSyncDetails'>
    | null
    | undefined
): number {
  const details =
    result && 'details' in result
      ? result.details
      : result && 'lastSyncDetails' in result
        ? result.lastSyncDetails
        : null;

  if (!isRecord(details)) {
    return 0;
  }

  return readNumber(details.issueCount) ?? (Array.isArray(details.issues) ? details.issues.length : 0) ?? 0;
}
