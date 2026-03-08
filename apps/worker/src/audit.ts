const SENSITIVE_KEY_PARTS = ['token', 'password', 'secret', 'authorization'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function sanitizeAuditValue(key: string | null, value: unknown): unknown {
  if (key && isSensitiveKey(key) && typeof value !== 'boolean') {
    return '[REDACTED]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(null, item));
  }

  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeAuditValue(entryKey, entryValue)]));
  }

  return value;
}

export function sanitizeAuditPayload(payload?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!payload) {
    return undefined;
  }

  return sanitizeAuditValue(null, payload) as Record<string, unknown>;
}
