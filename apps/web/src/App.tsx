import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getServiceMetadata,
  parseMihomoTemplateStructure,
  validateNodeChains
} from '@subforge/core';
import {
  SUBSCRIPTION_TARGETS,
  type JsonValue,
  type NodeRecord,
  type RemoteSubscriptionSourceRecord,
  type SubscriptionTarget,
  type TemplateRecord,
  type UserRecord
} from '@subforge/shared';
import {
  bootstrapSetup,
  createTemplate,
  createUser,
  deleteNode,
  fetchMe,
  fetchNodes,
  fetchPreview,
  fetchSetupStatus,
  fetchTemplates,
  fetchUserNodeBindings,
  fetchUsers,
  importNodes,
  login,
  logout,
  previewNodeImportFromUrl,
  createRemoteSubscriptionSource,
  deleteRemoteSubscriptionSource,
  fetchRemoteSubscriptionSources,
  isAppApiError,
  replaceUserNodeBindings,
  resetHostedSubscriptionToken,
  syncRemoteSubscriptionSource,
  updateNode,
  updateRemoteSubscriptionSource,
  updateTemplate,
  updateUser,
  type AdminSession,
  type NodeImportPreviewPayload,
  type RemoteSubscriptionSourceSyncPayload,
  type SetupStatusPayload
} from './api';
import { getErrorMessage, shouldClearProtectedSession } from './error-handling';
import {
  AUTO_HOSTED_TEMPLATE_NAMES,
  AUTO_HOSTED_USER_NAME,
  AUTO_HOSTED_USER_REMARK,
  buildHostedSubscriptionUrl,
  findAutoHostedTemplate,
  findAutoHostedUser,
  getHostedSubscriptionSyncStatus,
  resolveCurrentHostedSubscriptionResult,
  type HostedSubscriptionTargetState,
  type HostedSubscriptionResult
} from './hosted-state';
import {
  buildRemotePreviewMessage,
  buildRemoteSubscriptionSourceSyncMessage,
  getHostedSyncStatusLabel
} from './workflow-feedback';
import { getRemoteSyncNodeChainDiagnostics } from './remote-sync-diagnostics';
import {
  runConfigImportWorkflow,
  runHostedGenerationWorkflow,
  runNodeImportWorkflow,
  runRemoteSubscriptionSourceSaveWorkflow
} from './workflow-orchestration';
import { buildSingleUserWorkflowSteps, getWorkflowStepStatusLabel } from './workflow-progress';
import {
  summarizeNodeMetadata,
  summarizeNodeMetadataParts
} from './node-metadata';
import {
  buildImportedNodeWarnings,
  parseImportedConfig,
  parseNodeImportText,
  type ImportedConfigPayload,
  type ImportedNodePayload,
  type NodeImportContentEncoding
} from './node-import';
import { buildNodeChainSummaries } from './mihomo-topology';

const metadata = getServiceMetadata();
const sessionStorageKey = 'subforge.admin.token';

interface ResourceState {
  users: UserRecord[];
  nodes: NodeRecord[];
  templates: TemplateRecord[];
  remoteSubscriptionSources: RemoteSubscriptionSourceRecord[];
}

interface RemoteSubscriptionSourceForm {
  name: string;
  sourceUrl: string;
}

interface NodeEditorState {
  nodeId: string;
  name: string;
  protocol: string;
  server: string;
  port: string;
  enabled: boolean;
  upstreamProxy: string;
  credentialsText: string;
  paramsText: string;
}

const emptyResources: ResourceState = {
  users: [],
  nodes: [],
  templates: [],
  remoteSubscriptionSources: []
};

const AUTO_HOSTED_MIHOMO_TEMPLATE = ['mixed-port: 7890', 'mode: rule', 'proxies:', '{{proxies}}', 'proxy-groups:', '{{proxy_groups}}', 'rules:', '{{rules}}'].join('\n');
const AUTO_HOSTED_SINGBOX_TEMPLATE = ['{', '  "outbounds": {{outbounds}},', '  "route": {', '    "rules": {{rules}}', '  }', '}'].join('\n');

const emptyRemoteSubscriptionSourceForm: RemoteSubscriptionSourceForm = { name: '', sourceUrl: '' };

function formatNodeImportContentEncoding(value: NodeImportContentEncoding): string {
  return value === 'base64_text' ? 'Base64 文本' : '明文文本';
}

function summarizeImportErrors(errors: string[]): string[] {
  const counts = new Map<string, number>();
  const firstMessages = new Map<string, string>();
  const order: string[] = [];

  for (const error of errors) {
    const matched = error.match(/^第 \d+ 行：(.*)$/);
    const normalizedMessage = matched?.[1] ?? error;

    if (!counts.has(normalizedMessage)) {
      order.push(normalizedMessage);
      firstMessages.set(normalizedMessage, error);
    }

    counts.set(normalizedMessage, (counts.get(normalizedMessage) ?? 0) + 1);
  }

  return order.map((message) => {
    const count = counts.get(message) ?? 0;

    if (count <= 1) {
      return firstMessages.get(message) ?? message;
    }

    return `${message}（共 ${count} 行）`;
  });
}

function buildRemoteSubscriptionSourceName(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const pathTail = url.pathname.split('/').filter(Boolean).at(-1);
    return pathTail ? `${url.hostname} / ${pathTail}` : url.hostname;
  } catch {
    return '远程订阅源';
  }
}

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

