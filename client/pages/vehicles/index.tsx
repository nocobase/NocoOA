import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { useVehicleResource } from './resource.js';
import { VehicleError } from './states.js';
import {
  dateText,
  type Options,
  type Page,
  type Request,
  type Vehicle,
  type Driver,
} from './types.js';
export default function RequestsPage() {
  return <VehicleList garage={false} />;
}
export function VehicleList({ garage }: { garage: boolean }) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ param: 'search', resetParams: ['page'] }),
    o = useVehicleResource<{ data: Options }>('vehicleBrowser/options');
  const tab =
    search.searchParams.get('tab') === 'drivers' && garage
      ? 'drivers'
      : search.searchParams.get('tab') === 'all' && !garage
        ? 'all'
        : garage
          ? 'vehicles'
          : 'mine';
  const page = Math.max(1, Number(search.searchParams.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(
      Number(search.searchParams.get('pageSize')),
    )
      ? Number(search.searchParams.get('pageSize'))
      : 20,
    allowed = garage
      ? ['name', 'plateNumber', 'capacity']
      : ['createdAt', 'startAt', 'number'],
    sort = allowed.includes(search.searchParams.get('sort') ?? '')
      ? search.searchParams.get('sort')!
      : garage
        ? 'name'
        : 'createdAt',
    direction = search.searchParams.get('direction') === 'asc' ? 'asc' : 'desc',
    status = search.searchParams.get('status') ?? '';
  const r = useVehicleResource<Page<Request | Vehicle | Driver>>(
    `vehicleBrowser/${garage ? (tab === 'drivers' ? 'drivers' : 'garage') : 'requests'}`,
    {
      page: String(page),
      pageSize: String(pageSize),
      search: search.search,
      sort,
      direction,
      locale: i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US',
      status,
      mode: tab === 'all' ? 'all' : 'mine',
    },
  );
  const link = (path: string) => ({ pathname: path, search: location.search }),
    reload = () => {
      r.reload();
      o.reload();
    },
    canCreate = garage
      ? tab === 'drivers'
        ? o.data?.data.canManageDrivers
        : o.data?.data.canManage
      : o.data?.data.canCreate;
  const create = canCreate ? (
    <Button
      nativeButton={false}
      render={<Link to={link(tab === 'drivers' ? 'drivers/new' : 'new')} />}
    >
      <Plus data-icon='inline-start' />
      {t(
        garage
          ? tab === 'drivers'
            ? 'vehicles.newDriver'
            : 'vehicles.newVehicle'
          : 'vehicles.new',
      )}
    </Button>
  ) : null;
  const columns: ColumnDef<Request | Vehicle | Driver>[] =
    tab === 'drivers'
      ? [
          {
            id: 'name',
            header: t('vehicles.fields.driver'),
            cell: ({ row }) => (
              <Link
                className='underline'
                to={link(`drivers/${row.original.id}/edit`)}
              >
                <UserName name={(row.original as Driver).employee.user.name} />
              </Link>
            ),
          },
          {
            id: 'active',
            header: t('vehicles.fields.active'),
            cell: ({ row }) =>
              t(
                (row.original as Driver).active
                  ? 'vehicles.yes'
                  : 'vehicles.no',
              ),
          },
        ]
      : garage
        ? [
            ...(['name', 'plateNumber', 'capacity'] as const).map((k) => ({
              accessorKey: k,
              header: ({
                column,
              }: {
                column: import('@tanstack/react-table').Column<
                  Request | Vehicle | Driver
                >;
              }) => (
                <DataTableColumnHeader
                  column={column}
                  title={t(`vehicles.fields.${k}`)}
                />
              ),
              cell: ({
                row,
              }: {
                row: { original: Request | Vehicle | Driver };
              }) =>
                k === 'name' ? (
                  <Link
                    className='underline'
                    to={link(`${row.original.id}/edit`)}
                  >
                    <TruncatedText text={(row.original as Vehicle).name} />
                  </Link>
                ) : (
                  String((row.original as Vehicle)[k])
                ),
            })),
            {
              accessorKey: 'vehicleType',
              enableSorting: false,
              header: t('vehicles.fields.vehicleType'),
            },
          ]
        : [
            {
              accessorKey: 'number',
              header: ({ column }) => (
                <DataTableColumnHeader
                  column={column}
                  title={t('vehicles.fields.number')}
                />
              ),
              cell: ({ row }) => (
                <Link className='underline' to={link(row.original.id)}>
                  {(row.original as Request).number ?? t('vehicles.draft')}
                </Link>
              ),
            },
            {
              id: 'purpose',
              header: t('vehicles.fields.purpose'),
              cell: ({ row }) => (
                <TruncatedText text={(row.original as Request).purpose} />
              ),
            },
            {
              id: 'destination',
              header: t('vehicles.fields.destination'),
              cell: ({ row }) => (
                <TruncatedText text={(row.original as Request).destination} />
              ),
            },
            {
              id: 'applicant',
              header: t('vehicles.fields.applicant'),
              cell: ({ row }) => (
                <UserName name={(row.original as Request).applicant?.name} />
              ),
            },
            ...(['startAt', 'createdAt'] as const).map((k) => ({
              accessorKey: k,
              header: ({
                column,
              }: {
                column: import('@tanstack/react-table').Column<
                  Request | Vehicle | Driver
                >;
              }) => (
                <DataTableColumnHeader
                  column={column}
                  title={t(`vehicles.fields.${k}`)}
                />
              ),
              cell: ({
                row,
              }: {
                row: { original: Request | Vehicle | Driver };
              }) =>
                dateText(
                  (row.original as Request)[k],
                  i18n.language,
                  o.data?.data.timeZone ?? 'UTC',
                ),
            })),
          ];
  if (tab !== 'drivers')
    columns.push({
      id: 'status',
      header: t('vehicles.fields.status'),
      cell: ({ row }) => (
        <StatusBadge
          tone={statusTone((row.original as Request | Vehicle).status)}
        >
          {t(`vehicles.status.${(row.original as Request | Vehicle).status}`)}
        </StatusBadge>
      ),
    });
  const statusValues = garage
    ? ['active', 'inactive', 'maintenance']
    : [
        'draft',
        'revision',
        'head',
        'dispatch',
        'exception',
        'usage',
        'completed',
        'rejected',
        'withdrawn',
        'terminated',
      ];
  const statusItems = [
    { value: 'any', label: t('vehicles.any') },
    ...statusValues.map((value) => ({
      value,
      label: t(`vehicles.status.${value}`),
    })),
  ];
  const filtered = Boolean(search.search || status);
  return (
    <PageContainer>
      <PageHeader title={t(garage ? 'vehicles.garage' : 'vehicles.title')} />
      <Tabs
        value={tab}
        onValueChange={(value: string) =>
          search.updateParams((p) => {
            p.set('tab', value);
            p.delete('page');
            p.delete('sort');
            p.delete('status');
          })
        }
      >
        <TabsList className='max-w-full overflow-x-auto'>
          {(garage ? ['vehicles', 'drivers'] : ['mine', 'all']).map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`vehicles.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('vehicles.refresh')}
              loading={r.loading || o.loading}
              onClick={reload}
            />
            {create}
          </>
        }
      >
        <div data-slot='application-filter' className='min-w-48 flex-1'>
          <Label htmlFor='vehicle-search'>{t('vehicles.search')}</Label>
          <ApplicationSearch
            id='vehicle-search'
            placeholder={t(
              !garage
                ? 'vehicles.searchPlaceholder'
                : tab === 'drivers'
                  ? 'vehicles.driverSearchPlaceholder'
                  : 'vehicles.garageSearchPlaceholder',
            )}
            {...search.inputProps}
          />
        </div>
        {tab !== 'drivers' ? (
          <div data-slot='application-filter'>
            <Label htmlFor='vehicle-status'>
              {t('vehicles.fields.status')}
            </Label>
            <Select
              items={statusItems}
              value={status || 'any'}
              onValueChange={(value) =>
                search.updateParams((p) => {
                  if (value === 'any') p.delete('status');
                  else if (value) p.set('status', value);
                  p.delete('page');
                })
              }
            >
              <SelectTrigger
                id='vehicle-status'
                className='w-full sm:w-48'
                aria-label={t('vehicles.fields.status')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                <SelectGroup>
                  <SelectItem value='any'>{t('vehicles.any')}</SelectItem>
                  {statusValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`vehicles.status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {filtered ? (
          <Button
            variant='outline'
            onClick={() => search.clear((p) => p.delete('status'))}
          >
            {t('vehicles.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {o.error ? <VehicleError error={o.error} retry={o.reload} /> : null}
      {r.error ? (
        <VehicleError error={r.error} retry={reload} />
      ) : !r.data && r.loading ? (
        <ApplicationTableSkeleton columns={columns.length} />
      ) : r.data ? (
        <DataTableServer
          getRowId={(row) => row.id}
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                filtered ? 'vehicles.empty.filtered' : 'vehicles.empty.title',
              )}
              clearFilters={
                filtered
                  ? {
                      label: t('vehicles.clear'),
                      onClick: () => search.clear((p) => p.delete('status')),
                    }
                  : undefined
              }
            />
          }
          columns={columns}
          rows={r.data.data.items}
          total={r.data.data.total}
          pagination={{ pageIndex: page - 1, pageSize }}
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onSortingChange={(sorting) =>
            search.updateParams((p) => {
              if (sorting[0]) {
                p.set('sort', sorting[0].id);
                p.set('direction', sorting[0].desc ? 'desc' : 'asc');
              }
              p.delete('page');
            })
          }
          onPaginationChange={(value) =>
            search.updateParams((p) => {
              p.set('page', String(value.pageIndex + 1));
              p.set('pageSize', String(value.pageSize));
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      ) : null}

      <Outlet context={{ reload }} />
    </PageContainer>
  );
}
