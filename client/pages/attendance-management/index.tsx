import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationSearch } from '#components/application-search';
import { useCallback, useMemo, useState } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import { format, parseISO } from 'date-fns';
import { MoreHorizontal, Plus, Eye, Pencil } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { DepartmentPicker } from '#components/department-picker';
import { DatePicker } from '#components/date-picker';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#components/ui/tabs';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useUrlSearch } from '#hooks/use-url-search';
import { Failure, Loading } from './states.js';
import { OptionSelect } from './select.js';
import { useAttendanceResource } from './resource.js';
import {
  resource,
  type Shift,
  type ShiftPage,
  type Envelope,
  type Schedule,
  type Revision,
  type SourceContext,
} from './types.js';
export default function AttendanceManagementPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    basePath = useResolvedPath('.').pathname;
  const { searchParams, updateParams, inputProps, clear, search } =
    useUrlSearch({ param: 'search', resetParams: ['page'] });
  const view = useCan({ resource, action: 'view' }),
    manage = useCan({ resource, action: 'manage' });
  const allowed = view.can && !view.isPending && !view.error,
    canManage = manage.can && !manage.isPending && !manage.error;
  const [refresh, setRefresh] = useState(0),
    reload = useCallback(() => setRefresh((n) => n + 1), [setRefresh]);
  const tab = searchParams.get('tab') === 'schedule' ? 'schedule' : 'shifts';
  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20;
  const sort = ['name', 'currentRevision'].includes(
      searchParams.get('sort') ?? '',
    )
      ? searchParams.get('sort')!
      : 'code',
    direction = searchParams.get('direction') === 'desc' ? 'desc' : 'asc',
    enabled = ['true', 'false'].includes(searchParams.get('enabled') ?? '')
      ? searchParams.get('enabled')!
      : 'all';
  const shifts = useAttendanceResource<ShiftPage>(
    allowed && tab === 'shifts' ? 'attendanceManagement/shifts' : null,
    {
      page: String(page),
      pageSize: String(pageSize),
      search,
      enabled,
      sort,
      direction,
    },
    refresh,
  );
  const context = useAttendanceResource<Envelope<{ timeZone: string }>>(
    allowed ? 'attendanceManagement/context' : null,
    {},
    refresh,
  );
  const departmentId = searchParams.get('departmentId') ?? '',
    date = searchParams.get('date') ?? '';
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parseISO(date).getTime());
  const schedule = useAttendanceResource<Envelope<Schedule | null>>(
    allowed && tab === 'schedule' && departmentId && validDate
      ? 'attendanceManagement/schedule'
      : null,
    { departmentId, date },
    refresh,
  );
  const shift = useAttendanceResource<Envelope<Revision | null>>(
    allowed &&
      tab === 'schedule' &&
      schedule.data?.data?.revision.shiftRevisionId
      ? 'attendanceManagement/shiftRevision'
      : null,
    { id: schedule.data?.data?.revision.shiftRevisionId ?? '' },
    refresh,
  );
  const shiftData = shifts.data,
    updateShifts = shifts.update,
    updateSchedule = schedule.update;
  const onShiftSaved = useCallback(
    (saved: Shift) => {
      if (shiftData)
        updateShifts({
          ...shiftData,
          data: shiftData.data.map((row) =>
            row.id === saved.id ? saved : row,
          ),
        });
      reload();
    },
    [shiftData, updateShifts, reload],
  );
  const onScheduleSaved = useCallback(
    (saved: Schedule) => {
      updateSchedule({ data: saved });
      reload();
    },
    [updateSchedule, reload],
  );
  const source = useMemo<SourceContext>(
    () => ({
      basePath,
      search: location.search,
      reload,
      onShiftSaved,
      onScheduleSaved,
    }),
    [basePath, location.search, reload, onShiftSaved, onScheduleSaved],
  );
  const link = (pathname: string) => ({ pathname, search: location.search });
  const columns = useMemo<ColumnDef<Shift>[]>(
    () => [
      {
        accessorKey: 'code',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('attendanceManagement.code')}
          />
        ),
        cell: ({ row }) => (
          <Link
            className='font-medium underline-offset-4 hover:underline'
            to={{
              pathname: `${row.original.id}/revisions/${row.original.currentRevision}`,
              search: location.search,
            }}
          >
            <TruncatedText text={row.original.code} />
          </Link>
        ),
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('attendanceManagement.name')}
          />
        ),
        cell: ({ row }) => <TruncatedText text={row.original.name} />,
      },
      {
        accessorKey: 'enabled',
        enableSorting: false,
        header: t('attendanceManagement.status'),
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? 'secondary' : 'outline'}>
            {t(
              `attendanceManagement.${row.original.enabled ? 'enabled' : 'disabled'}`,
            )}
          </Badge>
        ),
      },
      {
        accessorKey: 'currentRevision',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('attendanceManagement.version')}
          />
        ),
        cell: ({ row }) => (
          <span className='block text-right tabular-nums'>
            {new Intl.NumberFormat(i18n.language).format(
              row.original.currentRevision,
            )}
          </span>
        ),
      },
      {
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('attendanceManagement.actions', {
                    name: row.original.name,
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-auto min-w-40'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `${row.original.id}/revisions/${row.original.currentRevision}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  <Eye />
                  {t('attendanceManagement.view')}
                </DropdownMenuItem>
                {canManage ? (
                  <DropdownMenuItem
                    render={
                      <Link
                        to={{
                          pathname: `${row.original.id}/edit`,
                          search: location.search,
                        }}
                      />
                    }
                  >
                    <Pencil />
                    {t('attendanceManagement.edit')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, i18n.language, location.search, canManage],
  );
  const selected = schedule.data?.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('attendanceManagement.title')}
        description={t('attendanceManagement.description')}
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          updateParams((p) => p.set('tab', String(value)))
        }
      >
        <TabsList>
          <TabsTrigger value='shifts'>
            {t('attendanceManagement.shifts')}
          </TabsTrigger>
          <TabsTrigger value='schedule'>
            {t('attendanceManagement.schedules')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {view.isPending ? (
            <Loading />
          ) : view.error || !allowed ? (
            <Failure error={view.error} denied={!view.can} />
          ) : context.error ? (
            <Failure error={context.error} retry={context.reload} />
          ) : !context.data ? (
            <Loading />
          ) : (
            <>
              <p className='text-sm text-muted-foreground'>
                {t('attendanceManagement.timeZone')}:{' '}
                {context.data.data.timeZone}
              </p>
              {tab === 'shifts' ? (
                <>
                  <ApplicationToolbar
                    actions={
                      <>
                        <ApplicationRefreshButton
                          label={t('attendanceManagement.refresh')}
                          onClick={reload}
                          loading={shifts.loading}
                        />
                        {canManage ? (
                          <Button
                            nativeButton={false}
                            render={<Link to={link('new')} />}
                          >
                            <Plus data-icon='inline-start' />
                            {t('attendanceManagement.create')}
                          </Button>
                        ) : null}
                      </>
                    }
                  >
                    <ApplicationSearch
                      {...inputProps}
                      aria-label={t('attendanceManagement.search')}
                      placeholder={t('attendanceManagement.search')}
                      className='w-full sm:max-w-xs'
                    />
                    <div
                      data-slot='application-filter'
                      className='w-full sm:w-40'
                    >
                      <Label className='sr-only' htmlFor='attendance-status'>
                        {t('attendanceManagement.status')}
                      </Label>
                      <OptionSelect
                        id='attendance-status'
                        value={enabled}
                        options={['all', 'true', 'false'].map((value) => ({
                          value,
                          label: t(
                            `attendanceManagement.${value === 'all' ? 'all' : value === 'true' ? 'enabled' : 'disabled'}`,
                          ),
                        }))}
                        onChange={(value) =>
                          updateParams((p) => {
                            p.set('enabled', value);
                            p.delete('page');
                          })
                        }
                      />
                    </div>
                    {search || enabled !== 'all' ? (
                      <Button
                        variant='ghost'
                        onClick={() =>
                          clear((p) => {
                            p.delete('enabled');
                            p.delete('page');
                          })
                        }
                      >
                        {t('attendanceManagement.clearFilters')}
                      </Button>
                    ) : null}
                  </ApplicationToolbar>
                  {shifts.loading && !shifts.data ? (
                    <ApplicationTableSkeleton columns={5} />
                  ) : shifts.error ? (
                    <Failure error={shifts.error} retry={shifts.reload} />
                  ) : shifts.data ? (
                    <DataTableServer
                      columns={columns}
                      rows={shifts.data.data}
                      total={shifts.data.meta.total}
                      getRowId={(row) => row.id}
                      pagination={{ pageIndex: page - 1, pageSize }}
                      onPaginationChange={(value) =>
                        updateParams((p) => {
                          p.set('page', String(value.pageIndex + 1));
                          p.set('pageSize', String(value.pageSize));
                        })
                      }
                      sorting={[{ id: sort, desc: direction === 'desc' }]}
                      onSortingChange={(value) =>
                        updateParams((p) => {
                          p.set('sort', value[0]?.id ?? 'code');
                          p.set('direction', value[0]?.desc ? 'desc' : 'asc');
                          p.delete('page');
                        })
                      }
                      pageSizeOptions={[10, 20, 50, 100]}
                      emptyMessage={t(
                        `attendanceManagement.${search || enabled !== 'all' ? 'noMatches' : 'empty'}`,
                      )}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <ApplicationToolbar
                    actions={
                      <>
                        <ApplicationRefreshButton
                          label={t('attendanceManagement.refresh')}
                          onClick={reload}
                          loading={schedule.loading}
                        />
                        {canManage ? (
                          <Button
                            nativeButton={false}
                            disabled={
                              !departmentId ||
                              !validDate ||
                              schedule.loading ||
                              !!schedule.error ||
                              !schedule.data
                            }
                            render={<Link to={link('schedule/edit')} />}
                          >
                            <Pencil data-icon='inline-start' />
                            {t('attendanceManagement.configure')}
                          </Button>
                        ) : null}
                      </>
                    }
                  >
                    <div
                      data-slot='application-filter'
                      className='flex flex-col gap-2'
                    >
                      <Label htmlFor='attendance-department'>
                        {t('attendanceManagement.department')}
                      </Label>
                      <DepartmentPicker
                        id='attendance-department'
                        value={departmentId}
                        onChange={(value) =>
                          updateParams((p) => p.set('departmentId', value))
                        }
                      />
                    </div>
                    <div
                      data-slot='application-filter'
                      data-context='true'
                      className='flex flex-col gap-2'
                    >
                      <Label htmlFor='attendance-date'>
                        {t('attendanceManagement.date')}
                      </Label>
                      <DatePicker
                        id='attendance-date'
                        value={validDate ? parseISO(date) : undefined}
                        onChange={(value) =>
                          updateParams((p) => {
                            if (value)
                              p.set('date', format(value, 'yyyy-MM-dd'));
                            else p.delete('date');
                          })
                        }
                        className='w-full'
                      />
                    </div>
                  </ApplicationToolbar>
                  {!departmentId || !validDate ? (
                    <p className='text-sm text-muted-foreground'>
                      {t('attendanceManagement.chooseDepartmentDate')}
                    </p>
                  ) : schedule.loading && !schedule.data ? (
                    <Loading />
                  ) : schedule.error ? (
                    <Failure error={schedule.error} retry={schedule.reload} />
                  ) : !selected ? (
                    <Alert>
                      <AlertDescription>
                        {t('attendanceManagement.unconfigured')}
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <div className='flex flex-col gap-4'>
                      <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-3 text-sm'>
                        <dt>{t('attendanceManagement.date')}</dt>
                        <dd>
                          {new Intl.DateTimeFormat(i18n.language, {
                            dateStyle: 'medium',
                          }).format(parseISO(selected.date))}
                        </dd>
                        <dt>{t('attendanceManagement.status')}</dt>
                        <dd>
                          <Badge variant='secondary'>
                            {t(
                              `attendanceManagement.${selected.revision.restDay ? 'restDay' : 'workingDay'}`,
                            )}
                          </Badge>
                        </dd>
                        <dt>{t('attendanceManagement.shiftRevision')}</dt>
                        <dd>
                          {selected.revision.restDay ? (
                            '—'
                          ) : shift.loading ? (
                            t('attendanceManagement.loading')
                          ) : shift.error ? (
                            <Failure error={shift.error} retry={shift.reload} />
                          ) : shift.data?.data ? (
                            `${shift.data.data.name} · ${t('attendanceManagement.revisionLabel', { revision: shift.data.data.revision })}`
                          ) : (
                            '—'
                          )}
                        </dd>
                        <dt>{t('attendanceManagement.reason')}</dt>
                        <dd className='whitespace-pre-wrap break-words'>
                          {selected.revision.reason}
                        </dd>
                      </dl>
                      <Button
                        variant='outline'
                        nativeButton={false}
                        className='self-start'
                        render={
                          <Link
                            to={link(
                              `schedule/revisions/${selected.version + 1}`,
                            )}
                          />
                        }
                      >
                        <Eye data-icon='inline-start' />
                        {t('attendanceManagement.history')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
      <Outlet context={source} />
    </PageContainer>
  );
}
