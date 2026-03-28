import { useEffect, useState } from 'react';
import {
  parseMihomoTemplateStructure,
  parseSingboxTemplateStructure,
  updateMihomoTemplateStructure,
  updateSingboxTemplateStructure
} from '@subforge/core';
import type { SubscriptionTarget } from '@subforge/shared';

interface TemplateStructureAssistantProps {
  targetType: SubscriptionTarget;
  content: string;
  onContentChange: (value: string) => void;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
}

interface MihomoProxyGroupDraft {
  name: string;
  type: string;
  proxiesText: string;
  useText: string;
  url: string;
  interval: string;
  tolerance: string;
  strategy: string;
  lazy: boolean;
  extrasText: string;
}

const emptyMihomoProxyGroupDraft = (): MihomoProxyGroupDraft => ({
  name: '',
  type: 'select',
  proxiesText: '',
  useText: '',
  url: '',
  interval: '',
  tolerance: '',
  strategy: '',
  lazy: false,
  extrasText: ''
});

export function TemplateStructureAssistant(props: TemplateStructureAssistantProps): JSX.Element {
  return props.targetType === 'mihomo'
    ? <MihomoTemplateStructureAssistant {...props} />
    : <SingboxTemplateStructureAssistant {...props} />;
}

function MihomoTemplateStructureAssistant(props: TemplateStructureAssistantProps): JSX.Element {
  const [useDynamicProxies, setUseDynamicProxies] = useState(true);
  const [useDynamicProxyGroups, setUseDynamicProxyGroups] = useState(false);
  const [useDynamicRules, setUseDynamicRules] = useState(false);
  const [proxyGroups, setProxyGroups] = useState<MihomoProxyGroupDraft[]>([]);
  const [rulesText, setRulesText] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState('');

  useEffect(() => {
    reloadFromContent();
  }, [props.content]);

  function reloadFromContent(): void {
    try {
      const parsed = parseMihomoTemplateStructure(props.content);
      setUseDynamicProxies(parsed.useDynamicProxies);
      setUseDynamicProxyGroups(parsed.useDynamicProxyGroups);
      setUseDynamicRules(parsed.useDynamicRules);
      setProxyGroups(parsed.proxyGroups.map(createMihomoProxyGroupDraft));
      setRulesText(parsed.rules.join('\n'));
      setWarnings(parsed.warnings);
      setParseError('');
    } catch (caughtError) {
      setWarnings([]);
      setParseError(getErrorMessage(caughtError));
    }
  }

  function handleApply(): void {
    const builtProxyGroups: Array<Record<string, unknown>> = [];

    for (const [index, draft] of proxyGroups.entries()) {
      const parsed = buildMihomoProxyGroupRecord(draft, index);

      if (!parsed.ok) {
        props.onError(parsed.error);
        return;
      }

      builtProxyGroups.push(parsed.value);
    }

    try {
      const nextContent = updateMihomoTemplateStructure(props.content, {
        useDynamicProxies,
        useDynamicProxyGroups,
        useDynamicRules,
        proxyGroups: builtProxyGroups,
        rules: splitLines(rulesText)
      });
      props.onContentChange(nextContent);
      props.onMessage('已将 Mihomo 结构化更改写回模板内容');
    } catch (caughtError) {
      props.onError(getErrorMessage(caughtError));
    }
  }

  return (
    <div className="protocol-assistant full-span">
      <div className="assistant-header">
        <strong>模板结构助手</strong>
        <span className="assistant-badge">mihomo</span>
      </div>
      <p className="helper">
        这里专门维护 `proxy-groups` 和 `rules`，原始 YAML 里其他字段会尽量原样保留；如果你先修改了下方原始文本，可以点“从模板刷新”重新同步。
      </p>
      {parseError ? <p className="helper">{parseError}</p> : null}
      {warnings.length > 0 ? (
        <div className="inline-meta">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="assistant-grid">
        <label className="checkbox-row assistant-checkbox">
          <input
            type="checkbox"
            checked={useDynamicProxies}
            onChange={(event) => setUseDynamicProxies(event.target.checked)}
          />
          <span>保留动态节点 <code>{'{{proxies}}'}</code></span>
        </label>
        <label className="checkbox-row assistant-checkbox">
          <input
            type="checkbox"
            checked={useDynamicProxyGroups}
            onChange={(event) => setUseDynamicProxyGroups(event.target.checked)}
          />
          <span>使用动态代理组 <code>{'{{proxy_groups}}'}</code></span>
        </label>
        <label className="checkbox-row assistant-checkbox">
          <input
            type="checkbox"
            checked={useDynamicRules}
            onChange={(event) => setUseDynamicRules(event.target.checked)}
          />
          <span>使用动态规则 <code>{'{{rules}}'}</code></span>
        </label>
      </div>

      {!useDynamicProxyGroups ? (
        <div className="template-structure-section">
          <div className="assistant-header">
            <strong>Proxy Groups</strong>
            <div className="inline-actions">
              <button type="button" className="secondary" onClick={() => setProxyGroups((current) => [...current, emptyMihomoProxyGroupDraft()])}>
                新增代理组
              </button>
            </div>
          </div>
          {proxyGroups.length === 0 ? <p className="helper">当前没有自定义 proxy-group；可以新增，也可以切回动态占位符。</p> : null}
          <div className="template-structure-list">
            {proxyGroups.map((group, index) => (
              <div className="template-structure-card" key={`${group.name}-${index}`}>
                <div className="assistant-header">
                  <strong>{group.name.trim() || `代理组 ${index + 1}`}</strong>
                  <div className="inline-actions">
                    <button type="button" className="secondary" onClick={() => setProxyGroups((current) => moveItem(current, index, -1))} disabled={index === 0}>上移</button>
                    <button type="button" className="secondary" onClick={() => setProxyGroups((current) => moveItem(current, index, 1))} disabled={index === proxyGroups.length - 1}>下移</button>
                    <button type="button" className="danger" onClick={() => setProxyGroups((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
                  </div>
                </div>
                <div className="assistant-grid">
                  <AssistantField label="名称">
                    <input
                      value={group.name}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { name: event.target.value }))}
                      placeholder="Auto"
                    />
                  </AssistantField>
                  <AssistantField label="类型">
                    <input
                      value={group.type}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { type: event.target.value }))}
                      placeholder="select / url-test / fallback"
                    />
                  </AssistantField>
                  <AssistantField label="URL">
                    <input
                      value={group.url}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { url: event.target.value }))}
                      placeholder="https://www.gstatic.com/generate_204"
                    />
                  </AssistantField>
                  <AssistantField label="Interval">
                    <input
                      value={group.interval}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { interval: event.target.value }))}
                      placeholder="300"
                    />
                  </AssistantField>
                  <AssistantField label="Tolerance">
                    <input
                      value={group.tolerance}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { tolerance: event.target.value }))}
                      placeholder="50"
                    />
                  </AssistantField>
                  <AssistantField label="Strategy">
                    <input
                      value={group.strategy}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { strategy: event.target.value }))}
                      placeholder="round-robin"
                    />
                  </AssistantField>
                  <label className="checkbox-row assistant-checkbox">
                    <input
                      type="checkbox"
                      checked={group.lazy}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { lazy: event.target.checked }))}
                    />
                    <span>lazy</span>
                  </label>
                  <AssistantField label="Proxies" full>
                    <textarea
                      rows={4}
                      value={group.proxiesText}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { proxiesText: event.target.value }))}
                      placeholder={'Proxy A\nProxy B'}
                    />
                  </AssistantField>
                  <AssistantField label="Use" full>
                    <textarea
                      rows={3}
                      value={group.useText}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { useText: event.target.value }))}
                      placeholder={'Provider A\nProvider B'}
                    />
                  </AssistantField>
                  <AssistantField label="额外字段 JSON" full>
                    <textarea
                      rows={5}
                      value={group.extrasText}
                      onChange={(event) => setProxyGroups((current) => updateItem(current, index, { extrasText: event.target.value }))}
                      placeholder={'{\n  "hidden": true\n}'}
                    />
                  </AssistantField>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="helper">当前会继续使用 <code>{'{{proxy_groups}}'}</code> 动态占位符生成默认代理组。</p>
      )}

      {!useDynamicRules ? (
        <AssistantField label="Rules" full>
          <textarea
            rows={8}
            value={rulesText}
            onChange={(event) => setRulesText(event.target.value)}
            placeholder={'DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,Auto'}
          />
        </AssistantField>
      ) : (
        <p className="helper">当前会继续使用 <code>{'{{rules}}'}</code> 动态占位符注入规则集合。</p>
      )}

      <div className="inline-actions">
        <button type="button" className="secondary" onClick={reloadFromContent}>从模板刷新</button>
        <button type="button" onClick={handleApply} disabled={Boolean(parseError)}>应用到模板</button>
      </div>
    </div>
  );
}

