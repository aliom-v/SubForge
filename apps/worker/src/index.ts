import {
  canonicalizeNodeProtocol,
  compileSubscription,
  parseNodeImportText,
  validateNodeProtocolMetadata
} from '@subforge/core';
import {
  API_PREFIX,
  APP_ERROR_CODES,
  APP_NAME,
  buildPreviewCacheKey,
  buildSubscriptionCacheKey,
  createAppError,
  HEALTH_ENDPOINT,
  NODE_SOURCE_TYPES,
  RULE_SOURCE_FORMATS,
  SUBSCRIPTION_TARGETS,
  USER_STATUSES,
  type AdminRecord,
  type AppErrorShape,
  type JsonValue,
  type NodeSourceType,
  type RuleSourceFormat,
  type SubscriptionTarget,
  type UserStatus
} from '@subforge/shared';
import { sanitizeAuditPayload } from './audit';
import type { Env } from './env';
import { fail, json, notFound, ok, parseJsonBody, preflight, readBearerToken, text, isRecord } from './http';
import {
  createAdmin,
  createNode,
  createRuleSource,
  createTemplate,
  createUser,
  deleteRuleSource,
  deleteTemplate,
  deleteUser,
  deleteNode,
  countAdmins,
  getAdminById,
  getAdminLoginRowByUsername,
  getDefaultTemplateByTarget,
  getNodeById,
  getRuleSourceById,
  getTemplateById,
  getSubscriptionCompileInputByToken,
  getSubscriptionCompileInputByUserId,
  revokeAdminSessions,
  getUserById,
  getUserByToken,
  listAuditLogs,
  listNodes,
  listNodesBySource,
  listRuleSources,
  listSyncLogs,
  listTemplates,
  listUserNodeBindings,
  listUsers,
  listUsersByNodeId,
  recordNodeSourceSync,
  replaceUserNodes,
  createAuditLog,
  resetUserToken,
  setDefaultTemplate,
  updateNode,
  updateRuleSource,
  updateTemplate,
  updateUser
} from './repository';
import { hashPassword, signAdminSessionToken, verifyAdminSessionToken, verifyPassword } from './security';
import {
  invalidateAllUserCaches,
  invalidateNodeAffectedCaches,
  invalidateUserCaches,
  invalidateUsersCaches,
  rebuildSubscriptionCaches
} from './cache';
import {
  clearAdminLoginRateLimit,
  consumeSubscriptionRateLimit,
  peekAdminLoginRateLimit,
  recordAdminLoginFailure,
  type RateLimitDecision
} from './rate-limit';
import {
  normalizeImportedNodes,
  planNodeImport,
  planRemoteNodeSync,
  type ImportedNodeInput
} from './node-source';
import { fetchText, runEnabledRuleSourceSync, syncRuleSourceNow } from './sync';

const NODE_IMPORT_LIMIT = 200;

function isSubscriptionTarget(value: string): value is SubscriptionTarget {
  return SUBSCRIPTION_TARGETS.includes(value as SubscriptionTarget);
}

