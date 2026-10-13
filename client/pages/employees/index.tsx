import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef, ColumnSort } from '@tanstack/react-table';
import { AlertCircleIcon, PlusIcon, SearchIcon } from 'lucide-react';
import {
  type ReactElement,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { DataTableColumnHeader, DataTableServer } from '#components/data-table';
import { DepartmentPicker } from '#components/department-picker';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '#components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { useUrlSearch } from '#hooks/use-url-search';

import { EmployeeStatusBadge } from './status-badge.js';
import {
  ARCHIVE,
  EMPLOYEE_STATUSES,
  type Employee,
  type EmployeeList,
  type EmployeeStatus,
  type EmployeesOutletContext,
} from './types.js';

const PAGE_SIZES = [10, 20, 50] as const;
// The columns the endpoint sorts by. The name is not among them: the database cannot sort it in pinyin order.
const SORTABLE = ['code', 'hireDate', 'updatedAt'] as const;
const DEFAULT_SORT: ColumnSort = { id: 'updatedAt', desc: true };

function isStatus(value: string | null): value is EmployeeStatus {
  return EMPLOYEE_STATUSES.some((status) => status === value);
}

function parseOrderBy(value: string | null): ColumnSort {
  const [field, direction, ...rest] = (value ?? '').trim().split(/\s+/u);
  const id = SORTABLE.find((column) => column === field);
  const desc = direction === 'desc';
  const valid =
    rest.length === 0 &&
    (direction === undefined || desc || direction === 'asc');
  return id && valid ? { id, desc } : DEFAULT_SORT;
}

function formatOrderBy(column: ColumnSort): string {
  return column.desc ? `${column.id} desc` : column.id;
}

/** Settings → 组织与人员 → 员工档案 (`/employees`): the archive list. */
export default function EmployeesPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const canManage = useCan({ resource: ARCHIVE, action: 'manage' }).can;

  const { searchParams, search, text, inputProps, updateParams, clear } =
    useUrlSearch({ resetParams: ['page'] });
  const statusParam = searchParams.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const departmentId = searchParams.get('departmentId') ?? '';
  const pageSize =
    PAGE_SIZES.find((size) => String(size) === searchParams.get('pageSize')) ??
    PAGE_SIZES[0];
  const page = Math.max(1, Math.trunc(Number(searchParams.get('page'))) || 1);
  const columnSort = parseOrderBy(searchParams.get('orderBy'));
  const orderBy = formatOrderBy(columnSort);

  function setFilter(name: string, value: string | null): void {
    updateParams((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
      params.delete('page');
    });
  }

  const hasFilters =
    text.trim() !== '' || status !== undefined || departmentId !== '';

  function clearFilters(): void {
    clear((params) => {
      params.delete('status');
      params.delete('departmentId');
      params.delete('page');
    });
    searchRef.current?.focus();
  }

  const goToPage = useEffectEvent((target: number) => {
    updateParams((params) => params.set('page', String(target)));
  });

  const [reloadCount, reload] = useReducer((count: number) => count + 1, 0);
  const requestKey = JSON.stringify([
    search,
    status ?? null,
    departmentId,
    page,
    pageSize,
    orderBy,
    reloadCount,
  ]);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly rows?: Employee[];
    readonly filtered?: boolean;
    readonly error?: unknown;
    readonly total?: number;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify([
      search,
      status ?? null,
      departmentId,
      page,
      pageSize,
      orderBy,
      reloadCount,
    ]);
    api
      .request<EmployeeList>({
        path: 'employees',
        query: {
          q: search || undefined,
          status,
          departmentId: departmentId || undefined,
          page,
          pageSize,
          orderBy,
        },
        signal: controller.signal,
      })
      .then(
        ({ data, meta }) => {
          if (controller.signal.aborted) return;
          setResult({
            key,
            rows: data,
            total: meta.total,
            filtered:
              search !== '' || status !== undefined || departmentId !== '',
          });
          const lastPage = Math.max(1, Math.ceil(meta.total / pageSize));
          if (data.length === 0 && page > lastPage) goToPage(lastPage);
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, search, status, departmentId, page, pageSize, orderBy, reloadCount]);

  const loading = result?.key !== requestKey;
  const error = loading ? undefined : result?.error;
  const rows = result?.rows;
  const rowsFiltered = result?.filtered ?? false;

  const outletContext = useMemo<EmployeesOutletContext>(
    () => ({ reload }),
    [reload],
  );

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const statusItems = [
    { value: 'all', label: t('employees.filters.allStatuses') },
    ...EMPLOYEE_STATUSES.map((value) => ({
      value,
      label: t(`employees.status.${value}`),
    })),
  ];

  const columns = useMemo<ColumnDef<Employee>[]>(() => {
    const muted = (value: string | null | undefined): ReactElement => (
      <span className={value ? 'truncate' : 'text-muted-foreground'}>
        {value || '—'}
      </span>
    );
    return [
      {
        id: 'name',
        enableSorting: false,
        header: t('employees.fields.name'),
        cell: ({ row }) => (
          <Link
            to={{
              pathname: encodeURIComponent(row.original.id),
              search: location.search,
            }}
            className='font-medium hover:underline'
          >
            <UserName name={row.original.name} />
          </Link>
        ),
      },
      {
        id: 'code',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('employees.fields.code')}
          />
        ),
        cell: ({ row }) => row.original.code,
      },
      {
        id: 'primaryDepartment',
        enableSorting: false,
        header: t('employees.fields.primaryDepartment'),
        cell: ({ row }) => muted(row.original.primaryDepartment?.title),
      },
      {
        id: 'position',
        enableSorting: false,
        header: t('employees.fields.position'),
        cell: ({ row }) => muted(row.original.position?.title),
      },
      {
        id: 'status',
        enableSorting: false,
        header: t('employees.fields.status'),
        cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
      },
      {
        id: 'hireDate',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('employees.fields.hireDate')}
          />
        ),
        cell: ({ row }) =>
          row.original.hireDate ? (
            <span className='whitespace-nowrap'>
              {dateFormat.format(new Date(`${row.original.hireDate}T00:00:00`))}
            </span>
          ) : (
            muted(null)
          ),
      },
      {
        id: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('employees.fields.updatedAt')}
          />
        ),
        cell: ({ row }) =>
          row.original.updatedAt ? (
            <span className='whitespace-nowrap text-muted-foreground'>
              {timeFormat.format(new Date(row.original.updatedAt))}
            </span>
          ) : (
            muted(null)
          ),
      },
    ];
  }, [dateFormat, timeFormat, location.search, t]);

  const createButton = (
    <Button
      render={<Link to={{ pathname: 'new', search: location.search }} />}
      nativeButton={false}
    >
      <PlusIcon data-icon='inline-start' />
      {t('employees.create.action')}
    </Button>
  );

  let content: ReactElement;
  if (error instanceof ApiClientError && error.status === 401) {
    content = <SessionExpiredAlert />;
  } else if (error) {
    const forbidden = error instanceof ApiClientError && error.status === 403;
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('employees.error.title')}</AlertTitle>
        <AlertDescription>
          {forbidden
            ? t('employees.error.forbidden')
            : t('employees.error.requestFailed')}
        </AlertDescription>
        {forbidden ? null : (
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                reload();
                searchRef.current?.focus();
              }}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        )}
      </Alert>
    );
  } else if (rows === undefined) {
    content = <TableSkeleton label={t('status.loading')} />;
  } else {
    content = (
      <DataTableServer
        columns={columns}
        rows={rows}
        total={result?.total ?? 0}
        getRowId={(row) => row.id}
        pagination={{ pageIndex: page - 1, pageSize }}
        pageSizeOptions={PAGE_SIZES}
        onPaginationChange={(next) => {
          updateParams((params) => {
            params.set('page', String(next.pageIndex + 1));
            params.set('pageSize', String(next.pageSize));
          });
        }}
        sorting={[columnSort]}
        onSortingChange={(next) => {
          const column = next.at(0);
          updateParams((params) => {
            if (column) params.set('orderBy', formatOrderBy(column));
            else params.delete('orderBy');
            params.delete('page');
          });
        }}
        emptyMessage={
          <ApplicationTableEmpty
            title={t(
              rowsFiltered
                ? 'employees.empty.noResults'
                : 'employees.empty.title',
            )}
            description={
              rowsFiltered
                ? undefined
                : t(
                    canManage
                      ? 'employees.empty.description'
                      : 'employees.empty.descriptionReadOnly',
                  )
            }
            clearFilters={
              rowsFiltered
                ? { label: t('employees.filters.clear'), onClick: clearFilters }
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
        title={t('employees.title')}
        description={t('employees.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('employees.refresh')}
              loading={loading}
              onClick={reload}
            />
            {canManage ? createButton : null}
          </>
        }
      >
        <InputGroup
          data-slot='application-search'
          className='w-full sm:max-w-xs'
        >
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            {...inputProps}
            placeholder={t('employees.search.placeholder')}
            aria-label={t('employees.search.label')}
          />
        </InputGroup>
        <DepartmentPicker
          value={departmentId}
          onChange={(value) => setFilter('departmentId', value || null)}
          placeholder={t('employees.filters.allDepartments')}
          className='w-full sm:w-56'
        />
        <Select
          items={statusItems}
          value={status ?? 'all'}
          onValueChange={(value) =>
            setFilter('status', value && value !== 'all' ? value : null)
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('employees.filters.status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button variant='ghost' onClick={clearFilters}>
            {t('employees.filters.clear')}
          </Button>
        ) : null}
        {loading && rows !== undefined ? (
          <Spinner className='text-muted-foreground' />
        ) : null}
      </ApplicationToolbar>
      {content}
      {/* The create page and the employee page cover this one and refresh it through the context. */}
      <Outlet context={outletContext} />
    </PageContainer>
  );
}

function TableSkeleton({ label }: { readonly label: string }): ReactElement {
  return (
    <div
      role='status'
      aria-label={label}
      className='overflow-hidden rounded-lg border'
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className='flex items-center gap-4 border-b px-4 py-3 last:border-b-0'
        >
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-4 w-24' />
          <Skeleton className='h-5 w-16 rounded-full' />
          <Skeleton className='ml-auto h-4 w-28' />
        </div>
      ))}
    </div>
  );
}
