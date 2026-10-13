import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { RefreshCw, MoreHorizontal } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '#components/truncated-text';
import { useBalanceResource } from '../leave-balances/resource.js';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { ErrorState } from './states.js';
import type { SupplyLedgerEntry } from './types.js';
export default function SupplyLedgerPage() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    { searchParams, updateParams } = useUrlSearch();
  const rawPage = Number(searchParams.get('page') ?? 1),
    page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSize = Number(searchParams.get('pageSize') ?? 20),
    pageSize = [10, 20, 50, 100].includes(rawSize) ? rawSize : 20;
  const rawSort = searchParams.get('sortBy') ?? 'createdAt',
    sortBy = [
      'createdAt',
      'number',
      'itemCode',
      'requestedQuantity',
      'actualQuantity',
    ].includes(rawSort)
      ? rawSort
      : 'createdAt';
  const direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const resource = useBalanceResource<{
    data: { items: SupplyLedgerEntry[]; nextOffset: number | null };
    meta: { total: number; page: number; pageSize: number };
  }>(
    `supplyRequests/ledger?page=${page}&pageSize=${pageSize}&sortBy=${sortBy}&direction=${direction}`,
  );
  const columns = useMemo<ColumnDef<SupplyLedgerEntry, unknown>[]>(
    () => [
      {
        id: 'number',
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('supplies.number')} />
        ),
        cell: ({ row }) => (
          <TruncatedText text={row.original.number ?? t('approvals.draft')} />
        ),
      },
      {
        id: 'itemCode',
        accessorKey: 'itemCode',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('supplies.item')} />
        ),
        cell: ({ row }) => (
          <TruncatedText
            text={
              row.original.itemLabel[i18n.language] ??
              row.original.itemLabel['zh-CN'] ??
              row.original.itemCode
            }
          />
        ),
      },
      {
        id: 'requestedQuantity',
        accessorKey: 'requestedQuantity',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('supplies.requestedQuantity')}
          />
        ),
      },
      {
        id: 'actualQuantity',
        accessorKey: 'actualQuantity',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('supplies.actualQuantity')}
          />
        ),
        cell: ({ row }) =>
          row.original.actualQuantity ?? t('supplies.unconfirmed'),
      },
      {
        id: 'recipient',
        header: t('supplies.recipient'),
        enableSorting: false,
        cell: ({ row }) => <UserName name={row.original.recipient.name} />,
      },
      {
        id: 'issuer',
        header: t('supplies.issuer'),
        enableSorting: false,
        cell: ({ row }) => <UserName name={row.original.issuer.name} />,
      },
      {
        id: 'outcome',
        header: t('supplies.outcome'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.outcome === 'issued' ? 'success' : 'warning'}
          >
            {t(`supplies.states.${row.original.outcome}`)}
          </StatusBadge>
        ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('approvals.createdAt')}
          />
        ),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(row.original.createdAt)),
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
                  size='icon'
                  aria-label={t('supplies.rowActions')}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `entry/${row.original.id}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t('supplies.ledgerDetail')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [t, i18n.language, location.search],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('supplies.ledgerTitle')}
        description={t('supplies.ledgerDescription')}
      />
      <ApplicationToolbar
        actions={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('approvals.refresh')}
                  disabled={resource.loading}
                  onClick={resource.reload}
                />
              }
            >
              <RefreshCw
                className={resource.loading ? 'animate-spin' : undefined}
              />
            </TooltipTrigger>
            <TooltipContent>{t('approvals.refresh')}</TooltipContent>
          </Tooltip>
        }
      />
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : null}
      {!resource.data && resource.loading ? (
        <FieldsSkeleton fields={8} />
      ) : null}
      {resource.data ? (
        <DataTableServer
          columns={columns}
          rows={resource.data.data.items}
          total={resource.data.meta.total}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          sorting={[{ id: sortBy, desc: direction === 'desc' }]}
          onPaginationChange={(next) =>
            updateParams((params) => {
              params.set('page', String(next.pageIndex + 1));
              params.set('pageSize', String(next.pageSize));
            })
          }
          onSortingChange={(next) =>
            updateParams((params) => {
              params.set('sortBy', next[0]?.id ?? 'createdAt');
              params.set('direction', next[0]?.desc === false ? 'asc' : 'desc');
              params.delete('page');
            })
          }
          emptyMessage={
            <ApplicationTableEmpty title={t('supplies.emptyLedger')} />
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      ) : null}
      <Outlet context={{ reload: resource.reload }} />
    </PageContainer>
  );
}
