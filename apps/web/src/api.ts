import type { ImportedNodePayload, NodeImportContentEncoding } from '@subforge/core';
import type {
  AppErrorCode,
  AppErrorShape,
  NodeRecord,
  RemoteSubscriptionSourceRecord,
  SubscriptionTarget,
  TemplateRecord,
  UserNodeBinding,
  UserRecord
} from '@subforge/shared';

import { WEB_API_ROUTES } from './api-routes.js';

const API_BASE_URL =
  ((import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL as string | undefined) ??
  '';

export const APP_API_ERROR_CODES = {
  networkError: 'NETWORK_ERROR',
  invalidResponse: 'INVALID_RESPONSE'
} as const;

export type AppApiErrorCode = AppErrorCode | (typeof APP_API_ERROR_CODES)[keyof typeof APP_API_ERROR_CODES];

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

export interface RemoteSubscriptionSourceSyncPayload {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  status: 'success' | 'failed' | 'skipped';
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
  details?: Record<string, unknown>;
}

export interface LogoutPayload {
  loggedOut: boolean;
  serverRevocation: boolean;
  mode: 'client_only' | 'server_revoked';
  revokedAt?: string;
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

export class AppApiError extends Error {
  code: AppApiErrorCode;
  status?: number;
  details?: Record<string, unknown>;

  constructor(input: {
    code: AppApiErrorCode;
    message: string;
    status?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message, 'cause' in input ? { cause: input.cause } : undefined);
    this.name = 'AppApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

export function isAppApiError(error: unknown): error is AppApiError {
  return (
    error instanceof AppApiError ||
    (isRecord(error) &&
      error.name === 'AppApiError' &&
      typeof error.code === 'string' &&
      typeof error.message === 'string' &&
      ('status' in error ? typeof error.status === 'number' || error.status === undefined : true))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSuccessEnvelope<T>(value: unknown): value is SuccessEnvelope<T> {
  return isRecord(value) && value.ok === true && 'data' in value;
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    isRecord(value) &&
    value.ok === false &&
    'error' in value &&
    isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  );
}

function parseJsonResponseBody(rawBody: string): unknown {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {})
      }
    });
  } catch (cause) {
    throw new AppApiError({
      code: APP_API_ERROR_CODES.networkError,
      message: 'network request failed',
      cause
    });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();
  const data = parseJsonResponseBody(rawBody);

  if (isErrorEnvelope(data)) {
    throw new AppApiError({
      code: data.error.code,
      message: data.error.message,
      status: response.status,
      details: data.error.details
    });
  }

  if (response.ok && isSuccessEnvelope<T>(data)) {
    return data.data;
  }

  throw new AppApiError({
    code: APP_API_ERROR_CODES.invalidResponse,
    message: 'server returned an invalid response',
    status: response.status,
    details: {
      contentType,
      ...(rawBody ? { bodyPreview: rawBody.slice(0, 200) } : {})
    }
  });
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

export async function resetHostedSubscriptionToken(token: string): Promise<UserRecord> {
  return request(
    WEB_API_ROUTES.resetHostedSubscriptionToken.buildPath(),
    { method: WEB_API_ROUTES.resetHostedSubscriptionToken.method },
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

export async function previewNodeImportFromUrl(token: string, sourceUrl: string): Promise<NodeImportPreviewPayload> {
  return request(
    WEB_API_ROUTES.previewNodeImport.buildPath(),
    {
      method: WEB_API_ROUTES.previewNodeImport.method,
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
  return request(
    WEB_API_ROUTES.deleteNode.buildPath(nodeId),
    { method: WEB_API_ROUTES.deleteNode.method },
    token
  );
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

export async function fetchRemoteSubscriptionSources(token: string): Promise<RemoteSubscriptionSourceRecord[]> {
  return request(
    WEB_API_ROUTES.fetchRemoteSubscriptionSources.buildPath(),
    { method: WEB_API_ROUTES.fetchRemoteSubscriptionSources.method },
    token
  );
}

export async function createRemoteSubscriptionSource(
  token: string,
  input: { name?: string; sourceUrl: string; enabled?: boolean }
): Promise<RemoteSubscriptionSourceRecord> {
  return request(
    WEB_API_ROUTES.createRemoteSubscriptionSource.buildPath(),
    { method: WEB_API_ROUTES.createRemoteSubscriptionSource.method, body: JSON.stringify(input) },
    token
  );
}

export async function updateRemoteSubscriptionSource(
  token: string,
  sourceId: string,
  input: { name?: string; sourceUrl?: string; enabled?: boolean }
): Promise<RemoteSubscriptionSourceRecord> {
  return request(
    WEB_API_ROUTES.updateRemoteSubscriptionSource.buildPath(sourceId),
    { method: WEB_API_ROUTES.updateRemoteSubscriptionSource.method, body: JSON.stringify(input) },
    token
  );
}

export async function deleteRemoteSubscriptionSource(
  token: string,
  sourceId: string
): Promise<{ deleted: true; remoteSubscriptionSourceId: string }> {
  return request(
    WEB_API_ROUTES.deleteRemoteSubscriptionSource.buildPath(sourceId),
    { method: WEB_API_ROUTES.deleteRemoteSubscriptionSource.method },
    token
  );
}

export async function syncRemoteSubscriptionSource(
  token: string,
  sourceId: string
): Promise<RemoteSubscriptionSourceSyncPayload> {
  return request(
    WEB_API_ROUTES.syncRemoteSubscriptionSource.buildPath(sourceId),
    { method: WEB_API_ROUTES.syncRemoteSubscriptionSource.method },
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