export function App(): JSX.Element {
  const [token, setToken] = useState<string>(() => localStorage.getItem(sessionStorageKey) ?? '');
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [resources, setResources] = useState<ResourceState>(emptyResources);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [remoteSubscriptionSyncResult, setRemoteSubscriptionSyncResult] =
    useState<RemoteSubscriptionSourceSyncPayload | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(null);
  const [hostedSubscriptionResult, setHostedSubscriptionResult] = useState<HostedSubscriptionResult | null>(null);

  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [setupForm, setSetupForm] = useState({ username: 'admin', password: '', confirmPassword: '' });
  const [nodeImportText, setNodeImportText] = useState('');
  const [configImportText, setConfigImportText] = useState('');
  const [nodeImportSourceUrl, setNodeImportSourceUrl] = useState('');
  const [remoteNodeImportPreview, setRemoteNodeImportPreview] = useState<NodeImportPreviewPayload | null>(null);
  const [remoteSubscriptionSourceForm, setRemoteSubscriptionSourceForm] =
    useState<RemoteSubscriptionSourceForm>(emptyRemoteSubscriptionSourceForm);
  const [nodeEditor, setNodeEditor] = useState<NodeEditorState | null>(null);
  const [nodeEditorIssues, setNodeEditorIssues] = useState<string[]>([]);

  const summary = useMemo(
    () => [
      { label: 'Nodes', value: resources.nodes.length },
      { label: 'Hosted URLs', value: hostedSubscriptionResult?.targets.length ?? SUBSCRIPTION_TARGETS.length },
      { label: 'Hosted Nodes', value: hostedSubscriptionResult?.nodeCount ?? 0 }
    ],
    [hostedSubscriptionResult, resources.nodes.length]
  );
  const autoHostedUser = useMemo(() => findAutoHostedUser(resources.users), [resources.users]);
  const enabledNodes = useMemo(() => resources.nodes.filter((node) => node.enabled), [resources.nodes]);
  const enabledNodeCount = enabledNodes.length;
  const enabledNodeWarnings = useMemo(() => buildImportedNodeWarnings(enabledNodes), [enabledNodes]);
  const hostedSubscriptionSyncStatus = useMemo(
    () => getHostedSubscriptionSyncStatus(hostedSubscriptionResult, resources.nodes),
    [hostedSubscriptionResult, resources.nodes]
  );
  const latestPersistedRemoteSyncSource = useMemo(
    () =>
      [...resources.remoteSubscriptionSources]
        .filter((source) => source.lastSyncAt)
        .sort((left, right) => Date.parse(right.lastSyncAt ?? '') - Date.parse(left.lastSyncAt ?? ''))[0] ?? null,
    [resources.remoteSubscriptionSources]
  );
  const effectiveRemoteSyncSourceName = remoteSubscriptionSyncResult?.sourceName ?? latestPersistedRemoteSyncSource?.name ?? null;
  const effectiveRemoteSyncStatus =
    remoteSubscriptionSyncResult?.status ?? latestPersistedRemoteSyncSource?.lastSyncStatus ?? null;
  const effectiveRemoteSyncMessage =
    remoteSubscriptionSyncResult?.message ?? latestPersistedRemoteSyncSource?.lastSyncMessage ?? null;
  const effectiveRemoteSyncAt =
    remoteSubscriptionSyncResult?.importedAt ?? latestPersistedRemoteSyncSource?.lastSyncAt ?? null;
  const remoteSyncNodeChainDiagnostics = useMemo(
    () => getRemoteSyncNodeChainDiagnostics(remoteSubscriptionSyncResult ?? latestPersistedRemoteSyncSource),
    [latestPersistedRemoteSyncSource, remoteSubscriptionSyncResult]
  );
  const singleUserWorkflowSteps = useMemo(
    () =>
      buildSingleUserWorkflowSteps({
        nodes: resources.nodes,
        hostedSubscriptionSyncStatus,
        hostedSubscriptionResult
      }),
    [hostedSubscriptionResult, hostedSubscriptionSyncStatus, resources.nodes]
  );
  const parsedNodeImport = useMemo(() => parseNodeImportText(nodeImportText), [nodeImportText]);
  const parsedConfigImport = useMemo(() => parseImportedConfig(configImportText), [configImportText]);
  const summarizedParsedNodeImportErrors = useMemo(
    () => summarizeImportErrors(parsedNodeImport.errors),
    [parsedNodeImport.errors]
  );
  const summarizedRemoteNodeImportErrors = useMemo(
    () => summarizeImportErrors(remoteNodeImportPreview?.errors ?? []),
    [remoteNodeImportPreview?.errors]
  );
  const preferredMihomoTemplate = useMemo(() => selectPreferredMihomoTemplate(resources.templates), [resources.templates]);
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
    () => uniqueStrings(mihomoTopology.proxyGroups.map((group) => typeof group.name === 'string' ? group.name.trim() : '')),
    [mihomoTopology.proxyGroups]
  );
  const nodeChainSummaries = useMemo(
    () => buildNodeChainSummaries(resources.nodes, mihomoTopology.proxyGroups, mihomoTopology.proxyProviders),
    [mihomoTopology.proxyGroups, mihomoTopology.proxyProviders, resources.nodes]
  );
  const editingNodeSummary = useMemo(
    () => (nodeEditor ? nodeChainSummaries.find((item) => item.nodeId === nodeEditor.nodeId) ?? null : null),
    [nodeChainSummaries, nodeEditor]
  );
  const nodeEditorUpstreamOptions = useMemo(
    () => (nodeEditor ? buildNodeUpstreamOptions(resources.nodes, nodeEditor) : []),
    [nodeEditor, resources.nodes]
  );
  const nodeEditorHasLegacyUpstream = useMemo(() => {
    if (!nodeEditor?.upstreamProxy.trim()) {
      return false;
    }

    return nodeEditorUpstreamOptions.some((option) => option.value === nodeEditor.upstreamProxy && option.legacy);
  }, [nodeEditor, nodeEditorUpstreamOptions]);

  function reportValidationError(messageText: string): void {
    setMessage('');
    setError(messageText);
  }

  function resetSessionState(): void {
    setAdmin(null);
    setResources(emptyResources);
    setRemoteSubscriptionSyncResult(null);
    setRemoteNodeImportPreview(null);
    setHostedSubscriptionResult(null);
  }

  async function clearPersistedSession(refreshSetup = true): Promise<void> {
    localStorage.removeItem(sessionStorageKey);
    setToken('');
    resetSessionState();

    if (refreshSetup) {
      await refreshSetupStatus();
    }
  }

  async function handleProtectedApiError(caughtError: unknown): Promise<void> {
    if (shouldClearProtectedSession(caughtError)) {
      await clearPersistedSession();
    }

    setError(getErrorMessage(caughtError));
  }

  useEffect(() => {
    void refreshSetupStatus();
  }, []);

  useEffect(() => {
    if (!token) {
      resetSessionState();
      return;
    }

    void bootstrapSession(token);
  }, [token]);

  async function bootstrapSession(currentToken: string): Promise<void> {
    setLoading(true);
    setError('');

    try {
      const me = await fetchMe(currentToken);
      setAdmin(me);
      await refreshResources(currentToken);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSetupStatus(): Promise<void> {
    try {
      const status = await fetchSetupStatus();
      setSetupStatus(status);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }

  async function refreshResources(currentToken = token): Promise<ResourceState> {
    const [users, nodes, templates, remoteSubscriptionSources] = await Promise.all([
      fetchUsers(currentToken),
      fetchNodes(currentToken),
      fetchTemplates(currentToken),
      fetchRemoteSubscriptionSources(currentToken)
    ]);
    const nextResources = { users, nodes, templates, remoteSubscriptionSources };
    const nextHostedSubscriptionResult = await resolveCurrentHostedSubscriptionResult({
      resources: nextResources,
      fetchUserNodeBindings: (userId) => fetchUserNodeBindings(currentToken, userId),
      fetchPreview: (userId, target) => fetchPreview(currentToken, userId, target),
      formatErrorMessage: getErrorMessage
    });

    setResources(nextResources);
    setHostedSubscriptionResult(nextHostedSubscriptionResult);
    return nextResources;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await login(loginForm.username, loginForm.password);
      localStorage.setItem(sessionStorageKey, result.token);
      setToken(result.token);
      setAdmin(result.admin);
      setMessage(`欢迎回来，${result.admin.username}`);
      setLoginForm((current) => ({ ...current, password: '' }));
      await refreshSetupStatus();
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (setupForm.username.trim().length < 3) {
      reportValidationError('初始化用户名至少需要 3 个字符');
      return;
    }

    if (setupForm.password.length < 8) {
      reportValidationError('初始化密码至少需要 8 个字符');
      return;
    }

    if (setupForm.password !== setupForm.confirmPassword) {
      reportValidationError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await bootstrapSetup(setupForm.username.trim(), setupForm.password);
      localStorage.setItem(sessionStorageKey, result.token);
      setSetupStatus({ initialized: true, adminCount: 1 });
      setToken(result.token);
      setAdmin(result.admin);
      setSetupForm({ username: result.admin.username, password: '', confirmPassword: '' });
      setMessage(`初始化完成，欢迎 ${result.admin.username}`);
      await refreshResources(result.token);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      await refreshSetupStatus();
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    let logoutMessage = '已清除当前浏览器登录态';

    if (token) {
      try {
        const result = await logout(token);

        if (result.serverRevocation) {
          logoutMessage = '已退出登录并撤销当前服务端会话';
        }
      } catch {
      }
    }

    await clearPersistedSession(false);
    setMessage(logoutMessage);
    setError('');
  }

  async function withAction<T>(action: () => Promise<T>, successMessage?: string): Promise<void> {
    setLoading(true);
    setError('');

    try {
      await action();
      await refreshResources();
      if (successMessage) {
        setMessage(successMessage);
      }
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetCurrentHostedSubscriptionToken(): Promise<void> {
    if (!token) return;

    if (!autoHostedUser) {
      reportValidationError('当前还没有系统托管身份，请先执行一次“使用当前启用节点生成托管 URL”。');
      return;
    }

    if (!confirmDestructiveAction('确认重置当前托管链接吗？重置后旧的订阅 URL 会立即失效，客户端需要改成新的地址。')) {
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      await resetHostedSubscriptionToken(token);
      await refreshResources();
      setMessage('当前托管链接已重置。旧 URL 已失效，请复制新的托管 URL 并更新客户端。');
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function copyHostedUrl(url: string, target: SubscriptionTarget): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setError('');
      setMessage(`${target} 托管 URL：${url}`);
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setError('');
      setMessage(`${target} 托管 URL 已复制`);
    } catch (caughtError) {
      reportValidationError(`复制失败：${getErrorMessage(caughtError)}`);
    }
  }

  async function fetchRemoteNodeImportPreviewData(sourceUrl: string): Promise<NodeImportPreviewPayload> {
    if (!token) {
      throw new Error('当前未登录，无法抓取订阅 URL');
    }

    return previewNodeImportFromUrl(token, sourceUrl);
  }

  async function ensureAutoHostedTemplates(
    currentTemplates: TemplateRecord[],
    importedConfig?: ImportedConfigPayload | null
  ): Promise<void> {
    if (!token) {
      throw new Error('当前未登录，无法维护托管模板');
    }

    for (const target of SUBSCRIPTION_TARGETS) {
      const managedTemplate = findAutoHostedTemplate(currentTemplates, target);
      const desiredContent = buildAutoHostedTemplateContent(target, managedTemplate, importedConfig);

      if (!managedTemplate) {
        await createTemplate(token, {
          name: AUTO_HOSTED_TEMPLATE_NAMES[target],
          targetType: target,
          content: desiredContent,
          isDefault: true
        });
        continue;
      }

      const requiresContentRefresh = managedTemplate.content !== desiredContent;
      const requiresStateRefresh =
        managedTemplate.name !== AUTO_HOSTED_TEMPLATE_NAMES[target] ||
        managedTemplate.status !== 'enabled' ||
        !managedTemplate.isDefault;

      if (requiresContentRefresh || requiresStateRefresh) {
        await updateTemplate(token, managedTemplate.id, {
          name: AUTO_HOSTED_TEMPLATE_NAMES[target],
          content: desiredContent,
          enabled: true,
          isDefault: true,
          ...(requiresContentRefresh ? { version: managedTemplate.version + 1 } : {})
        });
      }
    }
  }

  async function ensureHostedSubscriptions(input: {
    currentResources: ResourceState;
    sourceLabel: string;
    nodeRecords: NodeRecord[];
  }): Promise<HostedSubscriptionResult> {
    if (!token) {
      throw new Error('当前未登录，无法生成托管 URL');
    }

    const matchedNodes = input.nodeRecords.filter((node) => node.enabled);

    if (matchedNodes.length === 0) {
      throw new Error('导入完成，但没有匹配到可托管的启用节点');
    }

    let managedUser = findAutoHostedUser(input.currentResources.users);

    if (!managedUser) {
      managedUser = await createUser(token, {
        name: AUTO_HOSTED_USER_NAME,
        remark: AUTO_HOSTED_USER_REMARK
      });
    } else if (
      managedUser.name !== AUTO_HOSTED_USER_NAME ||
      managedUser.remark !== AUTO_HOSTED_USER_REMARK ||
      managedUser.status !== 'active' ||
      managedUser.expiresAt
    ) {
      managedUser = await updateUser(token, managedUser.id, {
        name: AUTO_HOSTED_USER_NAME,
        remark: AUTO_HOSTED_USER_REMARK,
        status: 'active',
        expiresAt: null
      });
    }

    await ensureAutoHostedTemplates(input.currentResources.templates);

    const boundNodeIds = matchedNodes.map((node) => node.id);
    await replaceUserNodeBindings(token, managedUser.id, boundNodeIds);

    const targets = await Promise.all(
      SUBSCRIPTION_TARGETS.map(async (target): Promise<HostedSubscriptionTargetState> => {
        const url = buildHostedSubscriptionUrl(managedUser.token, target);

        try {
          const previewResult = await fetchPreview(token, managedUser.id, target);
          return {
            target,
            url,
            ok: true,
            detail: `${previewResult.metadata.nodeCount} 个节点，托管输出检查通过`
          };
        } catch (caughtError) {
          return {
            target,
            url,
            ok: false,
            detail: getErrorMessage(caughtError)
          };
        }
      })
    );

    return {
      userId: managedUser.id,
      userName: managedUser.name,
      token: managedUser.token,
      sourceLabel: input.sourceLabel,
      nodeCount: boundNodeIds.length,
      boundNodeIds,
      targets
    };
  }

  async function createImportedNodes(input: {
    importedNodes: ImportedNodePayload[];
    errorCount: number;
    onSuccess?: () => void;
  }): Promise<void> {
    if (!token) return;

    if (input.importedNodes.length === 0) {
      reportValidationError('没有可导入的节点');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { message } = await runNodeImportWorkflow({
        importedNodes: input.importedNodes,
        errorCount: input.errorCount,
        importNodes: (nodes) => importNodes(token, nodes),
        refreshResources: () => refreshResources(),
        onImported: input.onSuccess
      });
      setMessage(message);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleImportShareLinks(): Promise<void> {
    if (!token) return;

    if (!nodeImportText.trim()) {
      reportValidationError('请先粘贴分享链接');
      return;
    }

    await createImportedNodes({
      importedNodes: parsedNodeImport.nodes,
      errorCount: parsedNodeImport.errors.length,
      ...(parsedNodeImport.errors.length === 0 ? { onSuccess: () => setNodeImportText('') } : {})
    });
  }

  async function handleImportConfig(): Promise<void> {
    if (!token) return;

    if (!parsedConfigImport) {
      reportValidationError('请先粘贴可识别的 Mihomo / Clash YAML 或 sing-box JSON 配置');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { message } = await runConfigImportWorkflow({
        parsedConfigImport,
        importNodes: (nodes) => importNodes(token, nodes),
        refreshResources: () => refreshResources(),
        ensureAutoHostedTemplates
      });
      setMessage(message);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleImportRemoteUrlNodes(): Promise<void> {
    if (!token) return;

    const sourceUrl = nodeImportSourceUrl.trim();

    if (!sourceUrl) {
      reportValidationError('请先填写订阅 URL');
      return;
    }

    setLoading(true);
    setError('');

    let previewResult: NodeImportPreviewPayload;

    try {
      previewResult = await fetchRemoteNodeImportPreviewData(sourceUrl);
      setRemoteNodeImportPreview(previewResult);
      setMessage(buildRemotePreviewMessage(previewResult));
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
      return;
    } finally {
      setLoading(false);
    }

    if (previewResult.nodes.length === 0) {
      return;
    }

    await createImportedNodes({
      importedNodes: previewResult.nodes,
      errorCount: previewResult.errors.length
    });
  }

  async function handleDeleteNode(nodeId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该节点吗？')) return;

    await withAction(async () => {
      await deleteNode(token, nodeId);
    }, '节点已删除');

    if (nodeEditor?.nodeId === nodeId) {
      setNodeEditor(null);
      setNodeEditorIssues([]);
    }
  }

  function handleStartEditingNode(node: NodeRecord): void {
    setNodeEditor(createNodeEditorState(node));
    setNodeEditorIssues([]);
    setError('');
  }

  function handleCancelNodeEditor(): void {
    setNodeEditor(null);
    setNodeEditorIssues([]);
  }

  async function handleToggleNodeEnabled(node: NodeRecord): Promise<void> {
    if (!token) return;

    setNodeEditorIssues([]);

    await withAction(
      () =>
        updateNode(token, node.id, {
          enabled: !node.enabled
        }),
      node.enabled ? '节点已禁用' : '节点已启用'
    );

    if (nodeEditor?.nodeId === node.id) {
      setNodeEditor((current) => (current ? { ...current, enabled: !node.enabled } : current));
    }
  }

  async function handleSaveNodeEditor(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!token || !nodeEditor) {
      return;
    }

    const currentNode = resources.nodes.find((node) => node.id === nodeEditor.nodeId);

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

    let credentials: Record<string, JsonValue> | null;
    let paramsDraft: Record<string, JsonValue> | null;

    try {
      credentials = parseOptionalJsonObjectInput(nodeEditor.credentialsText, 'credentials');
      paramsDraft = parseOptionalJsonObjectInput(nodeEditor.paramsText, 'params');
    } catch (caughtError) {
      setNodeEditorIssues([getErrorMessage(caughtError)]);
      return;
    }

    const params = buildNodeEditorParams(paramsDraft, nodeEditor.upstreamProxy);
    const nextNode = buildNodeEditorDraft(currentNode, {
      ...nodeEditor,
      name,
      protocol,
      server
    }, port, credentials, params);
    const currentValidation = validateNodeChains({
      nodes: resources.nodes,
      proxyGroups: mihomoTopology.proxyGroups,
      proxyProviders: mihomoTopology.proxyProviders,
      includeDisabledNodes: true,
      allowProxyGroups: true,
      allowBuiltinReferences: true
    });
    const nextValidation = validateNodeChains({
      nodes: resources.nodes.map((node) => node.id === currentNode.id ? nextNode : node),
      proxyGroups: mihomoTopology.proxyGroups,
      proxyProviders: mihomoTopology.proxyProviders,
      includeDisabledNodes: true,
      allowProxyGroups: true,
      allowBuiltinReferences: true
    });
    const currentIssueKeys = new Set(currentValidation.issues.map(buildNodeChainIssueKey));
    const introducedIssues = nextValidation.issues.filter((issue) => !currentIssueKeys.has(buildNodeChainIssueKey(issue)));

    if (introducedIssues.length > 0) {
      setNodeEditorIssues(introducedIssues.map((issue) => issue.message));
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    setNodeEditorIssues([]);

    try {
      await updateNode(token, currentNode.id, {
        name,
        protocol,
        server,
        port,
        enabled: nodeEditor.enabled,
        credentials,
        params
      });
      await refreshResources();
      setNodeEditor(null);
      setMessage(`节点“${name}”已更新`);
    } catch (caughtError) {
      if (isAppApiError(caughtError) && caughtError.details?.scope === 'node_chain') {
        setNodeEditorIssues(extractNodeChainIssueMessages(caughtError.details?.issues));
        setError('');
      } else {
        await handleProtectedApiError(caughtError);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRemoteSubscriptionSource(): Promise<void> {
    if (!token) return;

    const sourceUrl = nodeImportSourceUrl.trim();

    if (!isValidHttpUrl(sourceUrl)) {
      reportValidationError('订阅 URL 必须是合法的 http / https 地址');
      return;
    }

    const sourceName = remoteSubscriptionSourceForm.name.trim() || buildRemoteSubscriptionSourceName(sourceUrl);

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { syncResult, message } = await runRemoteSubscriptionSourceSaveWorkflow({
        sourceName,
        sourceUrl,
        createRemoteSubscriptionSource: (payload) => createRemoteSubscriptionSource(token, payload),
        syncRemoteSubscriptionSource: (sourceId) => syncRemoteSubscriptionSource(token, sourceId),
        refreshResources: () => refreshResources()
      });
      setRemoteSubscriptionSyncResult(syncResult);
      setRemoteSubscriptionSourceForm(emptyRemoteSubscriptionSourceForm);
      setNodeImportSourceUrl('');
      setRemoteNodeImportPreview(null);
      setMessage(message);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateHostedFromEnabledNodes(): Promise<void> {
    if (!token) return;

    setLoading(true);
    setError('');

    try {
      const { hostedResult, message } = await runHostedGenerationWorkflow({
        currentResources: resources,
        nodeRecords: resources.nodes,
        ensureHostedSubscriptions,
        refreshResources: () => refreshResources()
      });
      setHostedSubscriptionResult(hostedResult);
      setMessage(message);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncSavedRemoteSubscriptionSource(source: RemoteSubscriptionSourceRecord): Promise<void> {
    if (!token) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await syncRemoteSubscriptionSource(token, source.id);
      setRemoteSubscriptionSyncResult(result);
      await refreshResources();
      setMessage(buildRemoteSubscriptionSourceSyncMessage(result));
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleRemoteSubscriptionSource(source: RemoteSubscriptionSourceRecord): Promise<void> {
    if (!token) return;

    await withAction(
      () =>
        updateRemoteSubscriptionSource(token, source.id, {
          enabled: !source.enabled
        }),
      source.enabled ? '已暂停该自动同步源' : '已启用该自动同步源'
    );
  }

  async function handleDeleteRemoteSubscriptionTask(source: RemoteSubscriptionSourceRecord): Promise<void> {
    if (!token || !confirmDestructiveAction(`确认删除自动同步源“${source.name}”吗？这会移除该来源同步出的节点。`)) {
      return;
    }

    await withAction(async () => {
      await deleteRemoteSubscriptionSource(token, source.id);
      if (remoteSubscriptionSyncResult?.sourceId === source.id) {
        setRemoteSubscriptionSyncResult(null);
      }
    }, '自动同步源已删除');
  }

  if (!token || !admin) {
    return (
      <main className="page auth-page">
        <section className="hero">
          <p className="eyebrow">SubForge / Single-user Hosted</p>
          <h1>{metadata.name}</h1>
          <p className="lead">{metadata.description}</p>
        </section>

        <section className="auth-card">
          {setupStatus?.initialized === false ? (
            <>
              <h2>首次安装向导</h2>
              <form className="form-grid" onSubmit={handleSetup}>
                <label>
                  <span>管理员用户名</span>
                  <input
                    value={setupForm.username}
                    onChange={(event) => setSetupForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="admin"
                  />
                </label>
                <label>
                  <span>管理员密码</span>
                  <input
                    type="password"
                    value={setupForm.password}
                    onChange={(event) => setSetupForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="至少 8 位"
                  />
                </label>
                <label>
                  <span>确认密码</span>
                  <input
                    type="password"
                    value={setupForm.confirmPassword}
                    onChange={(event) => setSetupForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                    placeholder="再次输入管理员密码"
                  />
                </label>
                <button type="submit" disabled={loading}>
                  {loading ? '初始化中...' : '创建首个管理员'}
                </button>
              </form>
              <p className="helper">当前系统还没有管理员账号。完成初始化后会自动登录，无需再跑 `seed:admin`。</p>
            </>
          ) : setupStatus === null ? (
            <>
              <h2>加载安装状态</h2>
              <p className="helper">正在检查是否已完成首次初始化...</p>
            </>
          ) : (
            <>
              <h2>管理员登录</h2>
              <form className="form-grid" onSubmit={handleLogin}>
                <label>
                  <span>用户名</span>
                  <input
                    value={loginForm.username}
                    onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="admin"
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="输入管理员密码"
                  />
                </label>
                <button type="submit" disabled={loading}>
                  {loading ? '登录中...' : '登录'}
                </button>
              </form>
              <p className="helper">默认会请求 `VITE_API_BASE_URL`，未配置时使用 `http://127.0.0.1:8787`。</p>
            </>
          )}
          {error ? <p className="feedback error">{error}</p> : null}
          {message ? <p className="feedback success">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="hero hero-row">
        <div>
          <p className="eyebrow">SubForge / Single-user Hosted</p>
          <h1>{metadata.name}</h1>
          <p className="lead">{metadata.description}</p>
        </div>
        <div className="hero-actions">
          <span className="badge">{admin.username}</span>
          <button type="button" onClick={() => void refreshResources()} disabled={loading}>
            刷新数据
          </button>
          <button type="button" className="secondary" onClick={() => void handleLogout()}>
            退出登录
          </button>
        </div>
      </section>

      <section className="summary-grid">
        {summary.map((item) => (
          <article className="stat-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      {error ? <p className="feedback error">{error}</p> : null}
      {message ? <p className="feedback success">{message}</p> : null}

      <section className="panel-grid main-grid">
          <article className="panel full-width">
            <h2>节点主入口</h2>
            <p className="helper">
              这里现在只强调一条主流程：先导入到节点列表，再调整节点，最后统一生成托管 URL。
            </p>
            <div className="inline-meta">
              <span>第 1 步：导入到节点列表</span>
              <span>第 2 步：统一调整启用状态和节点字段</span>
              <span>第 3 步：使用当前启用节点生成托管 URL</span>
              <span>分享链接 / Base64 / YAML / JSON 都支持</span>
              <span>订阅 URL 可保存为自动同步源</span>
            </div>
            <div className="metadata-grid">
              {singleUserWorkflowSteps.map((step) => (
                <div className="result-card" key={step.id}>
                  <strong>{step.title}</strong>
                  <span>当前状态：{getWorkflowStepStatusLabel(step.status)}</span>
                  <span>{step.detail}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="panel full-width">
            <h2>统一生成托管订阅</h2>
            <p className="helper">
              这是唯一的生成出口。当你已经导入并调整完节点后，使用这里按当前启用节点整体刷新托管 URL。
            </p>
            <p className="helper">{hostedSubscriptionSyncStatus.detail}</p>
            <p className="helper">
              公开订阅不会复用管理员登录态。系统会单独维护一份内部托管身份来承载 `/s/:token/...` 链接；如果你要让旧链接失效，请直接在这里重置当前托管链接。
            </p>
            <div className="inline-actions">
              <button type="button" disabled={loading || enabledNodeCount === 0} onClick={() => void handleGenerateHostedFromEnabledNodes()}>
                使用当前启用节点生成托管 URL
              </button>
              <button type="button" className="secondary" disabled={loading || !autoHostedUser} onClick={() => void handleResetCurrentHostedSubscriptionToken()}>
                重置当前托管链接
              </button>
              <span>当前启用节点：{enabledNodeCount}</span>
              <span>托管状态：{getHostedSyncStatusLabel(hostedSubscriptionSyncStatus)}</span>
              {hostedSubscriptionResult ? <span>当前托管绑定：{hostedSubscriptionResult.nodeCount}</span> : null}
              <span>托管身份：{autoHostedUser ? autoHostedUser.name : '首次生成时自动创建'}</span>
            </div>
            {enabledNodeWarnings.length > 0 ? (
              <div className="import-errors">
                <strong>当前启用节点风险提示</strong>
                <span>这些问题不会阻止生成托管 URL，但很可能导致客户端导入后节点不可用或全部显示为红色。</span>
                <ul className="overview-list">
                  {enabledNodeWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            ) : null}
          </article>

          {hostedSubscriptionResult ? (
            <article className="panel full-width">
              <h2>当前托管 URL</h2>
              <p className="helper">
                当前状态：{hostedSubscriptionResult.sourceLabel}。系统会复用同一组个人托管链接，当前这组托管订阅已绑定 {hostedSubscriptionResult.nodeCount} 个节点。
              </p>
              <p className="helper">
                当前节点页会直接管理这份内部托管身份，不再依赖隐藏的用户页。若你需要轮换链接，只用上方“重置当前托管链接”。
              </p>
              <div className="metadata-grid">
                {hostedSubscriptionResult.targets.map((target) => (
                  <div className="result-card" key={target.target}>
                    <strong>{target.target}</strong>
                    <a className="result-link" href={target.url} target="_blank" rel="noreferrer">
                      {target.url}
                    </a>
                    <span>{target.ok ? '输出检查通过' : '输出检查失败'}</span>
                    <span>{target.detail}</span>
                    <div className="inline-actions">
                      <button type="button" className="secondary" onClick={() => void copyHostedUrl(target.url, target.target)}>
                        复制 URL
                      </button>
                      <a className="button-link" href={target.url} target="_blank" rel="noreferrer">
                        打开
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ) : null}

          <article className="panel">
            <h2>节点文本导入</h2>
            <div className="form-grid">
              <Field label="分享链接 / Base64 / 节点 JSON">
                <textarea
                  value={nodeImportText}
                  onChange={(event) => setNodeImportText(event.target.value)}
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
              <p className="helper full-span">
                适合直接粘贴节点文本。这里会优先识别分享链接、Base64 订阅文本和 JSON 节点清单；如果是完整 Mihomo / sing-box 配置，更适合放到右侧“导入完整配置”。
              </p>
              {parsedNodeImport.lineCount > 0 ? (
                <p className="helper full-span">
                  当前识别内容：{formatNodeImportContentEncoding(parsedNodeImport.contentEncoding)}，有效行 {parsedNodeImport.lineCount}
                </p>
              ) : null}
              <div className="inline-actions full-span">
                <button
                  type="button"
                  disabled={loading || parsedNodeImport.nodes.length === 0}
                  onClick={() => void handleImportShareLinks()}
                >
                  导入节点 {parsedNodeImport.nodes.length}
                </button>
              </div>
              {summarizedParsedNodeImportErrors.length > 0 ? (
                <div className="import-errors full-span">
                  <strong>解析错误</strong>
                  <ul className="overview-list">
                    {summarizedParsedNodeImportErrors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                  </ul>
                </div>
              ) : null}
              {parsedNodeImport.nodes.length > 0 ? (
                <details className="disclosure full-span" open={parsedNodeImport.nodes.length <= 3}>
                  <summary>查看识别结果（{parsedNodeImport.nodes.length}）</summary>
                  <div className="disclosure-body">
                    <ResourceTable
                      columns={['名称', '协议', '地址', '端口', '元数据']}
                      rows={parsedNodeImport.nodes.map((node) => [
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
          </article>

          <article className="panel">
            <h2>订阅 URL 解析</h2>
            <div className="form-grid">
              <Field label="订阅 URL">
                <input
                  value={nodeImportSourceUrl}
                  onChange={(event) => {
                    setNodeImportSourceUrl(event.target.value);
                    setRemoteNodeImportPreview(null);
                  }}
                  placeholder="https://example.com/subscription.txt"
                />
              </Field>
              <Field label="自动同步源名称（可选）">
                <input
                  value={remoteSubscriptionSourceForm.name}
                  onChange={(event) =>
                    setRemoteSubscriptionSourceForm((current) => ({
                      ...current,
                      name: event.target.value
                    }))
                  }
                  placeholder="默认使用域名 / 路径生成"
                />
              </Field>
              <p className="helper full-span">
                这里分成两条明确路径：要么抓取一次并导入节点列表，要么保存成自动同步源。无论哪条路径，最后都要回到“使用当前启用节点生成托管 URL”。
              </p>
              <div className="inline-actions full-span">
                <button
                  type="button"
                  disabled={loading || !nodeImportSourceUrl.trim()}
                  onClick={() => void handleImportRemoteUrlNodes()}
                >
                  抓取并导入节点
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={loading || !nodeImportSourceUrl.trim()}
                  onClick={() => void handleSaveRemoteSubscriptionSource()}
                >
                  保存为自动同步源
                </button>
              </div>
              {remoteNodeImportPreview ? (
                <>
                  <div className="metadata-grid full-span">
                    <div className="result-card">
                      <strong>抓取摘要</strong>
                      <span>HTTP {remoteNodeImportPreview.upstreamStatus}</span>
                      <span>耗时 {remoteNodeImportPreview.durationMs} ms</span>
                      <span>体积 {remoteNodeImportPreview.fetchedBytes} bytes</span>
                      <span>内容 {formatNodeImportContentEncoding(remoteNodeImportPreview.contentEncoding)}</span>
                      <span>有效行 {remoteNodeImportPreview.lineCount}</span>
                    </div>
                  </div>
                  {summarizedRemoteNodeImportErrors.length > 0 ? (
                    <div className="import-errors full-span">
                      <strong>解析错误</strong>
                      <ul className="overview-list">
                        {summarizedRemoteNodeImportErrors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {remoteNodeImportPreview.nodes.length > 0 ? (
                    <details className="disclosure full-span" open={remoteNodeImportPreview.nodes.length <= 3}>
                      <summary>查看识别结果（{remoteNodeImportPreview.nodes.length}）</summary>
                      <div className="disclosure-body">
                        <ResourceTable
                          columns={['名称', '协议', '地址', '端口', '元数据']}
                          rows={remoteNodeImportPreview.nodes.map((node) => [
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
                      当前没有解析出可导入节点。请先检查远程内容是否确实包含分享链接、可识别的 `proxies` / `outbounds`，或完整的节点数组。
                    </p>
                  )}
                </>
              ) : null}
              {effectiveRemoteSyncSourceName && effectiveRemoteSyncStatus ? (
                <div className="metadata-grid full-span">
                  <div className="result-card">
                    <strong>最近一次自动同步</strong>
                    <span>{effectiveRemoteSyncSourceName}</span>
                    <span>状态 {effectiveRemoteSyncStatus}</span>
                    {effectiveRemoteSyncAt ? <span>时间 {effectiveRemoteSyncAt}</span> : null}
                    {effectiveRemoteSyncMessage ? <span>{effectiveRemoteSyncMessage}</span> : null}
                    {remoteSubscriptionSyncResult ? (
                      <>
                        <span>节点 {remoteSubscriptionSyncResult.importedCount}</span>
                        <span>
                          变更 {remoteSubscriptionSyncResult.createdCount} / {remoteSubscriptionSyncResult.updatedCount} /{' '}
                          {remoteSubscriptionSyncResult.disabledCount}
                        </span>
                      </>
                    ) : (
                      latestPersistedRemoteSyncSource ? <span>失败次数 {latestPersistedRemoteSyncSource.failureCount}</span> : null
                    )}
                  </div>
                </div>
              ) : null}
              {remoteSyncNodeChainDiagnostics ? (
                <details className="full-span" open>
                  <summary>链式代理校验详情（{remoteSyncNodeChainDiagnostics.issueCount}）</summary>
                  <div className="metadata-grid">
                    {remoteSyncNodeChainDiagnostics.issues.map((issue) => (
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
                </details>
              ) : null}
              <div className="full-span">
                <strong>已保存的自动同步源</strong>
              </div>
              {resources.remoteSubscriptionSources.length > 0 ? (
                <ResourceTable
                  columns={['同步源', '上游 URL', '状态', '最近同步', '最近结果', '失败次数', '操作']}
                  rows={resources.remoteSubscriptionSources.map((source) => [
                    source.name,
                    source.sourceUrl,
                    `${source.enabled ? 'enabled' : 'paused'} / ${source.lastSyncStatus ?? 'never'}`,
                    source.lastSyncAt ?? 'never',
                    source.lastSyncMessage ?? '-',
                    source.failureCount,
                    <div className="inline-actions" key={source.id}>
                      <button type="button" className="secondary" onClick={() => void handleSyncSavedRemoteSubscriptionSource(source)}>
                        立即同步
                      </button>
                      <button type="button" className="secondary" onClick={() => void handleToggleRemoteSubscriptionSource(source)}>
                        {source.enabled ? '暂停' : '启用'}
                      </button>
                      <button type="button" className="danger" onClick={() => void handleDeleteRemoteSubscriptionTask(source)}>
                        删除
                      </button>
                    </div>
                  ])}
                />
              ) : (
                <p className="helper full-span">当前还没有自动同步源。保存后，后续 Cron 会继续拉取并更新这组节点。</p>
              )}
            </div>
          </article>

          <article className="panel">
            <h2>导入完整配置</h2>
            <div className="form-grid">
              <Field label="Mihomo / Clash YAML 或 sing-box JSON" full>
                <textarea
                  value={configImportText}
                  onChange={(event) => setConfigImportText(event.target.value)}
                  rows={10}
                  placeholder={fullConfigImportPlaceholder}
                />
              </Field>
              <p className="helper full-span">
                这里会提取节点，并把配置里的关键输出结构写入自动托管模板骨架。导入后仍然回到统一生成步骤，不单独绕过主流程。
              </p>
              {configImportText.trim() && !parsedConfigImport ? (
                <p className="helper full-span">
                  当前还没有识别为可导入的完整配置。请确认内容是完整的 Clash / Mihomo YAML，或 sing-box JSON。
                </p>
              ) : null}
              {parsedConfigImport ? (
                <>
                  <div className="inline-actions full-span">
                    <button
                      type="button"
                      disabled={loading || parsedConfigImport.nodes.length === 0}
                      onClick={() => void handleImportConfig()}
                    >
                      导入配置
                    </button>
                  </div>
                  <div className="metadata-grid full-span">
                    <div className="result-card">
                      <strong>导入摘要</strong>
                      <span>格式：{parsedConfigImport.format}</span>
                      <span>目标：{parsedConfigImport.targetType}</span>
                      <span>节点：{parsedConfigImport.nodes.length}</span>
                    </div>
                    <div className="result-card">
                      <strong>导入诊断</strong>
                      <span>警告：{parsedConfigImport.warnings.length}</span>
                      <span>节点解析错误：{parsedConfigImport.errors.length}</span>
                      <span>链式代理：已自动读取 `dialer-proxy` / `detour` 为 `params.upstreamProxy`</span>
                    </div>
                  </div>
                  {parsedConfigImport.warnings.length > 0 ? (
                    <div className="result-card full-span">
                      <strong>导入警告</strong>
                      <ul className="overview-list">
                        {parsedConfigImport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {parsedConfigImport.errors.length > 0 ? (
                    <div className="import-errors full-span">
                      <strong>节点解析错误</strong>
                      <ul className="overview-list">
                        {parsedConfigImport.errors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {parsedConfigImport.nodes.length > 0 ? (
                    <details className="disclosure full-span" open={parsedConfigImport.nodes.length <= 3}>
                      <summary>查看识别节点（{parsedConfigImport.nodes.length}）</summary>
                      <div className="disclosure-body">
                        <ResourceTable
                          columns={['名称', '协议', '地址', '端口', '元数据']}
                          rows={parsedConfigImport.nodes.map((node) => [
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
          </article>

          <article className="panel full-width">
            <h2>链式代理拓扑</h2>
            <p className="helper">
              这里根据每个节点的 `params.upstreamProxy` 计算链路，方便检查 `dialer-proxy` / `detour` 是否连对了。如果上游引用的是组名，系统会结合当前托管的 Mihomo 输出结构继续展开。
            </p>
            {preferredMihomoTemplate ? (
              <div className="inline-meta">
                <span>当前托管 Mihomo 骨架：{preferredMihomoTemplate.name}</span>
                <span>代理组：{mihomoProxyGroupNames.length}</span>
                <span>Providers：{mihomoTopology.proxyProviders.length}</span>
              </div>
            ) : (
              <p className="helper">当前还没有托管 Mihomo 骨架，链路只会按节点间引用解析。</p>
            )}
            {mihomoTopology.error ? <p className="helper">当前托管 Mihomo 骨架解析失败：{mihomoTopology.error}</p> : null}
            <ResourceTable
              columns={['节点', '上游代理', '链路', '状态']}
              rows={nodeChainSummaries.map((item) => [
                item.nodeName,
                item.upstreamProxy ?? 'direct',
                item.chain,
                item.issue ?? '正常'
              ])}
            />
          </article>

          <article className="panel full-width">
            <h2>节点列表</h2>
            <p className="helper">
              现在可以直接在这里编辑节点、切换启用状态和调整节点级链式代理。内置编辑器默认只提供节点级上游，避免 Mihomo 和 sing-box 再次跑偏。
            </p>
            {nodeEditor ? (
              <div className="result-card full-span">
                <strong>当前编辑：{nodeEditor.name || '未命名节点'}</strong>
                <div className="inline-meta">
                  <span>已保存链路：{editingNodeSummary?.chain ?? '未找到'}</span>
                  <span>当前状态：{editingNodeSummary?.issue ?? '正常'}</span>
                </div>
                {nodeEditorHasLegacyUpstream ? (
                  <p className="helper">
                    当前上游是历史引用值。你可以先保留，但更推荐改成具体节点或 `direct`，这样 Mihomo / sing-box 的行为会更一致。
                  </p>
                ) : null}
                {nodeEditorIssues.length > 0 ? (
                  <div className="import-errors">
                    <strong>保存前需处理的问题</strong>
                    <ul className="overview-list">
                      {nodeEditorIssues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                ) : null}
                <form className="form-grid" onSubmit={(event) => void handleSaveNodeEditor(event)}>
                  <Field label="名称">
                    <input
                      value={nodeEditor.name}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, name: event.target.value } : current)}
                      placeholder="节点名称"
                    />
                  </Field>
                  <Field label="协议">
                    <input
                      value={nodeEditor.protocol}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, protocol: event.target.value } : current)}
                      placeholder="vless / trojan / ss / hysteria2"
                    />
                  </Field>
                  <Field label="地址">
                    <input
                      value={nodeEditor.server}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, server: event.target.value } : current)}
                      placeholder="example.com"
                    />
                  </Field>
                  <Field label="端口">
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      value={nodeEditor.port}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, port: event.target.value } : current)}
                      placeholder="443"
                    />
                  </Field>
                  <Field label="启用状态">
                    <select
                      value={nodeEditor.enabled ? 'enabled' : 'disabled'}
                      onChange={(event) =>
                        setNodeEditor((current) => current ? { ...current, enabled: event.target.value === 'enabled' } : current)}
                    >
                      <option value="enabled">enabled</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </Field>
                  <Field label="上游代理">
                    <select
                      value={nodeEditor.upstreamProxy}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, upstreamProxy: event.target.value } : current)}
                    >
                      <option value="">direct</option>
                      {nodeEditorUpstreamOptions.map((option) => (
                        <option key={`${option.value}-${option.label}`} value={option.value} disabled={option.disabled}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="credentials JSON" full>
                    <textarea
                      rows={8}
                      value={nodeEditor.credentialsText}
                      onChange={(event) =>
                        setNodeEditor((current) => current ? { ...current, credentialsText: event.target.value } : current)}
                      placeholder='{"uuid":"..."}'
                    />
                  </Field>
                  <Field label="params JSON" full>
                    <textarea
                      rows={8}
                      value={nodeEditor.paramsText}
                      onChange={(event) => setNodeEditor((current) => current ? { ...current, paramsText: event.target.value } : current)}
                      placeholder='{"tls":true,"servername":"example.com"}'
                    />
                  </Field>
                  <div className="inline-actions full-span">
                    <button type="submit" disabled={loading}>
                      {loading ? '保存中...' : '保存节点'}
                    </button>
                    <button type="button" className="secondary" disabled={loading} onClick={() => handleCancelNodeEditor()}>
                      取消
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <p className="helper">点下方节点列表里的“编辑”，即可修改节点名字、启用状态和上游代理。</p>
            )}
            <ResourceTable
              columns={['名称', '协议', '地址', '端口', '来源', '元数据', '状态', '操作']}
              rows={resources.nodes.map((node) => [
                node.name,
                node.protocol,
                node.server,
                node.port,
                node.sourceType,
                summarizeNodeMetadata(node),
                node.enabled ? 'enabled' : 'disabled',
                <div className="inline-actions" key={node.id}>
                  <button type="button" onClick={() => handleStartEditingNode(node)}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void handleToggleNodeEnabled(node)}>
                    {node.enabled ? '禁用' : '启用'}
                  </button>
                  <button type="button" className="danger" onClick={() => void handleDeleteNode(node.id)}>删除</button>
                </div>
              ])}
            />
          </article>
      </section>
    </main>
  );
}
function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function confirmDestructiveAction(message: string): boolean {
  return typeof window === 'undefined' ? true : window.confirm(message);
}

function selectPreferredMihomoTemplate(templates: TemplateRecord[]): TemplateRecord | null {
  const enabledMihomoTemplates = templates.filter((template) => template.targetType === 'mihomo' && template.status === 'enabled');
  const preferredEnabledTemplate = enabledMihomoTemplates.find((template) => template.isDefault) ?? enabledMihomoTemplates[0];

  if (preferredEnabledTemplate) {
    return preferredEnabledTemplate;
  }

  const mihomoTemplates = templates.filter((template) => template.targetType === 'mihomo');
  return mihomoTemplates.find((template) => template.isDefault) ?? mihomoTemplates[0] ?? null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function createNodeEditorState(node: NodeRecord): NodeEditorState {
  const upstreamProxy = typeof node.params?.upstreamProxy === 'string' ? node.params.upstreamProxy.trim() : '';
  const paramsText = node.params
    ? JSON.stringify(
      Object.fromEntries(Object.entries(node.params).filter(([key]) => key !== 'upstreamProxy')),
      null,
      2
    )
    : '';

  return {
    nodeId: node.id,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    port: String(node.port),
    enabled: node.enabled,
    upstreamProxy,
    credentialsText: node.credentials ? JSON.stringify(node.credentials, null, 2) : '',
    paramsText: paramsText === '{}' ? '' : paramsText
  };
}

function parseOptionalJsonObjectInput(value: string, fieldName: string): Record<string, JsonValue> | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${fieldName} 必须是合法 JSON 对象`);
  }

  if (parsed === null) {
    return null;
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`);
  }

  return parsed as Record<string, JsonValue>;
}

function buildNodeEditorParams(params: Record<string, JsonValue> | null, upstreamProxy: string): Record<string, JsonValue> | null {
  const nextParams = { ...(params ?? {}) };
  delete nextParams.upstreamProxy;

  if (upstreamProxy.trim()) {
    nextParams.upstreamProxy = upstreamProxy.trim();
  }

  return Object.keys(nextParams).length > 0 ? nextParams : null;
}

function buildNodeEditorDraft(
  currentNode: NodeRecord,
  editor: Pick<NodeEditorState, 'name' | 'protocol' | 'server' | 'enabled'>,
  port: number,
  credentials: Record<string, JsonValue> | null,
  params: Record<string, JsonValue> | null
): NodeRecord {
  const nextNode: NodeRecord = {
    ...currentNode,
    name: editor.name,
    protocol: editor.protocol,
    server: editor.server,
    port,
    enabled: editor.enabled
  };

  if (credentials) {
    nextNode.credentials = credentials;
  } else {
    delete nextNode.credentials;
  }

  if (params) {
    nextNode.params = params;
  } else {
    delete nextNode.params;
  }

  return nextNode;
}

function buildNodeChainIssueKey(issue: { nodeId: string; kind: string; reference?: string | null; message: string }): string {
  return [issue.nodeId, issue.kind, issue.reference ?? '', issue.message].join('::');
}

function extractNodeChainIssueMessages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['节点链路校验失败'];
  }

  const messages = value.flatMap((item) => {
    if (typeof item === 'object' && item !== null && 'message' in item && typeof item.message === 'string') {
      return [item.message];
    }

    return [];
  });

  return messages.length > 0 ? messages : ['节点链路校验失败'];
}

function buildNodeUpstreamOptions(
  nodes: NodeRecord[],
  editor: Pick<NodeEditorState, 'nodeId' | 'upstreamProxy'>
): Array<{ value: string; label: string; disabled?: boolean; legacy?: boolean }> {
  const grouped = new Map<string, { enabled: boolean; count: number }>();

  for (const node of nodes) {
    if (node.id === editor.nodeId) {
      continue;
    }

    const name = node.name.trim();

    if (!name) {
      continue;
    }

    const current = grouped.get(name) ?? { enabled: false, count: 0 };
    grouped.set(name, {
      enabled: current.enabled || node.enabled,
      count: current.count + 1
    });
  }

  const options: Array<{ value: string; label: string; disabled?: boolean; legacy?: boolean }> = [...grouped.entries()].map(([name, info]) => ({
    value: name,
    label: info.count > 1 ? `${name}（同名 ${info.count} 个）` : `${name}${info.enabled ? '' : '（已禁用）'}`,
    disabled: !info.enabled
  }));
  const currentUpstream = editor.upstreamProxy.trim();

  if (currentUpstream && !grouped.has(currentUpstream)) {
    options.unshift({
      value: currentUpstream,
      label: `当前值（历史引用）: ${currentUpstream}`,
      legacy: true
    });
  }

  return options;
}

function buildAutoHostedTemplateContent(
  target: SubscriptionTarget,
  existingTemplate?: TemplateRecord | null,
  importedConfig?: ImportedConfigPayload | null
): string {
  if (importedConfig?.targetType === target) {
    return importedConfig.templateContent;
  }

  if (existingTemplate?.content.trim()) {
    return existingTemplate.content;
  }

  return target === 'mihomo' ? AUTO_HOSTED_MIHOMO_TEMPLATE : AUTO_HOSTED_SINGBOX_TEMPLATE;
}


function Field(props: { label: string; children: ReactNode; full?: boolean }): JSX.Element {
  return (
    <label className={props.full ? 'full-span' : undefined}>
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function ResourceTable(props: { columns: string[]; rows: Array<Array<ReactNode>> }): JSX.Element {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length > 0 ? (
            props.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={props.columns.length}>暂无数据</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
