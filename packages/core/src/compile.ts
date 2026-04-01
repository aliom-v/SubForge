import {
  APP_ERROR_CODES,
  buildSubscriptionCacheKey,
  createAppError
} from '@subforge/shared';
import type {
  CompiledSubscription,
  SubscriptionCompileInput,
  SubscriptionCompileResult,
  SubscriptionRenderContext
} from './models';
import { validateNodeChains } from './node-chain';
import { AppError, assertRendererAvailable } from './renderers';
import { parseMihomoTemplateStructure } from './template-structure';

function isExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);

  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= Date.now();
}

function validateCompileInput(input: SubscriptionCompileInput): SubscriptionCompileResult | null {
  if (input.user.status !== 'active') {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.userDisabled, undefined, {
        userId: input.user.id
      })
    };
  }

  if (isExpired(input.user.expiresAt)) {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.userExpired, undefined, {
        userId: input.user.id,
        expiresAt: input.user.expiresAt
      })
    };
  }

  const enabledNodes = input.nodes.filter((node) => node.enabled);

  if (enabledNodes.length === 0) {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.noNodesAvailable, undefined, {
        userId: input.user.id
      })
    };
  }

  if (!input.template.content.trim()) {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.templateNotFound, 'template content is empty', {
        templateId: input.template.id
      })
    };
  }

  if (input.template.target !== input.target) {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.templateTargetMismatch, undefined, {
        requestedTarget: input.target,
        templateTarget: input.template.target
      })
    };
  }

  const chainValidation = validateCompileNodeChains(input);

  if (chainValidation.issues.length > 0) {
    return {
      ok: false,
      error: createAppError(APP_ERROR_CODES.validationFailed, 'node chain validation failed', {
        scope: 'node_chain',
        target: input.target,
        userId: input.user.id,
        issueCount: chainValidation.issues.length,
        issues: chainValidation.issues
      })
    };
  }

  return null;
}

function validateCompileNodeChains(input: SubscriptionCompileInput) {
  let proxyGroups: Array<Record<string, unknown>> = [];
  let proxyProviders: string[] = [];

  if (input.target === 'mihomo') {
    try {
      const parsed = parseMihomoTemplateStructure(input.template.content);
      proxyGroups = parsed.proxyGroups;
      proxyProviders = parsed.proxyProviders;
    } catch {
    }
  }

  return validateNodeChains({
    nodes: input.nodes,
    proxyGroups,
    proxyProviders,
    allowProxyGroups: input.target === 'mihomo',
    allowBuiltinReferences: input.target === 'mihomo'
  });
}

export function compileSubscription(input: SubscriptionCompileInput): SubscriptionCompileResult {
  const validationResult = validateCompileInput(input);

  if (validationResult) {
    return validationResult;
  }

  const renderer = assertRendererAvailable(input);

  if (renderer instanceof AppError) {
    return {
      ok: false,
      error: renderer.payload
    };
  }

  const context: SubscriptionRenderContext = {
    target: input.target,
    generatedAt: new Date().toISOString(),
    user: input.user,
    nodes: input.nodes.filter((node) => node.enabled),
    ruleSets: input.ruleSets,
    template: input.template
  };

  const compiled: CompiledSubscription = {
    target: input.target,
    mimeType: renderer.mimeType,
    content: renderer.render(context),
    cacheKey: buildSubscriptionCacheKey(input.target, input.user.token),
    generatedAt: context.generatedAt,
    metadata: {
      userId: input.user.id,
      nodeCount: context.nodes.length,
      ruleSetCount: context.ruleSets.length,
      templateName: input.template.name
    }
  };

  return {
    ok: true,
    data: compiled
  };
}
