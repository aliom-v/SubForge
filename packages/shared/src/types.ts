export interface ServiceMetadata {
  name: string;
  version: string;
  description: string;
}

export interface BootstrapChecklistItem {
  id: string;
  title: string;
  description: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure<E> {
  ok: false;
  error: E;
}

export type ApiResult<T, E> = ApiSuccess<T> | ApiFailure<E>;
