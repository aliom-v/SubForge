import type { JsonValue, RuleSourceFormat, RuleSourceRecord } from '@subforge/shared';
import type { Env } from './env';
import { invalidateAllUserCaches } from './cache';
import {
  getLatestRuleSnapshotBySourceId,
  insertRuleSnapshot,
  listEnabledRuleSources,
  recordRuleSourceSync
} from './repository';
import { buildRuleSourceSyncDiagnostics, type RuleSourceSyncDetails } from './rule-sync-diagnostics';

interface FetchTextResult {
  text: string;
  status: number;
  durationMs: number;
  fetchedBytes: number;
  contentType?: string;
}

interface ParsedRuleCandidatesResult {
  candidates: string[];
  rawLineCount: number;
  ignoredLineCount: number;
  sourceShape?: string;
}

interface RuleNormalizationResult {
  normalizedContent: string;
  ruleCount: number;
  details: Pick<
    RuleSourceSyncDetails,
    'parser' | 'sourceShape' | 'rawLineCount' | 'extractedRuleCount' | 'duplicateRuleCount' | 'ignoredLineCount'
  >;
}

class SyncFailure extends Error {
  readonly detailPatch: Partial<RuleSourceSyncDetails>;

  constructor(detailPatch: Partial<RuleSourceSyncDetails>, message: string) {
    super(message);
    this.name = 'SyncFailure';
    this.detailPatch = detailPatch;
    Object.setPrototypeOf(this, SyncFailure.prototype);
  }
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

export class SyncFetchError extends Error {
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

export async function fetchText(sourceUrl: string, timeoutMs: number): Promise<FetchTextResult> {
  const controller = new AbortController();
  const start = Date.now();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(sourceUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'user-agent': 'SubForge/0.1.0'
        }
      });
    } catch (error) {
      const durationMs = Date.now() - start;

      if (controller.signal.aborted && controller.signal.reason === 'timeout') {
        throw new SyncFailure(
          {
            stage: 'fetch',
            severity: 'error',
            errorCode: 'FETCH_TIMEOUT',
            durationMs,
            reason: `upstream request timed out after ${timeoutMs}ms`,
            ...buildRuleSourceSyncDiagnostics({
              errorCode: 'FETCH_TIMEOUT',
              format: 'text'
            })
          },
          `upstream request timed out after ${timeoutMs}ms`
        );
      }

      const reason = error instanceof Error ? error.message : 'upstream request failed';
      throw new SyncFailure(
        {
          stage: 'fetch',
          severity: 'error',
          errorCode: 'FETCH_NETWORK_ERROR',
          durationMs,
          reason,
          ...buildRuleSourceSyncDiagnostics({
            errorCode: 'FETCH_NETWORK_ERROR',
            format: 'text'
          })
        },
        reason
      );
    }

    const contentType = response.headers.get('content-type') ?? undefined;

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
      fetchedBytes,
      contentType
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SyncFetchError('upstream request timed out', {
        durationMs: Date.now() - start
      });
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimWrappedQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function stripLineComments(line: string): string {
  return line.replace(/\s+#.*$/, '').replace(/\s+\/\/.*$/, '').trim();
}

function looksLikeRule(value: string): boolean {
  return value.includes(',') || value.startsWith('MATCH') || value.startsWith('FINAL');
}

function collectRuleStrings(raw: string): { rules: string[]; rawLineCount: number; ignoredLineCount: number } {
  const rules: string[] = [];
  let ignoredLineCount = 0;
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const normalized = stripLineComments(trimWrappedQuotes(line.trim()));

    if (!normalized) {
      continue;
    }

    if (looksLikeRule(normalized)) {
      rules.push(normalized);
    } else {
      ignoredLineCount += 1;
    }
  }

  return {
    rules,
    rawLineCount: lines.length,
    ignoredLineCount
  };
}

function dedupeRules(rules: string[]): { rules: string[]; duplicateRuleCount: number } {
  const seen = new Set<string>();
  const result: string[] = [];
  let duplicateRuleCount = 0;

  for (const rule of rules) {
    const normalized = stripLineComments(rule);

    if (!normalized || seen.has(normalized)) {
      if (normalized) {
        duplicateRuleCount += 1;
      }
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return {
    rules: result,
    duplicateRuleCount
  };
}

function normalizeTextRules(content: string): ParsedRuleCandidatesResult {
  const collected = collectRuleStrings(content);

  return {
    candidates: collected.rules,
    rawLineCount: collected.rawLineCount,
    ignoredLineCount: collected.ignoredLineCount,
    sourceShape: 'plain-text'
  };
}

function parseInlineRuleArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    const rules: string[] = [];

    for (const item of parsed) {
      if (typeof item !== 'string') {
        continue;
      }

      rules.push(...collectRuleStrings(item).rules);
    }

    return rules;
  } catch {
    return [];
  }
}

