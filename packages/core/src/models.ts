import type {
  AppErrorShape,
  ApiResult,
  JsonValue,
  SubscriptionTarget,
  UserStatus
} from '@subforge/shared';

export interface SubscriptionUser {
  id: string;
  name: string;
  token: string;
  status: UserStatus;
  expiresAt?: string | null;
}

export interface SubscriptionNode {
  id: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
  enabled: boolean;
  credentials?: Record<string, JsonValue>;
  params?: Record<string, JsonValue>;
}

export interface SubscriptionTemplate {
  id: string;
  name: string;
  target: SubscriptionTarget;
  content: string;
  version: number;
  isDefault: boolean;
}

export interface SubscriptionRenderContext {
  target: SubscriptionTarget;
  generatedAt: string;
  user: SubscriptionUser;
  nodes: SubscriptionNode[];
  template: SubscriptionTemplate;
}

export interface CompiledSubscription {
  target: SubscriptionTarget;
  mimeType: string;
  content: string;
  cacheKey: string;
  generatedAt: string;
  metadata: {
    userId: string;
    nodeCount: number;
    templateName: string;
  };
}

export interface SubscriptionCompileInput {
  target: SubscriptionTarget;
  user: SubscriptionUser;
  nodes: SubscriptionNode[];
  template: SubscriptionTemplate;
}

export type SubscriptionCompileResult = ApiResult<CompiledSubscription, AppErrorShape>;
