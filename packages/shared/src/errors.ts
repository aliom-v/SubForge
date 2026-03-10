export const APP_ERROR_CODES = {
  notFound: 'NOT_FOUND',
  unauthorized: 'UNAUTHORIZED',
  forbidden: 'FORBIDDEN',
  tooManyRequests: 'TOO_MANY_REQUESTS',
  internalError: 'INTERNAL_ERROR',
  validationFailed: 'VALIDATION_FAILED',
  subscriptionUserNotFound: 'SUBSCRIPTION_USER_NOT_FOUND',
  userDisabled: 'USER_DISABLED',
  userExpired: 'USER_EXPIRED',
  noNodesAvailable: 'NO_NODES_AVAILABLE',
  templateNotFound: 'TEMPLATE_NOT_FOUND',
  unsupportedTarget: 'UNSUPPORTED_TARGET',
  rendererNotFound: 'RENDERER_NOT_FOUND',
  templateTargetMismatch: 'TEMPLATE_TARGET_MISMATCH'
} as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

export interface AppErrorShape {
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

const defaultErrorMessages: Record<AppErrorCode, string> = {
  NOT_FOUND: 'resource not found',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  TOO_MANY_REQUESTS: 'too many requests',
  INTERNAL_ERROR: 'internal server error',
  VALIDATION_FAILED: 'validation failed',
  SUBSCRIPTION_USER_NOT_FOUND: 'subscription user not found',
  USER_DISABLED: 'user is disabled',
  USER_EXPIRED: 'user has expired',
  NO_NODES_AVAILABLE: 'no nodes available',
  TEMPLATE_NOT_FOUND: 'template not found',
  UNSUPPORTED_TARGET: 'unsupported subscription target',
  RENDERER_NOT_FOUND: 'renderer not found',
  TEMPLATE_TARGET_MISMATCH: 'template target does not match requested target'
};

export function createAppError(
  code: AppErrorCode,
  message?: string,
  details?: Record<string, unknown>
): AppErrorShape {
  return {
    code,
    message: message ?? defaultErrorMessages[code],
    ...(details ? { details } : {})
  };
}
