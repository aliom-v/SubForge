import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  getServiceMetadata
} from '@subforge/core';
import {
  SUBSCRIPTION_TARGETS,
  type AuditLogRecord,
  type NodeRecord,
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
  importRemoteNodes,
  login,
  rebuildSubscriptionCaches,
  logout,
  previewNodeImportFromUrl,
  replaceUserNodeBindings,
  resetUserToken,
  setDefaultTemplate,
  syncRuleSource,
  updateNode,
  updateRuleSource,
  updateTemplate,
  updateUser,
  type AdminSession,
  type NodeImportPreviewPayload,
  type CacheRebuildPayload,
  type NodeImportInput,
  type NodeImportPayload,
  type PreviewPayload,
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
import { parseNodeImportText, type ImportedNodePayload, type NodeImportContentEncoding } from './node-import';
import { canonicalizeNodeProtocol, validateNodeProtocolMetadata } from './node-protocol-validation';

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

const emptyResources: ResourceState = {
  users: [],
  nodes: [],
  templates: [],
  ruleSources: [],
  syncLogs: [],
  auditLogs: []
};

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
const emptyTemplateEditForm: TemplateEditForm = { id: '', name: '', content: '', version: 1, enabled: true, isDefault: false };
const emptyRuleSourceEditForm: RuleSourceEditForm = { id: '', name: '', sourceUrl: '', format: 'text', enabled: true };

function formatNodeImportContentEncoding(value: NodeImportContentEncoding): string {
  return value === 'base64_text' ? 'Base64 订阅文本' : '明文分享链接';
}

const nodeImportPlaceholder = `[
  {
    "name": "HK-01",
    "protocol": "vless",
    "server": "hk.example.com",
    "port": 443,
    "enabled": true,
    "credentials": { "uuid": "replace-with-uuid" },
    "params": { "tls": true, "sni": "hk.example.com" }
  }
]`;

export function App(): JSX.Element {
  const [token, setToken] = useState<string>(() => localStorage.getItem(sessionStorageKey) ?? '');
  const [admin, setAdmin] = useState<AdminSession | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [resources, setResources] = useState<ResourceState>(emptyResources);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [syncResult, setSyncResult] = useState<RuleSourceSyncPayload | null>(null);
  const [cacheRebuildResult, setCacheRebuildResult] = useState<CacheRebuildPayload | null>(null);
  const [nodeImportResult, setNodeImportResult] = useState<NodeImportPayload | null>(null);
  const [remoteNodeImportResult, setRemoteNodeImportResult] = useState<NodeImportPayload | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(null);

  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [setupForm, setSetupForm] = useState({ username: 'admin', password: '', confirmPassword: '' });
  const [userForm, setUserForm] = useState({ name: '', remark: '', expiresAt: '' });
  const [nodeForm, setNodeForm] = useState<NodeDraftForm>(emptyNodeDraftForm);
  const [nodeImportText, setNodeImportText] = useState('');
  const [nodeImportSourceUrl, setNodeImportSourceUrl] = useState('');
  const [remoteNodeImportPreview, setRemoteNodeImportPreview] = useState<NodeImportPreviewPayload | null>(null);
  const [remoteNodeSourceUrl, setRemoteNodeSourceUrl] = useState('');
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
      { label: 'Users', value: resources.users.length },
      { label: 'Nodes', value: resources.nodes.length },
      { label: 'Templates', value: resources.templates.length },
      { label: 'Rule Sources', value: resources.ruleSources.length },
      { label: 'Sync Logs', value: resources.syncLogs.length },
      { label: 'Audit Logs', value: resources.auditLogs.length }
    ],
    [resources]
  );
  const nodeCreateExamples = useMemo(() => getNodeMetadataExamples(nodeForm.protocol), [nodeForm.protocol]);
  const nodeEditExamples = useMemo(() => getNodeMetadataExamples(nodeEditForm.protocol), [nodeEditForm.protocol]);
  const parsedNodeImport = useMemo(() => parseNodeImportText(nodeImportText), [nodeImportText]);
  const firstImportedNode = parsedNodeImport.nodes[0];
  const firstRemoteImportedNode = remoteNodeImportPreview?.nodes[0];

  function reportValidationError(messageText: string): void {
    setMessage('');
    setError(messageText);
  }

  function resetSessionState(): void {
    setAdmin(null);
    setResources(emptyResources);
    setPreview(null);
    setSyncResult(null);
    setCacheRebuildResult(null);
    setNodeImportResult(null);
    setRemoteNodeImportResult(null);
    setRemoteNodeImportPreview(null);
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

  async function refreshResources(currentToken = token): Promise<void> {
    const [users, nodes, templates, ruleSources, syncLogs, auditLogs] = await Promise.all([
      fetchUsers(currentToken),
      fetchNodes(currentToken),
      fetchTemplates(currentToken),
      fetchRuleSources(currentToken),
      fetchSyncLogs(currentToken),
      fetchAuditLogs(currentToken)
    ]);
    const firstUser = users[0];

    setResources({ users, nodes, templates, ruleSources, syncLogs, auditLogs });
    setPreviewForm((current) => ({
      ...current,
      userId: users.some((user) => user.id === current.userId) ? current.userId : firstUser?.id ?? ''
    }));
    setBindingUserId((current) => (users.some((user) => user.id === current) ? current : firstUser?.id ?? ''));
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
    }, '节点已创建，请到“用户”页完成绑定并在“预览”页验证输出');
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
      for (const importedNode of input.importedNodes) {
        await createNode(token, {
          name: importedNode.name,
          protocol: importedNode.protocol,
          server: importedNode.server,
          port: importedNode.port,
          credentials: importedNode.credentials,
          params: importedNode.params
        });
      }

      await refreshResources();
      input.onSuccess?.();
      setMessage(
        `已导入 ${input.importedNodes.length} 个节点${
          input.errorCount > 0 ? `，另有 ${input.errorCount} 条解析失败未导入` : ''
        }，请到“用户”页完成绑定并在“预览”页验证输出`
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

  async function handlePreviewNodeImportFromUrl(): Promise<void> {
    if (!token) return;

    if (!nodeImportSourceUrl.trim()) {
      reportValidationError('请先填写订阅 URL');
      return;
    }

    setLoading(true);
    setError('');
    setRemoteNodeImportPreview(null);

    try {
      const result = await previewNodeImportFromUrl(token, nodeImportSourceUrl.trim());
      setRemoteNodeImportPreview(result);
      setMessage(
        result.nodes.length > 0
          ? `远程订阅已抓取，可导入 ${result.nodes.length} 个节点${
              result.errors.length > 0 ? `，另有 ${result.errors.length} 条解析失败` : ''
            }`
          : '远程订阅已抓取，但当前没有解析出可导入节点'
      );
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePreviewedRemoteNodes(): Promise<void> {
    if (!token) return;

    if (!remoteNodeImportPreview) {
      reportValidationError('请先抓取并预览订阅 URL');
      return;
    }

    await createImportedNodes({
      importedNodes: remoteNodeImportPreview.nodes,
      errorCount: remoteNodeImportPreview.errors.length,
      onSuccess: () => setRemoteNodeImportPreview(null)
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

  async function handleImportNodes(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const parsed = parseNodeImportDraft(nodeImportText);

    if (!parsed.ok) {
      reportValidationError(parsed.error);
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await importNodes(token, parsed.nodes);
      setNodeImportResult(result);
      setNodeImportText('');
      await refreshResources();
      setMessage(
        `已处理 ${result.importedCount} 个节点（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 去重 ${result.duplicateCount ?? 0}）`
      );
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
  }

  async function handleImportRemoteNodes(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const sourceUrl = remoteNodeSourceUrl.trim();

    if (!isValidHttpUrl(sourceUrl)) {
      reportValidationError('远程节点源 URL 必须是合法的 http / https 地址');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await importRemoteNodes(token, sourceUrl);
      setRemoteNodeImportResult(result);
      await refreshResources();
      setMessage(
        result.changed
          ? `远程节点源已同步（新增 ${result.createdCount ?? 0} / 更新 ${result.updatedCount ?? 0} / 禁用 ${result.disabledCount ?? 0}）`
          : `远程节点源无变化，共 ${result.importedCount} 个节点`
      );
    } catch (caughtError) {
      await handleProtectedApiError(caughtError);
    } finally {
      setLoading(false);
    }
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
          <p className="eyebrow">SubForge / Phase 5</p>
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
          <p className="eyebrow">SubForge / Phase 5</p>
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

      <nav className="tabs">
        {[
          ['overview', '概览'],
          ['users', '用户'],
          ['nodes', '节点'],
          ['templates', '模板'],
          ['ruleSources', '规则源'],
          ['syncLogs', '同步日志'],
          ['auditLogs', '审计日志'],
          ['preview', '预览']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={activeTab === key ? 'tab active' : 'tab'}
            onClick={() => setActiveTab(key as TabKey)}
          >
            {label}
          </button>
        ))}
      </nav>

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
          <article className="panel">
            <h2>节点录入说明</h2>
            <ul className="overview-list">
              <li>当前支持手动录入、`vless://` / `trojan://` / `vmess://` / `ss://` / `hysteria2://` 分享链接导入，以及订阅 URL 远程抓取预览导入。</li>
              <li>节点创建后还需要到“用户”页完成绑定，否则订阅不会包含该节点。</li>
              <li>要生成真实可用节点，通常还需要补齐 `credentials` 与 `params`。</li>
              <li>常见协议 `vless` / `trojan` / `vmess` / `ss` / `hysteria2` 已提供结构化向导；更复杂变体继续使用原始 JSON。</li>
              <li>表单里的 JSON 留空或填写 `null` 表示不写入或清空 metadata。</li>
            </ul>
            <div className="metadata-grid">
              <div className="result-card">
                <strong>凭据示例</strong>
                <pre>{nodeCreateExamples.credentials}</pre>
              </div>
              <div className="result-card">
                <strong>参数示例</strong>
                <pre>{nodeCreateExamples.params}</pre>
              </div>
            </div>
            <p className="helper">
              当前支持“手动录入 + 分享链接导入 + 订阅 URL 远程预览导入 + 远程节点源手动同步”四条路径；但仍不支持把订阅 URL 自动持久化为可定时同步的节点源任务。
            </p>
          </article>

          <article className="panel">
            <h2>导入分享链接</h2>
            <div className="form-grid">
              <Field label="分享链接">
                <textarea
                  value={nodeImportText}
                  onChange={(event) => setNodeImportText(event.target.value)}
                  rows={8}
                  placeholder={[
                    'vless://uuid@host:443?security=tls&type=ws&sni=sub.example.com&path=%2Fws#HK%20VLESS',
                    'trojan://password@host:443?sni=sub.example.com#JP%20Trojan',
                    'vmess://eyJhZGQiOiJ2bWVzcy5leGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsImFpZCI6IjAiLCJuZXQiOiJ3cyIsInRscyI6InRscyIsInBzIjoiVkdNZXNzIn0=',
                    'ss://YWVzLTI1Ni1nY206cGFzc3cwcmQ=@ss.example.com:8388#SS%20Node',
                    'hysteria2://password@hy2.example.com:443?sni=sub.example.com&obfs=salamander&obfs-password=replace-me#HY2%20Node'
                  ].join('\n')}
                />
              </Field>
              <p className="helper full-span">
                每行一条分享链接。当前支持 `vless://`、`trojan://`、`vmess://`、`ss://`、`hysteria2://` / `hy2://`，也支持直接粘贴整段 Base64 订阅文本；如果你拿到的是订阅 URL，请使用下方远程抓取预览。
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
                  批量创建 {parsedNodeImport.nodes.length} 个节点
                </button>
                {firstImportedNode ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => loadImportedNodeToCreateForm(firstImportedNode)}
                  >
                    载入首条到创建表单
                  </button>
                ) : null}
              </div>
              {parsedNodeImport.errors.length > 0 ? (
                <div className="import-errors full-span">
                  <strong>解析错误</strong>
                  <ul className="overview-list">
                    {parsedNodeImport.errors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                  </ul>
                </div>
              ) : null}
              {parsedNodeImport.nodes.length > 0 ? (
                <div className="full-span">
                  <ResourceTable
                    columns={['名称', '协议', '地址', '端口', '元数据', '操作']}
                    rows={parsedNodeImport.nodes.map((node, index) => [
                      node.name,
                      node.protocol,
                      node.server,
                      node.port,
                      summarizeNodeMetadataParts(node.credentials, node.params),
                      <button type="button" key={`${node.name}-${index}`} onClick={() => loadImportedNodeToCreateForm(node)}>载入表单</button>
                    ])}
                  />
                </div>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <h2>导入订阅 URL</h2>
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
              <p className="helper full-span">
                Worker 会以管理员身份发起一次远程抓取并解析预览，不会把该 URL 保存成远程节点源，也不会自动持续同步。
              </p>
              <div className="inline-actions full-span">
                <button
                  type="button"
                  disabled={loading || !nodeImportSourceUrl.trim()}
                  onClick={() => void handlePreviewNodeImportFromUrl()}
                >
                  抓取并预览
                </button>
                {firstRemoteImportedNode ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => loadImportedNodeToCreateForm(firstRemoteImportedNode)}
                  >
                    载入首条到创建表单
                  </button>
                ) : null}
                {remoteNodeImportPreview ? (
                  <button
                    type="button"
                    disabled={loading || remoteNodeImportPreview.nodes.length === 0}
                    onClick={() => void handleCreatePreviewedRemoteNodes()}
                  >
                    批量创建 {remoteNodeImportPreview.nodes.length} 个节点
                  </button>
                ) : null}
              </div>
              {remoteNodeImportPreview ? (
                <>
                  <div className="metadata-grid full-span">
                    <div className="result-card">
                      <strong>远程来源</strong>
                      <pre>{remoteNodeImportPreview.sourceUrl}</pre>
                    </div>
                    <div className="result-card">
                      <strong>抓取摘要</strong>
                      <pre>{[
                        `HTTP ${remoteNodeImportPreview.upstreamStatus}`,
                        `耗时 ${remoteNodeImportPreview.durationMs} ms`,
                        `体积 ${remoteNodeImportPreview.fetchedBytes} bytes`,
                        `内容 ${formatNodeImportContentEncoding(remoteNodeImportPreview.contentEncoding)}`,
                        `有效行 ${remoteNodeImportPreview.lineCount}`
                      ].join('\n')}</pre>
                    </div>
                  </div>
                  {remoteNodeImportPreview.errors.length > 0 ? (
                    <div className="import-errors full-span">
                      <strong>解析错误</strong>
                      <ul className="overview-list">
                        {remoteNodeImportPreview.errors.map((errorText) => <li key={errorText}>{errorText}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {remoteNodeImportPreview.nodes.length > 0 ? (
                    <div className="full-span">
                      <ResourceTable
                        columns={['名称', '协议', '地址', '端口', '元数据', '操作']}
                        rows={remoteNodeImportPreview.nodes.map((node, index) => [
                          node.name,
                          node.protocol,
                          node.server,
                          node.port,
                          summarizeNodeMetadataParts(node.credentials, node.params),
                          <button type="button" key={`${node.name}-${index}`} onClick={() => loadImportedNodeToCreateForm(node)}>载入表单</button>
                        ])}
                      />
                    </div>
                  ) : (
                    <p className="helper full-span">
                      当前没有解析出可导入节点。远程内容需要是每行一条的 `vless://`、`trojan://`、`vmess://`、`ss://`、`hysteria2://` / `hy2://` 分享链接。
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <h2>创建节点</h2>
            <form className="form-grid" onSubmit={handleCreateNode}>
              <Field label="名称"><input value={nodeForm.name} onChange={(event) => setNodeForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="协议">
                <input
                  list="node-protocol-options"
                  value={nodeForm.protocol}
                  onChange={(event) => setNodeForm((current) => ({ ...current, protocol: event.target.value }))}
                  placeholder="vless / trojan / vmess / ss / hysteria2"
                />
              </Field>
              <Field label="地址"><input value={nodeForm.server} onChange={(event) => setNodeForm((current) => ({ ...current, server: event.target.value }))} /></Field>
              <Field label="端口"><input type="number" value={nodeForm.port} onChange={(event) => setNodeForm((current) => ({ ...current, port: Number(event.target.value) }))} /></Field>
              <NodeProtocolAssistant
                protocol={nodeForm.protocol}
                credentialsText={nodeForm.credentialsText}
                paramsText={nodeForm.paramsText}
                onMetadataChange={({ credentialsText, paramsText }) =>
                  setNodeForm((current) => ({ ...current, credentialsText, paramsText }))
                }
              />
              <Field label="凭据 JSON" full>
                <textarea
                  value={nodeForm.credentialsText}
                  onChange={(event) => setNodeForm((current) => ({ ...current, credentialsText: event.target.value }))}
                  rows={6}
                  placeholder={nodeCreateExamples.credentials}
                />
              </Field>
              <Field label="参数 JSON" full>
                <textarea
                  value={nodeForm.paramsText}
                  onChange={(event) => setNodeForm((current) => ({ ...current, paramsText: event.target.value }))}
                  rows={6}
                  placeholder={nodeCreateExamples.params}
                />
              </Field>
              <p className="helper full-span">
                可直接手动录入，也可先用上方分享链接导入。`ss` / `hysteria2` 已支持常见字段回填；复杂变体和高级参数仍建议继续核对 JSON，再完成用户绑定。
              </p>
              <button type="submit" disabled={loading}>创建节点</button>
            </form>
          </article>

          <article className="panel">
            <h2>批量导入</h2>
            <form className="form-grid" onSubmit={handleImportNodes}>
              <Field label="节点 JSON" full>
                <textarea
                  value={nodeImportText}
                  onChange={(event) => setNodeImportText(event.target.value)}
                  rows={12}
                  placeholder={nodeImportPlaceholder}
                />
              </Field>
              <p className="helper">支持直接粘贴 JSON 数组，或 <code>{'{"nodes": [...]}'}</code> 对象；每个节点至少需要 <code>name</code>、<code>protocol</code>、<code>server</code>、<code>port</code>。</p>
              <button type="submit" disabled={loading}>导入节点</button>
            </form>
            {nodeImportResult ? (
              <div className="result-card">
                <strong>最近一次批量导入</strong>
                <span>时间：{nodeImportResult.importedAt}</span>
                <span>数量：{nodeImportResult.importedCount}</span>
                <span>来源：{nodeImportResult.sourceType ?? 'manual'}</span>
                <span>新增：{nodeImportResult.createdCount ?? 0}</span>
                <span>更新：{nodeImportResult.updatedCount ?? 0}</span>
                <span>去重：{nodeImportResult.duplicateCount ?? 0}</span>
              </div>
            ) : (
              <p className="helper">适合一次性导入已有节点清单；导入完成后可继续在右侧逐条编辑。</p>
            )}
          </article>

          <article className="panel">
            <h2>远程节点源手动同步</h2>
            <form className="form-grid" onSubmit={handleImportRemoteNodes}>
              <Field label="远程 URL" full>
                <input
                  value={remoteNodeSourceUrl}
                  onChange={(event) => setRemoteNodeSourceUrl(event.target.value)}
                  placeholder="https://example.com/nodes.json"
                />
              </Field>
              <p className="helper">当前远程节点源要求返回 JSON 数组，或 <code>{'{"nodes": [...]}'}</code> 结构；同步时会按协议/地址/端口/凭证做去重。这是手动入口，不会自动定时拉取。</p>
              <button type="submit" disabled={loading}>同步远程节点源</button>
            </form>
            {remoteNodeImportResult ? (
              <div className="result-card">
                <strong>最近一次远程同步</strong>
                <span>时间：{remoteNodeImportResult.importedAt}</span>
                <span>数量：{remoteNodeImportResult.importedCount}</span>
                <span>来源：{remoteNodeImportResult.sourceId ?? 'remote'}</span>
                <span>新增：{remoteNodeImportResult.createdCount ?? 0}</span>
                <span>更新：{remoteNodeImportResult.updatedCount ?? 0}</span>
                <span>禁用：{remoteNodeImportResult.disabledCount ?? 0}</span>
                <span>去重：{remoteNodeImportResult.duplicateCount ?? 0}</span>
              </div>
            ) : (
              <p className="helper">适合对外部节点 JSON 做手动拉取同步；同一来源会复用已有远程节点，并自动禁用本次未出现的旧节点。</p>
            )}
          </article>

          <article className="panel">
            <h2>编辑节点</h2>
            <form className="form-grid" onSubmit={handleUpdateNode}>
              <Field label="选择节点">
                <select value={nodeEditForm.id} onChange={(event) => setNodeEditForm((current) => ({ ...current, id: event.target.value }))}>
                  <option value="">请选择节点</option>
                  {resources.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                </select>
              </Field>
              <Field label="名称"><input value={nodeEditForm.name} onChange={(event) => setNodeEditForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="协议">
                <input
                  list="node-protocol-options"
                  value={nodeEditForm.protocol}
                  onChange={(event) => setNodeEditForm((current) => ({ ...current, protocol: event.target.value }))}
                  placeholder="vless / trojan / vmess / ss / hysteria2"
                />
              </Field>
              <Field label="地址"><input value={nodeEditForm.server} onChange={(event) => setNodeEditForm((current) => ({ ...current, server: event.target.value }))} /></Field>
              <Field label="端口"><input type="number" value={nodeEditForm.port} onChange={(event) => setNodeEditForm((current) => ({ ...current, port: Number(event.target.value) }))} /></Field>
              <NodeProtocolAssistant
                protocol={nodeEditForm.protocol}
                credentialsText={nodeEditForm.credentialsText}
                paramsText={nodeEditForm.paramsText}
                onMetadataChange={({ credentialsText, paramsText }) =>
                  setNodeEditForm((current) => ({ ...current, credentialsText, paramsText }))
                }
              />
              <Field label="凭据 JSON" full>
                <textarea
                  value={nodeEditForm.credentialsText}
                  onChange={(event) => setNodeEditForm((current) => ({ ...current, credentialsText: event.target.value }))}
                  rows={6}
                  placeholder={nodeEditExamples.credentials}
                />
              </Field>
              <Field label="参数 JSON" full>
                <textarea
                  value={nodeEditForm.paramsText}
                  onChange={(event) => setNodeEditForm((current) => ({ ...current, paramsText: event.target.value }))}
                  rows={6}
                  placeholder={nodeEditExamples.params}
                />
              </Field>
              <label className="checkbox-row"><input type="checkbox" checked={nodeEditForm.enabled} onChange={(event) => setNodeEditForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用节点</span></label>
              <p className="helper full-span">
                这里会回显当前 metadata。留空或填写 `null` 表示清空已有的 `credentials` / `params`。
              </p>
              <button type="submit" disabled={loading || !nodeEditForm.id}>保存节点</button>
            </form>
          </article>

          <datalist id="node-protocol-options">
            {COMMON_NODE_PROTOCOLS.map((protocol) => <option key={protocol} value={protocol} />)}
          </datalist>

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
                  <button type="button" onClick={() => setNodeEditForm((current) => ({ ...current, id: node.id }))}>编辑</button>
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
              <Field label="版本"><input type="number" value={templateEditForm.version} onChange={(event) => setTemplateEditForm((current) => ({ ...current, version: Number(event.target.value) }))} /></Field>
              <Field label="内容" full>
                <textarea value={templateEditForm.content} onChange={(event) => setTemplateEditForm((current) => ({ ...current, content: event.target.value }))} rows={10} />
              </Field>
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

function parseNodeImportDraft(raw: string): { ok: true; nodes: NodeImportInput[] } | { ok: false; error: string } {
  if (!raw.trim()) {
    return { ok: false, error: '请先粘贴要导入的节点 JSON' };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '批量导入内容必须是合法 JSON' };
  }

  const rawNodes = Array.isArray(parsed) ? parsed : isObjectRecord(parsed) && Array.isArray(parsed.nodes) ? parsed.nodes : null;

  if (!rawNodes) {
    return { ok: false, error: '批量导入内容必须是 JSON 数组或包含 nodes 数组的对象' };
  }

  if (rawNodes.length === 0) {
    return { ok: false, error: '至少需要导入 1 个节点' };
  }

  if (rawNodes.length > 200) {
    return { ok: false, error: '单次最多导入 200 个节点' };
  }

  const nodes: NodeImportInput[] = [];

  for (const [index, rawNode] of rawNodes.entries()) {
    if (!isObjectRecord(rawNode)) {
      return { ok: false, error: `第 ${index + 1} 个节点必须是对象` };
    }

    const port =
      typeof rawNode.port === 'number'
        ? rawNode.port
        : typeof rawNode.port === 'string' && rawNode.port.trim()
          ? Number(rawNode.port)
          : Number.NaN;

    const draft: NodeImportInput = {
      name: typeof rawNode.name === 'string' ? rawNode.name.trim() : '',
      protocol: typeof rawNode.protocol === 'string' ? rawNode.protocol.trim() : '',
      server: typeof rawNode.server === 'string' ? rawNode.server.trim() : '',
      port
    };

    const validationError = validateNodeDraft(draft);

    if (validationError) {
      return { ok: false, error: `第 ${index + 1} 个节点无效：${validationError}` };
    }

    if ('enabled' in rawNode && typeof rawNode.enabled !== 'boolean') {
      return { ok: false, error: `第 ${index + 1} 个节点的 enabled 必须是布尔值` };
    }

    if ('credentials' in rawNode && rawNode.credentials != null && !isObjectRecord(rawNode.credentials)) {
      return { ok: false, error: `第 ${index + 1} 个节点的 credentials 必须是对象` };
    }

    if ('params' in rawNode && rawNode.params != null && !isObjectRecord(rawNode.params)) {
      return { ok: false, error: `第 ${index + 1} 个节点的 params 必须是对象` };
    }

    if (typeof rawNode.enabled === 'boolean') {
      draft.enabled = rawNode.enabled;
    }

    if (isObjectRecord(rawNode.credentials)) {
      draft.credentials = rawNode.credentials;
    }

    if (isObjectRecord(rawNode.params)) {
      draft.params = rawNode.params;
    }

    nodes.push(draft);
  }

  return { ok: true, nodes };
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
          当前协议暂无结构化字段向导，请继续使用下方 JSON 字段。常见的 `vless`、`trojan`、`vmess`、`ss`、`hysteria2`
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
        {preset !== 'ss' ? (
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
