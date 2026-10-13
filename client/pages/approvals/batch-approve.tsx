import { useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '#components/ui/alert-dialog';
import { createRequestKey } from '#lib/request-key';
import { ErrorState } from './states.js';
import type { CenterRecord } from './use-center-resource.js';
interface Candidate {
  kind: CenterRecord['kind'];
  id: string;
  taskId: string;
  contentHash: string;
}
interface Result {
  kind: CenterRecord['kind'];
  id: string;
  status: 'approved' | 'unavailable' | 'failed';
}
const recordKey = (v: { kind: string; id: string }) => `${v.kind}:${v.id}`;
export function useBatchApprove(
  rows: CenterRecord[] | undefined,
  enabled: boolean,
  scope: string,
  reload: () => void,
) {
  const { t } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  const identity = JSON.stringify([scope, session?.user.id, revision]);
  const [identityEpoch, setIdentityEpoch] = useState({ identity, epoch: 0 });
  const epoch =
    identityEpoch.identity === identity
      ? identityEpoch.epoch
      : identityEpoch.epoch + 1;
  if (identityEpoch.identity !== identity)
    setIdentityEpoch({ identity, epoch });
  const identityScope = JSON.stringify([identity, epoch]);
  const currentIdentityRef = useRef(identityScope);
  useEffect(() => {
    currentIdentityRef.current = identityScope;
  }, [identityScope]);
  const rawSource = JSON.stringify([identityScope, enabled, rows]);
  const [sourceEpoch, setSourceEpoch] = useState({
    source: rawSource,
    epoch: 0,
  });
  const optionsEpoch =
    sourceEpoch.source === rawSource
      ? sourceEpoch.epoch
      : sourceEpoch.epoch + 1;
  if (sourceEpoch.source !== rawSource)
    setSourceEpoch({ source: rawSource, epoch: optionsEpoch });
  // Returning to the same page after a refresh still needs fresh owner offers.
  const source = JSON.stringify([rawSource, optionsEpoch]);
  const [settledSource, setSettledSource] = useState<string>();
  const [options, setOptions] = useState<{
    source: string;
    data: Candidate[];
  }>();
  const [selection, setSelection] = useState<{
    source: string;
    keys: string[];
  }>();
  const [confirmation, setConfirmation] = useState<{
    source: string;
    items: Candidate[];
  }>();
  const [runningSource, setRunningSource] = useState<string>();
  const busy = runningSource === identityScope;
  const [error, setError] = useState<{ source: string; value: unknown }>();
  const [results, setResults] = useState<{ source: string; data: Result[] }>();
  useEffect(() => {
    if (!enabled || !rows?.length) return;
    const controller = new AbortController();
    api
      .request<{ data: Candidate[] }>({
        path: 'approvalCenter/batchApproveOptions',
        method: 'POST',
        json: { items: rows.map(({ kind, id }) => ({ kind, id })) },
        signal: controller.signal,
      })
      .then(
        (value) => {
          if (!controller.signal.aborted)
            setOptions({
              source,
              data: (Array.isArray(value.data) ? value.data : []).filter(
                (item) =>
                  typeof item.taskId === 'string' &&
                  typeof item.contentHash === 'string',
              ),
            });
        },
        () => {
          if (!controller.signal.aborted) setOptions({ source, data: [] });
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setSettledSource(source);
      });
    return () => controller.abort();
  }, [api, enabled, rows, source]);
  const candidates = options?.source === source ? options.data : [];
  const keys = selection?.source === source ? selection.keys : [];
  const selected = candidates.filter((v) => keys.includes(recordKey(v)));
  const blocked = !enabled || busy || options?.source !== source;
  const column: ColumnDef<CenterRecord> = {
    id: 'batchSelection',
    enableSorting: false,
    enableHiding: false,
    header: () => t('approvalCenter.batch.select'),
    cell: ({ row }) => {
      const key = recordKey(row.original);
      return candidates.some((v) => recordKey(v) === key) ? (
        <Checkbox
          aria-label={t('approvalCenter.batch.selectRecord', {
            name: row.original.title ?? row.original.number ?? row.original.id,
          })}
          checked={keys.includes(key)}
          disabled={blocked || (!keys.includes(key) && keys.length >= 20)}
          onCheckedChange={(checked) => {
            setResults(undefined);
            setError(undefined);
            setSelection({
              source,
              keys: checked ? [...keys, key] : keys.filter((v) => v !== key),
            });
          }}
        />
      ) : null;
    },
  };
  const confirmed = confirmation?.source === source ? confirmation.items : [];
  async function perform() {
    if (blocked || !confirmed.length) return;
    setRunningSource(identityScope);
    setError(undefined);
    try {
      const value = await api.request<{ data: Result[] }>({
        path: 'approvalCenter/batchApprove',
        method: 'POST',
        json: {
          items: confirmed.map((item) => ({
            ...item,
            requestId: createRequestKey(),
          })),
        },
      });
      if (currentIdentityRef.current === identityScope)
        setResults({ source: identityScope, data: value.data });
    } catch (failure) {
      if (currentIdentityRef.current === identityScope)
        setError({ source: identityScope, value: failure });
    } finally {
      setRunningSource((old) => (old === identityScope ? undefined : old));
      if (currentIdentityRef.current === identityScope) {
        setConfirmation((old) => (old?.source === source ? undefined : old));
        setSelection((old) => (old?.source === source ? undefined : old));
        setOptions((old) => (old?.source === source ? undefined : old));
        reload();
      }
    }
  }
  const controls = (
    <>
      {enabled && !!rows?.length && settledSource !== source ? (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('approvalCenter.batch.loading')}
        </p>
      ) : null}
      {enabled && selected.length > 0 ? (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            disabled={blocked || !selected.length}
            onClick={() => setConfirmation({ source, items: selected })}
          >
            {t('approvalCenter.batch.approve', { count: selected.length })}
          </Button>
          <span className='text-sm text-muted-foreground'>
            {t('approvalCenter.batch.limit')}
          </span>
        </div>
      ) : null}
      {error?.source === identityScope ? (
        <>
          <p role='alert'>{t('approvalCenter.batch.unknown')}</p>
          <ErrorState error={error.value} retry={reload} />
        </>
      ) : null}
      {results?.source === identityScope ? (
        <div role='status' className='text-sm'>
          {results.data.map((v) => (
            <p key={recordKey(v)}>
              {rows?.find((r) => recordKey(r) === recordKey(v))?.number ?? v.id}
              : {t(`approvalCenter.batch.${v.status}`)}
            </p>
          ))}
        </div>
      ) : null}
      <AlertDialog
        open={!!confirmed.length}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent className='max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden'>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('approvalCenter.batch.confirmTitle', {
                count: confirmed.length,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('approvalCenter.batch.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className='min-h-0 max-h-60 overflow-y-auto text-sm'>
            {confirmed.map((v) => (
              <li key={recordKey(v)}>
                {rows?.find((r) => recordKey(r) === recordKey(v))?.title ??
                  rows?.find((r) => recordKey(r) === recordKey(v))?.number ??
                  v.id}
              </li>
            ))}
          </ul>
          <div className='flex justify-end gap-2'>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              {t('approvalCenter.batch.cancel')}
            </Button>
            <Button disabled={blocked} onClick={() => void perform()}>
              {t(
                busy
                  ? 'approvalCenter.batch.running'
                  : 'approvalCenter.batch.confirm',
              )}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return { column, controls, hasCandidates: candidates.length > 0 };
}
