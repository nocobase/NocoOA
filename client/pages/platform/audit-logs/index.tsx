import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  addDays,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { ChevronDownIcon, RefreshCwIcon } from 'lucide-react';
import { type ReactElement, useMemo, useRef } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { DataTableServer } from '#components/data-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
import { DateRangePicker, type DateRange } from '#components/date-picker';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { UserPicker } from '#components/user-picker';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';

import { LoadErrorAlert, TableSkeleton } from '../shared/states.js';
import { TruncatedText } from '../shared/truncated-text.js';
import type { AuditLog, PageMeta } from '../shared/types.js';
import {
  PAGE_SIZE_OPTIONS,
  paginationOf,
  writePagination,
} from '../shared/url-pagination.js';
import { useListResource, useResource } from '../shared/use-resource.js';

const FILTER_PARAMS = [
  'targetType',
  'action',
  'actorId',
  'from',
  'to',
] as const;
const ALL = '__all__';
const SELECT_CONTENT_CLASS =
  'w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal';
const PRESETS = [
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'last90',
] as const;

function presetRange(preset: (typeof PRESETS)[number]): {
  from: Date;
  to: Date;
} {
  const today = startOfDay(new Date());
  switch (preset) {
    case 'last7':
      return { from: subDays(today, 6), to: today };
    case 'last30':
      return { from: subDays(today, 29), to: today };
    case 'thisMonth':
      return { from: startOfMonth(today), to: today };
    case 'lastMonth': {
      const last = subMonths(today, 1);
      return { from: startOfMonth(last), to: startOfDay(endOfMonth(last)) };
    }
    case 'last90':
      return { from: subDays(today, 89), to: today };
  }
}

