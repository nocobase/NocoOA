import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from '../approvals/states.js';
import type { Balance, LeaveType } from '../leave-balances/types.js';

export function PersonalCards() {
  const { session } = useAuthentication();
  const meetings = useCan({
    resource: { type: 'composite', id: 'oa.meetingBookings' },
    action: 'view',
  });
  const rooms = useCan({
    resource: { type: 'composite', id: 'oa.meetingRooms' },
    action: 'view',
  });
  const announcements = useCan({
    resource: { type: 'composite', id: 'oa.announcements' },
    action: 'view',
  });
  if (!session) return null;
  return (
    <div className='flex flex-col items-stretch gap-4 lg:flex-row'>
      <LeaveCard />
      {meetings.can && !meetings.isPending && !meetings.error ? (
        <MeetingCard
          canNavigate={rooms.can && !rooms.isPending && !rooms.error}
        />
      ) : null}
      {announcements.can && !announcements.isPending && !announcements.error ? (
        <AnnouncementCard />
      ) : null}
    </div>
  );
}
function SummaryCard({
  title,
  loading,
  error,
  reload,
  empty,
  children,
  to,
}: {
  title: string;
  loading: boolean;
  error?: unknown;
  reload: () => void;
  empty: boolean;
  children: ReactNode;
  to?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card className='min-w-0 flex-1'>
      <CardHeader>
        <CardTitle>
          <h2>{t(title)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState context='query' error={error} retry={reload} />
        ) : loading ? (
          <Skeleton
            className='h-20 w-full'
            aria-label={t('workbench.loading')}
          />
        ) : empty ? (
          <p className='text-sm text-muted-foreground'>
            {t('workbench.personalEmpty')}
          </p>
        ) : (
          children
        )}
      </CardContent>
      <CardFooter className='mt-auto flex flex-wrap gap-2'>
        <Button variant='outline' size='sm' disabled={loading} onClick={reload}>
          {t('approvals.refresh')}
        </Button>
        {to ? (
          <Button
            variant='ghost'
            size='sm'
            nativeButton={false}
            render={<Link to={to} />}
          >
            {t('workbench.viewSource')}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
function LeaveCard() {
  const { t, i18n } = useTranslation();
  const balances = useResource<Balance[]>('leaveBalances/me');
  const options = useResource<{ leaveTypes: LeaveType[] }>(
    'leaveRequests/options',
  );
  const reload = () => {
    balances.reload();
    options.reload();
  };
  const label = (code: string) => {
    const type = options.data?.leaveTypes.find((row) => row.code === code);
    return (
      type?.label[i18n.language] ??
      type?.label['zh-CN'] ??
      type?.label['en-US'] ??
      code
    );
  };
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  });
  return (
    <SummaryCard
      title='workbench.leaveBalances'
      to='/leaveBalances'
      loading={balances.loading || options.loading}
      error={balances.error ?? options.error}
      reload={reload}
      empty={!balances.data?.length}
    >
      <ul className='space-y-3'>
        {balances.data?.map((row) => (
          <li key={row.leaveType} className='text-sm'>
            <p className='font-medium break-words'>{label(row.leaveType)}</p>
            <p className='text-muted-foreground'>
              {t('workbench.balanceDays', {
                available: number.format(row.availableUnits / 2),
                held: number.format(row.heldUnits / 2),
              })}
            </p>
          </li>
        ))}
      </ul>
    </SummaryCard>
  );
}
export interface MeetingSummary {
  date: string;
  timeZone: string;
  total: number;
  items: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    status: string;
  }[];
}
function MeetingCard({ canNavigate }: { canNavigate: boolean }) {
  const { t, i18n } = useTranslation();
  const resource = useResource<MeetingSummary>('workbench/meetings');
  const data = resource.data;
  const time = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      timeZone: data!.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  return (
    <SummaryCard
      title='workbench.todayMeetings'
      to={canNavigate ? '/meeting-rooms' : undefined}
      loading={resource.loading}
      error={resource.error}
      reload={resource.reload}
      empty={data?.total === 0}
    >
      <p className='mb-3 text-sm text-muted-foreground'>
        {data
          ? t('workbench.meetingCount', { date: data.date, count: data.total })
          : null}
      </p>
      <ul className='space-y-3'>
        {data?.items.map((row) => (
          <li key={row.id} className='text-sm'>
            {canNavigate ? (
              <Link
                className='text-primary underline-offset-4 hover:underline break-words'
                to={`/meeting-rooms/booking/${encodeURIComponent(row.id)}`}
              >
                {row.title}
              </Link>
            ) : (
              <span className='break-words'>{row.title}</span>
            )}
            <p className='text-muted-foreground'>
              {time(row.startAt)}–{time(row.endAt)} ·{' '}
              {t(`meetingRooms.status.${row.status}`)}
            </p>
          </li>
        ))}
      </ul>
    </SummaryCard>
  );
}
function AnnouncementCard() {
  const { t } = useTranslation();
  const resource = useResource<{
    count: number;
    items: {
      id: string;
      announcementId: string;
      title: string;
      dueAt: string;
    }[];
  }>('announcements/pending');
  return (
    <SummaryCard
      title='workbench.announcementReceipts'
      to='/announcements?mode=pending'
      loading={resource.loading}
      error={resource.error}
      reload={resource.reload}
      empty={resource.data?.count === 0}
    >
      <p className='mb-3 text-sm text-muted-foreground'>
        {resource.data
          ? t('workbench.receiptCount', { count: resource.data.count })
          : null}
      </p>
      <ul className='space-y-3'>
        {resource.data?.items.slice(0, 5).map((row) => (
          <li key={row.id} className='text-sm'>
            <Link
              className='text-primary underline-offset-4 hover:underline break-words'
              to={`/announcements/${encodeURIComponent(row.announcementId)}`}
            >
              {row.title}
            </Link>
          </li>
        ))}
      </ul>
    </SummaryCard>
  );
}
