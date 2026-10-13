import { statusTone } from './status-tone.js';
import { ApprovalProgress } from '#components/approval-progress';
import { PrintEntry } from '../template-print/entry.js';
import { useEffect, useMemo, useReducer } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { ApiClientError } from '@nocobase/app-client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
  useNavigate,
} from 'react-router';
import { RefreshCw } from 'lucide-react';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { StatusBadge } from '#components/status-badge';
import {
  ApprovalUiProvider,
  ApprovalActionBar,
  ApprovalTimeline,
  type ApprovalBarAction,
} from '#extensions/nocobase-approval-ui';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from './states.js';
import { PaymentFacts } from './facts.js';
import { PaymentAccountSection } from './payment-account.js';
import { copiesOf, progressOf, timelineOf } from './approval-mapping.js';
import {
  RECORD_ACTIONS as recordActions,
  APPROVAL_ACTIONS as approvalActions,
} from './types.js';
import type {
  PaymentDetail,
  SourceContext,
  DetailContext,
  PaymentOptions,
} from './types.js';

export default function PaymentDetailPage() {
  const { requestId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const parent = useOutletContext<SourceContext>();
  const { session } = useAuthentication();
  const resource = useResource<PaymentDetail>(
    `paymentRequests/${encodeURIComponent(requestId)}`,
    { viewer: session?.user.id ?? '' },
  );
  const [refreshKey, refreshBank] = useReducer((v: number) => v + 1, 0);
  const data = resource.data;
  const options = useResource<PaymentOptions>(
    data ? 'paymentRequests/options' : null,
    data
      ? { applicantId: data.record.applicantId, recordId: data.record.id }
      : undefined,
  );
  const reloadDetail = resource.reload;
  const writable =
    !!data && !resource.loading && !resource.error && !options.loading;
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      resource.error.status === 404
    )
      parent?.reload();
  }, [resource.error, parent]);
  const context = useMemo<DetailContext | undefined>(
    () =>
      data
        ? {
            detail: data,
            options: options.data,
            timeZone: options.data?.timeZone,
            applyRecord: (record) => resource.update({ ...data, record }),
            reload: () => {
              reloadDetail();
              refreshBank();
              options.reload();
              parent?.reload();
            },
            reloadDetail: () => {
              reloadDetail();
              refreshBank();
              options.reload();
            },
          }
        : undefined,
    [data, reloadDetail, parent, options, resource],
  );
  const name = data?.record.number ?? t('approvals.draft');
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      data?.users.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      t(`paymentRequests.statuses.${key}`, {
        defaultValue: t('approvals.progress'),
      }),
  };
  const offered = writable
    ? offeredActions(
        data.taskActions,
        data.runActions,
        data.runs.map((v) => v.run),
      ).filter((a) => approvalActions.has(a.name))
    : [];
  const lifecycle = writable
    ? data.view.available.filter((v) => recordActions.has(v.name))
    : [];
  const submit = lifecycle.some((v) => v.name === 'submit' && v.allowed);
  const primary = submit ? undefined : offered.find((a) => a.primary)?.key;
  const label = (action: string) =>
    action === 'edit'
      ? t('paymentRequests.edit')
      : t(`paymentRequests.actionForm.labels.${action}`);
  const bar: ApprovalBarAction[] = offered.map((a) => ({
    key: a.key,
    label: label(a.name),
    tone:
      a.tone === 'danger'
        ? 'danger'
        : a.key === primary
          ? 'primary'
          : 'default',
    primary: a.key === primary,
    group: ['appoint', 'reassign', 'forceComplete'].includes(a.name)
      ? 'admin'
      : 'task',
    run: async () => {
      await navigateAction(
        a.name,
        'taskId' in a.target ? a.target.taskId : a.target.runId,
      );
    },
  }));
  // All writes open a route-addressable confirmation form. Offers and content
  // hashes are reread there, so a refreshed detail cannot submit a stale offer.
  const actions = (
    <div className='flex flex-wrap items-center gap-2'>
      {bar.length ? <ApprovalActionBar actions={bar} /> : null}
      {lifecycle.map((a) => (
        <Tooltip key={a.name}>
          <TooltipTrigger
            render={
              <Button
                variant={
                  a.name === 'submit'
                    ? 'default'
                    : a.name === 'terminate'
                      ? 'destructive'
                      : 'outline'
                }
                disabled={!a.allowed}
                nativeButton={a.allowed ? false : true}
                render={
                  a.allowed ? (
                    <Link
                      to={{
                        pathname:
                          a.name === 'edit'
                            ? 'edit'
                            : `action/${a.name}/${encodeURIComponent(data!.record.id)}`,
                        search: location.search,
                      }}
                    />
                  ) : undefined
                }
              />
            }
          >
            {label(a.name)}
          </TooltipTrigger>
          <TooltipContent>
            {a.allowed ? label(a.name) : t('approvals.unavailable')}
          </TooltipContent>
        </Tooltip>
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='outline'
              size='icon'
              aria-label={t('paymentRequests.refresh')}
              disabled={resource.loading}
              onClick={() => {
                reloadDetail();
                refreshBank();
                options.reload();
              }}
            />
          }
        >
          <RefreshCw
            className={resource.loading ? 'animate-spin' : undefined}
          />
        </TooltipTrigger>
        <TooltipContent>{t('paymentRequests.refresh')}</TooltipContent>
      </Tooltip>
    </div>
  );
  async function navigateAction(action: string, target: string) {
    await navigate({
      pathname: `action/${action}/${encodeURIComponent(target)}`,
      search: location.search,
    });
  }
  return (
    <RecordDetailDrawer
      headerStatus={
        data ? (
          <StatusBadge tone={statusTone(data.record.status)}>
            {t(`paymentRequests.statuses.${data.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!data || resource.loading || !!resource.error}
      title={name}
      description={t('paymentRequests.description')}
      footer={
        <>
          <PrintEntry
            source='payment'
            readable={!!data && !resource.error && !resource.loading}
          />
          {actions}
        </>
      }
    >
      <div className='flex flex-col gap-6'>
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
        ) : null}
        {options.error ? (
          <ErrorState error={options.error} retry={options.reload} />
        ) : null}
        {!data ? (
          resource.loading && !resource.error ? (
            <FieldsSkeleton fields={8} />
          ) : null
        ) : (
          <ApprovalUiProvider
            personName={text.name}
            formatDateTime={(v) =>
              options.data?.timeZone
                ? new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: options.data.timeZone,
                  }).format(new Date(v))
                : '—'
            }
          >
            <PaymentFacts
              detail={data}
              options={options.data}
              refreshKey={refreshKey}
            />
            <PaymentAccountSection
              record={data.record}
              refreshKey={refreshKey}
              canWrite={writable}
              onChanged={() => {
                reloadDetail();
                refreshBank();
                options.reload();
                parent?.reload();
              }}
            />
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('approvals.progress')}
              </h2>
              <ApprovalProgress
                steps={progressOf(
                  data,
                  text,
                  i18n.language,
                  options.data?.timeZone,
                )}
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
        {context ? (
          <Outlet
            context={{
              ...context,
              printSource: 'payment',
              printRecordId: data?.record.id,
              printRecordName: name,
              printRefresh: context.reload,
            }}
          />
        ) : null}
      </div>
    </RecordDetailDrawer>
  );
}
