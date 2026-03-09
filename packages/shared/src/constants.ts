export const APP_NAME = 'SubForge';
export const APP_VERSION = '0.1.0';
export const APP_DESCRIPTION =
  'Cloudflare 上的订阅管理平台骨架，面向 Mihomo 与 sing-box 双订阅输出。';

export const API_PREFIX = '/api';
export const HEALTH_ENDPOINT = '/health';

export const SUBSCRIPTION_TARGETS = ['mihomo', 'singbox'] as const;
export const USER_STATUSES = ['active', 'disabled'] as const;
export const ADMIN_STATUSES = ['active', 'disabled'] as const;
export const ADMIN_ROLES = ['admin'] as const;
export const NODE_SOURCE_TYPES = ['manual', 'remote'] as const;
export const TEMPLATE_STATUSES = ['enabled', 'disabled'] as const;
export const RULE_SOURCE_FORMATS = ['yaml', 'json', 'text'] as const;
export const SYNC_LOG_STATUSES = ['success', 'failed', 'skipped'] as const;

export const CACHE_KEY_PREFIXES = {
  subscription: 'sub',
  preview: 'preview',
  templateDefault: 'template:default',
  ruleSnapshot: 'rules:snapshot',
  ruleActive: 'rules:active',
  adminLoginRateLimit: 'rate:admin-login',
  subscriptionRateLimit: 'rate:subscription'
} as const;
