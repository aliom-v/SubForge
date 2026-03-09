import {
  buildAdminLoginRateLimitKey,
  buildSubscriptionRateLimitKey,
  type SubscriptionTarget
} from '@subforge/shared';
import type { Env } from './env';

const DEFAULT_ADMIN_LOGIN_WINDOW_SEC = 600;
const DEFAULT_ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_SUBSCRIPTION_WINDOW_SEC = 60;
const DEFAULT_SUBSCRIPTION_MAX_REQUESTS = 60;

interface StoredRateLimitState {
  count: number;
  resetAt: string;
}

interface RateLimitPolicy {
  scope: 'admin_login' | 'subscription';
  limit: number;
  windowSec: number;
}

export interface RateLimitDecision {
  scope: RateLimitPolicy['scope'];
  key: string;
  limit: number;
  remaining: number;
  retryAfterSec: number;
  resetAt: string;
  current: number;
  allowed: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeKeyPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

function getClientAddress(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip');

  if (cloudflareIp?.trim()) {
    return cloudflareIp.trim();
  }

  const forwardedFor = request.headers.get('x-forwarded-for');

  if (forwardedFor?.trim()) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  return 'unknown';
}

function buildDecision(
  policy: RateLimitPolicy,
  key: string,
  current: number,
  resetAtMs: number,
  nowMs: number,
  allowed: boolean
): RateLimitDecision {
  const remaining = allowed ? Math.max(policy.limit - current, 0) : 0;
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));

  return {
    scope: policy.scope,
    key,
    limit: policy.limit,
    remaining,
    retryAfterSec,
    resetAt: new Date(resetAtMs).toISOString(),
    current,
    allowed
  };
}

async function readRateLimitState(kv: KVNamespace, key: string, nowMs: number): Promise<{ count: number; resetAtMs: number } | null> {
  const raw = await kv.get(key);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as StoredRateLimitState;
    const resetAtMs = Date.parse(parsed.resetAt);

    if (!Number.isFinite(resetAtMs) || !Number.isInteger(parsed.count) || parsed.count <= 0 || resetAtMs <= nowMs) {
      return null;
    }

    return {
      count: parsed.count,
      resetAtMs
    };
  } catch {
    return null;
  }
}

async function writeRateLimitState(kv: KVNamespace, key: string, count: number, resetAtMs: number, windowSec: number): Promise<void> {
  await kv.put(
    key,
    JSON.stringify({
      count,
      resetAt: new Date(resetAtMs).toISOString()
    } satisfies StoredRateLimitState),
    {
      expirationTtl: windowSec
    }
  );
}

async function peekRateLimit(kv: KVNamespace, key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
  const nowMs = Date.now();
  const state = await readRateLimitState(kv, key, nowMs);
  const resetAtMs = state?.resetAtMs ?? nowMs + policy.windowSec * 1000;
  const current = state?.count ?? 0;
  return buildDecision(policy, key, current, resetAtMs, nowMs, current < policy.limit);
}

async function consumeRateLimit(kv: KVNamespace, key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
  const nowMs = Date.now();
  const state = await readRateLimitState(kv, key, nowMs);
  const resetAtMs = state?.resetAtMs ?? nowMs + policy.windowSec * 1000;

  if (state && state.count >= policy.limit) {
    return buildDecision(policy, key, state.count, resetAtMs, nowMs, false);
  }

  const nextCount = (state?.count ?? 0) + 1;
  await writeRateLimitState(kv, key, nextCount, resetAtMs, policy.windowSec);

  return buildDecision(policy, key, nextCount, resetAtMs, nowMs, nextCount <= policy.limit);
}

function getAdminLoginPolicy(env: Env): RateLimitPolicy {
  return {
    scope: 'admin_login',
    limit: parsePositiveInt(env.ADMIN_LOGIN_RATE_LIMIT_MAX_ATTEMPTS, DEFAULT_ADMIN_LOGIN_MAX_ATTEMPTS),
    windowSec: parsePositiveInt(env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_SEC, DEFAULT_ADMIN_LOGIN_WINDOW_SEC)
  };
}

function getSubscriptionPolicy(env: Env): RateLimitPolicy {
  return {
    scope: 'subscription',
    limit: parsePositiveInt(env.SUBSCRIPTION_RATE_LIMIT_MAX_REQUESTS, DEFAULT_SUBSCRIPTION_MAX_REQUESTS),
    windowSec: parsePositiveInt(env.SUBSCRIPTION_RATE_LIMIT_WINDOW_SEC, DEFAULT_SUBSCRIPTION_WINDOW_SEC)
  };
}

function buildAdminLoginKey(request: Request, _username: string): string {
  return buildAdminLoginRateLimitKey(sanitizeKeyPart(getClientAddress(request)), 'all');
}

function buildSubscriptionKey(request: Request, token: string, target: SubscriptionTarget): string {
  return buildSubscriptionRateLimitKey(target, token, sanitizeKeyPart(getClientAddress(request)));
}

export async function peekAdminLoginRateLimit(request: Request, env: Env, username: string): Promise<RateLimitDecision> {
  return peekRateLimit(env.SUB_CACHE, buildAdminLoginKey(request, username), getAdminLoginPolicy(env));
}

export async function recordAdminLoginFailure(request: Request, env: Env, username: string): Promise<RateLimitDecision> {
  return consumeRateLimit(env.SUB_CACHE, buildAdminLoginKey(request, username), getAdminLoginPolicy(env));
}

export async function clearAdminLoginRateLimit(request: Request, env: Env, username: string): Promise<void> {
  await env.SUB_CACHE.delete(buildAdminLoginKey(request, username));
}

export async function consumeSubscriptionRateLimit(
  request: Request,
  env: Env,
  token: string,
  target: SubscriptionTarget
): Promise<RateLimitDecision> {
  return consumeRateLimit(env.SUB_CACHE, buildSubscriptionKey(request, token, target), getSubscriptionPolicy(env));
}
