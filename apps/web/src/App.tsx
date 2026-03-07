import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { getServiceMetadata } from '@subforge/core';
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
  login,
  logout,
  replaceUserNodeBindings,
  resetUserToken,
  setDefaultTemplate,
  syncRuleSource,
  updateNode,
  updateRuleSource,
  updateTemplate,
  updateUser,
  type AdminSession,
  type PreviewPayload,
  type RuleSourceSyncPayload,
  type SetupStatusPayload
} from './api';

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

interface NodeEditForm {
  id: string;
  name: string;
  protocol: string;
  server: string;
  port: number;
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
  const [setupStatus, setSetupStatus] = useState<SetupStatusPayload | null>(null);

  const [loginForm, setLoginForm] = useState({ username: 'admin', password: '' });
  const [setupForm, setSetupForm] = useState({ username: 'admin', password: '', confirmPassword: '' });
  const [userForm, setUserForm] = useState({ name: '', remark: '', expiresAt: '' });
  const [nodeForm, setNodeForm] = useState({ name: '', protocol: 'vless', server: '', port: 443 });
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

  const [userEditForm, setUserEditForm] = useState<UserEditForm>({ id: '', name: '', status: 'active', remark: '', expiresAt: '' });
  const [nodeEditForm, setNodeEditForm] = useState<NodeEditForm>({ id: '', name: '', protocol: '', server: '', port: 443, enabled: true });
  const [templateEditForm, setTemplateEditForm] = useState<TemplateEditForm>({ id: '', name: '', content: '', version: 1, enabled: true, isDefault: false });
  const [ruleSourceEditForm, setRuleSourceEditForm] = useState<RuleSourceEditForm>({ id: '', name: '', sourceUrl: '', format: 'text', enabled: true });

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

  function reportValidationError(messageText: string): void {
    setMessage('');
    setError(messageText);
  }

  useEffect(() => {
    void refreshSetupStatus();
  }, []);

