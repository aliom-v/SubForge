import type { ImportedNodePayload, NodeImportContentEncoding } from '@subforge/core';
import type {
  AppErrorShape,
  AuditLogRecord,
  NodeRecord,
  RuleSourceRecord,
  SubscriptionTarget,
  SyncLogRecord,
  TemplateRecord,
  UserNodeBinding,
  UserRecord
} from '@subforge/shared';

import { WEB_API_ROUTES } from './api-routes.js';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export interface AdminSession {
  id: string;
  username: string;
  role: string;
  status: string;
}


export interface SetupStatusPayload {
  initialized: boolean;
  adminCount: number;
}

export interface SetupBootstrapPayload {
  initialized: boolean;
  token: string;
  admin: AdminSession;
}

export interface PreviewPayload {
  cacheKey: string;
  mimeType: string;
  content: string;
  metadata: {
    userId: string;
    nodeCount: number;
    ruleSetCount: number;
    templateName: string;
  };
}

export interface NodeImportPreviewPayload {
  sourceUrl: string;
  upstreamStatus: number;
  durationMs: number;
  fetchedBytes: number;
  lineCount: number;
  contentEncoding: NodeImportContentEncoding;
  nodes: ImportedNodePayload[];
  errors: string[];
}

export interface RuleSourceSyncPayload {
  sourceId: string;
  sourceName: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  changed: boolean;
  ruleCount: number;
  details?: Record<string, unknown>;
}

export interface LogoutPayload {
  loggedOut: boolean;
  serverRevocation: boolean;
  mode: 'client_only' | 'server_revoked';
  revokedAt?: string;
}

export interface CacheRebuildPayload {
  userCount: number;
  targets: SubscriptionTarget[];
  keysRequested: number;
  rebuiltAt: string;
}

export interface NodeImportInput {
  name: string;
  protocol: string;
  server: string;
  port: number;
  enabled?: boolean;
  credentials?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface NodeImportPayload {
  importedCount: number;
  importedAt: string;
  sourceType?: NodeRecord['sourceType'];
  sourceId?: string | null;
  createdCount?: number;
  updatedCount?: number;
  unchangedCount?: number;
  duplicateCount?: number;
  disabledCount?: number;
  changed?: boolean;
}

interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

interface ErrorEnvelope {
  ok: false;
  error: AppErrorShape;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });

  const data = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;

  if (!response.ok || !data.ok) {
    const error = 'error' in data ? data.error : { code: 'NOT_FOUND', message: 'request failed' };
    throw new Error(`${error.code}: ${error.message}`);
  }

  return data.data;
}

export async function fetchSetupStatus(): Promise<SetupStatusPayload> {
  return request(WEB_API_ROUTES.fetchSetupStatus.buildPath(), { method: WEB_API_ROUTES.fetchSetupStatus.method });
}

export async function bootstrapSetup(username: string, password: string): Promise<SetupBootstrapPayload> {
  return request(WEB_API_ROUTES.bootstrapSetup.buildPath(), {
    method: WEB_API_ROUTES.bootstrapSetup.method,
    body: JSON.stringify({ username, password })
  });
}

export async function login(username: string, password: string): Promise<{ token: string; admin: AdminSession }> {
  return request(WEB_API_ROUTES.login.buildPath(), {
    method: WEB_API_ROUTES.login.method,
    body: JSON.stringify({ username, password })
  });
}

export async function logout(token: string): Promise<LogoutPayload> {
  return request(WEB_API_ROUTES.logout.buildPath(), { method: WEB_API_ROUTES.logout.method }, token);
}

export async function fetchMe(token: string): Promise<AdminSession> {
  return request(WEB_API_ROUTES.fetchMe.buildPath(), { method: WEB_API_ROUTES.fetchMe.method }, token);
}

export async function fetchUsers(token: string): Promise<UserRecord[]> {
  return request(WEB_API_ROUTES.fetchUsers.buildPath(), { method: WEB_API_ROUTES.fetchUsers.method }, token);
}

