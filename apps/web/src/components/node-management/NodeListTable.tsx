import type { NodeRecord } from '@subforge/shared';

import type { NodeChainSummary } from '../../mihomo-topology';
import { summarizeNodeMetadata } from '../../node-metadata';
import type { NodeDuplicateGroup } from '../../node-management';
import { ResourceTable } from '../ui';

export function NodeListTable(props: {
  nodes: NodeRecord[];
  selectedNodeIdSet: Set<string>;
  summaryById: Map<string, NodeChainSummary>;
  duplicateGroupByNodeId: Map<string, NodeDuplicateGroup>;
  loading: boolean;
  onToggleNodeSelection: (nodeId: string) => void;
  onEditNode: (node: NodeRecord) => void;
  onToggleNodeEnabled: (node: NodeRecord) => void;
  onDeleteNode: (node: NodeRecord) => void;
}): JSX.Element {
  return (
    <ResourceTable
      columns={['选择', '节点', '来源 / 链路', '状态', '操作']}
      rows={props.nodes.map((node) => {
        const chainSummary = props.summaryById.get(node.id);
        const duplicateGroup = props.duplicateGroupByNodeId.get(node.id);
        const isSelected = props.selectedNodeIdSet.has(node.id);

        return [
          <div className="selection-cell" key={`${node.id}-select`}>
            <input
              className="selection-checkbox"
              type="checkbox"
              checked={isSelected}
              onChange={() => props.onToggleNodeSelection(node.id)}
              aria-label={`选择节点 ${node.name}`}
            />
          </div>,
          <div className="table-cell-stack" key={`${node.id}-node`}>
            <strong className="table-primary">{node.name}</strong>
            <span className="table-subtle">{node.protocol}</span>
            <span className="table-subtle">
              {node.server}:{node.port}
            </span>
            <span className="table-subtle">{summarizeNodeMetadata(node)}</span>
          </div>,
          <div className="table-cell-stack" key={`${node.id}-source`}>
            <span>{node.sourceType}</span>
            <span className="table-subtle">{chainSummary?.chain ?? node.name}</span>
            {duplicateGroup ? (
              <span className="table-subtle">重复组 {duplicateGroup.nodes.length} 个</span>
            ) : null}
          </div>,
          <div className="table-cell-stack" key={`${node.id}-state`}>
            <span>{node.enabled ? 'enabled' : 'disabled'}</span>
            <span className="table-subtle">{chainSummary?.issue ?? '正常'}</span>
          </div>,
          <div className="inline-actions" key={`${node.id}-actions`}>
            <button type="button" onClick={() => props.onEditNode(node)}>
              编辑
            </button>
            <button
              type="button"
              className="secondary"
              disabled={props.loading}
              onClick={() => props.onToggleNodeEnabled(node)}
            >
              {node.enabled ? '禁用' : '启用'}
            </button>
            <button
              type="button"
              className="danger"
              disabled={props.loading}
              onClick={() => props.onDeleteNode(node)}
            >
              删除
            </button>
          </div>
        ];
      })}
    />
  );
}
