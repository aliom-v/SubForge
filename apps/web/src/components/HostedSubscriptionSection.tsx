import type { SubscriptionTarget } from '@subforge/shared';

import type { HostedSubscriptionResult, HostedSubscriptionSyncStatus } from '../hosted-state';
import { getHostedSyncStatusLabel } from '../workflow-feedback';

export function HostedSubscriptionSection(props: {
  loading: boolean;
  enabledNodeCount: number;
  autoHostedUserName: string | null;
  hostedSubscriptionResult: HostedSubscriptionResult | null;
  hostedSubscriptionSyncStatus: HostedSubscriptionSyncStatus;
  enabledNodeWarnings: string[];
  onGenerate: () => void;
  onResetToken: () => void;
  onCopyHostedUrl: (url: string, target: SubscriptionTarget) => void;
}): JSX.Element {
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
          {props.hostedSubscriptionResult ? <span>当前绑定 {props.hostedSubscriptionResult.nodeCount}</span> : null}
        </div>
      </div>
      <p className="helper">{props.hostedSubscriptionSyncStatus.detail}</p>
      <p className="helper">公开订阅不会复用管理员登录态；若链接泄漏，直接重置当前托管链接即可。</p>
      <div className="inline-actions">
        <button type="button" disabled={props.loading || props.enabledNodeCount === 0} onClick={props.onGenerate}>
          使用当前启用节点生成托管 URL
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
        <details className="disclosure top-gap">
          <summary>查看当前托管 URL（{props.hostedSubscriptionResult.targets.length}）</summary>
          <div className="disclosure-body">
            <p className="helper">
              当前状态：{props.hostedSubscriptionResult.sourceLabel}，这组链接已绑定 {props.hostedSubscriptionResult.nodeCount} 个节点。
            </p>
            <div className="metadata-grid">
              {props.hostedSubscriptionResult.targets.map((target) => (
                <div className="result-card" key={target.target}>
                  <strong>{target.target}</strong>
                  <a className="result-link" href={target.url} target="_blank" rel="noreferrer">
                    {target.url}
                  </a>
                  <span>{target.ok ? '输出检查通过' : '输出检查失败'}</span>
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
          </div>
        </details>
      ) : null}
    </article>
  );
}
