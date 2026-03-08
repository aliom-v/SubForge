import type {
  AuditLogRecord,
  JsonValue,
  RuleSourceFormat,
  RuleSourceRecord,
  SubscriptionTarget,
  SyncLogRecord,
  TemplateRecord,
  UserNodeBinding,
  UserRecord,
  NodeRecord,
  AdminRecord
} from '@subforge/shared';
import type { SubscriptionCompileInput, SubscriptionNode, SubscriptionRuleSet, SubscriptionTemplate } from '@subforge/core';
import { sanitizeAuditPayload } from './audit';
import { createId, createRandomToken } from './security';

interface Row {
  [key: string]: unknown;
}

function asString(value: unknown): string {
  return value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function asBoolean(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

function parseJsonObject(value: unknown): Record<string, JsonValue> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, JsonValue>)
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeJsonObject(value: Record<string, unknown> | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value);
}

function mapAdmin(row: Row): AdminRecord {
  const sessionNotBefore = asNullableString(row.session_not_before);

  return {
    id: asString(row.id),
    username: asString(row.username),
    role: asString(row.role) as AdminRecord['role'],
    status: asString(row.status) as AdminRecord['status'],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    ...(sessionNotBefore !== null ? { sessionNotBefore } : {})
  };
}

function mapUser(row: Row): UserRecord {
  const expiresAt = asNullableString(row.expires_at);
  const remark = asNullableString(row.remark);

  return {
    id: asString(row.id),
    name: asString(row.name),
    token: asString(row.token),
    status: asString(row.status) as UserRecord['status'],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    ...(expiresAt !== null ? { expiresAt } : {}),
    ...(remark !== null ? { remark } : {})
  };
}

function mapNode(row: Row): NodeRecord {
  const sourceId = asNullableString(row.source_id);
  const lastSyncAt = asNullableString(row.last_sync_at);
  const credentials = parseJsonObject(row.credentials_json);
  const params = parseJsonObject(row.params_json);

  return {
    id: asString(row.id),
    name: asString(row.name),
    protocol: asString(row.protocol),
    server: asString(row.server),
    port: asNumber(row.port),
    sourceType: asString(row.source_type) as NodeRecord['sourceType'],
    enabled: asBoolean(row.enabled),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    ...(sourceId !== null ? { sourceId } : {}),
    ...(lastSyncAt !== null ? { lastSyncAt } : {}),
    ...(credentials ? { credentials } : {}),
    ...(params ? { params } : {})
  };
}

function mapTemplate(row: Row): TemplateRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    targetType: asString(row.target_type) as SubscriptionTarget,
    content: asString(row.content),
    version: asNumber(row.version),
    isDefault: asBoolean(row.is_default),
    status: asBoolean(row.enabled) ? 'enabled' : 'disabled',
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function mapRuleSource(row: Row): RuleSourceRecord {
  const lastSyncAt = asNullableString(row.last_sync_at);
  const lastSyncStatus = asNullableString(row.last_sync_status);

  return {
    id: asString(row.id),
    name: asString(row.name),
    sourceUrl: asString(row.source_url),
    format: asString(row.format) as RuleSourceFormat,
    enabled: asBoolean(row.enabled),
    failureCount: asNumber(row.failure_count),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    ...(lastSyncAt !== null ? { lastSyncAt } : {}),
    ...(lastSyncStatus !== null
      ? { lastSyncStatus: lastSyncStatus as Exclude<RuleSourceRecord['lastSyncStatus'], undefined> }
      : {})
  };
}

function mapRuleSet(row: Row): SubscriptionRuleSet {
  return {
    id: asString(row.id),
    name: asString(row.name),
    format: asString(row.format) as RuleSourceFormat,
    content: asString(row.content),
    sourceId: asString(row.rule_source_id)
  };
}

function mapNodeForSubscription(node: NodeRecord): SubscriptionNode {
  return {
    id: node.id,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
    enabled: node.enabled,
    ...(node.credentials ? { credentials: node.credentials } : {}),
    ...(node.params ? { params: node.params } : {})
  };
}

function mapTemplateForSubscription(template: TemplateRecord): SubscriptionTemplate {
  return {
    id: template.id,
    name: template.name,
    target: template.targetType,
    content: template.content,
    version: template.version,
    isDefault: template.isDefault
  };
}