function normalizeYamlRules(content: string): ParsedRuleCandidatesResult {
  const candidates: string[] = [];
  let inRuleList = false;
  let inRuleBlock = false;
  let ignoredLineCount = 0;
  let sourceShape = 'yaml-lines';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripLineComments(rawLine.trim());

    if (!line || line === '---' || line === '...') {
      continue;
    }

    const inlineListMatch = line.match(/^(payload|rules):\s*(\[.*\])\s*$/);

    if (inlineListMatch) {
      const [, listKey, inlineListRaw] = inlineListMatch;

      if (!listKey || !inlineListRaw) {
        ignoredLineCount += 1;
        continue;
      }

      const inlineRules = parseInlineRuleArray(inlineListRaw);

      if (inlineRules.length > 0) {
        sourceShape = `yaml-${listKey}-inline`;
        candidates.push(...inlineRules);
      } else {
        ignoredLineCount += 1;
      }

      inRuleList = false;
      inRuleBlock = false;
      continue;
    }

    if (/^(payload|rules):\s*[|>]-?\s*$/.test(line)) {
      sourceShape = 'yaml-block';
      inRuleList = false;
      inRuleBlock = true;
      continue;
    }

    if (/^(payload|rules):\s*$/.test(line)) {
      sourceShape = 'yaml-list';
      inRuleList = true;
      inRuleBlock = false;
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) {
      inRuleList = false;
      inRuleBlock = false;
      continue;
    }

    if (line.startsWith('- ')) {
      const value = trimWrappedQuotes(line.slice(2).trim());

      if (inRuleList || looksLikeRule(value)) {
        candidates.push(...collectRuleStrings(value).rules);
      } else {
        ignoredLineCount += 1;
      }

      continue;
    }

    if (inRuleBlock) {
      const collected = collectRuleStrings(line);

      if (collected.rules.length > 0) {
        candidates.push(...collected.rules);
      } else {
        ignoredLineCount += 1;
      }

      continue;
    }

    if (looksLikeRule(line)) {
      candidates.push(line);
    }
  }

  return {
    candidates,
    rawLineCount: content.split(/\r?\n/).length,
    ignoredLineCount,
    sourceShape
  };
}

function pickRecordString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return trimWrappedQuotes(value.trim());
    }
  }

  return null;
}

function buildStructuredJsonRule(record: Record<string, unknown>): string | null {
  const type = pickRecordString(record, ['type', 'ruleType']);
  const value = pickRecordString(record, ['value', 'domain', 'cidr', 'ipCidr', 'ip_cidr', 'processName', 'process_name']);

  if (!type || !value) {
    return null;
  }

  const target = pickRecordString(record, ['policy', 'action', 'outbound', 'proxy', 'policyName', 'policy_name']);
  const candidate = [type.toUpperCase(), value, target].filter(Boolean).join(',');

  return looksLikeRule(candidate) ? candidate : null;
}

function detectJsonSourceShape(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (isObjectRecord(value)) {
    const keys = Object.keys(value);
    return keys.length > 0 ? `object:${keys.slice(0, 4).join('|')}` : 'object';
  }

  return typeof value;
}

function extractJsonRules(
  value: unknown,
  collector: string[],
  stats: { rawLineCount: number; ignoredLineCount: number }
): void {
  if (typeof value === 'string') {
    const collected = collectRuleStrings(value);

    collector.push(...collected.rules);
    stats.rawLineCount += collected.rawLineCount;
    stats.ignoredLineCount += collected.ignoredLineCount;

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractJsonRules(item, collector, stats);
    }

    return;
  }

  if (!isObjectRecord(value)) {
    return;
  }

  const record = value;
  const structuredRule = buildStructuredJsonRule(record);

  if (structuredRule) {
    collector.push(structuredRule);
  }

  for (const key of ['rule', 'value', 'payload', 'rules', 'data', 'items', 'entries', 'values']) {
    if (key in record) {
      extractJsonRules(record[key], collector, stats);
    }
  }
}

function normalizeJsonRules(content: string): ParsedRuleCandidatesResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new SyncFailure(
      {
        stage: 'parse',
        severity: 'error',
        errorCode: 'INVALID_JSON',
        parser: 'json',
        sourceShape: 'invalid-json',
        ...buildRuleSourceSyncDiagnostics({
          errorCode: 'INVALID_JSON',
          format: 'json',
          sourceShape: 'invalid-json',
          content
        })
      },
      'json rule source is not valid JSON'
    );
  }

  const rules: string[] = [];
  const stats = {
    rawLineCount: 0,
    ignoredLineCount: 0
  };
  const sourceShape = detectJsonSourceShape(parsed);

  extractJsonRules(parsed, rules, stats);

  if (rules.length === 0) {
    throw new SyncFailure(
      {
        stage: 'parse',
        severity: 'error',
        errorCode: 'UNSUPPORTED_JSON_SHAPE',
        parser: 'json',
        sourceShape,
        rawLineCount: stats.rawLineCount,
        ignoredLineCount: stats.ignoredLineCount,
        ...buildRuleSourceSyncDiagnostics({
          errorCode: 'UNSUPPORTED_JSON_SHAPE',
          format: 'json',
          sourceShape,
          content
        })
      },
      'json rule source is not in a supported shape'
    );
  }

  return {
    candidates: rules,
    rawLineCount: stats.rawLineCount,
    ignoredLineCount: stats.ignoredLineCount,
    sourceShape
  };
}

