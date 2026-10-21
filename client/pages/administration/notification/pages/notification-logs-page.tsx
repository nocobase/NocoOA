import { Button } from '#components/ui/button';
import { IconAction } from '../../components/icon-action.js';
import { LoadFailure } from '../../components/load-failure.js';
import { responseStatus } from '../../components/response-status.js';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { TruncatedText } from '#components/truncated-text';
import { StatusBadge as ApplicationStatusBadge } from '#components/status-badge';
import { ChevronRight, ArrowUpDown } from 'lucide-react';
import { ResponsiveTable as Table } from '#components/responsive-table';
import { PageContainer } from '../components/page-container.js';
import { PageHeader } from '../components/page-header.js';
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';

import type {
  NotificationDeliveryDetails,
  NotificationLogDetails,
  NotificationStatus,
} from '../notification-client.js';
import { getNotificationClient } from '../runtime.js';

const notification = getNotificationClient();

type Translate = (
  key: string,
  options?: Readonly<Record<string, unknown>>,
) => string;

export default function NotificationLogsPage(): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  const [logs, setLogs] = useState<readonly NotificationLogDetails[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const refresh = (): void => {
    setLoading(true);
    setError(undefined);
    setRevision((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    notification
      .listLogs()
      .then(
        (nextLogs) => {
          if (active) setLogs(nextLogs);
        },
        (cause: unknown) => {
          if (!active) return;
          setError(cause);
          if ([401, 403, 404].includes(responseStatus(cause) ?? 0)) {
            setLogs([]);
          }
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, t]);

  const totals = useMemo(
    () => ({
      deliveries: logs.reduce((sum, item) => sum + item.deliveries.length, 0),
      attention: logs.filter((item) =>
        ['failed', 'partial', 'unknown'].includes(item.log.status),
      ).length,
    }),
    [logs],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('logs.title', { defaultValue: 'Notification logs' })}
        actions={
          <ApplicationRefreshButton
            label={t('logs.refresh')}
            loading={loading}
            onClick={refresh}
          />
        }
        description={t('logs.description', {
          defaultValue:
            'Trace notification delivery and every provider attempt. Message bodies, recipients, and lease tokens are redacted.',
        })}
      />
      <div className='flex flex-col gap-5'>
        <div className='grid max-w-md grid-cols-2 gap-3'>
          <Metric
            label={t('logs.deliveriesShown', {
              defaultValue: 'Deliveries shown',
            })}
            value={totals.deliveries}
          />
          <Metric
            attention
            label={t('logs.needAttention', { defaultValue: 'Need attention' })}
            value={totals.attention}
          />
        </div>

        {error ? (
          <LoadFailure
            error={error}
            message={t(
              responseStatus(error) === 403
                ? 'errors.forbidden'
                : responseStatus(error) === 404
                  ? 'errors.notFound'
                  : 'errors.requestFailed',
            )}
            retryLabel={t('logs.retry')}
            onRetry={refresh}
          />
        ) : null}

        {logs.length >= 100 ? (
          <p className='text-sm text-muted-foreground'>
            {t('logs.limitNotice', { count: 100 })}
          </p>
        ) : null}
        <section className='overflow-hidden rounded-xl border bg-card shadow-sm'>
          <div className='border-b bg-muted/20 px-5 py-4'>
            <h2 className='text-base font-medium'>
              {t('logs.recent', { defaultValue: 'Recent notifications' })}
            </h2>
          </div>
          {loading && logs.length === 0 ? (
            <ApplicationTableSkeleton columns={5} />
          ) : error && logs.length === 0 ? null : logs.length === 0 ? (
            <ApplicationTableEmpty
              title={t('logs.emptyTitle')}
              description={t('logs.emptyDescription')}
            />
          ) : (
            <NotificationLogsTable logs={logs} />
          )}
        </section>
      </div>
    </PageContainer>
  );
}

function Metric({
  label,
  value,
  attention = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly attention?: boolean;
}): ReactElement {
  return (
    <div className='rounded-xl border bg-card px-4 py-3 shadow-sm'>
      <div
        className={`text-2xl font-semibold tabular-nums ${attention && value > 0 ? 'text-destructive' : ''}`}
      >
        {value}
      </div>
      <div className='text-xs text-muted-foreground'>{label}</div>
    </div>
  );
}

function NotificationLogsTable({
  logs,
}: {
  readonly logs: readonly NotificationLogDetails[];
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  const [sort, setSort] = useState<'createdAt' | 'deliveries'>('createdAt');
  const [descending, setDescending] = useState(true);
  const sorted = [...logs].sort(
    (a, b) =>
      (sort === 'createdAt'
        ? Date.parse(a.log.createdAt) - Date.parse(b.log.createdAt)
        : a.deliveries.length - b.deliveries.length) * (descending ? -1 : 1),
  );
  const sortBy = (field: 'createdAt' | 'deliveries') => {
    if (sort === field) setDescending((value) => !value);
    else {
      setSort(field);
      setDescending(true);
    }
  };

  return (
    <div className='min-w-0'>
      <Table className='w-full min-w-[860px] text-sm'>
        <thead className='bg-muted/35 text-left'>
          <tr className='border-b'>
            <th
              className='w-12 px-4 py-3'
              aria-label={t('logs.expand', {
                defaultValue: 'Expand notification',
              })}
            />
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.source', { defaultValue: 'Source' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.notificationId', {
                defaultValue: 'Notification ID',
              })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.status', { defaultValue: 'Status' })}
            </th>
            <th
              className='px-4 py-3 text-right font-medium'
              aria-sort={
                sort === 'deliveries'
                  ? descending
                    ? 'descending'
                    : 'ascending'
                  : 'none'
              }
            >
              <Button
                variant='ghost'
                size='sm'
                onClick={() => sortBy('deliveries')}
              >
                {t('logs.columns.deliveries')}
                <ArrowUpDown />
              </Button>
            </th>
            <th
              className='px-4 py-3 font-medium'
              aria-sort={
                sort === 'createdAt'
                  ? descending
                    ? 'descending'
                    : 'ascending'
                  : 'none'
              }
            >
              <Button
                variant='ghost'
                size='sm'
                onClick={() => sortBy('createdAt')}
              >
                {t('logs.columns.created')}
                <ArrowUpDown />
              </Button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((details) => (
            <NotificationTableRow key={details.log.id} details={details} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function NotificationTableRow({
  details,
}: {
  readonly details: NotificationLogDetails;
}): ReactElement {
  const { t, i18n } = useTranslation('@nocobase/app-plugin-notification');
  const [open, setOpen] = useState(false);
  return (
    <Fragment>
      <tr className='border-b' aria-expanded={open}>
        <td className='px-4 py-3'>
          <IconAction label={t(open ? 'logs.collapse' : 'logs.expand')}>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={
                open
                  ? t('logs.collapse', {
                      defaultValue: 'Collapse notification',
                    })
                  : t('logs.expand', { defaultValue: 'Expand notification' })
              }
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              type='button'
            >
              <ChevronRight
                className={`transition-transform ${open ? 'rotate-90' : ''}`}
              />
            </Button>
          </IconAction>
        </td>
        <td className='px-4 py-3'>
          <div className='font-medium'>{details.log.sourceType}</div>
          {details.log.sourceReferenceId ? (
            <div className='mt-0.5 max-w-48 text-xs text-muted-foreground'>
              <TruncatedText text={details.log.sourceReferenceId} />
            </div>
          ) : null}
        </td>
        <td className='px-4 py-3'>
          <code
            className='text-xs text-muted-foreground'
            title={details.log.id}
          >
            {details.log.id}
          </code>
        </td>
        <td className='px-4 py-3'>
          <StatusBadge status={details.log.status} />
        </td>
        <td className='px-4 py-3 text-right tabular-nums'>
          {details.deliveries.length}
        </td>
        <td className='whitespace-nowrap px-4 py-3 text-muted-foreground'>
          <time dateTime={details.log.createdAt}>
            {formatTime(details.log.createdAt, i18n.language)}
          </time>
        </td>
      </tr>
      {open ? (
        <tr className='border-b bg-muted/15'>
          <td colSpan={6} className='p-4 sm:px-12'>
            <DeliveryTable deliveries={details.deliveries} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function DeliveryTable({
  deliveries,
}: {
  readonly deliveries: readonly NotificationDeliveryDetails[];
}): ReactElement {
  const { t, i18n } = useTranslation('@nocobase/app-plugin-notification');
  if (deliveries.length === 0) {
    return (
      <p className='py-4 text-center text-sm text-muted-foreground'>
        {t('logs.noDeliveries', {
          defaultValue: 'No deliveries recorded.',
        })}
      </p>
    );
  }

  return (
    <div className='min-w-0 rounded-lg border bg-card'>
      <Table className='w-full min-w-[760px] text-sm'>
        <thead className='bg-muted/35 text-left'>
          <tr className='border-b'>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.channel', { defaultValue: 'Channel' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.provider', { defaultValue: 'Provider' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.status', { defaultValue: 'Status' })}
            </th>
            <th className='px-4 py-3 text-right font-medium'>
              {t('logs.columns.attempts', { defaultValue: 'Attempts' })}
            </th>
            <th className='px-4 py-3 font-medium'>
              {t('logs.columns.updated', { defaultValue: 'Updated' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((details) => {
            return (
              <Fragment key={details.delivery.id}>
                <tr className='border-b'>
                  <td className='px-4 py-3'>{details.delivery.channelName}</td>
                  <td className='px-4 py-3'>
                    <div className='font-medium'>
                      {details.delivery.providerType}
                    </div>
                  </td>
                  <td className='px-4 py-3'>
                    <StatusBadge status={details.delivery.status} />
                  </td>
                  <td className='px-4 py-3 text-right tabular-nums'>
                    {details.attempts.length}
                  </td>
                  <td className='whitespace-nowrap px-4 py-3 text-muted-foreground'>
                    {formatTime(details.delivery.updatedAt, i18n.language)}
                  </td>
                </tr>
                <tr className='border-b bg-muted/10'>
                  <td colSpan={5} className='px-4 py-3'>
                    <AttemptList details={details} />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

function AttemptList({
  details,
}: {
  readonly details: NotificationDeliveryDetails;
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  if (details.attempts.length === 0) {
    return (
      <p className='text-xs text-muted-foreground'>
        {t('logs.noAttempts', { defaultValue: 'No attempts recorded.' })}
      </p>
    );
  }
  return (
    <div className='grid gap-1.5'>
      {details.attempts.map((attempt) => {
        return (
          <div
            key={attempt.id}
            className='grid grid-cols-[2.5rem_minmax(8rem,1fr)_auto] items-center gap-3 rounded-md bg-muted/35 px-3 py-2 text-xs'
          >
            <span className='font-mono text-muted-foreground'>
              #{attempt.sequence}
            </span>
            <span className='min-w-0'>
              <strong>{attempt.providerType}</strong>
              {attempt.error ? (
                <span className='mt-1 block text-destructive'>
                  <TruncatedText
                    text={providerErrorMessage(t, attempt.error)}
                  />
                </span>
              ) : null}
            </span>
            <StatusBadge status={attempt.status} />
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  readonly status: NotificationStatus;
}): ReactElement {
  const { t } = useTranslation('@nocobase/app-plugin-notification');
  return (
    <ApplicationStatusBadge tone={statusTone(status)}>
      {t(`status.${status}`, { defaultValue: status.replace('_', ' ') })}
    </ApplicationStatusBadge>
  );
}

function statusTone(
  status: NotificationStatus,
): 'success' | 'destructive' | 'warning' {
  if (status === 'completed' || status === 'accepted') {
    return 'success';
  }
  if (status === 'failed' || status === 'unknown' || status === 'partial') {
    return 'destructive';
  }
  return 'warning';
}

function formatTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function providerErrorMessage(
  t: Translate,
  error: { readonly message: string; readonly code?: string },
): string {
  if (error.code === 'IN_APP_NOTIFICATION_RECIPIENT_NOT_FOUND')
    return t('errors.inAppRecipientNotFound', {
      defaultValue: 'In-app notification recipient does not exist.',
    });
  return t('errors.providerFailed');
}
