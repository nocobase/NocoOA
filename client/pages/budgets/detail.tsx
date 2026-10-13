import { UserName } from '#components/user-name';
import { useEffect } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef, Column } from '@tanstack/react-table';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { RefreshCw, Pencil } from 'lucide-react';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { RecordDetailDrawer } from '#components/record-detail-drawer';

import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { useBalanceResource } from './resource.js';
import { BudgetEmpty, BudgetError, BudgetSkeleton } from './states.js';
import {
  BUDGET_SETTINGS,
  label,
  money,
  type Budget,
  type BudgetContext,
  type Ledger,
  type Page,
} from './types.js';
const numeric = ['allocatedDelta', 'heldDelta', 'usedDelta'] as const;
export default function BudgetDetail() {
  const { budgetId = '' } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<BudgetContext>();
  const { searchParams, updateParams } = useUrlSearch();
  const page = Math.max(1, Number(searchParams.get('ledgerPage')) || 1);
  const pageSize = [10, 20, 50, 100].includes(
    Number(searchParams.get('ledgerPageSize')),
  )
    ? Number(searchParams.get('ledgerPageSize'))
    : 20;
  const rawSort = searchParams.get('ledgerOrderBy') ?? 'at';
  const orderBy = ['at', ...numeric].includes(rawSort) ? rawSort : 'at';
  const direction =
    searchParams.get('ledgerDirection') === 'asc' ? 'asc' : 'desc';
  const r = useBalanceResource<{ data: Budget }>(
    `budgets/${encodeURIComponent(budgetId)}`,
  );
  const ledger = useBalanceResource<Page<Ledger>>(
    `budgets/${encodeURIComponent(budgetId)}/ledger`,
    { page: String(page), pageSize: String(pageSize), orderBy, direction },
  );
  const p = useCan({
    resource: { type: 'settings', id: BUDGET_SETTINGS },
    action: 'update',
  });
  const canUpdate = p.can && !p.isPending && !p.error;
  const b = r.data?.data;
  const closeParams = new URLSearchParams(location.search);
  for (const key of [
    'ledgerPage',
    'ledgerPageSize',
    'ledgerOrderBy',
    'ledgerDirection',
  ])
    closeParams.delete(key);
  const columns: ColumnDef<Ledger>[] = [
    {
      accessorKey: 'at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('budgets.at')} />
      ),
      cell: ({ row }) =>
        new Date(row.original.at).toLocaleString(i18n.language),
    },
    {
      accessorKey: 'kind',
      enableSorting: false,
      header: t('budgets.kind'),
      cell: ({ row }) => (
        <StatusBadge tone='neutral'>
          {t(`budgets.kinds.${row.original.kind}`)}
        </StatusBadge>
      ),
    },
    ...numeric.map((key) => ({
      accessorKey: key,
      header: ({ column }: { column: Column<Ledger, unknown> }) => (
        <DataTableColumnHeader column={column} title={t(`budgets.${key}`)} />
      ),
      cell: ({ row }: { row: { original: Ledger } }) => (
        <div className='text-right tabular-nums'>
          {money(row.original[key], i18n.language)}
        </div>
      ),
    })),
    {
      accessorKey: 'reference',
      enableSorting: false,
      header: t('budgets.reference'),
      cell: ({ row }) => <TruncatedText text={row.original.reference} />,
    },
    {
      id: 'actor',
      enableSorting: false,
      header: t('budgets.actor'),
      cell: ({ row }) => <UserName name={row.original.actor.name} />,
    },
    {
      accessorKey: 'reason',
      enableSorting: false,
      header: t('budgets.reason'),
      cell: ({ row }) => <TruncatedText text={row.original.reason} />,
    },
  ];
  useEffect(() => {
    const actual = ledger.data?.meta.page;
    if (actual && actual !== page)
      updateParams((p) => p.set('ledgerPage', String(actual)));
  }, [ledger.data?.meta.page, page, updateParams]);
  const context: BudgetContext = {
    onSaved: (budget) => {
      r.update({ data: budget });
      ledger.reload();
      parent.onSaved(budget);
    },
  };
  return (
    <RecordDetailDrawer
      title={
        b
          ? t('budgets.accountTitle', {
              department: b.department.title,
              year: b.year,
              subject: label(b.subjectLabel, i18n.language),
            })
          : t('budgets.detail')
      }
      description={t('budgets.detailDescription')}
      footer={
        <>
          {b && canUpdate ? (
            <Button
              disabled={r.loading}
              render={
                <Link to={{ pathname: 'adjust', search: location.search }} />
              }
            >
              <Pencil data-icon='inline-start' />
              {t('budgets.adjust')}
            </Button>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('budgets.refresh')}
                  disabled={r.loading || ledger.loading}
                  onClick={() => {
                    r.reload();
                    ledger.reload();
                  }}
                />
              }
            >
              <RefreshCw
                className={
                  r.loading || ledger.loading ? 'animate-spin' : undefined
                }
              />
            </TooltipTrigger>
            <TooltipContent>{t('budgets.refresh')}</TooltipContent>
          </Tooltip>
        </>
      }
      closeTo={{
        pathname: '..',
        search: closeParams.toString() ? `?${closeParams}` : '',
        hash: location.hash,
      }}
    >
      <div className='flex flex-col gap-6'>
        {r.error ? <BudgetError error={r.error} retry={r.reload} /> : null}
        {!b ? (
          r.loading ? (
            <BudgetSkeleton />
          ) : null
        ) : (
          <>
            <dl className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              {(
                [
                  'department',
                  'year',
                  'subject',
                  'allocatedCents',
                  'heldCents',
                  'usedCents',
                  'availableCents',
                ] as const
              ).map((key) => (
                <div
                  key={key}
                  className='grid grid-cols-2 gap-2 sm:grid-cols-[8rem_1fr]'
                >
                  <dt className='text-sm text-muted-foreground'>
                    {t(`budgets.${key}`)}
                  </dt>
                  <dd className='break-words text-sm'>
                    {key === 'department'
                      ? b.department.title
                      : key === 'subject'
                        ? label(b.subjectLabel, i18n.language)
                        : key === 'year'
                          ? b.year
                          : money(b[key], i18n.language)}
                  </dd>
                </div>
              ))}
            </dl>
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>{t('budgets.ledger')}</h2>
              {ledger.error ? (
                <BudgetError error={ledger.error} retry={ledger.reload} />
              ) : null}
              {!ledger.data ? (
                ledger.loading ? (
                  <ApplicationTableSkeleton columns={8} />
                ) : null
              ) : (
                <DataTableServer
                  columns={columns}
                  rows={ledger.data.data}
                  total={ledger.data.meta.total}
                  getRowId={(v) => v.id}
                  pagination={{
                    pageIndex: ledger.data.meta.page - 1,
                    pageSize,
                  }}
                  onPaginationChange={(v) =>
                    updateParams((p) => {
                      p.set('ledgerPage', String(v.pageIndex + 1));
                      p.set('ledgerPageSize', String(v.pageSize));
                    })
                  }
                  sorting={[{ id: orderBy, desc: direction === 'desc' }]}
                  onSortingChange={(v) =>
                    updateParams((p) => {
                      p.set('ledgerOrderBy', v[0]?.id ?? 'at');
                      p.set(
                        'ledgerDirection',
                        v[0]?.desc === false ? 'asc' : 'desc',
                      );
                      p.delete('ledgerPage');
                    })
                  }
                  pageSizeOptions={[10, 20, 50, 100]}
                  emptyMessage={<BudgetEmpty kind='ledger' />}
                />
              )}
            </section>
          </>
        )}
        <Outlet context={context} />
      </div>
    </RecordDetailDrawer>
  );
}
