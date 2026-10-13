import { ApplicationTableEmpty } from '#components/application-table-empty';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { useReducer } from 'react';
import { PendingList } from './pending.js';
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
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '#components/ui/tabs';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { Identity } from './identity.js';
import { useAnnouncementResource } from './resource.js';
import { Failure } from './states.js';
import { OptionSelect } from './select.js';
import {
  resource,
  statuses,
  dateLabel,
  type Announcement,
  type Envelope,
  type Options,
} from './types.js';
export default function Announcements() {
  return (
    <Identity>
      <List />
    </Identity>
  );
}
function List() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    base = useResolvedPath('.').pathname;
  const create = useCan({ resource, action: 'create' }),
    view = useCan({ resource, action: 'view' });
  const allowed = view.can && !view.isPending && !view.error;
  const s = useUrlSearch({ param: 'q', resetParams: ['page'] }),
    mode = ['mine', 'pending'].includes(s.searchParams.get('mode') ?? '')
      ? s.searchParams.get('mode')!
      : 'received';
  const [pendingGeneration, refreshPending] = useReducer(
    (n: number) => n + 1,
    0,
  );
  const page = Math.max(1, Math.floor(Number(s.searchParams.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(
      Number(s.searchParams.get('pageSize')),
    )
      ? Number(s.searchParams.get('pageSize'))
      : 20;
  const status = statuses.find((v) => v === s.searchParams.get('status'));
  const sort = ['title', 'validUntil', 'publishedAt'].includes(
      s.searchParams.get('sort') ?? '',
    )
      ? s.searchParams.get('sort')!
      : 'publishedAt',
    direction = s.searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const r = useAnnouncementResource<Envelope<Announcement>>(
    allowed && mode !== 'pending' ? 'announcements' : null,
    {
      mode,
      page: String(page),
      pageSize: String(pageSize),
      q: s.search,
      sort,
      direction,
      ...(mode === 'mine' && status ? { status } : {}),
    },
  );
  const context = useAnnouncementResource<{ data: Options }>(
    allowed ? 'announcements/context' : null,
  );
  const link = (id: string) => ({
    pathname: `${base}/${id}`,
    search: location.search,
    hash: location.hash,
  });
  const columns: ColumnDef<Announcement>[] = [
    {
      accessorKey: 'title',
      enableHiding: false,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('announcements.fields.title')}
        />
      ),
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-2'>
          <Link
            to={link(row.original.id)}
            className='min-w-0 font-medium text-foreground underline-offset-4 hover:underline'
          >
            <TruncatedText text={row.original.title} />
          </Link>
          {row.original.pinned ? (
            <Badge variant='secondary'>{t('announcements.pinned')}</Badge>
          ) : null}
          {row.original.requiresConfirmation ? (
            <Badge variant='outline'>
              {t('announcements.requiresConfirmation')}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'publisher',
      enableSorting: false,
      header: t('announcements.publisher'),
      cell: ({ row }) => <UserName name={row.original.publisher.name} />,
    },
    {
      accessorKey: 'status',
      enableSorting: false,
      header: t('announcements.fields.status'),
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {t(`announcements.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    ...(['publishedAt', 'validUntil'] as const).map((key) => ({
      accessorKey: key,
      header: ({
        column,
      }: {
        column: import('@tanstack/react-table').Column<Announcement>;
      }) => (
        <DataTableColumnHeader
          column={column}
          title={t(`announcements.fields.${key}`)}
        />
      ),
      cell: ({ row }: { row: { original: Announcement } }) =>
        context.data
          ? dateLabel(
              row.original[key],
              i18n.language,
              context.data.data.timeZone,
            )
          : '—',
    })),
  ];
  const refresh = () => {
    r.reload();
    context.reload();
    refreshPending();
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('announcements.title')}
        description={t('announcements.description')}
      />
      <Tabs
        value={mode}
        onValueChange={(v) =>
          s.updateParams((p) => {
            p.set('mode', String(v));
            ['page', 'status'].forEach((k) => p.delete(k));
          })
        }
      >
        <TabsList>
          <TabsTrigger value='received'>
            {t('announcements.received')}
          </TabsTrigger>
          <TabsTrigger value='pending'>
            {t('announcements.pending')}
          </TabsTrigger>
          <TabsTrigger value='mine'>{t('announcements.mine')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <ApplicationToolbar
        actions={
          <>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('announcements.refresh')}
              title={t('announcements.refresh')}
              disabled={r.loading || context.loading}
              onClick={refresh}
            >
              <RefreshCw className={r.loading ? 'animate-spin' : undefined} />
            </Button>
            {create.can && !create.isPending && !create.error ? (
              <Button nativeButton={false} render={<Link to={link('new')} />}>
                <Plus />
                {t('announcements.new')}
              </Button>
            ) : null}
          </>
        }
      >
        <div
          data-slot='application-filter'
          className='flex min-w-0 flex-col gap-2'
        >
          <Label htmlFor='announcements-search'>
            {t('announcements.search')}
          </Label>
          <ApplicationSearch
            id='announcements-search'
            {...s.inputProps}
            placeholder={t('announcements.search')}
          />
        </div>
        {mode === 'mine' ? (
          <OptionSelect
            label={t('announcements.fields.status')}
            value={status ?? 'all'}
            items={['all', ...statuses].map((value) => ({
              value,
              label: t(`announcements.status.${value}`),
            }))}
            change={(v) =>
              s.updateParams((p) => {
                if (v === 'all') p.delete('status');
                else p.set('status', v);
                p.delete('page');
              })
            }
          />
        ) : null}
        {s.text || status ? (
          <Button
            variant='outline'
            onClick={() =>
              s.clear((p) => {
                p.delete('status');
                p.delete('page');
              })
            }
          >
            {t('announcements.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <Failure error={r.error} retry={refresh} /> : null}
      {context.error ? <Failure error={context.error} retry={refresh} /> : null}
      {mode === 'pending' && allowed ? (
        <PendingList
          key={pendingGeneration}
          search={s.search}
          zone={context.data?.data}
          reloadKey={pendingGeneration}
        />
      ) : !r.data ? (
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
            s.updateParams((p) => {
              p.set('page', String(v.pageIndex + 1));
              p.set('pageSize', String(v.pageSize));
            })
          }
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onSortingChange={(v) =>
            s.updateParams((p) => {
              p.set('sort', v[0]?.id ?? 'publishedAt');
              p.set('direction', v[0]?.desc ? 'desc' : 'asc');
              p.delete('page');
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                s.search || status
                  ? 'announcements.noMatches'
                  : 'announcements.empty',
              )}
              clearFilters={
                s.search || status
                  ? {
                      label: t('announcements.clear'),
                      onClick: () =>
                        s.clear((p) => {
                          p.delete('status');
                          p.delete('page');
                        }),
                    }
                  : undefined
              }
            />
          }
        />
      )}
      <Outlet context={{ reload: refresh }} />
    </PageContainer>
  );
}
