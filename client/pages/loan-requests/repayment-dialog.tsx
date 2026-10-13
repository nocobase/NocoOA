import { useRef, useState, useEffect } from 'react';
import { useOutletContext } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RouteDrawer } from '#components/route-drawer';
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
import { createRequestId } from '../approvals/request-id.js';
import { parseAmountCents } from './money.js';
import { ErrorState } from './states.js';
import type { DetailContext } from './types.js';
export default function RepaymentDialog() {
  const parent = useOutletContext<DetailContext>();
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'cashRepayment',
  });
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [discard, setDiscard] = useState(false);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  return (
    <RouteDrawer
      title={t('loanRequests.recordCash')}
      beforeClose={() => {
        if (busy) return false;
        if (!dirty) return true;
        setDiscard(true);
        return new Promise<boolean>((r) => {
          resolveRef.current = r;
        });
      }}
      footer={
        <Footer
          busy={busy}
          disabled={
            !permission.can ||
            permission.isPending ||
            !!permission.error ||
            parent.detail.record.status !== 'paid'
          }
        />
      }
    >
      <RepaymentForm onBusy={setBusy} onDirty={setDirty} />
      <AlertDialog
        open={discard}
        onOpenChange={(open) => {
          if (!open) {
            resolveRef.current?.(false);
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
            <AlertDialogCancel>{t('approvals.cancel')}</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                resolveRef.current?.(true);
                setDiscard(false);
              }}
            >
              {t('approvals.discard')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDrawer>
  );
}
function Footer({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={busy}
        onClick={() => {
          void close();
        }}
      >
        {t('approvals.cancel')}
      </Button>
      <Button type='submit' form='loan-cash-form' disabled={busy || disabled}>
        {t('loanRequests.recordCash')}
      </Button>
    </>
  );
}
function RepaymentForm({
  onBusy,
  onDirty,
}: {
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<DetailContext>();
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'cashRepayment',
  });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [committed, setCommitted] = useState(false);
  const attemptRef = useRef<{ payload: string; key: string } | null>(null);
  const schema = z.object({
    receiptId: z.string().trim().min(1, t('approvals.required')).max(128),
    amount: z
      .string()
      .refine(
        (v) => parseAmountCents(v) !== null,
        t('loanRequests.invalidAmount'),
      ),
    reason: z.string().trim().min(1, t('approvals.required')).max(10000),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { receiptId: '', amount: '', reason: '' },
  });
  useEffect(
    () => onDirty(form.formState.isDirty),
    [form.formState.isDirty, onDirty],
  );
  const allowed =
    permission.can &&
    !permission.isPending &&
    !permission.error &&
    parent.detail.record.status === 'paid';
  async function submit(values: z.infer<typeof schema>) {
    if (!allowed || busy || committed) return;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    const input = {
      operation: 'record',
      receiptId: values.receiptId,
      cents: parseAmountCents(values.amount),
      reason: values.reason,
    };
    const payload = JSON.stringify(input);
    if (attemptRef.current?.payload !== payload)
      attemptRef.current = { payload, key: createRequestId() };
    try {
      await api.request({
        method: 'POST',
        path: `loanRequests/${parent.detail.record.id}/repayments`,
        json: { ...input, requestKey: attemptRef.current.key },
      });
      setCommitted(true);
      onDirty(false);
      parent.reload();
      await close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <form
      id='loan-cash-form'
      className='flex flex-col gap-4'
      onSubmit={(event) => {
        void form.handleSubmit(submit)(event);
      }}
    >
      {!allowed ? (
        <Alert>
          <AlertDescription>
            {t('loanRequests.cashRestricted')}
          </AlertDescription>
        </Alert>
      ) : null}
      <p className='text-sm text-muted-foreground'>
        {t('loanRequests.pendingHint')}
      </p>
      {error ? (
        <ErrorState error={error} retry={() => setError(undefined)} />
      ) : null}
      <FieldGroup>
        {(['receiptId', 'amount', 'reason'] as const).map((name) => (
          <Field key={name} data-invalid={!!form.formState.errors[name]}>
            <FieldLabel htmlFor={`loan-cash-${name}`}>
              {t(
                name === 'receiptId'
                  ? 'loanRequests.receipt'
                  : name === 'amount'
                    ? 'loanRequests.amount'
                    : 'approvals.reason',
              )}{' '}
              *
            </FieldLabel>
            {name === 'reason' ? (
              <Textarea
                id={`loan-cash-${name}`}
                {...form.register(name)}
                disabled={!allowed || busy || committed}
                aria-invalid={!!form.formState.errors[name]}
              />
            ) : (
              <Input
                id={`loan-cash-${name}`}
                inputMode={name === 'amount' ? 'decimal' : undefined}
                {...form.register(name)}
                disabled={!allowed || busy || committed}
                aria-invalid={!!form.formState.errors[name]}
              />
            )}
            <FieldError errors={[form.formState.errors[name]]} />
          </Field>
        ))}
      </FieldGroup>
    </form>
  );
}
