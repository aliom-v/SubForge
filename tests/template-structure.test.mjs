import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  parseMihomoTemplateStructure,
  parseSingboxTemplateStructure,
  updateMihomoTemplateStructure,
  updateSingboxTemplateStructure
} = await loadTsModule('packages/core/src/template-structure.ts');

test('updateMihomoTemplateStructure rewrites proxy-groups and rules while preserving dynamic proxies slot', () => {
  const template = 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}\n';
  const parsed = parseMihomoTemplateStructure(template);

  assert.equal(parsed.useDynamicProxies, true);
  assert.equal(parsed.useDynamicProxyGroups, true);
  assert.equal(parsed.useDynamicRules, true);

  const next = updateMihomoTemplateStructure(template, {
    useDynamicProxies: true,
    useDynamicProxyGroups: false,
    useDynamicRules: false,
    proxyGroups: [
      {
        name: 'Auto',
        type: 'select',
        proxies: ['HK Relay', 'US Relay']
      }
    ],
    rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,Auto']
  });

  assert.match(next, /proxies:\n\{\{proxies\}\}/);
  assert.match(next, /proxy-groups:\n\s+- name: Auto/);
  assert.match(next, /type: select/);
  assert.match(next, /- HK Relay/);
  assert.match(next, /rules:\n\s+- DOMAIN-SUFFIX,example\.com,DIRECT/);
  assert.doesNotMatch(next, /\{\{proxy_groups\}\}/);
  assert.doesNotMatch(next, /\{\{rules\}\}/);
});

test('updateSingboxTemplateStructure can combine static blocks with dynamic placeholders', () => {
  const template = `{
  "outbounds": [
{{outbound_items}}
  ],
  "route": {
    "rules": {{rules}}
  }
}`;
  const parsed = parseSingboxTemplateStructure(template);

  assert.equal(parsed.useDynamicOutbounds, true);
  assert.equal(parsed.useDynamicRules, true);

  const next = updateSingboxTemplateStructure(template, {
    useDynamicOutbounds: true,
    useDynamicRules: true,
    staticOutbounds: [
      {
        tag: 'direct',
        type: 'direct'
      }
    ],
    routeRules: [
      {
        outbound: 'direct',
        ip_is_private: true
      }
    ]
  });

  assert.match(next, /"tag": "direct"/);
  assert.match(next, /\{\{outbound_items_with_leading_comma\}\}/);
  assert.match(next, /"ip_is_private": true/);
  assert.match(next, /\{\{rules_with_leading_comma\}\}/);
});
