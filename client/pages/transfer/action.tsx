import { createRequestKey } from '#lib/request-key';
import { UserName } from '#components/user-name';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useAuthorizationRevision,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Field, FieldLabel } from '#components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { useTransferResource } from './resource.js';
import { TransferError } from './states.js';
import { transferPolicy, type Context, type Person } from './types.js';
export default function TransferAction() {
  const { requestId, operation, taskId } = useParams(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return (
    <TransferActionContent
      key={`${session?.user.id}:${revision}:${requestId}:${operation}:${taskId}`}
    />
  );
}
function TransferActionContent() {
  const { operation = '', taskId } = useParams(),
    { detail, reload, writable, update } = useOutletContext<Context>(),
    api = useApiClient(),
    { t } = useTranslation(),
    navigate = useNavigate(),
    location = useLocation();
  const [place, setPlace] = useState(''),
    [signerMode, setSignerMode] = useState('before');
  const [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const destructive = [
    'reject',
    'terminate',
    'withdraw',
    'requestCancellation',
  ].includes(operation);
  const commandRef = useRef<{ payload: string; key: string } | undefined>(
    undefined,
  );
  const transition = [
      'submit',
      'withdraw',
      'terminate',
      'requestCancellation',
    ].includes(operation),
    needsPerson = [
      'transfer',
      'addSigner',
      'cc',
      'appoint',
      'reassign',
    ].includes(operation);
  const title = t(
    transition || operation === 'rebind'
      ? `transfer.operations.${operation}`
      : `approvals.${operation}`,
  );
  const permission = useCan(
    transferPolicy(
      operation === 'rebind'
        ? 'rebind'
        : operation === 'requestCancellation'
          ? 'cancel'
          : transition
            ? 'submit'
            : 'operate',
    ),
  );
  const candidates = useTransferResource<{
    data: { people: Person[]; nextOffset: number | null };
  }>(
    detail && needsPerson && taskId
      ? `transferRequests/${detail.record.id}/candidates`
      : null,
    {
      taskId: taskId ?? '',
      action: operation,
      search,
      offset: String(offset),
      limit: '50',
    },
  );
  const offer = detail
    ? offeredActions(
        detail.actions,
        [],
        detail.runs.map((run) => run.run),
      ).find(
        (action) =>
          action.name === operation &&
          ('taskId' in action.target
            ? action.target.taskId
            : action.target.runId) === taskId,
      )
    : undefined;
  const places = (
    Array.isArray(offer?.options.unassigned) ? offer.options.unassigned : []
  ).filter(
    (value): value is { place: string; title: string | null } =>
      !!value &&
      typeof value === 'object' &&
      'place' in value &&
      typeof value.place === 'string',
  );
  const available =
    !!detail &&
    writable === true &&
    permission.can &&
    !(error instanceof ApiClientError && error.status === 403) &&
    (transition
      ? detail.view.available.some(
          (action) => action.name === operation && action.allowed,
        )
      : operation === 'rebind'
        ? detail.record.status === 'pendingEffective'
        : !!offer);
  async function save() {
    if (!detail || !available) return;
    if (
      needsPerson &&
      (candidates.loading ||
        candidates.error ||
        !candidates.data ||
        !candidates.data.data.people.some((person) => person.id === recipient))
    )
      return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    setError(undefined);
    try {
      let input: Record<string, unknown> | undefined;
      if (needsPerson)
        input =
          operation === 'addSigner'
            ? { person: recipient, mode: signerMode }
            : operation === 'cc'
              ? { to: [recipient] }
              : operation === 'appoint'
                ? { to: recipient, place: place || places[0]?.place }
                : operation === 'reassign'
                  ? { to: recipient, override: false }
                  : { to: recipient };
      if (operation === 'return') input = { to: 'revision' };
      const signature = JSON.stringify({
        recordId: detail.record.id,
        version: detail.record.lifecycleVersion,
        target: offer?.target,
        contentHash: offer?.contentHash,
        input,
        place,
        signerMode,
        reason,
        recipient,
        operation,
        taskId,
      });
      if (commandRef.current?.payload !== signature)
        commandRef.current = { payload: signature, key: createRequestKey() };
      const response = await api.request<{ data: import('./types.js').Detail }>(
        {
          signal: controller.signal,
          method: 'POST',
          path: `transferRequests/${detail.record.id}/${operation === 'rebind' ? 'rebind' : transition ? 'transitions' : 'actions'}`,
          json: {
            requestKey: commandRef.current.key,
            reason,
            ...(transition || operation === 'rebind'
              ? {
                  version: detail.record.lifecycleVersion,
                  ...(transition ? { transition: operation } : {}),
                }
              : {
                  target: offer!.target,
                  action: operation,
                  input,
                  comment: reason,
                  contentHash: offer!.contentHash ?? undefined,
                }),
          },
        },
      );
      if (controller.signal.aborted) return;
      update?.(response.data);
      reload();
      toaster();
      await navigate(
        { pathname: '..', search: location.search, hash: location.hash },
        { replace: true },
      );
    } catch (error) {
      if (!controller.signal.aborted) setError(error);
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  }
  const notify = useToaster();
  function toaster() {
    notify.show({ type: 'success', title: t('transfer.saved') });
  }
  return (
    <RouteDrawer
      title={title}
      description={t(
        operation === 'requestCancellation'
          ? 'transfer.cancelConsequence'
          : operation === 'rebind'
            ? 'transfer.rebindConsequence'
            : 'transfer.confirmAction',
      )}
      beforeClose={() => !pending}
      footer={
        <>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() =>
              void navigate(
                {
                  pathname: '..',
                  search: location.search,
                  hash: location.hash,
                },
                { replace: true },
              )
            }
          >
            {t('transfer.cancel')}
          </Button>
          <Button
            disabled={
              pending ||
              !available ||
              !reason.trim() ||
              (needsPerson &&
                (!recipient ||
                  candidates.loading ||
                  !!candidates.error ||
                  !candidates.data ||
                  !candidates.data.data.people.some(
                    (person) => person.id === recipient,
                  ))) ||
              (operation === 'appoint' && places.length > 1 && !place)
            }
            variant={
              [
                'reject',
                'terminate',
                'withdraw',
                'requestCancellation',
              ].includes(operation)
                ? 'destructive'
                : 'default'
            }
            onClick={() => (destructive ? setConfirm(true) : void save())}
          >
            {pending ? t('transfer.saving') : t('transfer.confirm')}
          </Button>
        </>
      }
    >
      {!available ? <p role='alert'>{t('transfer.unavailable')}</p> : null}
      {error ? <TransferError error={error} retry={reload} /> : null}
      {needsPerson ? (
        <Field>
          <Input
            aria-label={t('transfer.searchPeople')}
            value={search}
            onChange={(event) => {
              setRecipient('');
              setSearch(event.target.value);
              setOffset(0);
            }}
            disabled={pending}
          />
          <FieldLabel htmlFor='transfer-recipient'>
            {t('transfer.recipient')}
          </FieldLabel>
          {candidates.error ? (
            <TransferError error={candidates.error} retry={candidates.reload} />
          ) : null}
          <Select
            value={recipient}
            onValueChange={(value) => setRecipient(value ?? '')}
            disabled={pending || candidates.loading}
          >
            <SelectTrigger id='transfer-recipient'>
              <SelectValue>
                {candidates.data?.data.people.find(
                  (person) => person.id === recipient,
                )?.name ?? t('transfer.select')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className='min-w-(--anchor-width) max-w-(--available-width)'>
              <SelectGroup>
                {candidates.data?.data.people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    <UserName name={person.name} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {needsPerson ? (
        <div className='flex gap-2'>
          <Button
            variant='outline'
            disabled={pending || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            {t('transfer.previous')}
          </Button>
          <Button
            variant='outline'
            disabled={pending || !candidates.data?.data.nextOffset}
            onClick={() => setOffset(candidates.data!.data.nextOffset!)}
          >
            {t('transfer.next')}
          </Button>
        </div>
      ) : null}
      {operation === 'appoint' && places.length > 1 ? (
        <Field>
          <FieldLabel htmlFor='transfer-place'>
            {t('approvals.place')}
          </FieldLabel>
          <Select
            value={place}
            onValueChange={(value) => setPlace(value ?? '')}
            disabled={pending}
          >
            <SelectTrigger id='transfer-place'>
              <SelectValue>
                {places.find((value) => value.place === place)?.title ??
                  t('transfer.select')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className='min-w-(--anchor-width) max-w-(--available-width)'>
              <SelectGroup>
                {places.map((value) => (
                  <SelectItem key={value.place} value={value.place}>
                    {value.title ?? value.place}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {operation === 'addSigner' ? (
        <Field>
          <FieldLabel htmlFor='transfer-sign-mode'>
            {t('approvals.signerMode')}
          </FieldLabel>
          <Select
            value={signerMode}
            onValueChange={(value) => setSignerMode(value ?? 'before')}
            disabled={pending}
          >
            <SelectTrigger id='transfer-sign-mode'>
              <SelectValue>{t(`approvals.signer${signerMode}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent className='min-w-(--anchor-width) max-w-(--available-width)'>
              <SelectGroup>
                {['before', 'alongside'].map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`approvals.signer${value}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor='transfer-action-reason'>
          {t('transfer.fields.reason')}
        </FieldLabel>
        <Textarea
          id='transfer-action-reason'
          value={reason}
          disabled={pending}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          maxLength={10000}
        />
      </Field>
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!pending) setConfirm(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>
              <UserName name={detail?.facts.employee.name} /> ·{' '}
              {detail?.record.id}.{' '}
              {t(
                operation === 'requestCancellation'
                  ? 'transfer.cancelConsequence'
                  : 'transfer.destructiveConsequence',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('transfer.cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={pending || !available}
              onClick={() => {
                setConfirm(false);
                void save();
              }}
            >
              {t('transfer.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDrawer>
  );
}
