import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  offeredActions,
  type OfferedAction,
} from '@nocobase/app-plugin-approval/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useOutletContext, useParams } from 'react-router';
import { z } from 'zod';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { ApprovalRecipientPicker } from '#components/approval-recipient-picker';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '#components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
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
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { ErrorState } from './states.js';
import { PaymentAttachmentEditor } from './attachments.js';
import { parseCents, moneyLabel } from './money.js';
import type { DetailContext, PaymentDetail } from './types.js';
const transitions = [
  'submit',
  'withdraw',
  'retryCash',
  'retryCashAsAdmin',
  'forcePayException',
  'terminate',
  'reviseBusiness',
];
const sdkActions = [
  'approve',
  'reject',
  'return',
  'returnTo',
  'complete',
  'unable',
  'forceComplete',
  'claim',
  'release',
  'assign',
  'comment',
  'read',
  'urge',
  'transfer',
  'addSigner',
  'cc',
  'appoint',
  'reassign',
];
const confirming = [
  'withdraw',
  'terminate',
  'retryCashAsAdmin',
  'forcePayException',
  'forceComplete',
  'reject',
  'return',
  'returnTo',
  'complete',
  'unable',
  'reviseBusiness',
];
function matching(detail: PaymentDetail, name: string, target: string) {
  return offeredActions(
    detail.taskActions,
    detail.runActions,
    detail.runs.map((r) => r.run),
  ).find(
    (a) =>
      a.name === name &&
      ('taskId' in a.target ? a.target.taskId : a.target.runId) === target,
  );
}
function transitionAllowed(
  detail: PaymentDetail,
  name: string,
  target: string,
) {
  return (
    transitions.includes(name) &&
    target === detail.record.id &&
    detail.view.available.some((a) => a.name === name && a.allowed)
  );
}
export default function PaymentActionDialog() {
  const { requestId, actionName = '', targetId = '' } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<DetailContext>();
  const resource = useResource<PaymentDetail>(
    requestId ? `paymentRequests/${encodeURIComponent(requestId)}` : null,
  );
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [blocked, setBlocked] = useState(false),
    [discard, setDiscard] = useState(false);
  const busyRef = useRef(false),
    dirtyRef = useRef(false),
    closeResolveRef = useRef<(v: boolean) => void>(undefined);
  const onBusy = useCallback((v: boolean) => {
      busyRef.current = v;
      setBusy(v);
    }, []),
    onDirty = useCallback((v: boolean) => {
      dirtyRef.current = v;
    }, []);
  const action = resource.data
    ? matching(resource.data, actionName, targetId)
    : undefined;
  const allowed =
    !!resource.data &&
    (transitionAllowed(resource.data, actionName, targetId) ||
      (!!action && sdkActions.includes(actionName)));
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [resource.error, parent]);
  const name = resource.data?.record.number ?? t('approvals.draft'),
    label = t(`paymentRequests.actionForm.labels.${actionName}`);
  return (
    <RouteDrawer
      className={
        [
          'transfer',
          'addSigner',
          'cc',
          'appoint',
          'reassign',
          'assign',
          'forceComplete',
          'forcePayException',
        ].includes(actionName)
          ? undefined
          : 'sm:max-w-2xl'
      }
      title={t('paymentRequests.actionForm.title', {
        action: label,
        name,
      })}
      beforeClose={() => {
        if (busyRef.current) return false;
        if (!dirtyRef.current) return true;
        setDiscard(true);
        return new Promise<boolean>((resolve) => {
          closeResolveRef.current = resolve;
        });
      }}
      footer={
        <ActionFooter
          busy={busy}
          disabled={
            done || blocked || !allowed || resource.loading || !!resource.error
          }
          label={label}
        />
      }
    >
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !resource.data ? (
        <FieldsSkeleton fields={4} />
      ) : (
        <ActionForm
          key={`${actionName}:${targetId}`}
          detail={resource.data}
          name={actionName}
          targetId={targetId}
          allowed={allowed && !resource.loading}
          action={action}
          onBusy={onBusy}
          onDirty={onDirty}
          onComplete={() => setDone(true)}
          onBlocked={setBlocked}
          reload={resource.reload}
        />
      )}
      <AlertDialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) {
            setDiscard(false);
            closeResolveRef.current?.(false);
            closeResolveRef.current = undefined;
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
                closeResolveRef.current = undefined;
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
      <Button type='submit' form='payment-action' disabled={busy || disabled}>
        {busy ? <Spinner /> : null}
        {label}
      </Button>
    </>
  );
}
export function ActionForm({
  detail,
  name,
  targetId,
  allowed,
  action,
  onBusy,
  onDirty,
  onComplete,
  onBlocked,
  reload,
}: {
  detail: PaymentDetail;
  name: string;
  targetId: string;
  allowed: boolean;
  action?: OfferedAction;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onComplete: () => void;
  onBlocked?: (v: boolean) => void;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<DetailContext>();
  const f = useCallback(
    (key: string) => t(`paymentRequests.actionForm.${key}`),
    [t],
  );
  const [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState(false),
    [running, setRunning] = useState(false),
    [committed, setCommitted] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [confirm, setConfirm] = useState(false);
  const attachmentBusyRef = useRef(false);
  const runningRef = useRef(false),
    attemptRef = useRef<{
      key: string;
      requestId: string;
      body: Record<string, unknown>;
    }>(undefined),
    attemptValuesRef = useRef<{
      comment: string;
      to: string;
      mode: string;
      place: string;
      returnTarget: string;
      voucherNumber: string;
      amount: string;
      voucherAttachments: string[];
    }>(undefined);
  const transition = transitionAllowed(detail, name, targetId),
    forced = ['forceComplete', 'forcePayException'].includes(name),
    person = [
      'transfer',
      'addSigner',
      'cc',
      'appoint',
      'reassign',
      'assign',
    ].includes(name);
  const requiredReason =
    !!action?.reasonRequired ||
    [
      'reject',
      'return',
      'returnTo',
      'unable',
      'forceComplete',
      'forcePayException',
      'retryCashAsAdmin',
      'terminate',
    ].includes(name);
  const modes = useMemo(
    () =>
      Array.isArray(action?.options.modes)
        ? action.options.modes.filter(
            (v): v is string =>
              typeof v === 'string' &&
              ['before', 'after', 'alongside'].includes(v),
          )
        : [],
    [action],
  );
  const targets = useMemo(
    () =>
      Array.isArray(action?.options.targets)
        ? action.options.targets.filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    [action],
  );
  const places = useMemo(
    () =>
      Array.isArray(action?.options.unassigned)
        ? action.options.unassigned.filter(
            (v): v is { place: string; title: string | null } =>
              !!v &&
              typeof v === 'object' &&
              !Array.isArray(v) &&
              typeof v.place === 'string',
          )
        : [],
    [action],
  );
  const assignees = useMemo(
    () =>
      Array.isArray(action?.options.candidates)
        ? action.options.candidates.filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
    [action],
  );
  const amount = detail.record.amountCents;
  const validMoney = Number.isSafeInteger(amount) && amount > 0;
  const schema = useMemo(
    () =>
      z.object({
        comment: z
          .string()
          .trim()
          .max(10000, t('approvals.limit'))
          .refine((v) => !requiredReason || !!v, f('required')),
        to: z.string().refine((v) => !person || !!v, f('required')),
        mode: z
          .string()
          .refine(
            (v) => name !== 'addSigner' || modes.includes(v),
            f('required'),
          ),
        place: z
          .string()
          .refine(
            (v) =>
              name !== 'appoint' ||
              places.length <= 1 ||
              places.some((p) => p.place === v),
            f('required'),
          ),
        returnTarget: z
          .string()
          .refine(
            (v) =>
              !['return', 'returnTo'].includes(name) || targets.includes(v),
            f('required'),
          ),
        voucherNumber: z
          .string()
          .trim()
          .max(128, t('approvals.limit'))
          .refine((v) => name !== 'complete' || !!v, f('required')),
        amount: z
          .string()
          .refine((v) => !forced || parseCents(v) === amount, f('exactAmount')),
        voucherAttachments: z
          .array(z.string().min(1))
          .max(10, t('approvals.limit'))
          .refine((v) => name !== 'complete' || v.length > 0, f('required')),
      }),
    [
      f,
      t,
      requiredReason,
      person,
      name,
      modes,
      places,
      targets,
      forced,
      amount,
    ],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      comment: '',
      to: '',
      mode: modes[0] ?? '',
      place: places.length === 1 ? places[0].place : '',
      returnTarget: targets.includes('revision')
        ? 'revision'
        : targets.length === 1
          ? targets[0]
          : '',
      voucherNumber: '',
      amount: '',
      voucherAttachments: [],
    },
  });
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [pending, setPending] = useState<Values>();
  useEffect(
    () => onDirty(form.formState.isDirty || uncertain),
    [onDirty, form.formState.isDirty, uncertain],
  );
  const candidateTargetValid =
    !!action &&
    (['cc', 'appoint'].includes(name)
      ? 'runId' in action.target
      : 'taskId' in action.target);
  const unsupported =
    (!transition && !sdkActions.includes(name)) ||
    (person && name === 'assign' && !assignees.length) ||
    (person && name !== 'assign' && !candidateTargetValid) ||
    (name === 'addSigner' && !modes.length) ||
    (['return', 'returnTo'].includes(name) && !targets.length);
  const locked =
    running ||
    attachmentBusy ||
    committed ||
    conflict ||
    uncertain ||
    !allowed ||
    unsupported ||
    !validMoney;
  useEffect(
    () =>
      onBlocked?.(
        committed || conflict || uncertain || unsupported || !validMoney,
      ),
    [onBlocked, committed, conflict, uncertain, unsupported, validMoney],
  );
  async function perform(v: Values, replay = false) {
    if (
      runningRef.current ||
      attachmentBusyRef.current ||
      committed ||
      (!replay && locked) ||
      (replay && !attemptRef.current)
    )
      return;
    runningRef.current = true;
    setRunning(true);
    onBusy(true);
    setError(undefined);
    const input: Record<string, string | number | boolean | null | string[]> =
      {};
    if (['forceComplete', 'forcePayException'].includes(name)) {
      Object.assign(input, {
        voucherNumber: v.voucherNumber || null,
        confirmedCents: parseCents(v.amount)!,
      });
      if (transition) input.reason = v.comment;
    } else if (name === 'complete')
      Object.assign(input, {
        voucherNumber: v.voucherNumber,
        voucherAttachments: v.voucherAttachments,
      });
    else if (['return', 'returnTo'].includes(name)) input.to = v.returnTarget;
    else if (name === 'addSigner')
      Object.assign(input, { person: v.to, mode: v.mode });
    else if (person) {
      input.to = v.to;
      if (name === 'appoint' && v.place) input.place = v.place;
      if (name === 'reassign') input.override = false;
    }
    if (transition && ['terminate', 'retryCashAsAdmin'].includes(name))
      input.reason = v.comment;
    const body = transition
      ? { transition: name, version: detail.record.lifecycleVersion, input }
      : {
          target: action!.target,
          action: name,
          input,
          ...(v.comment ? { comment: v.comment } : {}),
          ...(action!.contentHash ? { contentHash: action!.contentHash } : {}),
        };
    const key = JSON.stringify(body);
    if (!replay && attemptRef.current?.key !== key)
      attemptRef.current = { key, requestId: createRequestId(), body };
    attemptValuesRef.current = v;
    try {
      const result = await api.request<{
        data: { record: PaymentDetail['record'] };
      }>({
        method: 'POST',
        path: `paymentRequests/${encodeURIComponent(detail.record.id)}/${transition ? 'transition' : 'action'}`,
        json: {
          ...attemptRef.current!.body,
          requestId: attemptRef.current!.requestId,
        },
      });
      parent.applyRecord(result.data.record);
      setCommitted(true);
      setUncertain(false);
      onComplete();
      form.reset(v);
      onDirty(false);
      setConfirm(false);
      parent.reload();
      parent.reloadDetail();
      toaster.show({
        type: 'success',
        title: t('paymentRequests.actionForm.completed', {
          action: f(`labels.${name}`),
          name: detail.record.number ?? t('approvals.draft'),
        }),
      });
      onBusy(false);
      await close();
    } catch (cause) {
      setError(cause);
      if (!(cause instanceof ApiClientError) || cause.status >= 500) {
        setUncertain(true);
        setConfirm(false);
      }
      if (cause instanceof ApiClientError && cause.status === 409) {
        setUncertain(false);
        setConflict(true);
        setConfirm(false);
      }
      let first: string | undefined;
      for (const field of fieldViolationsOf(cause)) {
        const mapped = field
          .replace(/^input\./, '')
          .replace('confirmedCents', 'amount')
          .replace(/^reason$/, 'comment');
        if (mapped in v) {
          form.setError(mapped as 'comment', { message: f('required') });
          first ??= mapped;
        }
      }
      if (first) form.setFocus(first as 'comment');
    } finally {
      runningRef.current = false;
      setRunning(false);
      onBusy(false);
    }
  }
  function submit(v: Values) {
    if (locked || runningRef.current) return;
    if (confirming.includes(name)) {
      setPending(v);
      setConfirm(true);
    } else return perform(v);
  }
  function latest() {
    if (running) return;
    setConflict(false);
    setError(undefined);
    setConfirm(false);
    setPending(undefined);
    reload();
  }
  const label = f(`labels.${name}`),
    recordName = detail.record.number ?? t('approvals.draft');
  const consequence = forced
    ? 'forcedConsequence'
    : name === 'complete'
      ? 'paymentConsequence'
      : ['withdraw', 'terminate'].includes(name)
        ? 'releaseConsequence'
        : ['return', 'returnTo', 'reject', 'reviseBusiness'].includes(name)
          ? 'returnConsequence'
          : name === 'unable'
            ? 'unableConsequence'
            : name === 'submit'
              ? 'submitConsequence'
              : 'genericConsequence';
  function choice(
    fieldName: 'to' | 'mode' | 'place' | 'returnTarget',
    items: { value: string; label: string }[],
    labelKey: string,
  ) {
    return (
      <Controller
        name={fieldName}
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`action-${fieldName}`}>
              {f(labelKey)} *
            </FieldLabel>
            <Select
              items={items}
              value={field.value}
              onValueChange={field.onChange}
              disabled={locked}
            >
              <SelectTrigger
                id={`action-${fieldName}`}
                className='w-full'
                ref={field.ref}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid || undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
    );
  }
  return (
    <>
      {!allowed || unsupported ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {f(unsupported ? 'unsupported' : 'unavailable')}
          </AlertDescription>
        </Alert>
      ) : null}
      {committed ? (
        <Alert>
          <AlertDescription>{f('committed')}</AlertDescription>
        </Alert>
      ) : null}
      {uncertain ? (
        <Alert variant='destructive'>
          <AlertDescription>{f('uncertain')}</AlertDescription>
          <Button
            variant='outline'
            disabled={running || committed}
            onClick={() => {
              if (attemptValuesRef.current)
                void perform(attemptValuesRef.current, true);
            }}
          >
            {f('replay')}
          </Button>
        </Alert>
      ) : null}
      {conflict ? (
        <Alert variant='destructive'>
          <AlertDescription>{f('conflict')}</AlertDescription>
          <Button variant='outline' disabled={running} onClick={latest}>
            {f('latest')}
          </Button>
        </Alert>
      ) : error && !uncertain ? (
        <ErrorState error={error} retry={latest} />
      ) : null}
      <dl className='grid grid-cols-2 gap-2 sm:grid-cols-[8rem_1fr]'>
        <dt>{f('amount')}</dt>
        <dd className='text-right'>
          {validMoney ? moneyLabel(amount, i18n.language) : '—'}
        </dd>
      </dl>
      {name === 'submit' ? (
        <p className='text-sm text-muted-foreground'>
          {f('submitConsequence')}
        </p>
      ) : null}
      <form
        id='payment-action'
        noValidate
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing)
            event.preventDefault();
        }}
      >
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.comment}>
            <FieldLabel htmlFor='action-comment'>
              {f('comment')}
              {requiredReason ? ' *' : ''}
            </FieldLabel>
            <Textarea
              id='action-comment'
              {...form.register('comment')}
              disabled={locked}
              aria-invalid={!!form.formState.errors.comment}
            />
            <FieldError errors={[form.formState.errors.comment]} />
          </Field>
          {person && name !== 'assign' && action && candidateTargetValid ? (
            <Controller
              name='to'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='action-to'>{f('person')} *</FieldLabel>
                  <ApprovalRecipientPicker
                    id='action-to'
                    requestPath='paymentRequests'
                    focusRef={field.ref}
                    onBlur={field.onBlur}
                    invalid={fieldState.invalid}
                    recordId={detail.record.id}
                    target={action.target}
                    action={name}
                    value={field.value}
                    onChange={field.onChange}
                    disabled={locked}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : name === 'assign' ? (
            choice(
              'to',
              assignees.map((id) => ({
                value: id,
                label:
                  detail.users.find((p) => p.id === id)?.name ??
                  t('approvals.unknownPerson'),
              })),
              'person',
            )
          ) : null}
          {name === 'addSigner'
            ? choice(
                'mode',
                modes.map((value) => ({ value, label: f(value) })),
                'mode',
              )
            : null}
          {name === 'appoint' && places.length > 1
            ? choice(
                'place',
                places.map((p) => ({
                  value: p.place,
                  label: p.title ?? p.place,
                })),
                'place',
              )
            : null}
          {['return', 'returnTo'].includes(name)
            ? choice(
                'returnTarget',
                targets.map((value) => ({
                  value,
                  label: value === 'revision' ? f('revision') : value,
                })),
                'returnTarget',
              )
            : null}
          {name === 'complete' || forced ? (
            <Field data-invalid={!!form.formState.errors.voucherNumber}>
              <FieldLabel htmlFor='action-voucher'>
                {f('voucher')}
                {name === 'complete' ? ' *' : ''}
              </FieldLabel>
              <Input
                id='action-voucher'
                {...form.register('voucherNumber')}
                disabled={locked}
                aria-invalid={!!form.formState.errors.voucherNumber}
              />
              {forced ? (
                <FieldDescription>{f('voucherHint')}</FieldDescription>
              ) : null}
              <FieldError errors={[form.formState.errors.voucherNumber]} />
            </Field>
          ) : null}
          {name === 'complete' ? (
            <Controller
              name='voucherAttachments'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='action-attachments'>
                    {f('voucherAttachments')} *
                  </FieldLabel>
                  <PaymentAttachmentEditor
                    id='action-attachments'
                    focusRef={field.ref}
                    invalid={fieldState.invalid}
                    recordId={detail.record.id}
                    ids={field.value}
                    onChange={field.onChange}
                    ensureDraft={async () => detail.record.id}
                    purpose='voucher'
                    disabled={locked}
                    onBusyChange={(value) => {
                      attachmentBusyRef.current = value;
                      setAttachmentBusy(value);
                      onBusy(value);
                    }}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : null}
          {forced ? (
            <Field data-invalid={!!form.formState.errors.amount}>
              <FieldLabel htmlFor='action-amount'>
                {f('amountConfirm')} *
              </FieldLabel>
              <Input
                id='action-amount'
                inputMode='decimal'
                {...form.register('amount')}
                disabled={locked}
                aria-invalid={!!form.formState.errors.amount}
              />
              <FieldError errors={[form.formState.errors.amount]} />
            </Field>
          ) : null}
        </FieldGroup>
      </form>
      <AlertDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!running) setConfirm(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('paymentRequests.actionForm.title', {
                action: label,
                name: recordName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('paymentRequests.actionForm.confirmDescription', {
                name: recordName,
                amount: validMoney ? moneyLabel(amount, i18n.language) : '—',
                consequence: f(consequence),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? <ErrorState error={error} retry={latest} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>
              {t('approvals.cancel')}
            </AlertDialogCancel>
            <Button
              variant={
                ['submit', 'complete'].includes(name)
                  ? 'default'
                  : 'destructive'
              }
              disabled={locked || !pending}
              onClick={() => {
                if (pending) void perform(pending);
              }}
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