function normalizeRuleSourceContent(content: string, format: RuleSourceFormat): RuleNormalizationResult {
  const parsed =
    format === 'json'
      ? normalizeJsonRules(content)
      : format === 'yaml'
        ? normalizeYamlRules(content)
        : normalizeTextRules(content);

  const { rules, duplicateRuleCount } = dedupeRules(parsed.candidates);

  if (rules.length === 0) {
    throw new SyncFailure(
      {
        stage: 'parse',
        severity: 'error',
        errorCode: 'NO_VALID_RULES',
        parser: format,
        sourceShape: parsed.sourceShape,
        rawLineCount: parsed.rawLineCount,
        extractedRuleCount: parsed.candidates.length,
        duplicateRuleCount,
        ignoredLineCount: parsed.ignoredLineCount,
        ...buildRuleSourceSyncDiagnostics({
          errorCode: 'NO_VALID_RULES',
          format,
          sourceShape: parsed.sourceShape,
          content
        })
      },
      'no valid rules parsed from source'
    );
  }

  return {
    normalizedContent: rules.join('\n'),
    ruleCount: rules.length,
    details: {
      parser: format,
      sourceShape: parsed.sourceShape,
      rawLineCount: parsed.rawLineCount,
      extractedRuleCount: parsed.candidates.length,
      duplicateRuleCount,
      ignoredLineCount: parsed.ignoredLineCount
    }
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
        stage: 'fetch',
        severity: 'error',
        errorCode: 'EMPTY_UPSTREAM_CONTENT',
        upstreamStatus: upstream.status,
        fetchedBytes: upstream.fetchedBytes,
        contentType: upstream.contentType,
        reason: 'empty upstream content',
        ...buildRuleSourceSyncDiagnostics({
          errorCode: 'EMPTY_UPSTREAM_CONTENT',
          format: ruleSource.format
        })
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

    const { normalizedContent, ruleCount, details: normalizationDetails } = normalizeRuleSourceContent(
      upstream.text,
      ruleSource.format
    );
    const contentHash = await sha256(normalizedContent);
    const latestSnapshot = await getLatestRuleSnapshotBySourceId(env.DB, ruleSource.id);
    const details: RuleSourceSyncDetails = {
      sourceUrl: ruleSource.sourceUrl,
      format: ruleSource.format,
      durationMs: Date.now() - startedAt,
      stage: 'compare',
      severity: 'info',
      ...normalizationDetails,
      upstreamStatus: upstream.status,
      fetchedBytes: upstream.fetchedBytes,
      contentType: upstream.contentType,
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
    const detailPatch = error instanceof SyncFailure ? error.detailPatch : undefined;
    const fetchError = error instanceof SyncFetchError ? error : null;
    const inferredErrorCode =
      detailPatch?.errorCode ??
      (fetchError?.status !== undefined
        ? 'UPSTREAM_HTTP_ERROR'
        : fetchError?.message.includes('timed out')
          ? 'FETCH_TIMEOUT'
          : fetchError
            ? 'FETCH_NETWORK_ERROR'
            : undefined);
    const details: RuleSourceSyncDetails = {
      sourceUrl: ruleSource.sourceUrl,
      format: ruleSource.format,
      durationMs: detailPatch?.durationMs ?? Date.now() - startedAt,
      parser: ruleSource.format,
      severity: 'error',
      ...buildRuleSourceSyncDiagnostics({
        errorCode: inferredErrorCode,
        format: ruleSource.format,
        upstreamStatus: detailPatch?.upstreamStatus ?? fetchError?.status,
        sourceShape: detailPatch?.sourceShape
      }),
      ...(upstream ? { upstreamStatus: upstream.status, fetchedBytes: upstream.fetchedBytes, contentType: upstream.contentType } : {}),
      ...(!upstream && fetchError?.status !== undefined ? { upstreamStatus: fetchError.status } : {}),
      ...(!upstream && fetchError?.fetchedBytes !== undefined ? { fetchedBytes: fetchError.fetchedBytes } : {}),
      ...detailPatch,
      reason: detailPatch?.reason ?? message
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
