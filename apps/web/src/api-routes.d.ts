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
  resetHostedSubscriptionToken: WebApiRoute;
  fetchUserNodeBindings: WebApiRoute;
  replaceUserNodeBindings: WebApiRoute;
  previewNodeImport: WebApiRoute;
  fetchNodes: WebApiRoute;
  createNode: WebApiRoute;
  importNodes: WebApiRoute;
  batchNodes: WebApiRoute;
  updateNode: WebApiRoute;
  deleteNode: WebApiRoute;
  fetchTemplates: WebApiRoute;
  createTemplate: WebApiRoute;
  updateTemplate: WebApiRoute;
  fetchRemoteSubscriptionSources: WebApiRoute;
  createRemoteSubscriptionSource: WebApiRoute;
  updateRemoteSubscriptionSource: WebApiRoute;
  deleteRemoteSubscriptionSource: WebApiRoute;
  syncRemoteSubscriptionSource: WebApiRoute;
  fetchPreview: WebApiRoute;
};

export declare const WEB_API_OPERATION_SIGNATURES: readonly string[];
