import type { NodeFilterMode } from '../../node-management';

const filterModeOptions: Array<{ value: NodeFilterMode; label: string }> = [
  { value: 'all', label: '全部节点' },
  { value: 'enabled', label: '仅启用' },
  { value: 'disabled', label: '仅禁用' },
  { value: 'manual', label: '手动导入' },
  { value: 'remote', label: '远程同步' },
  { value: 'duplicates', label: '重复节点' },
  { value: 'chain_issues', label: '链路异常' }
];

export function NodeManagementToolbar(props: {
  searchText: string;
  filterMode: NodeFilterMode;
  filteredNodeCount: number;
  selectedCount: number;
  allFilteredSelected: boolean;
  onSearchTextChange: (value: string) => void;
  onFilterModeChange: (value: NodeFilterMode) => void;
  onToggleSelectAllFiltered: () => void;
  onClearSelection: () => void;
}): JSX.Element {
  return (
    <div className="node-toolbar">
      <div className="node-toolbar-search">
        <input
          value={props.searchText}
          onChange={(event) => props.onSearchTextChange(event.target.value)}
          placeholder="搜索节点名称、协议、地址、链路"
        />
      </div>
      <select
        value={props.filterMode}
        onChange={(event) => props.onFilterModeChange(event.target.value as NodeFilterMode)}
      >
        {filterModeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="node-toolbar-meta">
        <span>当前显示 {props.filteredNodeCount}</span>
        <span>已选 {props.selectedCount}</span>
      </div>
      <div className="inline-actions">
        <button
          type="button"
          className="secondary"
          disabled={props.filteredNodeCount === 0}
          onClick={props.onToggleSelectAllFiltered}
        >
          {props.allFilteredSelected ? '取消全选当前' : '全选当前'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={props.selectedCount === 0}
          onClick={props.onClearSelection}
        >
          清空选择
        </button>
      </div>
    </div>
  );
}
