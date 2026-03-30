import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getServiceMetadata,
  parseMihomoTemplateStructure
} from '@subforge/core';
import {
  SUBSCRIPTION_TARGETS,
  type AuditLogRecord,
  type NodeRecord,
  type RemoteSubscriptionSourceRecord,
  type RuleSourceRecord,
  type SubscriptionTarget,
  type SyncLogRecord,
  type TemplateRecord,
  type UserRecord
} from '@subforge/shared';
import {
  bootstrapSetup,
  createNode,
  createRuleSource,
  createTemplate,
  createUser,
  deleteNode,
  deleteRuleSource,
  deleteTemplate,
  deleteUser,
  fetchAuditLogs,
  fetchMe,
  fetchNodes,
  fetchPreview,
  fetchRuleSources,
  fetchSetupStatus,
  fetchSyncLogs,
  fetchTemplates,
  fetchUserNodeBindings,
  fetchUsers,
  importNodes,
  login,
  rebuildSubscriptionCaches,
  logout,
  previewNodeImportFromUrl,
  createRemoteSubscriptionSource,
  deleteRemoteSubscriptionSource,
  fetchRemoteSubscriptionSources,
  replaceUserNodeBindings,
  resetUserToken,
  setDefaultTemplate,
  syncRemoteSubscriptionSource,
  syncRuleSource,
  updateNode,
  updateRemoteSubscriptionSource,
  updateRuleSource,
  updateTemplate,
  updateUser,
  type AdminSession,
  type NodeImportPreviewPayload,
  type CacheRebuildPayload,
  type NodeImportInput,
  type NodeImportPayload,
  type PreviewPayload,
  type RemoteSubscriptionSourceSyncPayload,
  type RuleSourceSyncPayload,
  type SetupStatusPayload
} from './api';
import { getErrorMessage, shouldClearProtectedSession } from './error-handling';
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
  parseImportedConfig,
  parseNodeImportText,
  type ImportedConfigPayload,
  type ImportedNodePayload,
  type NodeImportContentEncoding
} from './node-import';
import { canonicalizeNodeProtocol, validateNodeProtocolMetadata } from './node-protocol-validation';
import { buildNodeChainSummaries, readNodeUpstreamProxyFromRecord } from './mihomo-topology';
import { TemplateStructureAssistant } from './template-structure-assistant';

const metadata = getServiceMetadata();
const sessionStorageKey = 'subforge.admin.token';

type TabKey =
  | 'overview'
  | 'users'
  | 'nodes'
  | 'templates'
  | 'ruleSources'
  | 'syncLogs'
  | 'auditLogs'
  | 'preview';

interface ResourceState {
  users: UserRecord[];
  nodes: NodeRecord[];
  templates: TemplateRecord[];
  remoteSubscriptionSources: RemoteSubscriptionSourceRecord[];
  ruleSources: RuleSourceRecord[];
  syncLogs: SyncLogRecord[];
  auditLogs: AuditLogRecord[];
}

