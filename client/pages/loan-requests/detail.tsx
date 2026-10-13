import { ApprovalProgress } from '#components/approval-progress';
import { LoanFinancialSections } from './repayments.js';
import { LoanFacts } from './facts.js';
import { createRequestId } from '../approvals/request-id.js';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '#components/ui/alert-dialog';
import { Spinner } from '#components/ui/spinner';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  ApprovalUiProvider,
  ApprovalTimeline,
  ApprovalActionBar,
  type ApprovalBarAction,
} from '#extensions/nocobase-approval-ui';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from './states.js';
import { progressOf, copiesOf, timelineOf } from './approval-mapping.js';
import {
  ACTIONS,
  type LoanRequestDetail,
  type LoanRequestRecord,
  type SourceContext,
} from './types.js';

export default function LoanRequestDetailPage() {
  const { requestId } = useParams();
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const parent = useOutletContext<SourceContext>();
  const resource = useResource<LoanRequestDetail>(
    `loanRequests/${encodeURIComponent(requestId ?? '')}`,
  );
  const missingErrorRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (missingErrorRef.current === resource.error) return;
    missingErrorRef.current = resource.error;
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent.reload();
  }, [resource.error, parent]);
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<unknown>();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState('');
  const modalErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm && writeError && !pending) modalErrorRef.current?.focus();
  }, [confirm, writeError, pending]);
  const data = resource.data;
  const record = data?.record;
  const name = record?.number ?? t('approvals.draft');
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      data?.users.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      t(
        ['manager', 'head', 'finance', 'executive', 'gm', 'cashier'].includes(
          key,
        )
          ? `loanRequests.stages.${key}`
          : `approvals.stages.${key}`,
        { defaultValue: t('approvals.progress') },
      ),
  };
  async function transition(action: string) {
    if (!record) return;
    setPending(true);
    setWriteError(undefined);
    try {
      const { data: result } = await api.request<{
        data: { record: LoanRequestRecord };
      }>({
        method: 'POST',
        path: `loanRequests/${record.id}/transition`,
        json: {
          transition: action,
          version: record.lifecycleVersion,
          requestId: requestKey || createRequestId(),
          input: {},
        },
      });
      resource.update({
        ...data,
        record: result.record,
        taskActions: [],
        runActions: [],
      });
      setConfirm(null);
      resource.reload();
      parent.reload();
      toaster.show({
        type: 'success',
        title: t('approvals.completed', {
          name,
          action: t(`approvals.${action}`),
        }),
      });
    } catch (error) {
      setWriteError(error);
    } finally {
      setPending(false);
    }
  }
  async function read(action: ReturnType<typeof offeredActions>[number]) {
    if (!record) return;
    setPending(true);
    try {
      await api.request({
        method: 'POST',
        path: `loanRequests/${record.id}/action`,
        json: {
          target: action.target,
          action: action.name,
          contentHash: action.contentHash ?? undefined,
          requestId: createRequestId(),
        },
      });
      resource.update({ ...data, taskActions: [], runActions: [] });
      resource.reload();
      parent.reload();
      toaster.show({
        type: 'success',
        title: t('approvals.completed', { name, action: t('approvals.read') }),
      });
    } catch (error) {
      setWriteError(error);
    } finally {
      setPending(false);
    }
  }
  const submissionBlocked = false;
  const writable = !resource.loading && !resource.error;
  const lifecycleActions =
    (writable ? data?.view.available : undefined)?.filter((v) =>
      ['edit', 'submit', 'withdraw', 'terminate', 'retryCash'].includes(v.name),
    ) ?? [];
  const submit = lifecycleActions.find(
    (a) => a.name === 'submit' && a.allowed && !submissionBlocked,
  );
  const offered =
    data && writable
      ? offeredActions(
          data.taskActions,
          data.runActions,
          data.runs.map((r) => r.run),
        ).filter((a) => (ACTIONS as readonly string[]).includes(a.name))
      : [];
  const primaryKey = submit ? null : offered.find((a) => a.primary)?.key;
  const bar: ApprovalBarAction[] = offered.map((action) => ({
    key: action.key,
    label: [
      'complete',
      'unable',
      'retryCash',
      'claim',
      'release',
      'assign',
    ].includes(action.name)
      ? t(`loanRequests.operationLabels.${action.name}`)
      : t(`approvals.${action.name}`),
    tone:
      action.tone === 'danger'
        ? 'danger'
        : action.key === primaryKey
          ? 'primary'
          : 'default',
    primary: action.key === primaryKey,
    group: ['appoint', 'reassign'].includes(action.name) ? 'admin' : 'task',
    run: async () => {
      if (action.name === 'read') {
        await read(action);
        return;
      }
      await navigate({
        pathname: `action/${action.name}/${'taskId' in action.target ? action.target.taskId : action.target.runId}`,
        search: location.search,
      });
    },
  }));
  return (
    <RecordDetailDrawer
      headerStatus={
        record ? (
          <StatusBadge
            tone={
              record.status === 'paid'
                ? 'success'
                : ['rejected', 'terminated'].includes(record.status)
                  ? 'warning'
                  : 'neutral'
            }
          >
            {t(
              [
                'manager',
                'head',
                'finance',
                'executive',
                'gm',
                'cashier',
              ].includes(record.status)
                ? `loanRequests.stages.${record.status}`
                : `loanRequests.states.${record.status}`,
            )}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!data || resource.loading || !!resource.error}
      title={name}
      description={t('approvals.facts')}
      footer={
        <>
          <div className='flex flex-wrap items-center gap-2'>
            {bar.length ? (
              <ApprovalActionBar actions={bar} busy={pending} />
            ) : null}
            {lifecycleActions.map((action) =>
              action.name === 'edit' ? (
                action.allowed ? (
                  <Button
                    key={action.name}
                    variant='outline'
                    disabled={pending}
                    render={
                      <Link
                        to={{ pathname: 'edit', search: location.search }}
                      />
                    }
                    nativeButton={false}
                  >
                    {t('approvals.edit')}
                  </Button>
                ) : null
              ) : action.name === 'terminate' ? (
                action.allowed ? (
                  <Button
                    key={action.name}
                    variant='destructive'
                    disabled={pending}
                    render={
                      <Link
                        to={{
                          pathname: 'action/terminate/record',
                          search: location.search,
                        }}
                      />
                    }
                    nativeButton={false}
                  >
                    {t('approvals.terminate')}
                  </Button>
                ) : null
              ) : (
                <Tooltip key={action.name}>
                  <TooltipTrigger
                    render={
                      <Button
                        variant={
                          action.name === 'submit' ? 'default' : 'outline'
                        }
                        disabled={
                          pending ||
                          !action.allowed ||
                          resource.loading ||
                          (action.name === 'submit' && submissionBlocked)
                        }
                        onClick={() => {
                          setWriteError(undefined);
                          setRequestKey(createRequestId());
                          setConfirm(action.name);
                        }}
                      />
                    }
                  >
                    {[
                      'complete',
                      'unable',
                      'retryCash',
                      'claim',
                      'release',
                      'assign',
                    ].includes(action.name)
                      ? t(`loanRequests.operationLabels.${action.name}`)
                      : t(`approvals.${action.name}`)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {action.allowed
                      ? [
                          'complete',
                          'unable',
                          'retryCash',
                          'claim',
                          'release',
                          'assign',
                        ].includes(action.name)
                        ? t(`loanRequests.operationLabels.${action.name}`)
                        : t(`approvals.${action.name}`)
                      : action.blockers
                          .map((v) => t(v.message, { defaultValue: v.message }))
                          .join(' · ') || t('approvals.unavailable')}
                  </TooltipContent>
                </Tooltip>
              ),
            )}
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('approvals.refresh')}
                  disabled={pending || resource.loading}
                  onClick={resource.reload}
                />
              }
            >
              <RefreshCw
                className={resource.loading ? 'animate-spin' : undefined}
              />
            </TooltipTrigger>
            <TooltipContent>{t('approvals.refresh')}</TooltipContent>
          </Tooltip>
        </>
      }
      beforeClose={() => !pending}
    >
      <div className='flex flex-col gap-6'>
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {writeError && !confirm ? (
          <ErrorState error={writeError} retry={resource.reload} />
        ) : null}
        {!data ? (
          resource.loading && !resource.error ? (
            <FieldsSkeleton fields={8} />
          ) : null
        ) : (
          <ApprovalUiProvider
            personName={text.name}
            formatDateTime={(v) =>
              new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: data?.timeZone,
              }).format(new Date(v))
            }
          >
            <LoanFacts
              detail={data}
              focusable
              record={record!}
              applicant={text.name(record!.applicantId)}
            />
            <LoanFinancialSections record={record!} reload={resource.reload} />
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('approvals.progress')}
              </h2>
              <ApprovalProgress
                steps={progressOf(data, text, i18n.language)}
                copies={copiesOf(data)}
              />
            </section>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('approvals.timeline')}
              </h2>
              <ApprovalTimeline lines={timelineOf(data, text)} />
            </section>
          </ApprovalUiProvider>
        )}
        <AlertDialog
          open={!!confirm}
          onOpenChange={(open) => {
            if (!open && !pending) setConfirm(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('approvals.actionTitle', {
                  action:
                    confirm === 'retryCash'
                      ? t('loanRequests.operationLabels.retryCash')
                      : t(`approvals.${confirm ?? 'submit'}`),
                  name,
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  confirm === 'retryCash'
                    ? 'loanRequests.confirmRetry'
                    : confirm === 'withdraw'
                      ? 'approvals.confirmWithdraw'
                      : 'approvals.confirmSubmit',
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {writeError ? (
              <div ref={modalErrorRef} tabIndex={-1}>
                <ErrorState error={writeError} retry={resource.reload} />
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>
                {t('approvals.cancel')}
              </AlertDialogCancel>
              <Button
                variant={confirm === 'withdraw' ? 'destructive' : 'default'}
                disabled={pending}
                onClick={() => void transition(confirm!)}
              >
                {pending ? <Spinner data-icon='inline-start' /> : null}
                {[
                  'complete',
                  'unable',
                  'retryCash',
                  'claim',
                  'release',
                  'assign',
                ].includes(confirm ?? 'submit')
                  ? t(`loanRequests.operationLabels.${confirm ?? 'submit'}`)
                  : t(`approvals.${confirm ?? 'submit'}`)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {data ? (
          <Outlet
            context={{
              detail: data,
              reload: () => {
                resource.reload();
                parent.reload();
              },
              update: (r: LoanRequestRecord) =>
                resource.update({ ...data, record: r }),
            }}
          />
        ) : null}
      </div>
    </RecordDetailDrawer>
  );
}
