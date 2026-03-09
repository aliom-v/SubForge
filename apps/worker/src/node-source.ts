import type { JsonValue, NodeRecord, NodeSourceType } from '@subforge/shared';

export interface ImportedNodeInput {
  name: string;
  protocol: string;
  server: string;
  port: number;
  enabled?: boolean;
  credentials?: Record<string, JsonValue>;
  params?: Record<string, JsonValue>;
}

export interface NormalizedImportedNode {
  name: string;
  protocol: string;
  server: string;
  port: number;
  enabled: boolean;
  sourceType: NodeSourceType;
  sourceId: string | null;
  credentials?: Record<string, JsonValue>;
  params?: Record<string, JsonValue>;
}

interface NodeLookupEntry {
  primary: NodeRecord;
  duplicates: NodeRecord[];
}

export interface NodeImportPlan {
  created: NormalizedImportedNode[];
  updated: Array<{ current: NodeRecord; next: NormalizedImportedNode }>;
  unchanged: Array<{ current: NodeRecord; next: NormalizedImportedNode }>;
}

export interface RemoteNodeSyncPlan extends NodeImportPlan {
  stale: NodeRecord[];
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  return value;
}

function normalizeJsonRecord(
  value: Record<string, JsonValue> | Record<string, unknown> | undefined
): Record<string, JsonValue> | undefined {
  if (!value) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue as JsonValue)])
  );
}

function normalizeSourceId(sourceId?: string | null): string | null {
  return sourceId ?? null;
}

function getNormalizedIdentity(node: Pick<NormalizedImportedNode, 'protocol' | 'server' | 'port' | 'credentials' | 'params'>) {
  return {
    protocol: node.protocol.trim().toLowerCase(),
    server: node.server.trim().toLowerCase(),
    port: node.port,
    credentials: normalizeJsonRecord(node.credentials),
    params: normalizeJsonRecord(node.params)
  };
}

function getNormalizedContent(
  node: Pick<NodeRecord, 'name' | 'protocol' | 'server' | 'port' | 'enabled' | 'sourceType' | 'sourceId' | 'credentials' | 'params'>
    | Pick<NormalizedImportedNode, 'name' | 'protocol' | 'server' | 'port' | 'enabled' | 'sourceType' | 'sourceId' | 'credentials' | 'params'>
) {
  return {
    name: node.name.trim(),
    enabled: node.enabled,
    sourceType: node.sourceType,
    sourceId: normalizeSourceId(node.sourceId),
    ...getNormalizedIdentity(node)
  };
}

function buildNodeLookup(existingNodes: NodeRecord[]): Map<string, NodeLookupEntry> {
  const lookup = new Map<string, NodeLookupEntry>();

  for (const node of existingNodes) {
    const fingerprint = buildNodeFingerprint(node);
    const entry = lookup.get(fingerprint);

    if (!entry) {
      lookup.set(fingerprint, {
        primary: node,
        duplicates: []
      });
      continue;
    }

    entry.duplicates.push(node);
  }

  return lookup;
}

export function buildNodeFingerprint(
  node: Pick<NormalizedImportedNode, 'protocol' | 'server' | 'port' | 'credentials' | 'params'>
): string {
  return JSON.stringify(getNormalizedIdentity(node));
}

export function isSameNodeContent(
  current: Pick<NodeRecord, 'name' | 'protocol' | 'server' | 'port' | 'enabled' | 'sourceType' | 'sourceId' | 'credentials' | 'params'>,
  next: Pick<NormalizedImportedNode, 'name' | 'protocol' | 'server' | 'port' | 'enabled' | 'sourceType' | 'sourceId' | 'credentials' | 'params'>
): boolean {
  return JSON.stringify(getNormalizedContent(current)) === JSON.stringify(getNormalizedContent(next));
}

export function normalizeImportedNodes(
  nodes: ImportedNodeInput[],
  sourceType: NodeSourceType,
  sourceId?: string | null
): { nodes: NormalizedImportedNode[]; duplicateCount: number } {
  const dedupedNodes = new Map<string, NormalizedImportedNode>();
  let duplicateCount = 0;

  for (const node of nodes) {
    const normalizedNode: NormalizedImportedNode = {
      name: node.name.trim(),
      protocol: node.protocol.trim().toLowerCase(),
      server: node.server.trim().toLowerCase(),
      port: node.port,
      enabled: node.enabled ?? true,
      sourceType,
      sourceId: normalizeSourceId(sourceId),
      ...(node.credentials ? { credentials: normalizeJsonRecord(node.credentials) } : {}),
      ...(node.params ? { params: normalizeJsonRecord(node.params) } : {})
    };

    const fingerprint = buildNodeFingerprint(normalizedNode);

    if (dedupedNodes.has(fingerprint)) {
      duplicateCount += 1;
    }

    dedupedNodes.set(fingerprint, normalizedNode);
  }

  return {
    nodes: [...dedupedNodes.values()],
    duplicateCount
  };
}

export function planNodeImport(existingNodes: NodeRecord[], importedNodes: NormalizedImportedNode[]): NodeImportPlan {
  const lookup = buildNodeLookup(existingNodes);
  const created: NormalizedImportedNode[] = [];
  const updated: Array<{ current: NodeRecord; next: NormalizedImportedNode }> = [];
  const unchanged: Array<{ current: NodeRecord; next: NormalizedImportedNode }> = [];

  for (const next of importedNodes) {
    const current = lookup.get(buildNodeFingerprint(next))?.primary;

    if (!current) {
      created.push(next);
      continue;
    }

    if (isSameNodeContent(current, next)) {
      unchanged.push({ current, next });
      continue;
    }

    updated.push({ current, next });
  }

  return {
    created,
    updated,
    unchanged
  };
}

export function planRemoteNodeSync(existingNodes: NodeRecord[], importedNodes: NormalizedImportedNode[]): RemoteNodeSyncPlan {
  const lookup = buildNodeLookup(existingNodes);
  const created: NormalizedImportedNode[] = [];
  const updated: Array<{ current: NodeRecord; next: NormalizedImportedNode }> = [];
  const unchanged: Array<{ current: NodeRecord; next: NormalizedImportedNode }> = [];
  const matchedNodeIds = new Set<string>();
  const stale = [...lookup.values()].flatMap((entry) => entry.duplicates);

  for (const next of importedNodes) {
    const entry = lookup.get(buildNodeFingerprint(next));
    const current = entry?.primary;

    if (!current) {
      created.push(next);
      continue;
    }

    matchedNodeIds.add(current.id);

    if (isSameNodeContent(current, next)) {
      unchanged.push({ current, next });
      continue;
    }

    updated.push({ current, next });
  }

  for (const node of existingNodes) {
    if (!matchedNodeIds.has(node.id) && !stale.some((staleNode) => staleNode.id === node.id)) {
      stale.push(node);
    }
  }

  return {
    created,
    updated,
    unchanged,
    stale
  };
}
