import { ApplicationTableEmpty } from '#components/application-table-empty';
import { UserName } from '#components/user-name';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { TruncatedText } from '#components/truncated-text';
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
import { useBalanceResource } from '../leave-balances/resource.js';

import { ErrorState } from './states.js';
import { amountText } from './money.js';
import type { PurchaseOrder } from './types.js';
export default function PurchaseOrderLedger() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    { searchParams, updateParams } = useUrlSearch();
  const rawPage = Number(searchParams.get('page') ?? 1),
    page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSize = Number(searchParams.get('pageSize') ?? 20),
    pageSize = [10, 20, 50, 100].includes(rawSize) ? rawSize : 20;
  const rawSort = searchParams.get('sort') ?? 'createdAt',
    sort = ['createdAt', 'number', 'actualCents'].includes(rawSort)
      ? rawSort
      : 'createdAt';
  const direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const resource = useBalanceResource<{
    timeZone: string;
    data: PurchaseOrder[];
    meta: { total: number; page: number; pageSize: number };
  }>(
    `purchaseOrders?page=${page}&pageSize=${pageSize}&sort=${sort}&direction=${direction}`,
  );
  const columns = useMemo<ColumnDef<PurchaseOrder, unknown>[]>(
    () => [
      {
        id: 'number',
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('purchases.orderNumber')}
          />
        ),
        cell: ({ row }) => <TruncatedText text={row.original.number} />,
      },
      {
        id: 'vendor',
        enableSorting: false,
        header: t('purchases.vendor'),
        cell: ({ row }) => <TruncatedText text={row.original.vendor.name} />,
      },
      {
        id: 'applicant',
        enableSorting: false,
        header: t('approvals.applicant'),
        cell: ({ row }) => (
          <UserName
            name={row.original.applicant?.name ?? t('approvals.unknownPerson')}
          />
        ),
      },
      {
        id: 'actualCents',
        accessorKey: 'actualCents',
        meta: { className: 'text-right tabular-nums' },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('purchases.actualAmount')}
          />
        ),
        cell: ({ row }) => amountText(row.original.actualCents),
      },
      {
        id: 'status',
        enableSorting: false,
        header: t('approvals.status'),
        cell: ({ row }) => (
          <StatusBadge
            tone={
              row.original.status === 'accepted'
                ? 'success'
                : row.original.status === 'cancelled'
                  ? 'warning'
                  : 'info'
            }
          >
            {t(`purchases.orderStates.${row.original.status}`)}
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
            timeZone: resource.data?.timeZone,
          }).format(new Date(row.original.createdAt)),
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <span className='sr-only'>{t('approvals.actions')}</span>,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('approvals.actions', {
                    name: row.original.number,
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link to={`order/${row.original.id}${location.search}`} />
                  }
                >
                  {t('approvals.detail')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [i18n.language, location.search, resource.data?.timeZone, t],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('purchases.ledgerTitle')}
        description={t('purchases.ledgerDescription')}
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
        <ApplicationTableSkeleton columns={columns.length} />
      ) : null}
      {resource.data ? (
        <DataTableServer
          columns={columns}
          rows={resource.data.data}
          total={resource.data.meta.total}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onPaginationChange={(next) =>
            updateParams((params) => {
              params.set('page', String(next.pageIndex + 1));
              params.set('pageSize', String(next.pageSize));
            })
          }
          onSortingChange={(next) =>
            updateParams((params) => {
              params.set('sort', next[0]?.id ?? 'createdAt');
              params.set('direction', next[0]?.desc === false ? 'asc' : 'desc');
              params.delete('page');
            })
          }
          emptyMessage={
            <ApplicationTableEmpty title={t('purchases.emptyOrders')} />
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      ) : null}
      <Outlet context={{ reload: resource.reload }} />
    </PageContainer>
  );
}
