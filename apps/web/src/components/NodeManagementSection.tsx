import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  parseMihomoTemplateStructure,
  validateNodeChains
} from '@subforge/core';
import type { NodeRecord, TemplateRecord } from '@subforge/shared';

import type { NodeEditorState } from '../app-types';
import { isAppApiError } from '../api';
import { getErrorMessage } from '../error-handling';
import { buildNodeChainSummaries } from '../mihomo-topology';
import {
  buildNodeChainIssueKey,
  buildNodeEditorDraft,
  buildNodeEditorParams,
  buildNodeUpstreamOptions,
  createNodeEditorState,
  extractNodeChainIssueMessages,
  parseOptionalJsonObjectInput
} from '../node-editor';
import {
  buildDuplicateNodeIdSet,
  buildNodeDuplicateGroups,
  filterNodeRecords,
  type NodeFilterMode
} from '../node-management';
import { NodeDuplicateCleanupSection } from './node-management/NodeDuplicateCleanupSection';
import { NodeEditorDrawer } from './node-management/NodeEditorDrawer';
import { NodeListTable } from './node-management/NodeListTable';
import { NodeManagementToolbar } from './node-management/NodeManagementToolbar';
import { NodeTopologySection } from './node-management/NodeTopologySection';

export interface NodeEditorSubmitInput {
  nodeId: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
  enabled: boolean;
  credentials: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
}

function confirmDestructiveAction(message: string): boolean {
  return typeof window === 'undefined' ? true : window.confirm(message);
}