function SingboxTemplateStructureAssistant(props: TemplateStructureAssistantProps): JSX.Element {
  const [useDynamicOutbounds, setUseDynamicOutbounds] = useState(true);
  const [useDynamicRules, setUseDynamicRules] = useState(false);
  const [staticOutboundTexts, setStaticOutboundTexts] = useState<string[]>([]);
  const [routeRuleTexts, setRouteRuleTexts] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState('');

  useEffect(() => {
    reloadFromContent();
  }, [props.content]);

  function reloadFromContent(): void {
    try {
      const parsed = parseSingboxTemplateStructure(props.content);
      setUseDynamicOutbounds(parsed.useDynamicOutbounds);
      setUseDynamicRules(parsed.useDynamicRules);
      setStaticOutboundTexts(parsed.staticOutbounds.map((item) => JSON.stringify(item, null, 2)));
      setRouteRuleTexts(parsed.routeRules.map((item) => JSON.stringify(item, null, 2)));
      setWarnings(parsed.warnings);
      setParseError('');
    } catch (caughtError) {
      setWarnings([]);
      setParseError(getErrorMessage(caughtError));
    }
  }

  function handleApply(): void {
    const staticOutbounds: Array<Record<string, unknown>> = [];
    const routeRules: Array<Record<string, unknown>> = [];

    for (const [index, text] of staticOutboundTexts.entries()) {
      const parsed = parseJsonObjectText(text, `第 ${index + 1} 个静态 outbound`);

      if (!parsed.ok) {
        props.onError(parsed.error);
        return;
      }

      staticOutbounds.push(parsed.value);
    }

    for (const [index, text] of routeRuleTexts.entries()) {
      const parsed = parseJsonObjectText(text, `第 ${index + 1} 个 route.rule`);

      if (!parsed.ok) {
        props.onError(parsed.error);
        return;
      }

      routeRules.push(parsed.value);
    }

    try {
      const nextContent = updateSingboxTemplateStructure(props.content, {
        useDynamicOutbounds,
        useDynamicRules,
        staticOutbounds,
        routeRules
      });
      props.onContentChange(nextContent);
      props.onMessage('已将 sing-box 结构化更改写回模板内容');
    } catch (caughtError) {
      props.onError(getErrorMessage(caughtError));
    }
  }

  return (
    <div className="protocol-assistant full-span">
      <div className="assistant-header">
        <strong>模板结构助手</strong>
        <span className="assistant-badge">sing-box</span>
      </div>
      <p className="helper">
        这里专门维护 `outbounds` 和 `route.rules`；动态节点输出与静态结构可以分开维护，适合把导入后的 sing-box 模板继续产品化。
      </p>
      {parseError ? <p className="helper">{parseError}</p> : null}
      {warnings.length > 0 ? (
        <div className="inline-meta">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="assistant-grid">
        <label className="checkbox-row assistant-checkbox">
          <input
            type="checkbox"
            checked={useDynamicOutbounds}
            onChange={(event) => setUseDynamicOutbounds(event.target.checked)}
          />
          <span>保留动态节点 outbounds</span>
        </label>
        <label className="checkbox-row assistant-checkbox">
          <input
            type="checkbox"
            checked={useDynamicRules}
            onChange={(event) => setUseDynamicRules(event.target.checked)}
          />
          <span>在 route.rules 中追加动态规则</span>
        </label>
      </div>

      <div className="template-structure-section">
        <div className="assistant-header">
          <strong>静态 Outbounds</strong>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setStaticOutboundTexts((current) => [...current, JSON.stringify({ tag: '', type: 'direct' }, null, 2)])}
            >
              新增静态 outbound
            </button>
          </div>
        </div>
        {staticOutboundTexts.length === 0 ? <p className="helper">当前没有静态 outbound；如果你只需要动态节点，可以保持为空。</p> : null}
        <div className="template-structure-list">
          {staticOutboundTexts.map((text, index) => (
            <JsonDraftCard
              key={`outbound-${index}`}
              title={summarizeSingboxOutbound(text, index)}
              value={text}
              onChange={(value) => setStaticOutboundTexts((current) => replaceStringItem(current, index, value))}
              onMoveUp={() => setStaticOutboundTexts((current) => moveItem(current, index, -1))}
              onMoveDown={() => setStaticOutboundTexts((current) => moveItem(current, index, 1))}
              onDelete={() => setStaticOutboundTexts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              disableMoveUp={index === 0}
              disableMoveDown={index === staticOutboundTexts.length - 1}
            />
          ))}
        </div>
      </div>

      <div className="template-structure-section">
        <div className="assistant-header">
          <strong>Route Rules</strong>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setRouteRuleTexts((current) => [...current, JSON.stringify({ outbound: 'direct', ip_is_private: true }, null, 2)])}
            >
              新增 route.rule
            </button>
          </div>
        </div>
        {routeRuleTexts.length === 0 ? <p className="helper">当前没有静态 route.rule；如果你只想引用同步规则，可以勾选动态规则占位符。</p> : null}
        <div className="template-structure-list">
          {routeRuleTexts.map((text, index) => (
            <JsonDraftCard
              key={`rule-${index}`}
              title={summarizeSingboxRouteRule(text, index)}
              value={text}
              onChange={(value) => setRouteRuleTexts((current) => replaceStringItem(current, index, value))}
              onMoveUp={() => setRouteRuleTexts((current) => moveItem(current, index, -1))}
              onMoveDown={() => setRouteRuleTexts((current) => moveItem(current, index, 1))}
              onDelete={() => setRouteRuleTexts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              disableMoveUp={index === 0}
              disableMoveDown={index === routeRuleTexts.length - 1}
            />
          ))}
        </div>
      </div>

      <div className="inline-actions">
        <button type="button" className="secondary" onClick={reloadFromContent}>从模板刷新</button>
        <button type="button" onClick={handleApply} disabled={Boolean(parseError)}>应用到模板</button>
      </div>
    </div>
  );
}

function JsonDraftCard(props: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  disableMoveUp: boolean;
  disableMoveDown: boolean;
}): JSX.Element {
  return (
    <div className="template-structure-card">
      <div className="assistant-header">
        <strong>{props.title}</strong>
        <div className="inline-actions">
          <button type="button" className="secondary" onClick={props.onMoveUp} disabled={props.disableMoveUp}>上移</button>
          <button type="button" className="secondary" onClick={props.onMoveDown} disabled={props.disableMoveDown}>下移</button>
          <button type="button" className="danger" onClick={props.onDelete}>删除</button>
        </div>
      </div>
      <textarea rows={8} value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </div>
  );
}

function AssistantField(props: { label: string; children: JSX.Element; full?: boolean }): JSX.Element {
  return (
    <label className={props.full ? 'full-span' : undefined}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function createMihomoProxyGroupDraft(record: Record<string, unknown>): MihomoProxyGroupDraft {
  const next = { ...record };
  const name = readString(next.name);
  const type = readString(next.type);
  const url = readString(next.url);
  const interval = readScalarText(next.interval);
  const tolerance = readScalarText(next.tolerance);
  const strategy = readString(next.strategy);
  const proxiesText = readStringList(next.proxies).join('\n');
  const useText = readStringList(next.use).join('\n');
  const lazy = typeof next.lazy === 'boolean' ? next.lazy : false;

  delete next.name;
  delete next.type;
  delete next.url;
  delete next.interval;
  delete next.tolerance;
  delete next.strategy;
  delete next.proxies;
  delete next.use;
  delete next.lazy;

  return {
    name,
    type,
    proxiesText,
    useText,
    url,
    interval,
    tolerance,
    strategy,
    lazy,
    extrasText: Object.keys(next).length > 0 ? JSON.stringify(next, null, 2) : ''
  };
}

function buildMihomoProxyGroupRecord(
  draft: MihomoProxyGroupDraft,
  index: number
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!draft.name.trim()) {
    return { ok: false, error: `第 ${index + 1} 个 proxy-group 缺少名称` };
  }

  if (!draft.type.trim()) {
    return { ok: false, error: `第 ${index + 1} 个 proxy-group 缺少类型` };
  }

  const extras = parseOptionalJsonObjectText(draft.extrasText, `第 ${index + 1} 个 proxy-group 的额外字段`);

  if (!extras.ok) {
    return extras;
  }

  const record: Record<string, unknown> = {
    name: draft.name.trim(),
    type: draft.type.trim()
  };

  const proxies = splitLines(draft.proxiesText);
  const providers = splitLines(draft.useText);

  if (proxies.length > 0) {
    record.proxies = proxies;
  }

  if (providers.length > 0) {
    record.use = providers;
  }

  if (draft.url.trim()) {
    record.url = draft.url.trim();
  }

  if (draft.interval.trim()) {
    record.interval = normalizeScalarValue(draft.interval.trim());
  }

  if (draft.tolerance.trim()) {
    record.tolerance = normalizeScalarValue(draft.tolerance.trim());
  }

  if (draft.strategy.trim()) {
    record.strategy = draft.strategy.trim();
  }

  if (draft.lazy) {
    record.lazy = true;
  }

  return {
    ok: true,
    value: {
      ...record,
      ...extras.value
    }
  };
}

function parseJsonObjectText(
  value: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isObjectRecord(parsed)) {
      return { ok: false, error: `${label} 必须是 JSON 对象` };
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: `${label} 不是合法 JSON` };
  }
}

