import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNodeFingerprint,
  normalizeImportedNodes,
  planNodeImport,
  planRemoteNodeSync
} from '../../apps/worker/src/node-source.ts';

function createNodeRecord(overrides = {}) {
  return {
    id: 'node_1',
    name: 'HK Edge 01',
    protocol: 'vless',
    server: 'hk.example.com',
    port: 443,
    sourceType: 'manual',
    enabled: true,
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    credentials: {
      uuid: '11111111-1111-1111-1111-111111111111'
    },
    params: {
      tls: true,
      network: 'ws'
    },
    ...overrides
  };
}

test('buildNodeFingerprint ignores name and enabled flags', () => {
  const left = buildNodeFingerprint({
    protocol: 'VLESS',
    server: 'HK.EXAMPLE.COM',
    port: 443,
    credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
    params: { network: 'ws', tls: true }
  });
  const right = buildNodeFingerprint({
    protocol: 'vless',
    server: 'hk.example.com',
    port: 443,
    credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
    params: { tls: true, network: 'ws' }
  });

  assert.equal(left, right);
});

test('normalizeImportedNodes deduplicates identical endpoint definitions', () => {
  const result = normalizeImportedNodes(
    [
      {
        name: 'First Name',
        protocol: 'vless',
        server: 'hk.example.com',
        port: 443,
        enabled: true,
        credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
        params: { tls: true }
      },
      {
        name: 'Last Name Wins',
        protocol: 'VLESS',
        server: 'HK.EXAMPLE.COM',
        port: 443,
        enabled: false,
        credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
        params: { tls: true }
      }
    ],
    'manual'
  );

  assert.equal(result.duplicateCount, 1);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].name, 'Last Name Wins');
  assert.equal(result.nodes[0].enabled, false);
  assert.equal(result.nodes[0].protocol, 'vless');
  assert.equal(result.nodes[0].server, 'hk.example.com');
});

test('planNodeImport separates created, updated and unchanged nodes', () => {
  const existingNode = createNodeRecord();
  const normalized = normalizeImportedNodes(
    [
      {
        name: 'HK Edge Renamed',
        protocol: 'vless',
        server: 'hk.example.com',
        port: 443,
        enabled: true,
        credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
        params: { tls: true, network: 'ws' }
      },
      {
        name: 'JP Edge 01',
        protocol: 'trojan',
        server: 'jp.example.com',
        port: 443,
        enabled: true,
        credentials: { password: 'secret' }
      }
    ],
    'manual'
  );

  const plan = planNodeImport([existingNode], normalized.nodes);

  assert.equal(plan.created.length, 1);
  assert.equal(plan.updated.length, 1);
  assert.equal(plan.unchanged.length, 0);
  assert.equal(plan.updated[0].current.id, existingNode.id);
  assert.equal(plan.updated[0].next.name, 'HK Edge Renamed');
  assert.equal(plan.created[0].name, 'JP Edge 01');
});

test('planRemoteNodeSync disables stale remote nodes and duplicate existing entries', () => {
  const existingNodes = [
    createNodeRecord({ id: 'node_remote_1', sourceType: 'remote', sourceId: 'https://example.com/nodes.json' }),
    createNodeRecord({
      id: 'node_remote_dup',
      name: 'HK Edge Duplicate',
      sourceType: 'remote',
      sourceId: 'https://example.com/nodes.json',
      createdAt: '2026-03-08T00:00:00.000Z'
    }),
    createNodeRecord({
      id: 'node_remote_stale',
      name: 'US Edge 01',
      protocol: 'trojan',
      server: 'us.example.com',
      sourceType: 'remote',
      sourceId: 'https://example.com/nodes.json',
      credentials: { password: 'legacy' },
      params: undefined
    })
  ];
  const normalized = normalizeImportedNodes(
    [
      {
        name: 'HK Edge 01 Updated',
        protocol: 'vless',
        server: 'hk.example.com',
        port: 443,
        enabled: true,
        credentials: { uuid: '11111111-1111-1111-1111-111111111111' },
        params: { tls: true, network: 'ws' }
      }
    ],
    'remote',
    'https://example.com/nodes.json'
  );

  const plan = planRemoteNodeSync(existingNodes, normalized.nodes);

  assert.equal(plan.created.length, 0);
  assert.equal(plan.updated.length, 1);
  assert.equal(plan.updated[0].current.id, 'node_remote_1');
  assert.equal(plan.unchanged.length, 0);
  assert.deepEqual(
    plan.stale.map((node) => node.id).sort(),
    ['node_remote_dup', 'node_remote_stale']
  );
});
