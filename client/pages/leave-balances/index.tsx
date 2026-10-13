import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import {
  DataTable,
  DataTableServer,
  DataTableColumnHeader,
} from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
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
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { EmployeeSelector, type EmployeeChoice } from './employee-selector.js';
import { useBalanceResource } from './resource.js';
import { BalanceEmpty, BalanceError, BalanceSkeleton } from './states.js';
import {
  BALANCE_SETTINGS,
  type Balance,
  type BalanceContext,
  type Ledger,
  type LeaveType,
  type Page,
} from './types.js';

export default function LeaveBalancesPage() {
  return <BalancePage administration={false} />;
}
export function BalancePage({ administration }: { administration: boolean }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { searchParams, updateParams } = useUrlSearch();
  const permission = useCan({
    resource: { type: 'settings', id: BALANCE_SETTINGS },
    action: 'update',
  });
  const canUpdate =
    administration &&
    permission.can &&
    !permission.isPending &&
    !permission.error;
  const routeParams = useParams();
  const employeeId =
    routeParams.employeeId ?? searchParams.get('employeeId') ?? '';
  const path = administration
    ? employeeId
      ? `leaveBalances/${encodeURIComponent(employeeId)}`
      : null
    : 'leaveBalances/me';
  const balances = useBalanceResource<{ data: Balance[] }>(path);
  const options = useBalanceResource<{ data: { leaveTypes: LeaveType[] } }>(
    'leaveRequests/options',
  );
  const employee = useBalanceResource<{ data: EmployeeChoice }>(
    administration && employeeId
      ? `employees/${encodeURIComponent(employeeId)}`
      : null,
  );
  const types = useMemo(
    () =>
      options.data?.data.leaveTypes.filter(
        (type) => type.active && type.extra?.deductsBalance,
      ) ?? [],
    [options.data],
  );
  const label = useCallback(
    (code: string) => {
      const type = options.data?.data.leaveTypes.find(
        (row) => row.code === code,
      );
      return (
        type?.label[i18n.language] ??
        type?.label['zh-CN'] ??
        type?.label['en-US'] ??
        code
      );
    },
    [options.data, i18n.language],
  );
  const selected =
    routeParams.leaveType ??
    searchParams.get('leaveType') ??
    (administration ? types[0]?.code : balances.data?.data[0]?.leaveType) ??
    '';
  const existingTypes = (balances.data?.data ?? []).map(
    (balance) =>
      options.data?.data.leaveTypes.find(
        (type) => type.code === balance.leaveType,
      ) ?? { code: balance.leaveType, label: {}, active: false },
  );
  const availableTypes = administration
    ? [
        ...types,
        ...existingTypes.filter(
          (type) => !types.some((active) => active.code === type.code),
        ),
      ]
    : existingTypes;
  const validType = availableTypes.some((type) => type.code === selected);
  const adjustableType = types.some((type) => type.code === selected);
  const rawPage = Number(searchParams.get('page') ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const rawSize = Number(searchParams.get('pageSize') ?? 20);
  const pageSize = [10, 20, 50, 100].includes(rawSize) ? rawSize : 20;
  const sortBy = ['at', 'availableDelta', 'heldDelta'].includes(
    searchParams.get('sortBy') ?? '',
  )
    ? searchParams.get('sortBy')!
    : 'at';
  const sortDirection =
    searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc';
  const ledger = useBalanceResource<Page<Ledger>>(
    path && validType ? `${path}/ledger` : null,
    {
      leaveType: selected,
      page: String(page),
      pageSize: String(pageSize),
      sortBy,
      sortDirection,
    },
  );
  const balanceRows = balances.data?.data;
  const reloadBalances = balances.reload,
    reloadOptions = options.reload,
    reloadEmployee = employee.reload,
    reloadLedger = ledger.reload,
    updateBalances = balances.update;
  const refresh = useCallback(() => {
    reloadBalances();
    reloadOptions();
    reloadEmployee();
    reloadLedger();
  }, [reloadBalances, reloadOptions, reloadEmployee, reloadLedger]);
  const onAdjusted = useCallback(
    (balance: Balance) => {
      updateBalances({
        data: [
          ...(balanceRows ?? []).filter(
            (row) => row.leaveType !== balance.leaveType,
          ),
          balance,
        ],
      });
      reloadLedger();
    },
    [balanceRows, updateBalances, reloadLedger],
  );
  const employeeName = employee.data?.data.name ?? employeeId;
  const context = useMemo<BalanceContext>(
    () => ({ employeeId, employeeName, types, onAdjusted }),
    [employeeId, employeeName, types, onAdjusted],
  );
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  });
  const days = (units: number) => number.format(units / 2);
  const selectType = (code: string) =>
    updateParams((params) => {
      params.set('leaveType', code);
      params.delete('page');
    });
  const adjustment = (code: string) => (
    <Link
      to={{
        pathname: `adjust/${encodeURIComponent(employeeId)}/${encodeURIComponent(code)}`,
        search: location.search,
      }}
    >
      {t('leaveBalances.adjust')}
    </Link>
  );
  const columns: ColumnDef<Balance>[] = [
    {
      accessorKey: 'leaveType',
      header: t('leaveBalances.type'),
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          variant='link'
          onClick={() => selectType(row.original.leaveType)}
        >
          <StatusBadge>{label(row.original.leaveType)}</StatusBadge>
        </Button>
      ),
    },
    ...(['availableUnits', 'heldUnits'] as const).map((key) => ({
      accessorKey: key,
      header: ({
        column,
      }: {
        column: import('@tanstack/react-table').Column<Balance, unknown>;
      }) => (
        <DataTableColumnHeader
          column={column}
          title={t(`leaveBalances.${key}`)}
        />
      ),
      cell: ({
        row,
      }: {
        row: import('@tanstack/react-table').Row<Balance>;
      }) => (
        <span className='block text-right tabular-nums'>
          {days(row.original[key])}
        </span>
      ),
    })),
    {
      id: 'actions',
      enableSorting: false,
      header: '',
      cell: ({ row }) =>
        canUpdate &&
        types.some((type) => type.code === row.original.leaveType) ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('leaveBalances.actions', {
                    name: label(row.original.leaveType),
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-auto min-w-40'>
              <DropdownMenuGroup>
                <DropdownMenuItem render={adjustment(row.original.leaveType)} />
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];
  const ledgerColumns: ColumnDef<Ledger>[] = [
    {
      accessorKey: 'at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('leaveBalances.at')} />
      ),
      cell: ({ row }) =>
        new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(row.original.at)),
    },
    {
      accessorKey: 'kind',
      header: t('leaveBalances.kind'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge
          tone={
            row.original.kind === 'grant' || row.original.kind === 'refund'
              ? 'success'
              : row.original.kind === 'hold'
                ? 'info'
                : row.original.kind === 'deduct' ||
                    row.original.kind === 'expire'
                  ? 'warning'
                  : 'neutral'
          }
        >
          {t(`leaveBalances.kinds.${row.original.kind}`)}
        </StatusBadge>
      ),
    },
    ...(['availableDelta', 'heldDelta'] as const).map((key) => ({
      accessorKey: key,
      header: ({
        column,
      }: {
        column: import('@tanstack/react-table').Column<Ledger, unknown>;
      }) => (
        <DataTableColumnHeader
          column={column}
          title={t(`leaveBalances.${key}`)}
        />
      ),
      cell: ({ row }: { row: import('@tanstack/react-table').Row<Ledger> }) => (
        <span className='block text-right tabular-nums'>
          {new Intl.NumberFormat(i18n.language, {
            signDisplay: 'exceptZero',
            maximumFractionDigits: 1,
          }).format(row.original[key] / 2)}
        </span>
      ),
    })),
    {
      accessorKey: 'reference',
      header: t('leaveBalances.reference'),
      enableSorting: false,
      cell: ({ row }) => <TruncatedText text={row.original.reference} />,
    },
    {
      id: 'actor',
      header: t('leaveBalances.actor'),
      enableSorting: false,
      cell: ({ row }) => <UserName name={row.original.actor?.name ?? '—'} />,
    },
    {
      accessorKey: 'reason',
      header: t('leaveBalances.reason'),
      enableSorting: false,
      cell: ({ row }) => <TruncatedText text={row.original.reason ?? '—'} />,
    },
  ];
  const loading =
    balances.loading ||
    options.loading ||
    (administration && !!employeeId && employee.loading);
  const error = balances.error ?? options.error ?? employee.error;
  const rows = balances.data?.data ?? [];
  const ready =
    !!balances.data &&
    !!options.data &&
    !error &&
    (!administration || !!employee.data);
  const canAdjust = canUpdate && ready && !!selected && adjustableType;
  const add = (
    <Button
      nativeButton={!canAdjust}
      disabled={!canAdjust}
      render={
        canAdjust ? (
          <Link
            to={{
              pathname: `adjust/${encodeURIComponent(employeeId)}/${encodeURIComponent(selected)}`,
              search: location.search,
            }}
          />
        ) : undefined
      }
    >
      {t('leaveBalances.adjustBalance')}
    </Button>
  );
  return (
    <PageContainer>
      <PageHeader
        title={t(
          administration ? 'leaveBalances.adminTitle' : 'leaveBalances.title',
        )}
        description={t(
          administration
            ? 'leaveBalances.adminDescription'
            : 'leaveBalances.description',
        )}
      />
      <ApplicationToolbar
        actions={
          <>
            {canUpdate ? add : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('leaveBalances.refresh')}
                    onClick={refresh}
                  />
                }
              >
                <RefreshCw
                  className={
                    loading || ledger.loading ? 'animate-spin' : undefined
                  }
                />
              </TooltipTrigger>
              <TooltipContent>{t('leaveBalances.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      >
        {administration ? (
          <>
            <div data-slot='application-filter' className='flex flex-col gap-2'>
              <Label htmlFor='balance-employee'>
                {t('leaveBalances.employee')}
              </Label>
              <EmployeeSelector
                value={employeeId}
                known={employee.data?.data}
                onChange={(item) =>
                  updateParams((params) => {
                    if (item) params.set('employeeId', item.id);
                    else params.delete('employeeId');
                    params.delete('leaveType');
                    params.delete('page');
                  })
                }
              />
            </div>
            <div data-slot='application-filter' className='flex flex-col gap-2'>
              <Label htmlFor='balance-type'>{t('leaveBalances.type')}</Label>
              <Select
                value={validType ? selected : null}
                items={availableTypes.map((type) => ({
                  value: type.code,
                  label: label(type.code),
                }))}
                onValueChange={(value) => {
                  if (value) selectType(value);
                }}
              >
                <SelectTrigger id='balance-type'>
                  <SelectValue placeholder={t('leaveBalances.selectType')} />
                </SelectTrigger>
                <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                  <SelectGroup>
                    {availableTypes.map((type) => (
                      <SelectItem
                        key={type.code}
                        value={type.code}
                        className='whitespace-normal'
                      >
                        {label(type.code)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            {searchParams.size > 0 ? (
              <Button
                variant='outline'
                onClick={() =>
                  updateParams((params) => {
                    params.delete('employeeId');
                    params.delete('leaveType');
                    params.delete('page');
                    params.delete('pageSize');
                    params.delete('sortBy');
                    params.delete('sortDirection');
                  })
                }
              >
                {t('leaveBalances.clearFilters')}
              </Button>
            ) : null}
          </>
        ) : null}
        {!administration && availableTypes.length > 1 ? (
          <div data-slot='application-filter'>
            <Select
              value={selected}
              items={availableTypes.map((type) => ({
                value: type.code,
                label: label(type.code),
              }))}
              onValueChange={(value) => {
                if (value) selectType(value);
              }}
            >
              <SelectTrigger aria-label={t('leaveBalances.type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                <SelectGroup>
                  {availableTypes.map((type) => (
                    <SelectItem key={type.code} value={type.code}>
                      {label(type.code)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </ApplicationToolbar>
      {error ? (
        <BalanceError error={error} retry={refresh} />
      ) : administration && !employeeId ? (
        <BalanceEmpty kind='employee' />
      ) : !ready ? (
        <BalanceSkeleton />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            showSelectedCount={false}
            getRowId={(row) => row.leaveType}
            emptyMessage={
              <ApplicationTableEmpty
                title={t(
                  `leaveBalances.empty.${administration ? (canUpdate ? 'accounts' : 'readonlyAccounts') : 'mine'}Title`,
                )}
                description={t(
                  `leaveBalances.empty.${administration ? (canUpdate ? 'accounts' : 'readonlyAccounts') : 'mine'}Description`,
                )}
              />
            }
          />
          {administration && !types.length ? (
            <p className='text-sm text-muted-foreground'>
              {t('leaveBalances.noTypes')}
            </p>
          ) : null}
          {administration &&
          validType &&
          !rows.some((row) => row.leaveType === selected) ? (
            <p className='text-sm text-muted-foreground'>
              {t('leaveBalances.unopened', {
                type: label(selected),
                available: days(0),
                held: days(0),
              })}
            </p>
          ) : null}
          {validType ? (
            <section className='flex flex-col gap-4'>
              <h2 className='text-base font-medium'>
                {t('leaveBalances.ledgerTitle', { type: label(selected) })}
              </h2>
              {ledger.error ? (
                <BalanceError error={ledger.error} retry={ledger.reload} />
              ) : !ledger.data ? (
                <BalanceSkeleton />
              ) : (
                <DataTableServer
                  columns={ledgerColumns}
                  rows={ledger.data.data}
                  total={ledger.data.meta.total}
                  getRowId={(row) => row.id}
                  pagination={{ pageIndex: page - 1, pageSize }}
                  onPaginationChange={(next) =>
                    updateParams((params) => {
                      params.set('page', String(next.pageIndex + 1));
                      params.set('pageSize', String(next.pageSize));
                    })
                  }
                  sorting={[{ id: sortBy, desc: sortDirection === 'desc' }]}
                  onSortingChange={(next) =>
                    updateParams((params) => {
                      const sort = next[0];
                      params.set('sortBy', sort?.id ?? 'at');
                      params.set(
                        'sortDirection',
                        sort?.desc === false ? 'asc' : 'desc',
                      );
                      params.delete('page');
                    })
                  }
                  emptyMessage={
                    <ApplicationTableEmpty
                      title={t('leaveBalances.empty.ledgerTitle')}
                      description={t('leaveBalances.empty.ledgerDescription')}
                    />
                  }
                  pageSizeOptions={[10, 20, 50, 100]}
                />
              )}
            </section>
          ) : null}
        </>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}
