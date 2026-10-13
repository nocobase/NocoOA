import { statusTone } from './status-tone.js';
import { ApprovalProgress } from '#components/approval-progress';
import { StatusBadge } from '#components/status-badge';
import { UserName } from '#components/user-name';
import { ApiClientError } from '@nocobase/app-client';
import { useEffect } from 'react';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { RecordDetailDrawer } from '#components/record-detail-drawer';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  ApprovalUiProvider,
  ApprovalTimeline,
} from '#extensions/nocobase-approval-ui';
import { useTransferResource } from './resource.js';
import { TransferError } from './states.js';
import {
  statuses,
  transferPolicy,
  type Context,
  type Detail,
} from './types.js';
import { progressOf, copiesOf, timelineOf } from './approval-mapping.js';
export default function TransferDetail() {
  const { requestId } = useParams(),
    location = useLocation(),
    parent = useOutletContext<Context>(),
    { t, i18n } = useTranslation();
  const resource = useTransferResource<{ data: Detail }>(
    `transferRequests/${encodeURIComponent(requestId ?? '')}`,
  );
  const parentReload = parent?.reload;
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parentReload?.();
  }, [resource.error, parentReload]);
  const viewSalary = useCan(transferPolicy('viewSalary')),
    submit = useCan(transferPolicy('submit')),
    operate = useCan(transferPolicy('operate')),
    review = useCan(transferPolicy('reviewEdit')),
    cancel = useCan(transferPolicy('cancel')),
    rebind = useCan(transferPolicy('rebind'));
  const salary = useTransferResource<{
    data: { targetSalary: string; currentSalary?: number };
  }>(
    resource.data && !resource.error && viewSalary.can
      ? `transferRequests/${encodeURIComponent(requestId ?? '')}/salary`
      : null,
  );
  const detail = resource.data?.data,
    record = detail?.record;
  const writable = !!detail && !resource.loading && !resource.error;
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      detail?.users.find((person) => person.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      statuses.includes(key)
        ? t(`transfer.status.${key}`)
        : t('approvals.progress'),
  };
  const offers =
    detail && writable && operate.can
      ? offeredActions(
          detail.actions,
          [],
          detail.runs.map((run) => run.run),
        )
      : [];
  const link = (path: string) => ({
    pathname: path,
    search: location.search,
    hash: location.hash,
  });
  const reload = () => {
    resource.reload();
    salary.reload();
    parent?.reload();
  };
  const footer = (
    <>
      <Button variant='outline' onClick={reload} disabled={resource.loading}>
        {t('transfer.refresh')}
      </Button>
      <div className='flex flex-wrap gap-2'>
        {writable
          ? (detail.view.available ?? [])
              .filter(
                (action) =>
                  action.allowed &&
                  [
                    'edit',
                    'submit',
                    'withdraw',
                    'terminate',
                    'requestCancellation',
                  ].includes(action.name),
              )
              .filter((action) =>
                action.name === 'requestCancellation' ? cancel.can : submit.can,
              )
              .map((action) => (
                <Button
                  key={action.name}
                  variant={
                    ['terminate', 'withdraw'].includes(action.name)
                      ? 'destructive'
                      : 'outline'
                  }
                  render={
                    <Link
                      to={link(
                        action.name === 'edit'
                          ? 'edit'
                          : `action/${action.name}`,
                      )}
                    />
                  }
                  nativeButton={false}
                >
                  {t(`transfer.operations.${action.name}`)}
                </Button>
              ))
          : null}
        {writable &&
        review.can &&
        offers.some((action) => action.name === 'approve') ? (
          <Button
            variant='outline'
            render={<Link to={link('reviewEdit')} />}
            nativeButton={false}
          >
            {t('transfer.operations.reviewEdit')}
          </Button>
        ) : null}
        {offers
          .filter((action) => action === offers.find((value) => value.primary))
          .map((action) => (
            <Button
              key={action.key}
              variant={
                action.tone === 'danger'
                  ? 'destructive'
                  : action.primary
                    ? 'default'
                    : 'outline'
              }
              render={
                <Link
                  to={link(
                    `action/${action.name}/${'taskId' in action.target ? action.target.taskId : action.target.runId}`,
                  )}
                />
              }
              nativeButton={false}
            >
              {t(`approvals.${action.name}`)}
            </Button>
          ))}
        {offers.filter(
          (action) => action !== offers.find((value) => value.primary),
        ).length ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant='outline' />}>
              {t('transfer.moreActions')}
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-auto min-w-40'>
              <DropdownMenuGroup>
                {offers
                  .filter(
                    (action) =>
                      action !== offers.find((value) => value.primary),
                  )
                  .map((action) => (
                    <DropdownMenuItem
                      key={action.key}
                      render={
                        <Link
                          to={link(
                            `action/${action.name}/${'taskId' in action.target ? action.target.taskId : action.target.runId}`,
                          )}
                        />
                      }
                    >
                      {t(`approvals.${action.name}`)}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {writable &&
        rebind.can &&
        record?.status === 'pendingEffective' &&
        record.executionFailureCode === 'TRANSFER_YEAR_REBIND_REQUIRED' ? (
          <Button
            variant='outline'
            render={<Link to={link('action/rebind')} />}
            nativeButton={false}
          >
            {t('transfer.operations.rebind')}
          </Button>
        ) : null}
      </div>
    </>
  );
  return (
    <RecordDetailDrawer
      headerStatus={
        record ? (
          <StatusBadge tone={statusTone(record.status)}>
            {t(`transfer.status.${record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!writable}
      title={t('transfer.title')}
      description={record?.id}
      footer={<>{footer}</>}
    >
      {resource.error ? (
        <TransferError error={resource.error} retry={reload} />
      ) : null}
      {resource.loading && !detail ? <FieldsSkeleton fields={8} /> : null}
      {detail && record ? (
        <>
          <dl className='grid gap-4 text-sm sm:grid-cols-2'>
            {(
              [
                'employee',
                'department',
                'position',
                'grade',
                'manager',
              ] as const
            ).map((field) => (
              <div key={field}>
                <dt className='text-muted-foreground'>
                  {t(`transfer.factFields.${field}`)}
                </dt>
                <dd className='mt-1'>
                  {detail.facts[field]?.name ?? t('transfer.none')}
                </dd>
              </div>
            ))}
            {(['kinds', 'effectiveDate', 'reason'] as const).map((field) => (
              <div key={field}>
                <dt className='text-muted-foreground'>
                  {t(`transfer.fields.${field}`)}
                </dt>
                <dd className='mt-1 whitespace-pre-wrap'>
                  {field === 'kinds'
                    ? record.kinds
                        .map((kind) => t(`transfer.kinds.${kind}`))
                        .join(' · ')
                    : record[field]}
                </dd>
              </div>
            ))}
            <div>
              <dt>{t('transfer.fields.applicantId')}</dt>
              <dd>
                <UserName name={text.name(record.applicantId)} />
              </dd>
            </div>
          </dl>
          <section className='space-y-3'>
            <h2 className='text-lg font-medium'>{t('transfer.salary')}</h2>
            {viewSalary.can ? (
              salary.error ? (
                <TransferError error={salary.error} retry={salary.reload} />
              ) : salary.data ? (
                <dl className='grid gap-4 sm:grid-cols-2'>
                  <div>
                    <dt>{t('transfer.fields.targetSalary')}</dt>
                    <dd>
                      {new Intl.NumberFormat(i18n.language, {
                        style: 'currency',
                        currency: 'CNY',
                      }).format(Number(salary.data.data.targetSalary))}
                    </dd>
                  </div>
                  {salary.data.data.currentSalary !== undefined ? (
                    <div>
                      <dt>{t('transfer.currentSalary')}</dt>
                      <dd>
                        {new Intl.NumberFormat(i18n.language, {
                          style: 'currency',
                          currency: 'CNY',
                        }).format(salary.data.data.currentSalary / 100)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <FieldsSkeleton fields={8} />
              )
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('transfer.salaryDenied')}
              </p>
            )}
          </section>
          {record.executionFailureCode ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('transfer.failedToExecute')}
              </AlertDescription>
            </Alert>
          ) : null}
          <ApprovalUiProvider
            personName={text.name}
            formatDateTime={(value) =>
              new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(value))
            }
          >
            <section className='space-y-4'>
              <h2 className='text-lg font-medium'>{t('approvals.progress')}</h2>
              <ApprovalProgress
                steps={progressOf(detail, text, i18n.language)}
                copies={copiesOf(detail)}
              />
            </section>
            <section className='mt-6 space-y-4'>
              <h2 className='text-lg font-medium'>{t('approvals.timeline')}</h2>
              <ApprovalTimeline lines={timelineOf(detail, text)} />
            </section>
          </ApprovalUiProvider>
          <Outlet
            context={{
              detail,
              reload,
              writable,
              update: (value: Detail) => {
                resource.update({ data: value });
                salary.reload();
                parent?.reload();
              },
            }}
          />
        </>
      ) : null}
    </RecordDetailDrawer>
  );
}
