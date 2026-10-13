import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { Link, useLocation, useOutletContext } from 'react-router';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Spinner } from '#components/ui/spinner';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
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
import { ErrorState } from './states.js';
import type { DetailContext, PaymentRecord, PaymentDetail } from './types.js';

export interface PaymentAccount {
  requestId: string;
  bankName: string | null;
  bankAccount: string | null;
  bankAccountName: string | null;
  version: number;
}
function usePrivateAccount(record: PaymentRecord) {
  const { session } = useAuthentication();
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.payment' },
    action: 'paymentAccount',
  });
  const viewer = session?.user.id ?? '';
  // Viewer identity is part of the source key: an account from a previous session
  // must disappear synchronously, before the next request can complete.
  const resource = useResource<PaymentAccount | null>(
    permission.can && viewer
      ? `paymentRequests/${encodeURIComponent(record.id)}/paymentAccount`
      : null,
    { viewer },
  );
  return {
    ...resource,
    allowed: permission.can && !!viewer,
    owner: viewer === record.applicantId || viewer === record.createdById,
  };
}
export function PaymentAccountSection({
  record,
  refreshKey,
  canWrite,
}: {
  record: PaymentRecord;
  refreshKey: number;
  canWrite: boolean;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const resource = usePrivateAccount(record);
  const reload = resource.reload;
  const refreshRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshRef.current !== refreshKey) {
      refreshRef.current = refreshKey;
      reload();
    }
  }, [refreshKey, reload]);
  if (!resource.allowed) return null;
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-base font-medium'>
        {t('paymentRequestsForm.bank.title')}
      </h2>
      {resource.error ? (
        resource.error instanceof ApiClientError &&
        resource.error.status === 403 ? (
          <p className='text-sm text-muted-foreground'>
            {t('paymentRequestsForm.bank.denied')}
          </p>
        ) : (
          <ErrorState error={resource.error} retry={reload} />
        )
      ) : resource.loading ? (
        <FieldsSkeleton fields={3} />
      ) : resource.data ? (
        <dl className='grid gap-3 sm:grid-cols-[9rem_1fr]'>
          {(['bankName', 'bankAccount', 'bankAccountName'] as const).map(
            (key) => (
              <div className='contents' key={key}>
                <dt className='text-muted-foreground'>
                  {t(`paymentRequestsForm.bank.${key}`)}
                </dt>
                <dd className='min-w-0 break-all'>
                  {resource.data?.[key] || '—'}
                </dd>
              </div>
            ),
          )}
        </dl>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('paymentRequestsForm.bank.missing')}
        </p>
      )}
      {canWrite &&
      resource.owner &&
      record.status === 'exception' &&
      resource.data &&
      !resource.loading &&
      !resource.error ? (
        <Button
          variant='outline'
          nativeButton={false}
          render={
            <Link
              to={{ pathname: 'paymentAccount', search: location.search }}
            />
          }
        >
          {t('paymentRequestsForm.bank.correct')}
        </Button>
      ) : null}
    </section>
  );
}
export default function PaymentAccountDialog() {
  const { detail } = useOutletContext<DetailContext>();
  const { t } = useTranslation();
  const resource = usePrivateAccount(detail.record);
  const busyRef = useRef(false),
    dirtyRef = useRef(false);
  const [discard, setDiscard] = useState(false);
  const [footerState, setFooterState] = useState({
    disabled: true,
    busy: false,
  });
  const reportFooter = useCallback(
    (state: { disabled: boolean; busy: boolean }) =>
      setFooterState((old) =>
        old.disabled === state.disabled && old.busy === state.busy
          ? old
          : state,
      ),
    [],
  );
  const eligible =
    resource.allowed &&
    !resource.error &&
    !!resource.data &&
    resource.owner &&
    detail.record.status === 'exception';
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  return (
    <RouteDrawer
      className='sm:max-w-md'
      title={t('paymentRequestsForm.bank.correct')}
      footer={
        <AccountFooter
          canWrite={eligible}
          disabled={footerState.disabled || resource.loading}
          busy={footerState.busy}
        />
      }
      beforeClose={() => {
        if (busyRef.current) return false;
        if (!dirtyRef.current) return true;
        setDiscard(true);
        return new Promise<boolean>((done) => {
          resolveRef.current = done;
        });
      }}
    >
      {!resource.allowed ? (
        <p>{t('paymentRequestsForm.bank.denied')}</p>
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.loading && !resource.data ? (
        <FieldsSkeleton fields={3} />
      ) : !resource.data ||
        !resource.owner ||
        detail.record.status !== 'exception' ? (
        <p>{t('paymentRequestsForm.bank.unavailable')}</p>
      ) : (
        <AccountForm
          key={detail.record.id}
          inlineActions={false}
          onState={reportFooter}
          account={resource.data}
          loading={resource.loading}
          onBusy={(v) => {
            busyRef.current = v;
          }}
          onDirty={(v) => {
            dirtyRef.current = v;
          }}
          reloadAccount={resource.reload}
        />
      )}
      <AlertDialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) {
            setDiscard(false);
            resolveRef.current?.(false);
            resolveRef.current = null;
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
                resolveRef.current?.(true);
                resolveRef.current = null;
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
function AccountFooter({
  canWrite,
  disabled,
  busy,
}: {
  canWrite: boolean;
  disabled: boolean;
  busy: boolean;
}) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={() => void close()}
      >
        {t('approvals.cancel')}
      </Button>
      {canWrite ? (
        <Button type='submit' form='payment-account-form' disabled={disabled}>
          {busy ? <Spinner aria-label={t('status.loading')} /> : null}
          {t('approvals.save')}
        </Button>
      ) : null}
    </>
  );
}
export function AccountForm({
  account,
  loading,
  onBusy,
  onDirty,
  reloadAccount,
  inlineActions = true,
  onState,
}: {
  account: PaymentAccount;
  inlineActions?: boolean;
  onState?: (state: { disabled: boolean; busy: boolean }) => void;
  loading: boolean;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  reloadAccount: () => void;
}) {
  const { detail, reloadDetail, reload } = useOutletContext<DetailContext>(),
    api = useApiClient(),
    toaster = useToaster(),
    { t } = useTranslation(),
    { close } = useRouteOverlay();
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [unknown, setUnknown] = useState(false),
    [reconciled, setReconciled] = useState(false);
  const [version, setVersion] = useState({
    lifecycle: detail.record.lifecycleVersion,
    payee: account.version,
  });
  const lockRef = useRef(false),
    attemptRef = useRef<{
      bankName: string;
      bankAccount: string;
      bankAccountName: string;
    }>(undefined);
  const form = useForm({
    defaultValues: {
      bankName: account.bankName ?? '',
      bankAccount: account.bankAccount ?? '',
      bankAccountName: account.bankAccountName ?? '',
      reason: '',
    },
  });
  const [firstError, setFirstError] = useState<{
    field: 'bankName' | 'bankAccount' | 'bankAccountName' | 'reason';
  }>();
  useEffect(() => {
    if (!busy && firstError) form.setFocus(firstError.field);
  }, [busy, form, firstError]);
  useEffect(() => {
    onDirty(form.formState.isDirty || unknown);
  }, [onDirty, form.formState.isDirty, unknown]);
  useEffect(() => {
    onState?.({ disabled: busy || loading || blocked || unknown, busy });
  }, [busy, loading, blocked, unknown, onState]);
  function working(v: boolean) {
    lockRef.current = v;
    setBusy(v);
    onBusy(v);
  }
  async function reconcile() {
    if (lockRef.current) return;
    working(true);
    try {
      const [{ data: latest }, { data: business }] = await Promise.all([
        api.request<{ data: PaymentAccount | null }>({
          path: `paymentRequests/${detail.record.id}/paymentAccount`,
        }),
        api.request<{ data: PaymentDetail }>({
          path: `paymentRequests/${detail.record.id}`,
        }),
      ]);
      if (!latest || business.record.status !== 'exception') {
        setBlocked(true);
        setUnknown(false);
        setError(new Error('Unavailable'));
        return;
      }
      const attempted = attemptRef.current;
      const matches =
        unknown &&
        attempted &&
        (['bankName', 'bankAccount', 'bankAccountName'] as const).every(
          (k) => latest[k] === attempted[k],
        ) &&
        latest.version > version.payee;
      if (matches) {
        setUnknown(false);
        setBlocked(false);
        form.reset(form.getValues());
        onDirty(false);
        toaster.show({
          type: 'success',
          title: t('paymentRequestsForm.bank.saved'),
        });
        reload();
        reloadDetail();
        working(false);
        await close();
        return;
      }
      setVersion({
        lifecycle: business.record.lifecycleVersion,
        payee: latest.version,
      });
      setBlocked(false);
      setUnknown(false);
      setReconciled(true);
      setError(undefined);
      reloadAccount();
      reloadDetail();
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        [401, 403].includes(cause.status)
      ) {
        form.reset({
          bankName: '',
          bankAccount: '',
          bankAccountName: '',
          reason: '',
        });
        onDirty(false);
        reloadAccount();
      }
      setError(cause);
      setBlocked(true);
    } finally {
      working(false);
    }
  }
  return (
    <form
      id='payment-account-form'
      className='flex flex-col gap-4'
      onSubmit={(e) => {
        void form.handleSubmit(async (values) => {
          if (lockRef.current || loading || blocked || unknown) return;
          working(true);
          setError(undefined);
          setReconciled(false);
          const submitted = {
            bankName: values.bankName.trim(),
            bankAccount: values.bankAccount.trim(),
            bankAccountName: values.bankAccountName.trim(),
          };
          attemptRef.current = submitted;
          try {
            await api.request({
              method: 'PATCH',
              path: `paymentRequests/${detail.record.id}/paymentAccount`,
              json: {
                lifecycleVersion: version.lifecycle,
                payeeVersion: version.payee,
                reason: values.reason.trim(),
                account: submitted,
              },
            });
            form.reset(values);
            onDirty(false);
            reloadAccount();
            reload();
            reloadDetail();
            toaster.show({
              type: 'success',
              title: t('paymentRequestsForm.bank.saved'),
            });
            working(false);
            await close();
          } catch (cause) {
            if (
              cause instanceof ApiClientError &&
              [401, 403].includes(cause.status)
            ) {
              form.reset({
                bankName: '',
                bankAccount: '',
                bankAccountName: '',
                reason: '',
              });
              onDirty(false);
              reloadAccount();
            }
            setError(cause);
            const violations = fieldViolationsOf(cause);
            let first:
              | 'bankName'
              | 'bankAccount'
              | 'bankAccountName'
              | 'reason'
              | undefined;
            for (const raw of violations) {
              const field = raw.replace(/^account\./, '');
              if (
                [
                  'bankName',
                  'bankAccount',
                  'bankAccountName',
                  'reason',
                ].includes(field)
              ) {
                const name = field as NonNullable<typeof first>;
                form.setError(name, {
                  type: 'server',
                  message: t('paymentRequestsForm.invalid'),
                });
                first ??= name;
              }
            }
            setFirstError(first ? { field: first } : undefined);
            setBlocked(
              !(cause instanceof ApiClientError) ||
                ![400, 412].includes(cause.status),
            );
            if (!(cause instanceof ApiClientError) || cause.status >= 500)
              setUnknown(true);
          } finally {
            working(false);
          }
        })(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
      }}
    >
      {error ? (
        <ErrorState error={error} retry={() => void reconcile()} />
      ) : null}
      {blocked || unknown ? (
        <>
          <p role='status' className='text-sm text-muted-foreground'>
            {t(
              unknown
                ? 'paymentRequestsForm.bank.unknown'
                : 'paymentRequestsForm.bank.conflict',
            )}
          </p>
          <Button
            type='button'
            variant='outline'
            disabled={busy || loading}
            onClick={() => void reconcile()}
          >
            {t('approvals.loadLatest')}
          </Button>
        </>
      ) : null}
      {reconciled ? (
        <p role='status' className='text-sm'>
          {t('paymentRequestsForm.bank.reconciled')}
        </p>
      ) : null}
      <FieldGroup>
        {(
          ['bankName', 'bankAccount', 'bankAccountName', 'reason'] as const
        ).map((key) => (
          <Field key={key} data-invalid={!!form.formState.errors[key]}>
            <FieldLabel htmlFor={`payment-${key}`}>
              {t(`paymentRequestsForm.bank.${key}`)} *
            </FieldLabel>
            <Input
              id={`payment-${key}`}
              autoComplete='off'
              disabled={busy || loading || blocked || unknown}
              aria-invalid={!!form.formState.errors[key]}
              {...form.register(key, {
                validate: (v) => !!v.trim() || t('approvals.required'),
                maxLength: {
                  value: key === 'reason' ? 4000 : 255,
                  message: t('approvals.limit'),
                },
              })}
            />
            <FieldError errors={[form.formState.errors[key]]} />
          </Field>
        ))}
      </FieldGroup>
      {inlineActions ? (
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={busy || loading}
            onClick={() => void close()}
          >
            {t('approvals.cancel')}
          </Button>
          <Button
            type='submit'
            disabled={busy || loading || blocked || unknown}
          >
            {busy ? <Spinner aria-label={t('status.loading')} /> : null}
            {t('approvals.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
