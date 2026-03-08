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
  return request('/api/setup/status', { method: 'GET' });
}

export async function bootstrapSetup(username: string, password: string): Promise<SetupBootstrapPayload> {
  return request('/api/setup/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function login(username: string, password: string): Promise<{ token: string; admin: AdminSession }> {
  return request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

export async function logout(token: string): Promise<LogoutPayload> {
  return request('/api/admin/logout', { method: 'POST' }, token);
}

export async function fetchMe(token: string): Promise<AdminSession> {
  return request('/api/admin/me', { method: 'GET' }, token);
}

export async function fetchUsers(token: string): Promise<UserRecord[]> {
  return request('/api/users', { method: 'GET' }, token);
}

export async function createUser(
  token: string,
  input: { name: string; remark?: string; expiresAt?: string }
): Promise<UserRecord> {
  return request('/api/users', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateUser(
  token: string,
  userId: string,
  input: { name?: string; status?: string; remark?: string; expiresAt?: string | null }
): Promise<UserRecord> {
  return request(`/api/users/${userId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function deleteUser(token: string, userId: string): Promise<{ deleted: true; userId: string }> {
  return request(`/api/users/${userId}`, { method: 'DELETE' }, token);
}

export async function resetUserToken(token: string, userId: string): Promise<UserRecord> {
  return request(`/api/users/${userId}/reset-token`, { method: 'POST' }, token);
}

export async function fetchUserNodeBindings(token: string, userId: string): Promise<UserNodeBinding[]> {
  return request(`/api/users/${userId}/nodes`, { method: 'GET' }, token);
}

export async function replaceUserNodeBindings(
  token: string,
  userId: string,
  nodeIds: string[]
): Promise<{ userId: string; nodeIds: string[] }> {
  return request(
    `/api/users/${userId}/nodes`,
    {
      method: 'POST',
      body: JSON.stringify({ nodeIds })
    },
    token
  );
}

export async function fetchNodes(token: string): Promise<NodeRecord[]> {
  return request('/api/nodes', { method: 'GET' }, token);
}

export async function createNode(
  token: string,
  input: { name: string; protocol: string; server: string; port: number }
): Promise<NodeRecord> {
  return request('/api/nodes', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateNode(
  token: string,
  nodeId: string,
  input: { name?: string; protocol?: string; server?: string; port?: number; enabled?: boolean }
): Promise<NodeRecord> {
  return request(`/api/nodes/${nodeId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function deleteNode(token: string, nodeId: string): Promise<{ deleted: true; nodeId: string }> {
  return request(`/api/nodes/${nodeId}`, { method: 'DELETE' }, token);
}

export async function fetchTemplates(token: string): Promise<TemplateRecord[]> {
  return request('/api/templates', { method: 'GET' }, token);
}

export async function createTemplate(
  token: string,
  input: { name: string; targetType: SubscriptionTarget; content: string; isDefault?: boolean }
): Promise<TemplateRecord> {
  return request('/api/templates', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateTemplate(
  token: string,
  templateId: string,
  input: { name?: string; content?: string; version?: number; enabled?: boolean; isDefault?: boolean }
): Promise<TemplateRecord> {
  return request(`/api/templates/${templateId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function deleteTemplate(
  token: string,
  templateId: string
): Promise<{ deleted: true; templateId: string }> {
  return request(`/api/templates/${templateId}`, { method: 'DELETE' }, token);
}

export async function setDefaultTemplate(token: string, templateId: string): Promise<TemplateRecord> {
  return request(`/api/templates/${templateId}/set-default`, { method: 'POST' }, token);
}

export async function fetchRuleSources(token: string): Promise<RuleSourceRecord[]> {
  return request('/api/rule-sources', { method: 'GET' }, token);
}

export async function createRuleSource(
  token: string,
  input: { name: string; sourceUrl: string; format: RuleSourceRecord['format'] }
): Promise<RuleSourceRecord> {
  return request('/api/rule-sources', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateRuleSource(
  token: string,
  ruleSourceId: string,
  input: { name?: string; sourceUrl?: string; format?: RuleSourceRecord['format']; enabled?: boolean }
): Promise<RuleSourceRecord> {
  return request(`/api/rule-sources/${ruleSourceId}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function deleteRuleSource(
  token: string,
  ruleSourceId: string
): Promise<{ deleted: true; ruleSourceId: string }> {
  return request(`/api/rule-sources/${ruleSourceId}`, { method: 'DELETE' }, token);
}

export async function syncRuleSource(token: string, ruleSourceId: string): Promise<RuleSourceSyncPayload> {
  return request(`/api/rule-sources/${ruleSourceId}/sync`, { method: 'POST' }, token);
}

export async function fetchSyncLogs(token: string): Promise<SyncLogRecord[]> {
  return request('/api/sync-logs', { method: 'GET' }, token);
}

export async function fetchAuditLogs(token: string): Promise<AuditLogRecord[]> {
  return request('/api/audit-logs', { method: 'GET' }, token);
}

export async function fetchPreview(
  token: string,
  userId: string,
  target: SubscriptionTarget
): Promise<PreviewPayload> {
  return request(`/api/preview/${userId}/${target}`, { method: 'GET' }, token);
}
