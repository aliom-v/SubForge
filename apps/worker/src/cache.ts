import { buildPreviewCacheKey, buildSubscriptionCacheKey, type SubscriptionTarget } from '@subforge/shared';
import type { Env } from './env';
import { listUserCacheRefs, listUsersByNodeId } from './repository';

const allTargets: SubscriptionTarget[] = ['mihomo', 'singbox'];

export interface UserCacheRef {
  id: string;
  token: string;
}

function getTargets(targets?: SubscriptionTarget[]): SubscriptionTarget[] {
  return targets && targets.length > 0 ? targets : allTargets;
}

export async function invalidateUserCaches(
  env: Env,
  user: UserCacheRef,
  targets?: SubscriptionTarget[]
): Promise<void> {
  const activeTargets = getTargets(targets);
  const tasks: Promise<void>[] = [];

  for (const target of activeTargets) {
    tasks.push(env.SUB_CACHE.delete(buildSubscriptionCacheKey(target, user.token)));
    tasks.push(env.SUB_CACHE.delete(buildPreviewCacheKey(target, user.id)));
  }

  await Promise.all(tasks);
}

export async function invalidateUsersCaches(
  env: Env,
  users: UserCacheRef[],
  targets?: SubscriptionTarget[]
): Promise<void> {
  await Promise.all(users.map((user) => invalidateUserCaches(env, user, targets)));
}

export async function invalidateAllUserCaches(env: Env, targets?: SubscriptionTarget[]): Promise<void> {
  const users = await listUserCacheRefs(env.DB);
  await invalidateUsersCaches(env, users, targets);
}

export async function invalidateNodeAffectedCaches(
  env: Env,
  nodeId: string,
  targets?: SubscriptionTarget[]
): Promise<void> {
  const users = await listUsersByNodeId(env.DB, nodeId);
  await invalidateUsersCaches(env, users, targets);
}
