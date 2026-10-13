import { useMemo } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, MoreHorizontal } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { DepartmentPicker } from '#components/department-picker';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Badge } from '#components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useResource } from './resource.js';
import { Choice, Failure, Refresh, EmptyState } from './shared.js';
import {
  accountName,
  resource,
  sortFields,
  type Balance,
  type PageContext,
} from './types.js';
export default function HeadcountsPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const grant = useCan({ resource, action: 'manage' }),
    manage = grant.can && !grant.isPending && !grant.error;
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(Number(params.get('pageSize')))
      ? Number(params.get('pageSize'))
      : 20;
  const departmentId = params.get('departmentId') ?? '',
    positionId = params.get('positionId') ?? '',
    year = params.get('year') ?? '';
  const orderBy =
      sortFields.find((v) => v === params.get('orderBy')) ?? 'updatedAt',
    desc = params.get('desc') !== 'false';
  const query = {
    page: String(page),
    pageSize: String(pageSize),
    departmentId,
    positionId,
    year,
    orderBy,
    desc: String(desc),
  };
  const r = useResource<{ data: Balance[]; meta: { total: number } }>(
    'headcounts',
    Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '')),
  );
  const positions = useResource<{ data: { id: string; title: string }[] }>(
    'positions/options',
  );
  function change(values: Record<string, string>) {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        for (const [key, value] of Object.entries(values)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }
  const { reload } = r;
  const context = useMemo<PageContext>(
    () => ({
      reload,
      onSaved: () => reload(),
      source: '/headcounts',
      search: location.search,
    }),
    [reload, location.search],
  );
  const number = (v: number) => new Intl.NumberFormat(i18n.language).format(v);
  const columns: ColumnDef<Balance>[] = [
    {
      id: 'account',
      enableSorting: false,
      header: t('headcounts.account'),
      cell: ({ row }) => (
        <Link
          className='underline'
          to={{ pathname: row.original.id, search: location.search }}
        >
          <TruncatedText text={accountName(row.original)} />
        </Link>
      ),
    },
    {
      id: 'initialized',
      enableSorting: false,
      header: t('headcounts.state'),
      cell: ({ row }) => (
        <Badge variant='outline'>
          {t(
            row.original.initialized
              ? 'headcounts.initialized'
              : 'headcounts.uninitialized',
          )}
        </Badge>
      ),
    },
    ...(
      ['year', 'limit', 'used', 'pending', 'allocated', 'available'] as const
    ).map((key): ColumnDef<Balance> => ({
      accessorKey: key,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t(`headcounts.fields.${key}`)}
          className='justify-end'
        />
      ),
      cell: ({ row }) => (
        <div className='text-right tabular-nums'>
          {key === 'year'
            ? String(row.original.year)
            : key === 'available' && !row.original.initialized
              ? t('headcounts.uninitialized')
              : number(row.original[key])}
        </div>
      ),
    })),
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('headcounts.fields.updatedAt')}
        />
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
                aria-label={t('headcounts.rowActions', {
                  name: accountName(row.original),
                })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-40'>
            <DropdownMenuItem
              render={
                <Link
                  to={{ pathname: row.original.id, search: location.search }}
                />
              }
            >
              {t('headcounts.view')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  const filtered = !!(departmentId || positionId || year);
  return (
    <PageContainer>
      <PageHeader
        title={t('headcounts.title')}
        description={t('headcounts.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            {manage ? (
              <Button
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'new', search: location.search }} />
                }
              >
                <Plus />
                {t('headcounts.create')}
              </Button>
            ) : null}
            <Refresh busy={r.loading} onClick={r.reload} />
          </>
        }
      >
        <div className='w-full sm:w-40'>
          <DepartmentPicker
            value={departmentId}
            onChange={(v) => change({ departmentId: v, page: '1' })}
            placeholder={t('headcounts.fields.department')}
          />
        </div>
        <div className='w-full sm:w-40'>
          <Choice
            label={t('headcounts.fields.position')}
            value={positionId}
            items={[
              { value: '', label: t('headcounts.allPositions') },
              ...(positions.data?.data ?? []).map((p) => ({
                value: p.id,
                label: p.title,
              })),
            ]}
            onChange={(v) => change({ positionId: v, page: '1' })}
          />
        </div>
        <Input
          type='number'
          className='w-full sm:w-40'
          aria-label={t('headcounts.fields.year')}
          placeholder={t('headcounts.fields.year')}
          value={year}
          onChange={(e) => change({ year: e.target.value, page: '1' })}
        />
        {filtered ? (
          <Button
            variant='ghost'
            onClick={() =>
              change({ departmentId: '', positionId: '', year: '', page: '1' })
            }
          >
            {t('headcounts.clearFilters')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <Failure error={r.error} retry={r.reload} /> : null}
      {positions.error ? (
        <Failure error={positions.error} retry={positions.reload} />
      ) : null}
      {r.loading && !r.data ? (
        <ApplicationTableSkeleton columns={10} />
      ) : r.data ? (
        <DataTableServer
          columns={columns}
          rows={r.data.data}
          total={r.data.meta.total}
          getRowId={(a) => a.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(v) =>
            change({
              page: String(v.pageIndex + 1),
              pageSize: String(v.pageSize),
            })
          }
          sorting={[{ id: orderBy, desc }]}
          onSortingChange={(v) =>
            change({
              orderBy: v[0]?.id ?? 'updatedAt',
              desc: String(v[0]?.desc ?? true),
              page: '1',
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={<EmptyState filtered={filtered} manage={manage} />}
        />
      ) : null}
      <Outlet context={context} />
    </PageContainer>
  );
}
