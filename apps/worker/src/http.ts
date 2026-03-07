import { createAppError, type AppErrorShape } from '@subforge/shared';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization'
} as const;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders,
      ...(init.headers ?? {})
    },
    status: init.status ?? 200
  });
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return json({ ok: true, data }, init);
}

export function fail(error: AppErrorShape, status = 400): Response {
  return json({ ok: false, error }, { status });
}

export function text(content: string, mimeType: string, init: ResponseInit = {}): Response {
  return new Response(content, {
    headers: {
      'content-type': mimeType,
      ...corsHeaders,
      ...(init.headers ?? {})
    },
    status: init.status ?? 200
  });
}

export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function parseJsonBody(request: Request): Promise<unknown> {
  const textBody = await request.text();

  if (!textBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(textBody);
  } catch {
    throw createAppError('VALIDATION_FAILED', 'request body must be valid JSON');
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export function notFound(pathname: string): Response {
  return fail(createAppError('NOT_FOUND', `No route matches ${pathname}`), 404);
}
