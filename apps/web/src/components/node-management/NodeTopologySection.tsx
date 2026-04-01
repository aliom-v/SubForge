import type { NodeChainSummary } from '../../mihomo-topology';
import { ResourceTable } from '../ui';

export function NodeTopologySection(props: {
  preferredTemplateName: string | null;
  proxyGroupCount: number;
  proxyProviderCount: number;
  topologyError: string | null;
  chainIssueCount: number;
  chainIssueSummaries: NodeChainSummary[];
  nodeChainSummaries: NodeChainSummary[];
}): JSX.Element {
  return (
    <details className="disclosure top-gap">
      <summary>链式代理拓扑与诊断（问题 {props.chainIssueCount}）</summary>
      <div className="disclosure-body">
        {props.preferredTemplateName ? (
          <div className="inline-meta">
            <span>当前托管 Mihomo 骨架：{props.preferredTemplateName}</span>
            <span>代理组：{props.proxyGroupCount}</span>
            <span>Providers：{props.proxyProviderCount}</span>
          </div>
        ) : (
          <p className="helper">当前还没有托管 Mihomo 骨架，链路仅按节点间引用解析。</p>
        )}
        {props.topologyError ? (
          <p className="helper">当前托管 Mihomo 骨架解析失败：{props.topologyError}</p>
        ) : null}
        {props.chainIssueSummaries.length > 0 ? (
          <ResourceTable
            columns={['节点', '上游代理', '链路', '状态']}
            rows={props.chainIssueSummaries.map((item) => [
              item.nodeName,
              item.upstreamProxy ?? 'direct',
              item.chain,
              item.issue ?? '正常'
            ])}
          />
        ) : (
          <p className="helper">当前没有链式代理异常。</p>
        )}
        <details className="disclosure compact-disclosure">
          <summary>查看完整链路表（{props.nodeChainSummaries.length}）</summary>
          <div className="disclosure-body">
            <ResourceTable
              columns={['节点', '上游代理', '链路', '状态']}
              rows={props.nodeChainSummaries.map((item) => [
                item.nodeName,
                item.upstreamProxy ?? 'direct',
                item.chain,
                item.issue ?? '正常'
              ])}
            />
          </div>
        </details>
      </div>
    </details>
  );
}