function selectPreferredMihomoTemplate(
  templates: TemplateRecord[]
): TemplateRecord | null {
  const enabledMihomoTemplates = templates.filter(
    (template) =>
      template.targetType === 'mihomo' && template.status === 'enabled'
  );
  const preferredEnabledTemplate =
    enabledMihomoTemplates.find((template) => template.isDefault) ??
    enabledMihomoTemplates[0];

  if (preferredEnabledTemplate) {
    return preferredEnabledTemplate;
  }

  const mihomoTemplates = templates.filter(
    (template) => template.targetType === 'mihomo'
  );
  return (
    mihomoTemplates.find((template) => template.isDefault) ??
    mihomoTemplates[0] ??
    null
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function NodeManagementSection(props: {
  loading: boolean;
  nodes: NodeRecord[];
  templates: TemplateRecord[];
  onSaveNode: (input: NodeEditorSubmitInput) => Promise<void>;
  onSetNodesEnabled: (nodeIds: string[], enabled: boolean) => Promise<void>;
  onDeleteNodes: (nodeIds: string[]) => Promise<void>;
}): JSX.Element {
  const [filterMode, setFilterMode] = useState<NodeFilterMode>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null);
  const [nodeEditorIssues, setNodeEditorIssues] = useState<string[]>([]);

  const enabledNodeCount = useMemo(
    () => props.nodes.filter((node) => node.enabled).length,
    [props.nodes]
  );
  const nodeSourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const node of props.nodes) {
      counts[node.sourceType] = (counts[node.sourceType] ?? 0) + 1;
    }

    return counts;
  }, [props.nodes]);
  const preferredMihomoTemplate = useMemo(
    () => selectPreferredMihomoTemplate(props.templates),
    [props.templates]
  );
  const mihomoTopology = useMemo(() => {
    if (!preferredMihomoTemplate) {
      return {
        templateName: null,
        proxyGroups: [],
        proxyProviders: [],
        error: null as string | null
      };
    }

    try {
      const parsed = parseMihomoTemplateStructure(preferredMihomoTemplate.content);

      return {
        templateName: preferredMihomoTemplate.name,
        proxyGroups: parsed.proxyGroups,
        proxyProviders: parsed.proxyProviders,
        error: null as string | null
      };
    } catch (caughtError) {
      return {
        templateName: preferredMihomoTemplate.name,
        proxyGroups: [],
        proxyProviders: [],
        error: getErrorMessage(caughtError)
      };
    }
  }, [preferredMihomoTemplate]);
  const mihomoProxyGroupNames = useMemo(
    () =>
      uniqueStrings(
        mihomoTopology.proxyGroups.map((group) =>
          typeof group.name === 'string' ? group.name.trim() : ''
        )
      ),
    [mihomoTopology.proxyGroups]
  );
  const nodeChainSummaries = useMemo(
    () =>
      buildNodeChainSummaries(
        props.nodes,
        mihomoTopology.proxyGroups,
        mihomoTopology.proxyProviders
      ),
    [mihomoTopology.proxyGroups, mihomoTopology.proxyProviders, props.nodes]
  );
  const nodeChainSummaryById = useMemo(
    () => new Map(nodeChainSummaries.map((item) => [item.nodeId, item])),
    [nodeChainSummaries]
  );
  const nodeChainIssueCount = useMemo(
    () => nodeChainSummaries.filter((item) => item.issue).length,
    [nodeChainSummaries]
  );
  const duplicateGroups = useMemo(
    () => buildNodeDuplicateGroups(props.nodes),
    [props.nodes]
  );
  const duplicateGroupByNodeId = useMemo(() => {
    const map = new Map<string, (typeof duplicateGroups)[number]>();

    for (const group of duplicateGroups) {
      for (const node of group.nodes) {
        map.set(node.id, group);
      }
    }

    return map;
  }, [duplicateGroups]);
  const duplicateNodeIdSet = useMemo(
    () => buildDuplicateNodeIdSet(duplicateGroups),
    [duplicateGroups]
  );
  const filteredNodes = useMemo(
    () =>
      filterNodeRecords({
        nodes: props.nodes,
        summariesById: nodeChainSummaryById,
        filterMode,
        searchText,
        duplicateNodeIds: duplicateNodeIdSet
      }),
    [duplicateNodeIdSet, filterMode, nodeChainSummaryById, props.nodes, searchText]
  );
  const filteredNodeIds = useMemo(
    () => filteredNodes.map((node) => node.id),
    [filteredNodes]
  );
  const filteredNodeIdSet = useMemo(
    () => new Set(filteredNodeIds),
    [filteredNodeIds]
  );
  const selectedNodeIdSet = useMemo(
    () => new Set(selectedNodeIds),
    [selectedNodeIds]
  );
  const selectedCount = selectedNodeIds.length;
  const allFilteredSelected =
    filteredNodeIds.length > 0 &&
    filteredNodeIds.every((nodeId) => selectedNodeIdSet.has(nodeId));
  const editorSummary = useMemo(
    () =>
      nodeEditor ? nodeChainSummaryById.get(nodeEditor.nodeId) ?? null : null,
    [nodeChainSummaryById, nodeEditor]
  );
  const nodeEditorUpstreamOptions = useMemo(
    () => (nodeEditor ? buildNodeUpstreamOptions(props.nodes, nodeEditor) : []),
    [nodeEditor, props.nodes]
  );
  const nodeEditorHasLegacyUpstream = useMemo(() => {
    if (!nodeEditor?.upstreamProxy.trim()) {
      return false;
    }

    return nodeEditorUpstreamOptions.some(
      (option) => option.value === nodeEditor.upstreamProxy && option.legacy
    );
  }, [nodeEditor, nodeEditorUpstreamOptions]);
  const nodeEditorAdvancedFieldSummary = useMemo(() => {
    if (!nodeEditor) {
      return '高级字段';
    }

    const parts: string[] = [];

    if (nodeEditor.credentialsText.trim()) {
      parts.push('credentials');
    }

    if (nodeEditor.paramsText.trim()) {
      parts.push('params');
    }

    return parts.length > 0
      ? `高级字段（${parts.join(' / ')}）`
      : '高级字段（空）';
  }, [nodeEditor]);
  const duplicateCleanupCandidateCount = useMemo(
    () =>
      duplicateGroups.reduce(
        (total, group) => total + group.deleteNodeIds.length,
        0
      ),
    [duplicateGroups]
  );
  const chainIssueSummaries = useMemo(
    () => nodeChainSummaries.filter((item) => item.issue),
    [nodeChainSummaries]
  );

  useEffect(() => {
    const currentNodeIds = new Set(props.nodes.map((node) => node.id));
    setSelectedNodeIds((current) =>
      current.filter((nodeId) => currentNodeIds.has(nodeId))
    );
  }, [props.nodes]);

  useEffect(() => {
    if (!nodeEditor) {
      return;
    }

    const currentNode = props.nodes.find((node) => node.id === nodeEditor.nodeId);

    if (!currentNode) {
      setNodeEditor(null);
      setNodeEditorIssues([]);
    }
  }, [nodeEditor, props.nodes]);

  function handleToggleSelectAllFiltered(): void {
    setSelectedNodeIds((current) => {
      const currentSet = new Set(current);

      if (allFilteredSelected) {
        return current.filter((nodeId) => !filteredNodeIdSet.has(nodeId));
      }

      for (const nodeId of filteredNodeIds) {
        currentSet.add(nodeId);
      }

      return [...currentSet];
    });
  }

  function handleToggleNodeSelection(nodeId: string): void {
    setSelectedNodeIds((current) =>
      current.includes(nodeId)
        ? current.filter((value) => value !== nodeId)
        : [...current, nodeId]
    );
  }

  function handleStartEditingNode(node: NodeRecord): void {
    setNodeEditor(createNodeEditorState(node));
    setNodeEditorIssues([]);
  }

  function handleCloseNodeEditor(): void {
    setNodeEditor(null);
    setNodeEditorIssues([]);
  }

  async function handleSaveNodeEditor(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();

    if (!nodeEditor) {
      return;
    }

    const currentNode = props.nodes.find((node) => node.id === nodeEditor.nodeId);

    if (!currentNode) {
      setNodeEditorIssues(['当前编辑的节点已不存在，请刷新后重试']);
      return;
    }

    const name = nodeEditor.name.trim();
    const protocol = nodeEditor.protocol.trim();
    const server = nodeEditor.server.trim();
    const port = Number(nodeEditor.port);

    if (!name || !protocol || !server) {
      setNodeEditorIssues(['名称、协议、地址不能为空']);
      return;
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setNodeEditorIssues(['端口必须是 1 到 65535 的整数']);
      return;
    }

    let credentials = null;
    let paramsDraft = null;

    try {
      credentials = parseOptionalJsonObjectInput(
        nodeEditor.credentialsText,
        'credentials'
      );
      paramsDraft = parseOptionalJsonObjectInput(nodeEditor.paramsText, 'params');
    } catch (caughtError) {
      setNodeEditorIssues([getErrorMessage(caughtError)]);
      return;
    }

    const params = buildNodeEditorParams(paramsDraft, nodeEditor.upstreamProxy);
    const nextNode = buildNodeEditorDraft(
      currentNode,
      {
        ...nodeEditor,
        name,
        protocol,
        server
      },
      port,
      credentials,
      params
    );
    const currentValidation = validateNodeChains({
      nodes: props.nodes,
      proxyGroups: mihomoTopology.proxyGroups,
      proxyProviders: mihomoTopology.proxyProviders,
      includeDisabledNodes: true,
      allowProxyGroups: true,
      allowBuiltinReferences: true
    });
    const nextValidation = validateNodeChains({
      nodes: props.nodes.map((node) =>
        node.id === currentNode.id ? nextNode : node
      ),
      proxyGroups: mihomoTopology.proxyGroups,
      proxyProviders: mihomoTopology.proxyProviders,
      includeDisabledNodes: true,
      allowProxyGroups: true,
      allowBuiltinReferences: true
    });
    const currentIssueKeys = new Set(
      currentValidation.issues.map(buildNodeChainIssueKey)
    );
    const introducedIssues = nextValidation.issues.filter(
      (issue) => !currentIssueKeys.has(buildNodeChainIssueKey(issue))
    );

    if (introducedIssues.length > 0) {
      setNodeEditorIssues(introducedIssues.map((issue) => issue.message));
      return;
    }

    try {
      await props.onSaveNode({
        nodeId: currentNode.id,
        name,
        protocol,
        server,
        port,
        enabled: nodeEditor.enabled,
        credentials,
        params
      });
      setNodeEditor(null);
      setNodeEditorIssues([]);
    } catch (caughtError) {
      if (
        isAppApiError(caughtError) &&
        caughtError.details?.scope === 'node_chain'
      ) {
        setNodeEditorIssues(
          extractNodeChainIssueMessages(caughtError.details?.issues)
        );
      }
    }
  }

  async function handleBatchSetEnabled(enabled: boolean): Promise<void> {
    if (selectedNodeIds.length === 0) {
      return;
    }

    try {
      await props.onSetNodesEnabled(selectedNodeIds, enabled);
    } catch {
      return;
    }
  }

  async function handleRowSetEnabled(node: NodeRecord): Promise<void> {
    try {
      await props.onSetNodesEnabled([node.id], !node.enabled);
    } catch {
      return;
    }
  }

  async function handleBatchDelete(
    nodeIds: string[],
    confirmMessage: string
  ): Promise<void> {
    if (nodeIds.length === 0 || !confirmDestructiveAction(confirmMessage)) {
      return;
    }

    try {
      await props.onDeleteNodes(nodeIds);
      setSelectedNodeIds((current) =>
        current.filter((nodeId) => !nodeIds.includes(nodeId))
      );

      if (nodeEditor && nodeIds.includes(nodeEditor.nodeId)) {
        handleCloseNodeEditor();
      }
    } catch {
      return;
    }
  }

  return (
    <article className="panel full-width">
      <div className="panel-header">
        <div>
          <h2>节点列表</h2>
          <p className="helper">
            搜索支持名称、协议、地址、端口、来源、上游链路和异常描述。批量启停、删除、重复清理都在这里完成。
          </p>
        </div>
        <div className="inline-meta">
          <span>总节点 {props.nodes.length}</span>
          <span>手动 {nodeSourceCounts.manual ?? 0}</span>
          <span>远程 {nodeSourceCounts.remote ?? 0}</span>
          <span>启用 {enabledNodeCount}</span>
          {duplicateGroups.length > 0 ? <span>重复 {duplicateGroups.length} 组</span> : null}
          {nodeChainIssueCount > 0 ? <span>异常 {nodeChainIssueCount}</span> : null}
        </div>
      </div>

      <NodeManagementToolbar
        searchText={searchText}
        filterMode={filterMode}
        filteredNodeCount={filteredNodes.length}
        selectedCount={selectedCount}
        allFilteredSelected={allFilteredSelected}
        onSearchTextChange={setSearchText}
        onFilterModeChange={setFilterMode}
        onToggleSelectAllFiltered={handleToggleSelectAllFiltered}
        onClearSelection={() => setSelectedNodeIds([])}
      />

      <div className="result-card node-bulk-bar">
        <strong>批量操作</strong>
        <span>
          批量启用/禁用会走后端统一校验，避免链式代理半更新。重复清理按“协议 +
          地址 + 端口 + credentials + params”精确判重。
        </span>
        <div className="inline-actions">
          <button
            type="button"
            disabled={props.loading || selectedCount === 0}
            onClick={() => void handleBatchSetEnabled(true)}
          >
            批量启用
          </button>
          <button
            type="button"
            className="secondary"
            disabled={props.loading || selectedCount === 0}
            onClick={() => void handleBatchSetEnabled(false)}
          >
            批量禁用
          </button>
          <button
            type="button"
            className="danger"
            disabled={props.loading || selectedCount === 0}
            onClick={() =>
              void handleBatchDelete(
                selectedNodeIds,
                `确认删除已选的 ${selectedCount} 个节点吗？`
              )
            }
          >
            批量删除
          </button>
          <button
            type="button"
            className="secondary"
            disabled={props.loading || duplicateCleanupCandidateCount === 0}
            onClick={() =>
              void handleBatchDelete(
                duplicateGroups.flatMap((group) => group.deleteNodeIds),
                `确认清理建议删除的 ${duplicateCleanupCandidateCount} 个重复节点吗？`
              )
            }
          >
            清理建议重复
          </button>
        </div>
      </div>

      <NodeListTable
        nodes={filteredNodes}
        selectedNodeIdSet={selectedNodeIdSet}
        summaryById={nodeChainSummaryById}
        duplicateGroupByNodeId={duplicateGroupByNodeId}
        loading={props.loading}
        onToggleNodeSelection={handleToggleNodeSelection}
        onEditNode={handleStartEditingNode}
        onToggleNodeEnabled={(node) => void handleRowSetEnabled(node)}
        onDeleteNode={(node) =>
          void handleBatchDelete([node.id], `确认删除节点“${node.name}”吗？`)
        }
      />

      <NodeDuplicateCleanupSection
        duplicateGroups={duplicateGroups}
        loading={props.loading}
        onDeleteGroup={(group) =>
          void handleBatchDelete(
            group.deleteNodeIds,
            `确认清理这组重复节点吗？将删除 ${group.deleteNodeIds.length} 个副本。`
          )
        }
      />

      <NodeTopologySection
        preferredTemplateName={preferredMihomoTemplate?.name ?? null}
        proxyGroupCount={mihomoProxyGroupNames.length}
        proxyProviderCount={mihomoTopology.proxyProviders.length}
        topologyError={mihomoTopology.error}
        chainIssueCount={nodeChainIssueCount}
        chainIssueSummaries={chainIssueSummaries}
        nodeChainSummaries={nodeChainSummaries}
      />

      <NodeEditorDrawer
        loading={props.loading}
        nodeEditor={nodeEditor}
        nodeEditorIssues={nodeEditorIssues}
        editorSummary={editorSummary}
        nodeEditorHasLegacyUpstream={nodeEditorHasLegacyUpstream}
        nodeEditorUpstreamOptions={nodeEditorUpstreamOptions}
        nodeEditorAdvancedFieldSummary={nodeEditorAdvancedFieldSummary}
        onClose={handleCloseNodeEditor}
        onSubmit={(event) => void handleSaveNodeEditor(event)}
        onChange={setNodeEditor}
      />
    </article>
  );
}
