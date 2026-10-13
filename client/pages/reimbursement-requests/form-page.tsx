import { useRouteFormCloseGuard } from '#hooks/use-route-form-close-guard';
import { UserName } from '#components/user-name';
import { useRequestFormSubmission } from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiClientError,
  useApiClient,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { z } from 'zod';
import { format, parseISO } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteFormPage } from '#components/route-form-page';
import { DatePicker } from '#components/date-picker';
import { UserPicker } from '#components/user-picker';
import { Button } from '#components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
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
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { ErrorState } from './states.js';
import { ReimbursementAttachmentEditor } from './attachments.js';
import { parseCents, centsText, sumCents, moneyLabel } from './money.js';
import { lineAccess } from './line-access.js';
import type {
  ReimbursementDetail,
  ReimbursementRecord,
  SourceContext,
} from './types.js';
import type { FormOptions } from './types-form.js';

export default function ReimbursementFormPage() {
  const { t: drawerTitle } = useTranslation();
  const { requestId } = useParams(),
    parent = useOutletContext<SourceContext>(),
    resource = useResource<ReimbursementDetail>(
      requestId
        ? `reimbursementRequests/${encodeURIComponent(requestId)}`
        : null,
    );
  const submit = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'submit',
  }).can;
  const delegate = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'delegate',
  }).can;
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent?.reload();
  }, [resource.error, parent]);
  return (
    <RouteFormPage
      printable
      title={drawerTitle(
        requestId
          ? 'reimbursementRequests.form.edit'
          : 'reimbursementRequests.form.new',
      )}
    >
      <PageContainer>
        <BackButton />
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : requestId && !resource.data ? (
          <FieldsSkeleton fields={8} />
        ) : (
          <ReimbursementForm
            key={requestId ?? 'new'}
            detail={resource.data}
            allowed={
              requestId
                ? !!resource.data?.view.available.some(
                    (a) => a.name === 'edit' && a.allowed,
                  )
                : submit || delegate
            }
            reload={() => parent?.reload()}
          />
        )}
      </PageContainer>
    </RouteFormPage>
  );
}
export function ReimbursementForm({
  detail,
  allowed,
  reload,
}: {
  detail?: ReimbursementDetail;
  allowed: boolean;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    navigate = useNavigate(),
    location = useLocation(),
    { session } = useAuthentication();
  const delegate = useCan({
      resource: { type: 'composite', id: 'oa.reimbursement' },
      action: 'delegate',
    }).can,
    pick = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }).can;
  const [record, setRecord] = useState(detail?.record),
    [draftId, setDraftId] = useState<string>(),
    [applicant, setApplicant] = useState<{ id: string; name: string }>(),
    [discard, setDiscard] = useState(false),
    [discardConfirmed, setDiscardConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState(false),
    [latestRead, setLatestRead] = useState(false),
    [unknown, setUnknown] = useState(false);
  const cancelRequestedRef = useRef(false);
  const discardRef = useRef(false),
    busyRef = useRef(false),
    savedRef = useRef(false),
    creationRef = useRef<{ requestId: string; input: Record<string, unknown> }>(
      undefined,
    ),
    commandRef = useRef<{ key: string; requestId: string }>(undefined),
    draftPromiseRef = useRef<Promise<string>>(undefined);
  const f = useCallback(
    (key: string) => t(`reimbursementRequests.form.${key}`),
    [t],
  );
  const schema = useMemo(
    () =>
      z
        .object({
          applicantId: z.string(),
          reason: z.string().max(10000),
          authorizationId: z.string(),
          loanId: z.string(),
          offset: z
            .string()
            .refine((v) => parseCents(v) !== null, f('amountInvalid')),
          overrunReason: z.string().max(10000),
          lines: z
            .array(
              z.object({
                id: z.string().min(1),
                category: z.string().min(1, f('required')),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, f('required')),
                amount: z.string().refine((v) => {
                  const n = parseCents(v);
                  return n !== null && n > 0;
                }, f('amountInvalid')),
                invoiceNumber: z.string().trim().min(1, f('required')).max(128),
                attachmentIds: z
                  .array(z.string())
                  .min(1, f('evidenceRequired')),
                standardExceptionReason: z.string().max(10000),
              }),
            )
            .max(200, f('maxLines')),
        })
        .superRefine((v, c) => {
          const total = sumCents(v.lines.map((l) => parseCents(l.amount) ?? 0));
          if (total === null)
            c.addIssue({
              code: 'custom',
              path: ['lines'],
              message: f('amountInvalid'),
            });
          else if ((parseCents(v.offset) ?? 0) > total)
            c.addIssue({
              code: 'custom',
              path: ['offset'],
              message: f('invalid'),
            });
        }),
    [f],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      applicantId: record?.applicantId ?? session?.user.id ?? '',
      reason: record?.reason ?? '',
      authorizationId: record?.authorizationId ?? '',
      loanId: record?.loanId ?? '',
      offset: centsText(record?.offsetCents ?? 0),
      overrunReason: record?.overrunReason ?? '',
      lines:
        record?.lines.map((l) => ({
          ...l,
          amount: centsText(l.amountCents),
        })) ?? [],
    },
  });
  const lines = useFieldArray({
      control: form.control,
      name: 'lines',
      keyName: 'fieldKey',
    }),
    values = useWatch({ control: form.control });
  const target = values.applicantId || session?.user.id || '',
    options = useResource<FormOptions>('reimbursementRequests/options', {
      ...(target ? { applicantId: target } : {}),
      ...(record?.id || draftId ? { recordId: record?.id ?? draftId! } : {}),
    });
  const dirty = form.formState.isDirty,
    interactionLocked = busy || uploading || !allowed || conflict || unknown,
    optionsReady = !!options.data && !options.loading && !options.error,
    paymentAccountBlocked =
      optionsReady && options.data?.paymentAccountComplete !== true,
    locked = interactionLocked || !optionsReady || paymentAccountBlocked;
  useRouteFormCloseGuard(() => {
    if (busyRef.current || uploading) return false;
    if (savedRef.current || !dirty) return true;
    cancelRequestedRef.current = true;
    setDiscardConfirmed(false);
    setDiscard(true);
    return false;
  });
  useNavigationGuard(() => {
    if (busyRef.current || uploading) return false;
    if (savedRef.current || !dirty) return true;
    if (discardRef.current) {
      discardRef.current = false;
      return true;
    }
    setDiscardConfirmed(false);
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    const revoke = () => {
      discardRef.current = false;
      setDiscardConfirmed(false);
    };
    document.addEventListener('input', revoke, true);
    document.addEventListener('change', revoke, true);
    return () => {
      document.removeEventListener('input', revoke, true);
      document.removeEventListener('change', revoke, true);
    };
  }, []);
  function resolveDiscard(allow: boolean) {
    discardRef.current = allow;
    setDiscardConfirmed(allow);
    setDiscard(false);
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false;
      if (allow)
        void navigate(
          { pathname: '..', search: location.search, hash: location.hash },
          { relative: 'route' },
        );
    }
  }
  function cancelForm() {
    if (busyRef.current || uploading) return;
    if (dirty && !savedRef.current) {
      cancelRequestedRef.current = true;
      setDiscardConfirmed(false);
      setDiscard(true);
    } else
      void navigate(
        { pathname: '..', search: location.search, hash: location.hash },
        { relative: 'route' },
      );
  }
  useEffect(() => {
    if (!dirty && !busy && !uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, uploading]);
  async function createEmpty() {
    if (draftId || record?.id) return draftId ?? record!.id;
    if (draftPromiseRef.current) return draftPromiseRef.current;
    // Persist only a valid empty draft. Partial row editors and chosen Files stay mounted until explicit save succeeds.
    creationRef.current ??= {
      requestId: createRequestId(),
      input: {
        reason: form.getValues('reason'),
        authorizationId: null,
        loanId: null,
        offsetCents: 0,
        overrunReason: '',
        lines: [],
        ...(target ? { applicantId: target } : {}),
      },
    };
    const attempt = creationRef.current;
    const pending = api
      .request<{ data: { record: ReimbursementRecord } }>({
        method: 'POST',
        path: 'reimbursementRequests',
        json: { ...attempt.input, requestId: attempt.requestId },
      })
      .then(({ data }) => {
        setDraftId(data.record.id);
        setRecord(data.record);
        setUnknown(false);
        reload();
        return data.record.id;
      })
      .catch((cause) => {
        if (!(cause instanceof ApiClientError) || cause.status >= 500)
          setUnknown(true);
        setError(cause);
        throw cause;
      })
      .finally(() => {
        draftPromiseRef.current = undefined;
      });
    draftPromiseRef.current = pending;
    return pending;
  }
  async function readLatest() {
    if (busyRef.current || uploading) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const id = record?.id ?? draftId;
      if (!id) return;
      const { data } = await api.request<{ data: ReimbursementDetail }>({
        path: `reimbursementRequests/${encodeURIComponent(id)}`,
      });
      submission.adopt(data.record);
      setRecord(data.record);
      setConflict(false);
      setLatestRead(true);
      setError(undefined);
      options.reload();
      // Keep typed text; refreshed facts revoke stale editing rights. Server still checks every retained row.
    } catch (cause) {
      setError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const submission = useRequestFormSubmission<ReimbursementRecord>({
    resource: 'reimbursementRequests',
  });
  async function save(v: Values) {
    if (busyRef.current || locked || !optionsReady) return;
    if (submission.intent.current === 'submit' && !v.reason.trim()) {
      form.setError('reason', { message: f('required') });
      form.setFocus('reason');
      return;
    }
    if (submission.intent.current === 'submit' && !v.lines.length) {
      form.setError('lines', { message: f('linesRequired') });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setLatestRead(false);
    const input = {
      reason: v.reason,
      authorizationId: v.authorizationId || null,
      loanId: v.loanId || null,
      offsetCents: parseCents(v.offset)!,
      overrunReason: v.overrunReason,
      lines: v.lines.map(({ amount, ...line }) => ({
        ...line,
        amountCents: parseCents(amount)!,
      })),
    };
    try {
      const savedRecord = await submission.save(
        { input, target },
        record,
        async (existing) => {
          let current = existing;
          if (!current) {
            const payload = {
                ...input,
                ...(target ? { applicantId: target } : {}),
              },
              key = JSON.stringify(payload);
            if (commandRef.current?.key !== key)
              commandRef.current = { key, requestId: createRequestId() };
            creationRef.current = {
              requestId: commandRef.current.requestId,
              input: payload,
            };
            const { data } = await api.request<{
              data: { record: ReimbursementRecord };
            }>({
              method: 'POST',
              path: 'reimbursementRequests',
              json: { ...payload, requestId: commandRef.current.requestId },
            });
            current = data.record;
          } else {
            const key = JSON.stringify({
              version: current.lifecycleVersion,
              input,
            });
            if (commandRef.current?.key !== key)
              commandRef.current = { key, requestId: createRequestId() };
            const { data } = await api.request<{
              data: { record: ReimbursementRecord };
            }>({
              method: 'POST',
              path: `reimbursementRequests/${encodeURIComponent(current.id)}/transition`,
              json: {
                transition: 'edit',
                version: current.lifecycleVersion,
                input,
                requestId: commandRef.current.requestId,
              },
            });
            current = data.record;
          }
          setRecord(current);
          return current;
        },
      );
      const current = await submission.finish(savedRecord);
      setRecord(current);
      form.reset(v);
      savedRef.current = true;
      reload();
      toaster.show({
        type: 'success',
        title: t(
          submission.intent.current === 'submit'
            ? 'approvals.submitted'
            : 'reimbursementRequests.form.saved',
          {
            name: current.number ?? f('draft'),
          },
        ),
      });
      busyRef.current = false;
      setBusy(false);
      if (!detail && submission.intent.current !== 'submit')
        await navigate(
          {
            pathname: location.pathname.endsWith('/newReimbursement')
              ? `../editReimbursement/${encodeURIComponent(current.id)}`
              : `../edit/${encodeURIComponent(current.id)}`,
            search: location.search,
          },
          { relative: 'route', replace: true },
        );
      else
        await navigate(
          { pathname: '..', search: location.search },
          { relative: 'route', replace: true },
        );
    } catch (cause) {
      setError(cause);
      if (cause instanceof ApiClientError && cause.status === 409)
        setConflict(true);
      if (
        !record &&
        !submission.current.current &&
        (!(cause instanceof ApiClientError) || cause.status >= 500)
      )
        setUnknown(true);
      const fields = fieldViolationsOf(cause);
      let first: string | undefined;
      for (const raw of fields) {
        const field = raw
          .replace(/\[(\d+)\]/g, '.$1')
          .replace(/amountCents/g, 'amount')
          .replace(/^offsetCents$/, 'offset');
        if (field in v || field.startsWith('lines.')) {
          form.setError(field as 'reason', { message: f('invalid') });
          first ??= field;
        }
      }
      if (first) form.setFocus(first as 'reason');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const amounts =
      values.lines?.map((l) => parseCents(l.amount ?? '') ?? 0) ?? [],
    total = sumCents(amounts),
    offset = parseCents(values.offset ?? '') ?? 0;
  function select(
    name: 'authorizationId' | 'loanId',
    choices: { value: string; label: string }[],
  ) {
    const selected = form.getValues(name);
    const items = [{ value: '', label: f('none') }, ...choices];
    if (selected && !items.some((i) => i.value === selected))
      items.push({ value: selected, label: f('retainedBinding') });
    return (
      <Controller
        name={name}
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={`reimbursement-${name}`}>
              {f(name === 'authorizationId' ? 'authorization' : 'loan')}
            </FieldLabel>
            <Select
              items={items}
              value={field.value}
              onValueChange={field.onChange}
              disabled={locked || record?.bindingCaptured || !optionsReady}
            >
              <SelectTrigger id={`reimbursement-${name}`} className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
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
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      <PageHeader
        title={f(detail ? 'edit' : 'new')}
        description={f('description')}
        actions={
          <>
            <Button
              type='button'
              variant='outline'
              disabled={busy || uploading}
              onClick={cancelForm}
            >
              {t('approvals.cancel')}
            </Button>
            <RequestFormButtons
              revision={record?.status === 'revision'}
              resource='oa.reimbursement'
              form='reimbursement-form'
              busy={busy}
              disabled={locked || !optionsReady}
            />
          </>
        }
      />
      <div className='flex max-w-4xl flex-col gap-6'>
        {!allowed ? (
          <Alert>
            <AlertDescription>{f('denied')}</AlertDescription>
          </Alert>
        ) : null}
        {conflict ? (
          <Alert variant='destructive'>
            <AlertDescription>{f('conflict')}</AlertDescription>
            <Button
              variant='outline'
              disabled={busy || uploading}
              onClick={() => void readLatest()}
            >
              {f('checkLatest')}
            </Button>
          </Alert>
        ) : unknown ? (
          <Alert variant='destructive'>
            <AlertDescription>{f('unknown')}</AlertDescription>
            <Button
              variant='outline'
              disabled={busy || uploading}
              onClick={() => {
                busyRef.current = true;
                setBusy(true);
                void createEmpty()
                  .catch(() => {})
                  .finally(() => {
                    busyRef.current = false;
                    setBusy(false);
                  });
              }}
            >
              {f('retryCreation')}
            </Button>
          </Alert>
        ) : error ? (
          <ErrorState error={error} retry={() => void readLatest()} />
        ) : null}
        {latestRead ? (
          <Alert>
            <AlertDescription>
              {f('latestRead')} {f('reloadFacts')}
            </AlertDescription>
          </Alert>
        ) : null}
        {paymentAccountBlocked ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('reimbursementRequests.errors.paymentAccountRequired')}
            </AlertDescription>
            <Button
              type='button'
              variant='outline'
              disabled={interactionLocked}
              onClick={options.reload}
            >
              {f('checkPaymentAccount')}
            </Button>
          </Alert>
        ) : null}
        {options.error ? (
          <ErrorState error={options.error} retry={options.reload} />
        ) : options.loading ? (
          <FieldsSkeleton fields={2} />
        ) : null}
        <form
          id='reimbursement-form'
          onSubmitCapture={submission.captureIntent}
          noValidate
          onSubmit={(event) => void form.handleSubmit(save)(event)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing)
              event.preventDefault();
          }}
        >
          <FieldGroup inert={submission.submitUnknown || undefined}>
            {delegate && pick && !record ? (
              <Controller
                name='applicantId'
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor='reimbursement-applicant'>
                      {f('applicant')}
                    </FieldLabel>
                    <UserPicker
                      id='reimbursement-applicant'
                      value={field.value}
                      knownUsers={
                        session?.user
                          ? [{ id: session.user.id, name: session.user.name }]
                          : []
                      }
                      onChange={(id, user) => {
                        setApplicant(user ?? undefined);
                        field.onChange(id);
                      }}
                      disabled={interactionLocked}
                    />
                  </Field>
                )}
              />
            ) : (
              <FieldDescription>
                {f('applicant')}:{' '}
                <UserName
                  name={
                    detail?.users.find((u) => u.id === target)?.name ??
                    (applicant?.id === target ? applicant.name : undefined) ??
                    (session?.user.id === target
                      ? session.user.name
                      : undefined) ??
                    '—'
                  }
                />
              </FieldDescription>
            )}
            {(['reason', 'overrunReason'] as const).map((name) => (
              <Field key={name} data-invalid={!!form.formState.errors[name]}>
                <FieldLabel htmlFor={`reimbursement-${name}`}>
                  {f(name)}
                  {name === 'reason' ? ' *' : ''}
                </FieldLabel>
                <Textarea
                  id={`reimbursement-${name}`}
                  {...form.register(name)}
                  disabled={locked}
                  aria-invalid={!!form.formState.errors[name]}
                />
                {name === 'reason' ? (
                  <FieldDescription>
                    {f('submissionRequirements')}
                  </FieldDescription>
                ) : null}
                <FieldError errors={[form.formState.errors[name]]} />
              </Field>
            ))}
            {select(
              'authorizationId',
              (options.data?.authorizations ?? []).map((a) => ({
                value: a.id,
                label: `${a.sourceReference} · ${t('reimbursementRequests.form.available', { amount: moneyLabel(a.availableCents, i18n.language) })}`,
              })),
            )}
            {select(
              'loanId',
              (options.data?.loans ?? []).map((a) => ({
                value: a.id,
                label: `${a.sourceId} · ${t('reimbursementRequests.form.available', { amount: moneyLabel(a.availableCents, i18n.language) })}`,
              })),
            )}
            {record?.bindingCaptured ? (
              <FieldDescription>{f('bound')}</FieldDescription>
            ) : null}
            <Field data-invalid={!!form.formState.errors.offset}>
              <FieldLabel htmlFor='reimbursement-offset'>
                {f('offset')} *
              </FieldLabel>
              <Input
                id='reimbursement-offset'
                inputMode='decimal'
                {...form.register('offset')}
                disabled={locked}
                aria-invalid={!!form.formState.errors.offset}
              />
              <FieldError errors={[form.formState.errors.offset]} />
            </Field>
            {lines.fields.map((line, index) => {
              const access = lineAccess(record, line.id),
                disabled = locked || !access.editable;
              const categories = (options.data?.categories ?? [])
                .filter((c) => c.active || c.code === line.category)
                .map((c) => ({
                  value: c.code,
                  label:
                    typeof c.label === 'string'
                      ? c.label
                      : (c.label?.[i18n.language] ??
                        c.label?.['zh-CN'] ??
                        c.code),
                }));
              if (
                line.category &&
                !categories.some((c) => c.value === line.category)
              )
                categories.push({ value: line.category, label: line.category });
              return (
                <Card key={line.fieldKey}>
                  <CardHeader>
                    <CardTitle>
                      {t('reimbursementRequests.form.line', {
                        number: index + 1,
                      })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup inert={submission.submitUnknown || undefined}>
                      {!access.editable ? (
                        <FieldDescription>{f('locked')}</FieldDescription>
                      ) : null}
                      <Controller
                        name={`lines.${index}.category`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={`line-${line.id}-category`}>
                              {f('category')} *
                            </FieldLabel>
                            <Select
                              items={categories}
                              value={field.value}
                              onValueChange={field.onChange}
                              disabled={disabled || !optionsReady}
                            >
                              <SelectTrigger
                                id={`line-${line.id}-category`}
                                className='w-full'
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                                {categories.map((c) => (
                                  <SelectItem key={c.value} value={c.value}>
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldDescription>
                              {f('aggregateHint')}
                            </FieldDescription>
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />
                      <Controller
                        name={`lines.${index}.date`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={`line-${line.id}-date`}>
                              {f('date')} *
                            </FieldLabel>
                            <DatePicker
                              id={`line-${line.id}-date`}
                              value={
                                field.value ? parseISO(field.value) : undefined
                              }
                              onChange={(d) =>
                                field.onChange(d ? format(d, 'yyyy-MM-dd') : '')
                              }
                              disabled={disabled}
                              locale={
                                i18n.language.startsWith('zh') ? zhCN : enUS
                              }
                            />
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />
                      {(
                        [
                          'amount',
                          'invoiceNumber',
                          'standardExceptionReason',
                        ] as const
                      ).map((name) => (
                        <Field
                          key={name}
                          data-invalid={
                            !!form.formState.errors.lines?.[index]?.[name]
                          }
                        >
                          <FieldLabel htmlFor={`line-${line.id}-${name}`}>
                            {f(name === 'invoiceNumber' ? 'invoice' : name)}
                            {name !== 'standardExceptionReason' ? ' *' : ''}
                          </FieldLabel>
                          {name === 'standardExceptionReason' ? (
                            <Textarea
                              id={`line-${line.id}-${name}`}
                              {...form.register(`lines.${index}.${name}`)}
                              disabled={disabled}
                            />
                          ) : (
                            <Input
                              id={`line-${line.id}-${name}`}
                              inputMode={
                                name === 'amount' ? 'decimal' : undefined
                              }
                              {...form.register(`lines.${index}.${name}`)}
                              disabled={disabled}
                              aria-invalid={
                                !!form.formState.errors.lines?.[index]?.[name]
                              }
                            />
                          )}
                          <FieldError
                            errors={[
                              form.formState.errors.lines?.[index]?.[name],
                            ]}
                          />
                        </Field>
                      ))}
                      <Controller
                        name={`lines.${index}.attachmentIds`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <>
                            <ReimbursementAttachmentEditor
                              id={`line-${line.id}-files`}
                              recordId={record?.id ?? draftId}
                              ids={field.value}
                              onChange={field.onChange}
                              ensureDraft={createEmpty}
                              disabled={disabled || !optionsReady}
                              onBusyChange={setUploading}
                            />
                            <FieldError errors={[fieldState.error]} />
                          </>
                        )}
                      />
                      {access.removable ? (
                        <Button
                          type='button'
                          variant='outline'
                          disabled={locked}
                          onClick={() => {
                            lines.remove(index);
                            document
                              .getElementById('reimbursement-reason')
                              ?.focus();
                          }}
                        >
                          {f('removeLine')}
                        </Button>
                      ) : null}
                    </FieldGroup>
                  </CardContent>
                </Card>
              );
            })}
            <FieldError
              errors={[
                form.formState.errors.lines?.root,
                { message: form.formState.errors.lines?.message },
              ]}
            />
            {lineAccess(record, '').addable ? (
              <Button
                type='button'
                variant='outline'
                disabled={locked || lines.fields.length >= 200}
                onClick={() =>
                  lines.append({
                    id: createRequestId(),
                    category: '',
                    date: '',
                    amount: '',
                    invoiceNumber: '',
                    attachmentIds: [],
                    standardExceptionReason: '',
                  })
                }
              >
                {f('addLine')}
              </Button>
            ) : null}
            <dl className='grid grid-cols-2 gap-2 sm:grid-cols-[8rem_1fr]'>
              <dt>{f('total')}</dt>
              <dd className='text-right'>
                {total === null ? '—' : moneyLabel(total, i18n.language)}
              </dd>
              <dt>{f('offset')}</dt>
              <dd className='text-right'>
                {moneyLabel(offset, i18n.language)}
              </dd>
              <dt>{f('net')}</dt>
              <dd className='text-right'>
                {total === null || offset > total
                  ? '—'
                  : moneyLabel(total - offset, i18n.language)}
              </dd>
            </dl>
          </FieldGroup>
        </form>
      </div>
      {discardConfirmed ? (
        <Alert>
          <AlertDescription>{f('discardConfirmed')}</AlertDescription>
        </Alert>
      ) : null}
      <AlertDialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) resolveDiscard(false);
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
            <AlertDialogCancel onClick={() => resolveDiscard(false)}>
              {t('approvals.cancel')}
            </AlertDialogCancel>
            <Button variant='destructive' onClick={() => resolveDiscard(true)}>
              {t('approvals.discardConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
