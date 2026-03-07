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

export function buildRuleSnapshotCacheKey(sourceId: string): string {
  return `${CACHE_KEY_PREFIXES.ruleSnapshot}:${sourceId}`;
}

export function buildActiveRulesCacheKey(target: SubscriptionTarget): string {
  return `${CACHE_KEY_PREFIXES.ruleActive}:${target}`;
}
