import { isAppApiError } from './api';

export function getErrorMessage(caughtError: unknown): string {
  if (isAppApiError(caughtError)) {
    if (caughtError.code === 'NETWORK_ERROR') {
      return '网络请求失败，请稍后重试';
    }

    if (caughtError.code === 'INVALID_RESPONSE') {
      return '服务返回了不可识别的响应';
    }

    return caughtError.message;
  }

  return caughtError instanceof Error ? caughtError.message : '发生未知错误';
}

export function shouldClearProtectedSession(caughtError: unknown): boolean {
  return isAppApiError(caughtError) && (caughtError.code === 'UNAUTHORIZED' || caughtError.code === 'FORBIDDEN');
}
