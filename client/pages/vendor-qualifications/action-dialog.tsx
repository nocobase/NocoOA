import { Missing } from './missing.js';
import {
  actionJournalKey,
  loadAction,
  saveAction,
  clearAction,
  type ActionCommand,
} from './action-journal.js';
import { useCloseGuard } from './use-close-guard.js';
import { DiscardConfirmation } from './shared.js';
import { finalRefusal } from './errors.js';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import { useOutletContext, useParams } from 'react-router';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldLabel,
  FieldError,
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
} from '#components/ui/alert-dialog';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { ErrorState } from './states.js';
import { CandidatePicker } from './candidate-picker.js';
import { Choice } from './shared.js';
import type { QualificationDetail, DetailContext } from './types.js';
const transitions = ['submit', 'withdraw', 'terminate', 'restartReview'];
const sdkActions = [
  'approve',
  'reject',
  'return',
  'comment',
  'read',
  'abstain',
  'appoint',
  'reassign',
];
export default function ActionDialog() {
  const { actionName = '' } = useParams(),
    { t } = useTranslation(),
    parent = useOutletContext<DetailContext>();
  const { session } = useAuthentication();
  const params = useParams();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const guard = useCloseGuard(busy);
  return (
    <RouteDrawer
      className='sm:max-w-2xl'
      title={t('vendorQualifications.confirmation', {
        name: parent.detail.record.name,
        action: t(`vendorQualifications.actions.${actionName}`),
      })}
      beforeClose={guard.beforeClose}
      footer={<Footer busy={busy} ready={ready} />}
    >
      <ActionForm
        key={`${session?.user.id ?? ''}:${params.requestId}:${actionName}:${params.targetId}`}
        onBusy={setBusy}
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
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('vendorQualifications.common.cancel')}
      </Button>
      <Button
        type='submit'
        form='qualification-action'
        disabled={busy || !ready}
      >
        {t('vendorQualifications.common.save')}
      </Button>
    </>
  );
}
function ActionForm({
  onBusy,
  onDirty,
  onSaved,
  onReady,
}: {
  onBusy: (busy: boolean) => void;
  onDirty: () => void;
  onSaved: () => void;
  onReady: (ready: boolean) => void;
}) {
  const { requestId = '', actionName = '', targetId = '' } = useParams(),
    parent = useOutletContext<DetailContext>(),
    { session } = useAuthentication(),
    { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay();
  const grant = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'view',
  });
  const mutation = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'submit',
  });
  const resource = useResource<QualificationDetail>(
    `vendorQualifications/${requestId}`,
    { viewer: session?.user.id ?? '' },
  );
  const journalKey = actionJournalKey(
    session?.user.id ?? '',
    requestId,
    actionName,
    targetId,
  );
  const [restored] = useState(() =>
    loadAction(journalKey, session?.user.id ?? ''),
  );
  const [uncertain, setUncertain] = useState(!!restored);
  const [comment, setComment] = useState(
      typeof restored?.json.comment === 'string' ? restored.json.comment : '',
    ),
    [to, setTo] = useState(''),
    [place, setPlace] = useState(''),
    [error, setError] = useState<unknown>(),
    [required, setRequired] = useState(false),
    [confirm, setConfirm] = useState(false),
    [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false),
    commandRef = useRef<ActionCommand | null>(restored);
  const data = resource.data;
  const offer = data
    ? offeredActions(
        data.actions,
        data.runActions,
        data.runs.map((r) => r.run),
      ).find(
        (a) =>
          a.name === actionName &&
          ('taskId' in a.target ? a.target.taskId : a.target.runId) ===
            targetId,
      )
    : undefined;
  const isTransition = transitions.includes(actionName);
  const allowed =
    parent.writable &&
    grant.can &&
    !grant.isPending &&
    !grant.error &&
    !!data &&
    !resource.loading &&
    !resource.error &&
    !blocked &&
    !uncertain &&
    (isTransition
      ? mutation.can &&
        !mutation.isPending &&
        !mutation.error &&
        targetId === data.record.id &&
        data.view.available.some((a) => a.name === actionName && a.allowed)
      : sdkActions.includes(actionName) && !!offer);
  useEffect(() => onReady(allowed && !busy), [allowed, busy, onReady]);
  const person = ['appoint', 'reassign'].includes(actionName);
  const places = Array.isArray(offer?.options.unassigned)
    ? offer.options.unassigned.filter(
        (v): v is { place: string; title: string | null } =>
          !!v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          typeof v.place === 'string',
      )
    : [];
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (finalRefusal(resource.error) || (!grant.isPending && !grant.can)) {
        setComment('');
        setTo('');
        setPlace('');
        setBlocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resource.error, grant.can, grant.isPending, parent]);
  function validate() {
    if (
      (['reject', 'withdraw', 'terminate', 'restartReview'].includes(
        actionName,
      ) &&
        !comment.trim()) ||
      (person && !to) ||
      (actionName === 'appoint' && places.length > 1 && !place)
    ) {
      setRequired(true);
      document
        .getElementById(
          person
            ? 'qualification-action-person'
            : 'qualification-action-comment',
        )
        ?.focus();
      return false;
    }
    return true;
  }
  async function execute() {
    if (
      !grant.can ||
      grant.isPending ||
      grant.error ||
      finalRefusal(resource.error)
    )
      return;
    if (
      (!allowed && !uncertain) ||
      lockRef.current ||
      (!uncertain && !validate())
    )
      return;
    lockRef.current = true;
    onBusy(true);
    setBusy(true);
    setConfirm(false);
    try {
      if (!commandRef.current) {
        const input: Record<string, string | boolean> = {};
        if (person) {
          input.to = to;
          if (actionName === 'appoint')
            input.place = place || places[0]?.place || '';
          else input.override = false;
        }
        if (actionName === 'return') input.to = 'revision';
        const command: ActionCommand = {
          actorId: session?.user.id ?? '',
          path: `vendorQualifications/${requestId}/${isTransition ? 'transition' : 'action'}`,
          json: isTransition
            ? {
                name: actionName,
                version: data!.record.lifecycleVersion,
                requestId: createRequestId(),
                input:
                  actionName === 'submit' ? {} : { reason: comment.trim() },
              }
            : {
                target: offer!.target,
                action: actionName,
                contentHash: offer!.contentHash,
                comment: comment.trim(),
                input,
                requestId: createRequestId(),
              },
        };
        // Persist before sending; retry never rebuilds this command from live controls.
        saveAction(journalKey, command);
        commandRef.current = command;
      }
      await api.request({
        method: 'POST',
        path: commandRef.current.path,
        json: commandRef.current.json,
      });
      clearAction(journalKey);
      setUncertain(false);
      parent.reload();
      toaster.show({
        type: 'success',
        title: t('vendorQualifications.doneNamed', {
          name: data?.record.name ?? parent.detail.record.name,
          action: t(`vendorQualifications.actions.${actionName}`),
        }),
      });
      lockRef.current = false;
      onBusy(false);
      setBusy(false);
      onSaved();
      await close();
    } catch (cause) {
      setError(cause);
      setBlocked(true);
      const unknown = !(cause instanceof ApiClientError) || cause.status >= 500;
      setUncertain(unknown);
      if (!unknown) {
        clearAction(journalKey);
        commandRef.current = null;
      }
      if (finalRefusal(cause)) {
        setComment('');
        setTo('');
        setPlace('');
      }
      parent.reloadDetail();
    } finally {
      lockRef.current = false;
      onBusy(false);
      setBusy(false);
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
      {uncertain && !error && (
        <Button
          disabled={busy || !grant.can || grant.isPending || !!grant.error}
          onClick={() => void execute()}
        >
          {t('approvals.retry')}
        </Button>
      )}
      {!!resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}{' '}
      {!!error && (
        <ErrorState
          error={error}
          retry={() => {
            if (uncertain) {
              void execute();
              return;
            }
            resource.reload();
            parent.reloadDetail();
            setBlocked(false);
          }}
        />
      )}{' '}
      {finalRefusal(resource.error) ||
      finalRefusal(error) ||
      grant.isPending ||
      !grant.can ||
      !!grant.error ? null : !data && !resource.error ? (
        <FieldsSkeleton fields={3} />
      ) : (
        <form
          id='qualification-action'
          onSubmit={(event) => {
            event.preventDefault();
            if (!allowed || !validate()) return;
            if (
              [
                'abstain',
                'reject',
                'withdraw',
                'terminate',
                'restartReview',
                'approve',
              ].includes(actionName)
            )
              setConfirm(true);
            else void execute();
          }}
        >
          <FieldGroup>
            {actionName === 'submit' ? (
              <p className='text-sm text-muted-foreground'>
                {t('vendorQualifications.consequence')}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor='qualification-action-comment'>
                {t('vendorQualifications.common.comment')}
                {['reject', 'withdraw', 'terminate', 'restartReview'].includes(
                  actionName,
                )
                  ? ' *'
                  : ''}
              </FieldLabel>
              <Textarea
                id='qualification-action-comment'
                disabled={!allowed || busy || uncertain}
                maxLength={4000}
                value={comment}
                onChange={(event) => {
                  if (uncertain) return;
                  onDirty();
                  setComment(event.target.value);
                  // Keep the original request key after an uncertain response.
                  setRequired(false);
                }}
              />
            </Field>
            {person && offer && (
              <Field>
                <FieldLabel htmlFor='qualification-action-person'>
                  {t('vendorQualifications.common.person')} *
                </FieldLabel>
                <CandidatePicker
                  id='qualification-action-person'
                  path={`vendorQualifications/${requestId}/candidates`}
                  query={{
                    action: actionName,
                    ...('taskId' in offer.target
                      ? { taskId: offer.target.taskId }
                      : { runId: offer.target.runId }),
                  }}
                  value={to}
                  onChange={(value) => {
                    if (uncertain) return;
                    onDirty();
                    setTo(value);
                    // Keep the original request key after an uncertain response.
                  }}
                  disabled={!allowed || busy || uncertain}
                />
              </Field>
            )}
            {actionName === 'appoint' && places.length > 1 && (
              <Choice
                label={t('vendorQualifications.configuration.seats')}
                value={place}
                onChange={(value) => {
                  if (!uncertain) setPlace(value);
                }}
                disabled={!allowed || busy || uncertain}
                items={places.map((p) => ({
                  value: p.place,
                  label: p.title ?? p.place,
                }))}
              />
            )}{' '}
            {required && (
              <FieldError>
                {t('vendorQualifications.common.required')}
              </FieldError>
            )}
            {!allowed && (
              <Alert>
                <AlertDescription>
                  {t('approvals.unavailable')}
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </form>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('vendorQualifications.confirmation', {
                name: data?.record.name ?? parent.detail.record.name,
                action: t(`vendorQualifications.actions.${actionName}`),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                actionName === 'abstain'
                  ? 'vendorQualifications.vetoAbstain'
                  : 'vendorQualifications.consequence',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('vendorQualifications.common.cancel')}
            </AlertDialogCancel>
            <Button
              variant={
                ['abstain', 'reject', 'withdraw', 'terminate'].includes(
                  actionName,
                )
                  ? 'destructive'
                  : 'default'
              }
              disabled={!allowed || busy || uncertain}
              onClick={() => void execute()}
            >
              {t(`vendorQualifications.actions.${actionName}`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
