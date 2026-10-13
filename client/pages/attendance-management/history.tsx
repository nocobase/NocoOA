import { UserName } from '#components/user-name';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Link,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { ResponsiveTable } from '#components/responsive-table';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  resource,
  type Revision,
  type Schedule,
  type CurrentShift,
  type Envelope,
  type SourceContext,
} from './types.js';
import { useAttendanceResource } from './resource.js';
import { Failure, Loading } from './states.js';
export default function AttendanceHistory() {
  const { t, i18n } = useTranslation(),
    source = useOutletContext<SourceContext>(),
    { shiftId, revision: revisionParam } = useParams(),
    [params] = useSearchParams();
  const permission = useCan({ resource, action: 'view' }),
    allowed = permission.can && !permission.isPending && !permission.error;
  const revision = /^\d+$/.test(revisionParam ?? '')
    ? Number(revisionParam)
    : 0;
  const departmentId = params.get('departmentId') ?? '',
    date = params.get('date') ?? '';
  const shift = useAttendanceResource<Envelope<Revision | null>>(
    allowed && shiftId && revision > 0
      ? 'attendanceManagement/shiftRevision'
      : null,
    { shiftId: shiftId ?? '', revision: String(revision) },
  );
  const current = useAttendanceResource<Envelope<CurrentShift>>(
    allowed && shiftId
      ? `attendanceManagement/shifts/${encodeURIComponent(shiftId)}`
      : null,
  );
  const schedule = useAttendanceResource<Envelope<Schedule | null>>(
    allowed && !shiftId && departmentId && date && revision > 0
      ? 'attendanceManagement/schedule'
      : null,
    { departmentId, date, revision: String(revision) },
  );
  const company = useAttendanceResource<Envelope<{ timeZone: string }>>(
    allowed ? 'attendanceManagement/context' : null,
  );
  const data = shiftId ? shift.data?.data : schedule.data?.data,
    loading =
      shift.loading || current.loading || schedule.loading || company.loading;
  const failure =
      shift.error ?? current.error ?? schedule.error ?? company.error,
    maximum = shiftId
      ? current.data?.data.shift.currentRevision
      : schedule.data?.data
        ? schedule.data.data.version + 1
        : 0;
  const path = (n: number) => ({
    pathname: `${source.basePath}/${shiftId ? `${encodeURIComponent(shiftId)}/revisions` : 'schedule/revisions'}/${n}`,
    search: source.search,
  });
  const refresh = () => {
    company.reload();
    shift.reload();
    current.reload();
    schedule.reload();
  };
  return (
    <RouteDrawer
      title={shift.data?.data?.name ?? t('attendanceManagement.history')}
      closeTo={{ pathname: source.basePath, search: source.search }}
      footer={
        <>
          {revision > 1 ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to={path(revision - 1)} />}
            >
              <ChevronLeft data-icon='inline-start' />
              {t('attendanceManagement.revisionLabel', {
                revision: revision - 1,
              })}
            </Button>
          ) : null}
          {maximum && revision < maximum ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to={path(revision + 1)} />}
            >
              {t('attendanceManagement.revisionLabel', {
                revision: revision + 1,
              })}
              <ChevronRight data-icon='inline-end' />
            </Button>
          ) : null}
        </>
      }
    >
      {permission.isPending || loading ? (
        <Loading />
      ) : !allowed || permission.error ? (
        <Failure error={permission.error} denied={!permission.can} />
      ) : failure ? (
        <Failure error={failure} retry={refresh} />
      ) : !data ? (
        <Alert>
          <AlertDescription>
            {t('attendanceManagement.notFound')}
          </AlertDescription>
        </Alert>
      ) : (
        <div className='flex flex-col gap-6'>
          <p className='text-sm text-muted-foreground'>
            {t('attendanceManagement.revisionReadonly')}
          </p>
          {shiftId && shift.data?.data ? (
            <ShiftRevisionDetail
              revision={shift.data.data}
              displayTimeZone={company.data?.data.timeZone}
            />
          ) : schedule.data?.data ? (
            <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3 text-sm'>
              <dt>{t('attendanceManagement.date')}</dt>
              <dd>{schedule.data.data.date}</dd>
              <dt>{t('attendanceManagement.version')}</dt>
              <dd className='tabular-nums'>
                {new Intl.NumberFormat(i18n.language).format(
                  schedule.data.data.revision.revision,
                )}
              </dd>
              <dt>{t('attendanceManagement.status')}</dt>
              <dd>
                <Badge variant='secondary'>
                  {t(
                    `attendanceManagement.${schedule.data.data.revision.restDay ? 'restDay' : 'workingDay'}`,
                  )}
                </Badge>
              </dd>
              <dt>{t('attendanceManagement.shiftRevision')}</dt>
              <dd>
                {schedule.data.data.revision.restDay ? (
                  '—'
                ) : (
                  <ScheduleShift
                    revisionId={schedule.data.data.revision.shiftRevisionId!}
                  />
                )}
              </dd>
              <dt>{t('attendanceManagement.reason')}</dt>
              <dd className='whitespace-pre-wrap break-words'>
                {schedule.data.data.revision.reason}
              </dd>
              <dt>{t('attendanceManagement.createdBy')}</dt>
              <dd className='break-words'>
                <UserName name={schedule.data.data.revision.createdBy.name} />
              </dd>
              <dt>{t('attendanceManagement.createdAt')}</dt>
              <dd>
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: company.data?.data.timeZone,
                }).format(new Date(schedule.data.data.revision.createdAt))}{' '}
              </dd>
            </dl>
          ) : null}
        </div>
      )}
    </RouteDrawer>
  );
}
function ScheduleShift({ revisionId }: { revisionId: string }) {
  const { t } = useTranslation(),
    r = useAttendanceResource<Envelope<Revision | null>>(
      'attendanceManagement/shiftRevision',
      { id: revisionId },
    );
  return r.loading ? (
    <span>{t('attendanceManagement.loading')}</span>
  ) : r.error ? (
    <Failure error={r.error} retry={r.reload} />
  ) : r.data?.data ? (
    <span>
      {r.data.data.name} ·{' '}
      {t('attendanceManagement.revisionLabel', {
        revision: r.data.data.revision,
      })}
    </span>
  ) : (
    '—'
  );
}
export function ShiftRevisionDetail({
  revision,
  displayTimeZone,
}: {
  revision: Revision;
  displayTimeZone?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className='flex flex-col gap-4'>
      <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3 text-sm'>
        <dt>{t('attendanceManagement.name')}</dt>
        <dd className='break-words'>{revision.name}</dd>
        <dt>{t('attendanceManagement.version')}</dt>
        <dd className='tabular-nums'>
          {new Intl.NumberFormat(i18n.language).format(revision.revision)}
        </dd>
        <dt>{t('attendanceManagement.timeZone')}</dt>
        <dd>{revision.timeZone}</dd>
        {(
          [
            'lateToleranceMinutes',
            'earlyToleranceMinutes',
            'absenceThresholdMinutes',
          ] as const
        ).map((field) => (
          <div key={field} className='contents'>
            <dt>{t(`attendanceManagement.${field}`)}</dt>
            <dd className='tabular-nums'>
              {new Intl.NumberFormat(i18n.language).format(revision[field])}
            </dd>
          </div>
        ))}
        <dt>{t('attendanceManagement.createdBy')}</dt>
        <dd className='break-words'>
          <UserName name={revision.createdBy.name} />
        </dd>
        <dt>{t('attendanceManagement.createdAt')}</dt>
        <dd>
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: displayTimeZone ?? revision.timeZone,
          }).format(new Date(revision.createdAt))}
        </dd>
      </dl>
      <ResponsiveTable>
        <TableHeader>
          <TableRow>
            {['start', 'startDayOffset', 'end', 'endDayOffset'].map((key) => (
              <TableHead key={key}>
                {t(`attendanceManagement.${key}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {revision.intervals.map((interval) => (
            <TableRow
              key={`${interval.startDayOffset}:${interval.start}-${interval.endDayOffset}:${interval.end}`}
            >
              <TableCell>{interval.start}</TableCell>
              <TableCell>
                {t(
                  `attendanceManagement.${interval.startDayOffset ? 'nextDay' : 'sameDay'}`,
                )}
              </TableCell>
              <TableCell>{interval.end}</TableCell>
              <TableCell>
                {t(
                  `attendanceManagement.${interval.endDayOffset ? 'nextDay' : 'sameDay'}`,
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ResponsiveTable>
    </div>
  );
}
