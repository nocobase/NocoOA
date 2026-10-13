import { UserNameText } from '#components/user-name';
import { useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useToaster, ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { DateTimePicker } from '#components/date-time-picker';
import { UserPicker } from '#components/user-picker';
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { useSealResource } from './resource.js';
import { useSealCommand } from './command.js';
import { SealError, SealSkeleton } from './states.js';
import {
  supportedAction,
  type Detail,
  type Capabilities,
  type Source,
} from './types.js';
export default function SealAction() {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return <Overlay key={`${session?.user.id}:${revision}`} />;
}
function Overlay() {
  const { sealRequestId, operation: op, taskId } = useParams(),
    operation = op ?? 'actualReturn',
    { t } = useTranslation(),
    r = useSealResource<{ data: Detail }>(`sealRequests/${sealRequestId}`),
    c = useSealResource<{ data: Capabilities }>(
      `sealBrowser/requests/${sealRequestId}/capabilities`,
    ),
    busyRef = useRef(false),
    dirtyRef = useRef(false),
    resolveRef = useRef<((v: boolean) => void) | null>(null),
    [discard, setDiscard] = useState(false),
    [busy, setBusy] = useState(false),
    d = r.data?.data,
    cap = c.data?.data,
    offer = cap?.taskActions.find(
      (o) => o.taskId === taskId && o.actions.some((a) => a.name === operation),
    ),
    transition = cap?.transitions.includes(operation),
    ready =
      !!d &&
      !!cap &&
      !r.loading &&
      !c.loading &&
      !r.error &&
      !c.error &&
      (transition ||
        (offer &&
          offer.actions.some(
            (a) => a.name === operation && supportedAction(a),
          )) ||
        (operation === 'actualReturn' && cap.canActualReturn));
  return (
    <RouteDrawer
      title={t(`seals.actions.${operation}`)}
      className='sm:max-w-2xl'
      beforeClose={() =>
        busyRef.current
          ? false
          : dirtyRef.current
            ? new Promise<boolean>((resolve) => {
                resolveRef.current = resolve;
                setDiscard(true);
              })
            : true
      }
      footer={<Footer busy={busy} ready={!!ready} />}
    >
      {r.error || c.error ? (
        <SealError error={r.error ?? c.error} />
      ) : r.loading || c.loading ? (
        <SealSkeleton />
      ) : ready && d && cap ? (
        <Body
          key={`${d.record.lifecycleVersion}:${taskId}:${operation}`}
          detail={d}
          cap={cap}
          operation={operation}
          taskId={taskId}
          onDirty={(v) => {
            dirtyRef.current = v;
          }}
          refresh={() => {
            r.invalidate();
            c.invalidate();
          }}
          pending={(v) => {
            busyRef.current = v;
            setBusy(v);
          }}
        />
      ) : (
        <p>{t('seals.unavailable')}</p>
      )}
      <AlertDialog
        open={discard}
        onOpenChange={(v) => {
          setDiscard(v);
          if (!v) {
            resolveRef.current?.(false);
            resolveRef.current = null;
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('seals.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('seals.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('seals.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirtyRef.current = false;
                resolveRef.current?.(true);
                resolveRef.current = null;
                setDiscard(false);
              }}
            >
              {t('seals.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDrawer>
  );
}
function Footer({ busy, ready }: { busy: boolean; ready: boolean }) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('seals.cancel')}
      </Button>
      <Button form='seal-action' type='submit' disabled={busy || !ready}>
        {t('seals.confirm')}
      </Button>
    </>
  );
}
function Body({
  detail,
  cap,
  operation,
  taskId,
  pending,
  onDirty,
  refresh,
}: {
  detail: Detail;
  cap: Capabilities;
  operation: string;
  taskId?: string;
  pending: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  refresh: () => void;
}) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay(),
    toast = useToaster(),
    parent = useOutletContext<Source>(),
    cmd = useSealCommand(),
    [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState(''),
    [mode, setMode] = useState(() => {
      const a = cap.taskActions
        .find((o) => o.taskId === taskId)
        ?.actions.find((a) => a.name === operation);
      return Array.isArray(a?.options?.modes)
        ? (a.options.modes.filter(
            (m): m is string => typeof m === 'string' && m === 'before',
          )[0] ?? '')
        : '';
    }),
    [returnTarget, setReturnTarget] = useState(() => {
      const a = cap.taskActions
        .find((o) => o.taskId === taskId)
        ?.actions.find((a) => a.name === operation);
      return Array.isArray(a?.options?.targets)
        ? (a.options.targets.find((v): v is string => typeof v === 'string') ??
            '')
        : '';
    }),
    [sealId, setSealId] = useState(detail.record.sealId ?? ''),
    [actualCopies, setActualCopies] = useState(detail.record.copies),
    [sealedAt, setSealedAt] = useState(''),
    [borrowedAt, setBorrowedAt] = useState(''),
    [returnedAt, setReturnedAt] = useState(''),
    [invalid, setInvalid] = useState(false),
    [confirm, setConfirm] = useState(false),
    offer = cap.taskActions.find((o) => o.taskId === taskId),
    transition = cap.transitions.includes(operation),
    returning = ['returning', 'returnException'].includes(detail.record.status),
    physical = operation === 'complete' || operation === 'actualReturn',
    checkout =
      physical &&
      operation !== 'actualReturn' &&
      detail.record.external &&
      !returning,
    recipientNeeded = [
      'assign',
      'transfer',
      'cc',
      'addSigner',
      'appoint',
      'reassign',
    ].includes(operation),
    destructive = [
      'reject',
      'return',
      'unable',
      'withdraw',
      'terminate',
      'forceComplete',
    ].includes(operation),
    reasonNeeded =
      destructive ||
      ['retry', 'actualReturn', 'transfer', 'appoint', 'reassign'].includes(
        operation,
      ),
    seals = useSealResource<{
      data: {
        id: string;
        name: string;
        code: string;
        sealType: string;
        active: boolean;
      }[];
    }>(operation === 'complete' && !returning ? 'seals' : null);
  const selectedAction = offer?.actions.find((a) => a.name === operation);
  const modes = Array.isArray(selectedAction?.options?.modes)
    ? selectedAction.options.modes.filter(
        (m): m is string => typeof m === 'string' && m === 'before',
      )
    : [];
  const blocked =
    cmd.error instanceof ApiClientError &&
    [401, 403, 404, 409].includes(cmd.error.status);
  // Read DTO timestamps may contain a valid offset; HTTP writes require ISO Z.
  const originalBorrowedAt = detail.record.borrowedAt;
  const borrowedInstant = originalBorrowedAt
    ? Date.parse(originalBorrowedAt)
    : NaN;
  const canonicalBorrowedAt = Number.isFinite(borrowedInstant)
    ? new Date(borrowedInstant).toISOString()
    : null;
  function valid() {
    return (
      (!reasonNeeded || !!reason.trim()) &&
      (operation !== 'return' ||
        (Array.isArray(selectedAction?.options?.targets) &&
          selectedAction.options.targets.includes(returnTarget))) &&
      (operation !== 'addSigner' || modes.includes(mode)) &&
      (!recipientNeeded || !!recipient) &&
      (!physical ||
        (!!sealId &&
          (!returning || !!canonicalBorrowedAt) &&
          (checkout
            ? !!borrowedAt
            : !!sealedAt &&
              actualCopies >= 1 &&
              actualCopies <= detail.record.copies &&
              ((!returning && operation !== 'actualReturn') || !!returnedAt))))
    );
  }
  async function execute() {
    if (blocked || !valid()) {
      setInvalid(true);
      return;
    }
    pending(true);
    let input: Record<string, unknown> = {};
    if (physical)
      input = {
        sealId,
        actualCopies: checkout ? null : actualCopies,
        sealedAt: checkout ? null : sealedAt,
        borrowedAt: checkout
          ? borrowedAt
          : returning
            ? canonicalBorrowedAt
            : null,
        returnedAt:
          returning || operation === 'actualReturn' ? returnedAt : null,
      };
    else if (recipientNeeded)
      input =
        operation === 'addSigner'
          ? { person: recipient, mode }
          : ['appoint', 'reassign'].includes(operation)
            ? { userId: recipient }
            : { to: operation === 'cc' ? [recipient] : recipient };
    else if (operation === 'return') input = { to: returnTarget };
    const body =
      operation === 'actualReturn'
        ? {
            expectedVersion: detail.record.lifecycleVersion,
            actualCopies,
            sealedAt,
            returnedAt,
            reason: reason.trim(),
          }
        : transition
          ? {
              expectedVersion: detail.record.lifecycleVersion,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            }
          : {
              action: operation,
              target: { taskId: offer!.taskId },
              contentHash: offer!.contentHash,
              ...(reason.trim() ? { comment: reason.trim() } : {}),
              ...(Object.keys(input).length ? { input } : {}),
            };
    const result = await cmd.execute(
      `sealRequests/${detail.record.id}/${operation === 'actualReturn' ? 'actualReturn' : transition ? operation : 'actions'}`,
      'POST',
      body,
      transition || operation === 'actualReturn' ? 'requestKey' : 'requestId',
    );
    if (
      !result &&
      cmd.lastErrorRef.current instanceof ApiClientError &&
      [401, 403, 404, 409].includes(cmd.lastErrorRef.current.status)
    ) {
      setReason('');
      setRecipient('');
      setSealId('');
      setSealedAt('');
      setBorrowedAt('');
      setReturnedAt('');
      onDirty(false);
    }
    pending(false);
    setConfirm(false);
    if (result) {
      onDirty(false);
      parent?.reload();
      toast.show({ type: 'success', title: t('seals.saved') });
      await close();
    }
  }
  if (blocked)
    return (
      <>
        <SealError error={cmd.error} />
        {cmd.error instanceof ApiClientError && cmd.error.status === 409 ? (
          <Button onClick={refresh}>{t('seals.refresh')}</Button>
        ) : null}
      </>
    );
  return (
    <>
      <form
        id='seal-action'
        onChangeCapture={() => onDirty(true)}
        className='flex flex-col gap-4'
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid()) {
            setInvalid(true);
            return;
          }
          if (destructive) setConfirm(true);
          else void execute();
        }}
      >
        {invalid ? (
          <p role='alert' className='text-destructive'>
            {t('seals.invalidInput')}
          </p>
        ) : null}
        {cmd.error ? <SealError error={cmd.error} /> : null}
        <p>
          <UserNameText
            text={detail.record.number ?? detail.record.applicant.name}
            name={detail.record.applicant.name}
          />
        </p>
        {physical ? (
          <>
            <p className='text-muted-foreground'>
              {t(
                checkout
                  ? 'seals.checkoutNotice'
                  : operation === 'actualReturn'
                    ? 'seals.exceptionalNotice'
                    : 'seals.physicalNotice',
              )}
            </p>
            {!returning && operation === 'complete' ? (
              <Field>
                <FieldLabel htmlFor='seal-instance'>
                  {t('seals.sealId')} *
                </FieldLabel>
                {seals.error ? <SealError error={seals.error} /> : null}
                <Select
                  value={sealId}
                  onValueChange={(v) => setSealId(v ?? '')}
                  disabled={cmd.busy || seals.loading || !!seals.error}
                >
                  <SelectTrigger id='seal-instance'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {seals.data?.data
                        .filter(
                          (s) =>
                            s.active && s.sealType === detail.record.sealType,
                        )
                        .map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} · {s.code}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {!checkout ? (
              <Field>
                <FieldLabel htmlFor='seal-actual'>
                  {t('seals.actualCopies')} *
                </FieldLabel>
                <Input
                  id='seal-actual'
                  type='number'
                  min={1}
                  max={detail.record.copies}
                  value={actualCopies}
                  disabled={cmd.busy}
                  onChange={(e) => setActualCopies(Number(e.target.value))}
                />
              </Field>
            ) : null}
            {(checkout
              ? ['borrowedAt']
              : returning || operation === 'actualReturn'
                ? ['sealedAt', 'returnedAt']
                : ['sealedAt']
            ).map((name) => (
              <Field key={name}>
                <FieldLabel htmlFor={`seal-${name}`}>
                  {t(`seals.${name}`)} *
                </FieldLabel>
                <DateTimePicker
                  id={`seal-${name}`}
                  value={
                    name === 'sealedAt'
                      ? sealedAt
                      : name === 'borrowedAt'
                        ? borrowedAt
                        : returnedAt
                  }
                  onChange={
                    name === 'sealedAt'
                      ? setSealedAt
                      : name === 'borrowedAt'
                        ? setBorrowedAt
                        : setReturnedAt
                  }
                  timeZone={cap.timeZone}
                  timeLabel={t(`seals.${name}`)}
                  disabled={cmd.busy}
                />
              </Field>
            ))}
          </>
        ) : null}
        {recipientNeeded ? (
          <Field>
            <FieldLabel>{t('seals.recipient')} *</FieldLabel>
            <UserPicker
              value={recipient}
              onChange={setRecipient}
              knownUsers={[
                detail.record.applicant,
                detail.record.createdBy,
                ...detail.tasks.flatMap((t) =>
                  t.assignee ? [t.assignee] : [],
                ),
              ]}
            />
          </Field>
        ) : null}
        {operation === 'return' &&
        Array.isArray(selectedAction?.options?.targets) ? (
          <Field>
            <FieldLabel htmlFor='seal-target'>
              {t('seals.returnTarget')}
            </FieldLabel>
            <Select
              value={returnTarget}
              onValueChange={(v) => setReturnTarget(v ?? '')}
            >
              <SelectTrigger id='seal-target'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {selectedAction.options.targets
                    .filter((v): v is string => typeof v === 'string')
                    .map((target) => (
                      <SelectItem key={target} value={target}>
                        {t(`seals.states.${target}`)}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {operation === 'addSigner' ? (
          <Field>
            <FieldLabel htmlFor='seal-mode'>{t('seals.mode')}</FieldLabel>
            <Select value={mode} onValueChange={(v) => setMode(v ?? 'before')}>
              <SelectTrigger id='seal-mode'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`seals.modes.${m}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor='seal-reason'>
            {t('seals.reason')}
            {reasonNeeded ? ' *' : ''}
          </FieldLabel>
          <Textarea
            id='seal-reason'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={reasonNeeded}
            maxLength={2000}
            disabled={cmd.busy}
          />
        </Field>
      </form>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`seals.actions.${operation}`)} ·{' '}
              <UserNameText
                text={detail.record.number ?? detail.record.applicant.name}
                name={detail.record.applicant.name}
              />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                operation === 'forceComplete'
                  ? 'seals.exceptionalNotice'
                  : 'seals.confirmDescription',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('seals.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={cmd.busy}
              onClick={() => void execute()}
            >
              {t(`seals.actions.${operation}`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
