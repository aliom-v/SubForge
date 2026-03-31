import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getServiceMetadata,
  parseMihomoTemplateStructure
} from '@subforge/core';
import {
  SUBSCRIPTION_TARGETS,
  type NodeRecord,
  type RemoteSubscriptionSourceRecord,
  type SubscriptionTarget,
  type TemplateRecord,
  type UserRecord
} from '@subforge/shared';
import {
  bootstrapSetup,
  createNode,
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
import {
  runConfigImportWorkflow,
  runHostedGenerationWorkflow,
  runNodeImportWorkflow,
  runRemoteSubscriptionSourceSaveWorkflow
} from './workflow-orchestration';
import { buildSingleUserWorkflowSteps, getWorkflowStepStatusLabel } from './workflow-progress';
import {
  COMMON_NODE_PROTOCOLS,
  createNodeProtocolGuideState,
  detectNodeProtocolPreset,
  formatNodeMetadataText,
  getNodeMetadataExamples,
  parseNodeMetadataText,
  serializeNodeProtocolGuideState,
  summarizeNodeMetadata,
  summarizeNodeMetadataParts,
  type NodeProtocolGuideState
} from './node-metadata';
import {
  buildImportedNodeWarnings,
  parseImportedConfig,
  parseNodeImportText,
  type ImportedConfigPayload,
  type ImportedNodePayload,
  type NodeImportContentEncoding
} from './node-import';
import { canonicalizeNodeProtocol, validateNodeProtocolMetadata } from './node-protocol-validation';
import { buildNodeChainSummaries, readNodeUpstreamProxyFromRecord } from './mihomo-topology';

const metadata = getServiceMetadata();
const sessionStorageKey = 'subforge.admin.token';

interface ResourceState {
  users: UserRecord[];
  nodes: NodeRecord[];
  templates: TemplateRecord[];
  remoteSubscriptionSources: RemoteSubscriptionSourceRecord[];
}

interface NodeDraftForm {
  name: string;
  protocol: string;
  server: string;
  port: number;
  credentialsText: string;
  paramsText: string;
}

interface NodeEditForm extends NodeDraftForm {
  id: string;
  enabled: boolean;
}

interface RemoteSubscriptionSourceForm {
  name: string;
  sourceUrl: string;
}

const emptyResources: ResourceState = {
  users: [],
  nodes: [],
  templates: [],
  remoteSubscriptionSources: []
};

const AUTO_HOSTED_MIHOMO_TEMPLATE = ['mixed-port: 7890', 'mode: rule', 'proxies:', '{{proxies}}', 'proxy-groups:', '{{proxy_groups}}', 'rules:', '{{rules}}'].join('\n');
const AUTO_HOSTED_SINGBOX_TEMPLATE = ['{', '  "outbounds": {{outbounds}},', '  "route": {', '    "rules": {{rules}}', '  }', '}'].join('\n');

const emptyNodeDraftForm: NodeDraftForm = {
  name: '',
  protocol: 'vless',
  server: '',
  port: 443,
  credentialsText: '',
  paramsText: ''
};
const emptyNodeEditForm: NodeEditForm = { id: '', ...emptyNodeDraftForm, enabled: true };
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
  const [nodeForm, setNodeForm] = useState<NodeDraftForm>(emptyNodeDraftForm);
  const [nodeImportText, setNodeImportText] = useState('');
  const [configImportText, setConfigImportText] = useState('');
  const [nodeImportSourceUrl, setNodeImportSourceUrl] = useState('');
  const [remoteNodeImportPreview, setRemoteNodeImportPreview] = useState<NodeImportPreviewPayload | null>(null);
  const [remoteSubscriptionSourceForm, setRemoteSubscriptionSourceForm] =
    useState<RemoteSubscriptionSourceForm>(emptyRemoteSubscriptionSourceForm);

  const [nodeEditForm, setNodeEditForm] = useState<NodeEditForm>(emptyNodeEditForm);

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
  const singleUserWorkflowSteps = useMemo(
    () =>
      buildSingleUserWorkflowSteps({
        nodes: resources.nodes,
        hostedSubscriptionSyncStatus,
        hostedSubscriptionResult
      }),
    [hostedSubscriptionResult, hostedSubscriptionSyncStatus, resources.nodes]
  );
  const nodeCreateExamples = useMemo(() => getNodeMetadataExamples(nodeForm.protocol), [nodeForm.protocol]);
  const nodeEditExamples = useMemo(() => getNodeMetadataExamples(nodeEditForm.protocol), [nodeEditForm.protocol]);
  const parsedNodeImport = useMemo(() => parseNodeImportText(nodeImportText), [nodeImportText]);
  const parsedConfigImport = useMemo(() => parseImportedConfig(configImportText), [configImportText]);
  const summarizedParsedNodeImportErrors = useMemo(
    () => summarizeImportErrors(parsedNodeImport.errors),
    [parsedNodeImport.errors]
  );
  const firstImportedNode = parsedNodeImport.nodes[0];
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
  const createFormUpstreamProxy = useMemo(() => readNodeUpstreamProxyFromText(nodeForm.paramsText), [nodeForm.paramsText]);
  const editFormUpstreamProxy = useMemo(() => readNodeUpstreamProxyFromText(nodeEditForm.paramsText), [nodeEditForm.paramsText]);

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

  useEffect(() => {
    const node = resources.nodes.find((item) => item.id === nodeEditForm.id) ?? resources.nodes[0];
    if (!node) {
      setNodeEditForm(emptyNodeEditForm);
      return;
    }
    setNodeEditForm({
      id: node.id,
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      credentialsText: formatNodeMetadataText(node.credentials),
      paramsText: formatNodeMetadataText(node.params),
      enabled: node.enabled
    });
  }, [resources.nodes, nodeEditForm.id]);

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

  async function handleCreateNode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateNodeDraft(nodeForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    const nodePayload = buildNodeMutationInput(nodeForm);

    if (nodePayload.error) {
      reportValidationError(nodePayload.error);
      return;
    }

    await withAction(async () => {
      await createNode(token, nodePayload.payload);
      setNodeForm(emptyNodeDraftForm);
    }, '节点已创建。若要直接给客户端使用，请回到上方导入入口生成托管 URL。');
  }

  function loadImportedNodeToCreateForm(importedNode: ImportedNodePayload): void {
    setNodeForm({
      name: importedNode.name,
      protocol: importedNode.protocol,
      server: importedNode.server,
      port: importedNode.port,
      credentialsText: formatNodeMetadataText(importedNode.credentials),
      paramsText: formatNodeMetadataText(importedNode.params)
    });
    setError('');
    setMessage(`已将 ${importedNode.name} 载入创建表单`);
  }

  function updateCreateFormUpstreamProxy(upstreamProxy: string): void {
    const result = applyUpstreamProxyToParamsText(nodeForm.paramsText, upstreamProxy);

    if (result.error) {
      reportValidationError(result.error);
      return;
    }

    setNodeForm((current) => ({ ...current, paramsText: result.value }));
    setError('');
  }

  function updateEditFormUpstreamProxy(upstreamProxy: string): void {
    const result = applyUpstreamProxyToParamsText(nodeEditForm.paramsText, upstreamProxy);

    if (result.error) {
      reportValidationError(result.error);
      return;
    }

    setNodeEditForm((current) => ({ ...current, paramsText: result.value }));
    setError('');
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

  async function handleUpdateNode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !nodeEditForm.id) return;

    const validationError = validateNodeDraft(nodeEditForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    const nodePayload = buildNodeMutationInput(nodeEditForm);

    if (nodePayload.error) {
      reportValidationError(nodePayload.error);
      return;
    }

    await withAction(
      () =>
        updateNode(token, nodeEditForm.id, {
          ...nodePayload.payload,
          enabled: nodeEditForm.enabled
        }),
      '节点已更新。如需让客户端拿到最新节点，请重新生成托管 URL。'
    );
  }

  async function handleDeleteNode(nodeId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该节点吗？')) return;

    await withAction(async () => {
      await deleteNode(token, nodeId);
    }, '节点已删除');
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

      <section className="panel-grid users-grid">
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
                      rows={parsedNodeImport.nodes.map((node, index) => [
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
                          rows={remoteNodeImportPreview.nodes.map((node, index) => [
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
              {remoteSubscriptionSyncResult ? (
                <div className="metadata-grid full-span">
                  <div className="result-card">
                    <strong>最近一次自动同步</strong>
                    <span>{remoteSubscriptionSyncResult.sourceName}</span>
                    <span>状态 {remoteSubscriptionSyncResult.status}</span>
                    <span>节点 {remoteSubscriptionSyncResult.importedCount}</span>
                    <span>
                      变更 {remoteSubscriptionSyncResult.createdCount} / {remoteSubscriptionSyncResult.updatedCount} /{' '}
                      {remoteSubscriptionSyncResult.disabledCount}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="full-span">
                <strong>已保存的自动同步源</strong>
              </div>
              {resources.remoteSubscriptionSources.length > 0 ? (
                <ResourceTable
                  columns={['同步源', '上游 URL', '状态', '最近同步', '失败次数', '操作']}
                  rows={resources.remoteSubscriptionSources.map((source) => [
                    source.name,
                    source.sourceUrl,
                    `${source.enabled ? 'enabled' : 'paused'} / ${source.lastSyncStatus ?? 'never'}`,
                    source.lastSyncAt ?? 'never',
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
                          rows={parsedConfigImport.nodes.map((node, index) => [
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
                  <button type="button" className="danger" onClick={() => void handleDeleteNode(node.id)}>删除</button>
                </div>
              ])}
            />
          </article>
      </section>
    </main>
  );
}


function readNodeUpstreamProxyFromText(paramsText: string): string {
  const parsed = parseNodeMetadataText(paramsText, 'params');
  return parsed.error ? '' : readNodeUpstreamProxyFromRecord(parsed.value) ?? '';
}

function applyUpstreamProxyToParamsText(
  paramsText: string,
  upstreamProxy: string
): { value: string; error?: string } {
  const parsed = parseNodeMetadataText(paramsText, 'params');

  if (parsed.error) {
    return {
      value: paramsText,
      error: '当前参数 JSON 不是合法对象，暂时无法通过可视化方式设置上游代理'
    };
  }

  const nextParams = { ...(parsed.value ?? {}) };

  if (upstreamProxy.trim()) {
    nextParams.upstreamProxy = upstreamProxy.trim();
  } else {
    delete nextParams.upstreamProxy;
  }

  return {
    value: Object.keys(nextParams).length > 0 ? JSON.stringify(nextParams, null, 2) : ''
  };
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

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function validateNodeDraft(input: { name: string; protocol: string; server: string; port: number }): string | null {
  if (!input.name.trim()) return '节点名称不能为空';
  if (!input.protocol.trim()) return '节点协议不能为空';
  if (!input.server.trim()) return '节点地址不能为空';
  if (!isValidPort(input.port)) return '节点端口必须在 1-65535 之间';
  return null;
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

function buildNodeMutationInput(input: NodeDraftForm): {
  payload: {
    name: string;
    protocol: string;
    server: string;
    port: number;
    credentials: Record<string, unknown> | null;
    params: Record<string, unknown> | null;
  };
  error?: string;
} {
  const protocol = canonicalizeNodeProtocol(input.protocol);
  const credentials = parseNodeMetadataText(input.credentialsText, 'credentials');

  if (credentials.error) {
    return {
      payload: {
        name: input.name.trim(),
        protocol,
        server: input.server.trim(),
        port: input.port,
        credentials: null,
        params: null
      },
      error: credentials.error
    };
  }

  const params = parseNodeMetadataText(input.paramsText, 'params');

  if (params.error) {
    return {
      payload: {
        name: input.name.trim(),
        protocol,
        server: input.server.trim(),
        port: input.port,
        credentials: credentials.value,
        params: null
      },
      error: params.error
    };
  }

  const metadataValidationError = validateNodeProtocolMetadata({
    protocol,
    credentials: credentials.value,
    params: params.value
  });

  if (metadataValidationError) {
    return {
      payload: {
        name: input.name.trim(),
        protocol,
        server: input.server.trim(),
        port: input.port,
        credentials: credentials.value,
        params: params.value
      },
      error: metadataValidationError
    };
  }

  return {
    payload: {
      name: input.name.trim(),
      protocol,
      server: input.server.trim(),
      port: input.port,
      credentials: credentials.value,
      params: params.value
    }
  };
}

function NodeProtocolAssistant(props: {
  protocol: string;
  credentialsText: string;
  paramsText: string;
  onMetadataChange: (value: { credentialsText: string; paramsText: string }) => void;
}): JSX.Element {
  const preset = detectNodeProtocolPreset(props.protocol);
  const parsedCredentials = useMemo(
    () => parseNodeMetadataText(props.credentialsText, 'credentials'),
    [props.credentialsText]
  );
  const parsedParams = useMemo(() => parseNodeMetadataText(props.paramsText, 'params'), [props.paramsText]);
  const [guideState, setGuideState] = useState<NodeProtocolGuideState>(() =>
    createNodeProtocolGuideState(props.protocol, {
      credentials: parsedCredentials.value,
      params: parsedParams.value
    })
  );

  useEffect(() => {
    if (parsedCredentials.error || parsedParams.error) {
      return;
    }

    setGuideState(
      createNodeProtocolGuideState(props.protocol, {
        credentials: parsedCredentials.value,
        params: parsedParams.value
      })
    );
  }, [parsedCredentials.error, parsedCredentials.value, parsedParams.error, parsedParams.value, props.protocol]);

  function updateGuideState(patch: Partial<NodeProtocolGuideState>): void {
    setGuideState((current) => {
      const next = { ...current, ...patch };
      const serialized = serializeNodeProtocolGuideState(props.protocol, next);

      props.onMetadataChange({
        credentialsText: formatNodeMetadataText(serialized.credentials),
        paramsText: formatNodeMetadataText(serialized.params)
      });

      return next;
    });
  }

  if (preset === 'custom') {
    return (
      <div className="protocol-assistant full-span">
        <div className="assistant-header">
          <strong>协议字段向导</strong>
          <span className="assistant-badge">custom</span>
        </div>
        <p className="helper">
          当前协议暂无结构化字段向导，请继续使用下方 JSON 字段。常见的 `vless`、`trojan`、`vmess`、`ss`、`ssr`、`tuic`、`hysteria2`
          已支持自动回填。
        </p>
      </div>
    );
  }

  return (
    <div className="protocol-assistant full-span">
      <div className="assistant-header">
        <strong>协议字段向导</strong>
        <span className="assistant-badge">{preset}</span>
      </div>
      <p className="helper">
        修改下列字段会自动回填到下方 JSON 文本框；更多高级参数仍可直接编辑原始 JSON。
      </p>
      {preset === 'hysteria2' ? (
        <p className="helper">
          `hysteria2` 向导当前优先覆盖 `password`、`sni`、`obfs`、`obfs-password`、`alpn`、`insecure`；authority 多端口会在导入时自动收敛为
          `port + params.mport`，更复杂组合仍请直接核对 JSON。
        </p>
      ) : null}
      {preset === 'ssr' ? (
        <p className="helper">
          `ssr` 向导会回填 `cipher`、`password`、`protocol`、`obfs` 以及常见 `protocol-param` / `obfs-param`。
        </p>
      ) : null}
      {preset === 'tuic' ? (
        <p className="helper">
          `tuic` 向导会回填 `uuid`、`password`、`sni`、`alpn`、拥塞控制、UDP relay、0-RTT 等常见字段；更少见的传输细节仍可继续编辑 JSON。
        </p>
      ) : null}
      {parsedCredentials.error || parsedParams.error ? (
        <p className="helper">
          当前 JSON 不是合法对象，协议向导会在你修正 JSON 后重新同步。
        </p>
      ) : null}
      <div className="assistant-grid">
        {preset === 'ss' ? (
          <>
            <Field label="Cipher">
              <input
                value={guideState.primaryCredential}
                onChange={(event) => updateGuideState({ primaryCredential: event.target.value })}
                placeholder="aes-256-gcm"
              />
            </Field>
            <Field label="Password">
              <input
                value={guideState.secondaryCredential}
                onChange={(event) => updateGuideState({ secondaryCredential: event.target.value })}
                placeholder="replace-me"
              />
            </Field>
            <Field label="Plugin">
              <input
                value={guideState.plugin}
                onChange={(event) => updateGuideState({ plugin: event.target.value })}
                placeholder="v2ray-plugin"
              />
            </Field>
          </>
        ) : preset === 'ssr' ? (
          <>
            <Field label="Cipher">
              <input
                value={guideState.primaryCredential}
                onChange={(event) => updateGuideState({ primaryCredential: event.target.value })}
                placeholder="aes-256-cfb"
              />
            </Field>
            <Field label="Password">
              <input
                value={guideState.secondaryCredential}
                onChange={(event) => updateGuideState({ secondaryCredential: event.target.value })}
                placeholder="replace-me"
              />
            </Field>
            <Field label="Protocol">
              <input
                value={guideState.protocolName}
                onChange={(event) => updateGuideState({ protocolName: event.target.value })}
                placeholder="auth_aes128_md5"
              />
            </Field>
            <Field label="Obfs">
              <input
                value={guideState.obfs}
                onChange={(event) => updateGuideState({ obfs: event.target.value })}
                placeholder="tls1.2_ticket_auth"
              />
            </Field>
            <Field label="Protocol Param">
              <input
                value={guideState.protocolParam}
                onChange={(event) => updateGuideState({ protocolParam: event.target.value })}
                placeholder="100:replace-me"
              />
            </Field>
            <Field label="Obfs Param">
              <input
                value={guideState.obfsParam}
                onChange={(event) => updateGuideState({ obfsParam: event.target.value })}
                placeholder="sub.example.com"
              />
            </Field>
          </>
        ) : preset === 'tuic' ? (
          <>
            <Field label="UUID">
              <input
                value={guideState.primaryCredential}
                onChange={(event) => updateGuideState({ primaryCredential: event.target.value })}
                placeholder="11111111-1111-1111-1111-111111111111"
              />
            </Field>
            <Field label="Password">
              <input
                value={guideState.secondaryCredential}
                onChange={(event) => updateGuideState({ secondaryCredential: event.target.value })}
                placeholder="replace-me"
              />
            </Field>
            <Field label="SNI">
              <input
                value={guideState.sni}
                onChange={(event) => updateGuideState({ sni: event.target.value })}
                placeholder="sub.example.com"
              />
            </Field>
            <Field label="ALPN">
              <input
                value={guideState.alpn}
                onChange={(event) => updateGuideState({ alpn: event.target.value })}
                placeholder="h3"
              />
            </Field>
            <Field label="Congestion">
              <input
                value={guideState.congestionController}
                onChange={(event) => updateGuideState({ congestionController: event.target.value })}
                placeholder="bbr"
              />
            </Field>
            <Field label="UDP Relay">
              <input
                value={guideState.udpRelayMode}
                onChange={(event) => updateGuideState({ udpRelayMode: event.target.value })}
                placeholder="native"
              />
            </Field>
            <Field label="Heartbeat">
              <input
                value={guideState.heartbeat}
                onChange={(event) => updateGuideState({ heartbeat: event.target.value })}
                placeholder="10s"
              />
            </Field>
            <Field label="Request Timeout">
              <input
                type="number"
                value={guideState.requestTimeout}
                onChange={(event) => updateGuideState({ requestTimeout: event.target.value })}
                placeholder="8000"
              />
            </Field>
            <label className="checkbox-row assistant-checkbox">
              <input
                type="checkbox"
                checked={guideState.disableSni}
                onChange={(event) => updateGuideState({ disableSni: event.target.checked })}
              />
              <span>Disable SNI</span>
            </label>
            <label className="checkbox-row assistant-checkbox">
              <input
                type="checkbox"
                checked={guideState.reduceRtt}
                onChange={(event) => updateGuideState({ reduceRtt: event.target.checked })}
              />
              <span>启用 0-RTT</span>
            </label>
          </>
        ) : preset === 'hysteria2' ? (
          <>
            <Field label="Password">
              <input
                value={guideState.primaryCredential}
                onChange={(event) => updateGuideState({ primaryCredential: event.target.value })}
                placeholder="replace-me"
              />
            </Field>
            <Field label="SNI">
              <input
                value={guideState.sni}
                onChange={(event) => updateGuideState({ sni: event.target.value })}
                placeholder="sub.example.com"
              />
            </Field>
            <Field label="Obfs">
              <input
                value={guideState.obfs}
                onChange={(event) => updateGuideState({ obfs: event.target.value })}
                placeholder="salamander"
              />
            </Field>
            <Field label="Obfs Password">
              <input
                value={guideState.obfsPassword}
                onChange={(event) => updateGuideState({ obfsPassword: event.target.value })}
                placeholder="replace-me"
              />
            </Field>
            <Field label="ALPN">
              <input
                value={guideState.alpn}
                onChange={(event) => updateGuideState({ alpn: event.target.value })}
                placeholder="h3"
              />
            </Field>
            <Field label="Skip Verify">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={guideState.insecure}
                  onChange={(event) => updateGuideState({ insecure: event.target.checked })}
                />
                <span>写入 `params.insecure = true`</span>
              </label>
            </Field>
          </>
        ) : (
          <Field label={preset === 'trojan' ? 'Password' : 'UUID'}>
            <input
              value={guideState.primaryCredential}
              onChange={(event) => updateGuideState({ primaryCredential: event.target.value })}
              placeholder={preset === 'trojan' ? 'replace-me' : '11111111-1111-1111-1111-111111111111'}
            />
          </Field>
        )}
        {preset === 'vmess' ? (
          <Field label="Alter ID">
            <input
              type="number"
              value={guideState.alterId}
              onChange={(event) => updateGuideState({ alterId: event.target.value })}
              placeholder="0"
            />
          </Field>
        ) : null}
        {(preset === 'vless' || preset === 'vmess') ? (
          <Field label="Network">
            <select
              value={guideState.network}
              onChange={(event) => updateGuideState({ network: event.target.value })}
            >
              <option value="">未设置</option>
              <option value="ws">ws</option>
              <option value="tcp">tcp</option>
              <option value="grpc">grpc</option>
              <option value="http">http</option>
            </select>
          </Field>
        ) : null}
        {(preset === 'vless' || preset === 'vmess') ? (
          <Field label="Server Name">
            <input
              value={guideState.servername}
              onChange={(event) => updateGuideState({ servername: event.target.value })}
              placeholder="sub.example.com"
            />
          </Field>
        ) : null}
        {(preset === 'vless' || preset === 'vmess') ? (
          <Field label="Path">
            <input
              value={guideState.path}
              onChange={(event) => updateGuideState({ path: event.target.value })}
              placeholder={preset === 'vmess' ? '/vmess' : '/ws'}
            />
          </Field>
        ) : null}
        {preset === 'trojan' ? (
          <Field label="SNI">
            <input
              value={guideState.sni}
              onChange={(event) => updateGuideState({ sni: event.target.value })}
              placeholder="sub.example.com"
            />
          </Field>
        ) : null}
        {(preset === 'trojan' || preset === 'vless' || preset === 'vmess') ? (
          <label className="checkbox-row assistant-checkbox">
            <input
              type="checkbox"
              checked={guideState.tls}
              onChange={(event) => updateGuideState({ tls: event.target.checked })}
            />
            <span>启用 TLS</span>
          </label>
        ) : null}
      </div>
    </div>
  );
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
