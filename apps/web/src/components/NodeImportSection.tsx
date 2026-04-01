import { useState } from 'react';

import type { RemoteSubscriptionSourceRecord } from '@subforge/shared';

import type { ImportMode, RemoteSubscriptionSourceForm } from '../app-types';
import type { NodeImportPreviewPayload } from '../api';
import type { RemoteSyncNodeChainDiagnostics } from '../remote-sync-diagnostics';
import { getRemoteSyncNodeChainDiagnostics } from '../remote-sync-diagnostics';
import { getRemoteSyncDetailEntries, getRemoteSyncIssueCount } from '../remote-sync-details';
import { summarizeNodeMetadataParts } from '../node-metadata';
import type { ImportedConfigPayload, ImportedNodePayload } from '../node-import';
import { Field, ResourceTable } from './ui';

const importModeOptions: Array<{ value: ImportMode; label: string; description: string }> = [
  { value: 'text', label: '节点文本', description: '分享链接 / Base64 / JSON' },
  { value: 'remote', label: '订阅 URL', description: '抓取或保存自动同步源' },
  { value: 'config', label: '完整配置', description: 'Mihomo YAML / sing-box JSON' }
];

const fullConfigImportPlaceholder = `# Mihomo / Clash YAML
proxies:
  - name: HK Relay
    type: vless
    server: hk.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    tls: true
    dialer-proxy: Transit Node
proxy-groups:
  - name: Auto
    type: select
    proxies:
      - HK Relay
rules:
  - MATCH,DIRECT`;

function formatNodeImportContentEncoding(value: 'base64_text' | 'plain_text'): string {
  return value === 'base64_text' ? 'Base64 文本' : '明文文本';
}

