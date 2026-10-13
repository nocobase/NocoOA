import { useProcessText } from './text.js';
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useParams, useLocation } from 'react-router';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { useRouteOverlay } from '#components/use-route-overlay';
import { ApprovalRecipientPicker } from '#components/approval-recipient-picker';
import { Button } from '#components/ui/button';
import { Field, FieldGroup, FieldLabel } from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { createRequestKey } from '#lib/request-key';
import { useExecution } from './execution-context.js';
import { ProcessListContext } from './resource.js';
import type { DetailDto } from '../../../server/routes/process-management/schemas.js';
type Options = {
  version: number;
  taskId: string;
  runId: string;
  contentHash: string;
  places?: string[];
  people: { id: string; name: string }[];
  nextOffset: number | null;
};
export default function ProcessActionPage() {
  const resource = useExecution(),
    { actionName = '', taskId = '' } = useParams();
  return (
    <ActionFrame
      key={`${resource.identity}:${actionName}:${taskId}`}
      action={actionName}
      taskId={taskId}
    />
  );
}
function ActionFrame({ action, taskId }: { action: string; taskId: string }) {
  const resource = useExecution(),
    detail = resource.data?.data,
    { t } = useTranslation(),
    text = useProcessText();
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(true),
    formId = useId();
  const busyRef = useRef(false),
    location = useLocation();
  const label =
    detail?.record.number ??
    `${text.name(detail?.record.kind ?? '')} · ${detail?.record.recordLabel ?? ''}`;
  return (
    <RouteDrawer
      title={t(
        action === 'appoint'
          ? 'processManagement.appointTitle'
          : 'processManagement.reassignTitle',
        { recordLabel: label },
      )}
      closeTo={{
        pathname: location.pathname.replace(/\/actions\/[^/]+\/[^/]+$/, ''),
        search: location.search,
        hash: location.hash,
      }}
      beforeClose={() => !busyRef.current}
      footer={
        <ActionFooter
          action={action}
          busy={busy}
          blocked={blocked}
          formId={formId}
        />
      }
    >
      <ActionForm
        action={action}
        taskId={taskId}
        busy={busy}
        onBusy={(value) => {
          busyRef.current = value;
          setBusy(value);
        }}
        onBlocked={setBlocked}
        formId={formId}
        label={label}
      />
    </RouteDrawer>
  );
}
export function ActionForm({
  action,
  taskId,
  busy,
  onBusy,
  onBlocked,
  formId,
  label,
}: {
  action: string;
  taskId: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onBlocked: (blocked: boolean) => void;
  formId: string;
  label: string;
}) {
  const resource = useExecution(),
    api = useApiClient(),
    { t } = useTranslation(),
    { close } = useRouteOverlay(),
    toaster = useToaster(),
    reloadList = useContext(ProcessListContext);
  const detail = resource.data?.data;
  const path = `processManagement/executions/${encodeURIComponent(detail?.record.kind ?? '')}/${encodeURIComponent(detail?.record.id ?? '')}`;
  const [options, setOptions] = useState<Options>();
  const [place, setPlace] = useState('');
  const [to, setTo] = useState(''),
    [reason, setReason] = useState(''),
    [validated, setValidated] = useState(false),
    [writeError, setWriteError] = useState<string>();
  const activeRef = useRef(true),
    requestIdRef = useRef(createRequestKey()),
    reasonRef = useRef<HTMLTextAreaElement>(null),
    personRef = useRef<HTMLInputElement>(null),
    placeRef = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  const searchCandidates = useCallback(
    async (search: string, signal: AbortSignal) => {
      const result = await api.request<{ data: Options }>({
        path: `${path}/managementOptions`,
        method: 'POST',
        json: { action, taskId, search, offset: 0, limit: 50 },
        signal,
      });
      if (!signal.aborted) setOptions(result.data);
      return result.data;
    },
    [api, path, action, taskId],
  );
  useEffect(
    () => onBlocked(!options || !to || Boolean(writeError)),
    [options, to, writeError, onBlocked],
  );
  async function submit() {
    setValidated(true);
    if (!to) {
      personRef.current?.focus();
      return;
    }
    if ((options?.places?.length ?? 0) > 1 && !place) {
      placeRef.current?.focus();
      return;
    }
    if (!reason.trim()) {
      reasonRef.current?.focus();
      return;
    }
    if (!options || busy || ((options.places?.length ?? 0) > 1 && !place))
      return;
    onBusy(true);
    setWriteError(undefined);
    try {
      const result = await api.request<{ data: { detail: DetailDto } }>({
        path: `${path}/managementActions`,
        method: 'POST',
        json: {
          action,
          taskId,
          runId: options.runId,
          contentHash: options.contentHash,
          expectedVersion: options.version,
          to,
          place: place || undefined,
          reason,
          requestId: requestIdRef.current,
        },
      });
      if (!activeRef.current) return;
      resource.update({ data: result.data.detail });
      reloadList();
      onBusy(false);
      toaster.show({
        type: 'success',
        title: t(
          action === 'appoint'
            ? 'processManagement.appointed'
            : 'processManagement.reassigned',
          { recordLabel: label },
        ),
      });
      await close();
    } catch (error) {
      if (activeRef.current) {
        setWriteError(
          error instanceof ApiClientError && error.status === 409
            ? 'stale'
            : error instanceof ApiClientError
              ? 'submitFailed'
              : 'unknown',
        );
        resource.reload();
      }
    } finally {
      if (activeRef.current) onBusy(false);
    }
  }
  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className='flex flex-col gap-4'
    >
      {writeError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(`processManagement.${writeError}`)}
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => {
                setWriteError(undefined);
                setOptions(undefined);
                setTo('');
              }}
            >
              {t('processManagement.refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field data-invalid={validated && !reason.trim()}>
          <FieldLabel htmlFor={`${id}-reason`}>
            {t('reimbursementRequests.actionForm.comment')} *
          </FieldLabel>
          <Textarea
            ref={reasonRef}
            id={`${id}-reason`}
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={validated && !reason.trim()}
          />
          {validated && !reason.trim() && (
            <p className='text-sm text-destructive'>
              {t('processManagement.reasonRequired')}
            </p>
          )}
        </Field>
        <Field data-invalid={validated && !to}>
          <FieldLabel htmlFor={`${id}-person`}>
            {t('processManagement.person')} *
          </FieldLabel>
          <ApprovalRecipientPicker
            id={`${id}-person`}
            taskId={taskId}
            action={action}
            value={to}
            onChange={setTo}
            disabled={busy || !!writeError}
            invalid={validated && !to}
            focusRef={(node) => {
              personRef.current = node;
            }}
            searchCandidates={searchCandidates}
          />
          {validated && !to && (
            <p className='text-sm text-destructive'>
              {t('processManagement.personRequired')}
            </p>
          )}
        </Field>
        {(options?.places?.length ?? 0) > 1 && (
          <div className='flex flex-col gap-2'>
            <FieldLabel htmlFor={`${id}-place`}>
              {t('processManagement.place')} *
            </FieldLabel>
            <Select
              value={place}
              onValueChange={(value) => setPlace(value ?? '')}
            >
              <SelectTrigger
                disabled={busy}
                ref={placeRef}
                id={`${id}-place`}
                aria-label={t('processManagement.place')}
                aria-invalid={validated && !place}
              >
                <SelectValue placeholder={t('processManagement.place')} />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                <SelectGroup>
                  {options?.places?.map((key, i) => (
                    <SelectItem key={key} value={key}>
                      {t('processManagement.placeNumber', { number: i + 1 })}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {validated && !place && (
              <p className='text-sm text-destructive'>
                {t('processManagement.placeRequired')}
              </p>
            )}
          </div>
        )}
      </FieldGroup>
    </form>
  );
}

function ActionFooter({
  action,
  busy,
  blocked,
  formId,
}: {
  action: string;
  busy: boolean;
  blocked: boolean;
  formId: string;
}) {
  const { t } = useTranslation(),
    { close } = useRouteOverlay();
  return (
    <div className='flex justify-end gap-2'>
      <Button variant='outline' disabled={busy} onClick={() => void close()}>
        {t('processManagement.cancel')}
      </Button>
      <Button type='submit' form={formId} disabled={busy || blocked}>
        {t(
          busy
            ? 'processManagement.loading'
            : action === 'appoint'
              ? 'processManagement.appoint'
              : 'processManagement.reassign',
        )}
      </Button>
    </div>
  );
}
