import { approvalStatusTone } from '../approvals/status-tone.js';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, MoreHorizontal, FileText } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { TruncatedText } from '#components/truncated-text';
import { StatusBadge } from '#components/status-badge';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { useUrlSearch } from '#hooks/use-url-search';

import { ErrorState } from './states.js';
import { useLoanResource } from './resource.js';
import { amountText } from './money.js';
import type { LoanRequestRecord } from './types.js';
const states = [
  'draft',
  'revision',
  'manager',
  'head',
  'finance',
  'executive',
  'gm',
  'cashier',
  'exception',
  'paid',
  'rejected',
  'withdrawn',
  'terminated',
];
export default function LoansPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { searchParams, updateParams, inputProps, clear } = useUrlSearch({
    param: 'search',
    resetParams: ['page'],
  });
  const permission = useCan({
    resource: { type: 'composite', id: 'oa.loan' },
    action: 'submit',
  });
  const canCreate =
    permission.can && !permission.isPending && !permission.error;
  const numberPage = Number(searchParams.get('page'));
  const page =
    Number.isSafeInteger(numberPage) && numberPage > 0 ? numberPage : 1;
  const pageSize = [10, 20, 50, 100].includes(
    Number(searchParams.get('pageSize')),
  )
    ? Number(searchParams.get('pageSize'))
    : 20;
  const sort = ['createdAt', 'number', 'amountCents', 'dueDate'].includes(
    searchParams.get('sort') ?? '',
  )
    ? searchParams.get('sort')!
    : 'createdAt';
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const status = states.includes(searchParams.get('status') ?? '')
    ? searchParams.get('status')!
    : 'all';
  const view = ['mine', 'pending', 'done', 'copied'].includes(
    searchParams.get('view') ?? '',
  )
    ? searchParams.get('view')!
    : 'mine';
  const r = useLoanResource<{
    data: LoanRequestRecord[];
    meta: { page: number; pageSize: number; total: number };
  }>('loanRequests', {
    page: String(page),
    pageSize: String(pageSize),
    sort,
    order,
    view,
    search: searchParams.get('search') ?? '',
    ...(status === 'all' ? {} : { status }),
  });
  useEffect(() => {
    if (r.data && r.data.meta.page !== page)
      updateParams((p) => {
        p.set('page', String(r.data!.meta.page));
      });
  }, [r.data, page, updateParams]);
  const link = (path: string) => ({ pathname: path, search: location.search });
  const create = canCreate ? (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <Plus />
      {t('loanRequests.new')}
    </Button>
  ) : null;
  const columns: ColumnDef<LoanRequestRecord>[] = [
    {
      accessorKey: 'number',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('loanRequests.number')}
        />
      ),
      cell: ({ row }) => (
        <Link
          to={link(row.original.id)}
          className='font-medium hover:underline'
        >
          {row.original.number ?? t('approvals.draft')}
        </Link>
      ),
    },
    {
      id: 'applicant',
      header: t('approvals.applicant'),
      enableSorting: false,
      cell: ({ row }) => (
        <UserName
          name={row.original.applicant?.name ?? t('approvals.unknownPerson')}
        />
      ),
    },
    {
      accessorKey: 'reason',
      header: t('loanRequests.reason'),
      enableSorting: false,
      cell: ({ row }) => <TruncatedText text={row.original.reason} />,
    },
    {
      accessorKey: 'amountCents',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('loanRequests.amount')}
        />
      ),
      cell: ({ row }) => (
        <span className='block text-right tabular-nums'>
          {amountText(row.original.amountCents)}
        </span>
      ),
    },
    {
      accessorKey: 'dueDate',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('loanRequests.dueDate')}
        />
      ),
    },
    {
      id: 'status',
      header: t('loanRequests.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone={approvalStatusTone(row.original.status, 'oa.loan')}>
          {t(`loanRequests.states.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size='icon'
                variant='ghost'
                aria-label={t('loanRequests.more')}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-40'>
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to={link(row.original.id)} />}>
                {t('approvals.detail')}
              </DropdownMenuItem>
              {canCreate &&
              ['draft', 'revision'].includes(row.original.status) ? (
                <DropdownMenuItem
                  render={<Link to={link(`edit/${row.original.id}`)} />}
                >
                  {t('approvals.edit')}
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
        title={t('loanRequests.title')}
        description={t('loanRequests.emptyHint')}
      />
      <ApplicationToolbar
        actions={
          <>
            <>
              <ApplicationRefreshButton
                label={t('loanRequests.refresh')}
                loading={r.loading}
                onClick={r.reload}
              />
            </>
            {create}
          </>
        }
      >
        <ApplicationSearch
          id='loan-search'
          className='sm:max-w-xs'
          placeholder={t('loanRequests.search')}
          aria-label={t('loanRequests.search')}
          {...inputProps}
        />
        <Select
          items={['mine', 'pending', 'done', 'copied'].map((value) => ({
            value,
            label: t(`approvals.tabs.${value === 'pending' ? 'todo' : value}`),
          }))}
          value={view}
          onValueChange={(v) =>
            updateParams((p) => {
              p.delete('page');
              p.set('view', v ?? 'mine');
            })
          }
        >
          <SelectTrigger
            id='loan-view'
            className='w-full sm:w-40'
            aria-label={t('loanRequests.view')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {['mine', 'pending', 'done', 'copied'].map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`approvals.tabs.${v === 'pending' ? 'todo' : v}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={[
            { value: 'all', label: t('loanRequests.allStatuses') },
            ...states.map((value) => ({
              value,
              label: t(`loanRequests.states.${value}`),
            })),
          ]}
          value={status}
          onValueChange={(v) =>
            updateParams((p) => {
              p.delete('page');
              if (!v || v === 'all') p.delete('status');
              else p.set('status', v);
            })
          }
        >
          <SelectTrigger
            id='loan-status'
            className='w-full sm:w-40'
            aria-label={t('loanRequests.status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              <SelectItem value='all'>
                {t('loanRequests.allStatuses')}
              </SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`loanRequests.states.${s}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {inputProps.value || status !== 'all' ? (
          <Button
            variant='ghost'
            onClick={() => {
              clear((p) => {
                p.delete('status');
                p.delete('page');
              });
              document.getElementById('loan-search')?.focus();
            }}
          >
            {t('loanRequests.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <ErrorState error={r.error} retry={r.reload} /> : null}
      {!r.data ? (
        !r.error && <ApplicationTableSkeleton columns={columns.length} />
      ) : (
        <DataTableServer
          columns={columns}
          rows={r.data.data}
          total={r.data.meta.total}
          getRowId={(v) => v.id}
          pagination={{ pageIndex: r.data.meta.page - 1, pageSize }}
          onPaginationChange={(v) =>
            updateParams((p) => {
              p.set('page', String(v.pageIndex + 1));
              p.set('pageSize', String(v.pageSize));
            })
          }
          sorting={[{ id: sort, desc: order === 'desc' }]}
          onSortingChange={(v) =>
            updateParams((p) => {
              p.set('sort', v[0]?.id ?? 'createdAt');
              p.set('order', v[0]?.desc === false ? 'asc' : 'desc');
              p.delete('page');
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={
            searchParams.get('search') || status !== 'all' ? (
              t('loanRequests.filteredEmpty')
            ) : (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>{t('loanRequests.empty')}</EmptyTitle>
                  <EmptyDescription>
                    {t('loanRequests.emptyHint')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          }
        />
      )}
      <Outlet context={{ reload: r.reload }} />
    </PageContainer>
  );
}
