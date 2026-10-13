import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { AvailabilitySearch } from './availability-search';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, MoreHorizontal, Eye } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Badge } from '#components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { useMeetingResource } from './resource.js';
import { MeetingError } from './states.js';
import {
  dateLabel,
  type Room,
  type Booking,
  type Options,
  type Page,
  type Tab,
} from './types.js';
export default function MeetingRooms() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ param: 'search', resetParams: ['page'] });
  const options = useMeetingResource<{ data: Options }>(
    'meetingBookings/options',
  );
  const requested = search.searchParams.get('tab') as Tab | null,
    tab: Tab =
      requested &&
      ['availability', 'rooms', ...(options.data?.data.modes ?? [])].includes(
        requested,
      )
        ? requested
        : 'availability';
  const finding = tab === 'availability';
  const rooms = tab === 'rooms',
    page = Math.max(1, Number(search.searchParams.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(
      Number(search.searchParams.get('pageSize')),
    )
      ? Number(search.searchParams.get('pageSize'))
      : 20;
  const allowedSort = rooms
    ? ['name', 'capacity', 'version']
    : ['title', 'startAt', 'endAt', 'version'];
  const sort = allowedSort.includes(search.searchParams.get('sort') ?? '')
    ? search.searchParams.get('sort')!
    : rooms
      ? 'name'
      : 'startAt';
  const direction =
    search.searchParams.get('direction') === 'asc'
      ? 'asc'
      : search.searchParams.get('direction') === 'desc'
        ? 'desc'
        : rooms
          ? 'asc'
          : 'desc';
  const active = search.searchParams.get('active'),
    filtered =
      !!search.search || (rooms && ['true', 'false'].includes(active ?? ''));
  const r = useMeetingResource<Page<Room | Booking>>(
    finding
      ? null
      : rooms
        ? 'meetingRooms'
        : options.data
          ? 'meetingBookings'
          : null,
    {
      page: String(page),
      pageSize: String(pageSize),
      search: search.search,
      sort,
      direction,
      locale: i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US',
      ...(rooms && ['true', 'false'].includes(active ?? '')
        ? { active: active! }
        : {}),
      ...(!rooms ? { mode: tab } : {}),
    },
  );
  const link = (path: string) => ({
    pathname: path,
    search: location.search,
    hash: location.hash,
  });
  const refresh = () => {
    r.reload();
    options.reload();
  };
  const create =
    rooms && options.data?.data.canManage ? (
      <Button nativeButton={false} render={<Link to={link('new-room')} />}>
        <Plus data-icon='inline-start' />
        {t('meetingRooms.newRoom')}
      </Button>
    ) : options.data?.data.canCreate ? (
      <Button nativeButton={false} render={<Link to={link('reserve')} />}>
        <Plus data-icon='inline-start' />
        {t('meetingRooms.reserve')}
      </Button>
    ) : null;
  const columns: ColumnDef<Room | Booking>[] = [
    {
      accessorKey: rooms ? 'name' : 'title',
      enableHiding: false,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t(
            rooms ? 'meetingRooms.fields.name' : 'meetingRooms.fields.title',
          )}
        />
      ),
      cell: ({ row }) => (
        <Link
          to={link(`${rooms ? 'room' : 'booking'}/${row.original.id}`)}
          className='font-medium text-primary underline-offset-4 hover:underline'
        >
          <TruncatedText
            text={
              rooms
                ? (row.original as Room).name
                : (row.original as Booking).title
            }
          />
        </Link>
      ),
    },
    ...(rooms
      ? [
          {
            accessorKey: 'location',
            enableSorting: false,
            enableHiding: false,
            header: t('meetingRooms.fields.location'),
            cell: ({ row }: { row: { original: Room | Booking } }) => (
              <TruncatedText text={(row.original as Room).location ?? '—'} />
            ),
          },
          {
            accessorKey: 'capacity',
            enableHiding: false,
            header: ({
              column,
            }: {
              column: import('@tanstack/react-table').Column<Room | Booking>;
            }) => (
              <DataTableColumnHeader
                column={column}
                title={t('meetingRooms.fields.capacity')}
              />
            ),
            cell: ({ row }: { row: { original: Room | Booking } }) => (
              <div className='text-right tabular-nums'>
                {new Intl.NumberFormat(i18n.language).format(
                  (row.original as Room).capacity,
                )}
              </div>
            ),
          },
        ]
      : [
          ...(['startAt', 'endAt'] as const).map((key) => ({
            accessorKey: key,
            enableHiding: false,
            header: ({
              column,
            }: {
              column: import('@tanstack/react-table').Column<Room | Booking>;
            }) => (
              <DataTableColumnHeader
                column={column}
                title={t(`meetingRooms.fields.${key}`)}
              />
            ),
            cell: ({ row }: { row: { original: Room | Booking } }) =>
              dateLabel(
                (row.original as Booking)[key],
                i18n.language,
                (row.original as Booking).companyTimeZone,
              ),
          })),
          {
            id: 'room',
            enableSorting: false,
            header: t('meetingRooms.fields.room'),
            cell: ({ row }: { row: { original: Room | Booking } }) => (
              <RoomName roomId={(row.original as Booking).roomId} />
            ),
          },
          {
            accessorKey: 'organizer',
            enableSorting: false,
            enableHiding: false,
            header: t('meetingRooms.fields.organizer'),
            cell: ({ row }: { row: { original: Room | Booking } }) => (
              <UserName name={(row.original as Booking).organizer.name} />
            ),
          },
        ]),
    {
      id: 'status',
      enableSorting: false,
      enableHiding: false,
      header: t('meetingRooms.fields.status'),
      cell: ({ row }) => (
        <Badge variant='secondary'>
          {t(
            rooms
              ? `meetingRooms.status.${(row.original as Room).active ? 'active' : 'inactive'}`
              : `meetingRooms.status.${(row.original as Booking).status}`,
          )}
        </Badge>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('meetingRooms.rowActions', {
                  name: rooms
                    ? (row.original as Room).name
                    : (row.original as Booking).title,
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
                    to={link(
                      `${rooms ? 'room' : 'booking'}/${row.original.id}`,
                    )}
                  />
                }
              >
                <Eye />
                {t('meetingRooms.view')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  const activeItems = ['all', 'true', 'false'].map((value) => ({
    value,
    label: t(`meetingRooms.filters.${value}`),
  }));
  return (
    <PageContainer>
      <PageHeader
        title={t('meetingRooms.title')}
        description={t('meetingRooms.description')}
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          search.updateParams((p) => {
            p.set('tab', String(value));
            ['page', 'sort', 'direction', 'active', 'search'].forEach((k) =>
              p.delete(k),
            );
          })
        }
      >
        <TabsList className='max-w-full overflow-x-auto'>
          <TabsTrigger value='availability'>
            {t('meetingRooms.finder.title')}
          </TabsTrigger>
          <TabsTrigger value='rooms'>
            {t('meetingRooms.tabs.rooms')}
          </TabsTrigger>
          {options.data?.data.modes.map((mode) => (
            <TabsTrigger key={mode} value={mode}>
              {t(`meetingRooms.tabs.${mode}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {finding ? (
        options.data ? (
          <AvailabilitySearch options={options.data.data} />
        ) : options.error ? (
          <MeetingError error={options.error} retry={options.reload} />
        ) : (
          <ApplicationTableSkeleton columns={5} />
        )
      ) : (
        <>
          <ApplicationToolbar
            actions={
              <>
                <ApplicationRefreshButton
                  label={t('meetingRooms.refresh')}
                  loading={r.loading || options.loading}
                  onClick={refresh}
                />
                {create}
              </>
            }
          >
            <ApplicationSearch
              id='meeting-search'
              {...search.inputProps}
              aria-label={t('meetingRooms.search')}
              placeholder={t('meetingRooms.searchPlaceholder')}
              className='w-full sm:max-w-xs'
            />
            {rooms ? (
              <Select
                items={activeItems}
                value={active ?? 'all'}
                onValueChange={(value) =>
                  search.updateParams((p) => {
                    if (value === 'true' || value === 'false')
                      p.set('active', value);
                    else p.delete('active');
                    p.delete('page');
                  })
                }
              >
                <SelectTrigger aria-label={t('meetingRooms.fields.active')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                  <SelectGroup>
                    {activeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            {search.text || filtered ? (
              <Button
                variant='outline'
                onClick={() =>
                  search.clear((p) => {
                    p.delete('active');
                    p.delete('page');
                  })
                }
              >
                {t('meetingRooms.clear')}
              </Button>
            ) : null}
          </ApplicationToolbar>
          {options.error ? (
            <MeetingError error={options.error} retry={options.reload} />
          ) : null}
          {r.error ? <MeetingError error={r.error} retry={r.reload} /> : null}
          {!r.data ? (
            r.loading ? (
              <ApplicationTableSkeleton columns={columns.length} />
            ) : null
          ) : (
            <DataTableServer
              rows={r.data.data}
              columns={columns}
              total={r.data.meta.total}
              getRowId={(row) => row.id}
              pagination={{ pageIndex: page - 1, pageSize }}
              onPaginationChange={(v) =>
                search.updateParams((p) => {
                  p.set('page', String(v.pageIndex + 1));
                  p.set('pageSize', String(v.pageSize));
                })
              }
              sorting={[{ id: sort, desc: direction === 'desc' }]}
              onSortingChange={(v) =>
                search.updateParams((p) => {
                  p.set('sort', v[0]?.id ?? (rooms ? 'name' : 'startAt'));
                  p.set('direction', v[0]?.desc ? 'desc' : 'asc');
                  p.delete('page');
                })
              }
              pageSizeOptions={[10, 20, 50, 100]}
              emptyMessage={t(
                filtered
                  ? 'meetingRooms.empty.filtered'
                  : 'meetingRooms.empty.title',
              )}
            />
          )}
        </>
      )}
      <Outlet context={{ onSaved: refresh, options: options.data?.data }} />
    </PageContainer>
  );
}

function RoomName({ roomId }: { roomId: string }) {
  const room = useMeetingResource<{ data: Room }>(
    `meetingRooms/${encodeURIComponent(roomId)}`,
  );
  return room.data ? (
    <TruncatedText text={room.data.data.name} />
  ) : (
    <span>—</span>
  );
}
