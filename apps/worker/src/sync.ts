import type { JsonValue, RuleSourceFormat, RuleSourceRecord } from '@subforge/shared';
import type { Env } from './env';
import { invalidateAllUserCaches } from './cache';
import {
  getLatestRuleSnapshotBySourceId,
  insertRuleSnapshot,
  listEnabledRuleSources,
  recordRuleSourceSync
} from './repository';

export interface RuleSourceSyncDetails {
  sourceUrl: string;
  format: RuleSourceFormat;
  durationMs: number;
  upstreamStatus?: number;
  fetchedBytes?: number;
  ruleCount?: number;
  contentHash?: string;
  reason?: string;
}

export interface RuleSourceSyncResult {
  sourceId: string;
  sourceName: string;
  status: 'success' | 'failed' | 'skipped';
  message: string;
  changed: boolean;
  ruleCount: number;
  details?: RuleSourceSyncDetails;
}

class SyncFetchError extends Error {
  status: number | undefined;
  fetchedBytes: number | undefined;
  durationMs: number;

  constructor(message: string, input: { status?: number; fetchedBytes?: number; durationMs: number }) {
    super(message);
    this.name = 'SyncFetchError';
    this.status = input.status;
    this.fetchedBytes = input.fetchedBytes;
    this.durationMs = input.durationMs;
  }
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return toHex(digest);
}

async function fetchText(sourceUrl: string, timeoutMs: number): Promise<{
  text: string;
  status: number;
  durationMs: number;
  fetchedBytes: number;
}> {
  const controller = new AbortController();
  const start = Date.now();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'user-agent': 'SubForge/0.1.0'
      }
    });

    const text = (await response.text()).trim();
    const durationMs = Date.now() - start;
    const fetchedBytes = new TextEncoder().encode(text).byteLength;

    if (!response.ok) {
      throw new SyncFetchError(`upstream returned ${response.status}`, {
        status: response.status,
        fetchedBytes,
        durationMs
      });
    }

    return {
      text,
      status: response.status,
      durationMs,
      fetchedBytes
    };
  } finally {
    clearTimeout(timer);
  }
}

function stripLineComments(line: string): string {
  return line.replace(/\s+#.*$/, '').replace(/\s+\/\/.*$/, '').trim();
}

function looksLikeRule(value: string): boolean {
  return value.includes(',') || value.startsWith('MATCH') || value.startsWith('FINAL');
}

function dedupeRules(rules: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rule of rules) {
    const normalized = stripLineComments(rule);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeTextRules(content: string): string[] {
  return dedupeRules(
    content
      .split('\n')
      .map((line) => stripLineComments(line.trim()))
      .filter((line) => line && looksLikeRule(line))
  );
}

function normalizeYamlRules(content: string): string[] {
  const rules: string[] = [];
  let inRuleList = false;

  for (const rawLine of content.split('\n')) {
    const line = stripLineComments(rawLine.trim());

    if (!line || line === '---' || line === '...') {
      continue;
    }

    if (/^(payload|rules):\s*$/.test(line)) {
      inRuleList = true;
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) {
      inRuleList = false;
      continue;
    }

    if (line.startsWith('- ')) {
      const value = line.slice(2).trim();

      if (inRuleList || looksLikeRule(value)) {
        rules.push(value);
      }

      continue;
    }

    if (looksLikeRule(line)) {
      rules.push(line);
    }
  }

  return dedupeRules(rules);
}

function extractJsonRules(value: unknown, collector: string[]): void {
  if (typeof value === 'string') {
    const normalized = stripLineComments(value.trim());

    if (normalized && looksLikeRule(normalized)) {
      collector.push(normalized);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractJsonRules(item, collector);
    }

    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;

  for (const key of ['rule', 'value', 'payload', 'rules', 'data', 'items']) {
    if (key in record) {
      extractJsonRules(record[key], collector);
    }
  }
}

function normalizeJsonRules(content: string): string[] {
  const parsed = JSON.parse(content) as unknown;
  const rules: string[] = [];

  extractJsonRules(parsed, rules);

  if (rules.length === 0) {
    throw new Error('json rule source is not in a supported shape');
  }

  return dedupeRules(rules);
}

function normalizeRuleSourceContent(content: string, format: RuleSourceFormat): { normalizedContent: string; ruleCount: number } {
  const rules =
    format === 'json'
      ? normalizeJsonRules(content)
      : format === 'yaml'
        ? normalizeYamlRules(content)
        : normalizeTextRules(content);

  if (rules.length === 0) {
    throw new Error('no valid rules parsed from source');
  }

  return {
    normalizedContent: rules.join('\n'),
    ruleCount: rules.length
  };
}

function toDetailsRecord(details: RuleSourceSyncDetails): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined)
  ) as Record<string, JsonValue>;
}

