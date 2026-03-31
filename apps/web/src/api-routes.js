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
  resetHostedSubscriptionToken: createRoute('POST', '/api/hosted-subscription/reset-token'),
  fetchUserNodeBindings: createRoute('GET', '/api/users/{userId}/nodes', (userId) => `/api/users/${userId}/nodes`),
  replaceUserNodeBindings: createRoute('POST', '/api/users/{userId}/nodes', (userId) => `/api/users/${userId}/nodes`),
  previewNodeImport: createRoute('POST', '/api/node-import/preview'),
  fetchNodes: createRoute('GET', '/api/nodes'),
  createNode: createRoute('POST', '/api/nodes'),
  importNodes: createRoute('POST', '/api/nodes/import'),
  updateNode: createRoute('PATCH', '/api/nodes/{nodeId}', (nodeId) => `/api/nodes/${nodeId}`),
  deleteNode: createRoute('DELETE', '/api/nodes/{nodeId}', (nodeId) => `/api/nodes/${nodeId}`),
  fetchTemplates: createRoute('GET', '/api/templates'),
  createTemplate: createRoute('POST', '/api/templates'),
  updateTemplate: createRoute('PATCH', '/api/templates/{templateId}', (templateId) => `/api/templates/${templateId}`),
  fetchRemoteSubscriptionSources: createRoute('GET', '/api/remote-subscription-sources'),
  createRemoteSubscriptionSource: createRoute('POST', '/api/remote-subscription-sources'),
  updateRemoteSubscriptionSource: createRoute(
    'PATCH',
    '/api/remote-subscription-sources/{sourceId}',
    (sourceId) => `/api/remote-subscription-sources/${sourceId}`
  ),
  deleteRemoteSubscriptionSource: createRoute(
    'DELETE',
    '/api/remote-subscription-sources/{sourceId}',
    (sourceId) => `/api/remote-subscription-sources/${sourceId}`
  ),
  syncRemoteSubscriptionSource: createRoute(
    'POST',
    '/api/remote-subscription-sources/{sourceId}/sync',
    (sourceId) => `/api/remote-subscription-sources/${sourceId}/sync`
  ),
  fetchPreview: createRoute(
    'GET',
    '/api/preview/{userId}/{target}',
    (userId, target) => `/api/preview/${userId}/${target}`
  )
});

export const WEB_API_OPERATION_SIGNATURES = Object.freeze(
  Object.values(WEB_API_ROUTES).map((route) => `${route.method} ${route.pattern}`)
);
