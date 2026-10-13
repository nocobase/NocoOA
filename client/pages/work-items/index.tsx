import { ApplicationTableEmpty } from '#components/application-table-empty';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { useMemo } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useLocation, useResolvedPath } from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, RefreshCw } from 'lucide-react';
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
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import { useUrlSearch } from '#hooks/use-url-search';
import { OptionSelect } from './select.js';
import { useWorkResource } from './resource.js';
import { Failure } from './states.js';
import {
  resource,
  modes,
  statuses,
  type Item,
  type Context,
  type Envelope,
  type Source,
} from './types.js';
export default function WorkItemsPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    basePath = useResolvedPath('.').pathname;
  const view = useCan({ resource, action: 'view' }),
    create = useCan({ resource, action: 'create' }),
    allowed = view.can && !view.isPending && !view.error;
  const { searchParams, updateParams, inputProps, search, clear } =
    useUrlSearch({ resetParams: ['page'] });
  const mode = modes.find((v) => v === searchParams.get('mode')) ?? 'pending',
    status = statuses.find((v) => v === searchParams.get('status')) ?? 'all',
    overdue = ['true', 'false'].includes(searchParams.get('overdue') ?? '')
      ? searchParams.get('overdue')!
      : 'all';
  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20;
  const sort = ['title', 'status'].includes(searchParams.get('sort') ?? '')
      ? searchParams.get('sort')!
      : 'dueAt',
    direction = searchParams.get('direction') === 'desc' ? 'desc' : 'asc';
  const r = useWorkResource<{ data: Item[]; meta: { total: number } }>(
    allowed ? 'workItems' : null,
    {
      mode,
      q: search,
      ...(status !== 'all' ? { status } : {}),
      overdue,
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction,
    },
  );
  const ctx = useWorkResource<Envelope<Context>>(
    allowed ? 'workItems/context' : null,
  );
  const source = useMemo<Source>(
    () => ({ basePath, search: location.search, reload: r.reload }),
    [basePath, location.search, r.reload],
  );
  const columns: ColumnDef<Item>[] = [
    {
      accessorKey: 'title',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('workItems.titleField')}
        />
      ),
      cell: ({ row }) => (
        <Link
          className='font-medium text-foreground underline-offset-4 hover:underline break-words'
          to={{
            pathname: `${basePath}/${row.original.id}`,
            search: location.search,
          }}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'creator',
      header: t('workItems.creator'),
      cell: ({ row }) => <UserName name={row.original.creator.name} />,
    },
    {
      id: 'assignee',
      header: t('workItems.assignee'),
      cell: ({ row }) =>
        row.original.assignee || row.original.target ? (
          <UserName
            name={row.original.assignee?.name ?? row.original.target?.name}
          />
        ) : typeof row.original.dutyRole?.title === 'string' ? (
          row.original.dutyRole.title
        ) : row.original.dutyRole ? (
          t(row.original.dutyRole.title.key, {
            ns: row.original.dutyRole.title.ns,
          })
        ) : (
          '—'
        ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workItems.status')} />
      ),
      cell: ({ row }) => (
        <div className='flex flex-wrap gap-1'>
          <StatusBadge tone={statusTone(row.original.status)}>
            {t(`workItems.states.${row.original.status}`)}
          </StatusBadge>
          {row.original.forced ? (
            <StatusBadge tone='warning'>{t('workItems.forced')}</StatusBadge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('workItems.dueAt')} />
      ),
      cell: ({ row }) => (
        <div>
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: ctx.data?.data.timeZone ?? 'UTC',
          }).format(new Date(row.original.dueAt))}
          {row.original.overdue ? (
            <StatusBadge tone='warning'>{t('workItems.overdue')}</StatusBadge>
          ) : null}
        </div>
      ),
    },
  ];
  const filter = (key: string, value: string) =>
    updateParams((p) => {
      p.set(key, value);
      p.delete('page');
    });
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('workItems.title')}
          description={t('workItems.description')}
        />
        {view.isPending ? (
          <ApplicationTableSkeleton columns={5} />
        ) : !allowed ? (
          <Failure denied error={view.error} />
        ) : (
          <>
            <Tabs value={mode} onValueChange={(v) => filter('mode', String(v))}>
              <TabsList className='h-auto flex-wrap'>
                {modes.map((v) => (
                  <TabsTrigger key={v} value={v}>
                    {t(`workItems.modes.${v}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <ApplicationToolbar
              actions={
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant='outline'
                          size='icon'
                          aria-label={t('workItems.refresh')}
                          disabled={r.loading}
                          onClick={() => {
                            r.reload();
                            ctx.reload();
                          }}
                        />
                      }
                    >
                      <RefreshCw
                        className={r.loading ? 'animate-spin' : undefined}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{t('workItems.refresh')}</TooltipContent>
                  </Tooltip>
                  {create.can && !create.isPending && !create.error ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: `${basePath}/new`,
                            search: location.search,
                          }}
                        />
                      }
                    >
                      <Plus />
                      {t('workItems.new')}
                    </Button>
                  ) : null}
                </>
              }
            >
              <ApplicationSearch
                className='sm:max-w-xs'
                aria-label={t('workItems.search')}
                placeholder={t('workItems.search')}
                {...inputProps}
              />
              <OptionSelect
                className='w-full sm:w-40'
                ariaLabel={t('workItems.status')}
                value={status}
                onChange={(v) => filter('status', v)}
                options={['all', ...statuses].map((v) => ({
                  value: v,
                  label: t(`workItems.states.${v}`),
                }))}
              />
              <OptionSelect
                className='w-full sm:w-40'
                ariaLabel={t('workItems.overdue')}
                value={overdue}
                onChange={(v) => filter('overdue', v)}
                options={['all', 'true', 'false'].map((v) => ({
                  value: v,
                  label: t(`workItems.overdueFilter.${v}`),
                }))}
              />
              {search || status !== 'all' || overdue !== 'all' ? (
                <Button
                  variant='ghost'
                  onClick={() =>
                    clear((p) => {
                      ['status', 'overdue', 'page'].forEach((k) => p.delete(k));
                    })
                  }
                >
                  {t('workItems.clear')}
                </Button>
              ) : null}
            </ApplicationToolbar>
            {r.loading && !r.data ? (
              <ApplicationTableSkeleton columns={5} />
            ) : r.error ? (
              <Failure error={r.error} retry={r.reload} />
            ) : r.data ? (
              <DataTableServer
                columns={columns}
                rows={r.data.data}
                total={r.data.meta.total}
                getRowId={(row) => row.id}
                pageSizeOptions={[10, 20, 50, 100]}
                pagination={{ pageIndex: page - 1, pageSize }}
                onPaginationChange={(v) =>
                  updateParams((p) => {
                    p.set('page', String(v.pageIndex + 1));
                    p.set('pageSize', String(v.pageSize));
                  })
                }
                sorting={[{ id: sort, desc: direction === 'desc' }]}
                onSortingChange={(v) =>
                  updateParams((p) => {
                    p.set('sort', v[0]?.id ?? 'dueAt');
                    p.set('direction', v[0]?.desc ? 'desc' : 'asc');
                    p.delete('page');
                  })
                }
                emptyMessage={
                  <ApplicationTableEmpty
                    title={t(
                      search || status !== 'all' || overdue !== 'all'
                        ? 'workItems.noMatches'
                        : 'workItems.empty',
                    )}
                    clearFilters={
                      search || status !== 'all' || overdue !== 'all'
                        ? {
                            label: t('workItems.clear'),
                            onClick: () =>
                              clear((p) => {
                                ['status', 'overdue', 'page'].forEach((k) =>
                                  p.delete(k),
                                );
                              }),
                          }
                        : undefined
                    }
                  />
                }
              />
            ) : null}
          </>
        )}
      </PageContainer>
      <Outlet context={source} />
    </>
  );
}
