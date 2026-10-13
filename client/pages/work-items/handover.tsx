import { createRequestKey } from '#lib/request-key';
import { UserName } from '#components/user-name';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import {
  ApiClientError,
  useApiClient,
  useNavigationGuard,
  useToaster,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import {
  useAuthorizationRevision,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { RouteDrawer } from '#components/route-drawer';
import { UserPicker } from '#components/user-picker';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { Spinner } from '#components/ui/spinner';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { useWorkResource } from './resource.js';
import { Failure, Loading } from './states.js';
import { resource, type Envelope, type Item, type Source } from './types.js';

export default function Handover() {
  const { session } = useAuthentication(),
    revision = useAuthorizationRevision(),
    { workItemId } = useParams();
  return (
    <Body
      key={`${session?.user.id}:${revision}:${workItemId}`}
      id={workItemId!}
    />
  );
}

function Body({ id }: { id: string }) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    source = useOutletContext<Source>(),
    location = useLocation(),
    navigate = useNavigate(),
    grant = useCan({ resource, action: 'handoverConfirmation' }),
    users = useCan({ resource: { type: 'user', id: '*' }, action: 'read' }),
    r = useWorkResource<Envelope<Item>>(`workItems/${id}`),
    d = r.data?.data;
  const form = useForm({
    defaultValues: { toUserId: '', reason: '' },
    mode: 'onBlur',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [discard, setDiscard] = useState(false);
  const busyRef = useRef(false),
    leaveRef = useRef(false),
    reloadRef = useRef(false),
    controllerRef = useRef(new AbortController()),
    commandRef = useRef<{ payload: string; requestId: string } | undefined>(
      undefined,
    );
  const terminal =
      error instanceof ApiClientError && [401, 403, 404].includes(error.status),
    conflict = error instanceof ApiClientError && error.status === 409,
    allowed = !!d?.canHandoverConfirmation && grant.can && !grant.isPending,
    locked =
      busy ||
      r.loading ||
      !!r.error ||
      terminal ||
      conflict ||
      !allowed ||
      !users.can ||
      users.isPending;
  const back = {
    pathname: source.detailPath ?? `${source.basePath}/${id}`,
    search: location.search,
    hash: location.hash,
  };
  const exit = () => {
    leaveRef.current = true;
    void navigate(back, { replace: true });
  };
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (terminal || (!grant.isPending && !grant.can)) form.reset();
  }, [terminal, grant.can, grant.isPending, form]);
  useNavigationGuard(() => {
    if (busyRef.current) return false;
    if (leaveRef.current || !form.formState.isDirty) return true;
    setDiscard(true);
    return false;
  });
  useEffect(() => {
    if (!form.formState.isDirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [form.formState.isDirty, busy]);
  async function submit(values: { toUserId: string; reason: string }) {
    if (busyRef.current || locked || !d?.confirmationOwnerUserId) return;
    const excluded = [
      d.confirmationOwnerUserId,
      d.assigneeUserId,
      !d.dutyRoleCode ? d.targetUserId : null,
    ];
    if (excluded.includes(values.toUserId)) {
      form.setError(
        'toUserId',
        { message: t('workItems.invalid') },
        { shouldFocus: true },
      );
      document.getElementById('handover-target')?.focus();
      return;
    }
    const body = {
      fromUserId: d.confirmationOwnerUserId,
      toUserId: values.toUserId,
      expectedVersion: d.version,
      reason: values.reason.trim(),
    };
    const payload = JSON.stringify(body);
    if (commandRef.current?.payload !== payload)
      commandRef.current = { payload, requestId: createRequestKey() };
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.request<Envelope<Item>>({
        path: `workItems/${id}/handoverConfirmation`,
        method: 'POST',
        json: { ...body, requestId: commandRef.current.requestId },
        signal: controllerRef.current.signal,
      });
      if (controllerRef.current.signal.aborted) return;
      r.update(result);
      form.reset();
      source.reload();
      toaster.show({ title: t('workItems.handoverSaved'), type: 'success' });
      busyRef.current = false;
      setBusy(false);
      exit();
    } catch (failure) {
      if (!controllerRef.current.signal.aborted) setError(failure);
    } finally {
      if (!controllerRef.current.signal.aborted) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function requestClose() {
    if (busyRef.current) return false;
    if (form.formState.isDirty) {
      setDiscard(true);
      return false;
    }
    return true;
  }
  return (
    <>
      <RouteDrawer
        title={t('workItems.handoverTitle')}
        closeTo={back}
        className='sm:max-w-2xl'
        beforeClose={requestClose}
        footer={
          <>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => {
                if (requestClose()) exit();
              }}
            >
              {t('workItems.cancel')}
            </Button>
            {allowed && !terminal ? (
              <Button
                type='submit'
                form='confirmation-handover'
                disabled={locked}
              >
                {busy ? <Spinner /> : null}
                {t('workItems.handoverTitle')}
              </Button>
            ) : null}
          </>
        }
      >
        {r.loading && !d ? (
          <Loading />
        ) : r.error ? (
          <Failure error={r.error} retry={r.reload} />
        ) : !allowed ? (
          <Failure denied />
        ) : terminal ? (
          <Failure error={error} />
        ) : d ? (
          <>
            {error ? <Failure error={error} /> : null}
            {conflict ? (
              <Button
                variant='outline'
                onClick={() => {
                  reloadRef.current = true;
                  setDiscard(true);
                }}
              >
                {t('workItems.reload')}
              </Button>
            ) : null}
            <p>{t('workItems.handoverNotice')}</p>
            <p>
              {t('workItems.confirmationOwner')}:{' '}
              <UserName name={d.confirmationOwner?.name ?? '—'} />
            </p>
            {!users.isPending && !users.can ? (
              <p>{t('workItems.handoverPickerDenied')}</p>
            ) : null}
            <form
              id='confirmation-handover'
              onSubmit={(event) => {
                void form.handleSubmit(submit)(event);
              }}
            >
              <FieldGroup>
                <Controller
                  control={form.control}
                  name='toUserId'
                  rules={{ required: t('workItems.invalid') }}
                  render={({ field, fieldState }) => (
                    <Field>
                      <FieldLabel htmlFor='handover-target'>
                        {t('workItems.handoverTarget')}
                      </FieldLabel>
                      <UserPicker
                        id='handover-target'
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={locked}
                        invalid={!!fieldState.error}
                        knownUsers={
                          d.confirmationOwner ? [d.confirmationOwner] : []
                        }
                        excludeIds={[
                          d.confirmationOwnerUserId,
                          d.assigneeUserId,
                          !d.dutyRoleCode ? d.targetUserId : null,
                        ].filter((v): v is string => !!v)}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Field>
                  <FieldLabel htmlFor='handover-reason'>
                    {t('workItems.reason')}
                  </FieldLabel>
                  <Textarea
                    id='handover-reason'
                    maxLength={2000}
                    disabled={locked}
                    aria-invalid={!!form.formState.errors.reason}
                    {...form.register('reason', {
                      validate: (v) => !!v.trim() || t('workItems.invalid'),
                      maxLength: {
                        value: 2000,
                        message: t('workItems.invalid'),
                      },
                    })}
                  />
                  <FieldError errors={[form.formState.errors.reason]} />
                </Field>
              </FieldGroup>
            </form>
          </>
        ) : null}
      </RouteDrawer>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('workItems.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('workItems.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                reloadRef.current = false;
              }}
            >
              {t('workItems.continue')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                if (reloadRef.current) {
                  reloadRef.current = false;
                  form.reset();
                  setError(undefined);
                  setDiscard(false);
                  r.reload();
                } else exit();
              }}
            >
              {t('workItems.leave')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
