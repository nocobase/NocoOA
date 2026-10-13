import { ApprovalProgress } from '#components/approval-progress';
import { StatusBadge } from '#components/status-badge';
import { UserName } from '#components/user-name';
import { PrintEntry } from '../template-print/entry.js';
import { createRequestId } from './request-id.js';
import { LeaveAttachments } from './attachments.js';
import { useLeaveLabel } from './use-leave-label.js';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
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
import { useResource } from './use-resource.js';
import { ErrorState } from './states.js';
import { progressOf, copiesOf, timelineOf } from './approval-mapping.js';
import {
  ACTIONS,
  type LeaveDetail,
  type LeaveRecord,
  type LeaveOptions,
  type SourceContext,
} from './types.js';

export default function LeaveDetailPage() {
  const { session } = useAuthentication();
  const cancellationPermission = useCan({
    resource: { type: 'composite', id: 'oa.leaveCancellation' },
    action: 'submit',
  });
  const { requestId } = useParams();
  const { t, i18n } = useTranslation();
  const typeLabel = useLeaveLabel();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const parent = useOutletContext<SourceContext>();
  const resource = useResource<LeaveDetail>(
    `leaveRequests/${encodeURIComponent(requestId ?? '')}`,
  );
  const options = useResource<LeaveOptions>('leaveRequests/options');
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
  const peoplePermission = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  });
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<unknown>();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState('');
  const data = resource.data;
  const record = data?.record;
  const name = record?.number ?? t('approvals.draft');
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      data?.users.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      t(`approvals.stages.${key}`, { defaultValue: t('approvals.progress') }),
  };
  async function transition(action: string) {
    if (!record) return;
    setPending(true);
    setWriteError(undefined);
    try {
      const { data: result } = await api.request<{
        data: { record: LeaveRecord };
      }>({
        method: 'POST',
        path: `leaveRequests/${record.id}/transition`,
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
        path: `leaveRequests/${record.id}/action`,
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
  const kind = options.data?.leaveTypes.find(
    (v) => v.code === record?.leaveType,
  );
  const balanceBlocked =
    !!record &&
    !options.data?.balanceAvailable &&
    (['annual', 'compensatory'].includes(record.leaveType) ||
      !!kind?.extra?.deductsBalance);
  const attachmentBlocked =
    !!record &&
    !record.attachments.length &&
    ((record.leaveType === 'sick' && Number(record.days) > 1) ||
      (!!kind?.extra?.requiresAttachment &&
        (typeof kind.extra.attachmentAboveDays !== 'number' ||
          Number(record.days) > kind.extra.attachmentAboveDays)));
  const submissionBlocked =
    balanceBlocked || attachmentBlocked || !options.data;
  const writable = !resource.loading && !resource.error;
  const lifecycleActions =
    (writable ? data?.view.available : undefined)?.filter((v) =>
      ['edit', 'submit', 'withdraw', 'terminate'].includes(v.name),
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
        ).filter(
          (a) =>
            (ACTIONS as readonly string[]).includes(a.name) &&
            (!['appoint', 'reassign'].includes(a.name) || peoplePermission.can),
        )
      : [];
  const primaryKey = submit ? null : offered.find((a) => a.primary)?.key;
  const bar: ApprovalBarAction[] = offered.map((action) => ({
    key: action.key,
    label: t(`approvals.${action.name}`),
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
              ['approved', 'completed', 'issued', 'active'].includes(
                record.status,
              )
                ? 'success'
                : 'neutral'
            }
          >
            {t(`approvals.states.${record.status}`)}
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
            <PrintEntry
              source='leave'
              readable={!!data && !resource.error && !resource.loading}
            />
            {record?.status === 'approved' &&
            record.applicantId === session?.user.id &&
            cancellationPermission.can ? (
              <Button
                variant='outline'
                render={
                  <Link
                    to={{
                      pathname: 'newCancellation',
                      search: (() => {
                        const query = new URLSearchParams(location.search);
                        query.set('originalLeaveId', record.id);
                        return `?${query.toString()}`;
                      })(),
                    }}
                  />
                }
                nativeButton={false}
              >
                {t('leaveCancellations.new')}
              </Button>
            ) : null}
            {bar.length ? (
              <ApprovalActionBar actions={bar} busy={pending} />
            ) : null}
            {lifecycleActions.map((action) =>
              action.name === 'edit' ? (
                action.allowed ? (
                  <Button
                    key={action.name}
                    variant='outline'
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
                    {t(`approvals.${action.name}`)}
                  </TooltipTrigger>
                  <TooltipContent>
                    {action.name === 'submit' && balanceBlocked
                      ? t('approvals.balanceLimit')
                      : action.name === 'submit' && attachmentBlocked
                        ? t('approvals.attachmentLimit')
                        : action.allowed
                          ? t(`approvals.${action.name}`)
                          : action.blockers
                              .map((v) =>
                                t(v.message, { defaultValue: v.message }),
                              )
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
      <div className='space-y-6'>
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
              }).format(new Date(v))
            }
          >
            <dl className='grid max-w-4xl gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]'>
              {[
                [
                  t('approvals.applicant'),
                  <UserName
                    key={t('approvals.applicant')}
                    name={text.name(record!.applicantId)}
                  />,
                ] as const,
                [t('approvals.type'), typeLabel(record!.leaveType)],
                [
                  t('approvals.startDate'),
                  `${record!.startDate} ${t(`approvals.${record!.startHalf}`)}`,
                ],
                [
                  t('approvals.endDate'),
                  `${record!.endDate} ${t(`approvals.${record!.endHalf}`)}`,
                ],
                [
                  t('approvals.days'),
                  new Intl.NumberFormat(i18n.language).format(
                    Number(record!.days),
                  ),
                ],
                [t('approvals.reason'), record!.reason],
                [
                  t('approvals.handover'),
                  record!.handoverUserId ? (
                    <UserName
                      key='handover'
                      name={text.name(record!.handoverUserId)}
                    />
                  ) : (
                    '—'
                  ),
                ] as const,
                [
                  t('approvals.delegate'),
                  t(
                    record!.enableDelegation ? 'approvals.yes' : 'approvals.no',
                  ),
                ],
              ].map(([label, value]) => (
                <div key={label} className='contents'>
                  <dt className='text-muted-foreground'>{label}</dt>
                  <dd className='min-w-0 whitespace-pre-wrap break-words'>
                    {value || '—'}
                  </dd>
                </div>
              ))}
            </dl>
            <section className='flex flex-col gap-2'>
              <h2 className='text-base font-medium'>
                {t('approvals.attachments')}
              </h2>
              <LeaveAttachments
                leaveId={record!.id}
                ids={record!.attachments}
              />
            </section>
            {balanceBlocked ? (
              <Alert>
                <AlertDescription>
                  {t('approvals.balanceLimit')}
                </AlertDescription>
              </Alert>
            ) : null}
            {attachmentBlocked ? (
              <Alert>
                <AlertDescription>
                  {t('approvals.attachmentLimit')}
                </AlertDescription>
              </Alert>
            ) : null}
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
                  action: t(`approvals.${confirm ?? 'submit'}`),
                  name,
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  confirm === 'withdraw'
                    ? 'approvals.confirmWithdraw'
                    : 'approvals.confirmSubmit',
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {writeError ? (
              <ErrorState error={writeError} retry={resource.reload} />
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
                {t(`approvals.${confirm ?? 'submit'}`)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {data ? (
          <Outlet
            context={{
              printSource: 'leave',
              printRefresh: () => {
                resource.reload();
                parent.reload();
              },
              printRecordId: data.record.id,
              printRecordName: name,
              detail: data,
              reload: () => {
                resource.reload();
                parent.reload();
              },
              update: (r: LeaveRecord) =>
                resource.update({ ...data, record: r }),
            }}
          />
        ) : null}
      </div>
    </RecordDetailDrawer>
  );
}
