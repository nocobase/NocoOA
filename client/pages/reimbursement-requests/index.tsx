import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { ReimbursementRowActions } from './row-actions.js';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { FileText, Plus, RefreshCw } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useUrlSearch } from '#hooks/use-url-search';

import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from './states.js';
import { moneyLabel } from './money.js';
import { STATUSES, type ReimbursementRecord } from './types.js';

/** The endpoint returns the complete authorized view. Filter/sort the full result
 * before slicing; no first-page cap is treated as the whole collection. */
export default function ReimbursementsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastClampRef = useRef<string | null>(null);
  const onList = !!useMatch({ path: '/reimbursementRequests', end: true });
  const { searchParams, search, inputProps, updateParams, clear } =
    useUrlSearch({ param: 'search', resetParams: ['page'] });
  const viewValue = searchParams.get('view') ?? 'mine';
  const view = ['mine', 'pending', 'done', 'copied'].includes(viewValue)
    ? viewValue
    : 'mine';
  const statusValue = searchParams.get('status') ?? 'all';
  const status = (STATUSES as readonly string[]).includes(statusValue)
    ? statusValue
    : 'all';
  const sortValue = searchParams.get('sort') ?? 'createdAt';
  const sort = ['number', 'totalCents', 'createdAt'].includes(sortValue)
    ? sortValue
    : 'createdAt';
  const descending = searchParams.get('order') !== 'asc';
  const pageSizeValue = Number(searchParams.get('pageSize'));
  const pageSize = [10, 20, 50, 100].includes(pageSizeValue)
    ? pageSizeValue
    : 20;
  const pageValue = Number(searchParams.get('page'));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const resource = useResource<ReimbursementRecord[]>('reimbursementRequests', {
    view,
  });
  const submit = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'submit',
  });
  const delegate = useCan({
    resource: { type: 'composite', id: 'oa.reimbursement' },
    action: 'delegate',
  });
  const canCreate =
    (!submit.isPending && !submit.error && submit.can) ||
    (!delegate.isPending && !delegate.error && delegate.can);
  const filtered = useMemo(() => {
    const needle = search.toLocaleLowerCase(i18n.language);
    const rows = (resource.data ?? []).filter(
      (row) =>
        (status === 'all' || row.status === status) &&
        [row.number ?? '', row.reason, row.applicant?.name ?? ''].some(
          (value) => value.toLocaleLowerCase(i18n.language).includes(needle),
        ),
    );
    const collator = new Intl.Collator(i18n.language, { numeric: true });
    return rows.sort((left, right) => {
      const value =
        sort === 'totalCents'
          ? left.totalCents - right.totalCents
          : sort === 'number'
            ? collator.compare(left.number ?? '', right.number ?? '')
            : Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return (descending ? -value : value) || left.id.localeCompare(right.id);
    });
  }, [resource.data, search, status, sort, descending, i18n.language]);
  const actualPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / pageSize)),
  );
  useEffect(() => {
    // The list stays mounted beneath record pages. Updating its search there
    // would navigate back to the parent and discard the record being opened.
    const clampKey = `${view}:${location.search}:${actualPage}`;
    if (
      onList &&
      resource.data &&
      page !== actualPage &&
      lastClampRef.current !== clampKey
    ) {
      lastClampRef.current = clampKey;
      updateParams((params) => params.set('page', String(actualPage)));
    }
  }, [
    onList,
    resource.data,
    page,
    actualPage,
    view,
    location.search,
    updateParams,
  ]);

  const outlet = useMemo(
    () => ({
      reload: resource.reload,
      focusList: () => searchInputRef.current?.focus(),
    }),
    [resource.reload],
  );
  const link = useCallback(
    (pathname: string) => ({ pathname, search: location.search }),
    [location.search],
  );
  const create = canCreate ? (
    <Button nativeButton={false} render={<Link to={link('new')} />}>
      <Plus />
      {t('reimbursementRequests.new')}
    </Button>
  ) : null;
  const columns = useMemo<ColumnDef<ReimbursementRecord>[]>(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('reimbursementRequests.number')}
          />
        ),
        cell: RecordNumberCell,
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
        header: t('reimbursementRequests.reason'),
        enableSorting: false,
        cell: ({ row }) => <TruncatedText text={row.original.reason} />,
      },
      {
        accessorKey: 'totalCents',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('reimbursementRequests.gross')}
          />
        ),

        cell: ({ row }) => (
          <span className='block text-right tabular-nums'>
            {moneyLabel(row.original.totalCents, i18n.language)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('approvals.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone={statusTone(row.original.status)}>
            {t(`reimbursementRequests.statuses.${row.original.status}`)}
          </StatusBadge>
        ),
      },
      {
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
          }).format(new Date(row.original.createdAt)),
      },
      {
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => <ReimbursementRowActions record={row.original} />,
      },
    ],
    [t, i18n.language],
  );
  const statusItems = [
    { value: 'all', label: t('reimbursementRequests.allStatuses') },
    ...STATUSES.map((value) => ({
      value,
      label: t(`reimbursementRequests.statuses.${value}`),
    })),
  ];
  const views = ['mine', 'pending', 'done', 'copied'].map((value) => ({
    value,
    label: t(`reimbursementRequests.views.${value}`),
  }));
  const pageRows = useMemo(
    () => filtered.slice((actualPage - 1) * pageSize, actualPage * pageSize),
    [filtered, actualPage, pageSize],
  );
  const empty = resource.data?.length === 0 && !search && status === 'all';
  return (
    <PageContainer>
      <PageHeader
        title={t('reimbursementRequests.title')}
        description={t('reimbursementRequests.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      disabled={resource.loading}
                      aria-label={t('reimbursementRequests.refresh')}
                      onClick={resource.reload}
                    />
                  }
                >
                  <RefreshCw
                    className={resource.loading ? 'animate-spin' : undefined}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t('reimbursementRequests.refresh')}
                </TooltipContent>
              </Tooltip>
            </>
            {create}
          </>
        }
      >
        <ApplicationSearch
          ref={searchInputRef}
          className='sm:max-w-xs'
          placeholder={t('reimbursementRequests.search')}
          aria-label={t('reimbursementRequests.search')}
          {...inputProps}
        />
        <Select
          items={views}
          value={view}
          onValueChange={(value) =>
            updateParams((params) => {
              params.set('view', value ?? 'mine');
              params.delete('page');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('reimbursementRequests.view')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {views.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={statusItems}
          value={status}
          onValueChange={(value) =>
            updateParams((params) => {
              params.set('status', value ?? 'all');
              params.delete('page');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('approvals.status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {statusItems.map((item) => (
                <SelectItem
                  key={item.value}
                  value={item.value}
                  className='whitespace-normal'
                >
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {search || status !== 'all' ? (
          <Button
            variant='ghost'
            onClick={() =>
              clear((params) => {
                params.delete('status');
                params.delete('page');
              })
            }
          >
            {t('reimbursementRequests.clearFilters')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : null}
      {!resource.data ? (
        !resource.error && <ApplicationTableSkeleton columns={columns.length} />
      ) : (
        <DataTableServer
          columns={columns}
          rows={pageRows}
          total={filtered.length}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: actualPage - 1, pageSize }}
          pageSizeOptions={[10, 20, 50, 100]}
          onPaginationChange={(next) =>
            updateParams((params) => {
              params.set('page', String(next.pageIndex + 1));
              params.set('pageSize', String(next.pageSize));
            })
          }
          sorting={[{ id: sort, desc: descending }]}
          onSortingChange={(next) =>
            updateParams((params) => {
              params.set('sort', next[0]?.id ?? 'createdAt');
              params.set('order', next[0]?.desc ? 'desc' : 'asc');
              params.delete('page');
            })
          }
          emptyMessage={
            empty ? (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <FileText />
                  </EmptyMedia>
                  <EmptyTitle>
                    <h2>{t('reimbursementRequests.emptyTitle')}</h2>
                  </EmptyTitle>
                  <EmptyDescription>
                    {t('reimbursementRequests.emptyDescription')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              t('reimbursementRequests.noResults')
            )
          }
        />
      )}
      <Outlet context={outlet} />
    </PageContainer>
  );
}

/** A query normalization may commit between pointer-down and click. Keep the
 * cell component identity stable so the targeted anchor survives that update. */
function RecordNumberCell({ row }: CellContext<ReimbursementRecord, unknown>) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <Link
      to={{ pathname: row.original.id, search: location.search }}
      className='font-medium hover:underline'
    >
      {row.original.number ?? t('approvals.draft')}
    </Link>
  );
}
