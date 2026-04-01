import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const { buildNodeChainSummaries } = await loadTsModule('apps/web/src/mihomo-topology.ts');

test('buildNodeChainSummaries expands group-level upstream into the final node chain', () => {
  const summaries = buildNodeChainSummaries(
    [
      {
        id: 'node-a',
        name: 'dmit-reality',
        protocol: 'vless',
        server: 'example.com',
        port: 443,
        sourceType: 'manual',
        enabled: true,
        createdAt: '',
        params: {}
      },
      {
        id: 'node-b',
        name: 'qqpw',
        protocol: 'ss',
        server: 'example.com',
        port: 443,
        sourceType: 'manual',
        enabled: true,
        createdAt: '',
        params: {
          upstreamProxy: '🇺🇸 美国中转'
        }
      }
    ],
    [
      {
        name: '🇺🇸 美国中转',
        type: 'select',
        proxies: ['dmit-reality']
      }
    ],
    []
  );

  assert.deepEqual(
    summaries.find((item) => item.nodeName === 'qqpw'),
    {
      nodeId: 'node-b',
      nodeName: 'qqpw',
      upstreamProxy: '🇺🇸 美国中转',
      chain: 'qqpw -> [group] 🇺🇸 美国中转 -> dmit-reality',
      issue: null
    }
  );
});