  useEffect(() => {
    if (!token) {
      setAdmin(null);
      setResources(emptyResources);
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
    if (!user) return;
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
    if (!node) return;
    setNodeEditForm({
      id: node.id,
      name: node.name,
      protocol: node.protocol,
      server: node.server,
      port: node.port,
      enabled: node.enabled
    });
  }, [resources.nodes, nodeEditForm.id]);

  useEffect(() => {
    const template = resources.templates.find((item) => item.id === templateEditForm.id) ?? resources.templates[0];
    if (!template) return;
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
    if (!ruleSource) return;
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
      localStorage.removeItem(sessionStorageKey);
      setToken('');
      setAdmin(null);
      setResources(emptyResources);
      await refreshSetupStatus();
      setError(getErrorMessage(caughtError));
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

    setResources({ users, nodes, templates, ruleSources, syncLogs, auditLogs });

    if (!previewForm.userId && users[0]) {
      setPreviewForm((current) => ({ ...current, userId: users[0].id }));
    }

    if (!bindingUserId && users[0]) {
      setBindingUserId(users[0].id);
    }
  }

  async function loadUserBindings(userId: string): Promise<void> {
    try {
      const bindings = await fetchUserNodeBindings(token, userId);
      setBindingNodeIds(bindings.filter((item) => item.enabled).map((item) => item.nodeId));
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
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
      setError(getErrorMessage(caughtError));
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
    if (token) {
      try {
        await logout(token);
      } catch {
      }
    }

    localStorage.removeItem(sessionStorageKey);
    setToken('');
    setAdmin(null);
    setResources(emptyResources);
    setPreview(null);
    setMessage('已退出登录');
    setError('');
  }

  async function withAction(action: () => Promise<void>, successMessage?: string): Promise<void> {
    setLoading(true);
    setError('');

    try {
      await action();
      await refreshResources();
      if (successMessage) {
        setMessage(successMessage);
      }
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
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

    await withAction(async () => {
      await createNode(token, nodeForm);
      setNodeForm({ name: '', protocol: 'vless', server: '', port: 443 });
    }, '节点已创建');
  }

  async function handleUpdateNode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !nodeEditForm.id) return;

    const validationError = validateNodeDraft(nodeEditForm);

    if (validationError) {
      reportValidationError(validationError);
      return;
    }

    await withAction(
      () =>
        updateNode(token, nodeEditForm.id, {
          name: nodeEditForm.name,
          protocol: nodeEditForm.protocol,
          server: nodeEditForm.server,
          port: nodeEditForm.port,
          enabled: nodeEditForm.enabled
        }),
      '节点已更新'
    );
  }

  async function handleCreateTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateTemplateDraft({ ...templateForm, version: 1, enabled: true });

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

  async function handleCreateRuleSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) return;

    const validationError = validateRuleSourceDraft({ ...ruleSourceForm, enabled: true });

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
      setError(getErrorMessage(caughtError));
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
      setError(getErrorMessage(caughtError));
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

      {activeTab === 'overview' ? <OverviewPanel {...resources} /> : null}

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
                </div>
              ])}
            />
          </article>
        </section>
      ) : null}

      {activeTab === 'nodes' ? (
        <section className="panel-grid users-grid">
          <article className="panel">
            <h2>创建节点</h2>
            <form className="form-grid" onSubmit={handleCreateNode}>
              <Field label="名称"><input value={nodeForm.name} onChange={(event) => setNodeForm((current) => ({ ...current, name: event.target.value }))} /></Field>
              <Field label="协议"><input value={nodeForm.protocol} onChange={(event) => setNodeForm((current) => ({ ...current, protocol: event.target.value }))} /></Field>
              <Field label="地址"><input value={nodeForm.server} onChange={(event) => setNodeForm((current) => ({ ...current, server: event.target.value }))} /></Field>
              <Field label="端口"><input type="number" value={nodeForm.port} onChange={(event) => setNodeForm((current) => ({ ...current, port: Number(event.target.value) }))} /></Field>
              <button type="submit" disabled={loading}>创建节点</button>
            </form>
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
              <Field label="协议"><input value={nodeEditForm.protocol} onChange={(event) => setNodeEditForm((current) => ({ ...current, protocol: event.target.value }))} /></Field>
              <Field label="地址"><input value={nodeEditForm.server} onChange={(event) => setNodeEditForm((current) => ({ ...current, server: event.target.value }))} /></Field>
              <Field label="端口"><input type="number" value={nodeEditForm.port} onChange={(event) => setNodeEditForm((current) => ({ ...current, port: Number(event.target.value) }))} /></Field>
              <label className="checkbox-row"><input type="checkbox" checked={nodeEditForm.enabled} onChange={(event) => setNodeEditForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用节点</span></label>
              <button type="submit" disabled={loading || !nodeEditForm.id}>保存节点</button>
            </form>
          </article>

          <article className="panel full-width">
            <h2>节点列表</h2>
            <ResourceTable
              columns={['名称', '协议', '地址', '端口', '状态', '操作']}
              rows={resources.nodes.map((node) => [
                node.name,
                node.protocol,
                node.server,
                node.port,
                node.enabled ? 'enabled' : 'disabled',
                <button type="button" key={node.id} onClick={() => setNodeEditForm((current) => ({ ...current, id: node.id }))}>编辑</button>
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
              columns={['名称', '格式', 'URL', '状态', '操作']}
              rows={resources.ruleSources.map((ruleSource) => [
                ruleSource.name,
                ruleSource.format,
                ruleSource.sourceUrl,
                ruleSource.lastSyncStatus ?? 'never',
                <div className="inline-actions" key={ruleSource.id}>
                  <button type="button" onClick={() => setRuleSourceEditForm((current) => ({ ...current, id: ruleSource.id }))}>编辑</button>
                  <button type="button" className="secondary" onClick={() => void handleSyncRuleSource(ruleSource.id)}>触发同步</button>
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
                <span>状态：{syncResult.status}</span>
                <span>变更：{syncResult.changed ? 'yes' : 'no'}</span>
                <span>规则数：{syncResult.ruleCount}</span>
                <span>{syncResult.message}</span>
                {syncResult.details ? renderJsonBlock(syncResult.details) : null}
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
                log.status,
                log.message ?? '-',
                log.details ? renderJsonBlock(log.details) : '-'
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
              columns={['时间', '管理员', '动作', '目标', '详情']}
              rows={resources.auditLogs.map((log) => [
                log.createdAt,
                log.actorAdminUsername ? `${log.actorAdminUsername} / ${log.actorAdminId}` : log.actorAdminId,
                log.action,
                `${log.targetType}${log.targetId ? ` / ${log.targetId}` : ''}`,
                log.payload ? renderJsonBlock(log.payload) : '-'
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

function OverviewPanel(props: ResourceState): JSX.Element {
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
        {latestLog ? <p className="helper">最近同步：{latestLog.status} / {latestLog.message ?? '-'}</p> : null}
        {latestAudit ? <p className="helper">最近审计：{latestAudit.action} / {latestAudit.targetType}</p> : null}
      </article>
    </section>
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

function getErrorMessage(caughtError: unknown): string {
  return caughtError instanceof Error ? caughtError.message : '发生未知错误';
}
