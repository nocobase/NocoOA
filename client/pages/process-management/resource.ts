import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { createContext, useEffect, useReducer, useState } from 'react';
export function useProcessIdentity() {
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  return JSON.stringify([session?.user.id, revision]);
}
export function useProcessResource<T>(
  path: string | null,
  query?: Record<string, string>,
) {
  const api = useApiClient(),
    identity = useProcessIdentity();
  const [generation, reload] = useReducer((v: number) => v + 1, 0);
  const queryKey = JSON.stringify(query ?? {}),
    source = JSON.stringify([identity, path, queryKey]),
    key = JSON.stringify([source, generation]);
  const [result, setResult] = useState<{
    source: string;
    key: string;
    data?: T;
    error?: unknown;
  }>();
  useEffect(() => {
    if (path === null) return;
    const abort = new AbortController();
    api
      .request<T>({
        path,
        query: JSON.parse(queryKey) as Record<string, string>,
        signal: abort.signal,
      })
      .then(
        (data) => {
          if (!abort.signal.aborted) setResult({ source, key, data });
        },
        (error: unknown) => {
          if (abort.signal.aborted) return;
          const final =
            error instanceof ApiClientError &&
            [401, 403, 404].includes(error.status);
          setResult((old) => ({
            source,
            key,
            error,
            data: !final && old?.source === source ? old.data : undefined,
          }));
        },
      );
    return () => abort.abort();
  }, [api, path, queryKey, source, key]);
  const current =
    path !== null && result?.source === source ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && current?.key !== key,
    reload,
    update(data: T) {
      setResult({ source, key, data });
    },
    identity,
  };
}
export const ProcessListContext = createContext<() => void>(() => {});
