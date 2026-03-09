import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WEB_API_OPERATION_SIGNATURES } from '../apps/web/src/api-routes.js';

function getIndentation(rawLine) {
  return rawLine.match(/^ */)?.[0].length ?? 0;
}

function parseFlowArray(value) {
  const trimmed = value.trim();

  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }

  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
}

function readYamlArray(lines, startIndex, indent) {
  const line = lines[startIndex];
  const value = line.slice(line.indexOf(':') + 1).trim();
  const inline = parseFlowArray(value);

  if (inline) {
    return {
      value: inline,
      nextIndex: startIndex
    };
  }

  const items = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const currentIndent = getIndentation(rawLine);
    if (currentIndent <= indent) {
      break;
    }

    if (currentIndent === indent + 2 && trimmed.startsWith('- ')) {
      items.push(trimmed.slice(2).trim());
    }

    index += 1;
  }

  return {
    value: items,
    nextIndex: index - 1
  };
}

function loadContractSnapshot(filePath) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  const paths = {};
  let rootSecurity = [];
  let previewMetadataRequired = null;
  let inPathsSection = false;
  let inSchemasSection = false;
  let inPreviewMetadata = false;
  let currentPath = null;
  let currentMethod = null;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indentation = getIndentation(rawLine);

    if (indentation === 0) {
      inPathsSection = trimmed === 'paths:';
      inSchemasSection = false;
      inPreviewMetadata = false;
      currentPath = null;
      currentMethod = null;

      if (trimmed.startsWith('security:')) {
        const parsed = readYamlArray(lines, index, indentation);
        rootSecurity = parsed.value;
        index = parsed.nextIndex;
      }

      continue;
    }

    if (trimmed === 'components:' && indentation === 0) {
      continue;
    }

    if (trimmed === 'schemas:' && indentation === 2) {
      inSchemasSection = true;
      inPreviewMetadata = false;
      continue;
    }

    if (inSchemasSection && indentation === 4 && trimmed.endsWith(':')) {
      inPreviewMetadata = trimmed === 'PreviewMetadata:';
      continue;
    }

    if (inPreviewMetadata && indentation === 6 && trimmed.startsWith('required:')) {
      const parsed = readYamlArray(lines, index, indentation);
      previewMetadataRequired = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (!inPathsSection) {
      continue;
    }

    if (indentation === 2 && trimmed.startsWith('/') && trimmed.endsWith(':')) {
      currentPath = trimmed.slice(0, -1);
      currentMethod = null;
      paths[currentPath] ??= {};
      continue;
    }

    if (!currentPath) {
      continue;
    }

    if (indentation === 4 && /^(get|post|patch|delete|put|head|options):$/.test(trimmed)) {
      currentMethod = trimmed.slice(0, -1);
      paths[currentPath][currentMethod] = {};
      continue;
    }

    if (indentation <= 2) {
      currentPath = null;
      currentMethod = null;
      continue;
    }

    if (indentation <= 4) {
      currentMethod = null;
    }

    if (currentMethod && indentation === 6 && trimmed.startsWith('security:')) {
      const parsed = readYamlArray(lines, index, indentation);
      paths[currentPath][currentMethod].security = parsed.value;
      index = parsed.nextIndex;
    }
  }

  return {
    paths,
    rootSecurity,
    previewMetadataRequired
  };
}

function effectiveSecurity(operation, rootSecurity) {
  return operation?.security ?? rootSecurity ?? [];
}

const contract = loadContractSnapshot(new URL('../openapi.yaml', import.meta.url));
const paths = contract.paths;
const rootSecurity = contract.rootSecurity;
const documentedOperations = new Set(
  Object.entries(paths).flatMap(([pathName, methods]) =>
    Object.keys(methods ?? {}).map((method) => `${method.toUpperCase()} ${pathName}`)
  )
);

const requiredOperations = [
  'GET /health',
  'GET /api/setup/status',
  'POST /api/setup/bootstrap',
  'POST /api/admin/login',
  'GET /api/admin/me',
  'POST /api/admin/logout',
  'GET /api/users',
  'POST /api/users',
  'PATCH /api/users/{userId}',
  'POST /api/users/{userId}/reset-token',
  'GET /api/users/{userId}/nodes',
  'POST /api/users/{userId}/nodes',
  'GET /api/nodes',
  'POST /api/nodes',
  'POST /api/nodes/import',
  'POST /api/nodes/import/remote',
  'PATCH /api/nodes/{nodeId}',
  'DELETE /api/nodes/{nodeId}',
  'GET /api/templates',
  'POST /api/templates',
  'PATCH /api/templates/{templateId}',
  'POST /api/templates/{templateId}/set-default',
  'GET /api/rule-sources',
  'POST /api/rule-sources',
  'PATCH /api/rule-sources/{ruleSourceId}',
  'POST /api/rule-sources/{ruleSourceId}/sync',
  'GET /api/sync-logs',
  'GET /api/audit-logs',
  'POST /api/cache/rebuild',
  'GET /api/preview/{userId}/{target}',
  'GET /s/{token}/{target}'
];

for (const operation of requiredOperations) {
  assert.ok(documentedOperations.has(operation), `openapi should declare ${operation}`);
}

const publicOperations = [
  'GET /health',
  'GET /api/setup/status',
  'POST /api/setup/bootstrap',
  'POST /api/admin/login',
  'GET /s/{token}/{target}'
];

for (const operation of publicOperations) {
  const [method, pathName] = operation.split(' ');
  const operationSpec = paths[pathName]?.[method.toLowerCase()];
  assert.deepEqual(effectiveSecurity(operationSpec, rootSecurity), [], `${operation} should be public`);
}

for (const [pathName, methods] of Object.entries(paths)) {
  for (const [method, operationSpec] of Object.entries(methods ?? {})) {
    const operation = `${method.toUpperCase()} ${pathName}`;

    if (!pathName.startsWith('/api/') || publicOperations.includes(operation)) {
      continue;
    }

    const security = effectiveSecurity(operationSpec, rootSecurity);
    assert.ok(Array.isArray(security) && security.length > 0, `${operation} should require auth`);
  }
}

assert.deepEqual(
  contract.previewMetadataRequired,
  ['userId', 'nodeCount', 'ruleSetCount', 'templateName'],
  'PreviewMetadata required fields'
);
assert.ok(contract.previewMetadataRequired, 'PreviewMetadata schema should exist');

for (const operation of WEB_API_OPERATION_SIGNATURES) {
  assert.ok(
    documentedOperations.has(operation),
    `apps/web/src/api-routes.js should only declare documented routes: ${operation}`
  );
}

assert.ok(WEB_API_OPERATION_SIGNATURES.length > 0, 'apps/web/src/api-routes.js should not be empty');

console.log('OpenAPI contract checks passed.');
