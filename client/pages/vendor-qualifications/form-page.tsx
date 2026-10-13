import {
  FormPaymentAccount,
  type FormPaymentAccountControl,
} from './form-payment-account.js';
import {
  useRequestFormSubmission,
  preventComposingSubmit,
} from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { AmountInput } from './amount-input.js';
import { Missing } from './missing.js';
import { finalRefusal } from './errors.js';
import { useEffect, useRef, useState } from 'react';
import {
  useApiClient,
  useNavigationGuard,
  useToaster,
  ApiClientError,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useParams,
  useOutletContext,
  useLocation,
  useNavigate,
} from 'react-router';
import { format, parseISO } from 'date-fns';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { DatePicker } from '#components/date-picker';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
  FieldGroup,
} from '#components/ui/field';
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
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { QualificationAttachmentEditor } from './attachments.js';
import { ErrorState } from './states.js';
import { Choice } from './shared.js';
import {
  emptyInput,
  type QualificationDetail,
  type QualificationOptions,
  type QualificationRecord,
  type QualificationInput,
  type SourceContext,
} from './types.js';
import {
  loadCreate,
  startCreate,
  saveCreate,
  clearCreate,
  centsOf,
  decimalOf,
  type CreateJournal,
} from './create-journal.js';
export default function QualificationForm() {
  const { session } = useAuthentication();
  return (
    <Form
      key={`${session?.user.id ?? ''}:${useParams().requestId ?? 'new'}`}
      actorId={session?.user.id ?? ''}
    />
  );
}
function Form({ actorId }: { actorId: string }) {
  const { requestId } = useParams(),
    { t, i18n } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    location = useLocation(),
    navigate = useNavigate(),
    parent = useOutletContext<SourceContext>();
  const [restoredState] = useState<CreateJournal | null>(() =>
    requestId ? null : loadCreate(actorId),
  );
  const [savedId, setSavedId] = useState<string | undefined>(
      requestId ?? restoredState?.recordId,
    ),
    [values, setValues] = useState<QualificationInput>(
      () => restoredState?.input ?? structuredClone(emptyInput),
    ),
    [quote, setQuote] = useState(() =>
      decimalOf(restoredState?.input.quoteCents ?? 0),
    );
  const journalRef = useRef<CreateJournal | null>(restoredState),
    [unknown, setUnknown] = useState(
      !!restoredState && !restoredState.recordId,
    ),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState<unknown>(),
    [locked, setLocked] = useState(false),
    [dirty, setDirty] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [discard, setDiscard] = useState(false);
  const busyRef = useRef(false),
    leavingRef = useRef(false),
    loadedRef = useRef<string | null>(null),
    draftPromiseRef = useRef<Promise<string> | null>(null);
  const grant = useCan({
      resource: { type: 'composite', id: 'oa.vendorQualification' },
      action: 'submit',
    }),
    allowed = grant.can && !grant.isPending && !grant.error;
  const viewGrant = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'view',
  });
  const options = useResource<QualificationOptions>(
    allowed ? 'vendorQualifications/options' : null,
    { viewer: actorId },
  );
  const detail = useResource<QualificationDetail>(
    savedId && viewGrant.can && !viewGrant.isPending && !viewGrant.error
      ? `vendorQualifications/${encodeURIComponent(savedId)}`
      : null,
    { viewer: actorId },
  );
  const viewRefused =
    !!savedId && !viewGrant.isPending && (!!viewGrant.error || !viewGrant.can);
  const readRefused =
    viewRefused || finalRefusal(detail.error) || finalRefusal(error);
  const missingError = [detail.error, error].find(
    (v) => v instanceof ApiClientError && v.status === 404,
  );
  const [knownName, setKnownName] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && detail.data) setKnownName(detail.data.record.name);
    });
    return () => {
      cancelled = true;
    };
  }, [detail.data]);
  const eligible =
    options.data &&
    (values.operation === 'qualify'
      ? options.data.canCreateQualification
      : options.data.canCreateRemoval);
  const vendor = options.data?.vendors.find(
    (v) =>
      v.id === values.vendorId &&
      v.eligibleOperations.includes(values.operation),
  );
  const latest = !!detail.data && !detail.loading && !detail.error;
  const editOffer = detail.data?.view.available.some(
    (a) => a.name === 'edit' && a.allowed,
  );
  const disabled =
    busy ||
    uploading ||
    unknown ||
    locked ||
    !allowed ||
    options.loading ||
    !!options.error ||
    !eligible ||
    (!!savedId && (!latest || !editOffer));
  useNavigationGuard(() => {
    if (leavingRef.current) return true;
    if (busyRef.current || uploading || unknown) return false;
    if (!dirty) return true;
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (detail.data && loadedRef.current !== detail.data.record.id) {
        loadedRef.current = detail.data.record.id;
        if (requestId || !dirty) {
          const record = detail.data.record;
          setValues(
            Object.fromEntries(
              Object.keys(emptyInput).map((key) => [
                key,
                record[key as keyof QualificationInput],
              ]),
            ) as unknown as QualificationInput,
          );
          setQuote(decimalOf(record.quoteCents));
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detail.data, requestId, dirty]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (
        (!grant.isPending && (!grant.can || !!grant.error)) ||
        viewRefused ||
        finalRefusal(options.error) ||
        finalRefusal(detail.error)
      ) {
        setValues(structuredClone(emptyInput));
        setQuote('');
        setErrors({});
        setDirty(false);
        clearCreate(actorId);
        journalRef.current = null;
        setLocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    grant.isPending,
    grant.can,
    grant.error,
    viewRefused,
    options.error,
    detail.error,
    actorId,
  ]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (options.data && !options.loading && !unknown) {
        if (!eligible || (values.vendorId && !vendor)) {
          setValues((v) => ({ ...v, vendorId: '', category: '' }));
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    options.data,
    options.loading,
    unknown,
    eligible,
    vendor,
    values.vendorId,
  ]);
  function update<K extends keyof QualificationInput>(
    key: K,
    value: QualificationInput[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
    if (errors[key])
      setErrors((e) => ({
        ...e,
        [key]: submissionErrors({ ...values, [key]: value })[key] ?? '',
      }));
  }
  function submissionErrors(input: QualificationInput) {
    const next: Record<string, string> = {};
    if (!input.reason.trim())
      next.reason = t('vendorQualifications.common.required');
    if (input.operation === 'remove') return next;
    if (!input.name.trim())
      next.name = t('vendorQualifications.common.required');
    if (!options.data?.categories.some((item) => item.code === input.category))
      next.category = t('vendorQualifications.errors.category');
    if (!input.attachments.length)
      next.attachments = t('vendorQualifications.errors.evidence');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: options.data?.timeZone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    if (!input.qualificationExpiry || input.qualificationExpiry <= today)
      next.qualificationExpiry = t('vendorQualifications.errors.expiry');
    return next;
  }
  function validate(submitting = false) {
    const next: Record<string, string> = submitting
      ? submissionErrors(values)
      : {};
    if (!vendor) next.vendorId = t('vendorQualifications.common.required');
    if (!eligible)
      next.operation = t('vendorQualifications.errors.eligibility');
    const amount = values.operation === 'remove' ? 0 : centsOf(quote);
    if (amount === null)
      next.quoteCents = t('vendorQualifications.errors.amount');
    if (
      values.operation === 'qualify' &&
      values.contactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail)
    )
      next.contactEmail = t('vendorQualifications.errors.email');
    setErrors(next);
    if (Object.keys(next).length) {
      const field = Object.keys(next)[0];
      const id =
        field === 'attachments'
          ? 'evidence'
          : field === 'qualificationExpiry'
            ? 'expiry'
            : field;
      document.getElementById(`qualification-${id}`)?.focus();
      return null;
    }
    return { ...values, quoteCents: amount! };
  }
  const submission = useRequestFormSubmission<QualificationRecord>({
    replayUnknownCreate: true,
    resource: 'vendorQualifications',
    nameField: 'name',
  });
  const createdRecordRef = useRef<QualificationRecord | undefined>(undefined);
  const [createdRecord, setCreatedRecord] = useState<QualificationRecord>();
  const bankControlRef = useRef<FormPaymentAccountControl | null>(null);
  async function ensureDraft(): Promise<string> {
    if (savedId) return savedId;
    if (draftPromiseRef.current) return draftPromiseRef.current;
    const input = validate();
    if (!input) throw new Error('invalid draft');
    const commandRef = journalRef.current ?? startCreate(actorId, input);
    journalRef.current = commandRef;
    setUnknown(true);
    draftPromiseRef.current = api
      .request<{ data: { record: QualificationRecord } }>({
        method: 'POST',
        path: 'vendorQualifications',
        json: { requestId: commandRef.requestId, input: commandRef.input },
      })
      .then(({ data }) => {
        createdRecordRef.current = data.record;
        setCreatedRecord(data.record);
        const receipt = { ...commandRef, recordId: data.record.id };
        saveCreate(receipt);
        journalRef.current = receipt;
        setSavedId(data.record.id);
        setUnknown(false);
        parent?.reload();
        return data.record.id;
      })
      .catch((cause: unknown) => {
        if (
          cause instanceof ApiClientError &&
          cause.status < 500 &&
          cause.status !== 409
        ) {
          clearCreate(actorId);
          journalRef.current = null;
          setUnknown(false);
        }
        throw cause;
      })
      .finally(() => {
        draftPromiseRef.current = null;
      });
    return draftPromiseRef.current;
  }
  async function save() {
    if (busyRef.current) return;
    const input = validate(submission.intent.current === 'submit');
    if (!input) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const editRequestId = createRequestId();
      const draft = await submission.save(
        input,
        detail.data?.record ?? createdRecordRef.current,
        async (current) => {
          if (!current) {
            await ensureDraft();
            return createdRecordRef.current!;
          }
          const { data } = await api.request<{
            data: { record: QualificationRecord };
          }>({
            method: 'POST',
            path: `vendorQualifications/${current.id}/transition`,
            json: {
              name: 'edit',
              version: current.lifecycleVersion,
              requestId: editRequestId,
              input,
            },
          });
          return data.record;
        },
      );
      await bankControlRef.current?.save(
        draft,
        submission.intent.current === 'submit',
      );
      const completed = await submission.finish(draft);
      createdRecordRef.current = completed;
      setCreatedRecord(completed);
      detail.reload();
      clearCreate(actorId);
      journalRef.current = null;
      setDirty(false);
      leavingRef.current = true;
      parent?.reload();
      toaster.show({
        type: 'success',
        title: t(
          submission.intent.current === 'submit'
            ? 'approvals.submitted'
            : 'vendorQualifications.savedNamed',
          {
            name: values.name,
          },
        ),
      });
      await navigate({ pathname: '..', search: location.search });
      parent?.focusList?.();
    } catch (cause) {
      setError(cause);
      if (finalRefusal(cause)) {
        setValues(structuredClone(emptyInput));
        setQuote('');
        setErrors({});
        setDirty(false);
        clearCreate(actorId);
        journalRef.current = null;
        setLocked(true);
      } else if (cause instanceof ApiClientError && cause.status === 409) {
        setLocked(true);
        detail.reload();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function retryCreate() {
    if (!journalRef.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await ensureDraft();
      setError(undefined);
    } catch (cause) {
      setError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const categoryItems = (options.data?.categories ?? []).map((v) => ({
    value: v.code,
    label: v.label[i18n.language] ?? v.label['en-US'] ?? v.code,
  }));
  const selectedOperation = values.operation;
  const operationItems = [
    ...(options.data?.canCreateQualification
      ? [
          {
            value: 'qualify',
            label: t('vendorQualifications.operations.qualify'),
          },
        ]
      : []),
    ...(options.data?.canCreateRemoval
      ? [
          {
            value: 'remove',
            label: t('vendorQualifications.operations.remove'),
          },
        ]
      : []),
  ];
  const fields =
    values.operation === 'remove'
      ? (['reason'] as const)
      : ([
          'name',
          'reason',
          'cases',
          'contactName',
          'contactPhone',
          'contactEmail',
        ] as const);
  if (missingError)
    return (
      <Missing
        name={knownName}
        onMissing={parent?.reload}
        focusList={parent?.focusList}
        allowNavigation={() => {
          leavingRef.current = true;
        }}
      />
    );
  return (
    <RouteFormPage
      printable
      title={t(
        requestId
          ? 'vendorQualifications.form.edit'
          : 'vendorQualifications.form.create',
      )}
    >
      <PageContainer>
        <BackButton />
        <PageHeader
          title={t(
            requestId
              ? 'vendorQualifications.form.edit'
              : 'vendorQualifications.form.create',
          )}
          actions={
            <>
              <Button
                type='button'
                variant='outline'
                disabled={busy || uploading || unknown}
                onClick={() =>
                  void navigate({ pathname: '..', search: location.search })
                }
              >
                {t('vendorQualifications.common.cancel')}
              </Button>
              <RequestFormButtons
                revision={detail.data?.record.status === 'revision'}
                resource='oa.vendorQualification'
                form='qualification-form'
                busy={busy}
                disabled={disabled}
              />
            </>
          }
        />
        {viewRefused && <p>{t('vendorQualifications.errors.forbidden')}</p>}
        {!!options.error && (
          <ErrorState error={options.error} retry={options.reload} />
        )}{' '}
        {!!detail.error && (
          <ErrorState error={detail.error} retry={detail.reload} />
        )}{' '}
        {!!error && (
          <ErrorState
            error={error}
            retry={() => {
              detail.reload();
              setLocked(false);
            }}
          />
        )}
        <RequestSubmissionFeedback
          failed={submission.submitFailed}
          unknown={submission.submitUnknown}
        />
        {unknown && (
          <Alert>
            <AlertDescription>
              {t('vendorQualifications.unknown')}
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void retryCreate()}
              >
                {t('vendorQualifications.retryCreate')}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {readRefused ||
        (!!savedId && viewGrant.isPending) ? null : !options.data &&
          !options.error ? (
          <FieldsSkeleton fields={10} />
        ) : (
          <form
            id='qualification-form'
            onSubmitCapture={submission.captureIntent}
            onKeyDown={preventComposingSubmit}
            className='flex min-h-0 flex-col gap-6'
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <FieldGroup inert={submission.submitUnknown || undefined}>
              <Field>
                <FieldLabel htmlFor='qualification-operation'>
                  {t('vendorQualifications.fields.operation')} *
                </FieldLabel>
                <Choice
                  id='qualification-operation'
                  label={t('vendorQualifications.fields.operation')}
                  value={selectedOperation}
                  disabled={disabled || !!savedId}
                  items={operationItems}
                  onChange={(value) => {
                    update(
                      'operation',
                      value as QualificationInput['operation'],
                    );
                    update('vendorId', '');
                  }}
                />
                {errors.operation && (
                  <FieldError>{errors.operation}</FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor='qualification-vendorId'>
                  {t('vendorQualifications.fields.vendor')} *
                </FieldLabel>
                <Choice
                  id='qualification-vendorId'
                  label={t('vendorQualifications.fields.vendor')}
                  value={values.vendorId}
                  disabled={disabled || !!savedId}
                  items={(options.data?.vendors ?? [])
                    .filter((v) =>
                      v.eligibleOperations.includes(values.operation),
                    )
                    .map((v) => ({ value: v.id, label: v.name }))}
                  onChange={(value) => {
                    const v = options.data?.vendors.find(
                      (row) => row.id === value,
                    );
                    setValues((old) => ({
                      ...old,
                      vendorId: value,
                      name: v?.name ?? '',
                      category: v?.category ?? '',
                    }));
                    setDirty(true);
                  }}
                />
                {errors.vendorId && <FieldError>{errors.vendorId}</FieldError>}
              </Field>
              {fields.map((key) => (
                <Field key={key} data-invalid={!!errors[key]}>
                  <FieldLabel htmlFor={`qualification-${key}`}>
                    {t(`vendorQualifications.fields.${key}`)}
                    {key === 'reason' || key === 'name' ? ' *' : ''}
                  </FieldLabel>
                  {['reason', 'cases'].includes(key) ? (
                    <Textarea
                      id={`qualification-${key}`}
                      value={values[key]}
                      disabled={disabled}
                      maxLength={key === 'cases' ? 10000 : 4000}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  ) : (
                    <Input
                      id={`qualification-${key}`}
                      value={values[key]}
                      disabled={disabled}
                      maxLength={key === 'contactPhone' ? 64 : 255}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  )}{' '}
                  {errors[key] && <FieldError>{errors[key]}</FieldError>}
                </Field>
              ))}
              {values.operation === 'qualify' && (
                <>
                  <Field data-invalid={!!errors.category}>
                    <FieldLabel htmlFor='qualification-category'>
                      {t('vendorQualifications.fields.category')} *
                    </FieldLabel>
                    <Choice
                      id='qualification-category'
                      label={t('vendorQualifications.fields.category')}
                      value={values.category}
                      items={categoryItems}
                      disabled={disabled}
                      onChange={(v) => update('category', v)}
                    />
                    {errors.category && (
                      <FieldError>{errors.category}</FieldError>
                    )}
                  </Field>
                  <Field data-invalid={!!errors.quoteCents}>
                    <FieldLabel htmlFor='qualification-quoteCents'>
                      {t('vendorQualifications.fields.quoteCents')}
                    </FieldLabel>
                    <AmountInput
                      id='qualification-quoteCents'
                      unit={t('vendorQualifications.amountUnit')}
                      value={quote}
                      disabled={disabled}
                      onChange={(value) => {
                        setQuote(value);
                        setDirty(true);
                        if (errors.quoteCents)
                          setErrors((e) => ({
                            ...e,
                            quoteCents:
                              centsOf(value) === null
                                ? t('vendorQualifications.errors.amount')
                                : '',
                          }));
                      }}
                    />
                    {errors.quoteCents && (
                      <FieldError>{errors.quoteCents}</FieldError>
                    )}
                  </Field>
                  <Field data-invalid={!!errors.qualificationExpiry}>
                    <FieldLabel htmlFor='qualification-expiry'>
                      {t('vendorQualifications.fields.qualificationExpiry')} *
                    </FieldLabel>
                    <DatePicker
                      id='qualification-expiry'
                      invalid={!!errors.qualificationExpiry}
                      disabled={disabled}
                      value={
                        values.qualificationExpiry
                          ? parseISO(values.qualificationExpiry)
                          : undefined
                      }
                      onChange={(date) =>
                        update(
                          'qualificationExpiry',
                          date ? format(date, 'yyyy-MM-dd') : null,
                        )
                      }
                    />
                    {errors.qualificationExpiry && (
                      <FieldError>{errors.qualificationExpiry}</FieldError>
                    )}
                    <FieldDescription>
                      {t('vendorQualifications.errors.expiry')}
                    </FieldDescription>
                  </Field>
                  <QualificationAttachmentEditor
                    invalid={!!errors.attachments}
                    id='qualification-evidence'
                    recordId={savedId}
                    ids={values.attachments}
                    disabled={disabled}
                    ensureDraft={ensureDraft}
                    onChange={(ids) => update('attachments', ids)}
                    onBusyChange={setUploading}
                  />
                  {errors.attachments && (
                    <FieldError>{errors.attachments}</FieldError>
                  )}
                  <p className='text-sm text-muted-foreground'>
                    {t('vendorQualifications.bankHint')}
                  </p>
                </>
              )}
            </FieldGroup>
            {values.operation === 'qualify' ? (
              <FormPaymentAccount
                record={detail.data?.record ?? createdRecord}
                controlRef={bankControlRef}
                disabled={disabled || submission.submitUnknown}
                createAllowed={!savedId && allowed}
                onDirty={() => setDirty(true)}
              />
            ) : null}
          </form>
        )}
        <AlertDialog open={discard} onOpenChange={setDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('approvals.discard')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('approvals.discardDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t('vendorQualifications.common.cancel')}
              </AlertDialogCancel>
              <Button
                variant='destructive'
                onClick={() => {
                  leavingRef.current = true;
                  setDiscard(false);
                  void navigate({ pathname: '..', search: location.search });
                }}
              >
                {t('approvals.discard')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </RouteFormPage>
  );
}
