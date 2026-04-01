import type { NodeDuplicateGroup } from '../../node-management';
import { ResourceTable } from '../ui';

export function NodeDuplicateCleanupSection(props: {
  duplicateGroups: NodeDuplicateGroup[];
  loading: boolean;
  onDeleteGroup: (group: NodeDuplicateGroup) => void;
}): JSX.Element {
  return (
    <details className="disclosure top-gap">
      <summary>查看重复清理建议（{props.duplicateGroups.length} 组）</summary>
      <div className="disclosure-body">
        {props.duplicateGroups.length > 0 ? (
          <ResourceTable
            columns={['保留节点', '待删节点', '说明', '操作']}
            rows={props.duplicateGroups.map((group) => [
              <div className="table-cell-stack" key={`${group.fingerprint}-keep`}>
                <strong className="table-primary">
                  {group.nodes.find((node) => node.id === group.keepNodeId)?.name ??
                    group.keepNodeId}
                </strong>
                <span className="table-subtle">{group.keepNodeId}</span>
              </div>,
              <div className="table-cell-stack" key={`${group.fingerprint}-delete`}>
                {group.nodes
                  .filter((node) => group.deleteNodeIds.includes(node.id))
                  .map((node) => (
                    <span key={node.id}>{node.name}</span>
                  ))}
              </div>,
              <div className="table-cell-stack" key={`${group.fingerprint}-summary`}>
                <span>相同指纹 {group.nodes.length} 个</span>
                <span className="table-subtle">
                  优先保留启用、远程来源、更新时间更近的节点
                </span>
              </div>,
              <div className="inline-actions" key={`${group.fingerprint}-actions`}>
                <button
                  type="button"
                  className="secondary"
                  disabled={props.loading || group.deleteNodeIds.length === 0}
                  onClick={() => props.onDeleteGroup(group)}
                >
                  清理这组
                </button>
              </div>
            ])}
          />
        ) : (
          <p className="helper">当前没有检测到完全重复的节点。</p>
        )}
      </div>
    </details>
  );
}
