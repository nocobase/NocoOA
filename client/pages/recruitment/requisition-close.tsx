import { createRequestKey } from '#lib/request-key';
import { useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router';
import { useApiClient, ApiClientError, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel } from '#components/ui/field';
import {
  useRecruitmentResource,
  useViewerKey,
  useMutationBoundary,
} from './resource.js';
import { Confirmation, Discard, ErrorState, Loading } from './shared.js';
import { useCloseGuard } from './use-close-guard.js';
import type { Requisition, Source } from './types.js';
export default function RequisitionClose() {
  const key = useViewerKey();
  return <RequisitionCloseContent key={key} />;
}
function RequisitionCloseContent() {
  const { requisitionId = '' } = useParams(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    guard = useCloseGuard(busy),
    r = useRecruitmentResource<{ data: Requisition }>(
      `requisitions/${encodeURIComponent(requisitionId)}`,
    );
  return (
    <RouteDrawer
      title={t('recruitment.actions.close')}
      className='sm:max-w-2xl'
      beforeClose={guard.beforeClose}
      footer={
        <Footer
          busy={busy}
          ready={
            !!r.data &&
            !r.loading &&
            !r.error &&
            r.data.data.status === 'recruiting' &&
            !blocked
          }
        />
      }
    >
      {r.error ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : r.loading ? (
        <Loading />
      ) : r.data ? (
        <Body
          record={r.data.data}
          onBusy={setBusy}
          onBlocked={setBlocked}
          guard={guard}
        />
      ) : null}
      <Discard guard={guard} />
    </RouteDrawer>
  );
}
function Footer({ busy, ready }: { busy: boolean; ready: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('recruitment.cancel')}
      </Button>
      <Button
        type='submit'
        form='requisition-close'
        variant='destructive'
        disabled={busy || !ready}
      >
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('recruitment.actions.close')}
      </Button>
    </>
  );
}
function Body({
  record,
  onBusy,
  onBlocked,
  guard,
}: {
  record: Requisition;
  onBusy: (v: boolean) => void;
  onBlocked: (v: boolean) => void;
  guard: ReturnType<typeof useCloseGuard>;
}) {
  const boundary = useMutationBoundary();
  const { t } = useTranslation(),
    { close } = useRouteOverlay(),
    api = useApiClient(),
    parent = useOutletContext<Source>(),
    toaster = useToaster(),
    [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState<unknown>(),
    [body, setBody] = useState<{
      version: number;
      requestKey: string;
      reason: string;
    }>(),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    lockRef = useRef(false);
  async function execute() {
    const signal = boundary.getSignal();
    if (lockRef.current || blocked || !body) return;
    lockRef.current = true;
    setBusy(true);
    onBusy(true);
    try {
      await api.request({
        method: 'POST',
        path: `requisitions/${record.id}/close`,
        json: body,
        signal,
      });
      if (signal.aborted) return;
      guard.saved();
      parent.reload();
      onBusy(false);
      toaster.show({ type: 'success', title: t('recruitment.saved') });
      await close();
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause);
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404, 409, 412].includes(cause.status)
      ) {
        setBlocked(true);
        onBlocked(true);
      }
    } finally {
      if (!signal.aborted) {
        lockRef.current = false;
        setBusy(false);
        onBusy(false);
        setConfirm(false);
      }
    }
  }
  return (
    <>
      {error ? <ErrorState error={error} /> : null}
      <form
        id='requisition-close'
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !blocked && !body && reason.trim()) {
            setBody({
              version: record.version,
              requestKey: createRequestKey(),
              reason: reason.trim(),
            });
            setConfirm(true);
          }
        }}
      >
        <Field>
          <FieldLabel htmlFor='requisition-close-reason'>
            {t('recruitment.commandReason')} *
          </FieldLabel>
          <Textarea
            id='requisition-close-reason'
            required
            maxLength={10000}
            value={reason}
            disabled={busy || !!body}
            onChange={(e) => {
              guard.changed();
              setReason(e.target.value);
            }}
          />
        </Field>
        {error && body && !blocked ? (
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void execute()}
          >
            {t('recruitment.retryExact')}
          </Button>
        ) : null}
      </form>
      <Confirmation
        open={confirm}
        title={t('recruitment.confirmAction', {
          action: t('recruitment.actions.close'),
          id: record.id,
        })}
        description={t('recruitment.closeConsequence')}
        confirm={t('recruitment.actions.close')}
        destructive
        busy={busy}
        onCancel={() => {
          setConfirm(false);
          setBody(undefined);
        }}
        onConfirm={() => void execute()}
      />
    </>
  );
}
