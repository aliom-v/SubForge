import { useEffect, useMemo, useState, type FormEvent } from 'react';

import {
  getServiceMetadata,
  normalizeManagedMihomoTemplateContent
} from '@subforge/core';
import {
  SUBSCRIPTION_TARGETS,
  type SubscriptionTarget,
  type TemplateRecord
} from '@subforge/shared';

import {
  bootstrapSetup,
  createRemoteSubscriptionSource,
  createTemplate,
  createUser,
  fetchMe,
  fetchNodes,
  fetchPreview,
  fetchRemoteSubscriptionSources,
  fetchSetupStatus,
  fetchTemplates,
  fetchUserNodeBindings,
  fetchUsers,
  importNodes,
  isAppApiError,
  login,
  logout,
  mutateNodesBatch,
  previewNodeImportFromUrl,
  replaceUserNodeBindings,
  resetHostedSubscriptionToken,
  syncRemoteSubscriptionSource,
  updateNode,
  updateRemoteSubscriptionSource,
  updateTemplate,
  updateUser,
  deleteRemoteSubscriptionSource,
  type AdminSession,
  type NodeImportPreviewPayload,
  type RemoteSubscriptionSourceSyncPayload,
  type SetupStatusPayload
} from './api';
import type { RemoteSubscriptionSourceForm, ResourceState } from './app-types';
import {
  getErrorMessage,
  shouldClearProtectedSession
} from './error-handling';
import {
  AUTO_HOSTED_TEMPLATE_NAMES,
  AUTO_HOSTED_USER_NAME,
  AUTO_HOSTED_USER_REMARK,
  buildHostedSubscriptionDiagnostics,
  buildHostedSubscriptionUrl,
  findAutoHostedTemplate,
  findAutoHostedUser,
  getHostedSubscriptionSyncStatus,
  resolveCurrentHostedSubscriptionResult,
  type HostedSubscriptionDiagnostics,
  type HostedSubscriptionResult,
  type HostedSubscriptionTargetState
} from './hosted-state';
import {
  buildImportedNodeWarnings,
  parseImportedConfig,
  parseNodeImportText,
  type ImportedConfigPayload,
  type ImportedNodePayload
} from './node-import';
import { getRemoteSyncNodeChainDiagnostics } from './remote-sync-diagnostics';
import {
  buildRemotePreviewMessage,
  buildRemoteSubscriptionSourceSyncMessage
} from './workflow-feedback';
import {
  runConfigImportWorkflow,
  runHostedGenerationWorkflow,
  runNodeImportWorkflow,
  runRemoteSubscriptionSourceSaveWorkflow
} from './workflow-orchestration';
import {
  buildSingleUserWorkflowSteps,
  getWorkflowStepStatusLabel
} from './workflow-progress';
import { HostedSubscriptionSection } from './components/HostedSubscriptionSection';
import { NodeImportSection } from './components/NodeImportSection';
import {
  NodeManagementSection,
  type NodeEditorSubmitInput
} from './components/NodeManagementSection';

const metadata = getServiceMetadata();
const sessionStorageKey = 'subforge.admin.token';

const emptyResources: ResourceState = {
  users: [],
  nodes: [],
  templates: [],
  remoteSubscriptionSources: []
};

const AUTO_HOSTED_MIHOMO_TEMPLATE = [
  'mixed-port: 7890',
  'mode: rule',
  'proxies:',
  '{{proxies}}',
  'proxy-groups:',
  '{{proxy_groups}}',
  'rules:',
  '{{rules}}'
].join('\n');

const AUTO_HOSTED_SINGBOX_TEMPLATE = [
  '{',
  '  "outbounds": {{outbounds}},',
  '  "route": {',
  '    "rules": {{rules}}',
  '  }',
  '}'
].join('\n');

