import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  buildDuplicateNodeIdSet,
  buildNodeDuplicateGroups,
  filterNodeRecords
} = await loadTsModule('apps/web/src/node-management.ts');

function createNode(id, overrides = {}) {
  return {
    id,
    name: id,
    protocol: 'vless',
    server: `${id}.example.com`,
    port: 443,
    sourceType: 'manual',
    enabled: true,
    credentials: {
      uuid: `uuid-${id}`
    },
    params: {
      tls: true
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides
  };
}

test('node management groups exact duplicates by normalized fingerprint and keeps the best candidate', () => {
  const nodes = [
    createNode('node_manual_old', {
      name: 'HK Edge',
      server: 'hk.example.com',
      sourceType: 'manual',
      enabled: false,
      credentials: {
        uuid: 'dup-uuid'
      },
      params: {
        servername: 'hk.example.com',
        tls: true
      },
      updatedAt: '2026-03-01T00:00:00.000Z'
    }),
    createNode('node_remote_new', {
      name: 'HK Edge Remote',
      server: 'hk.example.com',
      sourceType: 'remote',
      enabled: true,
      credentials: {
        uuid: 'dup-uuid'
      },
      params: {
        tls: true,
        servername: 'hk.example.com'
      },
      updatedAt: '2026-04-01T00:00:00.000Z'
    }),
    createNode('node_unique', {
      name: 'JP Edge',
      server: 'jp.example.com'
    })
  ];

  const groups = buildNodeDuplicateGroups(nodes);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].keepNodeId, 'node_remote_new');
  assert.deepEqual(groups[0].deleteNodeIds, ['node_manual_old']);
  assert.deepEqual([...buildDuplicateNodeIdSet(groups)].sort(), ['node_manual_old', 'node_remote_new']);
});

test('node management filter matches search text, duplicate mode, and chain issue mode', () => {
  const nodes = [
    createNode('node_hk', {
      name: 'HK Edge',
      server: 'hk.example.com'
    }),
    createNode('node_remote', {
      name: 'Transit Relay',
      server: 'relay.example.com',
      sourceType: 'remote',
      enabled: false
    })
  ];
  const summariesById = new Map([
    [
      'node_hk',
      {
        nodeId: 'node_hk',
        nodeName: 'HK Edge',
        upstreamProxy: null,
        chain: 'HK Edge',
        issue: null
      }
    ],
    [
      'node_remote',
      {
        nodeId: 'node_remote',
        nodeName: 'Transit Relay',
        upstreamProxy: 'Transit Upstream',
        chain: 'Transit Relay -> Transit Upstream',
        issue: '缺少上游节点：Transit Upstream'
      }
    ]
  ]);
  const duplicateNodeIds = new Set(['node_remote']);

  assert.deepEqual(
    filterNodeRecords({
      nodes,
      summariesById,
      filterMode: 'duplicates',
      searchText: '',
      duplicateNodeIds
    }).map((node) => node.id),
    ['node_remote']
  );

  assert.deepEqual(
    filterNodeRecords({
      nodes,
      summariesById,
      filterMode: 'chain_issues',
      searchText: '',
      duplicateNodeIds: new Set()
    }).map((node) => node.id),
    ['node_remote']
  );

  assert.deepEqual(
    filterNodeRecords({
      nodes,
      summariesById,
      filterMode: 'all',
      searchText: 'transit upstream',
      duplicateNodeIds: new Set()
    }).map((node) => node.id),
    ['node_remote']
  );

  assert.deepEqual(
    filterNodeRecords({
      nodes,
      summariesById,
      filterMode: 'enabled',
      searchText: 'hk',
      duplicateNodeIds: new Set()
    }).map((node) => node.id),
    ['node_hk']
  );
});
