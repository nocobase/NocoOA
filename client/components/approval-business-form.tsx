import {
  useRequestFormSubmission,
  preventComposingSubmit,
} from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useOutletContext, useParams } from 'react-router';
import { z } from 'zod';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { DateTimePicker } from '#components/date-time-picker';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
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
import { FieldsSkeleton } from '../pages/platform/shared/states.js';
import { useResource } from '../pages/approvals/use-resource.js';
import { createRequestId } from '../pages/approvals/request-id.js';
import { ErrorState as CorrectionError } from '../pages/attendance-change/states.js';
import { ErrorState as OutingError } from '../pages/outings/states.js';
import { AttendanceChangeAttachmentEditor } from '../pages/attendance-change/attachments.js';
import type {
  AttendanceChangeDetail,
  AttendanceChangeRecord,
} from '../pages/attendance-change/types.js';
import type { OutingDetail, OutingRecord } from '../pages/outings/types.js';
import type { SourceContext } from '../pages/approvals/types.js';
type Kind = 'attendanceChange' | 'outings';
type BusinessDetail = AttendanceChangeDetail | OutingDetail;
type BusinessRecord = AttendanceChangeRecord | OutingRecord;
type DetailContext = { update: (record: BusinessRecord) => void };
const resourcePaths = {
  attendanceChange: 'attendanceChangeRequests',
  outings: 'outingRequests',
} as const;
const lifecycleIds = {
  attendanceChange: 'oa.attendanceChange',
  outings: 'oa.outing',
} as const;

