import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { UserName } from '#components/user-name';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer } from '#components/data-table';
import { useSealResource } from './resource.js';
import { SealError } from './states.js';
import type { Ledger } from './types.js';
export default function SealLedger() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    [params, setParams] = useSearchParams(),
    page = Math.max(1, Number(params.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(params.get('pageSize')))
      ? Number(params.get('pageSize'))
      : 20,
    r = useSealResource<{
      data: Ledger[];
      meta: { total: number; timeZone: string };
    }>('sealLedger', { page: String(page), pageSize: String(pageSize) });
  const cols: ColumnDef<Ledger, unknown>[] = [
    {
      accessorKey: 'id',
      header: t('seals.ledgerId'),
      cell: ({ row }) => (
        <Link
          className='text-primary underline underline-offset-4'
          to={{
            pathname: row.original.id,
            search: location.search,
            hash: location.hash,
          }}
        >
          {row.original.id}
        </Link>
      ),
    },
    { accessorKey: 'sealId', header: t('seals.sealId') },
    {
      id: 'applicant',
      header: t('seals.applicant'),
      cell: ({ row }) => <UserName name={row.original.applicant.name} />,
    },
    {
      id: 'approvedCopies',
      header: t('seals.copies'),
      cell: ({ row }) => (
        <span className='block text-right'>
          {row.original.approvedCopies.toLocaleString(i18n.language)}
        </span>
      ),
    },
    {
      id: 'actualCopies',
      header: t('seals.actualCopies'),
      cell: ({ row }) => (
        <span className='block text-right'>
          {row.original.actualCopies?.toLocaleString(i18n.language) ?? '—'}
        </span>
      ),
    },
    {
      id: 'borrowedAt',
      header: t('seals.borrowedAt'),
      cell: ({ row }) =>
        row.original.borrowedAt
          ? new Date(row.original.borrowedAt).toLocaleString(i18n.language, {
              timeZone: r.data?.meta.timeZone,
            })
          : '—',
    },
    {
      id: 'sealedAt',
      header: t('seals.sealedAt'),
      cell: ({ row }) =>
        row.original.sealedAt
          ? new Date(row.original.sealedAt).toLocaleString(i18n.language, {
              timeZone: r.data?.meta.timeZone,
            })
          : '—',
    },
    {
      id: 'registeredBy',
      header: t('seals.registeredBy'),
      cell: ({ row }) => <UserName name={row.original.registeredBy.name} />,
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('seals.ledger')}
        description={t('seals.physicalNotice')}
      />
      <ApplicationToolbar
        actions={
          <ApplicationRefreshButton
            label={t('seals.refresh')}
            loading={r.loading}
            onClick={r.reload}
          />
        }
      />
      {r.error ? <SealError error={r.error} retry={r.reload} /> : null}
      {r.loading && !r.data ? <ApplicationTableSkeleton /> : null}
      {r.data ? (
        <DataTableServer
          columns={cols}
          rows={r.data.data}
          total={r.data.meta.total}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(next) => {
            const p = new URLSearchParams(params);
            p.set('page', String(next.pageIndex + 1));
            p.set('pageSize', String(next.pageSize));
            setParams(p);
          }}
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={t('seals.emptyLedger')}
        />
      ) : null}
      <Outlet context={{ reload: r.reload }} />
    </PageContainer>
  );
}
