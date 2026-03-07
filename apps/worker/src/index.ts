import { compileSubscription } from '@subforge/core';
import {
  API_PREFIX,
  APP_NAME,
  buildPreviewCacheKey,
  buildSubscriptionCacheKey,
  createAppError,
  HEALTH_ENDPOINT,
  RULE_SOURCE_FORMATS,
  SUBSCRIPTION_TARGETS,
  USER_STATUSES,
  type RuleSourceFormat,
  type SubscriptionTarget,
  type UserStatus
} from '@subforge/shared';
import type { Env } from './env';
import { fail, json, notFound, ok, parseJsonBody, preflight, readBearerToken, text, isRecord } from './http';
import {
  createAdmin,
  createNode,
  createRuleSource,
  createTemplate,
  createUser,
  deleteNode,
  countAdmins,
  getAdminById,
  getAdminLoginRowByUsername,
  getDefaultTemplateByTarget,
  getRuleSourceById,
  getTemplateById,
  getSubscriptionCompileInputByToken,
  getSubscriptionCompileInputByUserId,
  getUserById,
  listAuditLogs,
  listNodes,
  listRuleSources,
  listSyncLogs,
  listTemplates,
  listUserNodeBindings,
  listUsers,
  listUsersByNodeId,
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
import { invalidateAllUserCaches, invalidateNodeAffectedCaches, invalidateUserCaches, invalidateUsersCaches } from './cache';
import { runEnabledRuleSourceSync, syncRuleSourceNow } from './sync';

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

function isRuleSourceFormat(value: string): value is RuleSourceFormat {
  return RULE_SOURCE_FORMATS.includes(value as RuleSourceFormat);
}

function isValidPort(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isValidDateTime(value: string | null | undefined): boolean {
  return !value || !Number.isNaN(Date.parse(value));
}

function isValidHttpUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAppErrorShape(error: unknown): error is { code: string; message: string; details?: Record<string, unknown> } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      'message' in error &&
      typeof (error as { code: unknown }).code === 'string' &&
      typeof (error as { message: unknown }).message === 'string'
  );
}

function getErrorStatus(code: string): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN') return 403;
  return 400;
}

function withAuditPayload(request: Request, payload?: Record<string, unknown> | null): Record<string, unknown> {
  const requestMeta = {
    ip: request.headers.get('cf-connecting-ip') ?? null,
    country: request.headers.get('cf-ipcountry') ?? null,
    colo: request.cf && typeof request.cf === 'object' && 'colo' in request.cf ? request.cf.colo : null,
    userAgent: request.headers.get('user-agent') ?? null
  };

  return {
    ...(payload ?? {}),
    _request: requestMeta
  };
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


async function requireAdmin(request: Request, env: Env) {
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

  const admin = await getAdminLoginRowByUsername(env.DB, username);

  if (!admin) {
    return fail(createAppError('UNAUTHORIZED', 'invalid username or password'), 401);
  }

  const verified = await verifyPassword(password, admin.passwordHash);

  if (!verified) {
    return fail(createAppError('UNAUTHORIZED', 'invalid username or password'), 401);
  }

  const token = await signAdminSessionToken(
    {
      sub: admin.id,
      username: admin.username,
      role: admin.role
    },
    env.ADMIN_JWT_SECRET
  );

  return ok({
    token,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      status: admin.status
    }
  });
}