function renderRemoteSourceResult(source: RemoteSubscriptionSourceRecord): JSX.Element {
  const detailEntries = getRemoteSyncDetailEntries(source);
  const nodeChainDiagnostics = getRemoteSyncNodeChainDiagnostics(source);
  const issueCount = getRemoteSyncIssueCount(source);

  return (
    <div className="table-cell-stack">
      <span>{source.lastSyncMessage ?? '-'}</span>
      {detailEntries.length > 0 || nodeChainDiagnostics ? (
        <details className="inline-details">
          <summary>详情{issueCount > 0 ? `（${issueCount}）` : ''}</summary>
          <div className="inline-details-body">
            {detailEntries.length > 0 ? (
              <div className="inline-detail-grid">
                {detailEntries.map((entry) => (
                  <div className="table-cell-stack" key={`${source.id}-${entry.label}`}>
                    <span className="table-subtle">{entry.label}</span>
                    <span>{entry.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {nodeChainDiagnostics ? (
              <div className="inline-issue-list">
                {nodeChainDiagnostics.issues.map((issue) => (
                  <div className="result-card" key={`${source.id}:${issue.nodeId}:${issue.kind}:${issue.reference ?? ''}`}>
                    <strong>{issue.nodeName}</strong>
                    <span>{issue.message}</span>
                    {issue.reference ? <span className="table-subtle">引用 {issue.reference}</span> : null}
                    {issue.chain ? <span className="table-subtle">链路 {issue.chain}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function NodeImportSection(props: {
  loading: boolean;
  nodeImportText: string;
  onNodeImportTextChange: (value: string) => void;
  parsedNodeImport: {
    nodes: ImportedNodePayload[];
    errors: string[];
    lineCount: number;
    contentEncoding: 'base64_text' | 'plain_text';
  };
  summarizedParsedNodeImportErrors: string[];
  onImportShareLinks: () => void;
  nodeImportSourceUrl: string;
  onNodeImportSourceUrlChange: (value: string) => void;
  remoteSubscriptionSourceForm: RemoteSubscriptionSourceForm;
  onRemoteSubscriptionSourceFormChange: (value: RemoteSubscriptionSourceForm) => void;
  remoteNodeImportPreview: NodeImportPreviewPayload | null;
  summarizedRemoteNodeImportErrors: string[];
  onImportRemoteUrlNodes: () => void;
  onSaveRemoteSubscriptionSource: () => void;
  effectiveRemoteSyncSourceName: string | null;
  effectiveRemoteSyncStatus: string | null;
  effectiveRemoteSyncAt: string | null;
  effectiveRemoteSyncMessage: string | null;
  remoteSubscriptionSyncResult:
    | {
        importedCount: number;
        createdCount: number;
        updatedCount: number;
        disabledCount: number;
      }
    | null;
  latestPersistedRemoteFailureCount: number | null;
  remoteSyncNodeChainDiagnostics: RemoteSyncNodeChainDiagnostics | null;
  remoteSubscriptionSources: RemoteSubscriptionSourceRecord[];
  onSyncSavedRemoteSubscriptionSource: (source: RemoteSubscriptionSourceRecord) => void;
  onToggleRemoteSubscriptionSource: (source: RemoteSubscriptionSourceRecord) => void;
  onDeleteRemoteSubscriptionTask: (source: RemoteSubscriptionSourceRecord) => void;
  configImportText: string;
  onConfigImportTextChange: (value: string) => void;
  parsedConfigImport: ImportedConfigPayload | null;
  onImportConfig: () => void;
}): JSX.Element {
  const [activeImportMode, setActiveImportMode] = useState<ImportMode>('text');

  return (
    <article className="panel full-width">
      <div className="panel-header">
        <div>
          <h2>导入节点</h2>
          <p className="helper">把 3 种导入方式收敛到一个入口：节点文本、订阅 URL、完整配置。</p>
        </div>
        <div className="section-tabs" role="tablist" aria-label="导入方式">
          {importModeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`tab-button${activeImportMode === option.value ? ' active' : ''}`}
              aria-pressed={activeImportMode === option.value}
              onClick={() => setActiveImportMode(option.value)}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </div>

      {activeImportMode === 'text' ? (
        <div className="form-grid">
          <Field label="分享链接 / Base64 / 节点 JSON" full>
            <textarea
              value={props.nodeImportText}
              onChange={(event) => props.onNodeImportTextChange(event.target.value)}
              rows={10}
              placeholder={[
                'vless://uuid@host:443?security=tls&type=ws&sni=sub.example.com&path=%2Fws#HK%20VLESS',
                'trojan://password@host:443?sni=sub.example.com#JP%20Trojan',
                'vmess://eyJhZGQiOiJ2bWVzcy5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsImFpZCI6IjAiLCJuZXQiOiJ3cyIsInRscyI6InRscyIsInBzIjoiVkdNZXNzIn0=',
                'ss://YWVzLTI1Ni1nY206cGFzc3cwcmQ=@ss.example.com:8388#SS%20Node',
                'ssr://c3NyLmV4YW1wbGUuY29tOjQ0MzphdXRoX2FlczEyOF9tZDU6YWVzLTI1Ni1jZmI6dGxzMS4yX3RpY2tldF9hdXRoOmNtVndiR0ZqWlMxbg==?remarks=U1NSJTIwTm9kZQ',
                'tuic://11111111-1111-1111-1111-111111111111:replace-me@tuic.example.com:443?sni=sub.example.com&congestion_control=bbr#TUIC%20Node',
                'hysteria2://password@hy2.example.com:443?sni=sub.example.com&obfs=salamander&obfs-password=replace-me#HY2%20Node'
              ].join('\n')}
            />
          </Field>
          <p className="helper full-span">适合直接粘贴节点文本；完整 Mihomo / sing-box 配置更适合切到“完整配置”。</p>
          {props.parsedNodeImport.lineCount > 0 ? (
            <p className="helper full-span">
              当前识别内容：{formatNodeImportContentEncoding(props.parsedNodeImport.contentEncoding)}，有效行 {props.parsedNodeImport.lineCount}
            </p>
          ) : null}
          <div className="inline-actions full-span">
            <button type="button" disabled={props.loading || props.parsedNodeImport.nodes.length === 0} onClick={props.onImportShareLinks}>
              导入节点 {props.parsedNodeImport.nodes.length}
            </button>
          </div>
          {props.summarizedParsedNodeImportErrors.length > 0 ? (
            <div className="import-errors full-span">
              <strong>解析错误</strong>
              <ul className="overview-list">
                {props.summarizedParsedNodeImportErrors.map((errorText) => <li key={errorText}>{errorText}</li>)}
              </ul>
            </div>
          ) : null}
          {props.parsedNodeImport.nodes.length > 0 ? (
            <details className="disclosure full-span">
              <summary>查看识别结果（{props.parsedNodeImport.nodes.length}）</summary>
              <div className="disclosure-body">
                <ResourceTable
                  columns={['名称', '协议', '地址', '端口', '元数据']}
                  rows={props.parsedNodeImport.nodes.map((node) => [
                    node.name,
                    node.protocol,
                    node.server,
                    node.port,
                    summarizeNodeMetadataParts(node.credentials, node.params)
                  ])}
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {activeImportMode === 'remote' ? (
        <div className="form-grid">
          <Field label="订阅 URL">
            <input
              value={props.nodeImportSourceUrl}
              onChange={(event) => props.onNodeImportSourceUrlChange(event.target.value)}
              placeholder="https://example.com/subscription.txt"
            />
          </Field>
          <Field label="自动同步源名称（可选）">
            <input
              value={props.remoteSubscriptionSourceForm.name}
              onChange={(event) =>
                props.onRemoteSubscriptionSourceFormChange({
                  ...props.remoteSubscriptionSourceForm,
                  name: event.target.value
                })
              }
              placeholder="默认使用域名 / 路径生成"
            />
          </Field>
          <p className="helper full-span">这里分成两条路径：抓取一次导入，或者保存成自动同步源。</p>
          <div className="inline-actions full-span">
            <button type="button" disabled={props.loading || !props.nodeImportSourceUrl.trim()} onClick={props.onImportRemoteUrlNodes}>
              抓取并导入节点
            </button>
            <button type="button" className="secondary" disabled={props.loading || !props.nodeImportSourceUrl.trim()} onClick={props.onSaveRemoteSubscriptionSource}>
              保存为自动同步源
            </button>
          </div>
          {props.remoteNodeImportPreview ? (
            <>
              <div className="metadata-grid full-span">
                <div className="result-card">
                  <strong>抓取摘要</strong>
                  <span>HTTP {props.remoteNodeImportPreview.upstreamStatus}</span>
                  <span>耗时 {props.remoteNodeImportPreview.durationMs} ms</span>
                  <span>体积 {props.remoteNodeImportPreview.fetchedBytes} bytes</span>
                  <span>内容 {formatNodeImportContentEncoding(props.remoteNodeImportPreview.contentEncoding)}</span>
                  <span>有效行 {props.remoteNodeImportPreview.lineCount}</span>
                </div>
              </div>
              {props.summarizedRemoteNodeImportErrors.length > 0 ? (
                <div className="import-errors full-span">
                  <strong>解析错误</strong>
                  <ul className="overview-list">
                    {props.summarizedRemoteNodeImportErrors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                  </ul>
                </div>
              ) : null}
              {props.remoteNodeImportPreview.nodes.length > 0 ? (
                <details className="disclosure full-span">
                  <summary>查看识别结果（{props.remoteNodeImportPreview.nodes.length}）</summary>
                  <div className="disclosure-body">
                    <ResourceTable
                      columns={['名称', '协议', '地址', '端口', '元数据']}
                      rows={props.remoteNodeImportPreview.nodes.map((node) => [
                        node.name,
                        node.protocol,
                        node.server,
                        node.port,
                        summarizeNodeMetadataParts(node.credentials, node.params)
                      ])}
                    />
                  </div>
                </details>
              ) : (
                <p className="helper full-span">
                  当前没有解析出可导入节点。请检查远程内容是否确实包含分享链接、`proxies` / `outbounds` 或节点数组。
                </p>
              )}
            </>
          ) : null}
          {props.effectiveRemoteSyncSourceName && props.effectiveRemoteSyncStatus ? (
            <div className="metadata-grid full-span">
              <div className="result-card">
                <strong>最近一次自动同步</strong>
                <span>{props.effectiveRemoteSyncSourceName}</span>
                <span>状态 {props.effectiveRemoteSyncStatus}</span>
                {props.effectiveRemoteSyncAt ? <span>时间 {props.effectiveRemoteSyncAt}</span> : null}
                {props.effectiveRemoteSyncMessage ? <span>{props.effectiveRemoteSyncMessage}</span> : null}
                {props.remoteSubscriptionSyncResult ? (
                  <>
                    <span>节点 {props.remoteSubscriptionSyncResult.importedCount}</span>
                    <span>
                      变更 {props.remoteSubscriptionSyncResult.createdCount} / {props.remoteSubscriptionSyncResult.updatedCount} /{' '}
                      {props.remoteSubscriptionSyncResult.disabledCount}
                    </span>
                  </>
                ) : props.latestPersistedRemoteFailureCount !== null ? (
                  <span>失败次数 {props.latestPersistedRemoteFailureCount}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {props.remoteSyncNodeChainDiagnostics ? (
            <details className="disclosure full-span">
              <summary>查看链式代理校验详情（{props.remoteSyncNodeChainDiagnostics.issueCount}）</summary>
              <div className="disclosure-body">
                <div className="metadata-grid">
                  {props.remoteSyncNodeChainDiagnostics.issues.map((issue) => (
                    <div className="result-card" key={`${issue.nodeId}:${issue.kind}:${issue.reference ?? ''}`}>
                      <strong>{issue.nodeName}</strong>
                      <span>类型 {issue.kind}</span>
                      {issue.reference ? <span>引用 {issue.reference}</span> : null}
                      {issue.upstreamProxy ? <span>上游 {issue.upstreamProxy}</span> : null}
                      {issue.chain ? <span>链路 {issue.chain}</span> : null}
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ) : null}
          <details className="disclosure full-span">
            <summary>已保存的自动同步源（{props.remoteSubscriptionSources.length}）</summary>
            <div className="disclosure-body">
              {props.remoteSubscriptionSources.length > 0 ? (
                <ResourceTable
                  columns={['同步源', '上游 URL', '状态', '最近同步', '最近结果', '失败次数', '操作']}
                  rows={props.remoteSubscriptionSources.map((source) => [
                    source.name,
                    source.sourceUrl,
                    `${source.enabled ? 'enabled' : 'paused'} / ${source.lastSyncStatus ?? 'never'}`,
                    source.lastSyncAt ?? 'never',
                    renderRemoteSourceResult(source),
                    source.failureCount,
                    <div className="inline-actions" key={source.id}>
                      <button type="button" className="secondary" onClick={() => props.onSyncSavedRemoteSubscriptionSource(source)}>
                        立即同步
                      </button>
                      <button type="button" className="secondary" onClick={() => props.onToggleRemoteSubscriptionSource(source)}>
                        {source.enabled ? '暂停' : '启用'}
                      </button>
                      <button type="button" className="danger" onClick={() => props.onDeleteRemoteSubscriptionTask(source)}>
                        删除
                      </button>
                    </div>
                  ])}
                />
              ) : (
                <p className="helper">当前还没有自动同步源。保存后，后续 Cron 会继续拉取并更新这组节点。</p>
              )}
            </div>
          </details>
        </div>
      ) : null}

      {activeImportMode === 'config' ? (
        <div className="form-grid">
          <Field label="Mihomo / Clash YAML 或 sing-box JSON" full>
            <textarea
              value={props.configImportText}
              onChange={(event) => props.onConfigImportTextChange(event.target.value)}
              rows={10}
              placeholder={fullConfigImportPlaceholder}
            />
          </Field>
          <p className="helper full-span">会提取节点，并把配置里的关键输出结构写入自动托管模板骨架。</p>
          {props.configImportText.trim() && !props.parsedConfigImport ? (
            <p className="helper full-span">当前还没有识别为可导入的完整配置。请确认内容是完整的 Clash / Mihomo YAML，或 sing-box JSON。</p>
          ) : null}
          {props.parsedConfigImport ? (
            <>
              <div className="inline-actions full-span">
                <button type="button" disabled={props.loading || props.parsedConfigImport.nodes.length === 0} onClick={props.onImportConfig}>
                  导入配置
                </button>
              </div>
              <div className="metadata-grid full-span">
                <div className="result-card">
                  <strong>导入摘要</strong>
                  <span>格式：{props.parsedConfigImport.format}</span>
                  <span>目标：{props.parsedConfigImport.targetType}</span>
                  <span>节点：{props.parsedConfigImport.nodes.length}</span>
                </div>
                <div className="result-card">
                  <strong>导入诊断</strong>
                  <span>警告：{props.parsedConfigImport.warnings.length}</span>
                  <span>节点解析错误：{props.parsedConfigImport.errors.length}</span>
                  <span>链式代理：已自动读取 `dialer-proxy` / `detour` 为 `params.upstreamProxy`</span>
                </div>
              </div>
              {props.parsedConfigImport.warnings.length > 0 ? (
                <div className="result-card full-span">
                  <strong>导入警告</strong>
                  <ul className="overview-list">
                    {props.parsedConfigImport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              ) : null}
              {props.parsedConfigImport.errors.length > 0 ? (
                <div className="import-errors full-span">
                  <strong>节点解析错误</strong>
                  <ul className="overview-list">
                    {props.parsedConfigImport.errors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                  </ul>
                </div>
              ) : null}
              {props.parsedConfigImport.nodes.length > 0 ? (
                <details className="disclosure full-span">
                  <summary>查看识别节点（{props.parsedConfigImport.nodes.length}）</summary>
                  <div className="disclosure-body">
                    <ResourceTable
                      columns={['名称', '协议', '地址', '端口', '元数据']}
                      rows={props.parsedConfigImport.nodes.map((node) => [
                        node.name,
                        node.protocol,
                        node.server,
                        node.port,
                        summarizeNodeMetadataParts(node.credentials, node.params)
                      ])}
                    />
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
