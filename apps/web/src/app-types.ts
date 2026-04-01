import type {
  NodeRecord,
  RemoteSubscriptionSourceRecord,
  TemplateRecord,
  UserRecord
} from '@subforge/shared';

export interface ResourceState {
  users: UserRecord[];
  nodes: NodeRecord[];
  templates: TemplateRecord[];
  remoteSubscriptionSources: RemoteSubscriptionSourceRecord[];
}

export interface RemoteSubscriptionSourceForm {
  name: string;
  sourceUrl: string;
}

export interface NodeEditorState {
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

export type ImportMode = 'text' | 'remote' | 'config';