async function handleAdminMe(request: Request, env: Env): Promise<Response> {
  const auth = await requireAdmin(request, env);

  if ('error' in auth) {
    return fail(auth.error, auth.error.code === 'UNAUTHORIZED' ? 401 : 403);
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

    const user = await createUser(env.DB, {
      name,
      expiresAt,
      remark: asNullableString(body.remark)
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.create',
      targetType: 'user',
      targetId: user.id,
      payload: { name: user.name }
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

    const user = await updateUser(env.DB, userId, {
      ...(asString(body.name) ? { name: asString(body.name) } : {}),
      ...(status ? { status } : {}),
      ...('expiresAt' in body ? { expiresAt } : {}),
      ...('remark' in body ? { remark: asNullableString(body.remark) } : {})
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
      payload: { status: user.status }
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
      payload: { previousToken: previous.token, currentToken: user.token }
    });
    return ok(user);
  }

  if (request.method === 'POST' && action === 'nodes') {
    const body = await parseJsonBody(request);

    if (!isRecord(body) || !Array.isArray(body.nodeIds)) {
      return fail(createAppError('VALIDATION_FAILED', 'nodeIds must be an array'), 400);
    }

    const nodeIds = [...new Set(body.nodeIds.filter((value): value is string => typeof value === 'string' && value.length > 0))];
    await replaceUserNodes(env.DB, userId, nodeIds);

    const user = await getUserById(env.DB, userId);

    if (user) {
      await invalidateUserCaches(env, { token: user.token, id: user.id });
    }

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'user.bind_nodes',
      targetType: 'user',
      targetId: userId,
      payload: { nodeIds }
    });

    return ok({ userId, nodeIds });
  }

  return notFound(`/api/users/${userId}`);
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
    const protocol = asString(body.protocol);
    const server = asString(body.server);
    const port = asNumber(body.port);

    if (!name || !protocol || !server || port === undefined) {
      return fail(createAppError('VALIDATION_FAILED', 'name, protocol, server and port are required'), 400);
    }

    if (!isValidPort(port)) {
      return fail(createAppError('VALIDATION_FAILED', 'port must be an integer between 1 and 65535'), 400);
    }

    const node = await createNode(env.DB, {
      name,
      protocol,
      server,
      port,
      sourceType: asString(body.sourceType),
      sourceId: asNullableString(body.sourceId),
      enabled: asBoolean(body.enabled),
      credentials: isRecord(body.credentials) ? body.credentials : undefined,
      params: isRecord(body.params) ? body.params : undefined
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'node.create',
      targetType: 'node',
      targetId: node.id,
      payload: { name: node.name, protocol: node.protocol }
    });
    return ok(node, { status: 201 });
  }

  return notFound('/api/nodes');
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

    const node = await updateNode(env.DB, nodeId, {
      ...(asString(body.name) ? { name: asString(body.name) } : {}),
      ...(asString(body.protocol) ? { protocol: asString(body.protocol) } : {}),
      ...(asString(body.server) ? { server: asString(body.server) } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(asString(body.sourceType) ? { sourceType: asString(body.sourceType) } : {}),
      ...('sourceId' in body ? { sourceId: asNullableString(body.sourceId) } : {}),
      ...(asBoolean(body.enabled) !== undefined ? { enabled: asBoolean(body.enabled) } : {}),
      ...(isRecord(body.credentials) ? { credentials: body.credentials } : {}),
      ...(isRecord(body.params) ? { params: body.params } : {})
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
      payload: { name: node.name, enabled: node.enabled }
    });
    return ok(node);
  }

  if (request.method === 'DELETE') {
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
      targetId: nodeId
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

    if (asNumber(body.version) !== undefined && (!Number.isInteger(asNumber(body.version)) || asNumber(body.version) <= 0)) {
      return fail(createAppError('VALIDATION_FAILED', 'version must be a positive integer'), 400);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, targetType);
    const template = await createTemplate(env.DB, {
      name,
      targetType,
      content,
      version: asNumber(body.version),
      isDefault: asBoolean(body.isDefault),
      enabled: asBoolean(body.enabled)
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
      payload: { name: template.name, targetType: template.targetType }
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

    if (asNumber(body.version) !== undefined && (!Number.isInteger(asNumber(body.version)) || asNumber(body.version) <= 0)) {
      return fail(createAppError('VALIDATION_FAILED', 'version must be a positive integer'), 400);
    }

    const currentTemplate = await getTemplateById(env.DB, templateId);

    if (!currentTemplate) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
    }

    const previousEffectiveTemplate = await getDefaultTemplateByTarget(env.DB, currentTemplate.targetType);
    const template = await updateTemplate(env.DB, templateId, {
      ...(asString(body.name) ? { name: asString(body.name) } : {}),
      ...(asString(body.content) ? { content: asString(body.content) } : {}),
      ...(asNumber(body.version) !== undefined ? { version: asNumber(body.version) } : {}),
      ...(asBoolean(body.enabled) !== undefined ? { enabled: asBoolean(body.enabled) } : {}),
      ...(asBoolean(body.isDefault) !== undefined ? { isDefault: asBoolean(body.isDefault) } : {})
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
      payload: { name: template.name, targetType: template.targetType }
    });
    return ok(template);
  }

  if (request.method === 'POST' && action === 'set-default') {
    const currentTemplate = await getTemplateById(env.DB, templateId);

    if (!currentTemplate) {
      return fail(createAppError('NOT_FOUND', 'template not found'), 404);
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
      payload: { targetType: template.targetType }
    });
    return ok(template);
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

    const ruleSource = await createRuleSource(env.DB, {
      name,
      sourceUrl,
      format,
      enabled: asBoolean(body.enabled)
    });

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.create',
      targetType: 'rule_source',
      targetId: ruleSource.id,
      payload: { name: ruleSource.name, format: ruleSource.format }
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

    const ruleSource = await updateRuleSource(env.DB, ruleSourceId, {
      ...(asString(body.name) ? { name: asString(body.name) } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(format ? { format: format as RuleSourceFormat } : {}),
      ...(asBoolean(body.enabled) !== undefined ? { enabled: asBoolean(body.enabled) } : {})
    });

    if (!ruleSource) {
      return fail(createAppError('NOT_FOUND', 'rule source not found'), 404);
    }

    await writeAuditLog(request, env, {
      actorAdminId: adminId,
      action: 'rule_source.update',
      targetType: 'rule_source',
      targetId: ruleSource.id,
      payload: { name: ruleSource.name, enabled: ruleSource.enabled }
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
      payload: { status: result.status, changed: result.changed, ruleCount: result.ruleCount, details: result.details ?? null }
    });
    return ok(result);
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

  const cacheKey = buildSubscriptionCacheKey(targetRaw, token);
  const cached = await env.SUB_CACHE.get(cacheKey);

  if (cached) {
    return text(cached, getContentTypeByTarget(targetRaw), {
      headers: {
        'x-subforge-cache': 'hit',
        'x-subforge-cache-key': cacheKey,
        'x-subforge-cache-scope': 'subscription'
      }
    });
  }

  const compileInput = await getSubscriptionCompileInputByToken(env.DB, token, targetRaw);

  if (!compileInput) {
    return fail(createAppError('SUBSCRIPTION_USER_NOT_FOUND', 'subscription token or template not found'), 404);
  }

  const result = compileSubscription(compileInput);

  if (!result.ok) {
    return fail(result.error, 400);
  }

  await env.SUB_CACHE.put(cacheKey, result.data.content, {
    expirationTtl: Number(env.SUBSCRIPTION_CACHE_TTL || '1800')
  });

  return text(result.data.content, result.data.mimeType, {
    headers: {
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
    return fail(auth.error, auth.error.code === 'UNAUTHORIZED' ? 401 : 403);
  }

  if (resource === 'admin' && resourceId === 'me' && request.method === 'GET') {
    return handleAdminMe(request, env);
  }

  if (resource === 'admin' && resourceId === 'logout' && request.method === 'POST') {
    return ok({ loggedOut: true });
  }

  if (resource === 'users' && !resourceId) {
    return handleUsers(request, env, auth.admin.id);
  }

  if (resource === 'users' && resourceId) {
    return handleUserById(request, env, auth.admin.id, resourceId, action);
  }

  if (resource === 'nodes' && !resourceId) {
    return handleNodes(request, env, auth.admin.id);
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
        return handleApiRequest(request, env, segments.slice(1));
      }

      if (request.method === 'GET' && segments[0] === 's' && segments[1] && segments[2]) {
        return handlePublicSubscription(request, env, segments[1], segments[2]);
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        return env.ASSETS.fetch(request);
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
