import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTsModule } from './helpers/load-ts-module.mjs';

const {
  normalizeManagedMihomoTemplateContent,
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
  assert.deepEqual(parsed.proxyProviders, []);

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

test('parseMihomoTemplateStructure exposes proxy-provider names', () => {
  const template = `proxy-providers:
  remote-us:
    type: http
    url: https://example.com/us.yaml
  remote-hk:
    type: http
    url: https://example.com/hk.yaml
proxies:
{{proxies}}
proxy-groups:
  - name: Auto
    type: select
    use:
      - remote-us
rules:
{{rules}}
`;
  const parsed = parseMihomoTemplateStructure(template);

  assert.deepEqual(parsed.proxyProviders, ['remote-us', 'remote-hk']);
  assert.equal(parsed.proxyGroups.length, 1);
});

test('normalizeManagedMihomoTemplateContent strips static proxies and keeps dynamic proxy slot', () => {
  const template = `proxies:
  - name: Legacy Node
    type: trojan
    server: legacy.example.com
    port: 443
    password: replace-me
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - Legacy Node
rules:
  - MATCH,DIRECT
`;
  const parsedBefore = parseMihomoTemplateStructure(template);
  const normalized = normalizeManagedMihomoTemplateContent(template);
  const parsedAfter = parseMihomoTemplateStructure(normalized);

  assert.equal(parsedBefore.staticProxies.length, 1);
  assert.equal(parsedAfter.useDynamicProxies, true);
  assert.equal(parsedAfter.staticProxies.length, 0);
  assert.match(normalized, /proxies:\n\{\{proxies\}\}/);
  assert.match(normalized, /proxy-groups:/);
  assert.match(normalized, /rules:/);
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
