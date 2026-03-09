export interface WebApiRoute {
  method: string;
  pattern: string;
  buildPath: (...parts: string[]) => string;
}

export declare const WEB_API_ROUTES: {
  fetchSetupStatus: WebApiRoute;
  bootstrapSetup: WebApiRoute;
  login: WebApiRoute;
  logout: WebApiRoute;
  fetchMe: WebApiRoute;
  fetchUsers: WebApiRoute;
  createUser: WebApiRoute;
  updateUser: WebApiRoute;
  resetUserToken: WebApiRoute;
  fetchUserNodeBindings: WebApiRoute;
  replaceUserNodeBindings: WebApiRoute;
  fetchNodes: WebApiRoute;
  createNode: WebApiRoute;
  importNodes: WebApiRoute;
  importRemoteNodes: WebApiRoute;
  updateNode: WebApiRoute;
  fetchTemplates: WebApiRoute;
  createTemplate: WebApiRoute;
  updateTemplate: WebApiRoute;
  setDefaultTemplate: WebApiRoute;
  fetchRuleSources: WebApiRoute;
  createRuleSource: WebApiRoute;
  updateRuleSource: WebApiRoute;
  syncRuleSource: WebApiRoute;
  fetchSyncLogs: WebApiRoute;
  fetchAuditLogs: WebApiRoute;
  rebuildSubscriptionCaches: WebApiRoute;
  fetchPreview: WebApiRoute;
};

export declare const WEB_API_OPERATION_SIGNATURES: readonly string[];
