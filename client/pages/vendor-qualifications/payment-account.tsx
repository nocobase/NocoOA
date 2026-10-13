import { Missing } from './missing.js';
import { useCloseGuard } from './use-close-guard.js';
import { DiscardConfirmation } from './shared.js';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { usePrivateAccount } from './private-account.js';
import { finalRefusal } from './errors.js';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';

import { useTranslation } from '@nocobase/i18n/client';
import { Link, useLocation, useOutletContext } from 'react-router';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { FieldsSkeleton } from '../platform/shared/states.js';

import { ErrorState } from './states.js';
import type { QualificationRecord, DetailContext } from './types.js';
export function PaymentAccountSection({
  record,
  refreshKey,
  canWrite,
  onMissing,
  focusList,
}: {
  record: QualificationRecord;
  refreshKey: number;
  canWrite: boolean;
  onMissing?: () => void;
  focusList?: () => void;
}) {
  const resource = usePrivateAccount(record),
    { t } = useTranslation(),
    location = useLocation();
  const lastRef = useRef(refreshKey);
  const reloadAccount = resource.reload;
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (lastRef.current !== refreshKey) {
        lastRef.current = refreshKey;
        reloadAccount();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadAccount]);
  if (resource.error instanceof ApiClientError && resource.error.status === 404)
    return (
      <Missing name={record.name} onMissing={onMissing} focusList={focusList} />
    );
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-base font-medium'>
        {t('vendorQualifications.account.title')}
      </h2>
      {!resource.allowed ? (
        <p className='text-sm text-muted-foreground'>
          {t('vendorQualifications.account.denied')}
        </p>
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : resource.loading ? (
        <FieldsSkeleton fields={3} />
      ) : resource.data?.account ? (
        <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
          {(['bankName', 'bankAccount', 'bankAccountName'] as const).map(
            (key) => (
              <div className='contents' key={key}>
                <dt className='text-muted-foreground'>
                  {t(`vendorQualifications.account.${key}`)}
                </dt>
                <dd className='min-w-0 break-all'>
                  {resource.data!.account![key] || '—'}
                </dd>
              </div>
            ),
          )}
        </dl>
      ) : (
        <p>{t('vendorQualifications.account.missing')}</p>
      )}
      {canWrite &&
        resource.canWrite &&
        !resource.loading &&
        !resource.error &&
        resource.data?.account && (
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: 'paymentAccount', search: location.search }}
              />
            }
          >
            {t('vendorQualifications.account.edit')}
          </Button>
        )}
    </section>
  );
}
export default function BankDialog() {
  const { session } = useAuthentication();
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const { detail } = useOutletContext<DetailContext>(),
    { t } = useTranslation(),
    busyRef = useRef(false);
  const guard = useCloseGuard(saving);
  return (
    <RouteDrawer
      className='sm:max-w-md'
      title={t('vendorQualifications.account.edit')}
      beforeClose={guard.beforeClose}
      footer={<Footer busy={saving} ready={ready} />}
    >
      <BankForm
        key={`${detail.record.id}:${session?.user.id ?? ''}`}
        busyRef={busyRef}
        onBusy={setSaving}
        onDirty={guard.changed}
        onSaved={guard.saved}
        onReady={setReady}
      />
      <DiscardConfirmation
        open={guard.confirm}
        stay={guard.stay}
        discard={guard.discard}
      />
    </RouteDrawer>
  );
}
function Footer({ busy, ready }: { busy: boolean; ready: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button
        variant='outline'
        disabled={busy}
        onClick={() => {
          if (!busy) void close();
        }}
      >
        {t('vendorQualifications.common.cancel')}
      </Button>
      <Button
        form='qualification-bank-form'
        type='submit'
        disabled={busy || !ready}
      >
        {t('vendorQualifications.common.save')}
      </Button>
    </>
  );
}
function BankForm({
  busyRef,
  onBusy,
  onDirty,
  onSaved,
  onReady,
}: {
  busyRef: React.RefObject<boolean>;
  onBusy: (busy: boolean) => void;
  onDirty: () => void;
  onSaved: () => void;
  onReady: (ready: boolean) => void;
}) {
  const parent = useOutletContext<DetailContext>(),
    resource = usePrivateAccount(parent.detail.record),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    { t } = useTranslation();
  const [input, setInput] = useState({
      bankName: '',
      bankAccount: '',
      bankAccountName: '',
      reason: '',
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [blocked, setBlocked] = useState(false),
    [required, setRequired] = useState(false);
  const loadedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (resource.data?.account && !loadedRef.current) {
        loadedRef.current = true;
        const { bankName, bankAccount, bankAccountName } =
          resource.data.account;
        setInput({ bankName, bankAccount, bankAccountName, reason: '' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resource.data]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (
        (!resource.allowed && loadedRef.current) ||
        finalRefusal(resource.error)
      ) {
        setInput({
          bankName: '',
          bankAccount: '',
          bankAccountName: '',
          reason: '',
        });
        setBlocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resource.allowed, resource.error]);
  const writable =
    parent.writable &&
    resource.canWrite &&
    !resource.loading &&
    !resource.error &&
    !!resource.data?.account &&
    !blocked;
  useEffect(() => onReady(writable && !busy), [writable, busy, onReady]);
  async function save() {
    if (!writable || busyRef.current) return;
    if (!input.reason.trim()) {
      setRequired(true);
      document.getElementById('qualification-bank-reason')?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const { reason, ...account } = input;
      await api.request({
        method: 'PATCH',
        path: `vendorQualifications/${parent.detail.record.id}/paymentAccount`,
        json: {
          lifecycleVersion: resource.data!.lifecycleVersion,
          bankVersion: resource.data!.account!.version,
          reason,
          account,
        },
      });
      toaster.show({
        type: 'success',
        title: t('vendorQualifications.savedNamed', {
          name: parent.detail.record.name,
        }),
      });
      parent.reload();
      onSaved();
      busyRef.current = false;
      await close();
    } catch (cause) {
      setError(cause);
      if (finalRefusal(cause)) {
        setInput({
          bankName: '',
          bankAccount: '',
          bankAccountName: '',
          reason: '',
        });
        setBlocked(true);
      } else if (cause instanceof ApiClientError && cause.status === 409) {
        setBlocked(true);
        resource.reload();
        parent.reloadDetail();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  if (
    [resource.error, error].some(
      (v) => v instanceof ApiClientError && v.status === 404,
    )
  )
    return (
      <Missing
        name={parent.detail.record.name}
        onMissing={parent.reload}
        focusList={parent.focusList}
        allowNavigation={onSaved}
      />
    );
  return (
    <>
      {!!resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}{' '}
      {!!error && (
        <ErrorState
          error={error}
          retry={() => {
            resource.reload();
            parent.reloadDetail();
            setBlocked(false);
          }}
        />
      )}
      {resource.allowed && resource.loading ? (
        <FieldsSkeleton fields={4} />
      ) : !resource.allowed ? (
        <p>{t('vendorQualifications.account.denied')}</p>
      ) : !resource.data?.account ? (
        <p>{t('vendorQualifications.account.missing')}</p>
      ) : (
        <form
          id='qualification-bank-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            {(
              ['bankName', 'bankAccount', 'bankAccountName', 'reason'] as const
            ).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`qualification-bank-${key}`}>
                  {t(`vendorQualifications.account.${key}`)}
                  {key === 'reason' ? ' *' : ''}
                </FieldLabel>
                <Input
                  id={`qualification-bank-${key}`}
                  value={input[key]}
                  disabled={!writable || busy}
                  maxLength={key === 'reason' ? 4000 : 255}
                  onChange={(event) => {
                    onDirty();
                    setInput((v) => ({ ...v, [key]: event.target.value }));
                    if (key === 'reason')
                      setRequired(!event.target.value.trim());
                  }}
                />
                {key === 'reason' && required && (
                  <FieldError>
                    {t('vendorQualifications.common.required')}
                  </FieldError>
                )}
              </Field>
            ))}
          </FieldGroup>
          {busy && <Spinner />}
        </form>
      )}
    </>
  );
}
