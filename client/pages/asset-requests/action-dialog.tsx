import { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useTranslation } from '@nocobase/i18n/client';
import { useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useResolvedPath,
} from 'react-router';
import { useRouteOverlay } from '#components/use-route-overlay';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { violationPaths, actionField } from './errors.js';
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
import { RecipientPicker } from './pickers.js';
import { useResource } from './resource.js';
import { ErrorState, FieldsSkeleton } from './states.js';
import { useCommand, clearCommands } from './command.js';
import { focusSource } from './breadcrumb.js';
import {
  fullAllocation,
  statusOf,
  type Detail,
  type SourceContext,
  type AssetOption,
  type Page,
} from './types.js';
const candidateDeniedError = { status: 403 };
interface Values {
  comment: string;
  person: string;
  mode: string;
  place: string;
  appraisalOpinion: string;
  serials: string[];
}
export default function AssetRequestAction() {
  const { requestId, actionName, targetId } = useParams();
  const { session } = useAuthentication();
  return (
    <AssetRequestActionContent
      key={`${session?.user.id ?? ''}:${requestId}:${actionName ?? 'returnIssued'}:${targetId ?? 'record'}`}
    />
  );
}
function AssetRequestActionContent() {
  const { requestId, actionName: parameter, targetId } = useParams();
  const actionName = parameter ?? 'returnIssued';
  const { t } = useTranslation();
  const location = useLocation(),
    navigate = useNavigate(),
    parentPath = useResolvedPath('..'),
    toaster = useToaster(),
    parent = useOutletContext<SourceContext>();
  const resource = useResource<{ data: Detail }>(`assetRequests/${requestId}`);
  const command = useCommand(
    `action:${requestId}:${actionName}:${targetId ?? 'return'}`,
  );
  const [confirm, setConfirm] = useState<Values>();
  const [candidateDenied, setCandidateDenied] = useState(false);

  const d = resource.data?.data;
  const actions = d
    ? offeredActions(
        d.taskActions,
        d.runActions,
        d.runs.map((v) => v.run),
      )
    : [];
  const offer = actions.find(
    (a) =>
      a.name === actionName &&
      ('taskId' in a.target ? a.target.taskId : a.target.runId) === targetId,
  );
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.assetRequests' },
    action: actionName === 'returnIssued' ? 'returnIssued' : 'operate',
  });
  const physical = actionName === 'complete' || actionName === 'returnIssued';
  const eligibility = useResource<Page<AssetOption>>(
    physical && d ? 'assetRequests/eligibleAssets' : null,
    {
      purpose: d?.record.status === 'issuing' ? 'issue' : 'receive',
      requestId: requestId ?? '',
      ...(actionName === 'returnIssued'
        ? { mode: 'returnIssued' }
        : { targetId: targetId ?? '' }),
      page: '1',
      pageSize: '50',
    },
  );
  const lifecycle = ['submit', 'withdraw', 'terminate'].includes(actionName);
  const allowed =
    permission.can &&
    !permission.isPending &&
    !permission.error &&
    !resource.error &&
    !resource.loading &&
    !candidateDenied &&
    ![401, 403].includes(
      statusOf(resource.error ?? command.error ?? eligibility.error) ?? 0,
    ) &&
    !!d &&
    (lifecycle
      ? d.view.available.some((a) => a.name === actionName && a.allowed)
      : actionName === 'returnIssued'
        ? d.record.operation === 'use' &&
          d.record.status === 'issued' &&
          !eligibility.error
        : !!offer) &&
    (!physical || fullAllocation(d.record));
  const needsPerson = [
    'transfer',
    'addSigner',
    'cc',
    'assign',
    'appoint',
    'reassign',
  ].includes(actionName);
  const reasonRequired =
    actionName === 'returnIssued' ||
    actionName === 'terminate' ||
    actionName === 'unable' ||
    offer?.reasonRequired === true ||
    (actionName === 'complete' && d?.record.status === 'returning');
  const appraisal =
    actionName === 'approve' && d?.record.status === 'appraisal';
  const modes = (
    Array.isArray(offer?.options.modes)
      ? offer.options.modes
      : ['before', 'alongside']
  ).filter((v): v is string => typeof v === 'string');
  const places = (
    Array.isArray(offer?.options.unassigned) ? offer.options.unassigned : []
  ).filter(
    (v): v is { place: string; title: string | null } =>
      !!v &&
      typeof v === 'object' &&
      'place' in v &&
      typeof v.place === 'string',
  );
  const form = useForm<Values>({
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: {
      comment: '',
      person: '',
      mode: modes[0] ?? 'before',
      place: places[0]?.place ?? '',
      appraisalOpinion: '',
      serials: [],
    },
  });
  useEffect(() => {
    if (d && !form.formState.isDirty)
      form.setValue('serials', d.record.allocation?.map(() => '') ?? []);
  }, [d, form]);
  const reloadRequestedRef = useRef(false);
  const reloadSourceRef = useRef(d);
  const reloadLatest = () => {
    reloadRequestedRef.current = true;
    reloadSourceRef.current = d;
    resource.reload();
  };
  useEffect(() => {
    if (reloadRequestedRef.current && d && d !== reloadSourceRef.current) {
      reloadRequestedRef.current = false;
      command.clearError();
      form.reset();
    }
  }, [d, command, form]);
  const error =
    resource.error ??
    command.error ??
    eligibility.error ??
    (candidateDenied ? candidateDeniedError : undefined);
  const errorRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (errorRef.current === error) return;
    errorRef.current = error;
    if ([401, 403].includes(statusOf(error) ?? 0)) {
      form.reset();
      clearCommands(command.actor);
    }
    if (statusOf(error) === 404) {
      parent?.reload?.();
      toaster.show({
        type: 'error',
        title: t('assetRequests.missingNamed', {
          name: d?.record.number ?? t('assetRequests.draft'),
        }),
      });
      const source = location.pathname.split('/assetRequest/')[0];
      void navigate(
        { pathname: source, search: location.search },
        { replace: true },
      );
      focusSource();
    }
  }, [
    error,
    command.actor,
    form,
    parent,
    toaster,
    t,
    d?.record.number,
    location,
    navigate,
  ]);
  useEffect(() => {
    const fields = violationPaths(command.error)
      .map(actionField)
      .filter((v) => v !== undefined);
    fields.forEach((field) =>
      form.setError(field, {
        type: 'server',
        message: t('assetRequests.required'),
      }),
    );
    if (fields[0]) {
      const timer = setTimeout(() => {
        setConfirm(undefined);
        form.setFocus(fields[0]);
        const ids: Record<string, string> = {
          comment: 'asset-action-comment',
          person: 'asset-recipient',
          appraisalOpinion: 'asset-appraisal',
          mode: 'asset-signer-mode',
          place: 'asset-place',
        };
        const first = fields[0];
        document
          .getElementById(
            first.startsWith('serials.')
              ? `asset-serial-${first.split('.')[1]}`
              : ids[first],
          )
          ?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [command.error, form, t]);
  const frozen = !!command.pending,
    locked = command.busy || frozen || !allowed || statusOf(error) === 409;
  const name = d?.record.number ?? t('assetRequests.draft');
  const close = async () => {
    await navigate({ pathname: parentPath.pathname, search: location.search });
  };
  async function perform(values?: Values) {
    if (
      !d ||
      (!allowed && !command.pending) ||
      command.busy ||
      [401, 403].includes(statusOf(error) ?? 0)
    )
      return;
    let input: Record<string, unknown> = {};
    if (values) {
      if (physical)
        input = {
          units: d.record.allocation!.map((a, index) => ({
            assetId: a.id,
            serialNumber: values.serials[index].trim(),
          })),
        };
      else if (actionName === 'approve' && appraisal)
        input = { data: { appraisalOpinion: values.appraisalOpinion } };
      else if (actionName === 'return') input = { to: 'revision' };
      else if (actionName === 'addSigner')
        input = { person: values.person, mode: values.mode };
      else if (needsPerson)
        input = {
          to: values.person,
          ...(actionName === 'appoint' ? { place: values.place } : {}),
          ...(actionName === 'reassign' ? { override: false } : {}),
        };
    }
    const result = await command.execute<{ data: Detail }>(
      values
        ? {
            method: 'POST',
            path: `assetRequests/${requestId}/${actionName === 'returnIssued' ? 'return' : lifecycle ? 'lifecycle' : 'action'}`,
            json:
              actionName === 'returnIssued'
                ? { ...input, reason: values.comment }
                : lifecycle
                  ? {
                      action: actionName,
                      lifecycleVersion: d.record.lifecycleVersion,
                      comment: values.comment || undefined,
                    }
                  : {
                      target: offer!.target,
                      action: actionName,
                      input,
                      comment: values.comment || undefined,
                      contentHash: offer!.contentHash ?? undefined,
                    },
          }
        : undefined,
    );
    if (result) {
      parent?.updateDetail?.(result.data);
      parent?.reload?.();
      toaster.show({
        type: 'success',
        title: t('assetRequests.completed', {
          name,
          action: t(`assetRequests.actions.${actionName}`),
        }),
      });
      await close();
    }
  }
  const dangerous = [
    'withdraw',
    'terminate',
    'reject',
    'return',
    'unable',
    'returnIssued',
  ].includes(actionName);
  return (
    <RouteDrawer
      title={t('assetRequests.actionTitle', {
        action: t(`assetRequests.actions.${actionName}`),
        name,
      })}
      className={physical || needsPerson ? undefined : 'sm:max-w-2xl'}
      beforeClose={() => !command.busy && !frozen}
      footer={
        <>
          <ActionCancel disabled={command.busy || frozen} />
          <Button
            type='submit'
            form='asset-action-form'
            disabled={
              locked || (physical && (!eligibility.data || eligibility.loading))
            }
          >
            {command.busy ? <Spinner data-icon='inline-start' /> : null}
            {t(
              command.busy
                ? 'assetRequests.saving'
                : `assetRequests.actions.${actionName}`,
            )}
          </Button>
        </>
      }
    >
      {error &&
      (statusOf(error) !== 400 ||
        !violationPaths(error).length ||
        violationPaths(error).some((path) => !actionField(path))) ? (
        <ErrorState
          error={error}
          retry={statusOf(error) === 409 ? reloadLatest : undefined}
        />
      ) : null}
      {!d ? (
        resource.loading ? (
          <FieldsSkeleton />
        ) : null
      ) : [401, 403].includes(statusOf(error) ?? 0) ? null : (
        <>
          {!allowed ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  physical && !fullAllocation(d.record)
                    ? 'assetRequests.missingFields'
                    : 'assetRequests.actionUnavailable',
                )}
              </AlertDescription>
            </Alert>
          ) : null}
          {frozen ? (
            <Alert>
              <AlertDescription>
                {t('assetRequests.unknownResult')}
              </AlertDescription>
              <Button
                variant='outline'
                disabled={command.busy}
                onClick={() => void perform()}
              >
                {t('assetRequests.retryExact')}
              </Button>
            </Alert>
          ) : null}
          <form
            id='asset-action-form'
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit((v) =>
                dangerous ? setConfirm(v) : perform(v),
              )(e);
            }}
          >
            <fieldset disabled={locked}>
              <FieldGroup>
                <Field data-invalid={!!form.formState.errors.comment}>
                  <FieldLabel htmlFor='asset-action-comment'>
                    {t('assetRequests.comment')}
                    {reasonRequired ? ' *' : ''}
                  </FieldLabel>
                  <Textarea
                    id='asset-action-comment'
                    {...form.register('comment', {
                      required: reasonRequired
                        ? t('assetRequests.required')
                        : false,
                      maxLength: {
                        value: 5000,
                        message: t('assetRequests.reasonLimit'),
                      },
                    })}
                  />
                  <FieldError errors={[form.formState.errors.comment]} />
                </Field>
                {appraisal ? (
                  <Field
                    data-invalid={!!form.formState.errors.appraisalOpinion}
                  >
                    <FieldLabel htmlFor='asset-appraisal'>
                      {t('assetRequests.appraisalOpinion')} *
                    </FieldLabel>
                    <Textarea
                      id='asset-appraisal'
                      {...form.register('appraisalOpinion', {
                        required: t('assetRequests.required'),
                        validate: (v) =>
                          !!v.trim() || t('assetRequests.required'),
                        maxLength: {
                          value: 2000,
                          message: t('assetRequests.textLimit'),
                        },
                      })}
                    />
                    <FieldError
                      errors={[form.formState.errors.appraisalOpinion]}
                    />
                  </Field>
                ) : null}
                {needsPerson ? (
                  <Controller
                    name='person'
                    control={form.control}
                    rules={{ required: t('assetRequests.required') }}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor='asset-recipient'>
                          {t('assetRequests.person')} *
                        </FieldLabel>
                        <RecipientPicker
                          id='asset-recipient'
                          onDenied={() => {
                            setCandidateDenied(true);
                            form.reset();
                            clearCommands(command.actor);
                          }}
                          recordId={requestId!}
                          targetId={targetId!}
                          action={actionName}
                          disabled={locked}
                          value={field.value}
                          onChange={field.onChange}
                        />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                ) : null}
                {actionName === 'addSigner' ? (
                  <Controller
                    name='mode'
                    control={form.control}
                    rules={{ required: t('assetRequests.required') }}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor='asset-signer-mode'>
                          {t('assetRequests.signerMode')} *
                        </FieldLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={locked}
                        >
                          <SelectTrigger id='asset-signer-mode'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                            <SelectGroup>
                              {modes.map((v) => (
                                <SelectItem key={v} value={v}>
                                  {t(`assetRequests.modes.${v}`)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                ) : null}
                {actionName === 'appoint' && places.length > 1 ? (
                  <Controller
                    name='place'
                    control={form.control}
                    rules={{ required: t('assetRequests.required') }}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor='asset-place'>
                          {t('assetRequests.place')} *
                        </FieldLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={locked}
                        >
                          <SelectTrigger id='asset-place'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                            <SelectGroup>
                              {places.map((p) => (
                                <SelectItem key={p.place} value={p.place}>
                                  {p.title ?? p.place}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                ) : null}
                {physical ? (
                  <>
                    <p className='text-sm text-muted-foreground'>
                      {t('assetRequests.fullBatch')}
                    </p>
                    {d.record.allocation?.map((a, index) => (
                      <Field
                        key={a.id}
                        data-invalid={!!form.formState.errors.serials?.[index]}
                      >
                        <FieldLabel htmlFor={`asset-serial-${index}`}>
                          {t('assetRequests.serialFor', { code: a.code })} *
                        </FieldLabel>
                        <Input
                          id={`asset-serial-${index}`}
                          {...form.register(`serials.${index}`, {
                            required: t('assetRequests.required'),
                            maxLength: {
                              value: 200,
                              message: t('assetRequests.serialLimit'),
                            },
                            validate: (v) =>
                              v.trim() === a.serialNumber ||
                              t('assetRequests.serialMismatch'),
                          })}
                        />
                        <FieldError
                          errors={[form.formState.errors.serials?.[index]]}
                        />
                      </Field>
                    ))}
                  </>
                ) : null}
              </FieldGroup>
            </fieldset>
          </form>
          <AlertDialog
            open={!!confirm}
            onOpenChange={(open) => {
              if (!open && !command.busy) setConfirm(undefined);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('assetRequests.actionTitle', {
                    action: t(`assetRequests.actions.${actionName}`),
                    name,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t('assetRequests.confirmDanger')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {command.error ? <ErrorState error={command.error} /> : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={command.busy}>
                  {t('assetRequests.cancel')}
                </AlertDialogCancel>
                <Button
                  variant='destructive'
                  disabled={command.busy}
                  onClick={() => void perform(confirm)}
                >
                  {command.busy ? <Spinner data-icon='inline-start' /> : null}
                  {t(
                    command.busy
                      ? 'assetRequests.saving'
                      : `assetRequests.actions.${actionName}`,
                  )}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </RouteDrawer>
  );
}

function ActionCancel({ disabled }: { disabled: boolean }) {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  return (
    <Button variant='outline' disabled={disabled} onClick={() => void close()}>
      {t('assetRequests.cancel')}
    </Button>
  );
}