function localDateParam(
  params: URLSearchParams,
  name: string,
): Date | undefined {
  const value = params.get(name);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Route /audit-logs: the sensitive operations recorded by every module, read-only and filtered on the server.
 * The date range is local days in the URL (`from`, `to`), sent as the instants that bound them.
 */
export default function AuditLogsPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const firstFilterRef = useRef<HTMLButtonElement>(null);
  const pagination = paginationOf(searchParams);
  const targetType = searchParams.get('targetType') ?? '';
  const action = searchParams.get('action') ?? '';
  const actorId = searchParams.get('actorId') ?? '';
  const from = localDateParam(searchParams, 'from');
  const to = localDateParam(searchParams, 'to');
  const ascending = searchParams.get('orderBy') === 'at';
  const sorting: SortingState = [{ id: 'at', desc: !ascending }];
  const hasFilters = FILTER_PARAMS.some((name) => searchParams.has(name));

  function update(mutate: (params: URLSearchParams) => void): void {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }
  function setFilter(name: string, value: string | undefined): void {
    update((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
      params.delete('page');
    });
  }
  function setRange(range: DateRange | undefined): void {
    update((params) => {
      if (range?.from) params.set('from', format(range.from, 'yyyy-MM-dd'));
      else params.delete('from');
      if (range?.to ?? range?.from)
        params.set('to', format((range?.to ?? range?.from)!, 'yyyy-MM-dd'));
      else params.delete('to');
      params.delete('page');
    });
  }
  function clearFilters(): void {
    update((params) => {
      for (const name of FILTER_PARAMS) params.delete(name);
      params.delete('page');
    });
    firstFilterRef.current?.focus();
  }

  const facets = useResource<{ targetTypes: string[]; actions: string[] }>(
    'auditLogs/facets',
  );
  const logs = useListResource<AuditLog, PageMeta>('auditLogs', {
    targetType: targetType || undefined,
    action: action || undefined,
    actorId: actorId || undefined,
    from: from ? startOfDay(from).toISOString() : undefined,
    to: to ? addDays(startOfDay(to), 1).toISOString() : undefined,
    orderBy: ascending ? 'at' : '-at',
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  });
  const body = logs.data;
  const knownActors = useMemo(
    () =>
      (body?.data ?? [])
        .filter((log) => log.actorId && log.actorName)
        .map((log) => ({ id: log.actorId!, name: log.actorName! })),
    [body],
  );

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }),
    [locale],
  );

  const columns = useMemo<ColumnDef<AuditLog>[]>(
    () => [
      {
        id: 'at',
        accessorKey: 'at',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('platform.auditLogs.fields.at')}
          />
        ),
        cell: ({ row }) => (
          <Link
            to={{ pathname: row.original.id, search: location.search }}
            className='font-medium whitespace-nowrap hover:underline'
          >
            {dateFormat.format(new Date(row.original.at))}
          </Link>
        ),
      },
      {
        id: 'actor',
        enableSorting: false,
        header: t('platform.auditLogs.fields.actor'),
        cell: ({ row }) =>
          row.original.actorName ?? (
            <span className='text-muted-foreground'>
              {row.original.actorId
                ? row.original.actorId
                : t('platform.auditLogs.system')}
            </span>
          ),
      },
      {
        id: 'action',
        enableSorting: false,
        header: t('platform.auditLogs.fields.action'),
        cell: ({ row }) => (
          <Badge variant='outline'>{row.original.action}</Badge>
        ),
      },
      {
        id: 'targetType',
        enableSorting: false,
        header: t('platform.auditLogs.fields.targetType'),
        cell: ({ row }) => (
          <code className='text-xs'>{row.original.targetType}</code>
        ),
      },
      {
        id: 'targetId',
        enableSorting: false,
        header: t('platform.auditLogs.fields.targetId'),
        cell: ({ row }) =>
          row.original.targetId ? (
            <TruncatedText text={row.original.targetId} className='max-w-40' />
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        id: 'reason',
        enableSorting: false,
        header: t('platform.auditLogs.fields.reason'),
        cell: ({ row }) =>
          row.original.reason ? (
            <TruncatedText text={row.original.reason} />
          ) : (
            <span className='text-muted-foreground'>—</span>
          ),
      },
    ],
    [dateFormat, location.search, t],
  );

  const targetTypeItems = [
    { value: ALL, label: t('platform.auditLogs.filters.allTargetTypes') },
    ...(facets.data?.targetTypes ?? []).map((value) => ({
      value,
      label: value,
    })),
  ];
  const actionItems = [
    { value: ALL, label: t('platform.auditLogs.filters.allActions') },
    ...(facets.data?.actions ?? []).map((value) => ({ value, label: value })),
  ];

  let content: ReactElement;
  if (logs.error) {
    content = (
      <LoadErrorAlert
        error={logs.error}
        title={t('platform.auditLogs.loadFailedTitle')}
        onRetry={logs.reload}
      />
    );
  } else if (!body) {
    content = <TableSkeleton columns={5} />;
  } else {
    content = (
      <DataTableServer
        columns={columns}
        rows={body.data}
        total={body.meta.total}
        getRowId={(row) => row.id}
        pagination={pagination}
        onPaginationChange={(next) =>
          update((params) => writePagination(params, next))
        }
        sorting={sorting}
        onSortingChange={(next) =>
          update((params) => {
            if (next[0] && !next[0].desc) params.set('orderBy', 'at');
            else params.delete('orderBy');
            params.delete('page');
          })
        }
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        emptyMessage={
          <ApplicationTableEmpty
            title={t(
              hasFilters
                ? 'platform.common.noResults'
                : 'platform.auditLogs.empty.title',
            )}
            description={
              hasFilters ? undefined : t('platform.auditLogs.empty.description')
            }
            clearFilters={
              hasFilters
                ? {
                    label: t('platform.common.clearFilters'),
                    onClick: clearFilters,
                  }
                : undefined
            }
          />
        }
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('platform.auditLogs.title')}
        description={t('platform.auditLogs.description')}
      />
      <ApplicationToolbar
        actions={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  aria-label={t('platform.common.refresh')}
                  onClick={() => {
                    logs.reload();
                    facets.reload();
                  }}
                />
              }
            >
              <RefreshCwIcon
                className={logs.loading && body ? 'animate-spin' : undefined}
              />
            </TooltipTrigger>
            <TooltipContent>{t('platform.common.refresh')}</TooltipContent>
          </Tooltip>
        }
      >
        <Select
          items={targetTypeItems}
          value={targetType || ALL}
          onValueChange={(value) =>
            setFilter(
              'targetType',
              value === ALL ? undefined : (value ?? undefined),
            )
          }
        >
          <SelectTrigger
            ref={firstFilterRef}
            className='w-full sm:w-44'
            aria-label={t('platform.auditLogs.fields.targetType')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            <SelectGroup>
              {targetTypeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={actionItems}
          value={action || ALL}
          onValueChange={(value) =>
            setFilter(
              'action',
              value === ALL ? undefined : (value ?? undefined),
            )
          }
        >
          <SelectTrigger
            className='w-full sm:w-44'
            aria-label={t('platform.auditLogs.fields.action')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            <SelectGroup>
              {actionItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className='w-full sm:w-56'>
          <UserPicker
            value={actorId}
            onChange={(value) => setFilter('actorId', value || undefined)}
            knownUsers={knownActors}
            placeholder={t('platform.auditLogs.filters.actor')}
            includeDisabled
          />
        </div>
        <DateRangePicker
          value={from ? { from, to } : undefined}
          onChange={setRange}
          placeholder={t('platform.auditLogs.filters.dateRange')}
          className='w-full sm:w-72'
        />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant='outline' />}>
            {t('platform.auditLogs.filters.presets')}
            <ChevronDownIcon data-icon='inline-end' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            <DropdownMenuGroup>
              {PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  onClick={() => setRange(presetRange(preset))}
                >
                  {t(`platform.auditLogs.presets.${preset}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {hasFilters ? (
          <Button variant='ghost' onClick={clearFilters}>
            {t('platform.common.clearFilters')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {content}
      <Outlet />
    </PageContainer>
  );
}