function parseOptionalJsonObjectText(
  value: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!value.trim()) {
    return { ok: true, value: {} };
  }

  return parseJsonObjectText(value, label);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readScalarText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeScalarValue(value: string): string | number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && `${numberValue}` === value ? numberValue : value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(caughtError: unknown): string {
  if (caughtError instanceof Error && caughtError.message) {
    return caughtError.message;
  }

  return '发生了未识别的错误';
}

function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const targetIndex = index + delta;

  if (targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [current] = next.splice(index, 1);

  if (current === undefined) {
    return items;
  }

  next.splice(targetIndex, 0, current);
  return next;
}

function updateItem<T extends object>(items: T[], index: number, patch: Partial<T>): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

function replaceStringItem(items: string[], index: number, value: string): string[] {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item));
}

function summarizeSingboxOutbound(value: string, index: number): string {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isObjectRecord(parsed)) {
      return `静态 outbound ${index + 1}`;
    }

    const tag = typeof parsed.tag === 'string' && parsed.tag.trim() ? parsed.tag.trim() : `静态 outbound ${index + 1}`;
    const type = typeof parsed.type === 'string' && parsed.type.trim() ? parsed.type.trim() : 'unknown';
    return `${tag} / ${type}`;
  } catch {
    return `静态 outbound ${index + 1}`;
  }
}

function summarizeSingboxRouteRule(value: string, index: number): string {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (!isObjectRecord(parsed)) {
      return `Route Rule ${index + 1}`;
    }

    const type = typeof parsed.type === 'string' && parsed.type.trim() ? parsed.type.trim() : 'rule';
    const outbound = typeof parsed.outbound === 'string' && parsed.outbound.trim() ? parsed.outbound.trim() : '-';
    return `${type} / ${outbound}`;
  } catch {
    return `Route Rule ${index + 1}`;
  }
}
