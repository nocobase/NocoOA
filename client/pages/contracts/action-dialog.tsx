import { finalRefusal, uncertainError } from './errors.js';
import { useCloseGuard } from './use-close-guard.js';
import { useEffect, useRef, useState } from 'react';
import { useParams, useOutletContext, useLocation } from 'react-router';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import {
  FieldGroup,
  Field,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useResource } from '../approvals/use-resource.js';
import { createRequestId } from '../approvals/request-id.js';
import { offersOf, needsLegalOpinion } from './model.js';
import {
  keyOf,
  loadCommand,
  saveCommand,
  clearCommand,
  clearActor,
  type Command,
} from './journal.js';
import {
  ErrorState,
  Loading,
  Choice,
  Confirmation,
  Discard,
} from './shared.js';
import { CandidatePicker } from './candidate-picker.js';
import type { ContractDetail, DetailContext } from './types.js';
const RECORD = ['submit', 'withdraw', 'terminate', 'historicalEntry'];
const PEOPLE = ['transfer', 'addSigner', 'appoint', 'reassign'];
export default function ActionDialog() {
  const { session } = useAuthentication(),
    location = useLocation();
  const { actionName = '' } = useParams(),
    parent = useOutletContext<DetailContext>(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    guard = useCloseGuard(busy);
  return (
    <RouteDrawer
      className={PEOPLE.includes(actionName) ? 'sm:max-w-2xl' : 'sm:max-w-2xl'}
      title={t('contracts.confirmation', {
        action: t(`contracts.actions.${actionName}`),
        name: parent.detail.record.number ?? t('contracts.draftName'),
      })}
      beforeClose={guard.beforeClose}
      footer={<Footer busy={busy} ready={ready} action={actionName} />}
    >
      <ActionForm
        key={`${session?.user.id}:${location.pathname}`}
        onBusy={setBusy}
        onReady={setReady}
        onDirty={guard.changed}
        onSaved={guard.saved}
      />
      <Discard guard={guard} />
    </RouteDrawer>
  );
}
function Footer({
  busy,
  ready,
  action,
}: {
  busy: boolean;
  ready: boolean;
  action: string;
}) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('contracts.cancel')}
      </Button>
      <Button type='submit' form='contract-action' disabled={busy || !ready}>
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t(`contracts.actions.${action}`)}
      </Button>
    </>
  );
}
function ActionForm({
  onBusy,
  onReady,
  onDirty,
  onSaved,
}: {
  onBusy: (v: boolean) => void;
  onReady: (v: boolean) => void;
  onDirty: () => void;
  onSaved: () => void;
}) {
  const { requestId = '', actionName = '', targetId = '' } = useParams(),
    location = useLocation(),
    parent = useOutletContext<DetailContext>(),
    { session } = useAuthentication(),
    actorId = session?.user.id ?? '',
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    { t } = useTranslation();
  const resource = useResource<ContractDetail>(
    `contractRequests/${requestId}`,
    { viewer: actorId },
  );
  const grant = useCan({
    resource: { type: 'composite', id: 'oa.contract' },
    action: RECORD.includes(actionName)
      ? actionName === 'historicalEntry'
        ? 'historicalEntry'
        : 'submit'
      : 'view',
  });
  const journalKey = keyOf(actorId, location.pathname, 'action'),
    [restored] = useState(() => loadCommand(journalKey, actorId)),
    commandRef = useRef<Command | null>(restored),
    lockRef = useRef(false);
  const [unknown, setUnknown] = useState(!!restored),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [blocked, setBlocked] = useState(false),
    [completed, setCompleted] = useState(false),
    [comment, setComment] = useState(
      typeof restored?.body.comment === 'string' ? restored.body.comment : '',
    ),
    [person, setPerson] = useState(''),
    [opinion, setOpinion] = useState(''),
    [mode, setMode] = useState('alongside'),
    [place, setPlace] = useState(''),
    [attempted, setAttempted] = useState(false),
    [confirm, setConfirm] = useState(false);
  const data = resource.data,
    offer = data
      ? offersOf(data).find(
          (a) =>
            a.name === actionName &&
            ('taskId' in a.target ? a.target.taskId : a.target.runId) ===
              targetId,
        )
      : undefined;
  const transition = RECORD.includes(actionName),
    valid =
      grant.can &&
      !grant.error &&
      !grant.isPending &&
      !!data &&
      !resource.loading &&
      !resource.error &&
      !blocked &&
      !completed &&
      (transition
        ? targetId === requestId &&
          data.view.available.some((a) => a.name === actionName && a.allowed)
        : !!offer);
  const legal =
      actionName === 'approve' && !!data && needsLegalOpinion(data, targetId),
    needsPerson = PEOPLE.includes(actionName),
    needsReason =
      !!offer?.reasonRequired ||
      ['reject', 'withdraw', 'terminate'].includes(actionName);
  const places = Array.isArray(offer?.options.unassigned)
    ? offer.options.unassigned.filter(
        (v): v is { place: string; title: string | null } =>
          !!v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          typeof v.place === 'string',
      )
    : [];
  const reasonInvalid = attempted && needsReason && !comment.trim(),
    personInvalid = attempted && needsPerson && !person,
    opinionInvalid = attempted && legal && !opinion,
    placeInvalid =
      attempted && actionName === 'appoint' && places.length > 1 && !place;
  useEffect(
    () => onReady(valid && !unknown && !busy),
    [valid, unknown, busy, onReady],
  );
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (
        finalRefusal(resource.error) ||
        (!grant.isPending && !grant.can) ||
        finalRefusal(error)
      ) {
        clearActor(actorId);
        commandRef.current = null;
        setComment('');
        setPerson('');
        setOpinion('');
        setBlocked(true);
        setUnknown(false);
        parent.reload();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resource.error, error, grant.isPending, grant.can, actorId, parent]);
  function validate() {
    setAttempted(true);
    const id =
      needsReason && !comment.trim()
        ? 'contract-action-comment'
        : needsPerson && !person
          ? 'contract-action-recipient'
          : legal && !opinion
            ? 'contract-action-opinion'
            : actionName === 'appoint' && places.length > 1 && !place
              ? 'contract-action-place'
              : null;
    if (id) {
      document.getElementById(id)?.focus();
      return false;
    }
    return true;
  }
  async function execute(retry = false) {
    if (
      lockRef.current ||
      blocked ||
      !grant.can ||
      grant.isPending ||
      resource.error ||
      (!retry && (!valid || !validate()))
    )
      return;
    lockRef.current = true;
    setBusy(true);
    onBusy(true);
    setConfirm(false);
    setError(undefined);
    try {
      if (!commandRef.current) {
        const input: Record<string, unknown> = {};
        if (needsPerson) {
          if (actionName === 'addSigner') {
            input.person = person;
            input.mode = mode;
          } else input.to = person;
          if (actionName === 'appoint') input.place = place || places[0]?.place;
          if (actionName === 'reassign') input.override = false;
        }
        if (actionName === 'return') input.to = 'revision';
        if (legal) input.data = { nonStandard: opinion === 'yes' };
        const path = `contractRequests/${requestId}/${actionName === 'historicalEntry' ? 'historicalEntry' : transition ? 'transition' : 'action'}`;
        commandRef.current = {
          actorId,
          path,
          body:
            actionName === 'historicalEntry'
              ? {
                  version: data!.record.lifecycleVersion,
                  requestId: createRequestId(),
                }
              : transition
                ? {
                    name: actionName,
                    version: data!.record.lifecycleVersion,
                    requestId: createRequestId(),
                    input: needsReason ? { reason: comment.trim() } : {},
                  }
                : {
                    target: offer!.target,
                    action: actionName,
                    contentHash: offer!.contentHash,
                    input,
                    requestId: createRequestId(),
                    ...(comment.trim() ? { comment: comment.trim() } : {}),
                  },
        };
        saveCommand(journalKey, commandRef.current);
      }
      await api.request({
        method: 'POST',
        path: commandRef.current.path,
        json: commandRef.current.body,
      });
      setCompleted(true);
      clearCommand(journalKey);
      commandRef.current = null;
      setUnknown(false);
      const { data: latest } = await api.request<{ data: ContractDetail }>({
        path: `contractRequests/${requestId}`,
      });
      parent.apply(latest);
      parent.reload();
      onSaved();
      toaster.show({
        title: t('contracts.completed', {
          name: latest.record.number ?? t('contracts.draftName'),
        }),
      });
      await close();
    } catch (cause) {
      setError(cause);
      if (commandRef.current && uncertainError(cause)) setUnknown(true);
      else {
        clearCommand(journalKey);
        commandRef.current = null;
        setUnknown(false);
      }
    } finally {
      lockRef.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  const frozen = busy || unknown || !valid;
  return (
    <>
      <form
        id='contract-action'
        onSubmit={(e) => {
          e.preventDefault();
          if (!validate() || !valid) return;
          if (['withdraw', 'terminate', 'historicalEntry'].includes(actionName))
            setConfirm(true);
          else void execute();
        }}
      >
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {error ? <ErrorState error={error} retry={resource.reload} /> : null}
        {!data && !resource.error ? (
          <Loading fields={3} />
        ) : blocked ? (
          <Alert>
            <AlertDescription>{t('contracts.noAccess')}</AlertDescription>
          </Alert>
        ) : (
          <FieldGroup>
            {needsPerson ? (
              <Field data-invalid={personInvalid}>
                <FieldLabel htmlFor='contract-action-recipient'>
                  {t('contracts.recipient')} *
                </FieldLabel>
                <CandidatePicker
                  path={`contractRequests/${requestId}/candidates`}
                  query={{
                    action: actionName,
                    ...(offer && 'runId' in offer.target
                      ? { runId: offer.target.runId }
                      : { taskId: targetId }),
                  }}
                  id='contract-action-recipient'
                  value={person}
                  onChange={(v) => {
                    setPerson(v);
                    onDirty();
                  }}
                  disabled={frozen}
                  known={data?.knownUsers}
                />
                {personInvalid && (
                  <FieldError>{t('contracts.required')}</FieldError>
                )}
              </Field>
            ) : null}
            {actionName === 'appoint' && places.length > 1 ? (
              <Field data-invalid={placeInvalid}>
                <FieldLabel htmlFor='contract-action-place'>
                  {t('contracts.place')} *
                </FieldLabel>
                <Choice
                  id='contract-action-place'
                  label={t('contracts.place')}
                  value={place}
                  items={places.map((v) => ({
                    value: v.place,
                    label: v.title ?? t('contracts.place'),
                  }))}
                  onChange={(v) => {
                    setPlace(v);
                    onDirty();
                  }}
                  disabled={frozen}
                  invalid={placeInvalid}
                />
                {placeInvalid && (
                  <FieldError>{t('contracts.required')}</FieldError>
                )}
              </Field>
            ) : null}
            {actionName === 'addSigner' ? (
              <Field>
                <FieldLabel htmlFor='contract-action-mode'>
                  {t('contracts.signerMode')}
                </FieldLabel>
                <Choice
                  id='contract-action-mode'
                  label={t('contracts.signerMode')}
                  value={mode}
                  items={['before', 'after', 'alongside'].map((value) => ({
                    value,
                    label: t(`contracts.modes.${value}`),
                  }))}
                  onChange={(v) => {
                    setMode(v);
                    onDirty();
                  }}
                  disabled={frozen}
                />
              </Field>
            ) : null}
            {legal ? (
              <Field data-invalid={opinionInvalid}>
                <FieldLabel htmlFor='contract-action-opinion'>
                  {t('contracts.nonStandard')} *
                </FieldLabel>
                <Choice
                  id='contract-action-opinion'
                  label={t('contracts.selectOpinion')}
                  value={opinion}
                  items={['yes', 'no'].map((value) => ({
                    value,
                    label: t(`contracts.${value}`),
                  }))}
                  onChange={(v) => {
                    setOpinion(v);
                    onDirty();
                  }}
                  disabled={frozen}
                  invalid={opinionInvalid}
                />
                {opinionInvalid && (
                  <FieldError>{t('contracts.required')}</FieldError>
                )}
              </Field>
            ) : null}
            {!['claim', 'read', 'urge'].includes(actionName) ? (
              <Field data-invalid={reasonInvalid}>
                <FieldLabel htmlFor='contract-action-comment'>
                  {t('contracts.comment')}
                  {needsReason ? ' *' : ''}
                </FieldLabel>
                <Textarea
                  id='contract-action-comment'
                  value={comment}
                  disabled={frozen}
                  maxLength={5000}
                  aria-invalid={reasonInvalid || undefined}
                  onChange={(e) => {
                    setComment(e.target.value);
                    onDirty();
                  }}
                />
                {reasonInvalid && (
                  <FieldError>{t('contracts.required')}</FieldError>
                )}
              </Field>
            ) : null}
            {!valid && !resource.loading && !resource.error ? (
              <Alert>
                <AlertDescription>
                  {t('contracts.notAvailable')}
                </AlertDescription>
              </Alert>
            ) : null}
          </FieldGroup>
        )}
      </form>
      {unknown ? (
        <Alert>
          <AlertDescription>{t('contracts.unknown')}</AlertDescription>
          <Button
            variant='outline'
            disabled={busy || blocked || finalRefusal(resource.error)}
            onClick={() => void execute(true)}
          >
            {t('contracts.retryExact')}
          </Button>
        </Alert>
      ) : null}
      <Confirmation
        open={confirm}
        title={t('contracts.confirmation', {
          action: t(`contracts.actions.${actionName}`),
          name: data?.record.number ?? t('contracts.draftName'),
        })}
        description={t(
          actionName === 'historicalEntry'
            ? 'contracts.historicalConsequence'
            : 'contracts.dangerConsequence',
        )}
        confirm={t(`contracts.actions.${actionName}`)}
        destructive={actionName !== 'historicalEntry'}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void execute()}
      />
    </>
  );
}