interface UserEditForm {
  id: string;
  name: string;
  status: string;
  remark: string;
  expiresAt: string;
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

interface TemplateEditForm {
  id: string;
  name: string;
  targetType: SubscriptionTarget;
  content: string;
  version: number;
  enabled: boolean;
  isDefault: boolean;
}

interface RuleSourceEditForm {
  id: string;
  name: string;
  sourceUrl: string;
  format: RuleSourceRecord['format'];
  enabled: boolean;
}

interface RemoteSubscriptionSourceForm {
  name: string;
  sourceUrl: string;
}

interface HostedSubscriptionTargetState {
  target: SubscriptionTarget;
  url: string;
  ok: boolean;
  detail: string;
}

interface HostedSubscriptionResult {
  userId: string;
  userName: string;
  token: string;
  sourceLabel: string;
  nodeCount: number;
  targets: HostedSubscriptionTargetState[];
}

const emptyResources: ResourceState = {
  users: [],
  nodes: [],
  templates: [],
  remoteSubscriptionSources: [],
  ruleSources: [],
  syncLogs: [],
  auditLogs: []
};

const AUTO_HOSTED_USER_NAME = '个人托管订阅';
const AUTO_HOSTED_USER_REMARK = 'subforge:auto-hosted';
const AUTO_HOSTED_TEMPLATE_NAMES: Record<SubscriptionTarget, string> = {
  mihomo: 'Auto Hosted Mihomo',
  singbox: 'Auto Hosted Sing-box'
};
const AUTO_HOSTED_MIHOMO_TEMPLATE = ['mixed-port: 7890', 'mode: rule', 'proxies:', '{{proxies}}', 'proxy-groups:', '{{proxy_groups}}', 'rules:', '{{rules}}'].join('\n');
const AUTO_HOSTED_SINGBOX_TEMPLATE = ['{', '  "outbounds": {{outbounds}},', '  "route": {', '    "rules": {{rules}}', '  }', '}'].join('\n');

const emptyUserEditForm: UserEditForm = { id: '', name: '', status: 'active', remark: '', expiresAt: '' };
const emptyNodeDraftForm: NodeDraftForm = {
  name: '',
  protocol: 'vless',
  server: '',
  port: 443,
  credentialsText: '',
  paramsText: ''
};
const emptyNodeEditForm: NodeEditForm = { id: '', ...emptyNodeDraftForm, enabled: true };
const emptyTemplateEditForm: TemplateEditForm = {
  id: '',
  name: '',
  targetType: 'mihomo',
  content: '',
  version: 1,
  enabled: true,
  isDefault: false
};
const emptyRuleSourceEditForm: RuleSourceEditForm = { id: '', name: '', sourceUrl: '', format: 'text', enabled: true };
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
  const [activeTab, setActiveTab] = useState<TabKey>('nodes');
  const [resources, setResources] = useState<ResourceState>(emptyResources);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [syncResult, setSyncResult] = useState<RuleSourceSyncPayload | null>(null);
  const [remoteSubscriptionSyncResult, setRemoteSubscriptionSyncResult] =
    useState<RemoteSubscriptionSourceSyncPayload | null>(null);
  const [cacheRebuildResult, setCacheRebuildResult] = useState<CacheRebuildPayload | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(null);
  const [hostedSubscriptionResult, setHostedSubscriptionResult] = useState<HostedSubscriptionResult | null>(null);

  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [setupForm, setSetupForm] = useState({ username: 'admin', password: '', confirmPassword: '' });
  const [userForm, setUserForm] = useState({ name: '', remark: '', expiresAt: '' });
  const [nodeForm, setNodeForm] = useState<NodeDraftForm>(emptyNodeDraftForm);
  const [nodeImportText, setNodeImportText] = useState('');
  const [configImportText, setConfigImportText] = useState('');
  const [nodeImportSourceUrl, setNodeImportSourceUrl] = useState('');
  const [remoteNodeImportPreview, setRemoteNodeImportPreview] = useState<NodeImportPreviewPayload | null>(null);
  const [remoteSubscriptionSourceForm, setRemoteSubscriptionSourceForm] =
    useState<RemoteSubscriptionSourceForm>(emptyRemoteSubscriptionSourceForm);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    targetType: 'mihomo' as SubscriptionTarget,
    content: 'proxies:\n{{proxies}}\nproxy-groups:\n{{proxy_groups}}\nrules:\n{{rules}}',
    isDefault: true
  });
  const [ruleSourceForm, setRuleSourceForm] = useState({ name: '', sourceUrl: '', format: 'text' as RuleSourceRecord['format'] });
  const [previewForm, setPreviewForm] = useState({ userId: '', target: 'mihomo' as SubscriptionTarget });

  const [bindingUserId, setBindingUserId] = useState('');
  const [bindingNodeIds, setBindingNodeIds] = useState<string[]>([]);

  const [userEditForm, setUserEditForm] = useState<UserEditForm>(emptyUserEditForm);
  const [nodeEditForm, setNodeEditForm] = useState<NodeEditForm>(emptyNodeEditForm);
  const [templateEditForm, setTemplateEditForm] = useState<TemplateEditForm>(emptyTemplateEditForm);
  const [ruleSourceEditForm, setRuleSourceEditForm] = useState<RuleSourceEditForm>(emptyRuleSourceEditForm);

  const summary = useMemo(
    () => [
      { label: 'Nodes', value: resources.nodes.length },
      { label: 'Hosted URLs', value: hostedSubscriptionResult?.targets.length ?? SUBSCRIPTION_TARGETS.length },
      { label: 'Latest Import', value: hostedSubscriptionResult?.nodeCount ?? 0 }
    ],
    [hostedSubscriptionResult, resources.nodes.length]
  );
  const enabledNodeCount = useMemo(
    () => resources.nodes.filter((node) => node.enabled).length,
    [resources.nodes]
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
    setPreview(null);
    setSyncResult(null);
    setRemoteSubscriptionSyncResult(null);
    setCacheRebuildResult(null);
    setRemoteNodeImportPreview(null);
    setHostedSubscriptionResult(null);
    setBindingUserId('');
    setBindingNodeIds([]);
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
    if (!token || !bindingUserId) {
      setBindingNodeIds([]);
      return;
    }

    void loadUserBindings(bindingUserId);
  }, [token, bindingUserId]);

  useEffect(() => {
    const user = resources.users.find((item) => item.id === userEditForm.id) ?? resources.users[0];
    if (!user) {
      setUserEditForm(emptyUserEditForm);
      return;
    }
    setUserEditForm({
      id: user.id,
      name: user.name,
      status: user.status,
      remark: user.remark ?? '',
      expiresAt: user.expiresAt ?? ''
    });
  }, [resources.users, userEditForm.id]);

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

  useEffect(() => {
    const template = resources.templates.find((item) => item.id === templateEditForm.id) ?? resources.templates[0];
    if (!template) {
      setTemplateEditForm(emptyTemplateEditForm);
      return;
    }
    setTemplateEditForm({
      id: template.id,
      name: template.name,
      targetType: template.targetType,
      content: template.content,
      version: template.version,
      enabled: template.status === 'enabled',
      isDefault: template.isDefault
    });
  }, [resources.templates, templateEditForm.id]);

  useEffect(() => {
    const ruleSource = resources.ruleSources.find((item) => item.id === ruleSourceEditForm.id) ?? resources.ruleSources[0];
    if (!ruleSource) {
      setRuleSourceEditForm(emptyRuleSourceEditForm);
      return;
    }
    setRuleSourceEditForm({
      id: ruleSource.id,
      name: ruleSource.name,
      sourceUrl: ruleSource.sourceUrl,
      format: ruleSource.format,
      enabled: ruleSource.enabled
    });
  }, [resources.ruleSources, ruleSourceEditForm.id]);

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
    const [users, nodes, templates, remoteSubscriptionSources, ruleSources, syncLogs, auditLogs] = await Promise.all([
      fetchUsers(currentToken),
      fetchNodes(currentToken),
      fetchTemplates(currentToken),
      fetchRemoteSubscriptionSources(currentToken),
      fetchRuleSources(currentToken),
      fetchSyncLogs(currentToken),
      fetchAuditLogs(currentToken)
    ]);
    const firstUser = users[0];

    setResources({ users, nodes, templates, remoteSubscriptionSources, ruleSources, syncLogs, auditLogs });
    setPreviewForm((current) => ({
      ...current,
      userId: users.some((user) => user.id === current.userId) ? current.userId : firstUser?.id ?? ''
    }));
    setBindingUserId((current) => (users.some((user) => user.id === current) ? current : firstUser?.id ?? ''));
    return { users, nodes, templates, remoteSubscriptionSources, ruleSources, syncLogs, auditLogs };
  }

  async function loadUserBindings(userId: string): Promise<void> {
    try {
      const bindings = await fetchUserNodeBindings(token, userId);
      setBindingNodeIds(bindings.filter((item) => item.enabled).map((item) => item.nodeId));
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    }
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

  async function handleCreateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateUserDraft(userForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(async () => {
      await createUser(token, userForm);
      setUserForm({ name: '', remark: '', expiresAt: '' });
    }, '用户已创建');
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !userEditForm.id) return;

    const validationError = validateUserDraft(userEditForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(
      () =>
        updateUser(token, userEditForm.id, {
          name: userEditForm.name,
          status: userEditForm.status,
          remark: userEditForm.remark,
          expiresAt: userEditForm.expiresAt || null
        }),
      '用户已更新'
    );
  }

  async function handleResetUserToken(userId: string): Promise<void> {
    if (!token) return;
    await withAction(() => resetUserToken(token, userId), '用户 token 已重置');
  }

  async function handleDeleteUser(userId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该用户吗？')) return;

    await withAction(async () => {
      await deleteUser(token, userId);
      setPreview(null);
    }, '用户已删除');
  }

  async function handleSaveBindings(): Promise<void> {
    if (!token || !bindingUserId) return;
    await withAction(() => replaceUserNodeBindings(token, bindingUserId, bindingNodeIds), '用户节点绑定已更新');
  }

  function toggleBindingNode(nodeId: string): void {
    setBindingNodeIds((current) =>
      current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId]
    );
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

    setPreviewForm((current) => ({ ...current, userId: managedUser.id }));
    setBindingUserId(managedUser.id);
    setBindingNodeIds(boundNodeIds);

    return {
      userId: managedUser.id,
      userName: managedUser.name,
      token: managedUser.token,
      sourceLabel: input.sourceLabel,
      nodeCount: boundNodeIds.length,
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
      const result = await importNodes(
        token,
        input.importedNodes.map((importedNode): NodeImportInput => ({
          name: importedNode.name,
          protocol: importedNode.protocol,
          server: importedNode.server,
          port: importedNode.port,
          ...(importedNode.credentials ? { credentials: importedNode.credentials } : {}),
          ...(importedNode.params ? { params: importedNode.params } : {})
        }))
      );
      await refreshResources();
      input.onSuccess?.();

      setMessage(
        `已处理 ${result.importedCount} 个节点（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 去重 ${
          result.duplicateCount ?? 0
        }）${
          input.errorCount > 0 ? `，另有 ${input.errorCount} 条解析失败未导入` : ''
        }，已导入到节点列表；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”`
      );
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
      const result = await importNodes(
        token,
        parsedConfigImport.nodes.map((importedNode): NodeImportInput => ({
          name: importedNode.name,
          protocol: importedNode.protocol,
          server: importedNode.server,
          port: importedNode.port,
          ...(importedNode.credentials ? { credentials: importedNode.credentials } : {}),
          ...(importedNode.params ? { params: importedNode.params } : {})
        }))
      );
      const nextResources = await refreshResources();
      await ensureAutoHostedTemplates(nextResources.templates, parsedConfigImport);
      await refreshResources();

      setMessage(
        `已处理 ${result.importedCount} 个节点（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 去重 ${
          result.duplicateCount ?? 0
        }）${
          parsedConfigImport.errors.length > 0 ? `，另有 ${parsedConfigImport.errors.length} 条解析失败未导入` : ''
        }，并已更新自动托管模板骨架；如需客户端直接使用，请先调整节点，再点击“使用当前启用节点生成托管 URL”`
      );
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
      setMessage(
        previewResult.nodes.length > 0
          ? `远程订阅已抓取，可导入 ${previewResult.nodes.length} 个节点${
              previewResult.errors.length > 0 ? `，另有 ${previewResult.errors.length} 条解析失败` : ''
            }`
          : '远程订阅已抓取，但当前没有解析出可导入节点'
      );
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
      '节点已更新，可到“预览”页重新验证订阅输出'
    );
  }

  async function handleDeleteNode(nodeId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该节点吗？')) return;

    await withAction(async () => {
      await deleteNode(token, nodeId);
      setPreview(null);
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
      const source = await createRemoteSubscriptionSource(token, {
        name: sourceName,
        sourceUrl
      });
      const syncResult = await syncRemoteSubscriptionSource(token, source.id);
      setRemoteSubscriptionSyncResult(syncResult);
      await refreshResources();
      setRemoteSubscriptionSourceForm(emptyRemoteSubscriptionSourceForm);
      setNodeImportSourceUrl('');
      setRemoteNodeImportPreview(null);
      setMessage(
        syncResult.status === 'failed'
          ? `自动同步源已保存，但首次同步失败：${syncResult.message}`
          : syncResult.changed
            ? `自动同步源已保存并完成首次同步（新增 ${syncResult.createdCount} / 更新 ${syncResult.updatedCount} / 禁用 ${syncResult.disabledCount}）。如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”`
            : `自动同步源已保存，当前共 ${syncResult.importedCount} 个节点。如需客户端直接使用，请再执行“使用当前启用节点生成托管 URL”`
      );
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateHostedFromEnabledNodes(): Promise<void> {
    if (!token) return;

    const enabledNodes = resources.nodes.filter((node) => node.enabled);

    if (enabledNodes.length === 0) {
      reportValidationError('当前没有启用节点，无法生成托管订阅');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const nextHostedResult = await ensureHostedSubscriptions({
        currentResources: resources,
        sourceLabel: '当前启用节点',
        nodeRecords: enabledNodes
      });

      setHostedSubscriptionResult(nextHostedResult);
      await refreshResources();
      setMessage(
        `已按当前启用节点刷新托管 URL（${nextHostedResult.nodeCount} 个节点，${nextHostedResult.targets.filter((target) => target.ok).length}/${nextHostedResult.targets.length} 个目标已通过预览校验）`
      );
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
      setMessage(
        result.status === 'failed'
          ? `自动同步失败：${result.message}`
          : result.changed
            ? `自动同步已完成（新增 ${result.createdCount} / 更新 ${result.updatedCount} / 禁用 ${result.disabledCount}）`
            : `自动同步无变化，共 ${result.importedCount} 个节点`
      );
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

  async function handleCreateTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateTemplateDraft({
      name: templateForm.name,
      content: templateForm.content,
      version: 1
    });

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(() => createTemplate(token, templateForm), '模板已创建');
  }

  async function handleUpdateTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !templateEditForm.id) return;

    const validationError = validateTemplateDraft(templateEditForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(
      () =>
        updateTemplate(token, templateEditForm.id, {
          name: templateEditForm.name,
          content: templateEditForm.content,
          version: templateEditForm.version,
          enabled: templateEditForm.enabled,
          isDefault: templateEditForm.isDefault
        }),
      '模板已更新'
    );
  }

  async function handleSetDefaultTemplate(templateId: string): Promise<void> {
    if (!token) return;
    await withAction(() => setDefaultTemplate(token, templateId), '默认模板已更新');
  }

  async function handleDeleteTemplate(templateId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该模板吗？')) return;

    await withAction(async () => {
      await deleteTemplate(token, templateId);
      setPreview(null);
    }, '模板已删除');
  }

  async function handleCreateRuleSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateRuleSourceDraft({
      name: ruleSourceForm.name,
      sourceUrl: ruleSourceForm.sourceUrl
    });

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(async () => {
      await createRuleSource(token, ruleSourceForm);
      setRuleSourceForm({ name: '', sourceUrl: '', format: 'text' });
    }, '规则源已创建');
  }

  async function handleUpdateRuleSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !ruleSourceEditForm.id) return;

    const validationError = validateRuleSourceDraft(ruleSourceEditForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(
      () =>
        updateRuleSource(token, ruleSourceEditForm.id, {
          name: ruleSourceEditForm.name,
          sourceUrl: ruleSourceEditForm.sourceUrl,
          format: ruleSourceEditForm.format,
          enabled: ruleSourceEditForm.enabled
        }),
      '规则源已更新'
    );
  }

  async function handleSyncRuleSource(ruleSourceId: string): Promise<void> {
    if (!token) return;

    setLoading(true);
    setError('');

    try {
      const result = await syncRuleSource(token, ruleSourceId);
      setSyncResult(result);
      await refreshResources();
      setMessage(`规则源同步完成：${result.status} / ${result.ruleCount} rules`);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteRuleSource(ruleSourceId: string): Promise<void> {
    if (!token || !confirmDestructiveAction('确认删除该规则源吗？')) return;

    await withAction(async () => {
      await deleteRuleSource(token, ruleSourceId);
      setPreview(null);
      setSyncResult((current) => (current?.sourceId === ruleSourceId ? null : current));
    }, '规则源已删除');
  }

  async function handleRebuildCaches(): Promise<void> {
    if (!token) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await rebuildSubscriptionCaches(token);
      setCacheRebuildResult(result);
      await refreshResources();
      setMessage(`缓存重建已提交：${result.userCount} 个用户 / ${result.keysRequested} 个缓存键`);
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    if (!previewForm.userId) {
      reportValidationError('请先选择用户');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await fetchPreview(token, previewForm.userId, previewForm.target);
      setPreview(result);
      setMessage('预览已刷新');
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
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

      {activeTab === 'overview' ? (
        <OverviewPanel
          {...resources}
          loading={loading}
          cacheRebuildResult={cacheRebuildResult}
          onRebuildCaches={() => void handleRebuildCaches()}
        />
      ) : null}

      {activeTab === 'users' ? (
        <section className="panel-grid users-grid">
          <article className="panel">
            <h2>创建用户</h2>
            <form className="form-grid" onSubmit={handleCreateUser}>
              <Field label="名称">
                <input value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field label="备注">
                <input value={userForm.remark} onChange={(event) => setUserForm((current) => ({ ...current, remark: event.target.value }))} />
              </Field>
              <Field label="到期时间">
                <input value={userForm.expiresAt} onChange={(event) => setUserForm((current) => ({ ...current, expiresAt: event.target.value }))} placeholder="2026-12-31T23:59:59.000Z" />
              </Field>
              <button type="submit" disabled={loading}>创建用户</button>
            </form>
          </article>

          <article className="panel">
            <h2>编辑用户</h2>
            <form className="form-grid" onSubmit={handleUpdateUser}>
              <Field label="选择用户">
                <select value={userEditForm.id} onChange={(event) => setUserEditForm((current) => ({ ...current, id: event.target.value }))}>
                  <option value="">请选择用户</option>
                  {resources.users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="名称">
                <input value={userEditForm.name} onChange={(event) => setUserEditForm((current) => ({ ...current, name: event.target.value }))} />
              </Field>
              <Field label="状态">
                <select value={userEditForm.status} onChange={(event) => setUserEditForm((current) => ({ ...current, status: event.target.value }))}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </Field>
              <Field label="备注">
                <input value={userEditForm.remark} onChange={(event) => setUserEditForm((current) => ({ ...current, remark: event.target.value }))} />
              </Field>
              <Field label="到期时间">
                <input value={userEditForm.expiresAt} onChange={(event) => setUserEditForm((current) => ({ ...current, expiresAt: event.target.value }))} />
              </Field>
              <button type="submit" disabled={loading || !userEditForm.id}>保存用户</button>
            </form>
          </article>

          <article className="panel">
            <h2>用户节点绑定</h2>
            <div className="form-grid">
              <Field label="目标用户">
                <select value={bindingUserId} onChange={(event) => setBindingUserId(event.target.value)}>
                  <option value="">请选择用户</option>
                  {resources.users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </Field>
              <div className="checkbox-list">
                {resources.nodes.length > 0 ? (
                  resources.nodes.map((node) => (
                    <label className="checkbox-row" key={node.id}>
                      <input type="checkbox" checked={bindingNodeIds.includes(node.id)} onChange={() => toggleBindingNode(node.id)} />
                      <span>{node.name} / {node.protocol} / {node.server}:{node.port}</span>
                    </label>
                  ))
                ) : (
                  <p className="helper">暂无节点，请先创建节点。</p>
                )}
              </div>
              <button type="button" disabled={loading || !bindingUserId} onClick={() => void handleSaveBindings()}>
                保存绑定
              </button>
            </div>
          </article>

          <article className="panel full-width">
            <h2>用户列表</h2>
            <ResourceTable
              columns={['名称', '状态', 'Token', '备注', '操作']}
              rows={resources.users.map((user) => [
                user.name,
                user.status,
                user.token,
                user.remark ?? '-',
                <div className="inline-actions" key={user.id}>
                  <button type="button" onClick={() => setBindingUserId(user.id)}>绑定节点</button>
                  <button type="button" onClick={() => setUserEditForm((current) => ({ ...current, id: user.id }))}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void handleResetUserToken(user.id)}>重置 Token</button>
                  <button type="button" className="danger" onClick={() => void handleDeleteUser(user.id)}>删除</button>
                </div>
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'nodes' ? (
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
          </article>

          <article className="panel full-width">
            <h2>统一生成托管订阅</h2>
            <p className="helper">
              这是唯一的生成出口。当你已经导入并调整完节点后，使用这里按当前启用节点整体刷新托管 URL。
            </p>
            <div className="inline-actions">
              <button type="button" disabled={loading || enabledNodeCount === 0} onClick={() => void handleGenerateHostedFromEnabledNodes()}>
                使用当前启用节点生成托管 URL
              </button>
              <span>当前启用节点：{enabledNodeCount}</span>
            </div>
          </article>

          {hostedSubscriptionResult ? (
            <article className="panel full-width">
              <h2>当前托管 URL</h2>
              <p className="helper">
                最近一次来源：{hostedSubscriptionResult.sourceLabel}。系统会复用同一组个人托管链接，当前这组托管订阅已绑定 {hostedSubscriptionResult.nodeCount} 个节点。
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
      ) : null}

      {activeTab === 'templates' ? (
        <section className="panel-grid users-grid">
          <article className="panel">
            <h2>创建模板</h2>
            <form className="form-grid" onSubmit={handleCreateTemplate}>
              <Field label="名称"><input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="目标">
                <select value={templateForm.targetType} onChange={(event) => setTemplateForm((current) => ({ ...current, targetType: event.target.value as SubscriptionTarget }))}>
                  {SUBSCRIPTION_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}
                </select>
              </Field>
              <Field label="内容" full>
                <textarea value={templateForm.content} onChange={(event) => setTemplateForm((current) => ({ ...current, content: event.target.value }))} rows={10} />
              </Field>
              <TemplateStructureAssistant
                targetType={templateForm.targetType}
                content={templateForm.content}
                availableNodeNames={resources.nodes.map((node) => node.name)}
                onContentChange={(content) => setTemplateForm((current) => ({ ...current, content }))}
                onError={reportValidationError}
                onMessage={(messageText) => {
                  setError('');
                  setMessage(messageText);
                }}
              />
              <label className="checkbox-row"><input type="checkbox" checked={templateForm.isDefault} onChange={(event) => setTemplateForm((current) => ({ ...current, isDefault: event.target.checked }))} /><span>设为默认模板</span></label>
              <button type="submit" disabled={loading}>创建模板</button>
            </form>
          </article>

          <article className="panel">
            <h2>编辑模板</h2>
            <form className="form-grid" onSubmit={handleUpdateTemplate}>
              <Field label="选择模板">
                <select value={templateEditForm.id} onChange={(event) => setTemplateEditForm((current) => ({ ...current, id: event.target.value }))}>
                  <option value="">请选择模板</option>
                  {resources.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </Field>
              <Field label="名称"><input value={templateEditForm.name} onChange={(event) => setTemplateEditForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="目标"><input value={templateEditForm.targetType} readOnly /></Field>
              <Field label="版本"><input type="number" value={templateEditForm.version} onChange={(event) => setTemplateEditForm((current) => ({ ...current, version: Number(event.target.value) }))} /></Field>
              <Field label="内容" full>
                <textarea value={templateEditForm.content} onChange={(event) => setTemplateEditForm((current) => ({ ...current, content: event.target.value }))} rows={10} />
              </Field>
              <TemplateStructureAssistant
                targetType={templateEditForm.targetType}
                content={templateEditForm.content}
                availableNodeNames={resources.nodes.map((node) => node.name)}
                onContentChange={(content) => setTemplateEditForm((current) => ({ ...current, content }))}
                onError={reportValidationError}
                onMessage={(messageText) => {
                  setError('');
                  setMessage(messageText);
                }}
              />
              <label className="checkbox-row"><input type="checkbox" checked={templateEditForm.enabled} onChange={(event) => setTemplateEditForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用模板</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={templateEditForm.isDefault} onChange={(event) => setTemplateEditForm((current) => ({ ...current, isDefault: event.target.checked }))} /><span>作为默认模板</span></label>
              <button type="submit" disabled={loading || !templateEditForm.id}>保存模板</button>
            </form>
          </article>

          <article className="panel full-width">
            <h2>模板列表</h2>
            <ResourceTable
              columns={['名称', '目标', '版本', '默认', '状态', '操作']}
              rows={resources.templates.map((template) => [
                template.name,
                template.targetType,
                template.version,
                template.isDefault ? 'yes' : 'no',
                template.status,
                <div className="inline-actions" key={template.id}>
                  <button type="button" onClick={() => setTemplateEditForm((current) => ({ ...current, id: template.id }))}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void handleSetDefaultTemplate(template.id)}>设为默认</button>
                  <button type="button" className="danger" onClick={() => void handleDeleteTemplate(template.id)}>删除</button>
                </div>
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'ruleSources' ? (
        <section className="panel-grid users-grid">
          <article className="panel">
            <h2>创建规则源</h2>
            <form className="form-grid" onSubmit={handleCreateRuleSource}>
              <Field label="名称"><input value={ruleSourceForm.name} onChange={(event) => setRuleSourceForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="URL"><input value={ruleSourceForm.sourceUrl} onChange={(event) => setRuleSourceForm((current) => ({ ...current, sourceUrl: event.target.value }))} /></Field>
              <Field label="格式">
                <select value={ruleSourceForm.format} onChange={(event) => setRuleSourceForm((current) => ({ ...current, format: event.target.value as RuleSourceRecord['format'] }))}>
                  <option value="text">text</option>
                  <option value="yaml">yaml</option>
                  <option value="json">json</option>
                </select>
              </Field>
              <button type="submit" disabled={loading}>创建规则源</button>
            </form>
          </article>

          <article className="panel">
            <h2>编辑规则源</h2>
            <form className="form-grid" onSubmit={handleUpdateRuleSource}>
              <Field label="选择规则源">
                <select value={ruleSourceEditForm.id} onChange={(event) => setRuleSourceEditForm((current) => ({ ...current, id: event.target.value }))}>
                  <option value="">请选择规则源</option>
                  {resources.ruleSources.map((ruleSource) => <option key={ruleSource.id} value={ruleSource.id}>{ruleSource.name}</option>)}
                </select>
              </Field>
              <Field label="名称"><input value={ruleSourceEditForm.name} onChange={(event) => setRuleSourceEditForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="URL"><input value={ruleSourceEditForm.sourceUrl} onChange={(event) => setRuleSourceEditForm((current) => ({ ...current, sourceUrl: event.target.value }))} /></Field>
              <Field label="格式">
                <select value={ruleSourceEditForm.format} onChange={(event) => setRuleSourceEditForm((current) => ({ ...current, format: event.target.value as RuleSourceRecord['format'] }))}>
                  <option value="text">text</option>
                  <option value="yaml">yaml</option>
                  <option value="json">json</option>
                </select>
              </Field>
              <label className="checkbox-row"><input type="checkbox" checked={ruleSourceEditForm.enabled} onChange={(event) => setRuleSourceEditForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用规则源</span></label>
              <button type="submit" disabled={loading || !ruleSourceEditForm.id}>保存规则源</button>
            </form>
          </article>

          <article className="panel full-width">
            <h2>规则源列表</h2>
            <ResourceTable
              columns={['名称', '格式', '状态', '失败次数', '上次同步', 'URL', '操作']}
              rows={resources.ruleSources.map((ruleSource) => [
                ruleSource.name,
                ruleSource.format,
                formatSyncStatusLabel(ruleSource.lastSyncStatus ?? 'never'),
                ruleSource.failureCount,
                ruleSource.lastSyncAt ?? '-',
                ruleSource.sourceUrl,
                <div className="inline-actions" key={ruleSource.id}>
                  <button type="button" onClick={() => setRuleSourceEditForm((current) => ({ ...current, id: ruleSource.id }))}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void handleSyncRuleSource(ruleSource.id)}>触发同步</button>
                  <button type="button" className="danger" onClick={() => void handleDeleteRuleSource(ruleSource.id)}>删除</button>
                </div>
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'syncLogs' ? (
        <section className="panel-grid">
          <article className="panel">
            <h2>同步状态</h2>
            {syncResult ? (
              <div className="result-card">
                <strong>{syncResult.sourceName}</strong>
                <span>状态：{formatSyncStatusLabel(syncResult.status)}</span>
                <span>变更：{syncResult.changed ? '有' : '无'}</span>
                <span>规则数：{syncResult.ruleCount}</span>
                <span>{syncResult.message}</span>
                {syncResult.details ? renderSyncDetails(syncResult.details) : null}
              </div>
            ) : (
              <p className="helper">在“规则源”页触发同步后，这里会显示最近一次结果。</p>
            )}
          </article>
          <article className="panel full-width">
            <h2>同步日志</h2>
            <ResourceTable
              columns={['时间', '来源', '状态', '消息', '详情']}
              rows={resources.syncLogs.map((log) => [
                log.createdAt,
                `${log.sourceType}${log.sourceId ? ` / ${log.sourceId}` : ''}`,
                formatSyncStatusLabel(log.status),
                log.message ?? '-',
                log.details ? renderSyncDetails(log.details) : '-'
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'auditLogs' ? (
        <section className="panel-grid">
          <article className="panel full-width">
            <h2>审计日志</h2>
            <ResourceTable
              columns={['时间', '管理员', '动作', '目标', '请求', '详情']}
              rows={resources.auditLogs.map((log) => [
                log.createdAt,
                log.actorAdminUsername ? `${log.actorAdminUsername} / ${log.actorAdminId}` : log.actorAdminId,
                renderAuditAction(log),
                renderAuditTarget(log),
                renderAuditRequest(log),
                renderAuditDetails(log)
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'preview' ? (
        <section className="panel-grid">
          <article className="panel">
            <h2>订阅预览</h2>
            <form className="form-grid" onSubmit={handlePreview}>
              <Field label="用户">
                <select value={previewForm.userId} onChange={(event) => setPreviewForm((current) => ({ ...current, userId: event.target.value }))}>
                  <option value="">请选择用户</option>
                  {resources.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </Field>
              <Field label="目标">
                <select value={previewForm.target} onChange={(event) => setPreviewForm((current) => ({ ...current, target: event.target.value as SubscriptionTarget }))}>
                  {SUBSCRIPTION_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}
                </select>
              </Field>
              <button type="submit" disabled={loading || !previewForm.userId}>拉取预览</button>
            </form>
          </article>
          <article className="panel preview-panel">
            <h2>预览结果</h2>
            {preview ? (
              <>
                <div className="inline-meta">
                  <span>{preview.mimeType}</span>
                  <span>{preview.cacheKey}</span>
                  <span>nodes: {preview.metadata.nodeCount}</span>
                  <span>rules: {preview.metadata.ruleSetCount}</span>
                </div>
                <pre>{preview.content}</pre>
              </>
            ) : (
              <p className="helper">选择用户并点击“拉取预览”。</p>
            )}
          </article>
        </section>
      ) : null}
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

function isValidDateTime(value: string): boolean {
  return !value || !Number.isNaN(Date.parse(value));
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function validateUserDraft(input: { name: string; expiresAt: string }): string | null {
  if (!input.name.trim()) return '用户名称不能为空';
  if (!isValidDateTime(input.expiresAt.trim())) return '到期时间必须是合法的日期时间';
  return null;
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

function findAutoHostedUser(users: UserRecord[]): UserRecord | null {
  return (
    users.find((user) => user.remark === AUTO_HOSTED_USER_REMARK) ??
    users.find((user) => user.name === AUTO_HOSTED_USER_NAME) ??
    null
  );
}

function findAutoHostedTemplate(templates: TemplateRecord[], target: SubscriptionTarget): TemplateRecord | null {
  return (
    templates.find((template) => template.targetType === target && template.name === AUTO_HOSTED_TEMPLATE_NAMES[target]) ?? null
  );
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

function buildHostedSubscriptionUrl(token: string, target: SubscriptionTarget): string {
  const origin =
    typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'http://127.0.0.1:8787';
  return `${origin}/s/${encodeURIComponent(token)}/${target}`;
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTemplateDraft(input: { name: string; content: string; version: number }): string | null {
  if (!input.name.trim()) return '模板名称不能为空';
  if (!input.content.trim()) return '模板内容不能为空';
  if (!Number.isInteger(input.version) || input.version <= 0) return '模板版本必须是正整数';
  return null;
}

function validateRuleSourceDraft(input: { name: string; sourceUrl: string }): string | null {
  if (!input.name.trim()) return '规则源名称不能为空';
  if (!input.sourceUrl.trim()) return '规则源 URL 不能为空';
  if (!isValidHttpUrl(input.sourceUrl.trim())) return '规则源 URL 必须是有效的 http/https 地址';
  return null;
}

function stringifyStructured(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderJsonBlock(value: unknown): JSX.Element {
  return <pre className="json-block">{stringifyStructured(value)}</pre>;
}

function readStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatSyncStatusLabel(status: string): string {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'skipped') return '跳过';
  if (status === 'never') return '未同步';
  return status;
}

function formatSyncStageLabel(stage: string): string {
  if (stage === 'fetch') return '拉取';
  if (stage === 'parse') return '解析';
  if (stage === 'compare') return '比对';
  return stage;
}

function formatSyncSeverityLabel(severity: string): string {
  if (severity === 'info') return '提示';
  if (severity === 'warning') return '警告';
  if (severity === 'error') return '错误';
  return severity;
}

function formatSyncErrorCodeLabel(errorCode: string): string {
  if (errorCode === 'FETCH_TIMEOUT') return '上游拉取超时';
  if (errorCode === 'FETCH_NETWORK_ERROR') return '上游网络异常';
  if (errorCode === 'UPSTREAM_HTTP_ERROR') return '上游返回异常状态';
  if (errorCode === 'EMPTY_UPSTREAM_CONTENT') return '上游内容为空';
  if (errorCode === 'INVALID_JSON') return 'JSON 无法解析';
  if (errorCode === 'UNSUPPORTED_JSON_SHAPE') return 'JSON 结构不受支持';
  if (errorCode === 'NO_VALID_RULES') return '未提取到有效规则';
  return errorCode;
}

function formatSyncSourceShapeLabel(sourceShape: string): string {
  if (sourceShape === 'plain-text') return '纯文本逐行';
  if (sourceShape === 'yaml-lines') return 'YAML 行文本';
  if (sourceShape === 'yaml-list') return 'YAML 列表';
  if (sourceShape === 'yaml-block') return 'YAML 块文本';
  if (sourceShape === 'invalid-json') return '非法 JSON';
  if (sourceShape === 'array') return 'JSON 数组';
  if (sourceShape.startsWith('object:')) {
    return `JSON 对象（键：${sourceShape.slice('object:'.length).split('|').join(' / ')}）`;
  }
  if (sourceShape.startsWith('yaml-') && sourceShape.endsWith('-inline')) {
    return `YAML 内联数组（${sourceShape.slice('yaml-'.length, -'-inline'.length)}）`;
  }
  return sourceShape;
}

function readBooleanValue(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readStringArrayValue(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function renderSyncDetails(value: unknown): JSX.Element {
  if (!isObjectRecord(value)) {
    return renderJsonBlock(value);
  }

  const errorCode = readStringValue(value, 'errorCode');
  const reason = readStringValue(value, 'reason');
  const operatorHint = readStringValue(value, 'operatorHint');
  const contentPreview = readStringValue(value, 'contentPreview');
  const supportedShapes = readStringArrayValue(value, 'supportedShapes');
  const retryable = readBooleanValue(value, 'retryable');
  const items = [
    (() => {
      const stage = readStringValue(value, 'stage');
      return stage ? `阶段：${formatSyncStageLabel(stage)}` : null;
    })(),
    (() => {
      const severity = readStringValue(value, 'severity');
      return severity ? `级别：${formatSyncSeverityLabel(severity)}` : null;
    })(),
    errorCode ? `诊断：${formatSyncErrorCodeLabel(errorCode)}` : null,
    errorCode ? `错误码：${errorCode}` : null,
    (() => {
      const format = readStringValue(value, 'format');
      return format ? `格式：${format}` : null;
    })(),
    (() => {
      const parser = readStringValue(value, 'parser');
      return parser ? `解析器：${parser}` : null;
    })(),
    (() => {
      const upstreamStatus = readNumberValue(value, 'upstreamStatus');
      return upstreamStatus !== null ? `HTTP：${upstreamStatus}` : null;
    })(),
    (() => {
      const contentType = readStringValue(value, 'contentType');
      return contentType ? `类型：${contentType}` : null;
    })(),
    (() => {
      const sourceShape = readStringValue(value, 'sourceShape');
      return sourceShape ? `结构：${formatSyncSourceShapeLabel(sourceShape)}` : null;
    })(),
    (() => {
      const fetchedBytes = readNumberValue(value, 'fetchedBytes');
      return fetchedBytes !== null ? `字节：${fetchedBytes}` : null;
    })(),
    (() => {
      const ruleCount = readNumberValue(value, 'ruleCount');
      return ruleCount !== null ? `规则：${ruleCount}` : null;
    })(),
    (() => {
      const extractedRuleCount = readNumberValue(value, 'extractedRuleCount');
      return extractedRuleCount !== null ? `提取：${extractedRuleCount}` : null;
    })(),
    (() => {
      const duplicateRuleCount = readNumberValue(value, 'duplicateRuleCount');
      return duplicateRuleCount !== null ? `重复：${duplicateRuleCount}` : null;
    })(),
    (() => {
      const ignoredLineCount = readNumberValue(value, 'ignoredLineCount');
      return ignoredLineCount !== null ? `忽略：${ignoredLineCount}` : null;
    })(),
    (() => {
      const durationMs = readNumberValue(value, 'durationMs');
      return durationMs !== null ? `耗时：${durationMs}ms` : null;
    })(),
    retryable === true ? '可重试：是' : retryable === false ? '可重试：否' : null
  ].filter((item): item is string => Boolean(item));

  return (
    <>
      {items.length > 0 ? (
        <div className="inline-meta">
          {items.map((item) => <span key={item}>{item}</span>)}
        </div>
      ) : null}
      {reason ? <p className="helper">原因：{reason}</p> : null}
      {operatorHint ? <p className="helper">建议：{operatorHint}</p> : null}
      {supportedShapes.length > 0 ? (
        <>
          <p className="helper">支持的源结构：</p>
          <div className="inline-meta">
            {supportedShapes.map((item) => <span key={item}>{item}</span>)}
          </div>
        </>
      ) : null}
      {contentPreview ? (
        <>
          <p className="helper">上游内容预览：</p>
          <pre className="json-block">{contentPreview}</pre>
        </>
      ) : null}
      {renderJsonBlock(value)}
    </>
  );
}

function formatAuditActionLabel(action: string): string {
  if (action === 'user.create') return '创建用户';
  if (action === 'user.update') return '更新用户';
  if (action === 'user.reset_token') return '重置用户令牌';
  if (action === 'user.bind_nodes') return '更新用户节点绑定';
  if (action === 'node.create') return '创建节点';
  if (action === 'node.import') return '批量导入节点';
  if (action === 'node.import_remote') return '同步远程节点源';
  if (action === 'node.update') return '更新节点';
  if (action === 'node.delete') return '删除节点';
  if (action === 'template.create') return '创建模板';
  if (action === 'template.update') return '更新模板';
  if (action === 'template.set_default') return '设为默认模板';
  if (action === 'rule_source.create') return '创建规则源';
  if (action === 'rule_source.update') return '更新规则源';
  if (action === 'rule_source.sync') return '同步规则源';
  if (action === 'cache.rebuild') return '重建缓存';
  return action;
}

function formatAuditTargetTypeLabel(targetType: string): string {
  if (targetType === 'user') return '用户';
  if (targetType === 'node') return '节点';
  if (targetType === 'template') return '模板';
  if (targetType === 'rule_source') return '规则源';
  if (targetType === 'cache') return '缓存';
  return targetType;
}

function formatAuditTargetLabel(log: AuditLogRecord): string {
  const targetTypeLabel = formatAuditTargetTypeLabel(log.targetType);
  if (log.targetDisplayName) return `${targetTypeLabel} / ${log.targetDisplayName}`;
  if (log.targetId) return `${targetTypeLabel} / ${log.targetId}`;
  return targetTypeLabel;
}

function getAuditPayloadDetails(log: AuditLogRecord): unknown {
  if (!isObjectRecord(log.payload)) {
    return log.payload ?? null;
  }

  const { _request, ...rest } = log.payload;
  return Object.keys(rest).length > 0 ? rest : null;
}

function renderAuditAction(log: AuditLogRecord): JSX.Element {
  return (
    <>
      <div>{formatAuditActionLabel(log.action)}</div>
      <div className="helper">{log.action}</div>
    </>
  );
}

function renderAuditTarget(log: AuditLogRecord): JSX.Element {
  return (
    <>
      <div>{formatAuditTargetTypeLabel(log.targetType)}</div>
      {log.targetDisplayName ? <div className="helper">{log.targetDisplayName}</div> : null}
      {log.targetId ? <div className="helper">{log.targetId}</div> : null}
    </>
  );
}

function renderAuditRequest(log: AuditLogRecord): JSX.Element {
  const requestMeta = log.requestMeta;

  if (!requestMeta) {
    return <span>-</span>;
  }

  const requestPath = requestMeta.method && requestMeta.path
    ? `${requestMeta.method} ${requestMeta.path}`
    : requestMeta.method ?? requestMeta.path ?? null;
  const requestLocation = [requestMeta.country, requestMeta.colo].filter((item): item is string => Boolean(item)).join(' / ');
  const items = [
    requestPath,
    requestMeta.ip ? `IP：${requestMeta.ip}` : null,
    requestLocation ? `地区：${requestLocation}` : null,
    requestMeta.rayId ? `Ray：${requestMeta.rayId}` : null
  ].filter((item): item is string => Boolean(item));

  return (
    <>
      {items.length > 0 ? (
        <div className="inline-meta">
          {items.map((item) => <span key={item}>{item}</span>)}
        </div>
      ) : null}
      {requestMeta.userAgent ? <div className="helper">{requestMeta.userAgent}</div> : null}
    </>
  );
}

function renderAuditDetails(log: AuditLogRecord): JSX.Element {
  const payload = getAuditPayloadDetails(log);

  if (payload == null) {
    return <span>-</span>;
  }

  return renderJsonBlock(payload);
}

interface OverviewPanelProps extends ResourceState {
  loading: boolean;
  cacheRebuildResult: CacheRebuildPayload | null;
  onRebuildCaches: () => void;
}

function OverviewPanel(props: OverviewPanelProps): JSX.Element {
  const latestLog = props.syncLogs[0];
  const latestAudit = props.auditLogs[0];

  return (
    <section className="panel-grid">
      <article className="panel">
        <h2>系统概览</h2>
        <ul className="overview-list">
          <li>用户：{props.users.length}</li>
          <li>节点：{props.nodes.length}</li>
          <li>模板：{props.templates.length}</li>
          <li>规则源：{props.ruleSources.length}</li>
          <li>同步日志：{props.syncLogs.length}</li>
          <li>审计日志：{props.auditLogs.length}</li>
        </ul>
      </article>
      <article className="panel">
        <h2>当前建议</h2>
        <ul className="overview-list">
          <li>首次部署时先完成安装向导或导入 demo 数据</li>
          <li>优先确认默认模板和节点绑定是否正确</li>
          <li>规则源同步后，查看同步日志与预览输出</li>
          <li>资源变更后，相关预览与订阅缓存会自动失效</li>
        </ul>
        {latestLog ? <p className="helper">最近同步：{formatSyncStatusLabel(latestLog.status)} / {latestLog.message ?? '-'}</p> : null}
        {latestAudit ? <p className="helper">最近审计：{formatAuditActionLabel(latestAudit.action)} / {formatAuditTargetLabel(latestAudit)}</p> : null}
      </article>
      <article className="panel">
        <h2>缓存维护</h2>
        <p className="helper">当模板、规则或节点发生批量调整时，可手动清理现有预览与公开订阅缓存；下一次访问会按最新数据自动重建。</p>
        <div className="inline-actions">
          <button
            type="button"
            className="secondary"
            onClick={props.onRebuildCaches}
            disabled={props.loading || props.users.length === 0}
          >
            重建订阅缓存
          </button>
        </div>
        {props.cacheRebuildResult ? (
          <div className="result-card">
            <strong>最近一次缓存重建</strong>
            <span>时间：{props.cacheRebuildResult.rebuiltAt}</span>
            <span>用户数：{props.cacheRebuildResult.userCount}</span>
            <span>目标：{props.cacheRebuildResult.targets.join(' / ')}</span>
            <span>失效请求：{props.cacheRebuildResult.keysRequested} 个缓存键</span>
          </div>
        ) : (
          <p className="helper">当前只会清理缓存，不会主动预热；预览页或公开订阅在下一次访问时会即时生成最新内容。</p>
        )}
        {props.users.length === 0 ? <p className="helper">当前还没有用户，无需手动重建缓存。</p> : null}
      </article>
    </section>
  );
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
          `hysteria2` 向导当前优先覆盖 `password`、`sni`、`obfs`、`obfs-password`、`alpn`、`insecure`；多端口和更复杂组合仍请直接核对 JSON。
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