export async function createUser(
  token: string,
  input: { name: string; remark?: string; expiresAt?: string }
): Promise<UserRecord> {
  return request(
    WEB_API_ROUTES.createUser.buildPath(),
    { method: WEB_API_ROUTES.createUser.method, body: JSON.stringify(input) },
    token
  );
}

export async function updateUser(
  token: string,
  userId: string,
  input: { name?: string; status?: string; remark?: string; expiresAt?: string | null }
): Promise<UserRecord> {
  return request(
    WEB_API_ROUTES.updateUser.buildPath(userId),
    { method: WEB_API_ROUTES.updateUser.method, body: JSON.stringify(input) },
    token
  );
}

export async function deleteUser(token: string, userId: string): Promise<{ deleted: true; userId: string }> {
  return request(`/api/users/${userId}`, { method: 'DELETE' }, token);
}

export async function resetUserToken(token: string, userId: string): Promise<UserRecord> {
  return request(
    WEB_API_ROUTES.resetUserToken.buildPath(userId),
    { method: WEB_API_ROUTES.resetUserToken.method },
    token
  );
}

export async function fetchUserNodeBindings(token: string, userId: string): Promise<UserNodeBinding[]> {
  return request(
    WEB_API_ROUTES.fetchUserNodeBindings.buildPath(userId),
    { method: WEB_API_ROUTES.fetchUserNodeBindings.method },
    token
  );
}

export async function replaceUserNodeBindings(
  token: string,
  userId: string,
  nodeIds: string[]
): Promise<{ userId: string; nodeIds: string[] }> {
  return request(
    WEB_API_ROUTES.replaceUserNodeBindings.buildPath(userId),
    {
      method: WEB_API_ROUTES.replaceUserNodeBindings.method,
      body: JSON.stringify({ nodeIds })
    },
    token
  );
}

export async function fetchNodes(token: string): Promise<NodeRecord[]> {
  return request(WEB_API_ROUTES.fetchNodes.buildPath(), { method: WEB_API_ROUTES.fetchNodes.method }, token);
}

export async function createNode(
  token: string,
  input: {
    name: string;
    protocol: string;
    server: string;
    port: number;
    credentials?: Record<string, unknown> | null;
    params?: Record<string, unknown> | null;
  }
): Promise<NodeRecord> {
  return request(
    WEB_API_ROUTES.createNode.buildPath(),
    { method: WEB_API_ROUTES.createNode.method, body: JSON.stringify(input) },
    token
  );
}

export async function importNodes(token: string, input: NodeImportInput[]): Promise<NodeImportPayload> {
  return request(
    WEB_API_ROUTES.importNodes.buildPath(),
    { method: WEB_API_ROUTES.importNodes.method, body: JSON.stringify({ nodes: input }) },
    token
  );
}

export async function importRemoteNodes(token: string, sourceUrl: string): Promise<NodeImportPayload> {
  return request(
    WEB_API_ROUTES.importRemoteNodes.buildPath(),
    { method: WEB_API_ROUTES.importRemoteNodes.method, body: JSON.stringify({ sourceUrl }) },
    token
  );
}

export async function previewNodeImportFromUrl(token: string, sourceUrl: string): Promise<NodeImportPreviewPayload> {
  return request(
    '/api/node-import/preview',
    {
      method: 'POST',
      body: JSON.stringify({ sourceUrl })
    },
    token
  );
}

export async function updateNode(
  token: string,
  nodeId: string,
  input: {
    name?: string;
    protocol?: string;
    server?: string;
    port?: number;
    enabled?: boolean;
    credentials?: Record<string, unknown> | null;
    params?: Record<string, unknown> | null;
  }
): Promise<NodeRecord> {
  return request(
    WEB_API_ROUTES.updateNode.buildPath(nodeId),
    { method: WEB_API_ROUTES.updateNode.method, body: JSON.stringify(input) },
    token
  );
}

export async function deleteNode(token: string, nodeId: string): Promise<{ deleted: true; nodeId: string }> {
  return request(`/api/nodes/${nodeId}`, { method: 'DELETE' }, token);
}

export async function fetchTemplates(token: string): Promise<TemplateRecord[]> {
  return request(
    WEB_API_ROUTES.fetchTemplates.buildPath(),
    { method: WEB_API_ROUTES.fetchTemplates.method },
    token
  );
}

