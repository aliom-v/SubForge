import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_VERSION,
  buildSubscriptionCacheKey,
  SUBSCRIPTION_TARGETS,
  type BootstrapChecklistItem,
  type ServiceMetadata,
  type SubscriptionTarget
} from '@subforge/shared';
import { compileSubscription } from './compile';
import type { SubscriptionCompileInput } from './models';

const bootstrapChecklist: BootstrapChecklistItem[] = [
  {
    id: 'workspace',
    title: 'Workspace 已初始化',
    description: '根 package.json、TypeScript 基础配置和 npm workspaces 已就位。'
  },
  {
    id: 'worker',
    title: 'Worker 已接线',
    description: 'Cloudflare Worker 已具备健康检查入口和定时任务占位。'
  },
  {
    id: 'web',
    title: 'Web 已起步',
    description: 'React + Vite 管理后台已具备首次安装向导、登录与基础资源管理页面。'
  },
  {
    id: 'domain',
    title: 'P1 领域模型已补齐',
    description: '共享类型、错误码、cache key、订阅中间模型与 renderer 接口已落地。'
  },
  {
    id: 'schema',
    title: '首版数据模型已落地',
    description: 'D1 migration 已覆盖 admins、users、nodes、templates 等核心表，可直接配合安装向导初始化。'
  }
];

function createBootstrapInput(target: SubscriptionTarget): SubscriptionCompileInput {
  return {
    target,
    user: {
      id: 'usr_demo',
      name: 'Demo User',
      token: 'demo-token',
      status: 'active'
    },
    nodes: [
      {
        id: 'node_hk_01',
        name: 'HK Edge 01',
        protocol: 'vless',
        server: 'hk-01.example.com',
        port: 443,
        enabled: true,
        credentials: {
          uuid: '11111111-1111-1111-1111-111111111111'
        },
        params: {
          tls: true,
          network: 'ws'
        }
      },
      {
        id: 'node_jp_01',
        name: 'JP Edge 01',
        protocol: 'trojan',
        server: 'jp-01.example.com',
        port: 443,
        enabled: true,
        credentials: {
          password: 'replace-me'
        },
        params: {
          sni: 'subforge.example.com'
        }
      }
    ],
    ruleSets: [
      {
        id: 'rules_default',
        name: 'Default Rules',
        format: 'text',
        content: 'MATCH,DIRECT',
        sourceId: 'rs_default'
      }
    ],
    template: {
      id: `tpl_${target}`,
      name: `${target} default template`,
      target,
      version: 1,
      isDefault: true,
      content:
        target === 'mihomo'
          ? ['mixed-port: 7890', 'mode: rule', 'proxies:', '{{proxies}}', 'proxy-groups:', '{{proxy_groups}}', 'rules:', '{{rules}}'].join('\n')
          : ['{', '  "outbounds": {{outbounds}},', '  "route": {', '    "rules": {{rules}}', '  }', '}'].join('\n')
    }
  };
}

export function getServiceMetadata(): ServiceMetadata {
  return {
    name: APP_NAME,
    version: APP_VERSION,
    description: APP_DESCRIPTION
  };
}

export function getBootstrapChecklist(): BootstrapChecklistItem[] {
  return bootstrapChecklist.map((item) => ({ ...item }));
}

export function getBootstrapSubscriptionExamples(): Record<SubscriptionTarget, string> {
  return Object.fromEntries(
    SUBSCRIPTION_TARGETS.map((target) => {
      const result = compileSubscription(createBootstrapInput(target));
      const content = result.ok ? result.data.content : result.error.message;
      return [target, content];
    })
  ) as Record<SubscriptionTarget, string>;
}

export function getBootstrapCacheKeyExamples(token: string): Record<SubscriptionTarget, string> {
  return Object.fromEntries(
    SUBSCRIPTION_TARGETS.map((target) => [target, buildSubscriptionCacheKey(target, token)])
  ) as Record<SubscriptionTarget, string>;
}
