import { useBusinessErrorFormatter } from '#hooks/use-business-error-message';
import { createRequestKey } from '#lib/request-key';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import {
  offeredActions,
  type OfferedAction,
} from '@nocobase/app-plugin-approval/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useParams, useOutletContext } from 'react-router';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
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
import { VehicleError, Loading, FormError } from './states.js';
import { errorKey } from './errors.js';
import { parseCents } from './money.js';
import type { Detail, Vehicle, Driver, Source } from './types.js';
export default function RequestAction() {
  const { requestId, operation, taskId } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<Source>(),
    [busy, setBusy] = useState(false),
    workingRef = useRef(false),
    r = useVehicleResource<{ data: Detail }>(
      `vehicleBrowser/requests/${encodeURIComponent(requestId ?? '')}`,
    ),
    detail = r.data?.data;
  const offer =
      detail &&
      offeredActions(
        detail.taskActions,
        detail.runActions,
        detail.runs.map((r) => r.run),
      ).find(
        (o) =>
          o.name === operation &&
          'taskId' in o.target &&
          o.target.taskId === taskId,
      ),
    transition =
      detail?.transitions.includes(operation ?? '') && operation !== 'edit',
    ready = !r.loading && !r.error && (!!offer || !!transition);
  const bind = (value: boolean) => {
    workingRef.current = value;
    setBusy(value);
  };
  return (
    <RouteDrawer
      title={t(`vehicles.actions.${operation}`)}
      beforeClose={() => !workingRef.current}
      footer={<Footer busy={busy} ready={ready} />}
    >
      {r.error ? (
        <VehicleError error={r.error} retry={r.reload} />
      ) : r.loading ? (
        <Loading />
      ) : ready && detail && operation ? (
        <Body
          key={`${detail.record.lifecycleVersion}:${offer?.key ?? operation}`}
          detail={detail}
          operation={operation}
          offer={offer}
          busy={bind}
          saved={parent.reload}
        />
      ) : (
        <Alert>
          <AlertDescription>
            {t('vehicles.errors.unavailable')}
          </AlertDescription>
        </Alert>
      )}
    </RouteDrawer>
  );
}
function Footer({ busy, ready }: { busy: boolean; ready: boolean }) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('vehicles.cancel')}
      </Button>
      <Button
        type='submit'
        form='vehicle-action-form'
        disabled={busy || !ready}
      >
        {t('vehicles.confirm')}
      </Button>
    </>
  );
}
function Body({
  detail,
  operation,
  offer,
  busy,
  saved,
}: {
  detail: Detail;
  operation: string;
  offer?: OfferedAction;
  busy: (value: boolean) => void;
  saved: () => void;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    [requestKey] = useState(() => createRequestKey()),
    workingRef = useRef(false),
    [confirmation, setConfirmation] = useState(false),
    [pending, setPending] = useState(false),
    [values, setValues] = useState<Values>(),
    dispatch = operation === 'complete',
    usage = operation === 'registerUsage',
    required =
      offer?.reasonRequired ||
      ['terminate', 'reject', 'unable'].includes(operation);
  const candidates = useVehicleResource<{
    data: { vehicles: Vehicle[]; drivers: Driver[] };
  }>(
    dispatch
      ? `vehicleBrowser/requests/${detail.record.id}/dispatchCandidates`
      : null,
    undefined,
    `${detail.record.id}:${offer?.key}:${offer?.contentHash}`,
  );
  const schema = useMemo(
    () =>
      z.object({
        comment: required
          ? z
              .string()
              .trim()
              .min(1, t('vehicles.validation.required'))
              .max(5000)
          : z.string().max(5000),
        vehicleId: dispatch
          ? z.string().min(1, t('vehicles.validation.required'))
          : z.string(),
        driverId:
          dispatch && detail.record.needsDriver
            ? z.string().min(1, t('vehicles.validation.required'))
            : z.string(),
        mileage: usage
          ? z
              .number()
              .int()
              .min(0, t('vehicles.validation.mileage'))
              .max(Number.MAX_SAFE_INTEGER)
          : z.number(),
        fuel: usage
          ? z
              .string()
              .refine(
                (v) => parseCents(v) !== null,
                t('vehicles.validation.amount'),
              )
          : z.string(),
        exception: z.string().max(5000),
      }),
    [required, dispatch, detail.record.needsDriver, usage, t],
  );
  type Values = z.infer<typeof schema>;
  const businessError = useBusinessErrorFormatter('vehicles');
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      comment: '',
      vehicleId: '',
      driverId: '',
      mileage: 0,
      fuel: '0.00',
      exception: '',
    },
  });
  async function perform(v: Values) {
    if (workingRef.current) return;
    workingRef.current = true;
    setPending(true);
    busy(true);
    try {
      const json = offer
        ? {
            target: offer.target,
            action: operation,
            contentHash:
              offer.contentHash ??
              detail.runs.find((run) =>
                run.tasks.some(
                  (task) =>
                    'taskId' in offer.target && task.id === offer.target.taskId,
                ),
              )?.run.contentHash ??
              '',
            requestId: requestKey,
            ...(dispatch
              ? {
                  privateInput: {
                    vehicleId: v.vehicleId,
                    driverId: detail.record.needsDriver ? v.driverId : null,
                  },
                }
              : usage
                ? {
                    privateInput: {
                      mileage: v.mileage,
                      fuelCents: parseCents(v.fuel)!,
                      exception: v.exception,
                    },
                  }
                : {
                    comment: v.comment,
                    ...(operation === 'return'
                      ? { input: { to: 'revision' } }
                      : {}),
                  }),
          }
        : {
            transition: operation,
            version: detail.record.lifecycleVersion,
            requestId: requestKey,
            ...(operation === 'terminate'
              ? { input: { reason: v.comment } }
              : {}),
          };
      await api.request({
        method: 'POST',
        path: `vehicleRequests/${detail.record.id}/${offer ? 'actions' : 'transitions'}`,
        json,
      });
      form.reset(v);
      saved();
      busy(false);
      toaster.show({ type: 'success', title: t('vehicles.operationSaved') });
      await close();
    } catch (error) {
      form.setError('root', {
        type:
          error instanceof ApiClientError && error.status === 401
            ? 'sessionExpired'
            : 'server',
        message:
          businessError(error) ?? t(`vehicles.errors.${errorKey(error)}`),
      });
    } finally {
      workingRef.current = false;
      setPending(false);
      busy(false);
      setConfirmation(false);
    }
  }
  const submit = (event: FormEvent) =>
    form.handleSubmit((v) => {
      if (
        dispatch &&
        (!candidates.data || candidates.loading || candidates.error)
      ) {
        form.setError('vehicleId', {
          message: t('vehicles.errors.unavailable'),
        });
        return;
      }
      if (['withdraw', 'terminate', 'reject', 'unable'].includes(operation)) {
        setValues(v);
        setConfirmation(true);
      } else void perform(v);
    })(event);
  return (
    <>
      <form
        id='vehicle-action-form'
        noValidate
        onSubmit={(e) => void submit(e)}
      >
        <FieldGroup>
          <FormError error={form.formState.errors.root} />
          {dispatch ? (
            <>
              {candidates.error ? (
                <VehicleError
                  error={candidates.error}
                  retry={candidates.reload}
                />
              ) : candidates.loading ? (
                <Loading />
              ) : null}
              {(
                [
                  'vehicleId',
                  ...(detail.record.needsDriver ? ['driverId'] : []),
                ] as ('vehicleId' | 'driverId')[]
              ).map((name) => (
                <Controller
                  key={name}
                  name={name}
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={!!fieldState.error}>
                      <FieldLabel htmlFor={`vehicle-action-${name}`}>
                        {t(`vehicles.fields.${name}`)}
                      </FieldLabel>
                      <Select
                        items={
                          name === 'vehicleId'
                            ? (candidates.data?.data.vehicles ?? []).map(
                                (vehicle) => ({
                                  value: vehicle.id,
                                  label: `${vehicle.name} · ${vehicle.plateNumber}`,
                                }),
                              )
                            : (candidates.data?.data.drivers ?? []).map(
                                (driver) => ({
                                  value: driver.id,
                                  label: driver.employee.user.name,
                                }),
                              )
                        }
                        value={field.value}
                        onValueChange={(value) => field.onChange(value ?? '')}
                        disabled={pending || candidates.loading}
                      >
                        <SelectTrigger
                          id={`vehicle-action-${name}`}
                          aria-required
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(name === 'vehicleId'
                              ? (candidates.data?.data.vehicles ?? []).map(
                                  (v) => ({
                                    id: v.id,
                                    name: `${v.name} · ${v.plateNumber}`,
                                  }),
                                )
                              : (candidates.data?.data.drivers ?? []).map(
                                  (d) => ({
                                    id: d.id,
                                    name: d.employee.user.name,
                                  }),
                                )
                            ).map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              ))}
            </>
          ) : null}
          {usage ? (
            <>
              <Field data-invalid={!!form.formState.errors.mileage}>
                <FieldLabel htmlFor='vehicle-action-mileage'>
                  {t('vehicles.fields.mileage')}
                </FieldLabel>
                <Input
                  id='vehicle-action-mileage'
                  type='number'
                  min={0}
                  disabled={pending}
                  {...form.register('mileage', { valueAsNumber: true })}
                />
                <FieldError errors={[form.formState.errors.mileage]} />
              </Field>
              <Field data-invalid={!!form.formState.errors.fuel}>
                <FieldLabel htmlFor='vehicle-action-fuel'>
                  {t('vehicles.fields.fuel')}
                </FieldLabel>
                <Input
                  id='vehicle-action-fuel'
                  inputMode='decimal'
                  disabled={pending}
                  {...form.register('fuel')}
                />
                <FieldError errors={[form.formState.errors.fuel]} />
              </Field>
              <Field>
                <FieldLabel htmlFor='vehicle-action-exception'>
                  {t('vehicles.fields.exception')}
                </FieldLabel>
                <Textarea
                  id='vehicle-action-exception'
                  disabled={pending}
                  {...form.register('exception')}
                />
              </Field>
            </>
          ) : !dispatch ? (
            <Field data-invalid={!!form.formState.errors.comment}>
              <FieldLabel htmlFor='vehicle-action-comment'>
                {t(
                  required
                    ? 'vehicles.fields.reason'
                    : 'vehicles.fields.comment',
                )}
              </FieldLabel>
              <Textarea
                id='vehicle-action-comment'
                disabled={pending}
                aria-required={required}
                {...form.register('comment')}
              />
              <FieldError errors={[form.formState.errors.comment]} />
            </Field>
          ) : null}
        </FieldGroup>
      </form>
      <AlertDialog open={confirmation} onOpenChange={setConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('vehicles.destructiveTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('vehicles.destructiveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('vehicles.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => values && void perform(values)}
            >
              {t('vehicles.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
