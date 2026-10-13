import { ApplicationTableEmpty } from '#components/application-table-empty';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable, DataTableColumnHeader } from '#components/data-table';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { useRecruitmentResource } from './resource.js';
import { Refresh, ErrorState } from './shared.js';
import type { Requisition } from './types.js';
export default function Requisitions() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    r = useRecruitmentResource<{ data: Requisition[] }>('requisitions');
  const columns: ColumnDef<Requisition>[] = [
    {
      accessorKey: 'id',
      header: t('recruitment.fields.requisitionId'),
      cell: ({ row }) => (
        <Link
          className='underline'
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
    ...(
      [
        'departmentId',
        'positionId',
        'sourceYear',
        'originalQuantity',
        'remaining',
        'consumed',
      ] as const
    ).map((key): ColumnDef<Requisition> => ({
      accessorKey: key,
      header: ({ column }) =>
        ['sourceYear', 'originalQuantity', 'remaining', 'consumed'].includes(
          key,
        ) ? (
          <DataTableColumnHeader
            column={column}
            title={t(`recruitment.fields.${key}`)}
            className='justify-end text-right'
          />
        ) : (
          t(`recruitment.fields.${key}`)
        ),
      enableSorting: [
        'sourceYear',
        'originalQuantity',
        'remaining',
        'consumed',
      ].includes(key),
      cell: ({ row }) =>
        typeof row.original[key] === 'number' ? (
          <div className='text-right tabular-nums'>
            {new Intl.NumberFormat(i18n.language).format(row.original[key])}
          </div>
        ) : (
          String(row.original[key])
        ),
    })),
    {
      accessorKey: 'status',
      header: t('recruitment.fields.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {t(`recruitment.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader title={t('recruitment.requisitions')} />
      <ApplicationToolbar
        actions={<Refresh busy={r.loading} onClick={r.reload} />}
      />
      {r.error ? (
        <ErrorState error={r.error} retry={r.reload} />
      ) : r.loading ? (
        <ApplicationTableSkeleton columns={columns.length} />
      ) : r.data ? (
        <DataTable
          columns={columns}
          data={r.data.data}
          getRowId={(row) => row.id}
          emptyMessage={
            <ApplicationTableEmpty title={t('recruitment.emptyRequisitions')} />
          }
        />
      ) : null}
      <Outlet context={{ reload: r.reload }} />
    </PageContainer>
  );
}