export async function createTemplate(
  token: string,
  input: { name: string; targetType: SubscriptionTarget; content: string; isDefault?: boolean }
): Promise<TemplateRecord> {
  return request(
    WEB_API_ROUTES.createTemplate.buildPath(),
    { method: WEB_API_ROUTES.createTemplate.method, body: JSON.stringify(input) },
    token
  );
}

export async function updateTemplate(
  token: string,
  templateId: string,
  input: { name?: string; content?: string; version?: number; enabled?: boolean; isDefault?: boolean }
): Promise<TemplateRecord> {
  return request(
    WEB_API_ROUTES.updateTemplate.buildPath(templateId),
    { method: WEB_API_ROUTES.updateTemplate.method, body: JSON.stringify(input) },
    token
  );
}

export async function deleteTemplate(
  token: string,
  templateId: string
): Promise<{ deleted: true; templateId: string }> {
  return request(`/api/templates/${templateId}`, { method: 'DELETE' }, token);
}

export async function setDefaultTemplate(token: string, templateId: string): Promise<TemplateRecord> {
  return request(
    WEB_API_ROUTES.setDefaultTemplate.buildPath(templateId),
    { method: WEB_API_ROUTES.setDefaultTemplate.method },
    token
  );
}

export async function fetchRuleSources(token: string): Promise<RuleSourceRecord[]> {
  return request(
    WEB_API_ROUTES.fetchRuleSources.buildPath(),
    { method: WEB_API_ROUTES.fetchRuleSources.method },
    token
  );
}

export async function createRuleSource(
  token: string,
  input: { name: string; sourceUrl: string; format: RuleSourceRecord['format'] }
): Promise<RuleSourceRecord> {
  return request(
    WEB_API_ROUTES.createRuleSource.buildPath(),
    { method: WEB_API_ROUTES.createRuleSource.method, body: JSON.stringify(input) },
    token
  );
}

export async function updateRuleSource(
  token: string,
  ruleSourceId: string,
  input: { name?: string; sourceUrl?: string; format?: RuleSourceRecord['format']; enabled?: boolean }
): Promise<RuleSourceRecord> {
  return request(
    WEB_API_ROUTES.updateRuleSource.buildPath(ruleSourceId),
    { method: WEB_API_ROUTES.updateRuleSource.method, body: JSON.stringify(input) },
    token
  );
}

export async function deleteRuleSource(
  token: string,
  ruleSourceId: string
): Promise<{ deleted: true; ruleSourceId: string }> {
  return request(`/api/rule-sources/${ruleSourceId}`, { method: 'DELETE' }, token);
}

export async function syncRuleSource(token: string, ruleSourceId: string): Promise<RuleSourceSyncPayload> {
  return request(
    WEB_API_ROUTES.syncRuleSource.buildPath(ruleSourceId),
    { method: WEB_API_ROUTES.syncRuleSource.method },
    token
  );
}

export async function fetchSyncLogs(token: string): Promise<SyncLogRecord[]> {
  return request(
    WEB_API_ROUTES.fetchSyncLogs.buildPath(),
    { method: WEB_API_ROUTES.fetchSyncLogs.method },
    token
  );
}

export async function fetchAuditLogs(token: string): Promise<AuditLogRecord[]> {
  return request(
    WEB_API_ROUTES.fetchAuditLogs.buildPath(),
    { method: WEB_API_ROUTES.fetchAuditLogs.method },
    token
  );
}

export async function rebuildSubscriptionCaches(token: string): Promise<CacheRebuildPayload> {
  return request(
    WEB_API_ROUTES.rebuildSubscriptionCaches.buildPath(),
    { method: WEB_API_ROUTES.rebuildSubscriptionCaches.method },
    token
  );
}

export async function fetchPreview(
  token: string,
  userId: string,
  target: SubscriptionTarget
): Promise<PreviewPayload> {
  return request(
    WEB_API_ROUTES.fetchPreview.buildPath(userId, target),
    { method: WEB_API_ROUTES.fetchPreview.method },
    token
  );
}
