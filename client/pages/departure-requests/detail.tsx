import { statusTone } from './status-tone.js';
import { ApprovalProgress } from '#components/approval-progress';
import { UserNameText } from '#components/user-name';
import { Missing } from './missing.js';
import { useMemo } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
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
import { useDepartureResource as useResource } from './use-resource.js';
import { ErrorState } from './states.js';
import { DepartureFacts } from './facts.js';
import { copiesOf, progressOf, timelineOf } from './approval-mapping.js';
import {
  RECORD_ACTIONS as recordActions,
  APPROVAL_ACTIONS as approvalActions,
} from './types.js';
import type { DepartureDetail, SourceContext, DetailContext } from './types.js';

export default function DepartureDetailPage() {
  const { requestId = '' } = useParams();
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const parent = useOutletContext<SourceContext>();
  const resource = useResource<DepartureDetail>(
    `departureRequests/${encodeURIComponent(requestId)}`,
  );
  const data = resource.data;
  const reloadDetail = resource.reload;
  const writable = !!data && !resource.loading && !resource.error;
  const context = useMemo<DetailContext | undefined>(
    () =>
      data
        ? {
            detail: data,
            focusList: parent?.focusList,
            applyRecord: (record) => resource.update({ ...data, record }),
            reload: () => {
              reloadDetail();
              parent?.reload();
            },
            reloadDetail: () => {
              reloadDetail();
            },
          }
        : undefined,
    [data, reloadDetail, parent, resource],
  );
  const name = data
    ? `${data.record.applicant?.name ?? t('approvals.unknownPerson')} · ${data.record.number ?? t('approvals.draft')}`
    : t('departureRequests.title');
  const text = {
    t: (key: string, options?: Record<string, unknown>) => t(key, options),
    name: (id: string | null | undefined) =>
      data?.users.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) =>
      t(`departureRequests.statuses.${key}`, {
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
      ? t('departureRequests.edit')
      : t(`departureRequests.actionForm.labels.${action}`);
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
              aria-label={t('departureRequests.refresh')}
              disabled={resource.loading}
              onClick={() => {
                reloadDetail();
              }}
            />
          }
        >
          <RefreshCw
            className={resource.loading ? 'animate-spin' : undefined}
          />
        </TooltipTrigger>
        <TooltipContent>{t('departureRequests.refresh')}</TooltipContent>
      </Tooltip>
    </div>
  );
  async function navigateAction(action: string, target: string) {
    await navigate({
      pathname: `action/${action}/${encodeURIComponent(target)}`,
      search: location.search,
    });
  }
  if (resource.error instanceof ApiClientError && resource.error.status === 404)
    return (
      <Missing
        onMissing={parent?.reload}
        focusList={parent?.focusList}
        name={data?.record.applicant?.name}
      />
    );
  return (
    <RecordDetailDrawer
      headerStatus={
        data ? (
          <StatusBadge tone={statusTone(data.record.status)}>
            {t(`departureRequests.statuses.${data.record.status}`)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!data || resource.loading || !!resource.error}
      title={<UserNameText text={name} name={data?.record.applicant?.name} />}
      description={t('departureRequests.description')}
      footer={actions}
    >
      <div className='space-y-6'>
        {resource.error ? (
          <ErrorState error={resource.error} retry={resource.reload} />
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
                timeZone: data.timeZone,
              }).format(new Date(v))
            }
          >
            <DepartureFacts detail={data} writable={writable} />
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
        {context ? <Outlet context={context} /> : null}
      </div>
    </RecordDetailDrawer>
  );
}
