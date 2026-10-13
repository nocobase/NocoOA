import {
  useRequestFormSubmission,
  preventComposingSubmit,
} from '#hooks/use-request-form-submission';
import {
  RequestFormButtons,
  RequestSubmissionFeedback,
} from '#components/request-form-submission';
import { useEffect, useState, useRef } from 'react';
import { useParams, useOutletContext } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useToaster } from '@nocobase/app-client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RouteDrawer } from '#components/route-drawer';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { useRouteOverlay } from '#components/use-route-overlay';
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
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
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
import { Spinner } from '#components/ui/spinner';
import { useCertificateResource } from './resource.js';
import { useCertificateCommand } from './command.js';
import { CertificateError, CertificateSkeleton } from './states.js';
import {
  TYPES,
  RESOURCE,
  DELIVERY,
  selectWidth,
  type Detail,
  type Context,
} from './types.js';
export default function CertificateForm() {
  const revision = useAuthorizationRevision(),
    { session } = useAuthentication();
  return <Overlay key={`${revision}:${session?.user.id}`} />;
}
function Overlay() {
  const { t } = useTranslation(),
    { certificateId } = useParams(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  const busyRef = useRef(false),
    dirtyRef = useRef(false),
    pendingCloseRef = useRef<((v: boolean) => void) | null>(null),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <RouteDrawer
      printable
      className='text-sm sm:max-w-2xl'
      title={t(`certificates.${certificateId ? 'edit' : 'new'}`)}
      beforeClose={() =>
        busyRef.current
          ? false
          : dirtyRef.current
            ? new Promise<boolean>((resolve) => {
                pendingCloseRef.current = resolve;
                setConfirm(true);
              })
            : true
      }
      footer={<Footer busy={busy} />}
    >
      <FormBody
        key={`${revision}:${session?.user.id}:${certificateId ?? 'new'}`}
        certificateId={certificateId}
        busyRef={busyRef}
        onBusy={setBusy}
        dirtyRef={dirtyRef}
      />
      <AlertDialog
        open={confirm}
        onOpenChange={(value) => {
          setConfirm(value);
          if (!value) {
            pendingCloseRef.current?.(false);
            pendingCloseRef.current = null;
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('certificates.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('certificates.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('certificates.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirtyRef.current = false;
                pendingCloseRef.current?.(true);
                pendingCloseRef.current = null;
                setConfirm(false);
              }}
            >
              {t('certificates.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDrawer>
  );
}
function Footer({ busy }: { busy: boolean }) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('certificates.cancel')}
      </Button>
      <RequestFormButtons
        resource={RESOURCE}
        submitAction='edit'
        form='certificate-form'
        busy={busy}
      />
    </>
  );
}
function FormBody({
  certificateId,
  busyRef,
  onBusy,
  dirtyRef,
}: {
  certificateId?: string;
  busyRef: React.RefObject<boolean>;
  onBusy: (value: boolean) => void;
  dirtyRef: React.RefObject<boolean>;
}) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<Context>(),
    toaster = useToaster();
  const r = useCertificateResource<{ data: Detail }>(
    certificateId
      ? `certificateRequests/${encodeURIComponent(certificateId)}`
      : null,
  );
  return r.error ? (
    <CertificateError error={r.error} retry={r.reload} />
  ) : r.loading ? (
    <CertificateSkeleton />
  ) : certificateId &&
    !r.data?.data.capabilities.transitions.includes('edit') ? (
    <CertificateError error={{}} />
  ) : (
    <Fields
      key={r.data?.data.record.lifecycleVersion ?? 'new'}
      certificateId={certificateId}
      detail={r.data?.data}
      busyRef={busyRef}
      onBusy={onBusy}
      dirtyRef={dirtyRef}
      saved={(submitted) => {
        dirtyRef.current = false;
        busyRef.current = false;
        parent.reload();
        toaster.show({
          type: 'success',
          title: submitted
            ? t('approvals.submitted', { name: t('certificates.new') })
            : t('certificates.saved'),
        });
        void close();
      }}
    />
  );
}
function Fields({
  detail,
  busyRef,
  onBusy,
  dirtyRef,
  saved,
}: {
  certificateId?: string;
  detail?: Detail;
  busyRef: React.RefObject<boolean>;
  onBusy: (value: boolean) => void;
  dirtyRef: React.RefObject<boolean>;
  saved: (submitted: boolean) => void;
}) {
  const { t } = useTranslation(),
    cmd = useCertificateCommand();
  const submission = useRequestFormSubmission<Detail['record']>({
    replayUnknownCreate: true,
    resource: 'certificateRequests',
    suffix: 'submit',
    keyField: 'requestKey',
    versionField: 'expectedVersion',
    recordResult: 'direct',
  });
  const [submitError, setSubmitError] = useState<unknown>();
  const schema = z.object({
    certificateType: z.enum(TYPES),
    purpose: z
      .string()
      .trim()
      .min(1, t('certificates.required'))
      .max(2000, t('certificates.invalidPurpose')),
    copies: z.coerce
      .number()
      .int(t('certificates.invalidCopies'))
      .min(1, t('certificates.invalidCopies'))
      .max(100, t('certificates.invalidCopies')),
    deliveryMethod: z.enum(DELIVERY),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      certificateType: (detail?.record.certificateType ??
        'employment') as (typeof TYPES)[number],
      purpose: detail?.record.purpose ?? '',
      copies: detail?.record.copies ?? 1,
      deliveryMethod: (detail?.record.deliveryMethod ??
        'pickup') as (typeof DELIVERY)[number],
    },
  });
  useEffect(() => {
    busyRef.current = cmd.busy || form.formState.isSubmitting;
    dirtyRef.current = form.formState.isDirty;
    onBusy(cmd.busy || form.formState.isSubmitting);
  }, [
    cmd.busy,
    form.formState.isSubmitting,
    form.formState.isDirty,
    busyRef,
    dirtyRef,
    onBusy,
  ]);
  useEffect(() => {
    const names = [
      'certificateType',
      'deliveryMethod',
      'purpose',
      'copies',
    ] as const;
    fieldViolationsOf(cmd.error).forEach((field, index) => {
      const name = names.find((name) => name === field.replace(/^body\./, ''));
      if (name)
        form.setError(
          name,
          { message: t('certificates.invalidInput') },
          { shouldFocus: index === 0 },
        );
    });
  }, [cmd.error, form, t]);
  return (
    <form
      id='certificate-form'
      onSubmitCapture={submission.captureIntent}
      onKeyDown={preventComposingSubmit}
      className='flex flex-col gap-4'
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          setSubmitError(undefined);
          try {
            const draft = await submission.save(
              values,
              detail?.record,
              async (current) => {
                const result = await cmd.execute<{ data: Detail['record'] }>(
                  current
                    ? `certificateRequests/${encodeURIComponent(current.id)}`
                    : 'certificateRequests',
                  current ? 'PUT' : 'POST',
                  {
                    ...values,
                    ...(current
                      ? { expectedVersion: current.lifecycleVersion }
                      : {}),
                  },
                );
                if (!result) throw new Error(t('approvals.creationUnknown'));
                return result.data;
              },
            );
            await submission.finish(draft);
            form.reset(values);
            saved(submission.intent.current === 'submit');
          } catch (error) {
            setSubmitError(error);
          }
        })(event);
      }}
    >
      <RequestSubmissionFeedback
        failed={submission.submitFailed}
        unknown={submission.submitUnknown}
      />
      {submitError || cmd.error ? (
        <CertificateError error={cmd.error ?? submitError} />
      ) : null}
      <FieldGroup inert={submission.submitUnknown || undefined}>
        {(['certificateType', 'deliveryMethod'] as const).map((name) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={name}>
                  {t(
                    `certificates.${name === 'certificateType' ? 'type' : 'delivery'}`,
                  )}{' '}
                  *
                </FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={cmd.busy || form.formState.isSubmitting}
                >
                  <SelectTrigger
                    id={name}
                    ref={field.ref}
                    aria-describedby={
                      fieldState.invalid ? `${name}-error` : undefined
                    }
                    onBlur={field.onBlur}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue>
                      {t(
                        `certificates.${name === 'certificateType' ? 'types' : 'deliveries'}.${field.value}`,
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className={selectWidth}>
                    <SelectGroup>
                      {(name === 'certificateType' ? TYPES : DELIVERY).map(
                        (value) => (
                          <SelectItem key={value} value={value}>
                            {t(
                              `certificates.${name === 'certificateType' ? 'types' : 'deliveries'}.${value}`,
                            )}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError id={`${name}-error`} errors={[fieldState.error]} />
              </Field>
            )}
          />
        ))}
        <Field>
          <FieldLabel htmlFor='purpose'>
            {t('certificates.purpose')} *
          </FieldLabel>
          <Textarea
            id='purpose'
            aria-invalid={!!form.formState.errors.purpose}
            aria-describedby={
              form.formState.errors.purpose ? 'purpose-error' : undefined
            }
            {...form.register('purpose')}
            disabled={cmd.busy || form.formState.isSubmitting}
          />
          <FieldError
            id='purpose-error'
            errors={[form.formState.errors.purpose]}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='copies'>{t('certificates.copies')} *</FieldLabel>
          <Input
            id='copies'
            aria-invalid={!!form.formState.errors.copies}
            aria-describedby={
              form.formState.errors.copies ? 'copies-error' : undefined
            }
            type='number'
            min={1}
            max={100}
            {...form.register('copies')}
            disabled={cmd.busy || form.formState.isSubmitting}
          />
          <FieldError
            id='copies-error'
            errors={[form.formState.errors.copies]}
          />
        </Field>
      </FieldGroup>
      {cmd.busy ? <Spinner /> : null}
    </form>
  );
}
