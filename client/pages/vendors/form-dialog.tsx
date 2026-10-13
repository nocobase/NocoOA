import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useOutletContext, useParams } from 'react-router';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Field as FormField,
  FieldError,
  FieldLabel,
} from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';
import { Switch } from '#components/ui/switch';
import { Spinner } from '#components/ui/spinner';
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
import { RESOURCE, type Vendor, type VendorContext } from './types.js';
import { useVendorResource } from './resource.js';
import { fieldViolationsOf } from '../platform/shared/errors.js';
import { VendorError, VendorSkeleton } from './states.js';
const fields = [
  'code',
  'name',
  'category',
  'contactName',
  'contactPhone',
  'contactEmail',
  'bankName',
  'bankAccount',
  'bankAccountName',
] as const;
type Field = (typeof fields)[number];
export default function VendorForm() {
  const { vendorId } = useParams(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [discard, setDiscard] = useState(false);
  const dirtyRef = useRef(false),
    workingRef = useRef(false),
    resolverRef = useRef<((v: boolean) => void) | null>(null);
  const r = useVendorResource<{ data: Vendor }>(
      vendorId ? `vendors/${encodeURIComponent(vendorId)}` : null,
    ),
    p = useCan({
      resource: { type: 'composite', id: RESOURCE },
      action: 'manage',
    }),
    allowed = p.can && !p.error && !p.isPending,
    ready = allowed && !r.loading && !r.error && (!vendorId || !!r.data);
  const bindBusy = (v: boolean) => {
    workingRef.current = v;
    setBusy(v);
  };
  return (
    <>
      <RouteDialog
        title={t(`vendors.${vendorId ? 'edit' : 'new'}`)}
        description={t('vendors.formDescription')}
        beforeClose={() => {
          if (workingRef.current) return false;
          if (!dirtyRef.current) return true;
          setDiscard(true);
          return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
          });
        }}
        footer={<Footer busy={busy} disabled={!ready || blocked} />}
      >
        {r.error ? <VendorError error={r.error} retry={r.reload} /> : null}
        {!allowed && !p.isPending ? (
          <Alert variant='destructive'>
            <AlertDescription>{t('vendors.error.forbidden')}</AlertDescription>
          </Alert>
        ) : !allowed || (vendorId && !r.data) ? (
          <VendorSkeleton />
        ) : (
          <Form
            key={`${vendorId ?? 'new'}:${r.data?.data.version ?? 0}`}
            row={r.data?.data}
            reload={r.reload}
            refreshing={r.loading}
            onDirty={(v) => {
              dirtyRef.current = v;
            }}
            onBusy={bindBusy}
            onBlocked={setBlocked}
          />
        )}
      </RouteDialog>
      <AlertDialog
        open={discard}
        onOpenChange={(v) => {
          if (!v) {
            setDiscard(false);
            resolverRef.current?.(false);
            resolverRef.current = null;
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
            <AlertDialogCancel>{t('vendors.cancel')}</AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={() => {
                dirtyRef.current = false;
                setDiscard(false);
                resolverRef.current?.(true);
                resolverRef.current = null;
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
function Footer({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('vendors.cancel')}
      </Button>
      <Button type='submit' form='vendor-form' disabled={busy || disabled}>
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('vendors.save')}
      </Button>
    </>
  );
}
function Form({
  row,
  refreshing,
  reload,
  onDirty,
  onBusy,
  onBlocked,
}: {
  row?: Vendor;
  refreshing: boolean;
  reload: () => void;
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
  onBlocked: (v: boolean) => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<VendorContext>();
  const baseline = Object.fromEntries(
    fields.map((k) => [k, row?.[k] ?? '']),
  ) as Record<Field, string>;
  const [values, setValues] = useState(baseline),
    [active, setActive] = useState(row?.active ?? true),
    [reason, setReason] = useState(''),
    [error, setError] = useState<unknown>(),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const startedRef = useRef(false),
    unknownRowRef = useRef<Vendor | null>(null),
    formRef = useRef<HTMLFormElement>(null);
  const savedRef = useRef(false);
  const changed =
    JSON.stringify(values) !== JSON.stringify(baseline) ||
    active !== (row?.active ?? true) ||
    reason !== '';
  useEffect(
    () => onDirty(savedRef.current ? false : changed),
    [changed, onDirty],
  );
  useEffect(() => {
    if (row && unknownRowRef.current && row !== unknownRowRef.current) {
      unknownRowRef.current = null;
      setUncertain(false);
      onBlocked(false);
    }
  }, [row, onBlocked]);
  useEffect(() => {
    onBlocked(false);
    return () => onBlocked(false);
  }, [onBlocked]);
  const shown = fields.filter(
    (k) => !row || !k.startsWith('bank') || typeof row[k] === 'string',
  );
  function focus(key: string) {
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>(`[name="${key}"]`)?.focus(),
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (startedRef.current || uncertain) return;
    const invalid: Record<string, string> = {};
    for (const key of ['code', 'name', 'category'] as const)
      if (!values[key].trim()) invalid[key] = t('vendors.required');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(values.code))
      invalid.code = t('vendors.invalidCode');
    if (
      values.contactEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail)
    )
      invalid.contactEmail = t('vendors.invalidEmail');
    if (!reason.trim()) invalid.reason = t('vendors.required');
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      focus(Object.keys(invalid)[0]);
      return;
    }
    startedRef.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    const input: Record<string, unknown> = { reason: reason.trim() };
    for (const k of shown)
      if (!row || values[k] !== baseline[k]) input[k] = values[k].trim();
    if (row) {
      input.version = row.version;
      if (active !== row.active) input.active = active;
      if (Object.keys(input).length === 2) {
        setErrors({ reason: t('vendors.noChanges') });
        focus('reason');
        startedRef.current = false;
        setBusy(false);
        onBusy(false);
        return;
      }
    }
    try {
      await api.request({
        path: row ? `vendors/${encodeURIComponent(row.id)}` : 'vendors',
        method: row ? 'PATCH' : 'POST',
        json: input,
      });
      savedRef.current = true;
      onDirty(false);
      parent?.onSaved();
      onBusy(false);
      await close();
    } catch (err) {
      setError(err);
      if (err instanceof ApiClientError) {
        const violations = fieldViolationsOf(err);
        const mapped: Record<string, string> = Object.fromEntries(
          violations.map((v) => [v, t('vendors.required')]),
        );
        if (err.reason === 'VENDOR_CODE_EXISTS')
          mapped.code = t('vendors.error.VENDOR_CODE_EXISTS');
        setErrors(mapped);
        if (Object.keys(mapped).length) focus(Object.keys(mapped)[0]);
        else
          requestAnimationFrame(() =>
            formRef.current
              ?.querySelector<HTMLElement>('[data-form-error]')
              ?.focus(),
          );
        if (err.status === 404) parent?.onSaved();
        if (err.status >= 500) {
          setUncertain(true);
          unknownRowRef.current = row ?? null;
          onBlocked(true);
        }
      } else {
        setUncertain(true);
        unknownRowRef.current = row ?? null;
        onBlocked(true);
      }
    } finally {
      startedRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <form
      id='vendor-form'
      ref={formRef}
      onSubmit={(e) => void save(e)}
      className='flex flex-col gap-4'
    >
      {error ? (
        <div data-form-error tabIndex={-1}>
          <VendorError error={error} retry={reload} />
        </div>
      ) : null}
      {uncertain ? (
        <Alert>
          <AlertDescription>
            {t(row ? 'vendors.unknownEdit' : 'vendors.unknownCreate')}
          </AlertDescription>
          {row ? (
            <Button type='button' variant='outline' onClick={reload}>
              {t('vendors.loadLatest')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <fieldset
        disabled={busy || uncertain || refreshing}
        className='flex flex-col gap-4'
      >
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          {shown.map((k) => (
            <FormField key={k} data-invalid={!!errors[k]}>
              <FieldLabel htmlFor={`vendor-${k}`}>
                {t(`vendors.fields.${k}`)}
                {['code', 'name', 'category'].includes(k) ? ' *' : ''}
              </FieldLabel>
              <Input
                id={`vendor-${k}`}
                name={k}
                aria-required={['code', 'name', 'category'].includes(k)}
                value={values[k]}
                maxLength={
                  k === 'code' || k === 'contactPhone'
                    ? 64
                    : k === 'bankAccount'
                      ? 128
                      : 255
                }
                aria-invalid={!!errors[k]}
                aria-describedby={errors[k] ? `vendor-${k}-error` : undefined}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [k]: e.target.value }))
                }
              />
              {errors[k] ? (
                <FieldError id={`vendor-${k}-error`}>{errors[k]}</FieldError>
              ) : null}
            </FormField>
          ))}
        </div>
        {row ? (
          <div className='flex items-center gap-2'>
            <Switch
              id='vendor-active'
              checked={active}
              onCheckedChange={setActive}
            />
            <Label htmlFor='vendor-active'>{t('vendors.active')}</Label>
            {!active ? (
              <span className='text-sm text-muted-foreground'>
                {t('vendors.disableHint')}
              </span>
            ) : null}
          </div>
        ) : null}
        <FormField data-invalid={!!errors.reason}>
          <FieldLabel htmlFor='vendor-reason'>
            {t('vendors.reason')} *
          </FieldLabel>
          <Textarea
            id='vendor-reason'
            name='reason'
            aria-required
            value={reason}
            maxLength={5000}
            aria-invalid={!!errors.reason}
            aria-describedby={errors.reason ? 'vendor-reason-error' : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
          {errors.reason ? (
            <FieldError id='vendor-reason-error'>{errors.reason}</FieldError>
          ) : null}
        </FormField>
      </fieldset>
    </form>
  );
}
