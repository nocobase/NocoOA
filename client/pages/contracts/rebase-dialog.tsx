import { finalRefusal, uncertainError } from './errors.js';
import { useEffect, useRef, useState } from 'react';
import { useParams, useOutletContext, useLocation } from 'react-router';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import {
  keyOf,
  loadCommand,
  saveCommand,
  clearCommand,
  clearActor,
  type Command,
} from './journal.js';
import { ErrorState, Loading, Confirmation } from './shared.js';
import type { ContractDetail, DetailContext, LedgerDetail } from './types.js';
export default function RebaseDialog() {
  const { session } = useAuthentication(),
    location = useLocation();
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [confirm, setConfirm] = useState(false);
  const parent = useOutletContext<DetailContext>(),
    { t } = useTranslation();
  return (
    <RouteDrawer
      className='sm:max-w-2xl'
      beforeClose={() => !busy}
      footer={
        <RebaseFooter
          busy={busy}
          ready={ready}
          requestConfirm={() => setConfirm(true)}
        />
      }
      title={t('contracts.rebaseTitle', {
        name: parent.detail.record.number ?? t('contracts.draftName'),
      })}
    >
      <RebaseForm
        key={`${session?.user.id}:${location.pathname}`}
        onBusy={setBusy}
        onReady={setReady}
        confirm={confirm}
        setConfirm={setConfirm}
      />
    </RouteDrawer>
  );
}
function RebaseFooter({
  busy,
  ready,
  requestConfirm,
}: {
  busy: boolean;
  ready: boolean;
  requestConfirm: () => void;
}) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('contracts.cancel')}
      </Button>
      <Button disabled={busy || !ready} onClick={requestConfirm}>
        {t('contracts.rebase')}
      </Button>
    </>
  );
}
function RebaseForm({
  onBusy,
  onReady,
  confirm,
  setConfirm,
}: {
  onBusy: (v: boolean) => void;
  onReady: (v: boolean) => void;
  confirm: boolean;
  setConfirm: (v: boolean) => void;
}) {
  const { requestId = '' } = useParams(),
    parent = useOutletContext<DetailContext>(),
    location = useLocation(),
    { session } = useAuthentication(),
    actor = session?.user.id ?? '',
    api = useApiClient(),
    { t } = useTranslation(),
    toaster = useToaster(),
    { close } = useRouteOverlay();
  const mutation = useCan({
      resource: { type: 'composite', id: 'oa.contract' },
      action: 'submit',
    }),
    detail = useResource<ContractDetail>(`contractRequests/${requestId}`, {
      viewer: actor,
    }),
    source = useResource<LedgerDetail>(
      detail.data?.record.operation !== 'new' && detail.data?.record.contractId
        ? `contracts/${detail.data.record.contractId}`
        : null,
      { viewer: actor },
    );
  const key = keyOf(actor, location.pathname, 'rebase'),
    [restored] = useState(() => loadCommand(key, actor)),
    commandRef = useRef<Command | null>(restored),
    lockRef = useRef(false),
    [unknown, setUnknown] = useState(!!restored),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [blocked, setBlocked] = useState(false),
    [completed, setCompleted] = useState(false);
  const data = detail.data,
    allowed =
      mutation.can &&
      !mutation.isPending &&
      !mutation.error &&
      !!data &&
      !detail.error &&
      !detail.loading &&
      data.record.applicantId === actor &&
      data.record.operation !== 'new' &&
      data.record.status === 'revision' &&
      data.view.available.some((a) => a.name === 'rebase' && a.allowed) &&
      !!source.data &&
      !source.error &&
      !source.loading &&
      ['active', 'activePendingSeal'].includes(source.data.contract.status) &&
      !blocked &&
      !completed;
  useEffect(
    () => onReady(allowed && !unknown && !busy),
    [allowed, unknown, busy, onReady],
  );
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (
        finalRefusal(detail.error) ||
        finalRefusal(source.error) ||
        finalRefusal(error)
      ) {
        clearActor(actor);
        commandRef.current = null;
        setBlocked(true);
        setUnknown(false);
        parent.reload();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detail.error, source.error, error, actor, parent]);
  async function execute(retry = false) {
    if (
      lockRef.current ||
      blocked ||
      (!retry && !allowed) ||
      finalRefusal(detail.error) ||
      finalRefusal(source.error)
    )
      return;
    lockRef.current = true;
    setBusy(true);
    onBusy(true);
    setConfirm(false);
    try {
      if (!commandRef.current) {
        commandRef.current = {
          actorId: actor,
          path: `contractRequests/${requestId}/rebase`,
          body: {
            version: data!.record.lifecycleVersion,
            requestId: createRequestId(),
          },
        };
        saveCommand(key, commandRef.current);
      }
      await api.request({
        method: 'POST',
        path: commandRef.current.path,
        json: commandRef.current.body,
      });
      setCompleted(true);
      clearCommand(key);
      commandRef.current = null;
      setUnknown(false);
      const { data: latest } = await api.request<{ data: ContractDetail }>({
        path: `contractRequests/${requestId}`,
      });
      parent.apply(latest);
      parent.reload();
      toaster.show({
        title: t('contracts.completed', {
          name: latest.record.number ?? t('contracts.draftName'),
        }),
      });
      await close();
    } catch (cause) {
      setError(cause);
      if (commandRef.current && uncertainError(cause)) setUnknown(true);
      else {
        clearCommand(key);
        commandRef.current = null;
        setUnknown(false);
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className='flex flex-col gap-4'>
      {detail.error ? (
        <ErrorState error={detail.error} retry={detail.reload} />
      ) : null}
      {source.error ? (
        <ErrorState error={source.error} retry={source.reload} />
      ) : null}
      {error ? (
        <ErrorState
          error={error}
          retry={() => {
            detail.reload();
            source.reload();
          }}
        />
      ) : null}
      {!data || !source.data ? (
        !detail.error && !source.error && <Loading fields={3} />
      ) : (
        <>
          <p>
            {t('contracts.baseVersion')}: {data.record.baseVersion} →{' '}
            {source.data.contract.version}
          </p>
          <p>{t('contracts.rebaseDescription')}</p>
        </>
      )}
      {unknown ? (
        <Alert>
          <AlertDescription>{t('contracts.unknown')}</AlertDescription>
          <Button
            variant='outline'
            disabled={busy || blocked}
            onClick={() => void execute(true)}
          >
            {t('contracts.retryExact')}
          </Button>
        </Alert>
      ) : null}
      <Confirmation
        open={confirm}
        title={t('contracts.rebaseTitle', {
          name: data?.record.number ?? t('contracts.draftName'),
        })}
        description={t('contracts.rebaseDescription')}
        confirm={t('contracts.rebase')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void execute()}
        busy={busy}
      />
    </div>
  );
}
