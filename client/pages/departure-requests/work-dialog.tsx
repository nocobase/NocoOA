import { UserName } from '#components/user-name';
import { Missing } from './missing.js';
import { useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { Spinner } from '#components/ui/spinner';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { createRequestId } from '../approvals/request-id.js';
import { useDepartureResource } from './use-resource.js';
import { ErrorState } from './states.js';
import { Blocker } from './facts.js';
import type { DepartureDetail, DetailContext, WorkItem } from './types.js';
export default function WorkDialog() {
  const parent = useOutletContext<DetailContext>();
  const { requestId = '', targetId = '', actionName = '' } = useParams();
  const { t } = useTranslation();
  const resource = useDepartureResource<DepartureDetail>(
    requestId ? `departureRequests/${encodeURIComponent(requestId)}` : null,
  );
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [discard, setDiscard] = useState(false);
  const busyRef = useRef(false),
    dirtyRef = useRef(false),
    closeResolveRef = useRef<(value: boolean) => void>(undefined);
  const item = resource.data?.workItems.find((i) => i.id === targetId);
  const allowed =
    !!item?.offers.find((o) => o.name === actionName && o.allowed) &&
    !resource.loading &&
    !resource.error;
  const label = t(`departureRequests.work.labels.${actionName}`);
  return (
    <RouteDrawer
      title={t('departureRequests.work.title', {
        action: label,
        kind: item
          ? t(`departureRequests.workKinds.${item.kind}`)
          : t('departureRequests.handover'),
        name:
          resource.data?.record.applicant?.name ?? t('approvals.unknownPerson'),
      })}
      className='sm:max-w-2xl'
      beforeClose={() => {
        if (busyRef.current) return false;
        if (!dirtyRef.current) return true;
        setDiscard(true);
        return new Promise<boolean>((resolve) => {
          closeResolveRef.current = resolve;
        });
      }}
      footer={
        <Footer busy={busy} disabled={!allowed || blocked} label={label} />
      }
    >
      {resource.error instanceof ApiClientError &&
      resource.error.status === 404 ? (
        <Missing onMissing={parent.reload} focusList={parent.focusList} />
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <FieldsSkeleton fields={3} />
      ) : item ? (
        <WorkForm
          key={`${resource.data.record.id}:${item.id}:${actionName}`}
          detail={resource.data}
          item={item}
          name={actionName}
          allowed={allowed}
          onBusy={(v) => {
            busyRef.current = v;
            setBusy(v);
          }}
          onDirty={(v) => {
            dirtyRef.current = v;
          }}
          onBlocked={setBlocked}
          reload={resource.reload}
        />
      ) : (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('departureRequests.actionForm.unavailable')}
          </AlertDescription>
        </Alert>
      )}
      <AlertDialog
        open={discard}
        onOpenChange={(v) => {
          if (!v) {
            setDiscard(false);
            closeResolveRef.current?.(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('approvals.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('approvals.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('approvals.cancel')}</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                dirtyRef.current = false;
                setDiscard(false);
                closeResolveRef.current?.(true);
              }}
            >
              {t('approvals.discardConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDrawer>
  );
}
function Footer({
  busy,
  disabled,
  label,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
}) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('approvals.cancel')}
      </Button>
      <Button type='submit' form='departure-work' disabled={busy || disabled}>
        {busy ? <Spinner /> : null}
        {label}
      </Button>
    </>
  );
}
export function WorkForm({
  detail,
  item,
  name,
  allowed,
  onBusy,
  onDirty,
  onBlocked,
  reload,
}: {
  detail: DepartureDetail;
  item: WorkItem;
  name: string;
  allowed: boolean;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onBlocked: (v: boolean) => void;
  reload: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<DetailContext>();
  const [reason, setReason] = useState(''),
    [checked, setChecked] = useState(false),
    [invalid, setInvalid] = useState(false),
    [error, setError] = useState<unknown>(),
    [running, setRunning] = useState(false),
    [locked, setLocked] = useState(false),
    [confirm, setConfirm] = useState(false);
  const activeRef = useRef(false),
    reasonRef = useRef<HTMLTextAreaElement>(null),
    checkRef = useRef<HTMLButtonElement>(null),
    attemptRef = useRef<{ requestId: string; body: Record<string, unknown> }>(
      undefined,
    );
  const requiresCheck = ['confirmChecklist', 'acknowledgeReceipt'].includes(
      name,
    ),
    force = name === 'forceComplete';
  useEffect(
    () => onDirty(!!reason || checked || locked),
    [reason, checked, locked, onDirty],
  );
  useEffect(() => onBlocked(locked), [locked, onBlocked]);
  const offer = item.offers.find((o) => o.name === name);
  async function perform() {
    if (activeRef.current || locked || !allowed) return;
    activeRef.current = true;
    setRunning(true);
    onBusy(true);
    setError(undefined);
    const input = force
      ? { reason: reason.trim() }
      : name === 'confirmChecklist'
        ? { confirmed: true }
        : name === 'acknowledgeReceipt'
          ? { received: true }
          : {};
    attemptRef.current = {
      requestId: createRequestId(),
      body: { action: name, version: item.lifecycleVersion, input },
    };
    try {
      await api.request({
        method: 'POST',
        path: `departureRequests/${encodeURIComponent(detail.record.id)}/workItems/${encodeURIComponent(item.id)}/actions`,
        json: {
          ...attemptRef.current.body,
          requestId: attemptRef.current.requestId,
        },
      });
      setLocked(true);
      onDirty(false);
      setConfirm(false);
      parent.reload();
      parent.reloadDetail();
      toaster.show({
        type: 'success',
        title: t('departureRequests.actionForm.saved', {
          name:
            detail.record.applicant?.name ??
            detail.record.number ??
            t('approvals.draft'),
        }),
      });
      onBusy(false);
      await close();
    } catch (cause) {
      setError(cause);
      setConfirm(false);
      if (
        !(cause instanceof ApiClientError) ||
        cause.status >= 500 ||
        cause.status === 409
      ) {
        setLocked(true);
      }
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404].includes(cause.status)
      ) {
        setReason('');
        setChecked(false);
        setLocked(true);
        attemptRef.current = undefined;
        parent.reloadDetail();
        reload();
      }
    } finally {
      activeRef.current = false;
      setRunning(false);
      onBusy(false);
    }
  }
  async function latest() {
    if (activeRef.current) return;
    try {
      const { data } = await api.request<{ data: DepartureDetail }>({
        path: `departureRequests/${encodeURIComponent(detail.record.id)}`,
      });
      const current = data.workItems.find((w) => w.id === item.id);
      parent.reload();
      parent.reloadDetail();
      reload();
      setError(undefined);
      /* An unknown write is never retried with a new key. Its current result must be inspected. */ if (
        error instanceof ApiClientError &&
        error.status === 409 &&
        current?.offers.some((o) => o.name === name && o.allowed)
      ) {
        setLocked(false);
        attemptRef.current = undefined;
      }
    } catch (cause) {
      setError(cause);
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404].includes(cause.status)
      ) {
        setReason('');
        setChecked(false);
        setLocked(true);
      }
    }
  }
  const label = t(`departureRequests.work.labels.${name}`),
    kind = t(`departureRequests.workKinds.${item.kind}`),
    recordName = detail.record.applicant?.name ?? t('approvals.unknownPerson');
  if (error instanceof ApiClientError && error.status === 404)
    return (
      <Missing
        onMissing={parent.reload}
        focusList={parent.focusList}
        name={detail.record.applicant?.name}
      />
    );
  return (
    <>
      {!allowed ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('departureRequests.actionForm.unavailable')}
            {offer?.blockers.map((b) => (
              <Blocker key={b.code} code={b.code} />
            ))}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <>
          <ErrorState error={error} retry={() => void latest()} />
          {locked &&
          (!(error instanceof ApiClientError) ||
            error.status === 409 ||
            error.status >= 500) ? (
            <Button
              variant='outline'
              disabled={running}
              onClick={() => void latest()}
            >
              {t('departureRequests.actionForm.latest')}
            </Button>
          ) : null}
        </>
      ) : null}
      <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-2'>
        <dt>{t('departureRequests.claimant')}</dt>
        <dd className='break-words'>
          <UserName name={item.claimedBy?.name ?? '—'} />
        </dd>
        <dt>{t('departureRequests.receiver')}</dt>
        <dd className='break-words'>
          <UserName name={item.receiver?.name ?? '—'} />
        </dd>
      </dl>
      {force ? (
        <Alert>
          <AlertDescription>
            {t('departureRequests.work.forceWarning')}
          </AlertDescription>
        </Alert>
      ) : null}
      <form
        id='departure-work'
        noValidate
        className='flex flex-col gap-4'
        onSubmit={(e) => {
          e.preventDefault();
          if (activeRef.current || locked || !allowed) return;
          if (force && !reason.trim()) {
            setInvalid(true);
            reasonRef.current?.focus();
            return;
          }
          if (requiresCheck && !checked) {
            setInvalid(true);
            checkRef.current?.focus();
            return;
          }
          setInvalid(false);
          if (force) setConfirm(true);
          else void perform();
        }}
      >
        {force ? (
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor='work-reason'>
              {t('departureRequests.work.reason')} *
            </FieldLabel>
            <Textarea
              id='work-reason'
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={10000}
              disabled={running || locked || !allowed}
              aria-required
              aria-invalid={invalid}
            />
            <FieldError>
              {invalid ? t('departureRequests.actionForm.required') : null}
            </FieldError>
          </Field>
        ) : null}
        {requiresCheck ? (
          <Field data-invalid={invalid}>
            <div className='flex items-start gap-2'>
              <Checkbox
                id='work-check'
                ref={checkRef}
                checked={checked}
                onCheckedChange={(v) => setChecked(v === true)}
                disabled={running || locked || !allowed}
                aria-required
                aria-invalid={invalid}
              />
              <FieldLabel htmlFor='work-check'>
                {t(`departureRequests.work.${name}`)}
              </FieldLabel>
            </div>
            <FieldError>
              {invalid ? t('departureRequests.actionForm.required') : null}
            </FieldError>
          </Field>
        ) : null}
      </form>
      <AlertDialog
        open={confirm}
        onOpenChange={(v) => {
          if (!running) setConfirm(v);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('departureRequests.work.forceConfirm', {
                kind,
                name: recordName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('departureRequests.work.forceDescription')}{' '}
              {t('departureRequests.claimant')}:{' '}
              <UserName name={item.claimedBy?.name ?? '—'} />;{' '}
              {t('departureRequests.receiver')}:{' '}
              <UserName name={item.receiver?.name ?? '—'} />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='flex flex-col gap-2'>
            {!item.checklistConfirmed ? (
              <p>
                {t('departureRequests.checklistConfirmed')}:{' '}
                {t('departureRequests.no')}
              </p>
            ) : null}
            {item.kind === 'work' && !item.receiverAcknowledged ? (
              <p>
                {t('departureRequests.receiverAcknowledged')}:{' '}
                {t('departureRequests.no')}
              </p>
            ) : null}
            {item.offers
              .find((value) => value.name === 'complete')
              ?.blockers.map((blocker) => (
                <Blocker key={blocker.code} code={blocker.code} />
              ))}
          </div>
          <p className='whitespace-pre-wrap break-words'>{reason}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>
              {t('approvals.cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={running || locked || !allowed}
              onClick={() => void perform()}
            >
              {running ? <Spinner /> : null}
              {label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
