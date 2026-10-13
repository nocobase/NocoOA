import { createRequestKey } from '#lib/request-key';
import { UserName } from '#components/user-name';
import { useEffect, useRef, useState, type BaseSyntheticEvent } from 'react';
import { useForm, useWatch, Controller, type Path } from 'react-hook-form';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ApiClientError,
  useApiClient,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import {
  useCan,
  useAuthorizationRevision,
} from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { RouteFormPage } from '#components/route-form-page';
import { RouteDrawer } from '#components/route-drawer';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DateTimePicker } from '#components/date-time-picker';
import { UserPicker } from '#components/user-picker';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import { Spinner } from '#components/ui/spinner';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { OptionSelect } from './select.js';
import { AttachmentEditor } from './attachments.js';
import { useWorkResource } from './resource.js';
import { Failure, Loading } from './states.js';
import {
  resource,
  actions,
  type Item,
  type Context,
  type Envelope,
  type Source,
} from './types.js';
interface Values {
  title: string;
  description: string;
  kind: string;
  targetUserId: string;
  dutyRoleCode: string;
  dueAt: string;
  requiresConfirmation: boolean;
  attachments: string[];
  result: string;
  resultAttachments: string[];
  reason: string;
}
export default function WorkForm() {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision(),
    params = useParams();
  return (
    <Body
      key={`${session?.user.id}:${revision}:${params.workItemId ?? 'new'}:${params.action ?? 'draft'}`}
    />
  );
}
function Body() {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    navigate = useNavigate(),
    location = useLocation(),
    source = useOutletContext<Source>(),
    { workItemId, action: rawAction } = useParams();
  const action = actions.find((v) => v === rawAction),
    draft = !rawAction,
    drawer = draft || action === 'complete';
  const grant = useCan({
      resource,
      action: action ?? (workItemId ? 'edit' : 'create'),
    }),
    users = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }),
    allowed = grant.can && !grant.isPending && !grant.error;
  const r = useWorkResource<Envelope<Item>>(
      workItemId && allowed ? `workItems/${workItemId}` : null,
    ),
    ctx = useWorkResource<Envelope<Context>>(
      allowed ? 'workItems/context' : null,
    );
  const d = r.data?.data,
    zone = ctx.data?.data.timeZone;
  const form = useForm<Values>({
    mode: 'onBlur',
    defaultValues: {
      title: '',
      description: '',
      kind: 'person',
      targetUserId: '',
      dutyRoleCode: '',
      dueAt: '',
      requiresConfirmation: true,
      attachments: [],
      result: '',
      resultAttachments: [],
      reason: '',
    },
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false),
    [confirm, setConfirm] = useState(false),
    [uploading, setUploading] = useState(false);
  const busyRef = useRef(false),
    leaveRef = useRef(false),
    controllerRef = useRef(new AbortController()),
    reloadRequestedRef = useRef(false),
    hydratedRef = useRef(false),
    commandRef = useRef<{ payload: string; id: string } | undefined>(undefined);
  const watched = useWatch({ control: form.control });
  const dirty = form.formState.isDirty,
    errors = form.formState.errors,
    conflict = error instanceof ApiClientError && error.status === 409,
    terminal =
      error instanceof ApiClientError && [401, 403, 404].includes(error.status);
  const returnPath = draft
      ? source.basePath
      : (source.detailPath ?? `${source.basePath}/${workItemId}`),
    back = {
      pathname: returnPath,
      search: location.search,
      hash: location.hash,
    };
  const exit = () => {
    void navigate(back, { replace: true });
  };
  useEffect(() => {
    const c = new AbortController();
    controllerRef.current = c;
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (d && !hydratedRef.current) {
      hydratedRef.current = true;
      form.reset({
        title: d.title,
        description: d.description,
        kind: d.dutyRoleCode ? 'pool' : 'person',
        targetUserId: d.targetUserId ?? '',
        dutyRoleCode: d.dutyRoleCode ?? '',
        dueAt: d.dueAt,
        requiresConfirmation: d.requiresConfirmation,
        attachments: d.attachments,
        result: d.result ?? '',
        resultAttachments: d.resultAttachments,
        reason: '',
      });
    }
  }, [d, form]);
  useNavigationGuard(() => {
    if (busyRef.current) return false;
    if (leaveRef.current || !dirty) return true;
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    if (!dirty && !busy && !uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, uploading]);
  const eligible =
    allowed &&
    !!zone &&
    !ctx.loading &&
    !ctx.error &&
    (!workItemId ||
      (d &&
        !r.loading &&
        !r.error &&
        (draft ? d.canEdit : action && d.actions.includes(action))));
  const locked = busy || uploading || conflict || terminal || !eligible;
  const reasonActions = [
    'return',
    'block',
    'resume',
    'reassign',
    'cancel',
    'forceComplete',
  ];
  const needsReason = !!action && reasonActions.includes(action),
    needsTarget = draft || action === 'reassign';
  function focusField(key: Path<Values>) {
    form.setFocus(key);
    const ids: Partial<Record<Path<Values>, string>> = {
      dueAt: 'task-due',
      targetUserId: 'task-target',
      dutyRoleCode: 'task-role',
    };
    const id = ids[key];
    if (id) document.getElementById(id)?.focus();
  }
  useEffect(() => {
    for (const [field, id] of [
      ['dueAt', 'task-due'],
      ['targetUserId', 'task-target'],
      ['dutyRoleCode', 'task-role'],
    ] as const) {
      const element = document.getElementById(id);
      if (!element) continue;
      const errorId = `${id}-error`;
      if (errors[field]) element.setAttribute('aria-describedby', errorId);
      else element.removeAttribute('aria-describedby');
      if (field === 'dueAt') {
        const timeInput = element
          .closest('[data-slot="field"]')
          ?.querySelector('input[type="time"]');
        if (errors[field])
          timeInput?.setAttribute(
            'aria-describedby',
            `${errorId} task-due-time-policy`,
          );
        else
          timeInput?.setAttribute('aria-describedby', 'task-due-time-policy');
      }
    }
  }, [errors]);
  async function save(values: Values) {
    if (busyRef.current || locked || !zone || (!draft && !d)) return;
    const required: Path<Values>[] = [];
    if (draft) {
      if (!values.title.trim() || values.title.trim().length > 200)
        required.push('title');
      if (values.description.length > 100000) required.push('description');
      if (!values.dueAt || !Number.isFinite(Date.parse(values.dueAt)))
        required.push('dueAt');
      else if (Date.parse(values.dueAt) <= Date.now()) {
        form.setError('dueAt', { message: t('workItems.dueAtFuture') });
        focusField('dueAt');
        return;
      }
    }
    if (
      needsTarget &&
      !values[values.kind === 'pool' ? 'dutyRoleCode' : 'targetUserId']
    )
      required.push(values.kind === 'pool' ? 'dutyRoleCode' : 'targetUserId');
    if (needsReason && (!values.reason.trim() || values.reason.length > 2000))
      required.push('reason');
    if (
      action === 'complete' &&
      (!values.result.trim() || values.result.length > 100000)
    )
      required.push('result');
    if (required.length) {
      for (const key of required)
        form.setError(key, { message: t('workItems.invalid') });
      focusField(required[0]);
      return;
    }
    if (action && action !== 'complete' && !confirm) {
      setConfirm(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    const payload = draft
      ? {
          title: values.title.trim(),
          description: values.description,
          targetUserId: values.kind === 'person' ? values.targetUserId : null,
          dutyRoleCode: values.kind === 'pool' ? values.dutyRoleCode : null,
          dueAt: values.dueAt,
          requiresConfirmation: values.requiresConfirmation,
          attachments: values.attachments,
          ...(d ? { expectedVersion: d?.version ?? 0 } : {}),
        }
      : {
          expectedVersion: d?.version ?? 0,
          ...(needsReason ? { reason: values.reason.trim() } : {}),
          ...(action === 'complete' || action === 'forceComplete'
            ? {
                result: values.result.trim(),
                resultAttachments: values.resultAttachments,
              }
            : {}),
          ...(action === 'reassign'
            ? {
                targetUserId:
                  values.kind === 'person' ? values.targetUserId : null,
                dutyRoleCode:
                  values.kind === 'pool' ? values.dutyRoleCode : null,
              }
            : {}),
        };
    const fingerprint = JSON.stringify(payload);
    if (commandRef.current?.payload !== fingerprint)
      commandRef.current = { payload: fingerprint, id: createRequestKey() };
    try {
      await api.request<Envelope<Item>>({
        path: draft
          ? workItemId
            ? `workItems/${workItemId}`
            : 'workItems'
          : `workItems/${workItemId}/${action}`,
        method: draft && workItemId ? 'PATCH' : 'POST',
        json: { ...payload, requestId: commandRef.current.id },
        signal: controllerRef.current.signal,
      });
      if (controllerRef.current.signal.aborted) return;
      busyRef.current = false;
      leaveRef.current = true;
      form.reset(values);
      source.reload();
      toaster.show({ title: t('workItems.saved'), type: 'success' });
      exit();
    } catch (e) {
      if (controllerRef.current.signal.aborted) return;
      setError(e);
      for (const key of fieldViolationsOf(e))
        if (key in values)
          form.setError(key as Path<Values>, {
            message: t(
              key === 'dueAt' ? 'workItems.dueAtFuture' : 'workItems.invalid',
            ),
          });
      const key = fieldViolationsOf(e).find((k) => k in values);
      if (key) focusField(key as Path<Values>);
    } finally {
      if (!controllerRef.current.signal.aborted) {
        busyRef.current = false;
        setBusy(false);
        setConfirm(false);
      }
    }
  }
  function submit(event?: BaseSyntheticEvent) {
    void form.handleSubmit(save)(event);
  }
  const title = t(
      draft
        ? workItemId
          ? 'workItems.edit'
          : 'workItems.new'
        : action
          ? `workItems.actions.${action}`
          : 'workItems.unavailableTitle',
    ),
    formId = 'work-item-form';
  const footer = (
    <div className='flex flex-wrap gap-2'>
      <Button
        variant='outline'
        disabled={busy || uploading}
        onClick={() => {
          if (dirty) setDiscard(true);
          else exit();
        }}
      >
        {t('workItems.cancel')}
      </Button>
      {eligible && !terminal ? (
        <Button form={formId} type='submit' disabled={locked}>
          {busy ? <Spinner /> : null}
          {t(
            busy
              ? 'workItems.submitting'
              : draft
                ? 'workItems.save'
                : `workItems.actions.${action}`,
          )}
        </Button>
      ) : null}
    </div>
  );
  const body = (
    <>
      {grant.isPending || ctx.loading || (workItemId && r.loading && !d) ? (
        <Loading />
      ) : !allowed ? (
        <Failure denied error={grant.error} />
      ) : r.error || ctx.error ? (
        <Failure
          error={r.error ?? ctx.error}
          retry={() => {
            r.reload();
            ctx.reload();
          }}
        />
      ) : terminal ? (
        <Failure error={error} />
      ) : !eligible ? (
        <Failure denied />
      ) : (
        <form
          id={formId}
          onSubmit={(e) => void submit(e)}
          className='flex flex-col gap-5'
        >
          <p className='text-sm text-muted-foreground'>
            {d?.title}
            {zone ? ` · ${zone}` : ''}
          </p>
          {error ? <Failure error={error} /> : null}
          {conflict ? (
            <Button
              variant='outline'
              type='button'
              onClick={() => {
                if (dirty) {
                  reloadRequestedRef.current = true;
                  setDiscard(true);
                  return;
                }
                hydratedRef.current = false;
                setError(undefined);
                r.reload();
              }}
            >
              {t('workItems.reload')}
            </Button>
          ) : null}
          <FieldGroup>
            {draft ? (
              <>
                <Field data-invalid={!!errors.title}>
                  <FieldLabel htmlFor='task-title'>
                    {t('workItems.titleField')}
                  </FieldLabel>
                  <Input
                    id='task-title'
                    {...form.register('title', {
                      required: t('workItems.invalid'),
                      maxLength: {
                        value: 200,
                        message: t('workItems.invalid'),
                      },
                    })}
                    maxLength={200}
                    disabled={locked}
                    aria-invalid={!!errors.title}
                    aria-describedby='task-title-error'
                  />
                  <FieldError id='task-title-error' errors={[errors.title]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor='task-description'>
                    {t('workItems.descriptionField')}
                  </FieldLabel>
                  <Textarea
                    id='task-description'
                    {...form.register('description')}
                    maxLength={100000}
                    disabled={locked}
                  />
                </Field>
              </>
            ) : null}
            {needsTarget ? (
              <>
                <Controller
                  name='kind'
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor='task-kind'>
                        {t('workItems.targetKind')}
                      </FieldLabel>
                      <OptionSelect
                        id='task-kind'
                        {...field}
                        disabled={locked}
                        options={['person', 'pool'].map((v) => ({
                          value: v,
                          label: t(`workItems.${v}`),
                        }))}
                        onChange={(v) => {
                          field.onChange(v);
                          form.setValue('targetUserId', '', {
                            shouldDirty: true,
                          });
                          form.setValue('dutyRoleCode', '', {
                            shouldDirty: true,
                          });
                        }}
                      />
                    </Field>
                  )}
                />
                {watched.kind === 'person' ? (
                  <Controller
                    name='targetUserId'
                    control={form.control}
                    render={({ field }) => (
                      <Field data-invalid={!!errors.targetUserId}>
                        <FieldLabel htmlFor='task-target'>
                          {t('workItems.assignee')}
                        </FieldLabel>
                        {users.can && !users.isPending && !users.error ? (
                          <UserPicker
                            id='task-target'
                            value={field.value}
                            onChange={(v) => field.onChange(v)}
                            onBlur={field.onBlur}
                            disabled={locked}
                            invalid={!!errors.targetUserId}
                            knownUsers={d?.target ? [d.target] : []}
                          />
                        ) : (
                          <p>
                            <UserName
                              name={
                                d?.target?.name ?? t('workItems.optionsDenied')
                              }
                            />
                          </p>
                        )}
                        <FieldError
                          id='task-target-error'
                          errors={[errors.targetUserId]}
                        />
                      </Field>
                    )}
                  />
                ) : (
                  <Controller
                    name='dutyRoleCode'
                    control={form.control}
                    render={({ field }) => (
                      <Field>
                        <FieldLabel htmlFor='task-role'>
                          {t('workItems.pool')}
                        </FieldLabel>
                        {ctx.data?.data.dutyRoles ? (
                          <OptionSelect
                            id='task-role'
                            {...field}
                            disabled={locked}
                            invalid={!!errors.dutyRoleCode}
                            options={ctx.data.data.dutyRoles.map((role) => ({
                              value: role.code,
                              label:
                                typeof role.title === 'string'
                                  ? role.title
                                  : t(role.title.key, { ns: role.title.ns }),
                            }))}
                          />
                        ) : (
                          <p>{t('workItems.optionsDenied')}</p>
                        )}
                        <FieldError
                          id='task-role-error'
                          errors={[errors.dutyRoleCode]}
                        />
                      </Field>
                    )}
                  />
                )}
              </>
            ) : null}
            {draft ? (
              <>
                <Controller
                  name='dueAt'
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor='task-due'>
                        {t('workItems.dueAt')}
                      </FieldLabel>
                      {zone ? (
                        <DateTimePicker
                          id='task-due'
                          value={field.value}
                          onChange={field.onChange}
                          disabled={locked}
                          invalid={!!errors.dueAt}
                          timeZone={zone}
                          timeLabel={t('workItems.time')}
                        />
                      ) : null}
                      <FieldError id='task-due-error' errors={[errors.dueAt]} />
                    </Field>
                  )}
                />
                <Controller
                  name='requiresConfirmation'
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor='task-confirmation'>
                        <Checkbox
                          id='task-confirmation'
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={locked}
                        />
                        {t('workItems.confirmation')}
                      </FieldLabel>
                    </Field>
                  )}
                />
                <Field>
                  <FieldLabel>{t('workItems.attachments')}</FieldLabel>
                  <AttachmentEditor
                    id={workItemId}
                    ids={watched.attachments ?? []}
                    onChange={(ids) =>
                      form.setValue('attachments', ids, { shouldDirty: true })
                    }
                    disabled={locked}
                    onBusy={(v) => {
                      busyRef.current = v;
                      setUploading(v);
                    }}
                  />
                </Field>
              </>
            ) : null}
            {action === 'complete' || action === 'forceComplete' ? (
              <>
                <Field>
                  <FieldLabel htmlFor='task-result'>
                    {t('workItems.result')}
                  </FieldLabel>
                  <Textarea
                    id='task-result'
                    {...form.register('result', {
                      required:
                        action === 'complete' ? t('workItems.invalid') : false,
                      maxLength: {
                        value: 100000,
                        message: t('workItems.invalid'),
                      },
                    })}
                    maxLength={100000}
                    disabled={locked}
                    aria-invalid={!!errors.result}
                    aria-describedby='task-result-error'
                  />
                  <FieldError id='task-result-error' errors={[errors.result]} />
                </Field>
                {action === 'complete' ? (
                  <Field>
                    <FieldLabel>{t('workItems.resultAttachments')}</FieldLabel>
                    <AttachmentEditor
                      id={workItemId}
                      ids={watched.resultAttachments ?? []}
                      onChange={(ids) =>
                        form.setValue('resultAttachments', ids, {
                          shouldDirty: true,
                        })
                      }
                      disabled={locked}
                      onBusy={(v) => {
                        busyRef.current = v;
                        setUploading(v);
                      }}
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
            {needsReason ? (
              <Field>
                <FieldLabel htmlFor='task-reason'>
                  {t('workItems.reason')}
                </FieldLabel>
                <Textarea
                  id='task-reason'
                  {...form.register('reason', {
                    required: needsReason ? t('workItems.invalid') : false,
                    maxLength: { value: 2000, message: t('workItems.invalid') },
                  })}
                  maxLength={2000}
                  disabled={locked}
                  aria-invalid={!!errors.reason}
                  aria-describedby='task-reason-error'
                />
                <FieldError id='task-reason-error' errors={[errors.reason]} />
              </Field>
            ) : null}
            {action === 'reassign' ? (
              <p>{t('workItems.reassignNotice')}</p>
            ) : null}
          </FieldGroup>
        </form>
      )}
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workItems.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workItems.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('workItems.continue')}</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                if (reloadRequestedRef.current) {
                  reloadRequestedRef.current = false;
                  hydratedRef.current = false;
                  form.reset();
                  setError(undefined);
                  setDiscard(false);
                  r.reload();
                  return;
                }
                leaveRef.current = true;
                exit();
              }}
            >
              {t('workItems.leave')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {title}: {d?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`workItems.consequences.${action ?? 'dispatch'}`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('workItems.cancel')}
            </AlertDialogCancel>
            <Button
              disabled={busy}
              variant={
                ['cancel', 'forceComplete'].includes(action ?? '')
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => void submit()}
            >
              {busy ? <Spinner /> : null}
              {title}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return drawer ? (
    <RouteFormPage
      title={title}
      beforeClose={() => {
        if (busyRef.current) return false;
        if (dirty) {
          setDiscard(true);
          return false;
        }
        return true;
      }}
    >
      <PageContainer>
        <PageHeader title={title} actions={footer} />
        {body}
      </PageContainer>
    </RouteFormPage>
  ) : (
    <RouteDrawer
      title={title}
      className='sm:max-w-2xl'
      beforeClose={() => {
        if (busyRef.current) return false;
        if (dirty) {
          setDiscard(true);
          return false;
        }
        return true;
      }}
      footer={footer}
    >
      {body}
    </RouteDrawer>
  );
}
