import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertCircleIcon, SearchIcon } from 'lucide-react';
import {
  type ReactElement,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { DataTableServer } from '#components/data-table';
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
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';
import { useUrlSearch } from '#hooks/use-url-search';

import type { DirectoryEntry } from './employees/types.js';

const PAGE_SIZES = [20, 50, 100] as const;

interface DirectoryList {
  readonly data: DirectoryEntry[];
  readonly meta: { readonly total: number };
}

/**
 * 通讯录 (`/directory`): active colleagues with department, position, manager and contacts. Phone and email come back
 * only for the people the viewer's `viewContact` scope reaches; the others say "not visible". Sorted by name on the
 * server; no column sorts, since there are no dates or numbers and names cannot be sorted in pinyin order there.
 */
export default function DirectoryPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const { searchParams, search, text, inputProps, updateParams, clear } =
    useUrlSearch({ resetParams: ['page'] });
  const departmentId = searchParams.get('departmentId') ?? '';
  const pageSize =
    PAGE_SIZES.find((size) => String(size) === searchParams.get('pageSize')) ??
    PAGE_SIZES[0];
  const page = Math.max(1, Math.trunc(Number(searchParams.get('page'))) || 1);

  const hasFilters = text.trim() !== '' || departmentId !== '';
  function clearFilters(): void {
    clear((params) => {
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
    departmentId,
    page,
    pageSize,
    reloadCount,
  ]);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly rows?: DirectoryEntry[];
    readonly filtered?: boolean;
    readonly total?: number;
    readonly error?: unknown;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify([
      search,
      departmentId,
      page,
      pageSize,
      reloadCount,
    ]);
    api
      .request<DirectoryList>({
        path: 'directory',
        query: {
          q: search || undefined,
          departmentId: departmentId || undefined,
          page,
          pageSize,
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
            filtered: search !== '' || departmentId !== '',
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
  }, [api, search, departmentId, page, pageSize, reloadCount]);

  const loading = result?.key !== requestKey;
  const error = loading ? undefined : result?.error;
  const rows = result?.rows;
  const rowsFiltered = result?.filtered ?? false;

  const columns = useMemo<ColumnDef<DirectoryEntry>[]>(() => {
    const plain = (value: string | null | undefined): ReactElement => (
      <span className={value ? undefined : 'text-muted-foreground'}>
        {value || '—'}
      </span>
    );
    const contact = (
      value: string | null | undefined,
      present: boolean,
      scheme: 'tel' | 'mailto',
    ): ReactElement => {
      if (!present)
        return (
          <span className='text-muted-foreground'>
            {t('employees.directory.contactHidden')}
          </span>
        );
      if (!value) return plain(null);
      return (
        <a
          href={`${scheme}:${value}`}
          className='whitespace-nowrap underline-offset-4 hover:underline'
        >
          {value}
        </a>
      );
    };
    return [
      {
        id: 'name',
        header: t('employees.fields.name'),
        cell: ({ row }) => (
          <span className='font-medium'>
            <UserName name={row.original.name} />
          </span>
        ),
      },
      {
        id: 'code',
        header: t('employees.fields.code'),
        cell: ({ row }) => row.original.code,
      },
      {
        id: 'department',
        header: t('employees.fields.primaryDepartment'),
        cell: ({ row }) => plain(row.original.primaryDepartment?.title),
      },
      {
        id: 'position',
        header: t('employees.fields.position'),
        cell: ({ row }) => plain(row.original.position?.title),
      },
      {
        id: 'manager',
        header: t('employees.fields.manager'),
        cell: ({ row }) => <UserName name={row.original.manager?.name} />,
      },
      {
        id: 'phone',
        header: t('employees.fields.phone'),
        cell: ({ row }) =>
          contact(row.original.phone, 'phone' in row.original, 'tel'),
      },
      {
        id: 'email',
        header: t('employees.fields.email'),
        cell: ({ row }) =>
          contact(row.original.email, 'email' in row.original, 'mailto'),
      },
      {
        id: 'workLocation',
        header: t('employees.fields.workLocation'),
        cell: ({ row }) => plain(row.original.workLocation),
      },
    ];
  }, [t]);

  let content: ReactElement;
  if (error instanceof ApiClientError && error.status === 401) {
    content = <SessionExpiredAlert />;
  } else if (error) {
    const forbidden = error instanceof ApiClientError && error.status === 403;
    content = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertTitle>{t('employees.directory.errorTitle')}</AlertTitle>
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
    content = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='overflow-hidden rounded-lg border'
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className='flex items-center gap-4 border-b px-4 py-3 last:border-b-0'
          >
            <Skeleton className='h-4 w-24' />
            <Skeleton className='h-4 w-16' />
            <Skeleton className='h-4 w-28' />
            <Skeleton className='ml-auto h-4 w-32' />
          </div>
        ))}
      </div>
    );
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
        emptyMessage={
          <ApplicationTableEmpty
            title={
              rowsFiltered
                ? t('employees.empty.noResults')
                : t('employees.directory.emptyTitle')
            }
            description={
              rowsFiltered
                ? undefined
                : t('employees.directory.emptyDescription')
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
        title={t('employees.directory.title')}
        description={t('employees.directory.description')}
      />
      <ApplicationToolbar>
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
            placeholder={t('employees.directory.searchPlaceholder')}
            aria-label={t('employees.directory.searchLabel')}
          />
        </InputGroup>
        <DepartmentPicker
          value={departmentId}
          onChange={(value) =>
            updateParams((params) => {
              if (value) params.set('departmentId', value);
              else params.delete('departmentId');
              params.delete('page');
            })
          }
          placeholder={t('employees.filters.allDepartments')}
          className='w-full sm:w-56'
        />
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
    </PageContainer>
  );
}