const emptyRemoteSubscriptionSourceForm: RemoteSubscriptionSourceForm = {
  name: '',
  sourceUrl: ''
};

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
  const [remoteNodeImportPreview, setRemoteNodeImportPreview] =
    useState<NodeImportPreviewPayload | null>(null);
  const [remoteSubscriptionSourceForm, setRemoteSubscriptionSourceForm] =
    useState<RemoteSubscriptionSourceForm>(emptyRemoteSubscriptionSourceForm);

  const summary = useMemo(
    () => [
      { label: 'Nodes', value: resources.nodes.length },
      {
        label: 'Hosted URLs',
        value: hostedSubscriptionResult?.targets.length ?? SUBSCRIPTION_TARGETS.length
      },
      { label: 'Hosted Nodes', value: hostedSubscriptionResult?.nodeCount ?? 0 }
    ],
    [hostedSubscriptionResult, resources.nodes.length]
  );
  const autoHostedUser = useMemo(
    () => findAutoHostedUser(resources.users),
    [resources.users]
  );
  const enabledNodes = useMemo(
    () => resources.nodes.filter((node) => node.enabled),
    [resources.nodes]
  );
  const enabledNodeCount = enabledNodes.length;
  const enabledNodeWarnings = useMemo(
    () => buildImportedNodeWarnings(enabledNodes),
    [enabledNodes]
  );
  const hostedSubscriptionSyncStatus = useMemo(
    () => getHostedSubscriptionSyncStatus(hostedSubscriptionResult, resources.nodes),
    [hostedSubscriptionResult, resources.nodes]
  );
  const hostedSubscriptionDiagnostics = useMemo<HostedSubscriptionDiagnostics | null>(
    () => buildHostedSubscriptionDiagnostics(hostedSubscriptionResult, resources.nodes),
    [hostedSubscriptionResult, resources.nodes]
  );
  const latestPersistedRemoteSyncSource = useMemo(
    () =>
      [...resources.remoteSubscriptionSources]
        .filter((source) => source.lastSyncAt)
        .sort((left, right) => Date.parse(right.lastSyncAt ?? '') - Date.parse(left.lastSyncAt ?? ''))[0] ?? null,
    [resources.remoteSubscriptionSources]
  );
  const effectiveRemoteSyncSourceName =
    remoteSubscriptionSyncResult?.sourceName ??
    latestPersistedRemoteSyncSource?.name ??
    null;
  const effectiveRemoteSyncStatus =
    remoteSubscriptionSyncResult?.status ??
    latestPersistedRemoteSyncSource?.lastSyncStatus ??
    null;
  const effectiveRemoteSyncMessage =
    remoteSubscriptionSyncResult?.message ??
    latestPersistedRemoteSyncSource?.lastSyncMessage ??
    null;
  const effectiveRemoteSyncAt =
    remoteSubscriptionSyncResult?.importedAt ??
    latestPersistedRemoteSyncSource?.lastSyncAt ??
    null;
  const latestPersistedRemoteFailureCount =
    latestPersistedRemoteSyncSource?.failureCount ?? null;
  const remoteSyncNodeChainDiagnostics = useMemo(
    () =>
      getRemoteSyncNodeChainDiagnostics(
        remoteSubscriptionSyncResult ?? latestPersistedRemoteSyncSource
      ),
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
  const parsedNodeImport = useMemo(
    () => parseNodeImportText(nodeImportText),
    [nodeImportText]
  );
  const parsedConfigImport = useMemo(
    () => parseImportedConfig(configImportText),
    [configImportText]
  );
  const summarizedParsedNodeImportErrors = useMemo(
    () => summarizeImportErrors(parsedNodeImport.errors),
    [parsedNodeImport.errors]
  );
  const summarizedRemoteNodeImportErrors = useMemo(
    () => summarizeImportErrors(remoteNodeImportPreview?.errors ?? []),
    [remoteNodeImportPreview?.errors]
  );

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
      setSetupForm({
        username: result.admin.username,
        password: '',
        confirmPassword: ''
      });
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

  async function withAction<T>(
    action: () => Promise<T>,
    successMessage?: string
  ): Promise<void> {
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
    if (!token) {
      return;
    }

    if (!autoHostedUser) {
      reportValidationError('当前还没有系统托管身份，请先执行一次“使用当前启用节点生成托管 URL”。');
      return;
    }

    if (
      !confirmDestructiveAction(
        '确认重置当前托管链接吗？重置后旧的订阅 URL 会立即失效，客户端需要改成新的地址。'
      )
    ) {
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

  async function fetchRemoteNodeImportPreviewData(
    sourceUrl: string
  ): Promise<NodeImportPreviewPayload> {
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
      const desiredContent = buildAutoHostedTemplateContent(
        target,
        managedTemplate,
        importedConfig
      );

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
          ...(requiresContentRefresh
            ? { version: managedTemplate.version + 1 }
            : {})
        });
      }
    }
  }

  async function ensureHostedSubscriptions(input: {
    currentResources: ResourceState;
    sourceLabel: string;
    nodeRecords: ResourceState['nodes'];
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
            detail: `${previewResult.metadata.nodeCount} 个节点，托管输出检查通过`,
            previewNodeCount: previewResult.metadata.nodeCount,
            templateName: previewResult.metadata.templateName
          };
        } catch (caughtError) {
          return {
            target,
            url,
            ok: false,
            detail: getErrorMessage(caughtError),
            previewNodeCount: null,
            templateName: null
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
      effectiveBoundNodeIds: boundNodeIds,
      unresolvedBoundNodeIds: [],
      bindingError: null,
      targets
    };
  }

  async function createImportedNodes(input: {
    importedNodes: ImportedNodePayload[];
    errorCount: number;
    onSuccess?: () => void;
  }): Promise<void> {
    if (!token) {
      return;
    }

    if (input.importedNodes.length === 0) {
      reportValidationError('没有可导入的节点');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { message: nextMessage } = await runNodeImportWorkflow({
        importedNodes: input.importedNodes,
        errorCount: input.errorCount,
        importNodes: (nodes) => importNodes(token, nodes),
        refreshResources: () => refreshResources(),
        onImported: input.onSuccess
      });
      setMessage(nextMessage);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleImportShareLinks(): Promise<void> {
    if (!token) {
      return;
    }

    if (!nodeImportText.trim()) {
      reportValidationError('请先粘贴分享链接');
      return;
    }

    await createImportedNodes({
      importedNodes: parsedNodeImport.nodes,
      errorCount: parsedNodeImport.errors.length,
      ...(parsedNodeImport.errors.length === 0
        ? { onSuccess: () => setNodeImportText('') }
        : {})
    });
  }

  async function handleImportConfig(): Promise<void> {
    if (!token) {
      return;
    }

    if (!parsedConfigImport) {
      reportValidationError('请先粘贴可识别的 Mihomo / Clash YAML 或 sing-box JSON 配置');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { message: nextMessage } = await runConfigImportWorkflow({
        parsedConfigImport,
        importNodes: (nodes) => importNodes(token, nodes),
        refreshResources: () => refreshResources(),
        ensureAutoHostedTemplates
      });
      setMessage(nextMessage);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleImportRemoteUrlNodes(): Promise<void> {
    if (!token) {
      return;
    }

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

  async function handleSaveRemoteSubscriptionSource(): Promise<void> {
    if (!token) {
      return;
    }

    const sourceUrl = nodeImportSourceUrl.trim();

    if (!isValidHttpUrl(sourceUrl)) {
      reportValidationError('订阅 URL 必须是合法的 http / https 地址');
      return;
    }

    const sourceName =
      remoteSubscriptionSourceForm.name.trim() ||
      buildRemoteSubscriptionSourceName(sourceUrl);

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { syncResult, message: nextMessage } =
        await runRemoteSubscriptionSourceSaveWorkflow({
          sourceName,
          sourceUrl,
          createRemoteSubscriptionSource: (payload) =>
            createRemoteSubscriptionSource(token, payload),
          syncRemoteSubscriptionSource: (sourceId) =>
            syncRemoteSubscriptionSource(token, sourceId),
          refreshResources: () => refreshResources()
        });
      setRemoteSubscriptionSyncResult(syncResult);
      setRemoteSubscriptionSourceForm(emptyRemoteSubscriptionSourceForm);
      setNodeImportSourceUrl('');
      setRemoteNodeImportPreview(null);
      setMessage(nextMessage);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateHostedFromEnabledNodes(): Promise<void> {
    if (!token) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { hostedResult, message: nextMessage } =
        await runHostedGenerationWorkflow({
          currentResources: resources,
          nodeRecords: resources.nodes,
          ensureHostedSubscriptions,
          refreshResources: () => refreshResources()
        });
      setHostedSubscriptionResult(hostedResult);
      setMessage(nextMessage);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncSavedRemoteSubscriptionSource(
    source: ResourceState['remoteSubscriptionSources'][number]
  ): Promise<void> {
    if (!token) {
      return;
    }

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

  async function handleToggleRemoteSubscriptionSource(
    source: ResourceState['remoteSubscriptionSources'][number]
  ): Promise<void> {
    if (!token) {
      return;
    }

    await withAction(
      () =>
        updateRemoteSubscriptionSource(token, source.id, {
          enabled: !source.enabled
        }),
      source.enabled ? '已暂停该自动同步源' : '已启用该自动同步源'
    );
  }

  async function handleDeleteRemoteSubscriptionTask(
    source: ResourceState['remoteSubscriptionSources'][number]
  ): Promise<void> {
    if (
      !token ||
      !confirmDestructiveAction(
        `确认删除自动同步源“${source.name}”吗？这会移除该来源同步出的节点。`
      )
    ) {
      return;
    }

    await withAction(async () => {
      await deleteRemoteSubscriptionSource(token, source.id);

      if (remoteSubscriptionSyncResult?.sourceId === source.id) {
        setRemoteSubscriptionSyncResult(null);
      }
    }, '自动同步源已删除');
  }

  async function handleSaveNode(input: NodeEditorSubmitInput): Promise<void> {
    if (!token) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      await updateNode(token, input.nodeId, {
        name: input.name,
        protocol: input.protocol,
        server: input.server,
        port: input.port,
        enabled: input.enabled,
        credentials: input.credentials,
        params: input.params
      });
      await refreshResources();
      setMessage(`节点“${input.name}”已更新`);
    } catch (caughtError) {
      if (isAppApiError(caughtError) && caughtError.details?.scope === 'node_chain') {
        throw caughtError;
      }

      await handleProtectedApiError(caughtError);
      throw caughtError;
    } finally {
      setLoading(false);
    }
  }

  async function handleSetNodesEnabled(
    nodeIds: string[],
    enabled: boolean
  ): Promise<void> {
    if (!token || nodeIds.length === 0) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await mutateNodesBatch(token, {
        action: 'set_enabled',
        nodeIds,
        enabled
      });
      await refreshResources();

      if (result.changedCount === 0) {
        setMessage(`选中的节点已经全部是${enabled ? '启用' : '禁用'}状态`);
      } else if (result.affectedCount === 1) {
        setMessage(enabled ? '节点已启用' : '节点已禁用');
      } else {
        setMessage(`已${enabled ? '启用' : '禁用'} ${result.changedCount} 个节点`);
      }
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
      throw caughtError;
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteNodes(nodeIds: string[]): Promise<void> {
    if (!token || nodeIds.length === 0) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await mutateNodesBatch(token, {
        action: 'delete',
        nodeIds
      });
      await refreshResources();

      if (result.affectedCount === 1) {
        setMessage('节点已删除');
      } else {
        setMessage(`已删除 ${result.changedCount} 个节点`);
      }
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
      throw caughtError;
    } finally {
      setLoading(false);
    }
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
              <form className="form-grid" onSubmit={(event) => void handleSetup(event)}>
                <label>
                  <span>管理员用户名</span>
                  <input
                    value={setupForm.username}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        username: event.target.value
                      }))
                    }
                    placeholder="admin"
                  />
                </label>
                <label>
                  <span>管理员密码</span>
                  <input
                    type="password"
                    value={setupForm.password}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        password: event.target.value
                      }))
                    }
                    placeholder="至少 8 位"
                  />
                </label>
                <label>
                  <span>确认密码</span>
                  <input
                    type="password"
                    value={setupForm.confirmPassword}
                    onChange={(event) =>
                      setSetupForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value
                      }))
                    }
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
              <form className="form-grid" onSubmit={(event) => void handleLogin(event)}>
                <label>
                  <span>用户名</span>
                  <input
                    value={loginForm.username}
                    onChange={(event) =>
                      setLoginForm((current) => ({
                        ...current,
                        username: event.target.value
                      }))
                    }
                    placeholder="admin"
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) =>
                      setLoginForm((current) => ({
                        ...current,
                        password: event.target.value
                      }))
                    }
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
          <p className="helper">只保留一条主流程：导入节点，统一调整，再生成并复制托管 URL。</p>
          <div className="inline-meta">
            <span>支持分享链接 / Base64 / YAML / JSON</span>
            <span>订阅 URL 可保存为自动同步源</span>
            <span>节点级链式代理会同步用于 Mihomo / sing-box，并提供链式代理拓扑诊断</span>
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

        <NodeImportSection
          loading={loading}
          nodeImportText={nodeImportText}
          onNodeImportTextChange={(value) => setNodeImportText(value)}
          parsedNodeImport={parsedNodeImport}
          summarizedParsedNodeImportErrors={summarizedParsedNodeImportErrors}
          onImportShareLinks={() => void handleImportShareLinks()}
          nodeImportSourceUrl={nodeImportSourceUrl}
          onNodeImportSourceUrlChange={(value) => {
            setNodeImportSourceUrl(value);
            setRemoteNodeImportPreview(null);
          }}
          remoteSubscriptionSourceForm={remoteSubscriptionSourceForm}
          onRemoteSubscriptionSourceFormChange={(value) =>
            setRemoteSubscriptionSourceForm(value)
          }
          remoteNodeImportPreview={remoteNodeImportPreview}
          summarizedRemoteNodeImportErrors={summarizedRemoteNodeImportErrors}
          onImportRemoteUrlNodes={() => void handleImportRemoteUrlNodes()}
          onSaveRemoteSubscriptionSource={() => void handleSaveRemoteSubscriptionSource()}
          effectiveRemoteSyncSourceName={effectiveRemoteSyncSourceName}
          effectiveRemoteSyncStatus={effectiveRemoteSyncStatus}
          effectiveRemoteSyncAt={effectiveRemoteSyncAt}
          effectiveRemoteSyncMessage={effectiveRemoteSyncMessage}
          remoteSubscriptionSyncResult={
            remoteSubscriptionSyncResult
              ? {
                  importedCount: remoteSubscriptionSyncResult.importedCount,
                  createdCount: remoteSubscriptionSyncResult.createdCount,
                  updatedCount: remoteSubscriptionSyncResult.updatedCount,
                  disabledCount: remoteSubscriptionSyncResult.disabledCount
                }
              : null
          }
          latestPersistedRemoteFailureCount={latestPersistedRemoteFailureCount}
          remoteSyncNodeChainDiagnostics={remoteSyncNodeChainDiagnostics}
          remoteSubscriptionSources={resources.remoteSubscriptionSources}
          onSyncSavedRemoteSubscriptionSource={(source) =>
            void handleSyncSavedRemoteSubscriptionSource(source)
          }
          onToggleRemoteSubscriptionSource={(source) =>
            void handleToggleRemoteSubscriptionSource(source)
          }
          onDeleteRemoteSubscriptionTask={(source) =>
            void handleDeleteRemoteSubscriptionTask(source)
          }
          configImportText={configImportText}
          onConfigImportTextChange={(value) => setConfigImportText(value)}
          parsedConfigImport={parsedConfigImport}
          onImportConfig={() => void handleImportConfig()}
        />

        <NodeManagementSection
          loading={loading}
          nodes={resources.nodes}
          templates={resources.templates}
          onSaveNode={handleSaveNode}
          onSetNodesEnabled={handleSetNodesEnabled}
          onDeleteNodes={handleDeleteNodes}
        />

        <HostedSubscriptionSection
          loading={loading}
          enabledNodeCount={enabledNodeCount}
          autoHostedUserName={autoHostedUser?.name ?? null}
          hostedSubscriptionResult={hostedSubscriptionResult}
          hostedSubscriptionDiagnostics={hostedSubscriptionDiagnostics}
          hostedSubscriptionSyncStatus={hostedSubscriptionSyncStatus}
          enabledNodeWarnings={enabledNodeWarnings}
          onGenerate={() => void handleGenerateHostedFromEnabledNodes()}
          onResetToken={() => void handleResetCurrentHostedSubscriptionToken()}
          onCopyHostedUrl={(url, target) => void copyHostedUrl(url, target)}
        />
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

function buildAutoHostedTemplateContent(
  target: SubscriptionTarget,
  existingTemplate?: TemplateRecord | null,
  importedConfig?: ImportedConfigPayload | null
): string {
  if (importedConfig?.targetType === target) {
    return normalizeManagedAutoHostedTemplateContent(target, importedConfig.templateContent);
  }

  if (existingTemplate?.content.trim()) {
    return normalizeManagedAutoHostedTemplateContent(target, existingTemplate.content);
  }

  return target === 'mihomo'
    ? AUTO_HOSTED_MIHOMO_TEMPLATE
    : AUTO_HOSTED_SINGBOX_TEMPLATE;
}

function normalizeManagedAutoHostedTemplateContent(
  target: SubscriptionTarget,
  content: string
): string {
  if (target !== 'mihomo') {
    return content;
  }

  try {
    return normalizeManagedMihomoTemplateContent(content);
  } catch {
    return AUTO_HOSTED_MIHOMO_TEMPLATE;
  }
}
