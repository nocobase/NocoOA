import { createRequestKey } from '#lib/request-key';
import { useRef, useState } from 'react';
import { useParams, useOutletContext } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Textarea } from '#components/ui/textarea';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Alert, AlertDescription } from '#components/ui/alert';
import type { OfferedAction } from '@nocobase/app-plugin-approval/client';
import {
  useRecruitmentResource,
  useViewerKey,
  useMutationBoundary,
} from './resource.js';
import { offersOf } from './model.js';
import {
  Choice,
  Confirmation,
  Discard,
  ErrorState,
  Loading,
} from './shared.js';
import { CandidatePicker } from './candidate-picker.js';
import { useCloseGuard } from './use-close-guard.js';
import type { Detail, Source } from './types.js';
const peopleActions = ['transfer', 'addSigner', 'cc', 'appoint', 'reassign'];
export default function RecruitmentAction() {
  const key = useViewerKey();
  return <RecruitmentActionContent key={key} />;
}
function RecruitmentActionContent() {
  const { requestId = '', operation = '', targetId = '' } = useParams(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [formBlocked, setFormBlocked] = useState(false),
    guard = useCloseGuard(busy),
    r = useRecruitmentResource<{ data: Detail }>(
      `recruitmentRequests/${encodeURIComponent(requestId)}`,
    ),
    detail = r.data?.data,
    offer = detail
      ? offersOf(detail).find(
          (o) =>
            o.name === operation &&
            ('taskId' in o.target ? o.target.taskId : o.target.runId) ===
              targetId,
        )
      : undefined,
    transition =
      !targetId &&
      ['submit', 'withdraw', 'terminate'].includes(operation) &&
      (operation === 'submit'
        ? detail?.canSubmit
        : detail?.view.available.some(
            (v) => v.name === operation && v.allowed,
          )),
    ready = !r.loading && !r.error && (!!offer || !!transition);
  return (
    <RouteDrawer
      title={t(`recruitment.actions.${operation}`)}
      className={
        peopleActions.includes(operation) ? 'sm:max-w-2xl' : 'sm:max-w-2xl'
      }
      beforeClose={guard.beforeClose}
      footer={
        <Footer
          busy={busy}
          ready={ready && !formBlocked}
          operation={operation}
        />
      }
    >
      {r.error ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : r.loading ? (
        <Loading />
      ) : ready && detail ? (
        <Body
          key={`${detail.record.lifecycleVersion}:${offer?.key ?? operation}`}
          detail={detail}
          offer={offer}
          operation={operation}
          onBusy={setBusy}
          onBlocked={setFormBlocked}
          onReload={() => {
            setFormBlocked(false);
            r.reload();
          }}
          guard={guard}
        />
      ) : (
        <Alert>
          <AlertDescription>{t('recruitment.notAvailable')}</AlertDescription>
        </Alert>
      )}
      <Discard guard={guard} />
    </RouteDrawer>
  );
}
function Footer({
  busy,
  ready,
  operation,
}: {
  busy: boolean;
  ready: boolean;
  operation: string;
}) {
  const { close } = useRouteOverlay(),
    { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('recruitment.cancel')}
      </Button>
      <Button form='recruitment-action' type='submit' disabled={busy || !ready}>
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t(`recruitment.actions.${operation}`)}
      </Button>
    </>
  );
}
function Body({
  detail,
  offer,
  operation,
  onBusy,
  onBlocked,
  onReload,
  guard,
}: {
  detail: Detail;
  offer?: OfferedAction;
  operation: string;
  onBusy: (v: boolean) => void;
  onBlocked: (v: boolean) => void;
  onReload: () => void;
  guard: ReturnType<typeof useCloseGuard>;
}) {
  const boundary = useMutationBoundary();
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    { close } = useRouteOverlay(),
    parent = useOutletContext<Source>(),
    lockRef = useRef(false),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState(''),
    [returnTarget, setReturnTarget] = useState(''),
    [mode, setMode] = useState(''),
    [place, setPlace] = useState(''),
    [error, setError] = useState<unknown>(),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [confirm, setConfirm] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false),
    [body, setBody] = useState<unknown>();
  const targets = Array.isArray(offer?.options.targets)
      ? offer.options.targets.filter((v): v is string => typeof v === 'string')
      : [],
    modes = Array.isArray(offer?.options.modes)
      ? offer.options.modes.filter((v): v is string => typeof v === 'string')
      : [],
    places = Array.isArray(offer?.options.unassigned)
      ? offer.options.unassigned.filter(
          (v): v is { place: string; title: string | null } =>
            !!v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            typeof v.place === 'string',
        )
      : [],
    needsRecipient = peopleActions.includes(operation),
    frozen = busy || uncertain || blocked;
  function prepare() {
    const invalid: Record<string, string> = {};
    const required = t('approvals.required');
    if (!reason.trim()) invalid.reason = required;
    if (needsRecipient && !recipient) invalid.recipient = required;
    if (operation === 'return' && !targets.includes(returnTarget))
      invalid.return = required;
    if (operation === 'addSigner' && !modes.includes(mode))
      invalid['signer-mode'] = required;
    if (operation === 'appoint' && !places.some((p) => p.place === place))
      invalid.place = required;
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      document
        .getElementById(`recruitment-${Object.keys(invalid)[0]}`)
        ?.focus();
      return false;
    }
    const input: Record<string, unknown> = {};
    if (operation === 'return') input.to = returnTarget;
    if (needsRecipient) {
      if (operation === 'addSigner') {
        input.person = recipient;
        input.mode = mode;
      } else input.to = operation === 'cc' ? [recipient] : recipient;
    }
    if (operation === 'appoint') input.place = place;
    if (operation === 'reassign') input.override = false;
    const prepared = offer
      ? {
          requestKey: createRequestKey(),
          reason: reason.trim(),
          action: operation,
          target: offer.target,
          ...(offer.contentHash ? { contentHash: offer.contentHash } : {}),
          input,
          comment: reason.trim(),
        }
      : {
          requestKey: createRequestKey(),
          reason: reason.trim(),
          transition: operation,
          version: detail.record.lifecycleVersion,
        };
    setBody(prepared);
    return prepared;
  }
  async function execute(command = body) {
    const signal = boundary.getSignal();
    if (lockRef.current || blocked || !command) return;
    lockRef.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `recruitmentRequests/${detail.record.id}/${offer ? 'actions' : 'transitions'}`,
        json: command,
        signal,
      });
      if (signal.aborted) return;
      guard.saved();
      parent.reload();
      setUncertain(false);
      onBusy(false);
      toaster.show({ type: 'success', title: t('recruitment.saved') });
      await close();
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause);
      setUncertain(!(cause instanceof ApiClientError) || cause.status >= 500);
      if (
        cause instanceof ApiClientError &&
        [401, 403, 404, 409, 412].includes(cause.status)
      ) {
        setBlocked(true);
        onBlocked(true);
        setReason('');
        setRecipient('');
        setBody(undefined);
        parent.reload();
      }
    } finally {
      if (!signal.aborted) {
        lockRef.current = false;
        setBusy(false);
        onBusy(false);
        setConfirm(false);
      }
    }
  }
  return (
    <>
      <form
        id='recruitment-action'
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (frozen || lockRef.current) return;
          const prepared = prepare();
          if (!prepared) return;
          if (operation === 'submit') void execute(prepared);
          else setConfirm(true);
        }}
      >
        <FieldGroup>
          {operation === 'submit' ? (
            <p className='text-sm text-muted-foreground'>
              {t('recruitment.actionConsequence')}
            </p>
          ) : null}
          {error instanceof Error &&
          !(error instanceof ApiClientError) &&
          error.message === t('recruitment.actionInvalid') ? (
            <Alert variant='destructive'>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : error ? (
            <ErrorState error={error} retry={onReload} />
          ) : null}
          {needsRecipient && offer && 'taskId' in offer.target ? (
            <Field>
              <FieldLabel htmlFor='recruitment-recipient'>
                {t('recruitment.recipient')} *
              </FieldLabel>
              <CandidatePicker
                id='recruitment-recipient'
                path={`recruitmentRequests/${detail.record.id}/candidates`}
                query={{ taskId: offer.target.taskId, action: operation }}
                value={recipient}
                disabled={frozen}
                known={detail.users}
                onChange={(v) => {
                  setRecipient(v);
                  setFieldErrors((old) => ({ ...old, recipient: '' }));
                  guard.changed();
                }}
              />
              {fieldErrors['recipient'] && (
                <FieldError>{fieldErrors['recipient']}</FieldError>
              )}
            </Field>
          ) : null}
          {operation === 'return' ? (
            <Field>
              <FieldLabel htmlFor='recruitment-return'>
                {t('recruitment.returnTarget')} *
              </FieldLabel>
              <Choice
                id='recruitment-return'
                label={t('recruitment.returnTarget')}
                value={returnTarget}
                items={targets.map((value) => ({
                  value,
                  label: t(`recruitment.status.${value}`),
                }))}
                disabled={frozen}
                onChange={(v) => {
                  setReturnTarget(v);
                  setFieldErrors((old) => ({ ...old, return: '' }));
                  guard.changed();
                }}
              />
              {fieldErrors['return'] && (
                <FieldError>{fieldErrors['return']}</FieldError>
              )}
            </Field>
          ) : null}
          {operation === 'addSigner' ? (
            <Field>
              <FieldLabel htmlFor='recruitment-signer-mode'>
                {t('recruitment.signerMode')} *
              </FieldLabel>
              <Choice
                id='recruitment-signer-mode'
                label={t('recruitment.signerMode')}
                value={mode}
                items={modes.map((value) => ({
                  value,
                  label: t(`recruitment.modes.${value}`),
                }))}
                disabled={frozen}
                onChange={(v) => {
                  setMode(v);
                  setFieldErrors((old) => ({ ...old, 'signer-mode': '' }));
                  guard.changed();
                }}
              />
              {fieldErrors['signer-mode'] && (
                <FieldError>{fieldErrors['signer-mode']}</FieldError>
              )}
            </Field>
          ) : null}
          {operation === 'appoint' ? (
            <Field>
              <FieldLabel htmlFor='recruitment-place'>
                {t('recruitment.place')} *
              </FieldLabel>
              <Choice
                id='recruitment-place'
                label={t('recruitment.place')}
                value={place}
                items={places.map((p) => ({
                  value: p.place,
                  label: p.title ?? t('recruitment.place'),
                }))}
                disabled={frozen}
                onChange={(v) => {
                  setPlace(v);
                  setFieldErrors((old) => ({ ...old, place: '' }));
                  guard.changed();
                }}
              />
              {fieldErrors['place'] && (
                <FieldError>{fieldErrors['place']}</FieldError>
              )}
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor='recruitment-reason'>
              {t('recruitment.commandReason')} *
            </FieldLabel>
            <Textarea
              id='recruitment-reason'
              required
              maxLength={10000}
              value={reason}
              disabled={frozen}
              onChange={(e) => {
                setReason(e.target.value);
                setFieldErrors((old) => ({ ...old, reason: '' }));
                guard.changed();
              }}
            />
            {fieldErrors['reason'] && (
              <FieldError>{fieldErrors['reason']}</FieldError>
            )}
          </Field>
        </FieldGroup>
      </form>
      {uncertain ? (
        <Alert>
          <AlertDescription>{t('recruitment.unknown')}</AlertDescription>
          <Button
            variant='outline'
            disabled={busy || blocked}
            onClick={() => void execute()}
          >
            {t('recruitment.retryExact')}
          </Button>
        </Alert>
      ) : null}
      <Confirmation
        open={confirm}
        title={t('recruitment.confirmAction', {
          action: t(`recruitment.actions.${operation}`),
          id: detail.record.id,
        })}
        description={t('recruitment.actionConsequence')}
        confirm={t(`recruitment.actions.${operation}`)}
        destructive={['reject', 'withdraw', 'terminate'].includes(operation)}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void execute()}
      />
    </>
  );
}
