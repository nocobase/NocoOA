import { useRouteFormCloseGuard } from '#hooks/use-route-form-close-guard';
import {
  useRequestFormSubmission,
  preventComposingSubmit,
} from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { LeaveAttachmentEditor } from './attachments.js';
import { createRequestId } from './request-id.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { format, parseISO } from 'date-fns';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { z } from 'zod';
import { BackButton } from '#components/back-button';
import { DatePicker } from '#components/date-picker';
import { UserPicker } from '#components/user-picker';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteFormPage } from '#components/route-form-page';
import { Button } from '#components/ui/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
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
import {
  ApprovalUiProvider,
  ApprovalRoutePreview,
} from '#extensions/nocobase-approval-ui';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from './use-resource.js';
import { ErrorState } from './states.js';
import { routeOf } from './approval-mapping.js';
import type {
  LeaveDetail,
  LeaveOptions,
  LeavePreview,
  LeaveRecord,
  SourceContext,
  DetailContext,
} from './types.js';

const POPUP =
  'w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal';
export default function LeaveFormPage() {
  const { t: drawerTitle } = useTranslation();
  const { requestId } = useParams();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const options = useResource<LeaveOptions>('leaveRequests/options');
  const detail = useResource<LeaveDetail>(
    requestId ? `leaveRequests/${encodeURIComponent(requestId)}` : null,
  );
  const missingErrorRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (missingErrorRef.current === detail.error) return;
    missingErrorRef.current = detail.error;
    if (detail.error instanceof ApiClientError && detail.error.status === 404)
      parent.reload();
  }, [detail.error, parent]);
  return (
    <RouteFormPage
      printable
      title={drawerTitle(
        requestId ? 'approvals.editLeave' : 'approvals.newLeave',
      )}
    >
      <PageContainer>
        {options.error || detail.error ? (
          <>
            <BackButton />
            <ErrorState
              error={options.error ?? detail.error}
              retry={() => {
                options.reload();
                detail.reload();
              }}
            />
          </>
        ) : !options.data || (requestId && !detail.data) ? (
          <FieldsSkeleton fields={8} />
        ) : (
          <LeaveForm
            key={
              requestId
                ? `${requestId}:${detail.data?.record.lifecycleVersion}`
                : 'new'
            }
            options={options.data}
            detail={detail.data}
            onReload={detail.reload}
          />
        )}
      </PageContainer>
    </RouteFormPage>
  );
}
function LeaveForm({
  options,
  detail,
  onReload,
}: {
  options: LeaveOptions;
  detail?: LeaveDetail;
  onReload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { session } = useAuthentication();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const parent = useOutletContext<SourceContext & Partial<DetailContext>>();
  const canCreate = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'submit',
  }).can;
  const canDelegate = useCan({
    resource: { type: 'composite', id: 'oa.leave' },
    action: 'delegate',
  }).can;
  const canPick = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const submission = useRequestFormSubmission<LeaveRecord>({
    resource: 'leaveRequests',
  });
  const schema = useMemo(
    () =>
      z
        .object({
          applicantId: z.string(),
          leaveType: z.string().min(1, t('approvals.required')),
          startDate: z.string().min(1, t('approvals.required')),
          endDate: z.string().min(1, t('approvals.required')),
          startHalf: z.enum(['am', 'pm']),
          endHalf: z.enum(['am', 'pm']),
          reason: z
            .string()
            .trim()
            .min(1, t('approvals.required'))
            .max(10000, t('approvals.limit')),
          handoverUserId: z.string(),
          enableDelegation: z.boolean(),
        })
        .refine(
          (v) => `${v.startDate}:${v.startHalf}` <= `${v.endDate}:${v.endHalf}`,
          { path: ['endDate'], message: t('approvals.dateRange') },
        )
        .refine((v) => !v.enableDelegation || !!v.handoverUserId, {
          path: ['handoverUserId'],
          message: t('approvals.handoverRequired'),
        }),
    [t],
  );
  const [createdDraft, setCreatedDraft] = useState<LeaveRecord>();
  const record = detail?.record ?? createdDraft;
  const [attachments, setAttachments] = useState<string[]>(
    detail?.record.attachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      applicantId: record?.applicantId ?? '',
      leaveType: record?.leaveType ?? '',
      startDate: record?.startDate ?? '',
      endDate: record?.endDate ?? '',
      startHalf: record?.startHalf ?? 'am',
      endHalf: record?.endHalf ?? 'pm',
      reason: record?.reason ?? '',
      handoverUserId: record?.handoverUserId ?? '',
      enableDelegation: record?.enableDelegation ?? false,
    },
  });
  const values = useWatch({ control: form.control });
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [writeError, setWriteError] = useState<unknown>();
  const [preview, setPreview] = useState<{
    key: string;
    data?: LeavePreview;
    error?: unknown;
  }>();
  const [saved, setSaved] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);

  const [discard, setDiscard] = useState(false);
  const busy = form.formState.isSubmitting || uploading;
  const dirty =
    (form.formState.isDirty ||
      JSON.stringify(attachments) !==
        JSON.stringify(record?.attachments ?? [])) &&
    !saved;
  useRouteFormCloseGuard(() => {
    if (busy) return false;
    if (!dirty || saved) return true;
    setDiscard(true);
    return false;
  });
  // AppClientProviders hosts a declarative router. Its public navigation guard preserves the mounted form
  // when a sidebar link or browser history traversal is declined; React Router useBlocker requires a data router.
  useNavigationGuard(() => {
    if (saved || (!dirty && !busy)) return true;
    if (busy) return false;
    return window.confirm(t('approvals.discardDescription'));
  });
  useEffect(() => {
    if (saved && nextPath)
      void navigate(
        { pathname: nextPath, search: location.search },
        { relative: 'route', replace: true },
      );
  }, [saved, nextPath, navigate, location.search]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);
  const previewInput = {
    leaveType: values.leaveType,
    startDate: values.startDate,
    endDate: values.endDate,
    startHalf: values.startHalf,
    endHalf: values.endHalf,
    reason: values.reason ?? '',
    attachments,
    handoverUserId: values.handoverUserId || null,
    enableDelegation: values.enableDelegation ?? false,
  };
  const previewKey = JSON.stringify(previewInput);
  const proxy = record
    ? record.applicantId !== session?.user.id
    : !!values.applicantId && values.applicantId !== session?.user.id;
  useEffect(() => {
    const input = JSON.parse(previewKey) as typeof previewInput;
    if (
      proxy ||
      !input.leaveType ||
      !input.startDate ||
      !input.endDate ||
      !input.reason?.trim()
    )
      return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .request<{ data: LeavePreview }>({
          method: 'POST',
          path: 'leaveRequests/preview',
          json: input,
          signal: controller.signal,
        })
        .then(
          ({ data }) => {
            if (!controller.signal.aborted)
              setPreview({ key: previewKey, data });
          },
          (error: unknown) => {
            if (!controller.signal.aborted)
              setPreview({ key: previewKey, error });
          },
        );
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [api, previewKey, proxy]);
  const text = {
    t: (key: string, args?: Record<string, unknown>) => t(key, args),
    name: (id: string | null | undefined) =>
      (preview?.key === previewKey ? preview.data?.users : undefined)?.find(
        (p) => p.id === id,
      )?.name ??
      detail?.users.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      t(`approvals.stages.${key}`, { defaultValue: t('approvals.progress') }),
  };
  const halfItems = [
    { value: 'am', label: t('approvals.am') },
    { value: 'pm', label: t('approvals.pm') },
  ];
  const types = options.leaveTypes
    .filter((type) => type.active)
    .map((type) => ({
      value: type.code,
      label:
        type.label[i18n.language] ?? type.label['en-US'] ?? type.label['zh-CN'],
    }));
  const denied = detail?.record
    ? !detail?.view.available.some((a) => a.name === 'edit' && a.allowed)
    : !canCreate;
  async function ensureDraft() {
    if (record) return record.id;
    if (!(await form.trigger())) throw new Error('Invalid draft');
    const input = form.getValues();
    const { data } = await api.request<{ data: { record: LeaveRecord } }>({
      method: 'POST',
      path: 'leaveRequests',
      json: {
        ...input,
        applicantId: input.applicantId || undefined,
        handoverUserId: input.handoverUserId || null,
        attachments: [],
      },
    });
    setCreatedDraft(data.record);
    parent.reload();
    return data.record.id;
  }
  async function submit(input: z.infer<typeof schema>) {
    if (uploading) return;
    setWriteError(undefined);
    try {
      const json = {
        ...input,
        attachments,
        handoverUserId: input.handoverUserId || null,
      };
      const savedRecord = await submission.save(
        json,
        record,
        async (current) => {
          let result: LeaveRecord;
          if (current) {
            const { data } = await api.request<{
              data: { record: LeaveRecord };
            }>({
              method: 'POST',
              path: `leaveRequests/${current.id}/transition`,
              json: {
                transition: 'edit',
                version: current.lifecycleVersion,
                requestId: createRequestId(),
                input: { ...json, applicantId: undefined },
              },
            });
            result = data.record;
          } else {
            const { data } = await api.request<{
              data: { record: LeaveRecord };
            }>({
              method: 'POST',
              path: 'leaveRequests',
              json: { ...json, applicantId: input.applicantId || undefined },
            });
            result = data.record;
          }
          setCreatedDraft(result);
          return result;
        },
      );
      const result = await submission.finish(savedRecord);
      form.reset(input);
      setSaved(true);
      parent.update?.(result);
      parent.reload();
      toaster.show({
        type: 'success',
        title: t(
          submission.intent.current === 'submit'
            ? 'approvals.submitted'
            : 'approvals.saved',
          {
            name: result.number ?? t('approvals.draft'),
          },
        ),
      });
      const fromDetail =
        !!detail?.record && !location.pathname.includes('/editLeave/');
      setNextPath(
        fromDetail || submission.intent.current === 'submit'
          ? '..'
          : `../leave/${result.id}`,
      );
    } catch (error) {
      setWriteError(error);
    }
  }
  const discardDialog = discard;
  return (
    <>
      <BackButton />
      <PageHeader
        title={t(record ? 'approvals.editLeave' : 'approvals.newLeave')}
        description={t('approvals.formDescription')}
        actions={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => {
                if (dirty) setDiscard(true);
                else {
                  setSaved(true);
                  setNextPath('..');
                }
              }}
            >
              {t('approvals.cancel')}
            </Button>
            <RequestFormButtons
              resource='oa.leave'
              form='leave-form'
              busy={busy}
              disabled={denied}
              revision={record?.status === 'revision'}
            />
          </>
        }
      />
      {denied ? (
        <Alert>
          <AlertDescription>{t('approvals.readOnly')}</AlertDescription>
        </Alert>
      ) : null}
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      {writeError ? (
        <ErrorState error={writeError} retry={() => setReloadConfirm(true)} />
      ) : null}
      <form
        id='leave-form'
        onSubmitCapture={submission.captureIntent}
        onKeyDown={preventComposingSubmit}
        className='max-w-3xl'
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        <FieldGroup inert={submission.submitUnknown || undefined}>
          {canDelegate && !record && canPick ? (
            <Controller
              name='applicantId'
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor='leave-applicant'>
                    {t('approvals.applicant')}
                  </FieldLabel>
                  <UserPicker
                    id='leave-applicant'
                    value={field.value}
                    onChange={field.onChange}
                    disabled={busy}
                    knownUsers={detail?.users}
                  />
                </Field>
              )}
            />
          ) : null}
          <Controller
            name='leaveType'
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor='leave-type'>
                  {t('approvals.type')} *
                </FieldLabel>
                <Select
                  items={types}
                  value={field.value || null}
                  onValueChange={(v) => field.onChange(v ?? '')}
                  disabled={busy || denied}
                >
                  <SelectTrigger
                    id='leave-type'
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={POPUP}>
                    <SelectGroup>
                      {types.map((v) => (
                        <SelectItem key={v.value} value={v.value}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          {(['startDate', 'endDate'] as const).map((fieldName) => (
            <Controller
              key={fieldName}
              name={fieldName}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`leave-${fieldName}`}>
                    {t(`approvals.${fieldName}`)} *
                  </FieldLabel>
                  <DatePicker
                    id={`leave-${fieldName}`}
                    className='w-full'
                    value={field.value ? parseISO(field.value) : undefined}
                    onChange={(v) =>
                      field.onChange(v ? format(v, 'yyyy-MM-dd') : '')
                    }
                    disabled={busy || denied}
                    invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
          {(['startHalf', 'endHalf'] as const).map((fieldName) => (
            <Controller
              key={fieldName}
              name={fieldName}
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={`leave-${fieldName}`}>
                    {t(`approvals.${fieldName}`)} *
                  </FieldLabel>
                  <Select
                    items={halfItems}
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={busy || denied}
                  >
                    <SelectTrigger id={`leave-${fieldName}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={POPUP}>
                      <SelectGroup>
                        {halfItems.map((v) => (
                          <SelectItem key={v.value} value={v.value}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          ))}
          <Field data-invalid={!!form.formState.errors.reason}>
            <FieldLabel htmlFor='leave-reason'>
              {t('approvals.reason')} *
            </FieldLabel>
            <Textarea
              id='leave-reason'
              {...form.register('reason')}
              aria-invalid={!!form.formState.errors.reason}
              disabled={busy || denied}
            />
            <FieldError errors={[form.formState.errors.reason]} />
          </Field>
          {canPick ? (
            <Controller
              name='handoverUserId'
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor='leave-handover'>
                    {t('approvals.handover')}
                    {values.enableDelegation ? ' *' : ''}
                  </FieldLabel>
                  <UserPicker
                    id='leave-handover'
                    value={field.value}
                    onChange={field.onChange}
                    disabled={busy || denied}
                    knownUsers={detail?.users}
                    excludeIds={
                      values.applicantId ? [values.applicantId] : undefined
                    }
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ) : (
            <FieldDescription>
              {t('approvals.noPickerPermission')}
            </FieldDescription>
          )}
          <Controller
            name='enableDelegation'
            control={form.control}
            render={({ field }) => (
              <Field orientation='horizontal'>
                <Checkbox
                  id='leave-delegate'
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={busy || denied || !canPick}
                />
                <FieldLabel htmlFor='leave-delegate'>
                  {t('approvals.delegate')}
                </FieldLabel>
              </Field>
            )}
          />
          <LeaveAttachmentEditor
            leaveId={record?.id}
            ids={attachments}
            onChange={setAttachments}
            ensureDraft={ensureDraft}
            disabled={busy || denied}
            onBusyChange={setUploading}
          />
          {!options.balanceAvailable ? (
            <Alert>
              <AlertDescription>{t('approvals.balanceLimit')}</AlertDescription>
            </Alert>
          ) : null}
          {options.timeZone ? (
            <FieldDescription>
              {t('approvals.calendarTimeZone', { zone: options.timeZone })}
            </FieldDescription>
          ) : null}
          {proxy ? (
            <FieldDescription>{t('approvals.hrPreview')}</FieldDescription>
          ) : preview?.key === previewKey && preview.data ? (
            <ApprovalUiProvider personName={text.name}>
              <FieldDescription>
                {t('approvals.days')}: {preview.data.days}
              </FieldDescription>
              <ApprovalRoutePreview
                applicantId={record?.applicantId ?? ''}
                route={routeOf(preview.data.route, text)}
              />
            </ApprovalUiProvider>
          ) : preview?.key === previewKey && preview.error ? (
            <Alert>
              <AlertDescription>{t('approvals.error.failed')}</AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </form>
      <AlertDialog open={reloadConfirm} onOpenChange={setReloadConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('approvals.loadLatest')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('approvals.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('approvals.cancel')}</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                setReloadConfirm(false);
                onReload();
              }}
            >
              {t('approvals.loadLatest')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={discardDialog}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDiscard(false);
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
              disabled={busy}
              onClick={() => {
                setSaved(true);
                setDiscard(false);
                setNextPath('..');
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
