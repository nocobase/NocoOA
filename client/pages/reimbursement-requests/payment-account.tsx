import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { Link, useLocation, useOutletContext } from 'react-router';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
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
import type { DetailContext, ReimbursementRecord } from './types.js';

export interface PaymentAccount {
  requestId: string;
  bankName: string | null;
  bankAccount: string | null;
  bankAccountName: string | null;
  version: number;
}
function usePrivateAccount(record: ReimbursementRecord) {
  const { session } = useAuthentication();
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'paymentAccount',
  });
  const viewer = session?.user.id ?? '';
  // Viewer identity is part of the source key: an account from a previous session
  // must disappear synchronously, before the next request can complete.
  const resource = useResource<PaymentAccount | null>(
    permission.can && viewer
      ? `reimbursementRequests/${encodeURIComponent(record.id)}/paymentAccount`
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
  record: ReimbursementRecord;
  refreshKey: number;
  canWrite: boolean;
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
        {t('reimbursementRequests.bank.title')}
      </h2>
      {resource.error ? (
        resource.error instanceof ApiClientError &&
        resource.error.status === 403 ? (
          <p className='text-sm text-muted-foreground'>
            {t('reimbursementRequests.bank.denied')}
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
                  {t(`reimbursementRequests.bank.${key}`)}
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
          {t('reimbursementRequests.bank.missing')}
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
          {t('reimbursementRequests.bank.correct')}
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
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  return (
    <RouteDrawer
      title={t('reimbursementRequests.bank.correct')}
      footer={null}
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
        <p>{t('reimbursementRequests.bank.denied')}</p>
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.loading && !resource.data ? (
        <FieldsSkeleton fields={3} />
      ) : !resource.data ||
        !resource.owner ||
        detail.record.status !== 'exception' ? (
        <p>{t('reimbursementRequests.bank.unavailable')}</p>
      ) : (
        <AccountForm
          key={detail.record.id}
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
function AccountForm({
  account,
  loading,
  onBusy,
  onDirty,
  reloadAccount,
}: {
  account: PaymentAccount;
  loading: boolean;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  reloadAccount: () => void;
}) {
  const { detail, reload } = useOutletContext<DetailContext>();
  const api = useApiClient(),
    toaster = useToaster(),
    { t } = useTranslation(),
    { close } = useRouteOverlay();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);
  const form = useForm({
    defaultValues: {
      bankName: account.bankName ?? '',
      bankAccount: account.bankAccount ?? '',
      bankAccountName: account.bankAccountName ?? '',
    },
  });
  useEffect(() => {
    onDirty(form.formState.isDirty);
  }, [onDirty, form.formState.isDirty]);
  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          if (lockRef.current || loading) return;
          lockRef.current = true;
          setBusy(true);
          onBusy(true);
          setError(undefined);
          try {
            await api.request({
              method: 'PATCH',
              path: `reimbursementRequests/${detail.record.id}/paymentAccount`,
              json: {
                version: detail.record.lifecycleVersion,
                payeeVersion: account.version,
                account: Object.fromEntries(
                  Object.entries(values).map(([k, v]) => [k, v.trim()]),
                ),
              },
            });
            form.reset(values);
            onDirty(false);
            reloadAccount();
            reload();
            toaster.show({
              type: 'success',
              title: t('reimbursementRequests.bank.saved'),
            });
            onBusy(false);
            lockRef.current = false;
            await close();
          } catch (cause) {
            setError(cause);
          } finally {
            lockRef.current = false;
            setBusy(false);
            onBusy(false);
          }
        })(event);
      }}
      className='flex flex-col gap-4'
    >
      {error ? <ErrorState error={error} retry={reloadAccount} /> : null}
      <FieldGroup>
        {(['bankName', 'bankAccount', 'bankAccountName'] as const).map(
          (key) => (
            <Field key={key} data-invalid={!!form.formState.errors[key]}>
              <FieldLabel htmlFor={`reimbursement-${key}`}>
                {t(`reimbursementRequests.bank.${key}`)} *
              </FieldLabel>
              <Input
                id={`reimbursement-${key}`}
                autoComplete='off'
                disabled={busy || loading}
                aria-invalid={!!form.formState.errors[key]}
                {...form.register(key, {
                  validate: (v) => !!v.trim() || t('approvals.required'),
                  maxLength: {
                    value: key === 'bankAccount' ? 64 : 128,
                    message: t('approvals.limit'),
                  },
                })}
              />
              <FieldError errors={[form.formState.errors[key]]} />
            </Field>
          ),
        )}
      </FieldGroup>
      <div className='flex flex-wrap justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={busy || loading}
          onClick={() => void close()}
        >
          {t('approvals.cancel')}
        </Button>
        <Button type='submit' disabled={busy || loading}>
          {t('approvals.save')}
        </Button>
      </div>
    </form>
  );
}
