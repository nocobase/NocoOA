import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  offeredActions,
  type OfferedAction,
} from '@nocobase/app-plugin-approval/client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
import { DatePicker } from '#components/date-picker';
import { format, parseISO } from 'date-fns';
import { usePrivateCompensation } from './private-compensation.js';
import type { DetailContext, ProbationDetail } from './types.js';
const transitions = ['submit', 'withdraw', 'terminate'];
const sdkActions = [
  'approve',
  'reject',
  'return',
  'returnTo',
  'comment',
  'read',
  'urge',
  'transfer',
  'addSigner',
  'cc',
  'claim',
  'release',
  'appoint',
  'reassign',
];
const confirming = [
  'withdraw',
  'terminate',
  'approve',
  'reject',
  'return',
  'returnTo',
];
function matching(detail: ProbationDetail, name: string, target: string) {
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
  detail: ProbationDetail,
  name: string,
  target: string,
) {
  return (
    transitions.includes(name) &&
    target === detail.record.id &&
    detail.view.available.some((a) => a.name === name && a.allowed)
  );
}
export default function ProbationActionDialog() {
  const { requestId, actionName = '', targetId = '' } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<DetailContext>();
  const resource = useResource<ProbationDetail>(
    requestId ? `probationRequests/${encodeURIComponent(requestId)}` : null,
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
    label = t(`probationRequests.actionForm.labels.${actionName}`);
  return (
    <RouteDrawer
      className={
        ['transfer', 'addSigner', 'cc', 'appoint', 'reassign'].includes(
          actionName,
        )
          ? undefined
          : 'sm:max-w-2xl'
      }
      title={t('probationRequests.actionForm.title', {
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
      <Button type='submit' form='probation-action' disabled={busy || disabled}>
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
  detail: ProbationDetail;
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
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<DetailContext>();
  const f = useCallback(
    (key: string) => t(`probationRequests.actionForm.${key}`),
    [t],
  );
  const [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState(false),
    [running, setRunning] = useState(false),
    [committed, setCommitted] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [confirm, setConfirm] = useState(false);
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
      evaluation: string;
      conclusion: string;
      deferredTo: string;
      gradeId: string;
      baseSalary: string;
    }>(undefined);
  const transition = transitionAllowed(detail, name, targetId),
    manager = name === 'approve' && action?.task?.stage === 'manager',
    hr = name === 'approve' && action?.task?.stage === 'hr',
    person = ['transfer', 'addSigner', 'cc', 'appoint', 'reassign'].includes(
      name,
    );
  const requiredReason =
    !!action?.reasonRequired ||
    ['reject', 'return', 'returnTo', 'terminate'].includes(name);
  const privateResource = usePrivateCompensation(detail.record.id, hr);
  const grades = useResource<{ id: string; title: string; active: boolean }[]>(
    hr ? 'grades/options' : null,
  );
  const gradeOptions = useMemo(
    () => grades.data?.filter((g) => g.active) ?? [],
    [grades.data],
  );
  const [privateRejected, setPrivateRejected] = useState(false);
  const privateBlocked =
    hr &&
    (privateRejected ||
      !privateResource.allowed ||
      privateResource.loading ||
      privateResource.data === undefined ||
      !!privateResource.error ||
      grades.loading ||
      !!grades.error ||
      !grades.data);
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
  const schema = useMemo(
    () =>
      z
        .object({
          comment: z
            .string()
            .trim()
            .max(10000, f('limit'))
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
          evaluation: z
            .string()
            .trim()
            .max(10000, f('limit'))
            .refine((v) => !manager || !!v, f('required')),
          conclusion: z
            .string()
            .refine(
              (v) =>
                !manager || ['regular', 'deferred', 'declined'].includes(v),
              f('required'),
            ),
          deferredTo: z.string(),
          gradeId: z
            .string()
            .refine(
              (v) => !hr || gradeOptions.some((g) => g.id === v),
              f('required'),
            ),
          baseSalary: z
            .string()
            .refine(
              (v) => !hr || /^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(v),
              f('salaryInvalid'),
            ),
        })
        .superRefine((v, ctx) => {
          if (
            manager &&
            v.conclusion === 'deferred' &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(v.deferredTo) ||
              !isValidLocalDate(v.deferredTo) ||
              v.deferredTo <= detail.record.probationEndDate)
          )
            ctx.addIssue({
              code: 'custom',
              path: ['deferredTo'],
              message: f('dateRequired'),
            });
        }),
    [
      f,
      requiredReason,
      person,
      name,
      modes,
      places,
      targets,
      manager,
      hr,
      gradeOptions,
      detail.record.probationEndDate,
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
      evaluation: '',
      conclusion: '',
      deferredTo: '',
      gradeId: '',
      baseSalary: '',
    },
  });
  const [pending, setPending] = useState<Values>();
  const privateDenied =
    privateRejected ||
    (privateResource.error instanceof ApiClientError &&
      [401, 403].includes(privateResource.error.status));
  const privateIdentity = `${detail.record.id}:${privateResource.viewer}:${privateResource.allowed}:${privateDenied}`;
  const identityRef = useRef(privateIdentity);
  useLayoutEffect(() => {
    if (identityRef.current !== privateIdentity) {
      identityRef.current = privateIdentity;
      form.resetField('gradeId');
      form.resetField('baseSalary');
      attemptRef.current = undefined;
      attemptValuesRef.current = undefined;
      setUncertain(false);
      setConfirm(false);
      setPending(undefined);
    }
  }, [privateIdentity, form]);
  const selectedConclusion = useWatch({
    control: form.control,
    name: 'conclusion',
  });
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
    (person && !candidateTargetValid) ||
    (name === 'addSigner' && !modes.length) ||
    (['return', 'returnTo'].includes(name) && !targets.length);
  const locked =
    running ||
    committed ||
    conflict ||
    uncertain ||
    !allowed ||
    unsupported ||
    privateBlocked;
  useEffect(
    () =>
      onBlocked?.(
        committed || conflict || uncertain || unsupported || privateBlocked,
      ),
    [onBlocked, committed, conflict, uncertain, unsupported, privateBlocked],
  );
  async function perform(v: Values, replay = false) {
    if (
      runningRef.current ||
      committed ||
      (hr && privateBlocked) ||
      (!replay && locked) ||
      (replay && !attemptRef.current)
    )
      return;
    runningRef.current = true;
    setRunning(true);
    onBusy(true);
    setError(undefined);
    const input: Record<string, unknown> = {};
    if (manager)
      input.data = {
        evaluation: v.evaluation,
        conclusion: v.conclusion,
        deferredTo: v.conclusion === 'deferred' ? v.deferredTo : null,
      };
    else if (['return', 'returnTo'].includes(name)) input.to = v.returnTarget;
    else if (name === 'addSigner')
      Object.assign(input, { person: v.to, mode: v.mode });
    else if (person) {
      input.to = v.to;
      if (name === 'appoint' && v.place) input.place = v.place;
      if (name === 'reassign') input.override = false;
    }
    if (transition && name === 'terminate') input.reason = v.comment;
    const body = transition
      ? { transition: name, version: detail.record.lifecycleVersion, input }
      : {
          target: action!.target,
          action: name,
          input,
          ...(hr
            ? { compensation: { gradeId: v.gradeId, baseSalary: v.baseSalary } }
            : {}),
          ...(v.comment ? { comment: v.comment } : {}),
          ...(action!.contentHash ? { contentHash: action!.contentHash } : {}),
        };
    const key = JSON.stringify(body);
    if (!replay && attemptRef.current?.key !== key)
      attemptRef.current = { key, requestId: createRequestId(), body };
    attemptValuesRef.current = v;
    try {
      const result = await api.request<{
        data: { record: ProbationDetail['record'] };
      }>({
        method: 'POST',
        path: `probationRequests/${encodeURIComponent(detail.record.id)}/${transition ? 'transition' : 'action'}`,
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
        title: t('probationRequests.actionForm.completed', {
          action: f(`labels.${name}`),
          name: detail.record.number ?? t('approvals.draft'),
        }),
      });
      onBusy(false);
      await close();
    } catch (cause) {
      setError(cause);
      if (
        cause instanceof ApiClientError &&
        [401, 403].includes(cause.status)
      ) {
        form.resetField('gradeId');
        form.resetField('baseSalary');
        attemptRef.current = undefined;
        attemptValuesRef.current = undefined;
        setUncertain(false);
        setPending(undefined);
        setPrivateRejected(true);
        setConfirm(false);
      }
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
          .replace(/^data\./, '')
          .replace(/^compensation\./, '')
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
    if (hr && !privateRejected) {
      privateResource.reload();
      grades.reload();
    }
    reload();
  }
  const label = f(`labels.${name}`),
    recordName = detail.record.number ?? t('approvals.draft');
  const consequence = ['withdraw', 'terminate'].includes(name)
    ? 'releaseConsequence'
    : ['return', 'returnTo', 'reject'].includes(name)
      ? 'returnConsequence'
      : name === 'submit'
        ? 'submitConsequence'
        : name === 'approve'
          ? 'approveConsequence'
          : 'genericConsequence';
  function choice(
    fieldName:
      'to' | 'mode' | 'place' | 'returnTarget' | 'conclusion' | 'gradeId',
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
            disabled={running || committed || (hr && privateBlocked)}
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
      {hr &&
      !privateResource.permissionPending &&
      (!privateResource.allowed || privateRejected) ? (
        <Alert variant='destructive'>
          <AlertDescription>{f('privateDenied')}</AlertDescription>
        </Alert>
      ) : null}
      {hr && (privateResource.loading || privateResource.permissionPending) ? (
        <FieldsSkeleton fields={2} />
      ) : null}
      {hr && privateResource.error ? (
        <ErrorState
          error={privateResource.error}
          retry={privateResource.reload}
        />
      ) : null}
      {hr && grades.error ? (
        <ErrorState error={grades.error} retry={grades.reload} />
      ) : null}
      {name === 'submit' ? (
        <p className='text-sm text-muted-foreground'>
          {f('submitConsequence')}
        </p>
      ) : null}
      <form
        id='probation-action'
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
          {person && action && candidateTargetValid ? (
            <Controller
              name='to'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='action-to'>{f('person')} *</FieldLabel>
                  <ApprovalRecipientPicker
                    id='action-to'
                    requestPath='probationRequests'
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
          {manager ? (
            <>
              <Field data-invalid={!!form.formState.errors.evaluation}>
                <FieldLabel htmlFor='action-evaluation'>
                  {f('evaluation')} *
                </FieldLabel>
                <Textarea
                  id='action-evaluation'
                  {...form.register('evaluation')}
                  disabled={locked}
                  aria-invalid={!!form.formState.errors.evaluation}
                />
                <FieldError errors={[form.formState.errors.evaluation]} />
              </Field>
              {choice(
                'conclusion',
                ['regular', 'deferred', 'declined'].map((value) => ({
                  value,
                  label: f(value),
                })),
                'conclusion',
              )}
              {selectedConclusion === 'deferred' ? (
                <Controller
                  name='deferredTo'
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor='action-deferredTo'>
                        {f('deferredTo')} *
                      </FieldLabel>
                      <div
                        ref={(node) => field.ref(node?.querySelector('button'))}
                      >
                        <DatePicker
                          id='action-deferredTo'
                          value={
                            field.value ? parseISO(field.value) : undefined
                          }
                          onChange={(date) =>
                            field.onChange(
                              date ? format(date, 'yyyy-MM-dd') : '',
                            )
                          }
                          invalid={fieldState.invalid}
                          onBlur={field.onBlur}
                          disabled={locked}
                          className='w-full'
                          disabledDays={{
                            before: parseISO(
                              nextLocalDate(detail.record.probationEndDate),
                            ),
                          }}
                        />
                      </div>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ) : null}
            </>
          ) : null}
          {hr && privateResource.allowed && !privateDenied ? (
            <>
              {choice(
                'gradeId',
                gradeOptions.map((g) => ({ value: g.id, label: g.title })),
                'grade',
              )}
              <Field data-invalid={!!form.formState.errors.baseSalary}>
                <FieldLabel htmlFor='action-baseSalary'>
                  {f('baseSalary')} *
                </FieldLabel>
                <Input
                  id='action-baseSalary'
                  inputMode='decimal'
                  {...form.register('baseSalary')}
                  disabled={locked}
                  aria-invalid={!!form.formState.errors.baseSalary}
                />
                <FieldError errors={[form.formState.errors.baseSalary]} />
              </Field>
            </>
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
              {t('probationRequests.actionForm.title', {
                action: label,
                name: recordName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('probationRequests.actionForm.confirmDescription', {
                name: recordName,
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

function isValidLocalDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
function nextLocalDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
