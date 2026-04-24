import type { SubscriptionTarget } from '@subforge/shared';

import type {
  HostedSubscriptionDiagnostics,
  HostedSubscriptionResult,
  HostedSubscriptionSyncStatus
} from '../hosted-state';
import { getHostedSyncStatusLabel } from '../workflow-feedback';

export function HostedSubscriptionSection(props: {
  loading: boolean;
  enabledNodeCount: number;
  autoHostedUserName: string | null;
  hostedSubscriptionResult: HostedSubscriptionResult | null;
  hostedSubscriptionDiagnostics: HostedSubscriptionDiagnostics | null;
  hostedSubscriptionSyncStatus: HostedSubscriptionSyncStatus;
  enabledNodeWarnings: string[];
  onGenerate: () => void;
  onResetToken: () => void;
  onCopyHostedUrl: (url: string, target: SubscriptionTarget) => void;
}): JSX.Element {
  const generateButtonLabel =
    props.hostedSubscriptionSyncStatus.kind === 'out_of_sync'
      ? '重新绑定并刷新托管 URL'
      : '使用当前启用节点生成托管 URL';
  const currentHostedOutputNodeCount = props.hostedSubscriptionResult?.nodeCount ?? 0;

  return (
    <article className="panel full-width">
      <div className="panel-header">
        <div>
          <h2>统一生成托管订阅</h2>
          <p className="helper">所有导入和编辑都收敛到这里，按当前启用节点刷新托管 URL。</p>
        </div>
        <div className="inline-meta">
          <span>启用节点 {props.enabledNodeCount}</span>
          <span>托管状态 {getHostedSyncStatusLabel(props.hostedSubscriptionSyncStatus)}</span>
          {props.hostedSubscriptionDiagnostics ? <span>当前绑定 {props.hostedSubscriptionDiagnostics.boundNodeCount}</span> : null}
          {props.hostedSubscriptionResult ? <span>当前输出 {props.hostedSubscriptionResult.nodeCount}</span> : null}
        </div>
      </div>
      <p className="helper">{props.hostedSubscriptionSyncStatus.detail}</p>
      <p className="helper">公开订阅不会复用管理员登录态；若链接泄漏，直接重置当前托管链接即可。</p>
      <div className="inline-actions">
        <button type="button" disabled={props.loading || props.enabledNodeCount === 0} onClick={props.onGenerate}>
          {generateButtonLabel}
        </button>
        <button type="button" className="secondary" disabled={props.loading || !props.autoHostedUserName} onClick={props.onResetToken}>
          重置当前托管链接
        </button>
        <span>托管身份：{props.autoHostedUserName ?? '首次生成时自动创建'}</span>
      </div>
      {props.enabledNodeWarnings.length > 0 ? (
        <div className="import-errors top-gap">
          <strong>当前启用节点风险提示</strong>
          <span>这些问题不会阻止生成，但很可能导致客户端导入后节点不可用。</span>
          <ul className="overview-list">
            {props.enabledNodeWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
      {props.hostedSubscriptionResult ? (
        <div className="metadata-grid top-gap">
          {props.hostedSubscriptionResult.targets.map((target) => (
            <div className="result-card" key={target.target}>
              <strong>{target.target} 订阅 URL</strong>
              <a className="result-link" href={target.url} target="_blank" rel="noreferrer">
                {target.url}
              </a>
              <span>
                {target.ok
                  ? `输出检查通过${target.previewNodeCount != null ? `，预览 ${target.previewNodeCount} 个节点` : ''}`
                  : '输出检查失败'}
              </span>
              {target.ok && target.templateName ? <span>模板：{target.templateName}</span> : null}
              <span>{target.detail}</span>
              <div className="inline-actions">
                <button type="button" className="secondary" onClick={() => props.onCopyHostedUrl(target.url, target.target)}>
                  复制 URL
                </button>
                <a className="button-link" href={target.url} target="_blank" rel="noreferrer">
                  打开
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {props.hostedSubscriptionResult ? (
        <details className="disclosure top-gap">
          <summary>查看托管诊断（{props.hostedSubscriptionResult.targets.length} 个目标）</summary>
          <div className="disclosure-body">
            <p className="helper">
              当前状态：{props.hostedSubscriptionResult.sourceLabel}
              {props.hostedSubscriptionDiagnostics
                ? `，当前托管绑定 ${props.hostedSubscriptionDiagnostics.boundNodeCount} 个节点，当前会输出 ${currentHostedOutputNodeCount} 个节点。`
                : `，当前会输出 ${currentHostedOutputNodeCount} 个节点。`}
            </p>
            {props.hostedSubscriptionDiagnostics ? (
              <div className="metadata-grid">
                <div className="result-card">
                  <strong>当前启用节点</strong>
                  <span>{props.hostedSubscriptionDiagnostics.enabledNodeCount} 个</span>
                  <span>这是你刚调整后的候选集合。</span>
                </div>
                <div className="result-card">
                  <strong>当前托管绑定</strong>
                  <span>{props.hostedSubscriptionDiagnostics.boundNodeCount} 个</span>
                  <span>这是当前保存到托管身份上的绑定集合。</span>
                </div>
                <div className="result-card">
                  <strong>当前会输出</strong>
                  <span>{props.hostedSubscriptionDiagnostics.effectiveBoundNodeCount} 个</span>
                  <span>只有已绑定且仍处于启用状态的节点才会真正进入订阅。</span>
                </div>
              </div>
            ) : null}
            {props.hostedSubscriptionDiagnostics?.bindingError ? (
              <div className="import-errors">
                <strong>托管绑定读取失败</strong>
                <span>{props.hostedSubscriptionDiagnostics.bindingError}</span>
              </div>
            ) : null}
            {props.hostedSubscriptionDiagnostics?.hasIssues ? (
              <div className="metadata-grid">
                {props.hostedSubscriptionDiagnostics.enabledOnlyNodes.length > 0 ? (
                  <div className="result-card full-span">
                    <strong>已启用但尚未进入当前托管绑定</strong>
                    <span>这些节点现在在页面里是启用状态，但客户端还拿不到。</span>
                    <ul className="overview-list">
                      {props.hostedSubscriptionDiagnostics.enabledOnlyNodes.map((node) => (
                        <li key={node.id}>{node.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {props.hostedSubscriptionDiagnostics.disabledBoundNodes.length > 0 ||
                props.hostedSubscriptionDiagnostics.missingBoundNodeIds.length > 0 ? (
                  <div className="result-card full-span">
                    <strong>已绑定但当前不会输出</strong>
                    <span>这些绑定仍保留在托管身份上，但不会进入当前公开订阅。</span>
                    <ul className="overview-list">
                      {props.hostedSubscriptionDiagnostics.disabledBoundNodes.map((node) => (
                        <li key={node.id}>{node.name}（当前已禁用）</li>
                      ))}
                      {props.hostedSubscriptionDiagnostics.missingBoundNodeIds.map((nodeId) => (
                        <li key={nodeId}>{nodeId}（节点记录已不存在）</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {props.hostedSubscriptionDiagnostics.duplicateEnabledNames.length > 0 ||
                props.hostedSubscriptionDiagnostics.duplicateHostedNames.length > 0 ? (
                  <div className="result-card full-span">
                    <strong>重复节点名提示</strong>
                    <span>重复名称不会阻止生成，但会增加客户端识别和排查成本。</span>
                    <ul className="overview-list">
                      {props.hostedSubscriptionDiagnostics.duplicateEnabledNames.map((entry) => (
                        <li key={`enabled:${entry.name}`}>启用节点：{entry.name} × {entry.count}</li>
                      ))}
                      {props.hostedSubscriptionDiagnostics.duplicateHostedNames.map((entry) => (
                        <li key={`hosted:${entry.name}`}>当前输出：{entry.name} × {entry.count}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {props.hostedSubscriptionDiagnostics.previewTargets.some((target) => target.mismatch) ? (
                  <div className="result-card full-span">
                    <strong>预览输出与当前会输出节点数不一致</strong>
                    <span>这通常说明模板或渲染链路还有额外问题，建议重新生成后再检查。</span>
                    <ul className="overview-list">
                      {props.hostedSubscriptionDiagnostics.previewTargets
                        .filter((target) => target.mismatch)
                        .map((target) => (
                          <li key={`mismatch:${target.target}`}>
                            {target.target} 预览 {target.nodeCount ?? 0} 个节点，当前会输出 {currentHostedOutputNodeCount} 个节点
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}
