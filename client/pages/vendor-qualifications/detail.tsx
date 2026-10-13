import { statusTone } from './status-tone.js';
import { ApprovalProgress } from '#components/approval-progress';
import { Missing } from './missing.js';
import { useMemo, useReducer, useState, useEffect } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { offeredActions } from '@nocobase/app-plugin-approval/client';
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
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
import { QualificationAttachments } from './attachments.js';
import { PaymentAccountSection } from './payment-account.js';
import { ErrorState } from './states.js';
import { copiesOf, progressOf, timelineOf } from './approval-mapping.js';
import {
  stageLabel,
  type QualificationDetail,
  type SourceContext,
  type DetailContext,
} from './types.js';
export default function QualificationDrawer() {
  const { requestId = '' } = useParams(),
    { session } = useAuthentication(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    navigate = useNavigate(),
    parent = useOutletContext<SourceContext>();
  const [refreshKey, refreshPrivate] = useReducer((n: number) => n + 1, 0);
  const grant = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'view',
  });
  const mutation = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'submit',
  });
  const resource = useResource<QualificationDetail>(
    grant.can && !grant.isPending && !grant.error
      ? `vendorQualifications/${encodeURIComponent(requestId)}`
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const data =
      grant.can && !grant.isPending && !grant.error ? resource.data : undefined,
    writable =
      !!data &&
      !resource.loading &&
      !resource.error &&
      grant.can &&
      !grant.isPending &&
      !grant.error;
  const [knownName, setKnownName] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && data) setKnownName(data.record.name);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);
  const reloadDetail = resource.reload;
  const context = useMemo<DetailContext | undefined>(
    () =>
      data
        ? {
            detail: data,
            writable,
            reload: () => {
              reloadDetail();
              refreshPrivate();
              parent?.reload();
            },
            reloadDetail: () => {
              reloadDetail();
              refreshPrivate();
            },
            focusList: parent?.focusList,
          }
        : undefined,
    [data, writable, reloadDetail, parent],
  );
  const text = {
    t: (key: string, values?: Record<string, unknown>) => t(key, values),
    name: (id: string | null | undefined) =>
      data?.knownUsers.find((p) => p.id === id)?.name ??
      t('approvals.unknownPerson'),
    stage: (key: string) => stageLabel(key, t),
  };
  const offers = writable
    ? offeredActions(
        data.actions,
        data.runActions,
        data.runs.map((r) => r.run),
      ).filter((a) =>
        [
          'approve',
          'reject',
          'return',
          'comment',
          'read',
          'abstain',
          'appoint',
          'reassign',
        ].includes(a.name),
      )
    : [];
  const lifecycle =
    writable && mutation.can && !mutation.isPending && !mutation.error
      ? data.view.available.filter((a) =>
          ['edit', 'submit', 'withdraw', 'terminate', 'restartReview'].includes(
            a.name,
          ),
        )
      : [];
  const submit = lifecycle.some((a) => a.name === 'submit' && a.allowed);
  const primary = submit ? undefined : offers.find((a) => a.primary)?.key;
  const bar: ApprovalBarAction[] = [
    ...offers.map((a) => ({
      key: a.key,
      label: t(`vendorQualifications.actions.${a.name}`),
      primary: a.key === primary,
      tone: a.tone,
      group: ['appoint', 'reassign'].includes(a.name)
        ? ('admin' as const)
        : ('task' as const),
      run: async () => {
        await navigate({
          pathname: `action/${a.name}/${encodeURIComponent('taskId' in a.target ? a.target.taskId : a.target.runId)}`,
          search: location.search,
        });
      },
    })),
    ...lifecycle
      .filter((a) => a.allowed)
      .map((a) => ({
        key: a.name,
        label:
          a.name === 'edit'
            ? t('vendorQualifications.edit')
            : t(`vendorQualifications.actions.${a.name}`),
        primary: a.name === 'submit',
        group: 'record' as const,
        tone:
          a.name === 'terminate' ? ('danger' as const) : ('default' as const),
        run: async () => {
          await navigate({
            pathname:
              a.name === 'edit'
                ? 'edit'
                : `action/${a.name}/${data!.record.id}`,
            search: location.search,
          });
        },
      })),
  ];
  if (resource.error instanceof ApiClientError && resource.error.status === 404)
    return (
      <Missing
        name={knownName}
        onMissing={parent?.reload}
        focusList={parent?.focusList}
      />
    );
  return (
    <RecordDetailDrawer
      headerStatus={
        data ? (
          <StatusBadge tone={statusTone(data.record.status)}>
            {stageLabel(data.record.status, t)}
          </StatusBadge>
        ) : null
      }
      printable
      printDisabled={!data || resource.loading || !!resource.error}
      title={data?.record.name || t('approvals.draft')}
      description={data?.record.number ?? t('approvals.draft')}
    >
      <div className='flex flex-col gap-6'>
        <div className='flex flex-wrap items-center gap-2'>
          {bar.length > 0 && <ApprovalActionBar actions={bar} />}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  disabled={resource.loading}
                  aria-label={t('vendorQualifications.common.refresh')}
                  onClick={() => {
                    resource.reload();
                    refreshPrivate();
                  }}
                />
              }
            >
              <RefreshCw
                className={resource.loading ? 'animate-spin' : undefined}
              />
            </TooltipTrigger>
            <TooltipContent>
              {t('vendorQualifications.common.refresh')}
            </TooltipContent>
          </Tooltip>
        </div>
        {!!resource.error && (
          <ErrorState error={resource.error} retry={resource.reload} />
        )}{' '}
        {!grant.isPending && (grant.error || !grant.can) ? (
          <p>{t('vendorQualifications.errors.forbidden')}</p>
        ) : !data ? (
          !resource.error && <FieldsSkeleton fields={10} />
        ) : (
          <>
            <dl className='grid gap-3 sm:grid-cols-[8rem_1fr]'>
              {(
                [
                  'operation',
                  'name',
                  'category',
                  'reason',
                  'quoteCents',
                  'cases',
                  'contactName',
                  'contactPhone',
                  'contactEmail',
                  'qualificationExpiry',
                  'sourceVendorVersion',
                  'committeeVersion',
                ] as const
              ).map((key) => (
                <div key={key} className='contents'>
                  <dt className='text-muted-foreground'>
                    {t(`vendorQualifications.fields.${key}`)}
                  </dt>
                  <dd
                    className={
                      ['reason', 'cases'].includes(key)
                        ? 'min-w-0 whitespace-pre-wrap break-words'
                        : 'min-w-0 break-words'
                    }
                  >
                    {key === 'operation'
                      ? t(
                          `vendorQualifications.operations.${data.record.operation}`,
                        )
                      : key === 'quoteCents'
                        ? new Intl.NumberFormat(i18n.language, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(data.record.quoteCents / 100)
                        : String(data.record[key] ?? '—') || '—'}
                  </dd>
                </div>
              ))}
            </dl>
            {data.record.committeeSnapshot && (
              <section className='flex flex-col gap-2'>
                <h2 className='text-base font-medium'>
                  {t('vendorQualifications.configuration.structure')}
                </h2>
                <p>
                  {stageLabel(
                    `committee_v${data.record.committeeSnapshot.version}`,
                    t,
                  )}{' '}
                  · {t('vendorQualifications.configuration.min')}:{' '}
                  {data.record.committeeSnapshot.min}
                </p>
                <ul>
                  {data.record.committeeSnapshot.seats.map((seat) => (
                    <li key={seat.key}>
                      {t(`vendorQualifications.sources.${seat.source}`)}
                      {seat.veto
                        ? ` · ${t('vendorQualifications.configuration.veto')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h2 className='text-base font-medium'>
                {t('vendorQualifications.fields.attachments')}
              </h2>
              <QualificationAttachments
                recordId={data.record.id}
                ids={data.record.attachments}
                refreshKey={refreshKey}
              />
            </section>
            <PaymentAccountSection
              record={data.record}
              refreshKey={refreshKey}
              canWrite={writable}
              onMissing={parent?.reload}
              focusList={parent?.focusList}
            />
            <ApprovalUiProvider
              personName={text.name}
              formatDateTime={(value) =>
                new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: data.timeZone,
                }).format(new Date(value))
              }
            >
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
          </>
        )}
        {context && <Outlet context={context} />}
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to={{ pathname: '..', search: location.search }} />}
        >
          {t('vendorQualifications.common.cancel')}
        </Button>
      </div>
    </RecordDetailDrawer>
  );
}
