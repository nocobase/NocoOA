import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useLocation } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, PackageCheck, RefreshCw, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { useResource } from './resource.js';
import { ErrorState } from './states.js';
import type { Page, RequestRecord } from './types.js';
const views = ['mine', 'pending', 'done', 'copied'];
const filterValues = {
  operation: ['use', 'borrow', 'scrap'],
  status: [
    'draft',
    'revision',
    'head',
    'appraisal',
    'finance',
    'gm',
    'issuing',
    'borrowed',
    'returning',
    'issued',
    'returned',
    'scrapped',
    'unable',
    'rejected',
    'withdrawn',
    'terminated',
  ],
};
export default function AssetRequestsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { searchParams, updateParams, text, inputProps, clear } = useUrlSearch({
    param: 'search',
    resetParams: ['page'],
  });
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.assetRequests' },
    action: 'create',
  });
  const canCreate =
    permission.can && !permission.isPending && !permission.error;
  const view = views.includes(searchParams.get('view') ?? '')
    ? searchParams.get('view')!
    : 'mine';
  const page = Math.max(1, Number(searchParams.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20;
  const sortBy = ['number', 'quantity', 'borrowDueDate', 'updatedAt'].includes(
    searchParams.get('sortBy') ?? '',
  )
    ? searchParams.get('sortBy')!
    : 'updatedAt';
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';
  const operation = searchParams.get('operation') ?? '',
    status = searchParams.get('status') ?? '',
    search = searchParams.get('search') ?? '';
  const r = useResource<Page<RequestRecord>>('assetRequests', {
    view,
    page: String(page),
    pageSize: String(pageSize),
    sortBy,
    sortOrder,
    ...(search ? { search } : {}),
    ...(operation ? { operation } : {}),
    ...(status ? { status } : {}),
  });
  const filtered = !!(search || operation || status);
  const link = (path: string) => ({ pathname: path, search: location.search });
  const create = canCreate ? (
    <Button nativeButton={false} render={<Link to={link('newAssetRequest')} />}>
      <Plus />
      {t('assetRequests.new')}
    </Button>
  ) : null;
  const clearFilters = () =>
    clear((p) => {
      p.delete('operation');
      p.delete('status');
      p.delete('page');
    });
  const columns: ColumnDef<RequestRecord>[] = [
    {
      accessorKey: 'number',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('assetRequests.number')}
        />
      ),
      cell: ({ row }) =>
        row.original.id ? (
          <Link
            to={link(`assetRequest/${row.original.id}`)}
            className='font-medium hover:underline'
          >
            <TruncatedText
              text={row.original.number ?? t('assetRequests.draft')}
            />
          </Link>
        ) : (
          '—'
        ),
    },
    {
      accessorKey: 'operation',
      header: t('assetRequests.operationLabel'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone='neutral'>
          {row.original.operation
            ? t(`assetRequests.operations.${row.original.operation}`)
            : '—'}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'quantity',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('assetRequests.quantity')}
        />
      ),
      cell: ({ row }) => (
        <div className='text-right tabular-nums'>
          {row.original.quantity === undefined
            ? '—'
            : new Intl.NumberFormat(i18n.language).format(
                row.original.quantity,
              )}
        </div>
      ),
    },
    {
      accessorKey: 'borrowDueDate',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('assetRequests.borrowDueDate')}
        />
      ),
      cell: ({ row }) =>
        row.original.borrowDueDate
          ? new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeZone: 'UTC',
            }).format(new Date(`${row.original.borrowDueDate}T00:00:00Z`))
          : '—',
    },
    {
      accessorKey: 'status',
      header: t('assetRequests.statusLabel'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {row.original.status
            ? t(`assetRequests.statuses.${row.original.status}`)
            : '—'}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('assetRequests.updatedAt')}
        />
      ),
      cell: ({ row }) =>
        row.original.updatedAt
          ? new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(row.original.updatedAt))
          : '—',
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('assetRequests.rowActions', {
                  name: row.original.number ?? t('assetRequests.draft'),
                })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent className='w-auto min-w-40' align='end'>
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={<Link to={link(`assetRequest/${row.original.id}`)} />}
              >
                {t('assetRequests.detail')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('assetRequests.title')}
        description={t('assetRequests.description')}
      />
      <Tabs
        value={view}
        onValueChange={(v) =>
          updateParams((p) => {
            p.set('view', String(v));
            p.delete('page');
          })
        }
      >
        <TabsList className='flex flex-wrap'>
          {views.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`assetRequests.tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <ApplicationToolbar
        actions={
          <>
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('assetRequests.refresh')}
                      disabled={r.loading}
                      onClick={r.reload}
                    />
                  }
                >
                  <RefreshCw
                    className={r.loading ? 'animate-spin' : undefined}
                  />
                </TooltipTrigger>
                <TooltipContent>{t('assetRequests.refresh')}</TooltipContent>
              </Tooltip>
            </>
            {create}
          </>
        }
      >
        <ApplicationSearch
          id='asset-search'
          className='w-full sm:max-w-xs'
          placeholder={t('assetRequests.searchPlaceholder')}
          aria-label={t('assetRequests.search')}
          {...inputProps}
          value={text}
        />
        {(['operation', 'status'] as const).map((k) => (
          <Select
            key={k}
            items={[
              { value: '__all', label: t('assetRequests.all') },
              ...filterValues[k].map((value) => ({
                value,
                label: t(
                  `assetRequests.${k === 'operation' ? 'operations' : 'statuses'}.${value}`,
                ),
              })),
            ]}
            value={(k === 'operation' ? operation : status) || '__all'}
            onValueChange={(v) =>
              updateParams((p) => {
                if (v && v !== '__all') p.set(k, v);
                else p.delete(k);
                p.delete('page');
              })
            }
          >
            <SelectTrigger
              id={`asset-${k}`}
              className='w-full sm:w-40'
              aria-label={t(`assetRequests.${k}Label`)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
              <SelectGroup>
                <SelectItem value='__all'>{t('assetRequests.all')}</SelectItem>
                {filterValues[k].map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(
                      `assetRequests.${k === 'operation' ? 'operations' : 'statuses'}.${v}`,
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
        {filtered ? (
          <Button variant='ghost' onClick={clearFilters}>
            {t('assetRequests.clearFilters')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <ErrorState error={r.error} retry={r.reload} /> : null}
      {!r.data ? (
        r.loading ? (
          <ApplicationTableSkeleton columns={columns.length} />
        ) : null
      ) : (
        <DataTableServer
          columns={columns}
          rows={r.data.data}
          total={r.data.meta.total}
          getRowId={(row) => row.id!}
          pagination={{ pageIndex: r.data.meta.page - 1, pageSize }}
          onPaginationChange={(p) =>
            updateParams((v) => {
              v.set('page', String(p.pageIndex + 1));
              v.set('pageSize', String(p.pageSize));
            })
          }
          sorting={[{ id: sortBy, desc: sortOrder === 'desc' }]}
          onSortingChange={(s) =>
            updateParams((p) => {
              p.set('sortBy', s[0]?.id ?? 'updatedAt');
              p.set('sortOrder', s[0]?.desc === false ? 'asc' : 'desc');
              p.delete('page');
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={
            r.data.meta.total === 0 ? (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <PackageCheck />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(
                      filtered
                        ? 'assetRequests.noResults'
                        : 'assetRequests.empty',
                    )}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      filtered
                        ? 'assetRequests.noResultsDescription'
                        : canCreate
                          ? 'assetRequests.emptyDescription'
                          : 'assetRequests.emptyReadonly',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              t('assetRequests.noResults')
            )
          }
        />
      )}
      <Outlet context={{ reload: r.reload }} />
    </PageContainer>
  );
}
