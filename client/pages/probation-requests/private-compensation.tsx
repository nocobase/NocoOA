import { useEffect, useRef, useState, useReducer } from 'react';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { ErrorState } from './states.js';
import type { GradeOption } from './types.js';

/** Salary stays exclusively in this private resource, never copied onto public detail/SDK objects. */
export interface PrivateCompensation {
  gradeId: string;
  baseSalary: string;
}
// This hook is shared only with the private HR action form; keep salary types out of public DTO modules.
// eslint-disable-next-line react-refresh/only-export-components
export function usePrivateCompensation(recordId: string, enabled = true) {
  const { session } = useAuthentication();
  const viewer = session?.user.id ?? '';
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.probation' },
    action: 'compensation',
  });
  const allowed =
    enabled &&
    permission.can &&
    !permission.isPending &&
    !permission.error &&
    !!viewer &&
    !!recordId;
  const identity = JSON.stringify([viewer, recordId, allowed]);
  const [access, setAccess] = useState({ identity, generation: 0 });
  if (access.identity !== identity)
    setAccess({ identity, generation: access.generation + 1 });
  const api = useApiClient();
  const [generation, reload] = useReducer((value: number) => value + 1, 0);
  const source = JSON.stringify([viewer, recordId, allowed, access.generation]);
  const key = JSON.stringify([source, generation]);
  const [result, setResult] = useState<{
    source: string;
    key: string;
    data?: PrivateCompensation | null;
    error?: unknown;
  }>();
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    api
      .request<{ data: PrivateCompensation | null }>({
        path: `probationRequests/${encodeURIComponent(recordId)}/compensation`,
        signal: controller.signal,
      })
      .then(
        ({ data }) => {
          if (!controller.signal.aborted) setResult({ source, key, data });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          const denied =
            error instanceof ApiClientError &&
            [401, 403, 404].includes(error.status);
          setResult((old) => ({
            source,
            key,
            error,
            data: !denied && old?.source === source ? old.data : undefined,
          }));
        },
      );
    return () => controller.abort();
  }, [api, allowed, recordId, source, key]);
  return {
    data: allowed && result?.source === source ? result.data : undefined,
    error: allowed && result?.key === key ? result.error : undefined,
    loading: allowed && result?.key !== key,
    reload,
    viewer,
    allowed,
    permissionPending: permission.isPending,
  };
}
export function PrivateCompensationSection({
  recordId,
  refreshKey = 0,
  grades,
}: {
  recordId: string;
  refreshKey?: number;
  grades?: GradeOption[];
}) {
  const { t, i18n } = useTranslation();
  const resource = usePrivateCompensation(recordId);
  const reload = resource.reload;
  const lastRefreshRef = useRef(refreshKey);
  useEffect(() => {
    if (lastRefreshRef.current !== refreshKey) {
      lastRefreshRef.current = refreshKey;
      reload();
    }
  }, [refreshKey, reload]);
  if (!resource.allowed) return null;
  const f = (key: string) => t(`probationRequests.compensation.${key}`);
  const data = resource.data;
  return (
    <section className='flex flex-col gap-4'>
      <h2 className='text-base font-medium'>{f('title')}</h2>
      {resource.error ? (
        resource.error instanceof ApiClientError &&
        resource.error.status === 403 ? (
          <p className='text-sm text-muted-foreground'>{f('denied')}</p>
        ) : (
          <ErrorState error={resource.error} retry={reload} />
        )
      ) : !data && resource.loading ? (
        <FieldsSkeleton fields={2} />
      ) : data ? (
        <>
          {resource.loading ? (
            <p role='status' className='text-sm text-muted-foreground'>
              {t('status.loading')}
            </p>
          ) : null}
          <dl className='grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]'>
            <dt className='text-muted-foreground'>{f('grade')}</dt>
            <dd className='min-w-0 break-words'>
              {grades?.find((g) => g.id === data.gradeId)?.title ??
                data.gradeId}
            </dd>
            <dt className='text-muted-foreground'>{f('salary')}</dt>
            <dd className='min-w-0 break-words tabular-nums'>
              {salaryLabel(data.baseSalary, i18n.language)}
            </dd>
          </dl>
        </>
      ) : (
        <p className='text-sm text-muted-foreground'>{f('missing')}</p>
      )}
    </section>
  );
}
/** Parse decimal text with integers so even the 14-digit business limit retains every cent. */
// Exact formatting is shared by tests and the private action confirmation; it never exposes a public salary DTO.
// eslint-disable-next-line react-refresh/only-export-components
export function salaryLabel(value: string, locale: string): string {
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return '—';
  const whole = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(BigInt(match[1]));
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === 'decimal')?.value ?? '.';
  return `${whole}${decimal}${(match[2] ?? '').padEnd(2, '0')}`;
}