async function first(db: D1Database, sql: string, bindings: unknown[] = []): Promise<Row | null> {
  return (await db.prepare(sql).bind(...bindings).first<Row>()) ?? null;
}

async function all(db: D1Database, sql: string, bindings: unknown[] = []): Promise<Row[]> {
  const result = await db.prepare(sql).bind(...bindings).all<Row>();
  return result.results ?? [];
}

export async function getAdminLoginRowByUsername(
  db: D1Database,
  username: string
): Promise<(AdminRecord & { passwordHash: string }) | null> {
  const row = await first(db, 'SELECT * FROM admins WHERE username = ? LIMIT 1', [username]);

  if (!row) {
    return null;
  }

  return {
    ...mapAdmin(row),
    passwordHash: asString(row.password_hash)
  };
}

export async function getAdminById(db: D1Database, id: string): Promise<AdminRecord | null> {
  const row = await first(db, 'SELECT * FROM admins WHERE id = ? LIMIT 1', [id]);
  return row ? mapAdmin(row) : null;
}


export async function countAdmins(db: D1Database): Promise<number> {
  const row = await first(db, 'SELECT COUNT(*) AS count FROM admins LIMIT 1');
  return row ? asNumber(row.count) : 0;
}

export async function createAdmin(
  db: D1Database,
  input: { username: string; passwordHash: string; role?: AdminRecord['role']; status?: AdminRecord['status'] }
): Promise<AdminRecord> {
  const id = createId('adm');
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO admins (id, username, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, input.username, input.passwordHash, input.role ?? 'admin', input.status ?? 'active', now, now)
    .run();

  return (await getAdminById(db, id)) as AdminRecord;
}

