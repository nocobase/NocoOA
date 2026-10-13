import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { useRequestFormSubmission } from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { TravelAttachmentEditor } from './attachments.js';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  useOutletContext,
  useParams,
  useNavigate,
  useLocation,
} from 'react-router';
import { z } from 'zod';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { DateTimePicker } from '#components/date-time-picker';
import { Checkbox } from '#components/ui/checkbox';
import { parseAmountCents, amountText } from './money.js';
import type { TravelOptions } from './options.js';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { UserPicker } from '#components/user-picker';
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

import { Alert, AlertDescription } from '#components/ui/alert';

import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { ErrorState } from './states.js';
import type {
  TravelDetail,
  TravelRecord,
  SourceContext,
  DetailContext,
} from './types.js';

export default function TravelFormDialog() {
  const { t: drawerTitle } = useTranslation();
  const { requestId } = useParams();
  const { t } = useTranslation();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const parentReload = parent.reload;
  const resource = useResource<TravelDetail>(
    requestId ? `travelRequests/${encodeURIComponent(requestId)}` : null,
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [done, setDone] = useState(false);
  const canSubmit = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'submit',
  }).can;
  const canDelegate = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'delegate',
  }).can;
  const allowed = requestId
    ? resource.data?.view.available.some((a) => a.name === 'edit' && a.allowed)
    : canSubmit || canDelegate;
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parentReload();
  }, [resource.error, parentReload]);
  const closeForm = () => {
    if (busyRef.current) return;
    if (dirtyRef.current) {
      setDiscard(true);
      return;
    }
    void navigate(
      { pathname: '..', search: location.search, hash: location.hash },
      { relative: 'route', replace: true },
    );
  };
  useNavigationGuard(() => {
    if (busyRef.current) return false;
    return (
      !dirtyRef.current || window.confirm(t('approvals.discardDescription'))
    );
  });
  return (
    <RouteFormPage
      beforeClose={() => {
        closeForm();
        return false;
      }}
      printable
      title={drawerTitle(requestId ? 'travel.edit' : 'travel.new')}
    >
      <PageContainer>
        <BackButton />
        <PageHeader
          title={t(requestId ? 'travel.edit' : 'travel.new')}
          description={t('travel.formDescription')}
          actions={
            <FormFooter
              onCancel={closeForm}
              revision={resource.data?.record.status === 'revision'}
              busy={busy}
              disabled={
                done ||
                !ready ||
                !allowed ||
                resource.loading ||
                !!resource.error
              }
            />
          }
        />
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : requestId && !resource.data ? (
          <FieldsSkeleton fields={4} />
        ) : (
          <TravelForm
            key={
              resource.data
                ? `${resource.data.record.id}:${resource.data.record.lifecycleVersion}`
                : 'new'
            }
            onReady={setReady}
            detail={resource.data}
            allowed={!!allowed}
            reload={resource.reload}
            onBusy={(value) => {
              busyRef.current = value;
              setBusy(value);
            }}
            onDirty={(value) => {
              dirtyRef.current = value;
            }}
            onDone={() => setDone(true)}
          />
        )}
      </PageContainer>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
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
              disabled={busy}
              onClick={() => {
                if (busyRef.current) return;
                dirtyRef.current = false;
                setDiscard(false);
                closeForm();
              }}
            >
              {t('approvals.discardConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteFormPage>
  );
}
function FormFooter({
  onCancel,
  busy,
  disabled,
  revision,
}: {
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  revision?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={onCancel}>
        {t('approvals.cancel')}
      </Button>
      <RequestFormButtons
        revision={revision}
        resource='oa.travel'
        form='travel-form'
        busy={busy}
        disabled={disabled}
      />
    </>
  );
}
function TravelForm({
  detail,
  allowed,
  reload,
  onBusy,
  onDirty,
  onDone,
  onReady,
}: {
  detail?: TravelDetail;
  allowed: boolean;
  reload: () => void;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onDone: () => void;
  onReady: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const close = async () =>
    navigate(
      { pathname: '..', search: location.search },
      { relative: 'route', replace: true },
    );
  const { session } = useAuthentication();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const delegate = useCan({
    resource: { type: 'composite', id: 'oa.travel' },
    action: 'delegate',
  }).can;
  const pick = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const [standardApplicant, setStandardApplicant] = useState('');
  const options = useResource<TravelOptions>(
    `travelRequests/options${standardApplicant ? `?applicantId=${encodeURIComponent(standardApplicant)}` : ''}`,
  );
  useEffect(
    () => onReady(!!options.data && !options.error && !options.loading),
    [options.data, options.error, options.loading, onReady],
  );
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const runningRef = useRef(false);
  const uncertainRef = useRef(false);
  const draftRef = useRef<TravelRecord | undefined>(detail?.record);
  const [draft, setDraft] = useState<TravelRecord | undefined>(detail?.record);
  const [uploading, setUploading] = useState(false);
  const attemptRef = useRef<{ key: string; requestId: string } | null>(null);
  const submission = useRequestFormSubmission<TravelRecord>({
    resource: 'travelRequests',
  });
  const schema = useMemo(
    () =>
      z
        .object({
          applicantId: z.string(),
          destination: z
            .string()
            .trim()
            .min(1, t('approvals.required'))
            .max(255, t('approvals.limit')),
          startAt: z
            .string()
            .refine(
              (v) => Number.isFinite(Date.parse(v)),
              t('travel.dateInvalid'),
            ),
          endAt: z
            .string()
            .refine(
              (v) => Number.isFinite(Date.parse(v)),
              t('travel.dateInvalid'),
            ),
          international: z.boolean(),
          needsLoan: z.boolean(),
          needsBooking: z.boolean(),
          companionIds: z
            .array(z.string().min(1, t('approvals.required')))
            .max(20)
            .refine(
              (v) => new Set(v).size === v.length,
              t('travel.companionsInvalid'),
            ),
          attachments: z.array(z.string()).max(10),
          transport: z
            .string()
            .refine(
              (v) => parseAmountCents(v) !== null,
              t('travel.amountInvalid'),
            ),
          lodging: z
            .string()
            .refine(
              (v) => parseAmountCents(v) !== null,
              t('travel.amountInvalid'),
            ),
          allowance: z
            .string()
            .refine(
              (v) => parseAmountCents(v) !== null,
              t('travel.amountInvalid'),
            ),
          reason: z
            .string()
            .trim()
            .min(1, t('approvals.required'))
            .max(10000, t('approvals.limit')),
        })
        .refine((v) => Date.parse(v.startAt) < Date.parse(v.endAt), {
          path: ['endAt'],
          message: t('travel.dateInvalid'),
        }),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      applicantId: '',
      destination: detail?.record.destination ?? '',
      startAt: detail?.record.startAt ?? '',
      endAt: detail?.record.endAt ?? '',
      international: detail?.record.international ?? false,
      needsLoan: detail?.record.needsLoan ?? false,
      needsBooking: detail?.record.needsBooking ?? false,
      companionIds: detail?.record.companionIds ?? [],
      attachments: detail?.record.attachments ?? [],
      transport: detail ? amountText(detail.record.transportCents) : '0.00',
      lodging: detail ? amountText(detail.record.lodgingCents) : '0.00',
      allowance: detail ? amountText(detail.record.allowanceCents) : '0.00',

      reason: detail?.record.reason ?? '',
    },
  });
  useEffect(
    () => onDirty(form.formState.isDirty),
    [onDirty, form.formState.isDirty],
  );
  const manuallyTypedAmountsRef = useRef(new Set<string>());
  const startAt = useWatch({ control: form.control, name: 'startAt' });
  const endAt = useWatch({ control: form.control, name: 'endAt' });
  const selectedApplicant = useWatch({
    control: form.control,
    name: 'applicantId',
  });
  useEffect(() => {
    // New requests only: preserve explicitly typed estimates and never apply the actor's grade to a delegated employee.
    if (
      detail ||
      (selectedApplicant && options.data?.applicantId !== selectedApplicant) ||
      !options.data?.standard ||
      !startAt ||
      !endAt ||
      !(Date.parse(endAt) > Date.parse(startAt))
    )
      return;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: options.data.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dayNumber = (value: string) => {
      const parts = formatter.formatToParts(new Date(value));
      const get = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value);
      return Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000;
    };
    const nights = dayNumber(endAt) - dayNumber(startAt);
    for (const [field, key, count] of [
      ['lodging', 'lodgingPerNight', nights],
      ['allowance', 'allowancePerDay', nights + 1],
    ] as const) {
      const rawRate = options.data.standard[key];
      const rate =
        typeof rawRate === 'number' || typeof rawRate === 'string'
          ? parseAmountCents(String(rawRate))
          : null;
      if (rate === null || manuallyTypedAmountsRef.current.has(field)) continue;
      const total = BigInt(rate) * BigInt(count);
      if (total <= BigInt(Number.MAX_SAFE_INTEGER))
        form.setValue(field, amountText(Number(total)), { shouldDirty: false });
    }
  }, [detail, selectedApplicant, options.data, startAt, endAt, form]);
  async function save(values: z.infer<typeof schema>) {
    if (
      !allowed ||
      runningRef.current ||
      uncertain ||
      uploading ||
      !options.data ||
      options.error ||
      options.loading
    )
      return;
    if (
      submission.intent.current === 'submit' &&
      values.international &&
      !values.attachments.length
    ) {
      form.setError('attachments', {
        message: t('travel.businessErrors.TRAVEL_ITINERARY_REQUIRED'),
      });
      requestAnimationFrame(() =>
        document.getElementById('travel-file')?.focus(),
      );
      return;
    }
    runningRef.current = true;
    onBusy(true);
    setError(undefined);
    const { applicantId, transport, lodging, allowance, ...fields } = values;
    const input = {
      ...fields,
      transportCents: parseAmountCents(transport)!,
      lodgingCents: parseAmountCents(lodging)!,
      allowanceCents: parseAmountCents(allowance)!,
    };
    const current = submission.current.current ?? draftRef.current;
    const key = JSON.stringify({
      version: current?.lifecycleVersion,
      input,
    });
    if (attemptRef.current?.key !== key)
      attemptRef.current = { key, requestId: createRequestId() };
    try {
      const draftRequestId = attemptRef.current.requestId;
      const savedRecord = await submission.save(
        { input, applicantId },
        draftRef.current,
        async (current) => {
          const result = await api.request<{
            data: { record: TravelRecord };
          }>({
            method: 'POST',
            path: current
              ? `travelRequests/${current.id}/transition`
              : 'travelRequests',
            json: current
              ? {
                  transition: 'edit',
                  version: current.lifecycleVersion,
                  requestId: draftRequestId,
                  input,
                }
              : {
                  ...input,
                  ...(delegate &&
                  pick &&
                  applicantId &&
                  applicantId !== session?.user.id
                    ? { applicantId }
                    : {}),
                },
          });
          draftRef.current = result.data.record;
          setDraft(result.data.record);
          return result.data.record;
        },
      );
      const result = { data: { record: await submission.finish(savedRecord) } };
      onDone();
      form.reset(values);
      onDirty(false);
      parent.update?.(result.data.record);
      parent.reload();
      toaster.show({
        type: 'success',
        title: t(
          submission.intent.current === 'submit'
            ? 'approvals.submitted'
            : 'approvals.saved',
          {
            name: result.data.record.number ?? t('approvals.draft'),
          },
        ),
      });
      runningRef.current = false;
      onBusy(false);
      await close();
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiClientError) {
        for (const violation of fieldViolationsOf(failure)) {
          const field = violation.endsWith('Cents')
            ? violation.slice(0, -5)
            : violation;
          if (
            [
              'destination',
              'startAt',
              'endAt',
              'transport',
              'lodging',
              'allowance',
              'reason',
              'attachments',
              'companionIds',
            ].includes(field)
          )
            form.setError(field as 'destination', {
              message: t('travel.invalid'),
            });
        }
      }
      // Create has no server idempotency contract. Never repeat an uncertain creation: the transaction may have committed.
      if (
        !draftRef.current &&
        !submission.current.current &&
        (!(failure instanceof ApiClientError) || failure.status >= 500)
      ) {
        uncertainRef.current = true;
        setUncertain(true);
        onDone();
        parent.reload();
      }
    } finally {
      runningRef.current = false;
      onBusy(false);
    }
  }
  useEffect(() => {
    if (!form.formState.isSubmitting) {
      const field = Object.keys(form.formState.errors)[0] as
        'destination' | undefined;
      if (field) form.setFocus(field);
    }
  }, [form.formState.isSubmitting, form.formState.errors, form]);
  async function ensureDraft(): Promise<string> {
    if (draftRef.current) return draftRef.current.id;
    if (
      uncertainRef.current ||
      runningRef.current ||
      !allowed ||
      !(await form.trigger())
    )
      throw new Error('Draft unavailable');
    const { applicantId, transport, lodging, allowance, ...fields } =
      form.getValues();
    try {
      const response = await api.request<{ data: { record: TravelRecord } }>({
        method: 'POST',
        path: 'travelRequests',
        json: {
          ...fields,
          attachments: [],
          transportCents: parseAmountCents(transport)!,
          lodgingCents: parseAmountCents(lodging)!,
          allowanceCents: parseAmountCents(allowance)!,
          ...(delegate &&
          pick &&
          applicantId &&
          applicantId !== session?.user.id
            ? { applicantId }
            : {}),
        },
      });
      draftRef.current = response.data.record;
      setDraft(response.data.record);
      parent.reload();
      return response.data.record.id;
    } catch (failure) {
      setError(failure);
      if (!(failure instanceof ApiClientError) || failure.status >= 500) {
        uncertainRef.current = true;
        setUncertain(true);
        onDone();
        parent.reload();
      }
      throw failure;
    }
  }
  const busy = form.formState.isSubmitting || uploading;
  return (
    <>
      {!allowed ? (
        <Alert>
          <AlertDescription>{t('approvals.readOnly')}</AlertDescription>
        </Alert>
      ) : null}
      {uncertain ? (
        <Alert>
          <AlertDescription>{t('travel.uncertainCreate')}</AlertDescription>
        </Alert>
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : null}
      {options.error ? (
        <>
          <ErrorState error={options.error} retry={options.reload} />
          {standardApplicant ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('travel.standardTargetUnavailable')}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      ) : options.loading ? (
        <FieldsSkeleton fields={1} />
      ) : null}
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      <form
        id='travel-form'
        onSubmitCapture={submission.captureIntent}
        onSubmit={(event) => void form.handleSubmit(save)(event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.nativeEvent.isComposing)
            event.preventDefault();
        }}
      >
        <FieldGroup inert={submission.submitUnknown || undefined}>
          {delegate && pick && !detail ? (
            <Controller
              name='applicantId'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor='travel-applicant'>
                    {t('approvals.applicant')}
                  </FieldLabel>
                  <UserPicker
                    id='travel-applicant'
                    value={field.value}
                    onChange={(value) => {
                      field.onChange(value);
                      setStandardApplicant(value);
                    }}
                    disabled={
                      busy ||
                      uncertain ||
                      !allowed ||
                      !!submission.current.current
                    }
                  />
                </Field>
              )}
            />
          ) : null}
          {(['destination'] as const).map((name) => (
            <Field key={name} data-invalid={!!form.formState.errors[name]}>
              <FieldLabel htmlFor={`travel-${name}`}>
                {t(`travel.${name}`)} *
              </FieldLabel>
              <Input
                id={`travel-${name}`}
                {...form.register(name)}
                disabled={busy || uncertain || !allowed}
                aria-invalid={!!form.formState.errors[name]}
              />
              <FieldError errors={[form.formState.errors[name]]} />
            </Field>
          ))}
          {(['startAt', 'endAt'] as const).map((name) => (
            <Controller
              key={name}
              name={name}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`travel-${name}`}>
                    {t(`travel.${name}`)} *
                  </FieldLabel>
                  <DateTimePicker
                    id={`travel-${name}`}
                    value={field.value}
                    onChange={field.onChange}
                    timeZone={options.data?.timeZone ?? 'UTC'}
                    disabled={busy || uncertain || !allowed || !options.data}
                    invalid={fieldState.invalid}
                    timeLabel={t(`travel.${name}`)}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
          <FieldDescription>
            {t('travel.timeZone', { zone: options.data?.timeZone ?? '—' })}
          </FieldDescription>
          {(['international', 'needsLoan', 'needsBooking'] as const).map(
            (name) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field }) => (
                  <Field orientation='horizontal'>
                    <Checkbox
                      id={`travel-${name}`}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={busy || uncertain || !allowed}
                    />
                    <FieldLabel htmlFor={`travel-${name}`}>
                      {t(`travel.${name}`)}
                    </FieldLabel>
                  </Field>
                )}
              />
            ),
          )}
          {(['transport', 'lodging', 'allowance'] as const).map((name) => (
            <Field key={name} data-invalid={!!form.formState.errors[name]}>
              <FieldLabel htmlFor={`travel-${name}`}>
                {t(`travel.${name}Cents`)} *
              </FieldLabel>
              <Input
                id={`travel-${name}`}
                inputMode='decimal'
                {...form.register(name)}
                onChange={(event) => {
                  manuallyTypedAmountsRef.current.add(name);
                  void form.register(name).onChange(event);
                }}
                aria-invalid={!!form.formState.errors[name]}
                disabled={busy || uncertain || !allowed}
              />
              <FieldError errors={[form.formState.errors[name]]} />
            </Field>
          ))}
          <Controller
            name='companionIds'
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel>{t('travel.companions')}</FieldLabel>
                {!pick ? (
                  <FieldDescription>
                    {t('travel.peopleUnavailable')}
                  </FieldDescription>
                ) : (
                  <>
                    {field.value.map((id, index) => (
                      <div className='flex gap-2' key={id || 'new-companion'}>
                        <UserPicker
                          value={id}
                          onChange={(value) =>
                            field.onChange(
                              field.value.map((v, i) =>
                                i === index ? value : v,
                              ),
                            )
                          }
                          knownUsers={detail?.users}
                          disabled={busy || uncertain || !allowed}
                        />
                        <Button
                          type='button'
                          variant='outline'
                          disabled={busy || uncertain || !allowed}
                          onClick={() =>
                            field.onChange(
                              field.value.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {t('travel.removeCompanion')}
                        </Button>
                      </div>
                    ))}
                    {field.value.length < 20 ? (
                      <Button
                        type='button'
                        variant='outline'
                        disabled={
                          busy ||
                          uncertain ||
                          !allowed ||
                          field.value.includes('')
                        }
                        onClick={() => field.onChange([...field.value, ''])}
                      >
                        {t('travel.addCompanion')}
                      </Button>
                    ) : null}
                  </>
                )}
                <FieldError errors={[form.formState.errors.companionIds]} />
              </Field>
            )}
          />
          <Controller
            name='attachments'
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <TravelAttachmentEditor
                  travelId={draft?.id}
                  ids={field.value}
                  onChange={field.onChange}
                  ensureDraft={ensureDraft}
                  disabled={busy || uncertain || !allowed || !options.data}
                  onBusyChange={(value) => {
                    setUploading(value);
                    onBusy(value);
                  }}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <FieldDescription>{t('travel.approvalHint')}</FieldDescription>
          <Field data-invalid={!!form.formState.errors.reason}>
            <FieldLabel htmlFor='travel-reason'>
              {t('approvals.reason')} *
            </FieldLabel>
            <Textarea
              id='travel-reason'
              {...form.register('reason')}
              aria-invalid={!!form.formState.errors.reason}
              disabled={busy || uncertain || !allowed}
            />
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
        </FieldGroup>
      </form>
    </>
  );
}