function getContentTypeByTarget(target: SubscriptionTarget): string {
  return target === 'singbox' ? 'application/json; charset=utf-8' : 'text/yaml; charset=utf-8';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNullableString(value: unknown): string | null | undefined {
  return value === null ? null : asString(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isUserStatus(value: string): value is UserStatus {
  return USER_STATUSES.includes(value as UserStatus);
}

function isNodeSourceType(value: string): value is NodeSourceType {
  return NODE_SOURCE_TYPES.includes(value as NodeSourceType);
}

function isRuleSourceFormat(value: string): value is RuleSourceFormat {
  return RULE_SOURCE_FORMATS.includes(value as RuleSourceFormat);
}

function isValidPort(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isValidDateTime(value: string | null | undefined): boolean {
  return !value || !Number.isNaN(Date.parse(value));
}

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getRawNodeImportItems(body: unknown): unknown[] {
  const rawNodes = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.nodes) ? body.nodes : null;

  if (!rawNodes) {
    throw createAppError('VALIDATION_FAILED', 'nodes must be a JSON array or an object containing a nodes array');
  }

  if (rawNodes.length === 0) {
    throw createAppError('VALIDATION_FAILED', 'at least one node is required for import');
  }

  if (rawNodes.length > NODE_IMPORT_LIMIT) {
    throw createAppError('VALIDATION_FAILED', `node import limit is ${NODE_IMPORT_LIMIT} items per request`);
  }

  return rawNodes;
}

function parseImportedNodeInputs(rawNodes: unknown[]): ImportedNodeInput[] {
  const importedNodes: ImportedNodeInput[] = [];

  for (const [index, item] of rawNodes.entries()) {
    if (!isRecord(item)) {
      throw createAppError('VALIDATION_FAILED', `node at index ${index} must be a JSON object`);
    }

    const name = asString(item.name);
    const protocol = asString(item.protocol);
    const server = asString(item.server);
    const port = asNumber(item.port);

    if (!name || !protocol || !server || !isValidPort(port)) {
      throw createAppError(
        'VALIDATION_FAILED',
        `node at index ${index} must include valid name, protocol, server, and port fields`
      );
    }

    if ('enabled' in item && asBoolean(item.enabled) === undefined) {
      throw createAppError('VALIDATION_FAILED', `node at index ${index} has invalid enabled flag`);
    }

    if ('credentials' in item && item.credentials != null && !isRecord(item.credentials)) {
      throw createAppError('VALIDATION_FAILED', `node at index ${index} has invalid credentials object`);
    }

    if ('params' in item && item.params != null && !isRecord(item.params)) {
      throw createAppError('VALIDATION_FAILED', `node at index ${index} has invalid params object`);
    }

    importedNodes.push({
      name,
      protocol,
      server,
      port,
      ...(asBoolean(item.enabled) !== undefined ? { enabled: asBoolean(item.enabled) } : {}),
      ...(isRecord(item.credentials) ? { credentials: item.credentials as Record<string, JsonValue> } : {}),
      ...(isRecord(item.params) ? { params: item.params as Record<string, JsonValue> } : {})
    });
  }

  return importedNodes;
}

function buildNodeImportPayload(input: {
  importedAt: string;
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
  disabledCount: number;
  sourceType: NodeSourceType;
  sourceId?: string | null;
}): {
  importedCount: number;
  importedAt: string;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  duplicateCount: number;
  disabledCount: number;
  sourceType: NodeSourceType;
  sourceId?: string | null;
  changed: boolean;
} {
  return {
    importedCount: input.importedCount,
    importedAt: input.importedAt,
    createdCount: input.createdCount,
    updatedCount: input.updatedCount,
    unchangedCount: input.unchangedCount,
    duplicateCount: input.duplicateCount,
    disabledCount: input.disabledCount,
    sourceType: input.sourceType,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    changed: input.createdCount + input.updatedCount + input.disabledCount > 0
  };
}

async function invalidateNodeCachesByIds(env: Env, nodeIds: string[]): Promise<void> {
  const uniqueNodeIds = [...new Set(nodeIds)];
  await Promise.all(uniqueNodeIds.map((nodeId) => invalidateNodeAffectedCaches(env, nodeId)));
}

async function fetchRemoteNodeImportBody(
  sourceUrl: string,
  timeoutMs: number
): Promise<{ body: unknown; status: number; durationMs: number; fetchedBytes: number; contentType?: string }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain;q=0.9, */*;q=0.1'
      }
    });
    const textBody = await response.text();
    const durationMs = Date.now() - startedAt;
    const fetchedBytes = new TextEncoder().encode(textBody).length;
    const contentType = response.headers.get('content-type') ?? undefined;

    if (!response.ok) {
      throw createAppError('VALIDATION_FAILED', `remote node source returned status ${response.status}`, {
        sourceUrl,
        upstreamStatus: response.status,
        durationMs,
        fetchedBytes,
        contentType
      });
    }

    try {
      return {
        body: JSON.parse(textBody) as unknown,
        status: response.status,
        durationMs,
        fetchedBytes,
        ...(contentType ? { contentType } : {})
      };
    } catch {
      throw createAppError('VALIDATION_FAILED', 'remote node source must return valid JSON', {
        sourceUrl,
        upstreamStatus: response.status,
        durationMs,
        fetchedBytes,
        contentType
      });
    }
  } catch (error) {
    if (isAppErrorShape(error)) {
      throw error;
    }

    const message = error instanceof Error && error.name === 'AbortError' ? 'remote node source request timed out' : 'remote node source request failed';

    throw createAppError('VALIDATION_FAILED', message, {
      sourceUrl,
      durationMs: Date.now() - startedAt
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAppErrorShape(error: unknown): error is AppErrorShape {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : null;
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'message' in error &&
      typeof code === 'string' &&
      Object.values(APP_ERROR_CODES).includes(code as (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES]) &&
      typeof (error as { message: unknown }).message === 'string'
  );
}

function readNullableObjectField(
  body: Record<string, unknown>,
  key: 'credentials' | 'params'
): { present: boolean; value?: Record<string, unknown> | null; error?: string } {
  if (!(key in body)) {
    return { present: false };
  }

  const value = body[key];

  if (value === null) {
    return { present: true, value: null };
  }

  if (isRecord(value)) {
    return { present: true, value };
  }

  return {
    present: true,
    error: `${key} must be a JSON object or null`
  };
}

function readNullableSourceIdField(
  body: Record<string, unknown>
): { present: boolean; value?: string | null; error?: string } {
  if (!('sourceId' in body)) {
    return { present: false };
  }

  const value = body.sourceId;

  if (value === null) {
    return { present: true, value: null };
  }

  if (typeof value !== 'string') {
    return {
      present: true,
      error: 'sourceId must be a string or null'
    };
  }

  const normalized = value.trim();
  return {
    present: true,
    value: normalized ? normalized : null
  };
}

function validateDefaultTemplateState(input: {
  isDefault: boolean | undefined;
  enabled?: boolean | undefined;
  currentStatus?: 'enabled' | 'disabled' | undefined;
}): AppErrorShape | null {
  if (!input.isDefault) {
    return null;
  }

  const willBeEnabled =
    input.enabled ?? (input.currentStatus === undefined || input.currentStatus === 'enabled');

  if (!willBeEnabled) {
    return createAppError('VALIDATION_FAILED', 'default template must be enabled');
  }

  return null;
}

interface PublicSubscriptionAccessFailure {
  error: AppErrorShape;
  status: number;
}

function isExpiredDateTime(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const expiresAtMs = Date.parse(value);

  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now();
}

async function validatePublicSubscriptionAccess(
  env: Env,
  token: string,
  cacheKey: string
): Promise<PublicSubscriptionAccessFailure | null> {
  const user = await getUserByToken(env.DB, token);

  if (!user) {
    await env.SUB_CACHE.delete(cacheKey);
    return {
      error: createAppError(APP_ERROR_CODES.subscriptionUserNotFound, 'subscription token or template not found'),
      status: 404
    };
  }

  if (user.status !== 'active') {
    await env.SUB_CACHE.delete(cacheKey);
    return {
      error: createAppError(APP_ERROR_CODES.userDisabled, undefined, {
        userId: user.id
      }),
      status: 400
    };
  }

  if (isExpiredDateTime(user.expiresAt)) {
    await env.SUB_CACHE.delete(cacheKey);
    return {
      error: createAppError(APP_ERROR_CODES.userExpired, undefined, {
        userId: user.id,
        expiresAt: user.expiresAt
      }),
      status: 400
    };
  }

  return null;
}

function getErrorStatus(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'TOO_MANY_REQUESTS') return 429;
  return 400;
}

function buildRateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    'x-subforge-rate-limit-scope': decision.scope,
    'x-subforge-rate-limit-limit': String(decision.limit),
    'x-subforge-rate-limit-remaining': String(decision.remaining),
    'x-subforge-rate-limit-reset': decision.resetAt
  };
}

function rateLimitError(message: string, decision: RateLimitDecision) {
  return createAppError('TOO_MANY_REQUESTS', message, {
    scope: decision.scope,
    limit: decision.limit,
    remaining: decision.remaining,
    retryAfterSec: decision.retryAfterSec,
    resetAt: decision.resetAt,
    current: decision.current
  });
}

function failWithHeaders(
  error: ReturnType<typeof createAppError>,
  status: number,
  headers: Record<string, string>
): Response {
  return json({ ok: false, error }, { status, headers });
}

function failRateLimited(message: string, decision: RateLimitDecision): Response {
  return failWithHeaders(rateLimitError(message, decision), 429, {
    ...buildRateLimitHeaders(decision),
    'retry-after': String(decision.retryAfterSec)
  });
}

function maskTokenForAudit(token: string): string {
  if (!token) {
    return '';
  }

  return token.length <= 6 ? '***' : `***${token.slice(-6)}`;
}

function buildUserAuditPayload(user: {
  name: string;
  status?: string;
  remark?: string | null;
  expiresAt?: string | null;
}): Record<string, JsonValue> {
  return {
    name: user.name,
    ...(user.status ? { status: user.status } : {}),
    ...(user.remark ? { remark: user.remark } : {}),
    ...(user.expiresAt ? { expiresAt: user.expiresAt } : {})
  };
}

function buildNodeAuditPayload(node: {
  name: string;
  protocol: string;
  server: string;
  port: number;
  sourceType?: string;
  sourceId?: string | null;
  enabled?: boolean;
}): Record<string, JsonValue> {
  return {
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    ...(node.sourceType ? { sourceType: node.sourceType } : {}),
    ...(node.sourceId ? { sourceId: node.sourceId } : {}),
    ...(node.enabled !== undefined ? { enabled: node.enabled } : {})
  };
}

function buildTemplateAuditPayload(template: {
  name: string;
  targetType: SubscriptionTarget;
  version?: number;
  status?: string;
  isDefault?: boolean;
}): Record<string, JsonValue> {
  return {
    name: template.name,
    targetType: template.targetType,
    ...(template.version !== undefined ? { version: template.version } : {}),
    ...(template.status ? { status: template.status } : {}),
    ...(template.isDefault !== undefined ? { isDefault: template.isDefault } : {})
  };
}

function buildRuleSourceAuditPayload(ruleSource: {
  name: string;
  sourceUrl: string;
  format: RuleSourceFormat;
  enabled?: boolean;
}): Record<string, JsonValue> {
  return {
    name: ruleSource.name,
    sourceUrl: ruleSource.sourceUrl,
    format: ruleSource.format,
    ...(ruleSource.enabled !== undefined ? { enabled: ruleSource.enabled } : {})
  };
}

function withAuditPayload(request: Request, payload?: Record<string, unknown> | null): Record<string, unknown> {
  const requestMeta = {
    ip: request.headers.get('cf-connecting-ip') ?? null,
    country: request.headers.get('cf-ipcountry') ?? null,
    colo: request.cf && typeof request.cf === 'object' && 'colo' in request.cf ? request.cf.colo : null,
    userAgent: request.headers.get('user-agent') ?? null,
    method: request.method,
    path: new URL(request.url).pathname,
    rayId: request.headers.get('cf-ray') ?? null
  };

  return sanitizeAuditPayload({
    ...(payload ?? {}),
    _request: requestMeta
  }) as Record<string, unknown>;
}

async function writeAuditLog(
  request: Request,
  env: Env,
  input: {
    actorAdminId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await createAuditLog(env.DB, {
    ...input,
    payload: withAuditPayload(request, input.payload)
  });
}


async function requireAdmin(request: Request, env: Env): Promise<{ admin: AdminRecord } | { error: AppErrorShape }> {
  const token = readBearerToken(request);

  if (!token) {
    return { error: createAppError('UNAUTHORIZED', 'missing bearer token') };
  }

  const session = await verifyAdminSessionToken(token, env.ADMIN_JWT_SECRET);

  if (!session) {
    return { error: createAppError('UNAUTHORIZED', 'invalid admin session token') };
  }

  const admin = await getAdminById(env.DB, session.sub);

  if (!admin || admin.status !== 'active') {
    return { error: createAppError('FORBIDDEN', 'admin account is unavailable') };
  }

  if (admin.sessionNotBefore) {
    const sessionNotBeforeMs = Date.parse(admin.sessionNotBefore);

    if (!Number.isNaN(sessionNotBeforeMs) && session.iat <= sessionNotBeforeMs) {
      return { error: createAppError('UNAUTHORIZED', 'admin session has been revoked') };
    }
  }

  return { admin };
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const body = await parseJsonBody(request);

  if (!isRecord(body)) {
    return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
  }

  const username = asString(body.username);
  const password = asString(body.password);

  if (!username || !password) {
    return fail(createAppError('VALIDATION_FAILED', 'username and password are required'), 400);
  }

  const loginRateLimit = await peekAdminLoginRateLimit(request, env, username);

  if (!loginRateLimit.allowed) {
    return failRateLimited('too many login attempts, please retry later', loginRateLimit);
  }

  const admin = await getAdminLoginRowByUsername(env.DB, username);

  if (!admin) {
    const failedAttempt = await recordAdminLoginFailure(request, env, username);

    if (!failedAttempt.allowed) {
      return failRateLimited('too many login attempts, please retry later', failedAttempt);
    }

    return failWithHeaders(createAppError('UNAUTHORIZED', 'invalid username or password'), 401, buildRateLimitHeaders(failedAttempt));
  }

  const verified = await verifyPassword(password, admin.passwordHash);

  if (!verified) {
    const failedAttempt = await recordAdminLoginFailure(request, env, username);

    if (!failedAttempt.allowed) {
      return failRateLimited('too many login attempts, please retry later', failedAttempt);
    }

    return failWithHeaders(createAppError('UNAUTHORIZED', 'invalid username or password'), 401, buildRateLimitHeaders(failedAttempt));
  }

  if (admin.status !== 'active') {
    return fail(createAppError('FORBIDDEN', 'admin account is unavailable'), 403);
  }
  await clearAdminLoginRateLimit(request, env, username);

  const token = await signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );

  return ok(
    {
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        status: admin.status
      }
    },
    {
      headers: {
        'x-subforge-rate-limit-scope': 'admin_login',
        'x-subforge-rate-limit-cleared': 'true'
      }
    }
  );
}

async function handleAdminMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env);

  if ('error' in auth) {
    const authError = auth.error;
    return fail(authError, authError.code === 'UNAUTHORIZED' ? 401 : 403);
  }

  return ok(auth.admin);
}

async function handleSetupStatus(env: Env): Promise<Response> {
  const adminCount = await countAdmins(env.DB);

  return ok({
    initialized: adminCount > 0,
    adminCount
  });
}

async function handleSetupBootstrap(request: Request, env: Env): Promise<Response> {
  const adminCount = await countAdmins(env.DB);

  if (adminCount > 0) {
    return fail(createAppError('FORBIDDEN', 'setup has already been completed'), 403);
  }

  const body = await parseJsonBody(request);

  if (!isRecord(body)) {
    return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
  }

  const username = asString(body.username);
  const password = asString(body.password);

  if (!username || username.length < 3) {
    return fail(createAppError('VALIDATION_FAILED', 'username must be at least 3 characters'), 400);
  }

  if (!password || password.length < 8) {
    return fail(createAppError('VALIDATION_FAILED', 'password must be at least 8 characters'), 400);
  }

  const passwordHash = await hashPassword(password);
  const admin = await createAdmin(env.DB, {
    username,
    passwordHash
  });
  const token = await signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );

  return ok(
    {
      initialized: true,
      token,
      admin
    },
    { status: 201 }
  );
}

async function handleUsers(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method === 'GET') {
    return ok(await listUsers(env.DB));
  }

  if (request.method === 'POST') {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const name = asString(body.name);

    if (!name) {
      return fail(createAppError('VALIDATION_FAILED', 'name is required'), 400);
    }

    const expiresAt = asNullableString(body.expiresAt);

    if (!isValidDateTime(expiresAt)) {
      return fail(createAppError('VALIDATION_FAILED', 'expiresAt must be a valid datetime string'), 400);
    }

    const remark = asNullableString(body.remark) ?? null;
    const user = await createUser(env.DB, {
      name,
      expiresAt: expiresAt ?? null,
      remark
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      payload: buildUserAuditPayload(user)
    });

    return ok(user, { status: 201 });
  }

  return notFound('/api/users');
}

async function handleUserById(request: Request, env: Env, adminId: string, userId: string, action?: string): Promise<Response> {
  if (request.method === 'GET' && action === 'nodes') {
    return ok(await listUserNodeBindings(env.DB, userId));
  }

  if (request.method === 'PATCH' && !action) {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const status = asString(body.status);
    const expiresAt = 'expiresAt' in body ? asNullableString(body.expiresAt) : undefined;

    if (status && !isUserStatus(status)) {
      return fail(createAppError('VALIDATION_FAILED', 'status must be active or disabled'), 400);
    }

    if (!isValidDateTime(expiresAt)) {
      return fail(createAppError('VALIDATION_FAILED', 'expiresAt must be a valid datetime string'), 400);
    }

    const nextName = asString(body.name);
    const nextRemark = 'remark' in body ? asNullableString(body.remark) ?? null : undefined;

    const user = await updateUser(env.DB, userId, {
      ...(nextName ? { name: nextName } : {}),
      ...(status ? { status } : {}),
      ...('expiresAt' in body ? { expiresAt: expiresAt ?? null } : {}),
      ...(nextRemark !== undefined ? { remark: nextRemark } : {})
    });

    if (!user) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    await invalidateUserCaches(env, { token: user.token, id: user.id });
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.update',
      targetType: 'user',
      targetId: user.id,
      payload: buildUserAuditPayload(user)
    });
    return ok(user);
  }

  if (request.method === 'POST' && action === 'reset-token') {
    const previous = await getUserById(env.DB, userId);

    if (!previous) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    const user = await resetUserToken(env.DB, userId);

    if (!user) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    await invalidateUserCaches(env, { token: previous.token, id: previous.id });
    await invalidateUserCaches(env, { token: user.token, id: user.id });
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.reset_token',
      targetType: 'user',
      targetId: user.id,
      payload: {
        tokenReset: true,
        name: user.name,
        previousTokenSuffix: maskTokenForAudit(previous.token),
        currentTokenSuffix: maskTokenForAudit(user.token)
      }
    });
    return ok(user);
  }

  if (request.method === 'POST' && action === 'nodes') {
    const body = await parseJsonBody(request);

    if (!isRecord(body) || !Array.isArray(body.nodeIds)) {
      return fail(createAppError('VALIDATION_FAILED', 'nodeIds must be an array'), 400);
    }

    const user = await getUserById(env.DB, userId);

    if (!user) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    const nodeIds = [...new Set(body.nodeIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];
    const missingNodeIds = (
      await Promise.all(
        nodeIds.map(async (nodeId) => ({
          nodeId,
          exists: Boolean(await getNodeById(env.DB, nodeId))
        }))
      )
    )
      .filter((entry) => !entry.exists)
      .map((entry) => entry.nodeId);

    if (missingNodeIds.length > 0) {
      return fail(
        createAppError('VALIDATION_FAILED', `nodeIds must reference existing nodes: ${missingNodeIds.join(', ')}`),
        400
      );
    }

    await replaceUserNodes(env.DB, userId, nodeIds);
    await invalidateUserCaches(env, { token: user.token, id: user.id });
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.bind_nodes',
      targetType: 'user',
      targetId: userId,
      payload: {
        ...(user ? { name: user.name } : {}),
        nodeIds,
        nodeCount: nodeIds.length
      }
    });

    return ok({ userId, nodeIds });
  }

  if (request.method === 'DELETE' && !action) {
    const current = await getUserById(env.DB, userId);

    if (!current) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    const deleted = await deleteUser(env.DB, userId);

    if (!deleted) {
      return fail(createAppError('NOT_FOUND', 'user not found'), 404);
    }

    await invalidateUserCaches(env, { token: current.token, id: current.id });
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      payload: { name: current.name }
    });

    return ok({ deleted: true, userId });
  }

  return notFound(`/api/users/${userId}`);
}

async function handleNodeImportPreview(request: Request, env: Env, adminId: string): Promise<Response> {
  const body = await parseJsonBody(request);

  if (!isRecord(body)) {
    return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
  }

  const sourceUrl = asString(body.sourceUrl);

  if (!sourceUrl || !isValidHttpUrl(sourceUrl)) {
    return fail(createAppError('VALIDATION_FAILED', 'sourceUrl must be a valid http/https URL'), 400);
  }

  const upstream = await fetchText(sourceUrl, Number(env.SYNC_HTTP_TIMEOUT_MS || '10000'));

  if (!upstream.text) {
    return fail(createAppError('VALIDATION_FAILED', 'upstream content is empty'), 400);
  }

  const parsed = parseNodeImportText(upstream.text);
  const payload = {
    sourceUrl,
    upstreamStatus: upstream.status,
    durationMs: upstream.durationMs,
    fetchedBytes: upstream.fetchedBytes,
    lineCount: parsed.lineCount,
    contentEncoding: parsed.contentEncoding,
    nodes: parsed.nodes,
    errors: parsed.errors
  };

  await writeAuditLog(request, env, {
    actorAdminId: adminId,
    action: 'node_import.preview',
    targetType: 'node_import',
    payload: {
      sourceUrl,
      upstreamStatus: upstream.status,
      durationMs: upstream.durationMs,
      fetchedBytes: upstream.fetchedBytes,
      lineCount: payload.lineCount,
      contentEncoding: payload.contentEncoding,
      nodeCount: payload.nodes.length,
      errorCount: payload.errors.length
    }
  });

  return ok(payload);
}

async function handleNodes(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method === 'GET') {
    return ok(await listNodes(env.DB));
  }

  if (request.method === 'POST') {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const name = asString(body.name);
    const protocolInput = asString(body.protocol);
    const protocol = protocolInput ? canonicalizeNodeProtocol(protocolInput) : undefined;
    const server = asString(body.server);
    const port = asNumber(body.port);
    if (!name || !protocol || !server || port === undefined) {
      return fail(createAppError('VALIDATION_FAILED', 'name, protocol, server and port are required'), 400);
    }

    if (!isValidPort(port)) {
      return fail(createAppError('VALIDATION_FAILED', 'port must be an integer between 1 and 65535'), 400);
    }

    const sourceType = 'sourceType' in body ? asString(body.sourceType) : undefined;

    if ('sourceType' in body && (!sourceType || !isNodeSourceType(sourceType))) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceType must be manual or remote'), 400);
    }

    if (sourceType === 'remote') {
      return fail(createAppError('VALIDATION_FAILED', 'remote sourceType is not supported yet'), 400);
    }

    const sourceIdInput = readNullableSourceIdField(body);

    if (sourceIdInput.error) {
      return fail(createAppError('VALIDATION_FAILED', sourceIdInput.error), 400);
    }

    if (sourceIdInput.value) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceId is not supported for manual nodes'), 400);
    }

    const enabled = asBoolean(body.enabled);
    const credentialsInput = readNullableObjectField(body, 'credentials');
    const paramsInput = readNullableObjectField(body, 'params');

    if (credentialsInput.error) {
      return fail(createAppError('VALIDATION_FAILED', credentialsInput.error), 400);
    }

    if (paramsInput.error) {
      return fail(createAppError('VALIDATION_FAILED', paramsInput.error), 400);
    }

    const metadataValidationError = validateNodeProtocolMetadata({
      protocol: protocol ?? '',
      credentials: credentialsInput.value ?? null,
      params: paramsInput.value ?? null
    });

    if (metadataValidationError) {
      return fail(createAppError('VALIDATION_FAILED', metadataValidationError), 400);
    }

    const node = await createNode(env.DB, {
      name,
      protocol,
      server,
      port,
      ...(sourceType ? { sourceType } : {}),
      ...(sourceIdInput.present ? { sourceId: sourceIdInput.value ?? null } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(credentialsInput.present ? { credentials: credentialsInput.value ?? null } : {}),
      ...(paramsInput.present ? { params: paramsInput.value ?? null } : {})
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'node.create',
      targetType: 'node',
      targetId: node.id,
      payload: buildNodeAuditPayload(node)
    });
    return ok(node, { status: 201 });
  }

  return notFound('/api/nodes');
}

async function handleNodeImport(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return notFound('/api/nodes/import');
  }

  const importedAt = new Date().toISOString();
  const body = await parseJsonBody(request);
  const rawNodes = getRawNodeImportItems(body);
  const importedNodes = parseImportedNodeInputs(rawNodes);
  const { nodes: dedupedNodes, duplicateCount } = normalizeImportedNodes(importedNodes, 'manual');
  const existingManualNodes = await listNodesBySource(env.DB, 'manual');
  const plan = planNodeImport(existingManualNodes, dedupedNodes);

  for (const node of plan.created) {
    await createNode(env.DB, node);
  }

  for (const update of plan.updated) {
    await updateNode(env.DB, update.current.id, update.next);
  }

  await invalidateNodeCachesByIds(
    env,
    plan.updated.map((update) => update.current.id)
  );

  const payload = buildNodeImportPayload({
    importedAt,
    importedCount: dedupedNodes.length,
    createdCount: plan.created.length,
    updatedCount: plan.updated.length,
    unchangedCount: plan.unchanged.length,
    duplicateCount,
    disabledCount: 0,
    sourceType: 'manual'
  });

  await writeAuditLog(request, env, {
    actorAdminId: adminId,
    action: 'node.import',
    targetType: 'node',
    payload: {
      importedCount: payload.importedCount,
      createdCount: payload.createdCount,
      updatedCount: payload.updatedCount,
      unchangedCount: payload.unchangedCount,
      duplicateCount: payload.duplicateCount,
      names: dedupedNodes.slice(0, 10).map((node) => node.name)
    }
  });

  return ok(payload, { status: payload.changed ? 201 : 200 });
}

async function handleRemoteNodeImport(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return notFound('/api/nodes/import/remote');
  }

  const body = await parseJsonBody(request);

  if (!isRecord(body)) {
    return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
  }

  const sourceUrl = asString(body.sourceUrl);

  if (!isValidHttpUrl(sourceUrl)) {
    return fail(createAppError('VALIDATION_FAILED', 'sourceUrl must be a valid http or https URL'), 400);
  }

  const canonicalSourceUrl = new URL(sourceUrl).toString();
  const startedAt = Date.now();

  try {
    const upstream = await fetchRemoteNodeImportBody(
      canonicalSourceUrl,
      Number(env.SYNC_HTTP_TIMEOUT_MS || '10000')
    );
    const rawNodes = getRawNodeImportItems(upstream.body);
    const importedNodes = parseImportedNodeInputs(rawNodes);
    const importedAt = new Date().toISOString();
    const { nodes: dedupedNodes, duplicateCount } = normalizeImportedNodes(importedNodes, 'remote', canonicalSourceUrl);
    const existingRemoteNodes = await listNodesBySource(env.DB, 'remote', canonicalSourceUrl);
    const plan = planRemoteNodeSync(existingRemoteNodes, dedupedNodes);
    const staleToDisable = plan.stale.filter((node) => node.enabled);

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

    await invalidateNodeCachesByIds(
      env,
      [...plan.updated.map((update) => update.current.id), ...staleToDisable.map((node) => node.id)]
    );

    const payload = buildNodeImportPayload({
      importedAt,
      importedCount: dedupedNodes.length,
      createdCount: plan.created.length,
      updatedCount: plan.updated.length,
      unchangedCount: plan.unchanged.length,
      duplicateCount,
      disabledCount: staleToDisable.length,
      sourceType: 'remote',
      sourceId: canonicalSourceUrl
    });

    const details = {
      sourceUrl: canonicalSourceUrl,
      upstreamStatus: upstream.status,
      fetchedBytes: upstream.fetchedBytes,
      durationMs: Date.now() - startedAt,
      ...(upstream.contentType ? { contentType: upstream.contentType } : {}),
      importedCount: payload.importedCount,
      createdCount: payload.createdCount,
      updatedCount: payload.updatedCount,
      unchangedCount: payload.unchangedCount,
      duplicateCount: payload.duplicateCount,
      disabledCount: payload.disabledCount
    };
    const status = payload.changed ? 'success' : 'skipped';
    const message = payload.changed
      ? `remote node source synced (${payload.importedCount} nodes)`
      : `remote node source unchanged (${payload.importedCount} nodes)`;

    await recordNodeSourceSync(env.DB, canonicalSourceUrl, status, message, details);
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'node.import_remote',
      targetType: 'node',
      payload: {
        sourceUrl: canonicalSourceUrl,
        importedCount: payload.importedCount,
        createdCount: payload.createdCount,
        updatedCount: payload.updatedCount,
        unchangedCount: payload.unchangedCount,
        duplicateCount: payload.duplicateCount,
        disabledCount: payload.disabledCount
      }
    });

    return ok(payload, { status: payload.changed ? 201 : 200 });
  } catch (error) {
    const appError = isAppErrorShape(error)
      ? error
      : createAppError('VALIDATION_FAILED', error instanceof Error ? error.message : 'remote node source sync failed');

    const details = isRecord(appError.details)
      ? { sourceUrl: canonicalSourceUrl, durationMs: Date.now() - startedAt, ...appError.details }
      : { sourceUrl: canonicalSourceUrl, durationMs: Date.now() - startedAt };

    await recordNodeSourceSync(env.DB, canonicalSourceUrl, 'failed', appError.message, details);

    return fail({ ...appError, details }, getErrorStatus(appError.code));
  }
}

async function handleNodeById(request: Request, env: Env, adminId: string, nodeId: string): Promise<Response> {
  if (request.method === 'PATCH') {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const port = asNumber(body.port);

    if (port !== undefined && !isValidPort(port)) {
      return fail(createAppError('VALIDATION_FAILED', 'port must be an integer between 1 and 65535'), 400);
    }

    const currentNode = await getNodeById(env.DB, nodeId);

    if (!currentNode) {
      return fail(createAppError('NOT_FOUND', 'node not found'), 404);
    }

    const nextName = asString(body.name);
    const nextProtocolInput = asString(body.protocol);
    const nextProtocol = nextProtocolInput ? canonicalizeNodeProtocol(nextProtocolInput) : undefined;
    const nextServer = asString(body.server);
    const nextSourceType = 'sourceType' in body ? asString(body.sourceType) : undefined;
    const nextEnabled = asBoolean(body.enabled);

    if ('sourceType' in body && (!nextSourceType || !isNodeSourceType(nextSourceType))) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceType must be manual or remote'), 400);
    }

    if (nextSourceType === 'remote') {
      return fail(createAppError('VALIDATION_FAILED', 'remote sourceType is not supported yet'), 400);
    }

    const nextSourceId = readNullableSourceIdField(body);

    if (nextSourceId.error) {
      return fail(createAppError('VALIDATION_FAILED', nextSourceId.error), 400);
    }

    if (nextSourceId.value) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceId is not supported for manual nodes'), 400);
    }

    const nextCredentials = readNullableObjectField(body, 'credentials');
    const nextParams = readNullableObjectField(body, 'params');

    if (nextCredentials.error) {
      return fail(createAppError('VALIDATION_FAILED', nextCredentials.error), 400);
    }

    if (nextParams.error) {
      return fail(createAppError('VALIDATION_FAILED', nextParams.error), 400);
    }

    const metadataValidationError = validateNodeProtocolMetadata({
      protocol: nextProtocol ?? currentNode.protocol,
      credentials: nextCredentials.present ? (nextCredentials.value ?? null) : (currentNode.credentials ?? null),
      params: nextParams.present ? (nextParams.value ?? null) : (currentNode.params ?? null)
    });

    if (metadataValidationError) {
      return fail(createAppError('VALIDATION_FAILED', metadataValidationError), 400);
    }

    const shouldClearSourceIdOnManualSwitch =
      nextSourceType === 'manual' && currentNode.sourceType !== 'manual' && !nextSourceId.present;
    const node = await updateNode(env.DB, nodeId, {
      ...(nextName ? { name: nextName } : {}),
      ...(nextProtocol ? { protocol: nextProtocol } : {}),
      ...(nextServer ? { server: nextServer } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(nextSourceType ? { sourceType: nextSourceType } : {}),
      ...(nextSourceId.present
        ? { sourceId: nextSourceId.value ?? null }
        : shouldClearSourceIdOnManualSwitch
          ? { sourceId: null }
          : {}),
      ...(nextEnabled !== undefined ? { enabled: nextEnabled } : {}),
      ...(nextCredentials.present ? { credentials: nextCredentials.value ?? null } : {}),
      ...(nextParams.present ? { params: nextParams.value ?? null } : {})
    });

    if (!node) {
      return fail(createAppError('NOT_FOUND', 'node not found'), 404);
    }

    await invalidateNodeAffectedCaches(env, node.id);
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'node.update',
      targetType: 'node',
      targetId: node.id,
      payload: buildNodeAuditPayload(node)
    });
    return ok(node);
  }

  if (request.method === 'DELETE') {
    const currentNode = await getNodeById(env.DB, nodeId);
    const affectedUsers = await listUsersByNodeId(env.DB, nodeId);
    const deleted = await deleteNode(env.DB, nodeId);

    if (!deleted) {
      return fail(createAppError('NOT_FOUND', 'node not found'), 404);
    }

    await invalidateUsersCaches(env, affectedUsers);
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'node.delete',
      targetType: 'node',
      targetId: nodeId,
      payload: currentNode
        ? {
            ...buildNodeAuditPayload(currentNode),
            affectedUserCount: affectedUsers.length
          }
        : { affectedUserCount: affectedUsers.length }
    });
    return ok({ deleted: true, nodeId });
  }

  return notFound(`/api/nodes/${nodeId}`);
}

async function handleTemplates(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method === 'GET') {
    return ok(await listTemplates(env.DB));
  }

  if (request.method === 'POST') {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const name = asString(body.name);
    const targetType = asString(body.targetType) as SubscriptionTarget | undefined;
    const content = asString(body.content);

    if (!name || !targetType || !content) {
      return fail(createAppError('VALIDATION_FAILED', 'name, targetType and content are required'), 400);
    }

    if (!isSubscriptionTarget(targetType)) {
      return fail(createAppError('VALIDATION_FAILED', 'targetType must be mihomo or singbox'), 400);
    }

    const version = asNumber(body.version);

    if (version !== undefined && (!Number.isInteger(version) || version <= 0)) {
      return fail(createAppError('VALIDATION_FAILED', 'version must be a positive integer'), 400);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, targetType);
    const isDefault = asBoolean(body.isDefault);
    const enabled = asBoolean(body.enabled);
    const defaultTemplateValidation = validateDefaultTemplateState({ isDefault, enabled });

    if (defaultTemplateValidation) {
      return fail(defaultTemplateValidation, 400);
    }

    const template = await createTemplate(env.DB, {
      name,
      targetType,
      content,
      ...(version !== undefined ? { version } : {}),
      ...(isDefault !== undefined ? { isDefault } : {}),
      ...(enabled !== undefined ? { enabled } : {})
    });
    const nextEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, template.targetType);

    if (previousEffectiveTemplate?.id !== nextEffectiveTemplate?.id) {
      await invalidateAllUserCaches(env, [template.targetType]);
    }
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'template.create',
      targetType: 'template',
      targetId: template.id,
      payload: buildTemplateAuditPayload(template)
    });
    return ok(template, { status: 201 });
  }

  return notFound('/api/templates');
}

async function handleTemplateById(
  request: Request,
  env: Env,
  adminId: string,
  templateId: string,
  action?: string
): Promise<Response> {
  if (request.method === 'PATCH' && !action) {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const version = asNumber(body.version);

    if (version !== undefined && (!Number.isInteger(version) || version <= 0)) {
      return fail(createAppError('VALIDATION_FAILED', 'version must be a positive integer'), 400);
    }

    const currentTemplate = await getTemplateById(env.DB, templateId);

    if (!currentTemplate) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const nextEnabled = asBoolean(body.enabled);
    const nextIsDefault = asBoolean(body.isDefault);
    const defaultTemplateValidation = validateDefaultTemplateState({
      isDefault: nextIsDefault,
      enabled: nextEnabled,
      currentStatus: currentTemplate.status
    });

    if (defaultTemplateValidation) {
      return fail(defaultTemplateValidation, 400);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, currentTemplate.targetType);
    const template = await updateTemplate(env.DB, templateId, {
      ...(asString(body.name) ? { name: asString(body.name) } : {}),
      ...(asString(body.content) ? { content: asString(body.content) } : {}),
      ...(version !== undefined ? { version } : {}),
      ...(nextEnabled !== undefined ? { enabled: nextEnabled } : {}),
      ...(nextIsDefault !== undefined ? { isDefault: nextIsDefault } : {})
    });

    if (!template) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const nextEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, template.targetType);
    const shouldInvalidateCaches =
      previousEffectiveTemplate?.id !== nextEffectiveTemplate?.id ||
      previousEffectiveTemplate?.id === template.id ||
      nextEffectiveTemplate?.id === template.id;

    if (shouldInvalidateCaches) {
      await invalidateAllUserCaches(env, [template.targetType]);
    }
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'template.update',
      targetType: 'template',
      targetId: template.id,
      payload: buildTemplateAuditPayload(template)
    });
    return ok(template);
  }

  if (request.method === 'POST' && action === 'set-default') {
    const currentTemplate = await getTemplateById(env.DB, templateId);

    if (!currentTemplate) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const defaultTemplateValidation = validateDefaultTemplateState({
      isDefault: true,
      currentStatus: currentTemplate.status
    });

    if (defaultTemplateValidation) {
      return fail(defaultTemplateValidation, 400);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, currentTemplate.targetType);
    const template = await setDefaultTemplate(env.DB, templateId);

    if (!template) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const nextEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, template.targetType);

    if (previousEffectiveTemplate?.id !== nextEffectiveTemplate?.id) {
      await invalidateAllUserCaches(env, [template.targetType]);
    }
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'template.set_default',
      targetType: 'template',
      targetId: template.id,
      payload: {
        ...buildTemplateAuditPayload(template),
        previousTemplateId: previousEffectiveTemplate?.id ?? null
      }
    });
    return ok(template);
  }

  if (request.method === 'DELETE' && !action) {
    const currentTemplate = await getTemplateById(env.DB, templateId);

    if (!currentTemplate) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, currentTemplate.targetType);
    const deleted = await deleteTemplate(env.DB, templateId);

    if (!deleted) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const nextEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, currentTemplate.targetType);

    if (previousEffectiveTemplate?.id !== nextEffectiveTemplate?.id) {
      await invalidateAllUserCaches(env, [currentTemplate.targetType]);
    }
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'template.delete',
      targetType: 'template',
      targetId: templateId,
      payload: { targetType: currentTemplate.targetType }
    });
    return ok({ deleted: true, templateId });
  }

  return notFound(`/api/templates/${templateId}`);
}

async function handleRuleSources(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method === 'GET') {
    return ok(await listRuleSources(env.DB));
  }

  if (request.method === 'POST') {
    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const name = asString(body.name);
    const sourceUrl = asString(body.sourceUrl);
    const format = asString(body.format) as RuleSourceFormat | undefined;

    if (!name || !sourceUrl || !format) {
      return fail(createAppError('VALIDATION_FAILED', 'name, sourceUrl and format are required'), 400);
    }

    if (!isRuleSourceFormat(format)) {
      return fail(createAppError('VALIDATION_FAILED', 'format must be text, yaml or json'), 400);
    }

    if (!isValidHttpUrl(sourceUrl)) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceUrl must be a valid http/https URL'), 400);
    }

    const enabled = asBoolean(body.enabled);

    const ruleSource = await createRuleSource(env.DB, {
      name,
      sourceUrl,
      format,
      ...(enabled !== undefined ? { enabled } : {})
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.create',
      targetType: 'rule_source',
      targetId: ruleSource.id,
      payload: buildRuleSourceAuditPayload(ruleSource)
    });

    return ok(ruleSource, { status: 201 });
  }

  return notFound('/api/rule-sources');
}

async function handleRuleSourceById(
  request: Request,
  env: Env,
  adminId: string,
  ruleSourceId: string,
  action?: string
): Promise<Response> {
  if (request.method === 'PATCH' && !action) {
    const current = await getRuleSourceById(env.DB, ruleSourceId);

    if (!current) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    const body = await parseJsonBody(request);

    if (!isRecord(body)) {
      return fail(createAppError('VALIDATION_FAILED', 'request body must be a JSON object'), 400);
    }

    const sourceUrl = asString(body.sourceUrl);
    const format = asString(body.format);

    if (format && !isRuleSourceFormat(format)) {
      return fail(createAppError('VALIDATION_FAILED', 'format must be text, yaml or json'), 400);
    }

    if (sourceUrl && !isValidHttpUrl(sourceUrl)) {
      return fail(createAppError('VALIDATION_FAILED', 'sourceUrl must be a valid http/https URL'), 400);
    }

    const nextName = asString(body.name);
    const nextEnabled = asBoolean(body.enabled);

    const ruleSource = await updateRuleSource(env.DB, ruleSourceId, {
      ...(nextName ? { name: nextName } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(format ? { format: format as RuleSourceFormat } : {}),
      ...(nextEnabled !== undefined ? { enabled: nextEnabled } : {})
    });

    if (!ruleSource) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    if (current.enabled !== ruleSource.enabled) {
      await invalidateAllUserCaches(env);
    }

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.update',
      targetType: 'rule_source',
      targetId: ruleSource.id,
      payload: buildRuleSourceAuditPayload(ruleSource)
    });

    return ok(ruleSource);
  }

  if (request.method === 'POST' && action === 'sync') {
    const current = await getRuleSourceById(env.DB, ruleSourceId);

    if (!current) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    const result = await syncRuleSourceNow(env, current);
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.sync',
      targetType: 'rule_source',
      targetId: current.id,
      payload: {
        ...buildRuleSourceAuditPayload(current),
        status: result.status,
        changed: result.changed,
        ruleCount: result.ruleCount,
        details: result.details ?? null
      }
    });
    return ok(result);
  }

  if (request.method === 'DELETE' && !action) {
    const current = await getRuleSourceById(env.DB, ruleSourceId);

    if (!current) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    const deleted = await deleteRuleSource(env.DB, ruleSourceId);

    if (!deleted) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    await invalidateAllUserCaches(env);
    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.delete',
      targetType: 'rule_source',
      targetId: ruleSourceId,
      payload: { name: current.name, format: current.format }
    });
    return ok({ deleted: true, ruleSourceId });
  }

  return notFound(`/api/rule-sources/${ruleSourceId}`);
}

async function handlePreview(env: Env, userId: string, targetRaw: string): Promise<Response> {
  if (!isSubscriptionTarget(targetRaw)) {
    return fail(createAppError('UNSUPPORTED_TARGET', 'unsupported subscription target'), 400);
  }

  const cacheKey = buildPreviewCacheKey(targetRaw, userId);
  const cached = await env.SUB_CACHE.get(cacheKey);

  if (cached) {
    return json(
      {
        ok: true,
        data: JSON.parse(cached)
      },
      {
        headers: {
          'x-subforge-preview-cache': 'hit',
          'x-subforge-cache-key': cacheKey,
          'x-subforge-cache-scope': 'preview'
        }
      }
    );
  }

  const compileInput = await getSubscriptionCompileInputByUserId(env.DB, userId, targetRaw);

  if (!compileInput) {
    return fail(createAppError('NOT_FOUND', 'preview data not found'), 404);
  }

  const result = compileSubscription(compileInput);

  if (!result.ok) {
    return fail(result.error, 400);
  }

  const payload = {
    cacheKey,
    mimeType: result.data.mimeType,
    content: result.data.content,
    metadata: result.data.metadata
  };

  await env.SUB_CACHE.put(cacheKey, JSON.stringify(payload), {
    expirationTtl: Number(env.PREVIEW_CACHE_TTL || '120')
  });

  return json(
    {
      ok: true,
      data: payload
    },
    {
      headers: {
        'x-subforge-preview-cache': 'miss',
        'x-subforge-cache-key': cacheKey,
        'x-subforge-cache-scope': 'preview'
      }
    }
  );
}

async function handlePublicSubscription(
  request: Request,
  env: Env,
  token: string,
  targetRaw: string
): Promise<Response> {
  if (!isSubscriptionTarget(targetRaw)) {
    return fail(createAppError('UNSUPPORTED_TARGET', 'unsupported subscription target'), 400);
  }

  const rateLimit = await consumeSubscriptionRateLimit(request, env, token, targetRaw);

  if (!rateLimit.allowed) {
    return failRateLimited('subscription request rate limit exceeded', rateLimit);
  }

  const cacheKey = buildSubscriptionCacheKey(targetRaw, token);
  const accessFailure = await validatePublicSubscriptionAccess(env, token, cacheKey);

  if (accessFailure) {
    return fail(accessFailure.error, accessFailure.status);
  }

  const cached = await env.SUB_CACHE.get(cacheKey);

  if (cached) {
    return text(cached, getContentTypeByTarget(targetRaw), {
      headers: {
        ...buildRateLimitHeaders(rateLimit),
        'x-subforge-cache': 'hit',
        'x-subforge-cache-key': cacheKey,
        'x-subforge-cache-scope': 'subscription'
      }
    });
  }

  const compileInput = await getSubscriptionCompileInputByToken(env.DB, token, targetRaw);

  if (!compileInput) {
    return failWithHeaders(
      createAppError('SUBSCRIPTION_USER_NOT_FOUND', 'subscription token or template not found'),
      404,
      buildRateLimitHeaders(rateLimit)
    );
  }

  const result = compileSubscription(compileInput);

  if (!result.ok) {
    return failWithHeaders(result.error, 400, buildRateLimitHeaders(rateLimit));
  }

  await env.SUB_CACHE.put(cacheKey, result.data.content, {
    expirationTtl: Number(env.SUBSCRIPTION_CACHE_TTL || '1800')
  });

  return text(result.data.content, result.data.mimeType, {
    headers: {
      ...buildRateLimitHeaders(rateLimit),
      'x-subforge-cache': 'miss',
      'x-subforge-cache-key': cacheKey,
      'x-subforge-cache-scope': 'subscription'
    }
  });
}

async function handleSyncLogs(env: Env): Promise<Response> {
  return ok(await listSyncLogs(env.DB));
}

async function handleAuditLogs(env: Env): Promise<Response> {
  return ok(await listAuditLogs(env.DB));
}

async function handleCacheRebuild(request: Request, env: Env, adminId: string): Promise<Response> {
  if (request.method !== 'POST') {
    return notFound('/api/cache/rebuild');
  }

  const result = await rebuildSubscriptionCaches(env);

  await writeAuditLog(request, env, {
    actorAdminId: adminId,
    action: 'cache.rebuild',
    targetType: 'cache',
    payload: {
      userCount: result.userCount,
      targets: result.targets,
      keysRequested: result.keysRequested
    }
  });

  return ok(result);
}

async function handleApiRequest(request: Request, env: Env, segments: string[]): Promise<Response> {
  const [resource, resourceId, action] = segments;

  if (resource === 'admin' && resourceId === 'login' && request.method === 'POST') {
    return handleAdminLogin(request, env);
  }

  if (resource === 'setup' && resourceId === 'status' && request.method === 'GET') {
    return handleSetupStatus(env);
  }

  if (resource === 'setup' && resourceId === 'bootstrap' && request.method === 'POST') {
    return handleSetupBootstrap(request, env);
  }

  const auth = await requireAdmin(request, env);

  if ('error' in auth) {
    const authError = auth.error;
    return fail(authError, authError.code === 'UNAUTHORIZED' ? 401 : 403);
  }

  if (resource === 'admin' && resourceId === 'me' && request.method === 'GET') {
    return handleAdminMe(request, env);
  }

  if (resource === 'admin' && resourceId === 'logout' && request.method === 'POST') {
    const revokedAdmin = await revokeAdminSessions(env.DB, auth.admin.id);

    return ok({
      loggedOut: true,
      serverRevocation: true,
      mode: 'server_revoked',
      ...(revokedAdmin?.sessionNotBefore ? { revokedAt: revokedAdmin.sessionNotBefore } : {})
    });
  }

  if (resource === 'users' && !resourceId) {
    return handleUsers(request, env, auth.admin.id);
  }

  if (resource === 'users' && resourceId) {
    return handleUserById(request, env, auth.admin.id, resourceId, action);
  }

  if (resource === 'node-import' && resourceId === 'preview' && request.method === 'POST') {
    return handleNodeImportPreview(request, env, auth.admin.id);
  }

  if (resource === 'nodes' && !resourceId) {
    return handleNodes(request, env, auth.admin.id);
  }

  if (resource === 'nodes' && resourceId === 'import' && !action) {
    return handleNodeImport(request, env, auth.admin.id);
  }

  if (resource === 'nodes' && resourceId === 'import' && action === 'remote') {
    return handleRemoteNodeImport(request, env, auth.admin.id);
  }

  if (resource === 'nodes' && resourceId) {
    return handleNodeById(request, env, auth.admin.id, resourceId);
  }

  if (resource === 'templates' && !resourceId) {
    return handleTemplates(request, env, auth.admin.id);
  }

  if (resource === 'templates' && resourceId) {
    return handleTemplateById(request, env, auth.admin.id, resourceId, action);
  }

  if (resource === 'rule-sources' && !resourceId) {
    return handleRuleSources(request, env, auth.admin.id);
  }

  if (resource === 'rule-sources' && resourceId) {
    return handleRuleSourceById(request, env, auth.admin.id, resourceId, action);
  }

  if (resource === 'cache' && resourceId === 'rebuild' && !action) {
    return handleCacheRebuild(request, env, auth.admin.id);
  }

  if (resource === 'sync-logs' && !resourceId && request.method === 'GET') {
    return handleSyncLogs(env);
  }

  if (resource === 'audit-logs' && !resourceId && request.method === 'GET') {
    return handleAuditLogs(env);
  }

  if (resource === 'preview' && resourceId && action) {
    return handlePreview(env, resourceId, action);
  }

  return notFound(`${API_PREFIX}/${segments.join('/')}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      if (request.method === 'OPTIONS') {
        return preflight();
      }

      const url = new URL(request.url);
      const segments = url.pathname.split('/').filter(Boolean);

      if (request.method === 'GET' && url.pathname === HEALTH_ENDPOINT) {
        return json({
          ok: true,
          service: APP_NAME,
          env: env.APP_ENV,
          cacheKeyExample: buildSubscriptionCacheKey('mihomo', 'demo-token'),
          time: new Date().toISOString()
        });
      }

      if (segments[0] === 'api') {
        return await handleApiRequest(request, env, segments.slice(1));
      }

      if (request.method === 'GET' && segments[0] === 's' && segments[1] && segments[2]) {
        return await handlePublicSubscription(request, env, segments[1], segments[2]);
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        return await env.ASSETS.fetch(request);
      }

      return notFound(url.pathname);
    } catch (error) {
      if (isAppErrorShape(error)) {
        return fail(error, getErrorStatus(error.code));
      }

      const message = error instanceof Error ? error.message : 'internal server error';
      return fail(createAppError('VALIDATION_FAILED', message), 400);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runEnabledRuleSourceSync(env).then((results) => {
        console.log(
          `[${APP_NAME}] cron trigger fired at ${controller.scheduledTime} in ${env.APP_ENV} with ${results.length} rule source(s)`
        );
      })
    );
  }
};
