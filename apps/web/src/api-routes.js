function createRoute(method, pattern, buildPath = () => pattern) {
  return Object.freeze({
    method,
    pattern,
    buildPath
  });
}

export const WEB_API_ROUTES = Object.freeze({
  fetchSetupStatus: createRoute('GET', '/api/setup/status'),
  bootstrapSetup: createRoute('POST', '/api/setup/bootstrap'),
  login: createRoute('POST', '/api/admin/login'),
  logout: createRoute('POST', '/api/admin/logout'),
  fetchMe: createRoute('GET', '/api/admin/me'),
  fetchUsers: createRoute('GET', '/api/users'),
  createUser: createRoute('POST', '/api/users'),
  updateUser: createRoute('PATCH', '/api/users/{userId}', (userId) => `/api/users/${userId}`),
  deleteUser: createRoute('DELETE', '/api/users/{userId}', (userId) => `/api/users/${userId}`),
  resetUserToken: createRoute('POST', '/api/users/{userId}/reset-token', (userId) => `/api/users/${userId}/reset-token`),
  fetchUserNodeBindings: createRoute('GET', '/api/users/{userId}/nodes', (userId) => `/api/users/${userId}/nodes`),
  replaceUserNodeBindings: createRoute('POST', '/api/users/{userId}/nodes', (userId) => `/api/users/${userId}/nodes`),
  previewNodeImport: createRoute('POST', '/api/node-import/preview'),
  fetchNodes: createRoute('GET', '/api/nodes'),
  createNode: createRoute('POST', '/api/nodes'),
  importNodes: createRoute('POST', '/api/nodes/import'),
  importRemoteNodes: createRoute('POST', '/api/nodes/import/remote'),
  updateNode: createRoute('PATCH', '/api/nodes/{nodeId}', (nodeId) => `/api/nodes/${nodeId}`),
  deleteNode: createRoute('DELETE', '/api/nodes/{nodeId}', (nodeId) => `/api/nodes/${nodeId}`),
  fetchTemplates: createRoute('GET', '/api/templates'),
  createTemplate: createRoute('POST', '/api/templates'),
  updateTemplate: createRoute('PATCH', '/api/templates/{templateId}', (templateId) => `/api/templates/${templateId}`),
  deleteTemplate: createRoute('DELETE', '/api/templates/{templateId}', (templateId) => `/api/templates/${templateId}`),
  setDefaultTemplate: createRoute(
    'POST',
    '/api/templates/{templateId}/set-default',
    (templateId) => `/api/templates/${templateId}/set-default`
  ),
  fetchRuleSources: createRoute('GET', '/api/rule-sources'),
  createRuleSource: createRoute('POST', '/api/rule-sources'),
  updateRuleSource: createRoute(
    'PATCH',
    '/api/rule-sources/{ruleSourceId}',
    (ruleSourceId) => `/api/rule-sources/${ruleSourceId}`
  ),
  deleteRuleSource: createRoute(
    'DELETE',
    '/api/rule-sources/{ruleSourceId}',
    (ruleSourceId) => `/api/rule-sources/${ruleSourceId}`
  ),
  syncRuleSource: createRoute(
    'POST',
    '/api/rule-sources/{ruleSourceId}/sync',
    (ruleSourceId) => `/api/rule-sources/${ruleSourceId}/sync`
  ),
  fetchSyncLogs: createRoute('GET', '/api/sync-logs'),
  fetchAuditLogs: createRoute('GET', '/api/audit-logs'),
  rebuildSubscriptionCaches: createRoute('POST', '/api/cache/rebuild'),
  fetchPreview: createRoute(
    'GET',
    '/api/preview/{userId}/{target}',
    (userId, target) => `/api/preview/${userId}/${target}`
  )
});

export const WEB_API_OPERATION_SIGNATURES = Object.freeze(
  Object.values(WEB_API_ROUTES).map((route) => `${route.method} ${route.pattern}`)
);
