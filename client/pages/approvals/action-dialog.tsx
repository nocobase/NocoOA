import { UserName } from '#components/user-name';
import { RecipientPicker } from './recipient-picker.js';
import { createRequestId } from './request-id.js';
import { LeaveAttachments } from './attachments.js';
import { useLeaveLabel } from './use-leave-label.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import { useMemo, useRef, useState, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useOutletContext, useParams } from 'react-router';
import { z } from 'zod';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { UserPicker } from '#components/user-picker';
import { Button } from '#components/ui/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Spinner } from '#components/ui/spinner';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from './use-resource.js';
import { ErrorState } from './states.js';
import { ACTIONS, type LeaveDetail, type DetailContext } from './types.js';

export default function ApprovalActionDialog() {
  const { actionName = 'approve', requestId, targetId = '' } = useParams();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [discard, setDiscard] = useState(false);
  const resolveCloseRef = useRef<((value: boolean) => void) | null>(null);
  const resource = useResource<LeaveDetail>(
    `leaveRequests/${encodeURIComponent(requestId ?? '')}`,
  );
  const parent = useOutletContext<DetailContext>();
  const missingErrorRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (missingErrorRef.current === resource.error) return;
    missingErrorRef.current = resource.error;
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [resource.error, parent]);
  const currentActions = resource.data
    ? offeredActions(
        resource.data.taskActions,
        resource.data.runActions,
        resource.data.runs.map((r) => r.run),
      )
    : [];
  const currentAllowed =
    actionName === 'terminate'
      ? resource.data?.view.available.some(
          (v) => v.name === 'terminate' && v.allowed,
        )
      : currentActions.some(
          (a) =>
            a.name === actionName &&
            ('taskId' in a.target ? a.target.taskId : a.target.runId) ===
              targetId,
        );
  const name = resource.data?.record.number ?? t('approvals.draft');
  return (
    <RouteDrawer
      title={t('approvals.actionTitle', {
        action: t(`approvals.${actionName}`),
        name,
      })}
      className={
        ['appoint', 'reassign'].includes(actionName)
          ? undefined
          : 'sm:max-w-2xl'
      }
      beforeClose={() => {
        if (busyRef.current) return false;
        if (!dirtyRef.current) return true;
        setDiscard(true);
        return new Promise<boolean>((resolve) => {
          resolveCloseRef.current = resolve;
        });
      }}
      footer={
        <ActionFooter
          busy={busy}
          disabled={
            done ||
            !currentAllowed ||
            resource.loading ||
            !!resource.error ||
            !resource.data
          }
          action={actionName}
        />
      }
    >
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <FieldsSkeleton />
      ) : (
        <ActionForm
          detail={resource.data}
          actionName={actionName}
          targetId={targetId}
          onReload={resource.reload}
          onComplete={() => setDone(true)}
          onBusy={(value) => {
            busyRef.current = value;
            setBusy(value);
          }}
          onDirty={(value) => {
            dirtyRef.current = value;
          }}
        />
      )}
      <AlertDialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) {
            setDiscard(false);
            resolveCloseRef.current?.(false);
            resolveCloseRef.current = null;
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
            <AlertDialogCancel disabled={busy}>
              {t('approvals.cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                dirtyRef.current = false;
                setDiscard(false);
                resolveCloseRef.current?.(true);
                resolveCloseRef.current = null;
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
function ActionFooter({
  busy,
  disabled,
  action,
}: {
  busy: boolean;
  disabled: boolean;
  action: string;
}) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('approvals.cancel')}
      </Button>
      <Button
        type='submit'
        form='approval-action-form'
        disabled={busy || disabled}
      >
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t(`approvals.${action}`)}
      </Button>
    </>
  );
}
function ActionForm({
  detail,
  actionName,
  targetId,
  onBusy,
  onDirty,
  onReload,
  onComplete,
}: {
  detail: LeaveDetail;
  actionName: string;
  targetId: string;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onReload: () => void;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const typeLabel = useLeaveLabel();
  const api = useApiClient();
  const toaster = useToaster();
  const { close } = useRouteOverlay();
  const parent = useOutletContext<DetailContext>();
  const canPick = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const [writeError, setWriteError] = useState<unknown>();
  const [committed, setCommitted] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [requestKey] = useState(() => createRequestId());
  const [pendingValues, setPendingValues] = useState<{
    comment: string;
    to: string;
    place: string;
    mode: 'before' | 'alongside';
  }>();
  const actions = offeredActions(
    detail.taskActions,
    detail.runActions,
    detail.runs.map((r) => r.run),
  );
  const action = actions.find(
    (a) =>
      a.name === actionName &&
      ('taskId' in a.target ? a.target.taskId : a.target.runId) === targetId,
  );
  const terminating =
    actionName === 'terminate' &&
    detail.view.available.some((v) => v.name === 'terminate' && v.allowed);
  const allowed =
    terminating ||
    (!!action && (ACTIONS as readonly string[]).includes(actionName));
  const scopedPerson = ['transfer', 'addSigner'].includes(actionName);
  const needsPerson =
    scopedPerson || ['appoint', 'reassign'].includes(actionName);
  const canChoose = scopedPerson || canPick;
  const reasonRequired = terminating || action?.reasonRequired === true;
  const places = (
    Array.isArray(action?.options.unassigned) ? action.options.unassigned : []
  ).filter(
    (value): value is { place: string; title: string | null } =>
      !!value &&
      typeof value === 'object' &&
      'place' in value &&
      typeof value.place === 'string',
  );
  const placeCount = places.length;
  const schema = useMemo(
    () =>
      z.object({
        comment: z
          .string()
          .trim()
          .max(10000, t('approvals.limit'))
          .refine((v) => !reasonRequired || !!v, t('approvals.required')),
        to: z
          .string()
          .refine((v) => !needsPerson || !!v, t('approvals.required')),
        mode: z.enum(['before', 'alongside']),
        place: z
          .string()
          .refine(
            (v) => actionName !== 'appoint' || placeCount <= 1 || !!v,
            t('approvals.required'),
          ),
      }),
    [t, reasonRequired, needsPerson, actionName, placeCount],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      mode: 'before' as const,
      comment: '',
      to: '',
      place: places.length === 1 ? places[0].place : '',
    },
  });
  useEffect(
    () => onDirty(form.formState.isDirty),
    [onDirty, form.formState.isDirty],
  );
  async function perform(values: {
    comment: string;
    to: string;
    place: string;
    mode: 'before' | 'alongside';
  }) {
    if (!allowed || committed || running || (needsPerson && !canChoose)) return;
    setRunning(true);
    onBusy(true);
    setWriteError(undefined);
    try {
      if (terminating)
        await api.request({
          method: 'POST',
          path: `leaveRequests/${detail.record.id}/transition`,
          json: {
            transition: 'terminate',
            version: detail.record.lifecycleVersion,
            requestId: requestKey,
            input: { reason: values.comment },
          },
        });
      else
        await api.request({
          method: 'POST',
          path: `leaveRequests/${detail.record.id}/action`,
          json: {
            target: action!.target,
            action: actionName,
            input:
              actionName === 'return'
                ? { to: 'revision' }
                : actionName === 'transfer'
                  ? { to: values.to }
                  : actionName === 'addSigner'
                    ? { person: values.to, mode: values.mode }
                    : actionName === 'appoint'
                      ? { to: values.to, place: values.place || undefined }
                      : actionName === 'reassign'
                        ? { to: values.to, override: false }
                        : {},
            comment: values.comment || undefined,
            contentHash: action!.contentHash ?? undefined,
            requestId: requestKey,
          },
        });
      setCommitted(true);
      onComplete();
      onDirty(false);
      form.reset(values);
      parent.reload();
      let data: LeaveDetail;
      try {
        const response = await api.request<{ data: LeaveDetail }>({
          path: `leaveRequests/${detail.record.id}`,
        });
        data = response.data;
      } catch {
        setRefreshFailed(true);
        setConfirm(false);
        return;
      }
      parent.update(data.record);
      parent.reload();
      form.reset(values);
      onDirty(false);
      onBusy(false);
      setConfirm(false);
      toaster.show({
        type: 'success',
        title: t('approvals.completed', {
          name: detail.record.number ?? t('approvals.draft'),
          action: t(`approvals.${actionName}`),
        }),
      });
      await close();
    } catch (error) {
      setWriteError(error);
    } finally {
      onBusy(false);
      setRunning(false);
    }
  }
  const handler = form.handleSubmit((values) => {
    if (committed || running || !allowed || (needsPerson && !canChoose)) return;
    if (['reject', 'return', 'terminate'].includes(actionName)) {
      setPendingValues(values);
      setConfirm(true);
    } else return perform(values);
  });
  return (
    <>
      {!allowed || (needsPerson && !canChoose) ? (
        <Alert variant='destructive'>
          <AlertDescription>{t('approvals.error.stale')}</AlertDescription>
        </Alert>
      ) : null}
      {refreshFailed ? (
        <Alert>
          <AlertDescription>
            {t('approvals.refreshAfterSuccess')}
          </AlertDescription>
          <Button variant='outline' onClick={onReload}>
            {t('approvals.loadLatest')}
          </Button>
        </Alert>
      ) : null}
      <dl className='grid gap-2 text-sm'>
        {[
          [
            t('approvals.applicant'),
            <UserName
              key={t('approvals.applicant')}
              name={
                detail.users.find((v) => v.id === detail.record.applicantId)
                  ?.name ?? t('approvals.unknownPerson')
              }
            />,
          ] as const,
          [
            t('approvals.startDate'),
            `${detail.record.startDate} ${t(`approvals.${detail.record.startHalf}`)}`,
          ],
          [
            t('approvals.endDate'),
            `${detail.record.endDate} ${t(`approvals.${detail.record.endHalf}`)}`,
          ],
          [t('approvals.reason'), detail.record.reason],
          [
            t('approvals.handover'),
            <UserName
              key={t('approvals.handover')}
              name={
                detail.record.handoverUserId
                  ? (detail.users.find(
                      (v) => v.id === detail.record.handoverUserId,
                    )?.name ?? t('approvals.unknownPerson'))
                  : '—'
              }
            />,
          ] as const,
          [
            t('approvals.delegate'),
            t(
              detail.record.enableDelegation ? 'approvals.yes' : 'approvals.no',
            ),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='whitespace-pre-wrap break-words'>{value}</dd>
          </div>
        ))}
      </dl>
      <section className='flex flex-col gap-2'>
        <h2 className='text-base font-medium'>{t('approvals.attachments')}</h2>
        <LeaveAttachments
          leaveId={detail.record.id}
          ids={detail.record.attachments}
        />
      </section>
      <p className='text-sm text-muted-foreground'>
        {detail.record.number ?? t('approvals.draft')} ·{' '}
        {typeLabel(detail.record.leaveType)} · {detail.record.startDate}–
        {detail.record.endDate} · {detail.record.days} {t('approvals.days')}
      </p>
      {actionName === 'return' ? (
        <p className='text-sm text-muted-foreground'>
          {t('approvals.returnHint')}
        </p>
      ) : null}
      {writeError ? <ErrorState error={writeError} retry={onReload} /> : null}
      <form
        id='approval-action-form'
        onSubmit={(event) => {
          void handler(event);
        }}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.comment}>
            <FieldLabel htmlFor='approval-comment'>
              {t(
                actionName === 'approve'
                  ? 'approvals.opinion'
                  : 'approvals.reason',
              )}
              {reasonRequired ? ' *' : ''}
            </FieldLabel>
            <Textarea
              id='approval-comment'
              {...form.register('comment')}
              aria-invalid={!!form.formState.errors.comment}
              disabled={
                running || committed || form.formState.isSubmitting || !allowed
              }
            />
            <FieldError errors={[form.formState.errors.comment]} />
          </Field>
          {needsPerson && canChoose ? (
            <Controller
              name='to'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='approval-person'>
                    {t('approvals.person')} *
                  </FieldLabel>
                  {scopedPerson ? (
                    <RecipientPicker
                      id='approval-person'
                      leaveId={detail.record.id}
                      taskId={targetId}
                      action={actionName}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={running || committed}
                    />
                  ) : (
                    <UserPicker
                      id='approval-person'
                      disabled={running || committed}
                      value={field.value}
                      onChange={field.onChange}
                      knownUsers={detail.users}
                      invalid={fieldState.invalid}
                      excludeIds={[detail.record.applicantId]}
                    />
                  )}
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : null}
          {actionName === 'addSigner' ? (
            <Controller
              name='mode'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel>{t('approvals.signerMode')}</FieldLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => field.onChange(value)}
                    disabled={running || committed}
                    items={['before', 'alongside'].map((value) => ({
                      value,
                      label: t(`approvals.signer${value}`),
                    }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {['before', 'alongside'].map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {t(`approvals.signer${mode}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          ) : null}
          {actionName === 'appoint' && places.length > 1 ? (
            <Controller
              name='place'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='approval-place'>
                    {t('approvals.place')} *
                  </FieldLabel>
                  <Select
                    disabled={running || committed}
                    items={places.map((v) => ({
                      value: v.place,
                      label: v.title ?? v.place,
                    }))}
                    value={field.value || null}
                    onValueChange={(v) => field.onChange(v ?? '')}
                  >
                    <SelectTrigger id='approval-place'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                      <SelectGroup>
                        {places.map((v) => (
                          <SelectItem key={v.place} value={v.place}>
                            {v.title ?? v.place}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : null}
        </FieldGroup>
      </form>
      <AlertDialog
        open={confirm}
        onOpenChange={(value) => {
          if (!running) setConfirm(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('approvals.actionTitle', {
                action: t(`approvals.${actionName}`),
                name: detail.record.number ?? t('approvals.draft'),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                actionName === 'return'
                  ? 'approvals.confirmReturn'
                  : actionName === 'reject'
                    ? 'approvals.confirmReject'
                    : 'approvals.confirmTerminate',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {writeError ? (
            <ErrorState error={writeError} retry={onReload} />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>
              {t('approvals.cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={running || committed}
              onClick={() => void perform(pendingValues!)}
            >
              {running ? <Spinner data-icon='inline-start' /> : null}
              {t(`approvals.${actionName}`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
