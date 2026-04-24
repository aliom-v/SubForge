import {
  ADMIN_ROLES,
  ADMIN_STATUSES,
  NODE_SOURCE_TYPES,
  SUBSCRIPTION_TARGETS,
  TEMPLATE_STATUSES,
  USER_STATUSES
} from './constants';

export type SubscriptionTarget = (typeof SUBSCRIPTION_TARGETS)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type AdminStatus = (typeof ADMIN_STATUSES)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type NodeSourceType = (typeof NODE_SOURCE_TYPES)[number];
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export type RemoteSubscriptionSyncStatus = 'success' | 'failed' | 'skipped';

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
  sessionNotBefore?: string | null;
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

export interface RemoteSubscriptionSourceRecord extends TimestampedRecord {
  id: string;
  name: string;
  sourceUrl: string;
  enabled: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: RemoteSubscriptionSyncStatus | null;
  lastSyncMessage?: string | null;
  lastSyncDetails?: Record<string, JsonValue> | null;
  failureCount: number;
}

export interface UserNodeBinding {
  id: string;
  userId: string;
  nodeId: string;
  enabled: boolean;
  createdAt: string;
}
