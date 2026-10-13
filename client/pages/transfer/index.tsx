import { ApplicationTableEmpty } from '#components/application-table-empty';
import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { RefreshCw, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { StatusBadge } from '#components/status-badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { useUrlSearch } from '#hooks/use-url-search';
import { useTransferResource } from './resource.js';
import { TransferError } from './states.js';
import { transferPolicy, statuses, type TransferRecord } from './types.js';
export default function TransferList() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ resetParams: ['page'] });
  const submit = useCan(transferPolicy('submit'));
  const capability = useTransferResource<{ data: { canCreateAsHR: boolean } }>(
    'transferRequests/capabilities',
  );
  const page = Math.max(1, Number(search.searchParams.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(
      Number(search.searchParams.get('pageSize')),
    )
      ? Number(search.searchParams.get('pageSize'))
      : 20;
  const order = search.searchParams.get('orderBy') ?? 'createdAt:desc';
  const [sort, direction] = /^(createdAt|effectiveDate|id):(asc|desc)$/.test(
    order,
  )
    ? order.split(':')
    : ['createdAt', 'desc'];
  const status = search.searchParams.get('status') ?? '';
  const resource = useTransferResource<{
    data: TransferRecord[];
    meta: { total: number };
  }>('transferRequests', {
    page: String(page),
    pageSize: String(pageSize),
    q: search.search,
    orderBy: `${sort}:${direction}`,
    ...(status ? { status } : {}),
  });
  const statusItems = [
    { value: 'all', label: t('transfer.allStatuses') },
    ...statuses.map((value) => ({
      value,
      label: t(`transfer.status.${value}`),
    })),
  ];
  const columns = useMemo<ColumnDef<TransferRecord>[]>(
    () => [
      {
        accessorKey: 'id',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('transfer.fields.id')}
          />
        ),
        cell: ({ row }) => (
          <Link
            className='font-medium underline underline-offset-4'
            to={{
              pathname: row.original.id,
              search: location.search,
              hash: location.hash,
            }}
          >
            {row.original.id}
          </Link>
        ),
        enableHiding: false,
      },
      {
        id: 'employee',
        header: t('transfer.fields.employeeId'),
        enableSorting: false,
        cell: ({ row }) => (
          <UserName
            name={row.original.employee?.name ?? t('transfer.employeeInDetail')}
          />
        ),
      },
      {
        accessorKey: 'kinds',
        header: t('transfer.fields.kinds'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.kinds
            .map((kind) => t(`transfer.kinds.${kind}`))
            .join(' · '),
      },
      {
        accessorKey: 'effectiveDate',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('transfer.fields.effectiveDate')}
          />
        ),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeZone: 'UTC',
          }).format(new Date(row.original.effectiveDate + 'T00:00:00Z')),
      },
      {
        accessorKey: 'status',
        header: t('transfer.fields.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone={statusTone(row.original.status)}>
            {t(`transfer.status.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
        id: 'applicant',
        header: t('transfer.fields.applicantId'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.users?.find(
            (user) => user.id === row.original.applicantId,
          )?.name ?? t('approvals.unknownPerson'),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('transfer.fields.createdAt')}
          />
        ),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(row.original.createdAt)),
      },
    ],
    [t, i18n.language, location.search, location.hash],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('transfer.title')}
        description={t('transfer.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('transfer.refresh')}
                    disabled={resource.loading}
                    onClick={() => {
                      resource.reload();
                      capability.reload();
                    }}
                  />
                }
              >
                <RefreshCw
                  className={resource.loading ? 'animate-spin' : undefined}
                />
              </TooltipTrigger>
              <TooltipContent>{t('transfer.refresh')}</TooltipContent>
            </Tooltip>
            {submit.can && capability.data?.data.canCreateAsHR ? (
              <Button
                render={
                  <Link
                    to={{
                      pathname: 'new',
                      search: location.search,
                      hash: location.hash,
                    }}
                  />
                }
                nativeButton={false}
              >
                <Plus />
                {t('transfer.create')}
              </Button>
            ) : null}
          </>
        }
      >
        <ApplicationSearch
          className='sm:max-w-xs'
          aria-label={t('transfer.search')}
          placeholder={t('transfer.search')}
          {...search.inputProps}
        />
        <Select
          items={statusItems}
          value={status || 'all'}
          onValueChange={(value) =>
            search.updateParams((params) => {
              params.delete('page');
              if (value === 'all') params.delete('status');
              else params.set('status', value ?? '');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('transfer.fields.status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {search.search || status ? (
          <Button
            variant='ghost'
            onClick={() =>
              search.clear((params) => {
                params.delete('status');
                params.delete('page');
              })
            }
          >
            {t('transfer.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {resource.error ? (
        <TransferError error={resource.error} retry={resource.reload} />
      ) : null}
      {resource.loading && !resource.data ? (
        <ApplicationTableSkeleton columns={7} />
      ) : (
        <DataTableServer
          columns={columns}
          rows={resource.data?.data ?? []}
          total={resource.data?.meta.total ?? 0}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(value) =>
            search.updateParams((params) => {
              params.set('page', String(value.pageIndex + 1));
              params.set('pageSize', String(value.pageSize));
            })
          }
          sorting={[{ id: sort, desc: direction !== 'asc' }]}
          onSortingChange={(value) =>
            search.updateParams((params) => {
              params.set(
                'orderBy',
                `${value[0]?.id ?? 'createdAt'}:${value[0]?.desc ? 'desc' : 'asc'}`,
              );
              params.delete('page');
            })
          }
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                search.search || status
                  ? 'transfer.noResults'
                  : 'transfer.empty',
              )}
              clearFilters={
                search.search || status
                  ? {
                      label: t('transfer.clear'),
                      onClick: () =>
                        search.clear((p) => {
                          p.delete('status');
                          p.delete('page');
                        }),
                    }
                  : undefined
              }
            />
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      )}
      <Outlet context={{ reload: resource.reload }} />
    </PageContainer>
  );
}