export async function revokeAdminSessions(db: D1Database, id: string): Promise<AdminRecord | null> {
  const current = await getAdminById(db, id);

  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  await db
    .prepare('UPDATE admins SET session_not_before = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, id)
    .run();

  return getAdminById(db, id);
}

export async function listUsers(db: D1Database): Promise<UserRecord[]> {
  const rows = await all(db, 'SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(mapUser);
}

export async function listUserTokens(db: D1Database): Promise<string[]> {
  const rows = await all(db, 'SELECT token FROM users');
  return rows.map((row) => asString(row.token)).filter(Boolean);
}

export async function getUserById(db: D1Database, id: string): Promise<UserRecord | null> {
  const row = await first(db, 'SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return row ? mapUser(row) : null;
}

export async function getUserByToken(db: D1Database, token: string): Promise<UserRecord | null> {
  const row = await first(db, 'SELECT * FROM users WHERE token = ? LIMIT 1', [token]);
  return row ? mapUser(row) : null;
}

export async function createUser(
  db: D1Database,
  input: { name: string; expiresAt?: string | null | undefined; remark?: string | null | undefined }
): Promise<UserRecord> {
  const id = createId('usr');
  const token = createRandomToken(24);
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO users (id, name, token, status, expires_at, remark, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, input.name, token, 'active', input.expiresAt ?? null, input.remark ?? null, now, now)
    .run();

  return (await getUserById(db, id)) as UserRecord;
}

export async function updateUser(
  db: D1Database,
  id: string,
  input: {
    name?: string | undefined;
    status?: string | undefined;
    expiresAt?: string | null | undefined;
    remark?: string | null | undefined;
  }
): Promise<UserRecord | null> {
  const current = await getUserById(db, id);

  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      'UPDATE users SET name = ?, status = ?, expires_at = ?, remark = ?, updated_at = ? WHERE id = ?'
    )
    .bind(
      input.name ?? current.name,
      input.status ?? current.status,
      'expiresAt' in input ? (input.expiresAt ?? null) : (current.expiresAt ?? null),
      'remark' in input ? (input.remark ?? null) : (current.remark ?? null),
      now,
      id
    )
    .run();

  return getUserById(db, id);
}

export async function resetUserToken(db: D1Database, id: string): Promise<UserRecord | null> {
  const current = await getUserById(db, id);

  if (!current) {
    return null;
  }

  await db
    .prepare('UPDATE users SET token = ?, updated_at = ? WHERE id = ?')
    .bind(createRandomToken(24), new Date().toISOString(), id)
    .run();

  return getUserById(db, id);
}

export async function deleteUser(db: D1Database, id: string): Promise<boolean> {
  const current = await getUserById(db, id);

  if (!current) {
    return false;
  }

  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return true;
}

export async function replaceUserNodes(db: D1Database, userId: string, nodeIds: string[]): Promise<void> {
  await db.prepare('DELETE FROM user_node_map WHERE user_id = ?').bind(userId).run();

  const now = new Date().toISOString();
  const statements = nodeIds.map((nodeId) =>
    db
      .prepare(
        'INSERT INTO user_node_map (id, user_id, node_id, enabled, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(createId('unm'), userId, nodeId, 1, now)
  );

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function listNodes(db: D1Database): Promise<NodeRecord[]> {
  const rows = await all(db, 'SELECT * FROM nodes ORDER BY created_at DESC');
  return rows.map(mapNode);
}

export async function getNodeById(db: D1Database, id: string): Promise<NodeRecord | null> {
  const row = await first(db, 'SELECT * FROM nodes WHERE id = ? LIMIT 1', [id]);
  return row ? mapNode(row) : null;
}

export async function createNode(
  db: D1Database,
  input: {
    name: string;
    protocol: string;
    server: string;
    port: number;
    sourceType?: string | undefined;
    sourceId?: string | null | undefined;
    enabled?: boolean | undefined;
    credentials?: Record<string, unknown> | null | undefined;
    params?: Record<string, unknown> | null | undefined;
  }
): Promise<NodeRecord> {
  const id = createId('node');
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO nodes (id, name, protocol, server, port, credentials_json, params_json, source_type, source_id, enabled, last_sync_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      id,
      input.name,
      input.protocol,
      input.server,
      input.port,
      serializeJsonObject(input.credentials),
      serializeJsonObject(input.params),
      input.sourceType ?? 'manual',
      input.sourceId ?? null,
      input.enabled === false ? 0 : 1,
      null,
      now,
      now
    )
    .run();

  return (await getNodeById(db, id)) as NodeRecord;
}

export async function updateNode(
  db: D1Database,
  id: string,
  input: {
    name?: string | undefined;
    protocol?: string | undefined;
    server?: string | undefined;
    port?: number | undefined;
    sourceType?: string | undefined;
    sourceId?: string | null | undefined;
    enabled?: boolean | undefined;
    credentials?: Record<string, unknown> | null | undefined;
    params?: Record<string, unknown> | null | undefined;
  }
): Promise<NodeRecord | null> {
  const current = await getNodeById(db, id);

  if (!current) {
    return null;
  }

  await db
    .prepare(
      'UPDATE nodes SET name = ?, protocol = ?, server = ?, port = ?, credentials_json = ?, params_json = ?, source_type = ?, source_id = ?, enabled = ?, updated_at = ? WHERE id = ?'
    )
    .bind(
      input.name ?? current.name,
      input.protocol ?? current.protocol,
      input.server ?? current.server,
      input.port ?? current.port,
      'credentials' in input ? serializeJsonObject(input.credentials) : serializeJsonObject(current.credentials),
      'params' in input ? serializeJsonObject(input.params) : serializeJsonObject(current.params),
      input.sourceType ?? current.sourceType,
      'sourceId' in input ? (input.sourceId ?? null) : (current.sourceId ?? null),
      input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
      new Date().toISOString(),
      id
    )
    .run();

  return getNodeById(db, id);
}

export async function deleteNode(db: D1Database, id: string): Promise<boolean> {
  const current = await getNodeById(db, id);

  if (!current) {
    return false;
  }

  await db.prepare('DELETE FROM nodes WHERE id = ?').bind(id).run();
  return true;
}

export async function listTemplates(db: D1Database): Promise<TemplateRecord[]> {
  const rows = await all(db, 'SELECT * FROM templates ORDER BY target_type ASC, version DESC, created_at DESC');
  return rows.map(mapTemplate);
}

export async function getTemplateById(db: D1Database, id: string): Promise<TemplateRecord | null> {
  const row = await first(db, 'SELECT * FROM templates WHERE id = ? LIMIT 1', [id]);
  return row ? mapTemplate(row) : null;
}

export async function getDefaultTemplateByTarget(
  db: D1Database,
  target: SubscriptionTarget
): Promise<TemplateRecord | null> {
  const row = await first(
    db,
    'SELECT * FROM templates WHERE target_type = ? AND enabled = 1 ORDER BY is_default DESC, version DESC, created_at DESC LIMIT 1',
    [target]
  );
  return row ? mapTemplate(row) : null;
}

export async function createTemplate(
  db: D1Database,
  input: {
    name: string;
    targetType: SubscriptionTarget;
    content: string;
    version?: number | undefined;
    isDefault?: boolean | undefined;
    enabled?: boolean | undefined;
  }
): Promise<TemplateRecord> {
  const id = createId('tpl');
  const now = new Date().toISOString();

  if (input.isDefault) {
    await db
      .prepare('UPDATE templates SET is_default = 0, updated_at = ? WHERE target_type = ?')
      .bind(now, input.targetType)
      .run();
  }

  await db
    .prepare(
      'INSERT INTO templates (id, name, target_type, content, version, is_default, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      id,
      input.name,
      input.targetType,
      input.content,
      input.version ?? 1,
      input.isDefault ? 1 : 0,
      input.enabled === false ? 0 : 1,
      now,
      now
    )
    .run();

  return (await getTemplateById(db, id)) as TemplateRecord;
}

export async function updateTemplate(
  db: D1Database,
  id: string,
  input: {
    name?: string | undefined;
    content?: string | undefined;
    version?: number | undefined;
    enabled?: boolean | undefined;
    isDefault?: boolean | undefined;
  }
): Promise<TemplateRecord | null> {
  const current = await getTemplateById(db, id);

  if (!current) {
    return null;
  }

  const now = new Date().toISOString();
  const nextEnabled = input.enabled === undefined ? current.status === 'enabled' : input.enabled;
  const nextIsDefault =
    !nextEnabled ? false : input.isDefault === undefined ? current.isDefault : input.isDefault;

  if (input.isDefault) {
    await db
      .prepare('UPDATE templates SET is_default = 0, updated_at = ? WHERE target_type = ?')
      .bind(now, current.targetType)
      .run();
  }

  await db
    .prepare(
      'UPDATE templates SET name = ?, content = ?, version = ?, is_default = ?, enabled = ?, updated_at = ? WHERE id = ?'
    )
    .bind(
      input.name ?? current.name,
      input.content ?? current.content,
      input.version ?? current.version,
      nextIsDefault ? 1 : 0,
      nextEnabled ? 1 : 0,
      now,
      id
    )
    .run();

  return getTemplateById(db, id);
}

export async function setDefaultTemplate(db: D1Database, id: string): Promise<TemplateRecord | null> {
  const template = await getTemplateById(db, id);

  if (!template) {
    return null;
  }

  const now = new Date().toISOString();
  await db
    .prepare('UPDATE templates SET is_default = 0, updated_at = ? WHERE target_type = ?')
    .bind(now, template.targetType)
    .run();
  await db
    .prepare('UPDATE templates SET is_default = 1, updated_at = ? WHERE id = ?')
    .bind(now, id)
    .run();

  return getTemplateById(db, id);
}

export async function deleteTemplate(db: D1Database, id: string): Promise<boolean> {
  const current = await getTemplateById(db, id);

  if (!current) {
    return false;
  }

  await db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
  return true;
}

export async function listRuleSources(db: D1Database): Promise<RuleSourceRecord[]> {
  const rows = await all(db, 'SELECT * FROM rule_sources ORDER BY created_at DESC');
  return rows.map(mapRuleSource);
}

export async function getRuleSourceById(db: D1Database, id: string): Promise<RuleSourceRecord | null> {
  const row = await first(db, 'SELECT * FROM rule_sources WHERE id = ? LIMIT 1', [id]);
  return row ? mapRuleSource(row) : null;
}

export async function createRuleSource(
  db: D1Database,
  input: {
    name: string;
    sourceUrl: string;
    format: RuleSourceFormat;
    enabled?: boolean | undefined;
  }
): Promise<RuleSourceRecord> {
  const id = createId('rs');
  const now = new Date().toISOString();

  await db
    .prepare(
      'INSERT INTO rule_sources (id, name, source_url, format, enabled, last_sync_at, last_sync_status, failure_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, input.name, input.sourceUrl, input.format, input.enabled === false ? 0 : 1, null, null, 0, now, now)
    .run();

  return (await getRuleSourceById(db, id)) as RuleSourceRecord;
}

export async function updateRuleSource(
  db: D1Database,
  id: string,
  input: {
    name?: string | undefined;
    sourceUrl?: string | undefined;
    format?: RuleSourceFormat | undefined;
    enabled?: boolean | undefined;
  }
): Promise<RuleSourceRecord | null> {
  const current = await getRuleSourceById(db, id);

  if (!current) {
    return null;
  }

  await db
    .prepare(
      'UPDATE rule_sources SET name = ?, source_url = ?, format = ?, enabled = ?, updated_at = ? WHERE id = ?'
    )
    .bind(
      input.name ?? current.name,
      input.sourceUrl ?? current.sourceUrl,
      input.format ?? current.format,
      input.enabled === undefined ? (current.enabled ? 1 : 0) : input.enabled ? 1 : 0,
      new Date().toISOString(),
      id
    )
    .run();

  return getRuleSourceById(db, id);
}

export async function deleteRuleSource(db: D1Database, id: string): Promise<boolean> {
  const current = await getRuleSourceById(db, id);

  if (!current) {
    return false;
  }

  await db.prepare('DELETE FROM rule_sources WHERE id = ?').bind(id).run();
  return true;
}

export async function recordRuleSourceSync(
  db: D1Database,
  sourceId: string,
  status: SyncLogRecord['status'],
  message: string,
  details?: Record<string, unknown> | null
): Promise<RuleSourceRecord | null> {
  const now = new Date().toISOString();
  const current = await getRuleSourceById(db, sourceId);

  if (!current) {
    return null;
  }

  await db
    .prepare(
      'UPDATE rule_sources SET last_sync_at = ?, last_sync_status = ?, failure_count = ?, updated_at = ? WHERE id = ?'
    )
    .bind(now, status, status === 'failed' ? current.failureCount + 1 : 0, now, sourceId)
    .run();

  await db
    .prepare(
      'INSERT INTO sync_logs (id, source_type, source_id, status, message, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      createId('sync'),
      'rule_source',
      sourceId,
      status,
      message,
      details ? JSON.stringify(details) : null,
      now
    )
    .run();

  return getRuleSourceById(db, sourceId);
}

export async function getSubscriptionCompileInputByToken(
  db: D1Database,
  token: string,
  target: SubscriptionTarget
): Promise<SubscriptionCompileInput | null> {
  const user = await getUserByToken(db, token);
  return user ? getSubscriptionCompileInputByUserId(db, user.id, target) : null;
}

export async function getSubscriptionCompileInputByUserId(
  db: D1Database,
  userId: string,
  target: SubscriptionTarget
): Promise<SubscriptionCompileInput | null> {
  const user = await getUserById(db, userId);

  if (!user) {
    return null;
  }

  const template = await getDefaultTemplateByTarget(db, target);

  if (!template || template.status !== 'enabled') {
    return null;
  }

  const nodeRows = await all(
    db,
    `SELECT n.*
     FROM nodes n
     INNER JOIN user_node_map unm ON unm.node_id = n.id
     WHERE unm.user_id = ? AND unm.enabled = 1 AND n.enabled = 1
     ORDER BY n.created_at DESC`,
    [userId]
  );

  const snapshotRows = await all(
    db,
    `SELECT rs.id, rs.rule_source_id, rs.content_hash, rs.content, rs.created_at, rsrc.name, rsrc.format
     FROM rule_snapshots rs
     INNER JOIN rule_sources rsrc ON rsrc.id = rs.rule_source_id
     WHERE rsrc.enabled = 1
     ORDER BY rs.created_at DESC`
  );

  const latestSnapshots = new Map<string, SubscriptionRuleSet>();

  for (const row of snapshotRows) {
    const ruleSourceId = asString(row.rule_source_id);

    if (!latestSnapshots.has(ruleSourceId)) {
      latestSnapshots.set(ruleSourceId, mapRuleSet(row));
    }
  }

  return {
    target,
    user: {
      id: user.id,
      name: user.name,
      token: user.token,
      status: user.status,
      ...(user.expiresAt ? { expiresAt: user.expiresAt } : {})
    },
    nodes: nodeRows.map(mapNode).map(mapNodeForSubscription),
    ruleSets: [...latestSnapshots.values()],
    template: mapTemplateForSubscription(template)
  };
}

function mapSyncLog(row: Row): SyncLogRecord {
  const sourceId = asNullableString(row.source_id);
  const message = asNullableString(row.message);
  const details = parseJsonObject(row.details_json) as SyncLogRecord['details'];

  return {
    id: asString(row.id),
    sourceType: asString(row.source_type),
    status: asString(row.status) as SyncLogRecord['status'],
    createdAt: asString(row.created_at),
    ...(sourceId !== null ? { sourceId } : {}),
    ...(message !== null ? { message } : {}),
    ...(details ? { details } : {})
  };
}

export async function listSyncLogs(db: D1Database, limit = 50): Promise<SyncLogRecord[]> {
  const rows = await all(
    db,
    'SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  return rows.map(mapSyncLog);
}

export async function listEnabledRuleSources(db: D1Database): Promise<RuleSourceRecord[]> {
  const rows = await all(
    db,
    'SELECT * FROM rule_sources WHERE enabled = 1 ORDER BY created_at DESC'
  );
  return rows.map(mapRuleSource);
}

export async function getLatestRuleSnapshotBySourceId(
  db: D1Database,
  sourceId: string
): Promise<{ id: string; ruleSourceId: string; contentHash: string; content: string; createdAt: string } | null> {
  const row = await first(
    db,
    'SELECT * FROM rule_snapshots WHERE rule_source_id = ? ORDER BY created_at DESC LIMIT 1',
    [sourceId]
  );

  if (!row) {
    return null;
  }

  return {
    id: asString(row.id),
    ruleSourceId: asString(row.rule_source_id),
    contentHash: asString(row.content_hash),
    content: asString(row.content),
    createdAt: asString(row.created_at)
  };
}

export async function insertRuleSnapshot(
  db: D1Database,
  input: { ruleSourceId: string; contentHash: string; content: string }
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO rule_snapshots (id, rule_source_id, content_hash, content, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(createId('snap'), input.ruleSourceId, input.contentHash, input.content, new Date().toISOString())
    .run();
}

export async function listUserNodeBindings(
  db: D1Database,
  userId: string
): Promise<UserNodeBinding[]> {
  const rows = await all(
    db,
    'SELECT * FROM user_node_map WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );

  return rows.map((row) => ({
    id: asString(row.id),
    userId: asString(row.user_id),
    nodeId: asString(row.node_id),
    enabled: asBoolean(row.enabled),
    createdAt: asString(row.created_at)
  }));
}

function mapAuditLog(row: Row): AuditLogRecord {
  const targetId = asNullableString(row.target_id);
  const payload = sanitizeAuditPayload(parseJsonObject(row.payload_json)) as AuditLogRecord['payload'];
  const actorAdminUsername = asNullableString(row.actor_admin_username);

  return {
    id: asString(row.id),
    actorAdminId: asString(row.actor_admin_id),
    action: asString(row.action),
    targetType: asString(row.target_type),
    createdAt: asString(row.created_at),
    ...(actorAdminUsername !== null ? { actorAdminUsername } : {}),
    ...(targetId !== null ? { targetId } : {}),
    ...(payload ? { payload } : {})
  };
}

export async function createAuditLog(
  db: D1Database,
  input: {
    actorAdminId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_logs (id, actor_admin_id, action, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      createId('audit'),
      input.actorAdminId,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      new Date().toISOString()
    )
    .run();
}

export async function listAuditLogs(db: D1Database, limit = 50): Promise<AuditLogRecord[]> {
  const rows = await all(
    db,
    `SELECT audit_logs.*, admins.username AS actor_admin_username
     FROM audit_logs
     LEFT JOIN admins ON admins.id = audit_logs.actor_admin_id
     ORDER BY audit_logs.created_at DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map(mapAuditLog);
}

export async function listUserCacheRefs(db: D1Database): Promise<Array<{ id: string; token: string }>> {
  const rows = await all(db, 'SELECT id, token FROM users');
  return rows.map((row) => ({
    id: asString(row.id),
    token: asString(row.token)
  }));
}

export async function listUsersByNodeId(
  db: D1Database,
  nodeId: string
): Promise<Array<{ id: string; token: string }>> {
  const rows = await all(
    db,
    `SELECT u.id, u.token
     FROM users u
     INNER JOIN user_node_map unm ON unm.user_id = u.id
     WHERE unm.node_id = ? AND unm.enabled = 1`,
    [nodeId]
  );

  return rows.map((row) => ({
    id: asString(row.id),
    token: asString(row.token)
  }));
}
