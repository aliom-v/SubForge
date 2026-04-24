export const APP_NAME = 'SubForge';
export const APP_VERSION = '0.1.0';
export const APP_DESCRIPTION =
  'Cloudflare 上的单用户托管订阅工具，面向 Mihomo 与 sing-box URL 拉取输出。';

export const API_PREFIX = '/api';
export const HEALTH_ENDPOINT = '/health';

export const SUBSCRIPTION_TARGETS = ['mihomo', 'singbox'] as const;
export const AUTO_HOSTED_USER_NAME = '个人托管订阅';
export const AUTO_HOSTED_USER_REMARK = 'subforge:auto-hosted';
export const USER_STATUSES = ['active', 'disabled'] as const;
export const ADMIN_STATUSES = ['active', 'disabled'] as const;
export const ADMIN_ROLES = ['admin'] as const;
export const NODE_SOURCE_TYPES = ['manual', 'remote'] as const;
export const TEMPLATE_STATUSES = ['enabled', 'disabled'] as const;

export const CACHE_KEY_PREFIXES = {
  subscription: 'sub',
  preview: 'preview',
  templateDefault: 'template:default',
  adminLoginRateLimit: 'rate:admin-login',
  subscriptionRateLimit: 'rate:subscription'
} as const;
