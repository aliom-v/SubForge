export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SUB_CACHE: KVNamespace;
  ADMIN_JWT_SECRET: string;
  SUBSCRIPTION_CACHE_TTL: string;
  PREVIEW_CACHE_TTL: string;
  SYNC_HTTP_TIMEOUT_MS: string;
  APP_ENV: string;
}
