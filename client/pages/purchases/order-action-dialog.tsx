import { useEffect, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, parseISO } from 'date-fns';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { DatePicker } from '#components/date-picker';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
  FieldGroup,
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
  AlertDialogAction,
} from '#components/ui/alert-dialog';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { ErrorState } from './states.js';
import type { OrderDetail } from './order-detail.js';
export default function PurchaseOrderActionDialog() {
  const { orderId = '', orderAction = '' } = useParams(),
    { t } = useTranslation();
  const resource = useResource<OrderDetail>(
      `purchaseOrders/${encodeURIComponent(orderId)}`,
    ),
    parent = useOutletContext<{ reload: () => void }>();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [blocked, setBlocked] = useState(false),
    [discard, setDiscard] = useState(false);
  const busyRef = useRef(false),
    dirtyRef = useRef(false),
    resolveCloseRef = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [parent, resource.error]);
  const mode = orderAction === 'accept' ? 'accept' : 'cancel',
    valid = ['accept', 'cancel'].includes(orderAction);
  return (
    <>
      <RouteDrawer
        title={t(
          mode === 'accept'
            ? 'purchases.confirmReceipt'
            : 'purchases.cancelOrder',
        )}
        className='sm:max-w-2xl'
        beforeClose={() => {
          if (busyRef.current) return false;
          if (!dirtyRef.current) return true;
          setDiscard(true);
          return new Promise<boolean>((resolve) => {
            resolveCloseRef.current = resolve;
          });
        }}
        footer={
          <Button
            type='submit'
            form='purchase-order-action'
            disabled={
              busy ||
              blocked ||
              !valid ||
              resource.loading ||
              !!resource.error ||
              !resource.data ||
              !resource.data.actions[mode]
            }
          >
            {t('actions.confirm')}
          </Button>
        }
      >
        {resource.error && resource.data ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {resource.data ? (
          <OrderActionForm
            key={`${orderId}:${mode}`}
            detail={resource.data}
            mode={mode}
            allowed={
              valid &&
              !resource.loading &&
              !resource.error &&
              resource.data.actions[mode]
            }
            refresh={resource.reload}
            parentReload={parent.reload}
            onBlocked={setBlocked}
            onBusy={(value) => {
              busyRef.current = value;
              setBusy(value);
            }}
            onDirty={(value) => {
              dirtyRef.current = value;
              setDirty(value);
            }}
          />
        ) : resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : (
          <FieldsSkeleton fields={2} />
        )}
      </RouteDrawer>
      <AlertDialog
        open={discard && dirty}
        onOpenChange={(value) => {
          if (!value) {
            setDiscard(false);
            resolveCloseRef.current?.(false);
            resolveCloseRef.current = null;
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
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                dirtyRef.current = false;
                setDirty(false);
                setDiscard(false);
                resolveCloseRef.current?.(true);
                resolveCloseRef.current = null;
              }}
            >
              {t('approvals.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
function OrderActionForm({
  detail,
  mode,
  allowed,
  refresh,
  parentReload,
  onBusy,
  onDirty,
  onBlocked,
}: {
  detail: OrderDetail;
  mode: 'accept' | 'cancel';
  allowed: boolean;
  refresh: () => void;
  parentReload: () => void;
  onBlocked: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onDirty: (value: boolean) => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    overlay = useRouteOverlay();
  const [error, setError] = useState<unknown>(),
    [uncertain, setUncertain] = useState(false),
    [busy, setBusy] = useState(false),
    [committed, setCommitted] = useState(false);
  const busyRef = useRef(false),
    attemptRef = useRef<
      | { signature: string; payload: Record<string, unknown>; id: string }
      | undefined
    >(undefined);
  const schema = z
    .object({
      reason: z.string().trim().min(1, t('purchases.fieldInvalid')).max(5000),
      receiptDate: z.string(),
    })
    .superRefine((value, context) => {
      if (
        mode === 'accept' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value.receiptDate) ||
          Number.isNaN(parseISO(value.receiptDate).getTime()))
      )
        context.addIssue({
          code: 'custom',
          path: ['receiptDate'],
          message: t('purchases.dateInvalid'),
        });
    });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { reason: '', receiptDate: '' },
  });
  useEffect(() => {
    onDirty(!committed && (form.formState.isDirty || uncertain));
  }, [committed, form.formState.isDirty, onDirty, uncertain]);
  const [confirmation, setConfirmation] = useState<Record<string, unknown>>();
  const frozen = busy || uncertain || committed || !allowed;
  useEffect(() => {
    onBlocked(uncertain || committed);
  }, [committed, onBlocked, uncertain]);
  async function send(payload: Record<string, unknown>) {
    if (busyRef.current || committed) return;
    busyRef.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `purchaseOrders/${detail.record.id}/${mode}`,
        json: payload,
      });
      setCommitted(true);
      onDirty(false);
      parentReload();
      toaster.show({ type: 'success', title: t('purchases.orderSaved') });
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
      await overlay.close();
    } catch (failure) {
      setError(failure);
      setUncertain(
        !(failure instanceof ApiClientError) || failure.status >= 500,
      );
      if (failure instanceof ApiClientError && failure.status === 404)
        parentReload();
      requestAnimationFrame(() =>
        document.getElementById('purchase-order-action-error')?.focus(),
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  const submit = (values: z.infer<typeof schema>) => {
    if (frozen) return;
    const base = {
        version: detail.record.version,
        reason: values.reason,
        ...(mode === 'accept' ? { receiptDate: values.receiptDate } : {}),
      },
      signature = JSON.stringify(base);
    if (attemptRef.current?.signature !== signature)
      attemptRef.current = { signature, payload: base, id: createRequestId() };
    const payload = {
      ...attemptRef.current.payload,
      requestKey: attemptRef.current.id,
    };
    if (mode === 'cancel') setConfirmation(payload);
    else void send(payload);
  };

  return (
    <form
      id='purchase-order-action'
      onSubmit={(event) => {
        void form.handleSubmit(submit, (errors) => {
          if (errors.receiptDate)
            document.getElementById('purchase-receipt-date')?.focus();
        })(event);
      }}
      className='flex flex-col gap-4'
    >
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('purchases.confirmCancelOrder', {
                name: detail.record.number,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('purchases.cancelOrderHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
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
      {!allowed ? (
        <Alert>
          <AlertDescription>{t('approvals.unavailable')}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <div id='purchase-order-action-error' tabIndex={-1}>
          <ErrorState
            error={error}
            retry={
              uncertain
                ? () => {
                    if (attemptRef.current)
                      void send({
                        ...attemptRef.current.payload,
                        requestKey: attemptRef.current.id,
                      });
                  }
                : refresh
            }
          />
        </div>
      ) : null}
      {uncertain ? (
        <Alert>
          <AlertDescription>
            {t('purchases.unknownOrderAction')}
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        {mode === 'accept' ? (
          <Controller
            name='receiptDate'
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor='purchase-receipt-date'>
                  {t('purchases.receiptDate')} *
                </FieldLabel>
                <DatePicker
                  id='purchase-receipt-date'
                  value={field.value ? parseISO(field.value) : undefined}
                  onChange={(date) =>
                    field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                  disabled={frozen}
                />
                <FieldError errors={[fieldState.error]} />
                <FieldDescription>
                  {t('purchases.receiptSettlementHint')}
                </FieldDescription>
              </Field>
            )}
          />
        ) : (
          <Alert>
            <AlertDescription>
              {t('purchases.cancelOrderHint')}
            </AlertDescription>
          </Alert>
        )}
        <Field data-invalid={!!form.formState.errors.reason}>
          <FieldLabel htmlFor='purchase-order-reason'>
            {t('approvals.reason')} *
          </FieldLabel>
          <Textarea
            id='purchase-order-reason'
            disabled={frozen}
            {...form.register('reason')}
          />
          <FieldError errors={[form.formState.errors.reason]} />
        </Field>
      </FieldGroup>
    </form>
  );
}
