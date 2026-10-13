import { useEffect } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, Outlet, useLocation } from 'react-router';
import { Plus, RefreshCw, MoreHorizontal, Eye, Pencil } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { RESOURCE, type Vendor, type VendorPage } from './types.js';
import { useVendorResource } from './resource.js';
import { VendorError } from './states.js';
export default function Vendors() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    { searchParams, search, text, inputProps, clear, updateParams } =
      useUrlSearch({
        param: 'search',
        resetParams: ['page'],
      });
  const grant = useCan({
      resource: { type: 'composite', id: RESOURCE },
      action: 'manage',
    }),
    canManage = grant.can && !grant.isPending && !grant.error;
  const page = Math.max(1, Number(searchParams.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20,
    sort = ['name', 'code', 'updatedAt'].includes(
      searchParams.get('sort') ?? '',
    )
      ? searchParams.get('sort')!
      : 'name',
    direction = searchParams.get('direction') === 'desc' ? 'desc' : 'asc';
  const r = useVendorResource<VendorPage>('vendors', {
    page: String(page),
    pageSize: String(pageSize),
    search,
    sort,
    direction,
  });
  useEffect(() => {
    if (r.data?.meta.page && r.data.meta.page !== page)
      updateParams((p) => p.set('page', String(r.data!.meta.page)));
  }, [r.data, page, updateParams]);
  const link = (path: string) => ({ pathname: path, search: location.search });
  const create = canManage ? (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <Plus data-icon='inline-start' />
      {t('vendors.new')}
    </Button>
  ) : null;
  const columns: ColumnDef<Vendor>[] = [
    ...(['name', 'code'] as const).map((key) => ({
      accessorKey: key,
      header: ({
        column,
      }: {
        column: import('@tanstack/react-table').Column<Vendor, unknown>;
      }) => (
        <DataTableColumnHeader
          column={column}
          title={t(`vendors.fields.${key}`)}
        />
      ),
      cell: ({ row }: { row: import('@tanstack/react-table').Row<Vendor> }) =>
        key === 'name' ? (
          <Link
            to={link(row.original.id)}
            className='font-medium hover:underline underline-offset-4'
          >
            <TruncatedText text={row.original[key]} />
          </Link>
        ) : (
          <TruncatedText text={row.original[key]} />
        ),
    })),
    {
      id: 'category',
      header: t('vendors.fields.category'),
      enableSorting: false,
      cell: ({ row }) => <TruncatedText text={row.original.category} />,
    },
    {
      id: 'status',
      header: t('vendors.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone={row.original.active ? 'success' : 'neutral'}>
          {t(`vendors.statuses.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('vendors.updatedAt')} />
      ),
      cell: ({ row }) =>
        new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(row.original.updatedAt)),
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
                aria-label={t('vendors.rowActions', {
                  name: row.original.name,
                })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-40'>
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to={link(row.original.id)} />}>
                <Eye />
                {t('vendors.view')}
              </DropdownMenuItem>
              {canManage ? (
                <DropdownMenuItem
                  render={<Link to={link(`edit/${row.original.id}`)} />}
                >
                  <Pencil />
                  {t('vendors.edit')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('vendors.title')}
        description={t('vendors.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            {create}
            <Button
              variant='outline'
              size='icon'
              aria-label={t('vendors.refresh')}
              disabled={r.loading}
              onClick={r.reload}
            >
              <RefreshCw className={r.loading ? 'animate-spin' : undefined} />
            </Button>
          </>
        }
      >
        <ApplicationSearch
          id='vendor-search'
          aria-label={t('vendors.search')}
          placeholder={t('vendors.search')}
          {...inputProps}
        />
        {text ? (
          <Button variant='outline' onClick={() => clear()}>
            {t('vendors.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <VendorError error={r.error} retry={r.reload} /> : null}
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
          pagination={{ pageIndex: r.data.meta.page - 1, pageSize }}
          onPaginationChange={(v) =>
            updateParams((p) => {
              p.set('page', String(v.pageIndex + 1));
              p.set('pageSize', String(v.pageSize));
            })
          }
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onSortingChange={(v) =>
            updateParams((p) => {
              p.set('sort', v[0]?.id ?? 'name');
              p.set('direction', v[0]?.desc ? 'desc' : 'asc');
              p.delete('page');
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={
            <div className='flex flex-col gap-2'>
              <p>
                {t(
                  `vendors.empty.${search ? 'filtered' : canManage ? 'accounts' : 'readonly'}Title`,
                )}
              </p>
              <p className='text-muted-foreground'>
                {t(
                  `vendors.empty.${search ? 'filtered' : canManage ? 'accounts' : 'readonly'}Description`,
                )}
              </p>
            </div>
          }
        />
      )}
      <Outlet context={{ onSaved: r.reload }} />
    </PageContainer>
  );
}
