import { createRequestKey } from '#lib/request-key';
import { ValidationFailure } from './validation.js';
import { Spinner } from '#components/ui/spinner';
import { preventComposingSubmit } from '#hooks/use-request-form-submission';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
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
} from '#components/ui/alert-dialog';
import { useCloseGuard } from '../recruitment/use-close-guard.js';
import { Failure } from '../work-items/states.js';
import { useMutationBoundary } from './resource.js';
import type { Source } from './types.js';
export function Command({
  title,
  printable = false,
  path,
  children,
  body,
  clear,
  submitLabel,
  destructive = false,
  confirmation,
  externalBusy = false,
}: {
  title: string;
  printable?: boolean;
  path: string;
  children: (props: {
    disabled: boolean;
    changed: (id?: string) => void;
    invalid: (id: string) => boolean;
    errorFor: (id: string) => string | undefined;
  }) => ReactNode;
  body: () => unknown;
  clear: () => void;
  submitLabel?: string;
  destructive?: boolean;
  confirmation?: string;
  externalBusy?: boolean;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    parent = useOutletContext<Source>(),
    location = useLocation(),
    navigate = useNavigate(),
    boundary = useMutationBoundary();
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false),
    lockRef = useRef(false),
    requestRef = useRef<unknown>(undefined);
  const [confirmAction, setConfirmAction] = useState(false);
  const [invalidFields, setInvalidFields] = useState<string[]>([]),
    [fieldMessages, setFieldMessages] = useState<Record<string, string>>({});
  const guard = useCloseGuard(busy || externalBusy),
    disabled = busy || uncertain || blocked || externalBusy;
  useEffect(() => {
    if (done && !busy)
      void navigate({
        pathname: '..',
        search: location.search,
        hash: location.hash,
      });
  }, [done, busy, navigate, location.search, location.hash]);
  async function save(retry = false) {
    if (lockRef.current || blocked || externalBusy) return;
    const signal = boundary.getSignal();
    if (!retry) {
      try {
        requestRef.current = {
          ...(body() as object),
          requestId: createRequestKey(),
        };
      } catch (cause) {
        if (cause instanceof ValidationFailure) {
          setInvalidFields(cause.fields);
          setFieldMessages(cause.messages);
          document.getElementById(cause.fields[0] ?? '')?.focus();
        } else setError(cause);
        return;
      }
      setInvalidFields([]);
    }
    if (!requestRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path,
        method: 'POST',
        json: requestRef.current,
        signal,
      });
      if (signal.aborted) return;
      guard.saved();
      parent.reload();
      toaster.show({ type: 'success', title: t('onboarding.saved') });
      setDone(true);
      setUncertain(false);
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause);
      const unknown = !(cause instanceof ApiClientError) || cause.status >= 500;
      setUncertain(unknown);
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404, 409, 412].includes(cause.status)
      ) {
        clear();
        requestRef.current = undefined;
        setBlocked(true);
        parent.reload();
      }
    } finally {
      if (!signal.aborted) {
        lockRef.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <RouteDrawer
        printable={printable}
        title={title}
        beforeClose={guard.beforeClose}
        footer={
          <Button
            type='submit'
            form='onboarding-command'
            disabled={disabled}
            variant={destructive ? 'destructive' : 'default'}
          >
            {busy ? (
              <>
                <Spinner />
                {t('onboarding.loading')}
              </>
            ) : (
              (submitLabel ?? t('onboarding.save'))
            )}
          </Button>
        }
      >
        <form
          id='onboarding-command'
          noValidate
          onKeyDown={preventComposingSubmit}
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) {
              if (destructive) setConfirmAction(true);
              else void save();
            }
          }}
        >
          {error ? <Failure module='onboarding' error={error} /> : null}
          {children({
            disabled,
            changed: (id) => {
              guard.changed();
              if (id) {
                setInvalidFields((old) => old.filter((field) => field !== id));
                setFieldMessages((old) =>
                  Object.fromEntries(
                    Object.entries(old).filter(([field]) => field !== id),
                  ),
                );
              }
            },
            invalid: (id) => invalidFields.includes(id),
            errorFor: (id) => fieldMessages[id],
          })}
        </form>
        {uncertain ? (
          <Alert>
            <AlertDescription>{t('onboarding.unknown')}</AlertDescription>
            <Button disabled={busy} onClick={() => void save(true)}>
              {t('onboarding.retryExact')}
            </Button>
          </Alert>
        ) : null}
      </RouteDrawer>
      <AlertDialog open={confirmAction} onOpenChange={setConfirmAction}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('onboarding.stay')}</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={busy}
              onClick={() => {
                setConfirmAction(false);
                void save();
              }}
            >
              {submitLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={guard.confirm}
        onOpenChange={(open) => {
          if (!open) guard.stay();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('onboarding.discard')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('onboarding.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={guard.stay}>
              {t('onboarding.stay')}
            </AlertDialogCancel>
            <Button variant='destructive' onClick={guard.discard}>
              {t('onboarding.discard')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