export function ApprovalBusinessFormDialog({ kind }: { kind: Kind }) {
  const ErrorState =
    kind === 'attendanceChange' ? CorrectionError : OutingError;
  const { requestId } = useParams();
  const { t } = useTranslation();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const parentReload = parent.reload;
  const resource = useResource<BusinessDetail>(
    requestId
      ? `${resourcePaths[kind]}/${encodeURIComponent(requestId)}`
      : null,
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const [discard, setDiscard] = useState(false);
  const resolveCloseRef = useRef<((allowed: boolean) => void) | null>(null);
  const [done, setDone] = useState(false);
  const canSubmit = useCan({
    resource: { type: 'composite', id: lifecycleIds[kind] },
    action: 'submit',
  }).can;
  const canDelegate = useCan({
    resource: { type: 'composite', id: lifecycleIds[kind] },
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
  return (
    <RouteDrawer
      printable
      className='text-sm sm:max-w-2xl'
      title={t(`${kind}.${requestId ? 'edit' : 'new'}`)}
      description={t(`${kind}.formDescription`)}
      beforeClose={() => {
        if (busyRef.current) return false;
        if (!dirtyRef.current) return true;
        setDiscard(true);
        return new Promise<boolean>((resolve) => {
          resolveCloseRef.current = resolve;
        });
      }}
      footer={
        <FormFooter
          revision={resource.data?.record.status === 'revision'}
          kind={kind}
          busy={busy}
          disabled={done || !allowed || resource.loading || !!resource.error}
        />
      }
    >
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : requestId && !resource.data ? (
        <FieldsSkeleton fields={4} />
      ) : (
        <BusinessForm
          kind={kind}
          key={
            resource.data
              ? `${resource.data.record.id}:${resource.data.record.lifecycleVersion}`
              : 'new'
          }
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
            <AlertDialogCancel>{t('approvals.cancel')}</AlertDialogCancel>
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
function FormFooter({
  kind,
  busy,
  disabled,
  revision,
}: {
  kind: Kind;
  busy: boolean;
  disabled: boolean;
  revision?: boolean;
}) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('approvals.cancel')}
      </Button>
      <RequestFormButtons
        revision={revision}
        resource={lifecycleIds[kind]}
        form='approval-business-form'
        busy={busy}
        disabled={disabled}
      />
    </>
  );
}
function BusinessForm({
  kind,
  detail,
  allowed,
  reload,
  onBusy,
  onDirty,
  onDone,
}: {
  kind: Kind;
  detail?: BusinessDetail;
  allowed: boolean;
  reload: () => void;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { close } = useRouteOverlay();
  const { session } = useAuthentication();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const ErrorState =
    kind === 'attendanceChange' ? CorrectionError : OutingError;
  const delegate = useCan({
    resource: { type: 'composite', id: lifecycleIds[kind] },
    action: 'delegate',
  }).can;
  const pick = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const [error, setError] = useState<unknown>();
  const [uncertain, setUncertain] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const runningRef = useRef(false);
  const attemptRef = useRef<{ key: string; id: string } | null>(null);
  const options = useResource<{ timeZone: string }>(
    `${resourcePaths[kind]}/options`,
  );
  const [preparedRecord, setPreparedRecord] = useState<BusinessRecord>();
  const record = detail?.record ?? preparedRecord;
  const submission = useRequestFormSubmission<BusinessRecord>({
    resource: resourcePaths[kind],
  });
  const schema = useMemo(
    () =>
      z
        .object({
          applicantId: z.string(),
          originalAttendanceId: z.string(),
          originalVersion: z.number().int().nonnegative(),
          date: z.string(),
          correctionAt: z.string(),
          startAt: z.string(),
          endAt: z.string(),
          location: z.string().max(2000),
          reason: z
            .string()
            .trim()
            .min(1, t('approvals.required'))
            .max(10000, t('approvals.limit')),
          proof: z.string().max(10000),
          attachments: z.array(z.string()).max(10),
        })
        .superRefine((value, context) => {
          const required = (
            field:
              | 'originalAttendanceId'
              | 'correctionAt'
              | 'startAt'
              | 'endAt'
              | 'location',
          ) => {
            if (!value[field].trim())
              context.addIssue({
                code: 'custom',
                path: [field],
                message: t('approvals.required'),
              });
          };
          if (kind === 'attendanceChange') {
            required('originalAttendanceId');
            required('correctionAt');
          } else {
            required('startAt');
            required('endAt');
            required('location');
            if (
              value.startAt &&
              value.endAt &&
              Date.parse(value.endAt) <= Date.parse(value.startAt)
            )
              context.addIssue({
                code: 'custom',
                path: ['endAt'],
                message: t('outings.errors.OUTING_INVALID_PERIOD'),
              });
          }
        }),
    [kind, t],
  );
  const correction = record && 'date' in record ? record : undefined;
  const outing = record && 'startAt' in record ? record : undefined;
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      applicantId: record?.applicantId ?? '',
      originalAttendanceId: correction?.originalAttendanceId ?? '',
      originalVersion: correction?.originalVersion ?? 0,
      date: correction?.date ?? '',
      correctionAt: correction?.correctionAt ?? '',
      startAt: outing?.startAt ?? '',
      endAt: outing?.endAt ?? '',
      location: outing?.location ?? '',
      reason: record?.reason ?? '',
      proof: correction?.proof ?? '',
      attachments: correction?.attachments ?? [],
    },
  });
  const selectedAttachments = useWatch({
    control: form.control,
    name: 'attachments',
  });
  const selectedDate = useWatch({ control: form.control, name: 'date' });
  const watchedApplicantId = useWatch({
    control: form.control,
    name: 'applicantId',
  });
  const applicantId = watchedApplicantId || session?.user.id || '';
  const missing = useResource<
    Array<{
      id: string;
      date: string;
      punchKind: 'in' | 'out';
      version: number;
    }>
  >(
    kind === 'attendanceChange' && applicantId
      ? 'attendanceChangeRequests/missingPunches'
      : null,
    { applicantId, ...(record ? { excludeRequestId: record.id } : {}) },
  );
  useEffect(
    () => onDirty(form.formState.isDirty),
    [onDirty, form.formState.isDirty],
  );
  const locked =
    !allowed ||
    uncertain ||
    !options.data ||
    options.loading ||
    !!options.error;
  async function persistDraft(values: z.infer<typeof schema>) {
    const input =
      kind === 'attendanceChange'
        ? {
            originalAttendanceId: values.originalAttendanceId,
            originalVersion: values.originalVersion,
            date: values.date,
            correctionAt: values.correctionAt,
            reason: values.reason,
            proof: values.proof,
            attachments: values.attachments,
          }
        : {
            startAt: values.startAt,
            endAt: values.endAt,
            location: values.location,
            reason: values.reason,
          };
    const key = JSON.stringify([
      input,
      record?.lifecycleVersion,
      values.applicantId,
    ]);
    if (attemptRef.current?.key !== key)
      attemptRef.current = { key, id: createRequestId() };
    const draftRequestId = attemptRef.current.id;
    const savedRecord = await submission.save(
      { input, applicantId: values.applicantId },
      record,
      async (current) => {
        const { data } = await api.request<{
          data: { record: BusinessRecord };
        }>({
          method: 'POST',
          path: current
            ? `${resourcePaths[kind]}/${current.id}/transition`
            : resourcePaths[kind],
          json: current
            ? {
                transition: 'edit',
                version: current.lifecycleVersion,
                requestId: draftRequestId,
                input,
              }
            : {
                ...input,
                ...(values.applicantId &&
                values.applicantId !== session?.user.id
                  ? { applicantId: values.applicantId }
                  : {}),
              },
        });
        return data.record;
      },
    );
    setPreparedRecord(savedRecord);
    return savedRecord;
  }
  async function save(values: z.infer<typeof schema>) {
    if (runningRef.current || locked || uploadBusy) return;
    if (
      submission.intent.current === 'submit' &&
      kind === 'attendanceChange' &&
      !values.proof.trim() &&
      !values.attachments.length
    ) {
      form.setError('proof', {
        message: t('attendanceChange.errors.ATTENDANCE_CHANGE_PROOF_REQUIRED'),
      });
      requestAnimationFrame(() =>
        document.getElementById('business-proof')?.focus(),
      );
      return;
    }
    runningRef.current = true;
    onBusy(true);
    setError(undefined);
    try {
      const savedRecord = await persistDraft(values);
      const data = { record: await submission.finish(savedRecord) };
      onDone();
      form.reset(values);
      onDirty(false);
      parent.update?.(data.record);
      parent.reload();
      toaster.show({
        type: 'success',
        title: t(
          submission.intent.current === 'submit'
            ? 'approvals.submitted'
            : 'approvals.saved',
          {
            name: data.record.number ?? t('approvals.draft'),
          },
        ),
      });
      onBusy(false);
      await close();
    } catch (reason) {
      setError(reason);
      if (
        !record &&
        !submission.current.current &&
        (!(reason instanceof ApiClientError) || reason.status >= 500)
      )
        setUncertain(true);
    } finally {
      runningRef.current = false;
      onBusy(false);
    }
  }
  const disabled = locked || uploadBusy || form.formState.isSubmitting;
  const timeZone = options.data?.timeZone;
  return (
    <>
      {options.error ? (
        <ErrorState error={options.error} retry={options.reload} />
      ) : null}
      {!options.data && !options.error ? <FieldsSkeleton fields={4} /> : null}
      {error ? <ErrorState error={error} retry={reload} /> : null}
      {uncertain ? (
        <Alert>
          <AlertDescription>{t('overtime.uncertainCreate')}</AlertDescription>
        </Alert>
      ) : null}
      <p className='text-sm text-muted-foreground'>{t(`${kind}.policyHint`)}</p>
      {timeZone ? (
        <p className='text-sm text-muted-foreground'>
          {t('outings.timeZone', { zone: timeZone })}
        </p>
      ) : null}
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      <form
        id='approval-business-form'
        onSubmitCapture={submission.captureIntent}
        onKeyDown={preventComposingSubmit}
        onSubmit={(event) => {
          void form.handleSubmit(save)(event);
        }}
      >
        <FieldGroup inert={submission.submitUnknown || undefined}>
          {!record && delegate && pick ? (
            <Controller
              name='applicantId'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor='business-applicant'>
                    {t('approvals.applicant')}
                  </FieldLabel>
                  <UserPicker
                    id='business-applicant'
                    value={field.value}
                    onChange={(id) => {
                      field.onChange(id);
                      form.setValue('originalAttendanceId', '');
                      form.setValue('date', '');
                      form.setValue('correctionAt', '');
                    }}
                    disabled={disabled}
                  />
                </Field>
              )}
            />
          ) : null}
          {kind === 'attendanceChange' ? (
            <>
              {missing.error ? (
                <ErrorState error={missing.error} retry={missing.reload} />
              ) : null}
              <Controller
                name='originalAttendanceId'
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor='business-original'>
                      {t('attendanceChange.original')} *
                    </FieldLabel>
                    <Select
                      value={field.value || null}
                      items={(missing.data ?? []).map((row) => ({
                        value: row.id,
                        label: `${row.date} · ${t(`attendanceChange.punchKinds.${row.punchKind}`)}`,
                      }))}
                      disabled={disabled || missing.loading || !!missing.error}
                      onValueChange={(id) => {
                        field.onChange(id ?? '');
                        const row = missing.data?.find((row) => row.id === id);
                        if (row) {
                          form.setValue('date', row.date);
                          form.setValue('originalVersion', row.version);
                          form.setValue('correctionAt', '');
                        }
                      }}
                    >
                      <SelectTrigger id='business-original'>
                        <SelectValue
                          placeholder={t('attendanceChange.missing')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(missing.data ?? []).map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.date} ·{' '}
                              {t(
                                `attendanceChange.punchKinds.${row.punchKind}`,
                              )}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {!missing.loading &&
                    !missing.error &&
                    !missing.data?.length ? (
                      <FieldDescription>
                        {t('attendanceChange.emptyMissing')}
                      </FieldDescription>
                    ) : null}
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              {timeZone ? (
                <Controller
                  name='correctionAt'
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor='business-correction'>
                        {t('attendanceChange.correctionAt')} *
                      </FieldLabel>
                      <DateTimePicker
                        id='business-correction'
                        value={field.value}
                        onChange={field.onChange}
                        timeZone={timeZone}
                        date={selectedDate || undefined}
                        disabled={disabled || !selectedDate}
                        invalid={fieldState.invalid}
                        timeLabel={t('attendanceChange.correctionAt')}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ) : null}
            </>
          ) : (
            <>
              {timeZone
                ? (['startAt', 'endAt'] as const).map((name) => (
                    <Controller
                      key={name}
                      name={name}
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <FieldLabel htmlFor={`business-${name}`}>
                            {t(`outings.${name}`)} *
                          </FieldLabel>
                          <DateTimePicker
                            id={`business-${name}`}
                            value={field.value}
                            onChange={field.onChange}
                            timeZone={timeZone}
                            disabled={disabled}
                            invalid={fieldState.invalid}
                            timeLabel={t(`outings.${name}`)}
                          />
                          <FieldError errors={[fieldState.error]} />
                        </Field>
                      )}
                    />
                  ))
                : null}
              <Field data-invalid={!!form.formState.errors.location}>
                <FieldLabel htmlFor='business-location'>
                  {t('outings.location')} *
                </FieldLabel>
                <Input
                  id='business-location'
                  {...form.register('location')}
                  disabled={disabled}
                  aria-invalid={!!form.formState.errors.location}
                />
                <FieldError errors={[form.formState.errors.location]} />
              </Field>
            </>
          )}
          <Field data-invalid={!!form.formState.errors.reason}>
            <FieldLabel htmlFor='business-reason'>
              {t('approvals.reason')} *
            </FieldLabel>
            <Textarea
              id='business-reason'
              {...form.register('reason')}
              disabled={disabled}
              aria-invalid={!!form.formState.errors.reason}
            />
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          {kind === 'attendanceChange' ? (
            <>
              <Field data-invalid={!!form.formState.errors.proof}>
                <FieldLabel htmlFor='business-proof'>
                  {t('attendanceChange.proof')}
                </FieldLabel>
                <Textarea
                  id='business-proof'
                  {...form.register('proof')}
                  aria-invalid={!!form.formState.errors.proof}
                  disabled={disabled}
                />
              </Field>
              {form.formState.errors.proof && (
                <FieldError errors={[form.formState.errors.proof]} />
              )}
              <AttendanceChangeAttachmentEditor
                attendanceChangeId={record?.id}
                ids={selectedAttachments}
                onChange={(ids) => {
                  form.setValue('attachments', ids, { shouldDirty: true });
                  if (ids.length) form.clearErrors('proof');
                }}
                ensureDraft={async () => {
                  if (record) return record.id;
                  if (!(await form.trigger()))
                    throw new Error(t('approvals.required'));
                  return (await persistDraft(form.getValues())).id;
                }}
                disabled={disabled}
                onBusyChange={(busy) => {
                  setUploadBusy(busy);
                  onBusy(busy);
                }}
              />
            </>
          ) : null}
        </FieldGroup>
      </form>
    </>
  );
}
