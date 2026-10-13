import { useBusinessErrorFormatter } from '#hooks/use-business-error-message';
import { createRequestKey } from '#lib/request-key';
import {
  useRequestFormSubmission,
  preventComposingSubmit,
} from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ApiClientError,
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useParams,
  useOutletContext,
  useNavigate,
  useLocation,
} from 'react-router';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { DateTimePicker } from '#components/date-time-picker';
import {
  Field,
  FieldGroup,
  FieldSet,
  FieldLegend,
  FieldLabel,
  FieldError,
  FieldDescription,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Switch } from '#components/ui/switch';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { useVehicleResource } from './resource.js';
import { Loading, VehicleError, FormError } from './states.js';
import { errorKey } from './errors.js';
import type { Options, Detail, Request, Source } from './types.js';
export default function RequestForm() {
  const { t: drawerTitle } = useTranslation();
  const { requestId } = useParams(),
    { t } = useTranslation(),
    o = useVehicleResource<{ data: Options }>('vehicleBrowser/options'),
    r = useVehicleResource<{ data: Detail }>(
      requestId
        ? `vehicleBrowser/requests/${encodeURIComponent(requestId)}`
        : null,
    ),
    parent = useOutletContext<Source>();
  const error = o.error ?? r.error,
    ready = requestId
      ? r.data?.data.transitions.includes('edit')
      : o.data?.data.canCreate;
  return (
    <RouteFormPage
      printable
      title={drawerTitle(requestId ? 'vehicles.edit' : 'vehicles.new')}
    >
      {error ? (
        <PageContainer>
          <BackButton />
          <VehicleError
            error={error}
            retry={() => {
              o.reload();
              r.reload();
            }}
          />
        </PageContainer>
      ) : o.loading || r.loading ? (
        <PageContainer>
          <BackButton />
          <Loading />
        </PageContainer>
      ) : ready && o.data ? (
        <Body
          key={`${requestId ?? 'new'}:${r.data?.data.record.lifecycleVersion ?? 0}`}
          record={r.data?.data.record}
          options={o.data.data}
          saved={parent.reload}
        />
      ) : (
        <PageContainer>
          <BackButton />
          <Alert>
            <AlertDescription>
              {t('vehicles.errors.forbidden')}
            </AlertDescription>
          </Alert>
        </PageContainer>
      )}
    </RouteFormPage>
  );
}
function Body({
  record,
  options,
  saved,
}: {
  record?: Request;
  options: Options;
  saved: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    navigate = useNavigate(),
    location = useLocation(),
    [discard, setDiscard] = useState(false),
    [draft, setDraft] = useState<Request>(),
    savedRef = useRef(false);
  const schema = useMemo(
    () =>
      z
        .object({
          purpose: z
            .string()
            .trim()
            .min(1, t('vehicles.validation.required'))
            .max(5000),
          destination: z
            .string()
            .trim()
            .min(1, t('vehicles.validation.required'))
            .max(5000),
          startAt: z.string().min(1, t('vehicles.validation.time')),
          endAt: z.string().min(1, t('vehicles.validation.time')),
          passengers: z
            .number()
            .int()
            .min(1, t('vehicles.validation.passengers'))
            .max(100000),
          needsDriver: z.boolean(),
        })
        .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
          path: ['endAt'],
          message: t('vehicles.validation.interval'),
        }),
    [t],
  );
  const businessError = useBusinessErrorFormatter('vehicles');
  const form = useForm({
      resolver: zodResolver(schema),
      defaultValues: {
        purpose: record?.purpose ?? '',
        destination: record?.destination ?? '',
        startAt: record?.startAt ?? '',
        endAt: record?.endAt ?? '',
        passengers: record?.passengers ?? 1,
        needsDriver: record?.needsDriver ?? false,
      },
    }),
    busy = form.formState.isSubmitting;
  const back = () =>
    navigate(
      { pathname: record ? '..' : '..', search: location.search },
      { relative: 'path' },
    );
  useNavigationGuard(() => {
    if (savedRef.current) return true;
    if (busy) return false;
    if (!form.formState.isDirty) return true;
    setDiscard(true);
    return false;
  });
  const submission = useRequestFormSubmission<Request>({
    replayUnknownCreate: true,
    resource: 'vehicleRequests',
    includeInput: false,
    suffix: 'transitions',
  });
  const submit = (event: FormEvent) =>
    form.handleSubmit(
      async (values) => {
        try {
          const commandKey = createRequestKey();
          const savedRecord = await submission.save(
            values,
            draft ?? record,
            async (base) => {
              let current = base;
              if (!current) {
                const created = await api.request<{
                  data: { record: Request };
                }>({
                  method: 'POST',
                  path: 'vehicleRequests',
                  json: { ...values, requestId: `${commandKey}:create` },
                });
                current = created.data.record;
                setDraft(current);
              } else {
                const edited = await api.request<{ data: { record: Request } }>(
                  {
                    method: 'POST',
                    path: `vehicleRequests/${current.id}/transitions`,
                    json: {
                      transition: 'edit',
                      version: current.lifecycleVersion,
                      requestId: `${commandKey}:edit`,
                      input: values,
                    },
                  },
                );
                current = edited.data.record;
                setDraft(current);
              }
              return current;
            },
          );
          const current = await submission.finish(savedRecord);
          setDraft(current);
          savedRef.current = true;
          form.reset(values);
          saved();
          toaster.show({
            type: 'success',
            title: t(
              submission.intent.current === 'submit'
                ? 'approvals.submitted'
                : 'vehicles.saved',
              { name: current.number ?? t('approvals.draft') },
            ),
          });
          await back();
        } catch (error) {
          const key = errorKey(error);
          form.setError('root', {
            type:
              error instanceof ApiClientError && error.status === 401
                ? 'sessionExpired'
                : 'server',
            message: businessError(error) ?? t(`vehicles.errors.${key}`),
          });
        }
      },
      (errors) =>
        document.getElementById(`vehicle-${Object.keys(errors)[0]}`)?.focus(),
    )(event);
  return (
    <PageContainer>
      <BackButton />
      <PageHeader
        title={t(record ? 'vehicles.edit' : 'vehicles.new')}
        actions={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void back()}
            >
              {t('vehicles.cancel')}
            </Button>
            <RequestFormButtons
              revision={record?.status === 'revision'}
              resource='oa.vehicleRequest'
              form='vehicle-request-form'
              busy={busy}
            />
          </>
        }
      />
      <form
        id='vehicle-request-form'
        onSubmitCapture={submission.captureIntent}
        onKeyDown={preventComposingSubmit}
        noValidate
        onSubmit={(e) => void submit(e)}
      >
        <RequestSubmissionFeedback
          failed={submission.submitFailed}
          unknown={submission.submitUnknown}
        />
        <FieldGroup inert={submission.submitUnknown || undefined}>
          <FormError error={form.formState.errors.root} />
          <FieldSet>
            <FieldLegend>{t('vehicles.content')}</FieldLegend>
            {(['purpose', 'destination'] as const).map((name) => (
              <Field key={name} data-invalid={!!form.formState.errors[name]}>
                <FieldLabel htmlFor={`vehicle-${name}`}>
                  {t(`vehicles.fields.${name}`)}
                </FieldLabel>
                <Textarea
                  id={`vehicle-${name}`}
                  aria-required
                  aria-invalid={!!form.formState.errors[name]}
                  disabled={busy}
                  {...form.register(name)}
                />
                <FieldError errors={[form.formState.errors[name]]} />
              </Field>
            ))}
          </FieldSet>
          <FieldSet>
            <FieldLegend>{t('vehicles.arrangement')}</FieldLegend>
            <FieldDescription>
              {t('vehicles.noReservation')} · {options.timeZone}
            </FieldDescription>
            {(['startAt', 'endAt'] as const).map((name) => (
              <Controller
                key={name}
                name={name}
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={!!fieldState.error}>
                    <FieldLabel htmlFor={`vehicle-${name}`}>
                      {t(`vehicles.fields.${name}`)}
                    </FieldLabel>
                    <DateTimePicker
                      id={`vehicle-${name}`}
                      value={field.value}
                      onChange={field.onChange}
                      timeZone={options.timeZone}
                      disabled={busy}
                      invalid={!!fieldState.error}
                      timeLabel={t(`vehicles.fields.${name}`)}
                    />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ))}
            <Field data-invalid={!!form.formState.errors.passengers}>
              <FieldLabel htmlFor='vehicle-passengers'>
                {t('vehicles.fields.passengers')}
              </FieldLabel>
              <Input
                id='vehicle-passengers'
                type='number'
                min={1}
                aria-required
                disabled={busy}
                {...form.register('passengers', { valueAsNumber: true })}
              />
              <FieldError errors={[form.formState.errors.passengers]} />
            </Field>
            <Controller
              name='needsDriver'
              control={form.control}
              render={({ field }) => (
                <Field orientation='horizontal'>
                  <FieldLabel htmlFor='vehicle-needsDriver'>
                    {t('vehicles.fields.needsDriver')}
                  </FieldLabel>
                  <Switch
                    id='vehicle-needsDriver'
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={busy}
                  />
                </Field>
              )}
            />
          </FieldSet>
        </FieldGroup>
      </form>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('vehicles.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('vehicles.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('vehicles.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                savedRef.current = true;
                void back();
              }}
            >
              {t('vehicles.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
