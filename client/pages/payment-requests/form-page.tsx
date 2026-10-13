import { createPortal } from 'react-dom';
import { DrawerFormFooterContext } from '#components/drawer-form-context';
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
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteFormPage } from '#components/route-form-page';
import { StatusBadge } from '#components/status-badge';
import { UserPicker } from '#components/user-picker';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
  FieldDescription,
} from '#components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { FieldsSkeleton } from '../platform/shared/states.js';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { PaymentAttachmentEditor } from './attachments.js';
import { ErrorState } from './states.js';
import { moneyLabel } from './money.js';
import {
  availableMoney,
  emptyPaymentInput,
  paymentDefaults,
  paymentFormSchema,
  paymentInput,
} from './form-model.js';
import type { PaymentFormValues } from './form-model.js';
import type {
  PaymentDetail,
  PaymentOptions,
  PaymentRecord,
  SourceContext,
} from './types.js';
export default function PaymentFormPage() {
  const { t: drawerTitle } = useTranslation();
  const params = useParams(),
    id = params.requestId ?? params.id;
  const parent = useOutletContext<SourceContext>();
  const { session } = useAuthentication();
  const resource = useResource<PaymentDetail>(
    id ? `paymentRequests/${encodeURIComponent(id)}` : null,
    { viewer: session?.user.id ?? '' },
  );
  const submit = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'submit',
  });
  const delegate = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'delegate',
  });
  const permissionPending = submit.isPending || delegate.isPending;
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  if (!permissionPending && !permissionsLoaded) setPermissionsLoaded(true);
  return (
    <RouteFormPage
      printable
      title={drawerTitle(
        id ? 'paymentRequestsForm.edit' : 'paymentRequestsForm.new',
      )}
    >
      <PageContainer>
        <BackButton />
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : (id && !resource.data) ||
          (!permissionsLoaded && permissionPending) ? (
          <FieldsSkeleton fields={8} />
        ) : (
          <PaymentForm
            key={`${id ?? 'new'}:${session?.user.id ?? ''}`}
            detail={resource.data}
            allowed={
              !permissionPending &&
              (id
                ? !!resource.data?.view.available.some(
                    (a) => a.name === 'edit' && a.allowed,
                  ) &&
                  (resource.data.record.applicantId === session?.user.id
                    ? submit.can
                    : delegate.can)
                : submit.can || delegate.can)
            }
            reload={() => parent?.reload()}
          />
        )}
      </PageContainer>
    </RouteFormPage>
  );
}
export function PaymentForm({
  detail,
  allowed,
  reload,
}: {
  detail?: PaymentDetail;
  allowed: boolean;
  reload: () => void;
}) {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    navigate = useNavigate(),
    location = useLocation(),
    { session } = useAuthentication();
  const f = useCallback((key: string) => t(`paymentRequestsForm.${key}`), [t]);
  const schema = useMemo(() => paymentFormSchema(f), [f]);
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: paymentDefaults(detail?.record, session?.user.id),
  });
  const values = useWatch({ control: form.control });
  const [record, setRecord] = useState(detail?.record),
    [latestOffer, setLatestOffer] = useState<boolean>(),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<unknown>(),
    [conflict, setConflict] = useState(false),
    [unknown, setUnknown] = useState(false),
    [latest, setLatest] = useState(false),
    [discard, setDiscard] = useState(false),
    [leaveReady, setLeaveReady] = useState(false);
  const busyRef = useRef(false),
    savedRef = useRef(false),
    leaveRef = useRef(false);
  const commandRef = useRef<{
    path: string;
    json: Record<string, unknown>;
    kind: 'empty' | 'save';
  }>(undefined);
  const draftPromiseRef = useRef<Promise<string>>(undefined);
  const delegate = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'delegate',
  }).can;
  const userRead = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const target = values.applicantId ?? session?.user.id ?? '';
  const options = useResource<PaymentOptions>('paymentRequests/options', {
    ...(target ? { applicantId: target } : {}),
    ...(record ? { recordId: record.id } : {}),
  });
  const optionsReady = !!options.data && !options.loading && !options.error;
  const offered = allowed && (latestOffer ?? true);
  const locked =
    busy || uploading || conflict || unknown || !offered || !optionsReady;
  const dirty = form.formState.isDirty;
  useNavigationGuard(() => {
    if (busyRef.current || uploading) return false;
    if (unknown) return false;
    if (savedRef.current || !dirty) return true;
    if (leaveRef.current) {
      leaveRef.current = false;
      return true;
    }
    setDiscard(true);
    setLeaveReady(false);
    return false;
  });
  useEffect(() => {
    const revoke = () => {
      leaveRef.current = false;
      setLeaveReady(false);
    };
    document.addEventListener('input', revoke, true);
    document.addEventListener('change', revoke, true);
    return () => {
      document.removeEventListener('input', revoke, true);
      document.removeEventListener('change', revoke, true);
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy && !uploading && !unknown) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy, uploading, unknown]);
  function working(v: boolean) {
    busyRef.current = v;
    setBusy(v);
  }
  function failure(cause: unknown) {
    setError(cause);
    if (cause instanceof ApiClientError && cause.status < 500)
      setUnknown(false);
    if (cause instanceof ApiClientError && cause.status === 409)
      setConflict(true);
    if (!(cause instanceof ApiClientError) || cause.status >= 500)
      setUnknown(true);
    const names = fieldViolationsOf(cause);
    let first: keyof PaymentFormValues | undefined;
    for (const name of names) {
      const field =
        name === 'amountCents' ? 'amount' : (name as keyof PaymentFormValues);
      if (field in form.getValues()) {
        form.setError(field, { type: 'server', message: f('invalid') });
        first ??= field;
      }
    }
    if (first) form.setFocus(first);
  }
  async function execute(attempt: NonNullable<typeof commandRef.current>) {
    const { data } = await api.request<{ data: { record: PaymentRecord } }>({
      method: 'POST',
      path: attempt.path,
      json: attempt.json,
    });
    setRecord(data.record);
    setUnknown(false);
    setConflict(false);
    reload();
    return data.record;
  }
  async function ensureDraft(): Promise<string> {
    if (record) return record.id;
    if (draftPromiseRef.current) return draftPromiseRef.current;
    if (unknown) throw new Error('Unconfirmed creation');
    commandRef.current = {
      path: 'paymentRequests',
      json: {
        ...emptyPaymentInput,
        applicantId: target,
        requestId: createRequestId(),
      },
      kind: 'empty',
    };
    const attempt = commandRef.current;
    const pending = execute(attempt)
      .then((r) => r.id)
      .catch((cause) => {
        failure(cause);
        throw cause;
      })
      .finally(() => {
        draftPromiseRef.current = undefined;
      });
    draftPromiseRef.current = pending;
    return pending;
  }
  const submission = useRequestFormSubmission<PaymentRecord>({
    replayUnknownCreate: true,
    resource: 'paymentRequests',
  });
  async function save(v: PaymentFormValues) {
    if (busyRef.current || locked) return;
    const input = paymentInput(v);
    if (submission.intent.current === 'submit') {
      const required: (keyof PaymentFormValues)[] = [];
      if (!v.reason.trim()) required.push('reason');
      if (v.sourceMode === 'purchase' && !v.purchaseOrderId)
        required.push('purchaseOrderId');
      if (v.sourceMode === 'contract' && !v.contractId)
        required.push('contractId');
      if (v.sourceMode === 'none' && !v.noPriorApprovalReason.trim())
        required.push('noPriorApprovalReason');
      if (v.sourceMode !== 'contract' && !v.vendorId) required.push('vendorId');
      if (input.amountCents <= 0) required.push('amount');
      if (!v.invoiceNumber.trim()) required.push('invoiceNumber');
      if (!v.attachments.length) required.push('attachments');
      if (
        !options.data?.paymentMethods.some(
          (method) => method.code === v.paymentMethod && method.active,
        )
      )
        required.push('paymentMethod');
      for (const name of required)
        form.setError(name, { message: f('required') });
      if (required.length) {
        document.getElementById(`payment-${required[0]}`)?.focus();
        return;
      }
    }
    working(true);
    setError(undefined);
    setLatest(false);
    try {
      const base = submission.current.current ?? record;
      const attempt: NonNullable<typeof commandRef.current> = base
        ? {
            path: `paymentRequests/${encodeURIComponent(base.id)}/transition`,
            json: {
              transition: 'edit',
              version: base.lifecycleVersion,
              input,
              requestId: createRequestId(),
            },
            kind: 'save',
          }
        : {
            path: 'paymentRequests',
            json: {
              ...input,
              applicantId: target,
              requestId: createRequestId(),
            },
            kind: 'save',
          };
      const savedRecord = await submission.save(
        { input, target },
        record,
        async () => {
          commandRef.current = attempt;
          return execute(attempt);
        },
      );
      const completed = await submission.finish(savedRecord);
      setRecord(completed);
      form.reset(v);
      savedRef.current = true;
      toaster.show({
        type: 'success',
        title:
          submission.intent.current === 'submit'
            ? t('approvals.submitted', {
                name:
                  submission.current.current?.number ?? t('approvals.draft'),
              })
            : f('saved'),
      });
      working(false);
      await navigate(
        { pathname: '..', search: location.search, hash: location.hash },
        { relative: 'route', replace: true },
      );
    } catch (cause) {
      if (submission.current.current) setError(cause);
      else failure(cause);
    } finally {
      working(false);
    }
  }
  async function replay() {
    if (busyRef.current || uploading || !unknown || !commandRef.current) return;
    working(true);
    setError(undefined);
    try {
      const attempt = commandRef.current;
      await execute(attempt);
      if (attempt.kind === 'save') {
        form.reset(form.getValues());
        savedRef.current = true;
        toaster.show({
          type: 'success',
          title:
            submission.intent.current === 'submit'
              ? t('approvals.submitted', {
                  name:
                    submission.current.current?.number ?? t('approvals.draft'),
                })
              : f('saved'),
        });
        working(false);
        await navigate(
          { pathname: '..', search: location.search, hash: location.hash },
          { relative: 'route', replace: true },
        );
      }
    } catch (cause) {
      failure(cause);
    } finally {
      working(false);
    }
  }
  async function readLatest() {
    if (busyRef.current || uploading || !record) return;
    working(true);
    try {
      const { data } = await api.request<{ data: PaymentDetail }>({
        path: `paymentRequests/${encodeURIComponent(record.id)}`,
      });
      submission.adopt(data.record);
      setRecord(data.record);
      setLatestOffer(
        data.view.available.some((a) => a.name === 'edit' && a.allowed),
      );
      setConflict(false);
      setLatest(true);
      setError(undefined);
      options.reload();
    } catch (cause) {
      setError(cause);
    } finally {
      working(false);
    }
  }
  function selectField(
    name:
      | 'sourceMode'
      | 'purchaseOrderId'
      | 'contractId'
      | 'vendorId'
      | 'paymentMethod',
    items: { value: string; label: string; disabled?: boolean }[],
  ) {
    const value = form.getValues(name);
    const display =
      items.some((x) => x.value === value) || !value
        ? items
        : [
            ...items,
            { value, label: `${value} — ${f('inactive')}`, disabled: true },
          ];
    return (
      <Controller
        control={form.control}
        name={name}
        render={({ field, fieldState }) => (
          <Field data-invalid={!!fieldState.error}>
            <FieldLabel htmlFor={`payment-${name}`}>{f(name)} *</FieldLabel>
            <Select
              items={display}
              value={field.value || null}
              disabled={locked}
              onValueChange={(v) => {
                field.onChange(v ?? '');
                if (name === 'sourceMode') {
                  form.setValue('purchaseOrderId', '', { shouldDirty: true });
                  form.setValue('contractId', '', { shouldDirty: true });
                  form.setValue('contractVersion', null, { shouldDirty: true });
                  form.setValue('vendorId', '', { shouldDirty: true });
                }
                if (name === 'contractId') {
                  const contract = options.data?.contracts?.find(
                    (c) => c.id === v,
                  );
                  form.setValue('contractVersion', contract?.version ?? null, {
                    shouldDirty: true,
                  });
                  form.setValue(
                    'vendorId',
                    contract?.counterparty.kind === 'vendor'
                      ? contract.counterparty.id
                      : '',
                    { shouldDirty: true },
                  );
                }
                if (name === 'purchaseOrderId') {
                  const order = options.data?.orders.find((o) => o.id === v);
                  form.setValue('vendorId', order?.vendor.id ?? '', {
                    shouldDirty: true,
                  });
                }
              }}
            >
              <SelectTrigger
                id={`payment-${name}`}
                ref={field.ref}
                onBlur={field.onBlur}
                aria-invalid={!!fieldState.error}
                className='w-full'
              >
                <SelectValue placeholder={f('select')} />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                {display.map((x) => (
                  <SelectItem
                    key={x.value}
                    value={x.value}
                    disabled={x.disabled}
                    className='whitespace-normal break-words'
                  >
                    {x.label}
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
  const selectedOrder = options.data?.orders.find(
    (o) => o.id === values.purchaseOrderId,
  );
  return (
    <>
      <PageHeader
        title={f(detail ? 'edit' : 'new')}
        description={f('description')}
      />
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      <form
        id='payment-form'
        onSubmitCapture={submission.captureIntent}
        className='flex flex-col gap-6'
        onSubmit={(e) => {
          void form.handleSubmit(save)(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.nativeEvent.isComposing)
            e.preventDefault();
        }}
      >
        {!offered ? (
          <Alert>
            <AlertDescription>{f('notEditable')}</AlertDescription>
          </Alert>
        ) : null}
        {error && !unknown ? (
          <ErrorState
            error={error}
            retry={
              conflict
                ? () => void readLatest()
                : unknown
                  ? () => void replay()
                  : () => setError(undefined)
            }
          />
        ) : null}
        {unknown ? (
          <Alert>
            <AlertDescription>{f('unknown')}</AlertDescription>
            <Button
              type='button'
              variant='outline'
              disabled={busy || uploading}
              onClick={() => void replay()}
            >
              {f('replay')}
            </Button>
          </Alert>
        ) : null}
        {latest ? (
          <Alert>
            <AlertDescription>{f('latest')}</AlertDescription>
          </Alert>
        ) : null}
        {leaveReady ? (
          <Alert>
            <AlertDescription>{f('leaveReady')}</AlertDescription>
          </Alert>
        ) : null}
        {options.error ? (
          <ErrorState error={options.error} retry={options.reload} />
        ) : options.loading ? (
          <FieldsSkeleton fields={2} />
        ) : null}
        <FieldGroup inert={submission.submitUnknown || undefined}>
          {delegate && !record ? (
            <Controller
              control={form.control}
              name='applicantId'
              render={({ field, fieldState }) => (
                <Field data-invalid={!!fieldState.error}>
                  <FieldLabel htmlFor='payment-applicant'>
                    {f('applicantId')} *
                  </FieldLabel>
                  <UserPicker
                    id='payment-applicant'
                    value={field.value}
                    disabled={
                      busy ||
                      uploading ||
                      conflict ||
                      unknown ||
                      !offered ||
                      !userRead
                    }
                    knownUsers={[
                      ...(options.data?.applicant
                        ? [options.data.applicant]
                        : []),
                      ...(session?.user
                        ? [{ id: session.user.id, name: session.user.name }]
                        : []),
                    ]}
                    onChange={(v) => {
                      field.onChange(v);
                      form.setValue('purchaseOrderId', '', {
                        shouldDirty: true,
                      });
                      form.setValue('vendorId', '', { shouldDirty: true });
                    }}
                    invalid={!!fieldState.error}
                  />
                  {!userRead ? (
                    <FieldDescription>{f('peopleDenied')}</FieldDescription>
                  ) : null}
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : (
            <p className='text-sm'>
              {f('applicantId')}:{' '}
              <UserName
                name={
                  options.data?.applicant?.name ??
                  detail?.users.find((u) => u.id === target)?.name ??
                  session?.user.name ??
                  '—'
                }
              />
            </p>
          )}
          <Field data-invalid={!!form.formState.errors.reason}>
            <FieldLabel htmlFor='payment-reason'>{f('reason')} *</FieldLabel>
            <Textarea
              id='payment-reason'
              disabled={locked}
              aria-invalid={!!form.formState.errors.reason}
              {...form.register('reason')}
            />
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          {selectField('sourceMode', [
            { value: 'purchase', label: f('purchase') },
            ...(options.data?.contracts?.length ||
            values.sourceMode === 'contract'
              ? [{ value: 'contract', label: f('contract') }]
              : []),
            { value: 'none', label: f('none') },
          ])}
          {values.sourceMode === 'purchase' ? (
            <>
              {selectField(
                'purchaseOrderId',
                (options.data?.orders ?? []).map((o) => ({
                  value: o.id,
                  label: `${o.number} · ${o.vendor.name} · ${moneyLabel(o.actualCents, i18n.language)}`,
                })),
              )}
              {selectedOrder ? (
                <dl className='grid gap-2 sm:grid-cols-2'>
                  <div>
                    <dt className='text-sm text-muted-foreground'>
                      {f('orderStatus')}
                    </dt>
                    <dd>
                      <StatusBadge
                        tone={
                          selectedOrder.status === 'accepted'
                            ? 'success'
                            : selectedOrder.status === 'awaitingReceipt'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {t(`purchases.orderStates.${selectedOrder.status}`)}
                      </StatusBadge>
                    </dd>
                  </div>
                  {[
                    ['approved', selectedOrder.actualCents],
                    ['paid', selectedOrder.paidCents],
                    ['pending', selectedOrder.pendingCents],
                  ].map(([k, n]) => (
                    <div key={k}>
                      <dt className='text-sm text-muted-foreground'>
                        {f(String(k))}
                      </dt>
                      <dd>{moneyLabel(Number(n), i18n.language)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className='text-sm text-muted-foreground'>
                      {f('available')}
                    </dt>
                    <dd>
                      {availableMoney(
                        selectedOrder.actualCents,
                        selectedOrder.paidCents,
                        selectedOrder.pendingCents,
                        i18n.language,
                      )}
                    </dd>
                  </div>
                </dl>
              ) : null}
              <FieldDescription>{f('overApproval')}</FieldDescription>
            </>
          ) : values.sourceMode === 'contract' ? (
            <>
              {selectField(
                'contractId',
                (options.data?.contracts ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.number ?? c.id} · v${c.version} · ${c.counterparty.name} · ${moneyLabel(c.amountCents, i18n.language)}`,
                })),
              )}
              <p className='text-sm'>
                {f('counterparty')}:{' '}
                {options.data?.contracts?.find(
                  (c) => c.id === values.contractId,
                )?.counterparty.name ??
                  (typeof record?.vendorSnapshot?.name === 'string'
                    ? record.vendorSnapshot.name
                    : '—')}
              </p>
              <p className='text-sm'>
                {f('contractVersion')}: {values.contractVersion ?? '—'}
              </p>
              {options.data?.contracts
                ?.filter((c) => c.id === values.contractId)
                .map((c) => (
                  <dl key={c.id} className='grid gap-2 sm:grid-cols-2'>
                    {[
                      [f('approved'), c.amountCents],
                      [f('paid'), c.paidCents],
                      [f('pending'), c.heldCents],
                    ].map(([label, cents]) => (
                      <div key={String(label)}>
                        <dt className='text-sm text-muted-foreground'>
                          {label}
                        </dt>
                        <dd className='text-sm'>
                          {moneyLabel(Number(cents), i18n.language)}
                        </dd>
                      </div>
                    ))}
                    <div>
                      <dt className='text-sm text-muted-foreground'>
                        {f('available')}
                      </dt>
                      <dd className='text-sm'>
                        {availableMoney(
                          c.amountCents,
                          c.paidCents,
                          c.heldCents,
                          i18n.language,
                        )}
                      </dd>
                    </div>
                  </dl>
                ))}
              <FieldDescription>{f('overApproval')}</FieldDescription>
              <FieldDescription>{f('customerAccountHint')}</FieldDescription>
            </>
          ) : (
            <Field data-invalid={!!form.formState.errors.noPriorApprovalReason}>
              <FieldLabel htmlFor='payment-no-prior'>
                {f('noPriorApprovalReason')}
              </FieldLabel>
              <Textarea
                id='payment-no-prior'
                disabled={locked}
                {...form.register('noPriorApprovalReason')}
              />
              <FieldError
                errors={[form.formState.errors.noPriorApprovalReason]}
              />
            </Field>
          )}
          {values.sourceMode !== 'contract' &&
            selectField(
              'vendorId',
              (options.data?.vendors ?? []).map((v) => ({
                value: v.id,
                label: v.name,
                disabled: !v.active,
              })),
            )}
          {(['amount', 'invoiceNumber'] as const).map((name) => (
            <Field key={name} data-invalid={!!form.formState.errors[name]}>
              <FieldLabel htmlFor={`payment-${name}`}>
                {f(name)}
                {' *'}
              </FieldLabel>
              <Input
                id={`payment-${name}`}
                disabled={locked}
                inputMode={name === 'amount' ? 'decimal' : undefined}
                aria-invalid={!!form.formState.errors[name]}
                {...form.register(name)}
              />
              <FieldError errors={[form.formState.errors[name]]} />
            </Field>
          ))}
          {selectField(
            'paymentMethod',
            (options.data?.paymentMethods ?? []).map((m) => ({
              value: m.code,
              label:
                m.label[i18n.language] ??
                m.label['zh-CN'] ??
                m.label['en-US'] ??
                m.code,
              disabled: !m.active,
            })),
          )}
          <Controller
            control={form.control}
            name='attachments'
            render={({ field, fieldState }) => (
              <>
                <PaymentAttachmentEditor
                  invalid={!!fieldState.error}
                  focusRef={field.ref}
                  id='payment-attachments'
                  recordId={record?.id}
                  ids={field.value}
                  onChange={field.onChange}
                  ensureDraft={ensureDraft}
                  disabled={locked}
                  onBusyChange={setUploading}
                />
                <FieldError errors={[fieldState.error]} />
              </>
            )}
          />
          <FieldDescription>{f('frozenHint')}</FieldDescription>
        </FieldGroup>
        <PaymentFormFooter>
          <Button
            type='button'
            variant='outline'
            disabled={busy || uploading || unknown}
            onClick={() =>
              void navigate(
                {
                  pathname: '..',
                  search: location.search,
                  hash: location.hash,
                },
                { relative: 'route', replace: true },
              )
            }
          >
            {t('approvals.cancel')}
          </Button>
          <RequestFormButtons
            revision={record?.status === 'revision'}
            resource='oa.payment'
            form='payment-form'
            busy={busy}
            disabled={locked}
          />
        </PaymentFormFooter>
      </form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
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
                leaveRef.current = true;
                setLeaveReady(true);
                setDiscard(false);
              }}
            >
              {t('approvals.discardConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Keep record form actions reachable while the long contract source form scrolls. */
function PaymentFormFooter({ children }: { children: ReactNode }) {
  const target = useContext(DrawerFormFooterContext);
  const content = <div className='flex justify-end gap-2'>{children}</div>;
  return target ? createPortal(content, target) : content;
}
