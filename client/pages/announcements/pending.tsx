import { Link, useLocation, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '#components/data-table';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { useAnnouncementResource } from './resource.js';
import { Failure } from './states.js';
import { dateLabel, type Options } from './types.js';
export interface Pending {
  items: { id: string; announcementId: string; title: string; dueAt: string }[];
  count: number;
}
export function PendingList({
  search,
  zone,
  reloadKey,
}: {
  search: string;
  zone?: Options;
  reloadKey: number;
}) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    base = useResolvedPath('.').pathname;
  const r = useAnnouncementResource<{ data: Pending }>('announcements/pending');
  // The public pending contract returns the full own set. Pagination is explicitly local.
  const columns: ColumnDef<Pending['items'][number]>[] = [
    {
      accessorKey: 'title',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('announcements.fields.title')}
        />
      ),
      cell: ({ row }) => (
        <Link
          className='font-medium text-foreground underline-offset-4 hover:underline'
          to={{
            pathname: `${base}/${row.original.announcementId}`,
            search: location.search,
            hash: location.hash,
          }}
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      accessorKey: 'dueAt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('announcements.fields.validUntil')}
        />
      ),
      cell: ({ row }) =>
        zone
          ? dateLabel(row.original.dueAt, i18n.language, zone.timeZone)
          : '—',
    },
  ];
  return (
    <div key={reloadKey}>
      {r.error ? <Failure error={r.error} retry={r.reload} /> : null}
      {r.data ? (
        <>
          <p className='mb-4 text-muted-foreground'>
            {t('announcements.ownPendingCount', { count: r.data.data.count })}
          </p>
          <DataTable
            data={r.data.data.items.filter(
              (v) =>
                !search ||
                v.title
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
            )}
            columns={columns}
            pageSize={20}
            getRowId={(row) => row.id}
            emptyMessage={t(
              search ? 'announcements.noMatches' : 'announcements.empty',
            )}
            showSelectedCount={false}
          />
        </>
      ) : r.loading ? (
        <ApplicationTableSkeleton columns={2} />
      ) : null}
    </div>
  );
}
