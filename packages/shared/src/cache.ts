import { CACHE_KEY_PREFIXES } from './constants';
import type { SubscriptionTarget } from './domain';

export function buildSubscriptionCacheKey(target: SubscriptionTarget, token: string): string {
  return `${CACHE_KEY_PREFIXES.subscription}:${target}:${token}`;
}

export function buildPreviewCacheKey(target: SubscriptionTarget, userId: string): string {
  return `${CACHE_KEY_PREFIXES.preview}:${target}:${userId}`;
}

export function buildDefaultTemplateCacheKey(target: SubscriptionTarget): string {
  return `${CACHE_KEY_PREFIXES.templateDefault}:${target}`;
}

export function buildAdminLoginRateLimitKey(clientKey: string, username: string): string {
  return `${CACHE_KEY_PREFIXES.adminLoginRateLimit}:${clientKey}:${username}`;
}

export function buildSubscriptionRateLimitKey(target: SubscriptionTarget, token: string, clientKey: string): string {
  return `${CACHE_KEY_PREFIXES.subscriptionRateLimit}:${target}:${token}:${clientKey}`;
}
