import {
  ADMIN_ROLES,
  ADMIN_STATUSES,
  NODE_SOURCE_TYPES,
  RULE_SOURCE_FORMATS,
  SUBSCRIPTION_TARGETS,
  SYNC_LOG_STATUSES,
  TEMPLATE_STATUSES,
  USER_STATUSES
} from './constants';

export type SubscriptionTarget = (typeof SUBSCRIPTION_TARGETS)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type AdminStatus = (typeof ADMIN_STATUSES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type NodeSourceType = (typeof NODE_SOURCE_TYPES)[number];
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export type RuleSourceFormat = (typeof RULE_SOURCE_FORMATS)[number];
export type SyncLogStatus = (typeof SYNC_LOG_STATUSES)[number];

export type Primitive = string | number | boolean | null;
export type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

export interface TimestampedRecord {
  createdAt: string;
  updatedAt?: string;
}

export interface AdminRecord extends TimestampedRecord {
  id: string;
  username: string;
  role: AdminRole;
  status: AdminStatus;
}

export interface UserRecord extends TimestampedRecord {
  id: string;
  name: string;
  token: string;
  status: UserStatus;
  expiresAt?: string | null;
  remark?: string | null;
}

export interface NodeRecord extends TimestampedRecord {
  id: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
  sourceType: NodeSourceType;
  sourceId?: string | null;
  enabled: boolean;
  lastSyncAt?: string | null;
  credentials?: Record<string, JsonValue>;
  params?: Record<string, JsonValue>;
}

export interface TemplateRecord extends TimestampedRecord {
  id: string;
  name: string;
  targetType: SubscriptionTarget;
  content: string;
  version: number;
  isDefault: boolean;
  status: TemplateStatus;
}

export interface RuleSourceRecord extends TimestampedRecord {
  id: string;
  name: string;
  sourceUrl: string;
  format: RuleSourceFormat;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: SyncLogStatus | null;
  failureCount: number;
}

export interface RuleSnapshotRecord {
  id: string;
  ruleSourceId: string;
  contentHash: string;
  content: string;
  createdAt: string;
}

export interface UserNodeBinding {
  id: string;
  userId: string;
  nodeId: string;
  enabled: boolean;
  createdAt: string;
}

export interface SyncLogRecord {
  id: string;
  sourceType: string;
  sourceId?: string | null;
  status: SyncLogStatus;
  message?: string | null;
  details?: Record<string, JsonValue> | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorAdminId: string;
  actorAdminUsername?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, JsonValue> | null;
  createdAt: string;
}
