import { useDiscardGuard } from './use-discard-guard.js';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { RefreshCw } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldErrors,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BackButton } from '#components/back-button';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { PurchaseFacts } from './facts.js';
import { PurchaseAttachmentEditor } from './attachments.js';
import {
  parseAmountCents,
  amountText,
  exceedsAmountThreshold,
} from './money.js';
import { ErrorState } from './states.js';
import type { PurchaseOptions } from './options.js';
import type { PurchaseDetail, DetailContext } from './types.js';

export default function PurchasePricingPage() {
  const { t: drawerTitle } = useTranslation();
  const {
    requestId = '',
    actionName = 'complete',
    targetId = '',
  } = useParams();
  const resource = useResource<PurchaseDetail>(
    `purchaseRequests/${encodeURIComponent(requestId)}`,
  );
  const parent = useOutletContext<DetailContext>();
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [parent, resource.error]);
  return (
    <RouteFormPage
      title={drawerTitle(
        actionName === 'force'
          ? 'purchases.forcePricing'
          : 'purchases.completePricing',
      )}
    >
      <PageContainer>
        <BackButton />
        {resource.data ? (
          <PricingForm
            key={`${requestId}:${actionName}:${targetId}`}
            detail={resource.data}
            actionName={actionName}
            targetId={targetId}
            sourceReady={!resource.loading && !resource.error}
            sourceError={resource.error}
            refresh={resource.reload}
            parent={parent}
          />
        ) : resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : (
          <FieldsSkeleton fields={8} />
        )}
      </PageContainer>
    </RouteFormPage>
  );
}
function PricingForm({
  detail,
  actionName,
  targetId,
  sourceReady,
  sourceError,
  refresh,
  parent,
}: {
  detail: PurchaseDetail;
  actionName: string;
  targetId: string;
  sourceReady: boolean;
  sourceError: unknown;
  refresh: () => void;
  parent: DetailContext;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    navigate = useNavigate(),
    toaster = useToaster();
  const options = useResource<PurchaseOptions>('purchaseRequests/options');
  const [initialBasis] = useState(detail.quoteBasisHash);
  const forced = actionName === 'forceComplete';
  const action = offeredActions(
    detail.taskActions,
    detail.runActions,
    detail.runs.map((v) => v.run),
  ).find(
    (a) =>
      a.name === actionName &&
      ('taskId' in a.target ? a.target.taskId : a.target.runId) === targetId,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [uncertain, setUncertain] = useState(false),
    [committed, setCommitted] = useState(false),
    [confirmation, setConfirmation] = useState<Record<string, unknown>>();
  const busyRef = useRef(false),
    dirtyRef = useRef(false),
    committedRef = useRef(false),
    uploadLocksRef = useRef(new Set<string>());
  const attemptRef = useRef<
    | { signature: string; id: string; payload: Record<string, unknown> }
    | undefined
  >(undefined);
  const schema = useMemo(
    () =>
      z
        .object({
          mode: z.enum(['', 'priced', 'close']),
          actual: z.string(),
          selectedVendorId: z.string(),
          quotes: z
            .array(
              z.object({
                vendorId: z.string(),
                attachmentIds: z.array(z.string()).max(10),
              }),
            )
            .max(10),
          comment: z.string().max(10000),
        })
        .superRefine((value, context) => {
          const bad = (path: (string | number)[], key = 'fieldInvalid') =>
            context.addIssue({
              code: 'custom',
              path,
              message: t(`purchases.${key}`),
            });
          if (!value.mode) bad(['mode']);
          if (forced && !value.comment.trim()) bad(['comment']);
          if (value.mode === 'close') {
            if (!forced) bad(['mode']);
            return;
          }
          const cents = parseAmountCents(value.actual);
          if (!cents) bad(['actual']);
          const active = (id: string) =>
            options.data?.vendors.some((v) => v.id === id && v.active);
          if (!active(value.selectedVendorId)) bad(['selectedVendorId']);
          const vendors = new Set<string>(),
            files = new Set<string>();
          value.quotes.forEach((quote, i) => {
            if (!active(quote.vendorId) || vendors.has(quote.vendorId))
              bad(['quotes', i, 'vendorId']);
            vendors.add(quote.vendorId);
            if (
              !quote.attachmentIds.length ||
              quote.attachmentIds.some((id) => files.has(id))
            )
              bad(['quotes', i, 'attachmentIds']);
            quote.attachmentIds.forEach((id) => files.add(id));
          });
          if (
            cents &&
            exceedsAmountThreshold(
              cents,
              detail.record.ruleSnapshot?.['purchase.quotes'] ?? 50000,
            ) &&
            vendors.size < 3
          )
            bad(['quotes'], 'threeQuotesRequired');
        }),
    [detail.record.ruleSnapshot, forced, options.data, t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: (forced ? '' : 'priced') as '' | 'priced' | 'close',
      actual: detail.record.actualCents
        ? amountText(detail.record.actualCents)
        : '',
      selectedVendorId: detail.record.selectedVendorId ?? '',
      quotes: detail.record.quotes.map((q) => ({
        vendorId: q.vendorId,
        attachmentIds: [...q.attachmentIds],
      })),
      comment: '',
    },
  });
  const rows = useFieldArray({ control: form.control, name: 'quotes' });
  const mode = useWatch({ control: form.control, name: 'mode' });
  const actual = useWatch({ control: form.control, name: 'actual' });
  const overEstimate = (() => {
    const cents = parseAmountCents(actual);
    return (
      cents !== null &&
      BigInt(cents) * 100n > BigInt(detail.record.estimatedCents) * 120n
    );
  })();
  const quoteValues = useWatch({ control: form.control, name: 'quotes' });
  const frozen =
    busy ||
    uncertain ||
    committed ||
    !action ||
    !sourceReady ||
    options.loading ||
    !!options.error ||
    !options.data;
  useEffect(() => {
    dirtyRef.current = form.formState.isDirty || uncertain;
  }, [form.formState.isDirty, uncertain]);
  const discardDialog = useDiscardGuard(
    form.formState.isDirty,
    busy || uncertain,
    committed,
  );
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (busyRef.current || (dirtyRef.current && !committedRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  const uploadBusy = (id: string, value: boolean) => {
    if (value) uploadLocksRef.current.add(id);
    else uploadLocksRef.current.delete(id);
    busyRef.current = uploadLocksRef.current.size > 0;
    setBusy(busyRef.current);
  };
  async function send(payload: Record<string, unknown>) {
    if (busyRef.current || committedRef.current || !action) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `purchaseRequests/${detail.record.id}/action`,
        json: payload,
      });
      committedRef.current = true;
      setCommitted(true);
      dirtyRef.current = false;
      parent.reload();
      toaster.show({ type: 'success', title: t('purchases.saved') });
      void navigate('..');
    } catch (failure) {
      setError(failure);
      if (!(failure instanceof ApiClientError) || failure.status >= 500)
        setUncertain(true);
      else {
        setUncertain(false);
        if (failure.status === 404) parent.reload();
        const paths = fieldViolationsOf(failure);
        const translated = paths.map((path) =>
          path.replace(/^actualCents$/, 'actual'),
        );
        translated.forEach((path) =>
          form.setError(path as 'actual', {
            message: t('purchases.fieldInvalid'),
          }),
        );
        if (translated[0]) form.setFocus(translated[0] as 'actual');
        else
          requestAnimationFrame(() =>
            document.getElementById('purchase-pricing-error')?.focus(),
          );
        if (failure.status === 409) refresh();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const submit = (values: z.infer<typeof schema>) => {
    if (!action || frozen) return;
    const input =
      values.mode === 'close'
        ? {}
        : {
            actualCents: parseAmountCents(values.actual),
            selectedVendorId: values.selectedVendorId,
            quotes: values.quotes,
          };
    const base = {
      target: action.target,
      action: actionName,
      input,
      comment: values.comment || undefined,
      contentHash: action.contentHash ?? undefined,
    };
    const signature = JSON.stringify(base);
    if (attemptRef.current?.signature !== signature)
      attemptRef.current = {
        signature,
        id: createRequestId(),
        payload: base,
      };
    setConfirmation({
      ...attemptRef.current.payload,
      requestId: attemptRef.current.id,
    });
  };
  const invalid = (errors: FieldErrors<z.infer<typeof schema>>) => {
    if (errors.mode) {
      form.setFocus('mode');
      return;
    }
    if (errors.actual) {
      form.setFocus('actual');
      return;
    }
    if (errors.selectedVendorId) {
      form.setFocus('selectedVendorId');
      return;
    }
    if (Array.isArray(errors.quotes)) {
      for (let index = 0; index < rows.fields.length; index++) {
        if (form.getFieldState(`quotes.${index}.vendorId`).invalid) {
          form.setFocus(`quotes.${index}.vendorId`);
          return;
        }
        if (form.getFieldState(`quotes.${index}.attachmentIds`).invalid) {
          document.getElementById(`purchase-quote-file-${index}`)?.focus();
          return;
        }
      }
    }
    if (errors.quotes) {
      document.getElementById('purchase-quotes-error')?.focus();
      return;
    }
    if (errors.comment) form.setFocus('comment');
  };
  const vendorField = (
    name: 'selectedVendorId' | `quotes.${number}.vendorId`,
    id: string,
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{t('purchases.vendor')} *</FieldLabel>
          <Select
            value={field.value}
            onValueChange={(value) => {
              field.onChange(value);
              if (name.startsWith('quotes.')) {
                const index = Number(name.split('.')[1]);
                form.setValue(`quotes.${index}.attachmentIds`, [], {
                  shouldDirty: true,
                });
              }
            }}
            disabled={frozen}
          >
            <SelectTrigger
              ref={field.ref}
              id={id}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              className='h-auto min-h-9'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
              <SelectGroup>
                {options.data?.vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id} disabled={!v.active}>
                    <span className='whitespace-normal wrap-anywhere'>
                      {v.name} · {v.category}
                      {!v.active ? ` (${t('purchases.inactive')})` : ''}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
  return (
    <>
      {discardDialog}
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                mode === 'close'
                  ? 'purchases.confirmForceClose'
                  : 'purchases.confirmPricing',
                { name: detail.record.number ?? t('approvals.draft') },
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                mode === 'close'
                  ? 'purchases.forceCloseDescription'
                  : overEstimate
                    ? 'purchases.priceWillReturn'
                    : 'purchases.pricingSubmitConsequence',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <Button
              variant={mode === 'close' ? 'destructive' : 'default'}
              disabled={frozen}
              onClick={() => {
                if (confirmation) {
                  void send(confirmation);
                  setConfirmation(undefined);
                }
              }}
            >
              {t('actions.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <PageHeader
        title={t(`purchases.${forced ? 'forcePricing' : 'completePricing'}`)}
        actions={
          <>
            <Button
              type='submit'
              form='purchase-pricing-form'
              disabled={frozen}
            >
              {t('actions.confirm')}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    aria-label={t('approvals.refresh')}
                    disabled={busy || uncertain || committed}
                    onClick={() => {
                      refresh();
                      options.reload();
                    }}
                  />
                }
              >
                <RefreshCw
                  className={
                    !sourceReady || options.loading ? 'animate-spin' : undefined
                  }
                />
              </TooltipTrigger>
              <TooltipContent>{t('approvals.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      />
      <PurchaseFacts
        detail={detail}
        record={detail.record}
        applicant={
          detail.users.find((u) => u.id === detail.record.applicantId)?.name ??
          t('approvals.unknownPerson')
        }
      />
      {sourceError ? <ErrorState error={sourceError} retry={refresh} /> : null}
      {initialBasis !== detail.quoteBasisHash ? (
        <Alert>
          <AlertDescription>
            {t('purchases.quoteBasisChanged')}
          </AlertDescription>
        </Alert>
      ) : null}
      {options.error ? (
        <ErrorState error={options.error} retry={options.reload} />
      ) : null}
      {!action ? (
        <Alert>
          <AlertDescription>{t('approvals.unavailable')}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <div id='purchase-pricing-error' tabIndex={-1}>
          <ErrorState
            error={error}
            retry={
              uncertain
                ? () => {
                    if (attemptRef.current)
                      void send({
                        ...attemptRef.current.payload,
                        requestId: attemptRef.current.id,
                      });
                  }
                : refresh
            }
          />
        </div>
      ) : null}
      {uncertain ? (
        <Alert>
          <AlertDescription>{t('purchases.unknownPricing')}</AlertDescription>
        </Alert>
      ) : null}
      <form
        id='purchase-pricing-form'
        onSubmit={(event) => {
          void form.handleSubmit(submit, invalid)(event);
        }}
      >
        <FieldGroup>
          {forced ? (
            <Controller
              name='mode'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor='purchase-force-mode'>
                    {t('purchases.forceMode')}
                  </FieldLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={frozen}
                  >
                    <SelectTrigger id='purchase-force-mode' ref={field.ref}>
                      <SelectValue
                        placeholder={t('purchases.chooseForceMode')}
                      />
                    </SelectTrigger>
                    <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                      <SelectGroup>
                        <SelectItem value='priced'>
                          <span className='whitespace-normal wrap-anywhere'>
                            {t('purchases.forcePriced')}
                          </span>
                        </SelectItem>
                        <SelectItem value='close'>
                          <span className='whitespace-normal wrap-anywhere'>
                            {t('purchases.forceClose')}
                          </span>
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {t('purchases.forceCloseDescription')}
                  </FieldDescription>
                </Field>
              )}
            />
          ) : null}
          {mode === 'priced' ? (
            <>
              <Field data-invalid={!!form.formState.errors.actual}>
                <FieldLabel htmlFor='purchase-actual'>
                  {t('purchases.actualAmount')} *
                </FieldLabel>
                <Input
                  id='purchase-actual'
                  inputMode='decimal'
                  disabled={frozen}
                  {...form.register('actual')}
                  aria-invalid={!!form.formState.errors.actual}
                />
                <FieldError errors={[form.formState.errors.actual]} />
                <FieldDescription>
                  {t(
                    overEstimate
                      ? 'purchases.priceWillReturn'
                      : 'purchases.priceConfirmationDescription',
                  )}
                </FieldDescription>
              </Field>
              {vendorField('selectedVendorId', 'purchase-selected-vendor')}
              <Field>
                <FieldLabel>{t('purchases.quoteEvidence')}</FieldLabel>
                <FieldDescription>
                  {t('purchases.quoteEvidenceDescription')}
                </FieldDescription>
                <div id='purchase-quotes-error' tabIndex={-1}>
                  <FieldError
                    errors={[
                      !Array.isArray(form.formState.errors.quotes)
                        ? form.formState.errors.quotes
                        : undefined,
                    ]}
                  />
                </div>
                {rows.fields.map((row, i) => (
                  <div
                    key={row.id}
                    className='flex flex-col gap-4 rounded-md border p-4'
                  >
                    {vendorField(
                      `quotes.${i}.vendorId`,
                      `purchase-quote-vendor-${i}`,
                    )}
                    <Controller
                      name={`quotes.${i}.attachmentIds`}
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Field data-invalid={fieldState.invalid}>
                          <PurchaseAttachmentEditor
                            purchaseId={detail.record.id}
                            ids={field.value}
                            onChange={field.onChange}
                            vendorId={quoteValues[i]?.vendorId ?? ''}
                            basisHash={detail.quoteBasisHash}
                            version={detail.record.lifecycleVersion}
                            inputId={`purchase-quote-file-${i}`}
                            ensureDraft={async () => detail.record.id}
                            disabled={frozen || !quoteValues[i]?.vendorId}
                            onBusyChange={(value) => uploadBusy(row.id, value)}
                          />
                          <FieldError errors={[fieldState.error]} />
                        </Field>
                      )}
                    />
                    <Button
                      type='button'
                      variant='outline'
                      disabled={frozen}
                      onClick={() => rows.remove(i)}
                    >
                      {t('purchases.removeQuote')}
                    </Button>
                  </div>
                ))}
                <Button
                  type='button'
                  variant='outline'
                  disabled={frozen || rows.fields.length >= 10}
                  onClick={() =>
                    rows.append({ vendorId: '', attachmentIds: [] })
                  }
                >
                  {t('purchases.addQuote')}
                </Button>
              </Field>
            </>
          ) : (
            <Alert>
              <AlertDescription>
                {t('purchases.forceCloseDescription')}
              </AlertDescription>
            </Alert>
          )}
          <Field data-invalid={!!form.formState.errors.comment}>
            <FieldLabel htmlFor='purchase-pricing-comment'>
              {t('approvals.reason')}
              {forced ? ' *' : ''}
            </FieldLabel>
            <Textarea
              id='purchase-pricing-comment'
              disabled={frozen}
              {...form.register('comment')}
            />
            <FieldError errors={[form.formState.errors.comment]} />
          </Field>
        </FieldGroup>
      </form>
    </>
  );
}
