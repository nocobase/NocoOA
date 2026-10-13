import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type {
  ColumnDef,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import {
  ChevronDownIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { type ReactElement, useMemo, useRef } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { DataTableServer } from '#components/data-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
import { cn } from 'cn';

import { useTemplateDownload } from './download.js';
import { LoadErrorAlert, TableSkeleton } from './states.js';
import {
  IMPORT_KINDS,
  IMPORT_SETTINGS,
  type ImportKind,
  type ImportOutletContext,
  type ImportRun,
  type PageMeta,
} from './types.js';
import { useListResource } from './use-resource.js';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const ALL = '__all__';
const SELECT_CONTENT_CLASS =
  'w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal';

function paginationOf(params: URLSearchParams): PaginationState {
  const page = Number(params.get('page'));
  const size = Number(params.get('pageSize'));
  return {
    pageIndex: Number.isInteger(page) && page > 1 ? page - 1 : 0,
    pageSize: (PAGE_SIZE_OPTIONS as readonly number[]).includes(size)
      ? size
      : PAGE_SIZE_OPTIONS[0],
  };
}

function kindOf(params: URLSearchParams): ImportKind | undefined {
  const kind = params.get('kind');
  return (IMPORT_KINDS as readonly string[]).includes(kind ?? '')
    ? (kind as ImportKind)
    : undefined;
}

/** Text in a table cell that ends in an ellipsis, with the full text in a tooltip only when cut off (T1.11). */
function TruncatedText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}): ReactElement {
  return (
    <Tooltip
      onOpenChange={(open, details) => {
        const trigger = details.trigger;
        if (open && trigger && trigger.scrollWidth <= trigger.clientWidth)
          details.cancel();
      }}
    >
      <TooltipTrigger
        render={<span className={cn('block max-w-60 truncate', className)} />}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent className='max-w-sm whitespace-normal wrap-anywhere'>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Route /import: the Excel import of the organisation (OA plan 01 §9). The history of committed attempts,
 * newest first, filtered by kind in the URL; checking and importing a file is the `new` dialog, an attempt's details
 * the `:runId` drawer. Template downloads stay in the header so a reader can fetch them without importing.
 */
export default function ImportPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterRef = useRef<HTMLButtonElement>(null);
  const downloadTemplate = useTemplateDownload();
  const update = useCan({
    resource: { type: 'settings', id: IMPORT_SETTINGS },
    action: 'update',
  });
  const canImport = update.can && !update.isPending && !update.error;

  const pagination = paginationOf(searchParams);
  const kind = kindOf(searchParams);
  const ascending = searchParams.get('order') === 'asc';
  const sorting: SortingState = [{ id: 'createdAt', desc: !ascending }];

  function updateParams(mutate: (params: URLSearchParams) => void): void {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }
  function clearFilters(): void {
    updateParams((params) => {
      params.delete('kind');
      params.delete('page');
    });
    filterRef.current?.focus();
  }

  const runs = useListResource<ImportRun, PageMeta>('imports', {
    kind,
    order: ascending ? 'asc' : undefined,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  });
  const { reload } = runs;
  const outletContext = useMemo<ImportOutletContext>(
    () => ({ reload }),
    [reload],
  );
  const body = runs.data;

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );

  const columns = useMemo<ColumnDef<ImportRun>[]>(
    () => [
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('import.fields.createdAt')}
          />
        ),
        cell: ({ row }) => (
          <Link
            to={{ pathname: row.original.id, search: location.search }}
            className='font-medium whitespace-nowrap hover:underline'
          >
            {dateFormat.format(new Date(row.original.createdAt))}
          </Link>
        ),
      },
      {
        id: 'kind',
        enableSorting: false,
        header: t('import.fields.kind'),
        cell: ({ row }) => (
          <Badge variant='outline'>
            {t(`import.kinds.${row.original.kind}`)}
          </Badge>
        ),
      },
      {
        id: 'filename',
        enableSorting: false,
        header: t('import.fields.file'),
        cell: ({ row }) => <TruncatedText text={row.original.filename} />,
      },
      {
        id: 'status',
        enableSorting: false,
        header: t('import.fields.status'),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.status === 'succeeded' ? 'secondary' : 'destructive'
            }
          >
            {t(`import.status.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        id: 'summary',
        enableSorting: false,
        header: t('import.fields.summary'),
        cell: ({ row }) => (
          <span className='whitespace-nowrap text-muted-foreground'>
            {row.original.status === 'succeeded'
              ? t('import.summary.succeeded', {
                  created: row.original.createdCount,
                  updated: row.original.updatedCount,
                  unchanged: row.original.unchangedCount,
                })
              : t('import.summary.failed', {
                  count: row.original.errorCount,
                })}
          </span>
        ),
      },
      {
        id: 'actor',
        enableSorting: false,
        header: t('import.fields.actor'),
        cell: ({ row }) => <UserName name={row.original.actor?.name ?? '—'} />,
      },
      {
        id: 'download',
        enableSorting: false,
        enableHiding: false,
        header: () => (
          <span className='sr-only'>{t('import.actions.downloadFile')}</span>
        ),
        cell: ({ row }) =>
          row.original.file ? (
            <div className='flex justify-end'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      nativeButton={false}
                      aria-label={t('import.actions.downloadFile')}
                      render={
                        <a
                          href={row.original.file.contentUrl}
                          download={row.original.filename}
                        />
                      }
                    />
                  }
                >
                  <DownloadIcon />
                </TooltipTrigger>
                <TooltipContent>
                  {t('import.actions.downloadFile')}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null,
      },
    ],
    [dateFormat, location.search, t],
  );

  const kindItems = [
    { value: ALL, label: t('import.filters.allKinds') },
    ...IMPORT_KINDS.map((value) => ({
      value,
      label: t(`import.kinds.${value}`),
    })),
  ];

  const newImport = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon data-icon='inline-start' />
      {t('import.actions.new')}
    </Button>
  );

  // The history is empty when nothing was ever imported; a kind filter that matches nothing is "no results" (S3).
  const empty = body !== undefined && body.meta.total === 0 && !kind;
  let content: ReactElement;
  if (runs.error) {
    content = (
      <LoadErrorAlert
        error={runs.error}
        title={t('import.loadFailedTitle')}
        onRetry={runs.reload}
      />
    );
  } else if (!body) {
    content = <TableSkeleton columns={6} />;
  } else {
    content = (
      <DataTableServer
        columns={columns}
        rows={body.data}
        total={body.meta.total}
        getRowId={(row) => row.id}
        pagination={pagination}
        onPaginationChange={(next) =>
          updateParams((params) => {
            if (next.pageIndex > 0)
              params.set('page', String(next.pageIndex + 1));
            else params.delete('page');
            if (next.pageSize !== PAGE_SIZE_OPTIONS[0])
              params.set('pageSize', String(next.pageSize));
            else params.delete('pageSize');
          })
        }
        sorting={sorting}
        onSortingChange={(next) =>
          updateParams((params) => {
            if (next[0] && !next[0].desc) params.set('order', 'asc');
            else params.delete('order');
            params.delete('page');
          })
        }
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        emptyMessage={
          <ApplicationTableEmpty
            title={!empty ? t('import.noResults') : t('import.empty.title')}
            description={
              !empty
                ? undefined
                : t(
                    canImport
                      ? 'import.empty.description'
                      : 'import.empty.readOnly',
                  )
            }
            clearFilters={
              !empty
                ? {
                    label: t('import.actions.clearFilters'),
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
        title={t('import.title')}
        description={t('import.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant='outline' />}>
                <DownloadIcon data-icon='inline-start' />
                {t('import.actions.templates')}
                <ChevronDownIcon data-icon='inline-end' />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuGroup>
                  {IMPORT_KINDS.map((value) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => void downloadTemplate(value)}
                    >
                      <FileSpreadsheetIcon />
                      {t(`import.kinds.${value}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {canImport ? newImport : null}
            {/* Refresh is the last header action (R4). */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('import.actions.refresh')}
                    onClick={runs.reload}
                  />
                }
              >
                <RefreshCwIcon
                  className={runs.loading && body ? 'animate-spin' : undefined}
                />
              </TooltipTrigger>
              <TooltipContent>{t('import.actions.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      >
        {!empty ? (
          <>
            <Select
              items={kindItems}
              value={kind ?? ALL}
              onValueChange={(value) =>
                updateParams((params) => {
                  if (value && value !== ALL) params.set('kind', value);
                  else params.delete('kind');
                  params.delete('page');
                })
              }
            >
              <SelectTrigger
                ref={filterRef}
                className='w-full sm:w-44'
                aria-label={t('import.fields.kind')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={SELECT_CONTENT_CLASS}>
                <SelectGroup>
                  {kindItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {kind ? (
              <Button variant='ghost' onClick={clearFilters}>
                {t('import.actions.clearFilters')}
              </Button>
            ) : null}
          </>
        ) : null}
      </ApplicationToolbar>
      {content}
      <Outlet context={outletContext} />
    </PageContainer>
  );
}