export async function syncRuleSourceNow(env: Env, ruleSource: RuleSourceRecord): Promise<RuleSourceSyncResult> {
  const startedAt = Date.now();
  let upstream: Awaited<ReturnType<typeof fetchText>> | null = null;

  try {
    const timeoutMs = Number(env.SYNC_HTTP_TIMEOUT_MS || '10000');
    upstream = await fetchText(ruleSource.sourceUrl, timeoutMs);

    if (!upstream.text) {
      const details: RuleSourceSyncDetails = {
        sourceUrl: ruleSource.sourceUrl,
        format: ruleSource.format,
        durationMs: upstream.durationMs,
        upstreamStatus: upstream.status,
        fetchedBytes: upstream.fetchedBytes,
        reason: 'empty upstream content'
      };
      await recordRuleSourceSync(env.DB, ruleSource.id, 'failed', 'empty upstream content', toDetailsRecord(details));
      return {
        sourceId: ruleSource.id,
        sourceName: ruleSource.name,
        status: 'failed',
        message: 'empty upstream content',
        changed: false,
        ruleCount: 0,
        details
      };
    }

    const { normalizedContent, ruleCount } = normalizeRuleSourceContent(upstream.text, ruleSource.format);
    const contentHash = await sha256(normalizedContent);
    const latestSnapshot = await getLatestRuleSnapshotBySourceId(env.DB, ruleSource.id);
    const details: RuleSourceSyncDetails = {
      sourceUrl: ruleSource.sourceUrl,
      format: ruleSource.format,
      durationMs: Date.now() - startedAt,
      upstreamStatus: upstream.status,
      fetchedBytes: upstream.fetchedBytes,
      ruleCount,
      contentHash
    };

    if (latestSnapshot?.contentHash === contentHash) {
      const message = `content unchanged (${ruleCount} rules)`;
      await recordRuleSourceSync(env.DB, ruleSource.id, 'skipped', message, toDetailsRecord({ ...details, reason: 'content unchanged' }));
      return {
        sourceId: ruleSource.id,
        sourceName: ruleSource.name,
        status: 'skipped',
        message,
        changed: false,
        ruleCount,
        details: { ...details, reason: 'content unchanged' }
      };
    }

    await insertRuleSnapshot(env.DB, {
      ruleSourceId: ruleSource.id,
      contentHash,
      content: normalizedContent
    });
    const message = `snapshot updated (${ruleCount} rules)`;
    await recordRuleSourceSync(env.DB, ruleSource.id, 'success', message, toDetailsRecord(details));
    await invalidateAllUserCaches(env);

    return {
      sourceId: ruleSource.id,
      sourceName: ruleSource.name,
      status: 'success',
      message,
      changed: true,
      ruleCount,
      details
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed';
    const details: RuleSourceSyncDetails = {
      sourceUrl: ruleSource.sourceUrl,
      format: ruleSource.format,
      durationMs: error instanceof SyncFetchError ? error.durationMs : Date.now() - startedAt,
      ...(upstream ? { upstreamStatus: upstream.status, fetchedBytes: upstream.fetchedBytes } : {}),
      ...(!upstream && error instanceof SyncFetchError && error.status !== undefined
        ? { upstreamStatus: error.status }
        : {}),
      ...(!upstream && error instanceof SyncFetchError && error.fetchedBytes !== undefined
        ? { fetchedBytes: error.fetchedBytes }
        : {}),
      reason: message
    };
    await recordRuleSourceSync(env.DB, ruleSource.id, 'failed', message, toDetailsRecord(details));

    return {
      sourceId: ruleSource.id,
      sourceName: ruleSource.name,
      status: 'failed',
      message,
      changed: false,
      ruleCount: 0,
      details
    };
  }
}

export async function runEnabledRuleSourceSync(env: Env): Promise<RuleSourceSyncResult[]> {
  const sources = await listEnabledRuleSources(env.DB);
  const results: RuleSourceSyncResult[] = [];

  for (const source of sources) {
    results.push(await syncRuleSourceNow(env, source));
  }

  return results;
}
