import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
} from 'lucide-react';
import {
  type ReactElement,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { DataTable } from '#components/data-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
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
import { Spinner } from '#components/ui/spinner';
import { useUrlSearch } from '#hooks/use-url-search';

import { ActiveBadge, LoadError, TableSkeleton } from '../org-ui.js';
import {
  type ListBody,
  SELECT_CONTENT_CLASS,
  useCanUpdate,
  useErrorText,
} from '../shared.js';
import {
  CATALOGS,
  type CatalogKind,
  type CatalogOutletContext,
  type CatalogRow,
} from './types.js';

type StatusFilter = 'active' | 'inactive';

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === 'active' || value === 'inactive';
}

/**
 * The positions or grades list (guideline T1). The catalogue is bounded (tens of rows), so the endpoint answers it
 * whole and the page searches, filters and sorts in the browser; search and status live in the URL.
 */
export function CatalogPage({
  kind,
}: {
  readonly kind: CatalogKind;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const toaster = useToaster();
  const errorText = useErrorText();
  const location = useLocation();
  const config = CATALOGS[kind];
  const canUpdate = useCanUpdate(config.item);
  const searchRef = useRef<HTMLInputElement>(null);

  const { searchParams, search, text, inputProps, updateParams, clear } =
    useUrlSearch();
  const statusParam = searchParams.get('status');
  const status = isStatusFilter(statusParam) ? statusParam : undefined;
  const hasFilters = text.trim() !== '' || status !== undefined;

  function clearFilters(): void {
    clear((params) => params.delete('status'));
    searchRef.current?.focus();
  }

  const [reloadCount, reload] = useReducer((count: number) => count + 1, 0);
  const [result, setResult] = useState<{
    readonly key: number;
    readonly rows?: CatalogRow[];
    readonly error?: unknown;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    const key = reloadCount;
    api
      .request<ListBody<CatalogRow>>({
        path: kind,
        signal: controller.signal,
      })
      .then(
        ({ data }) => {
          if (!controller.signal.aborted) setResult({ key, rows: data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, kind, reloadCount]);

  const loading = result?.key !== reloadCount;
  const error = loading ? undefined : result?.error;
  const allRows = result?.rows;

  const rows = useMemo(() => {
    if (!allRows) return undefined;
    const needle = search.toLowerCase();
    return allRows.filter(
      (row) =>
        (!status || row.active === (status === 'active')) &&
        (!needle ||
          row.title.toLowerCase().includes(needle) ||
          row.code.toLowerCase().includes(needle)),
    );
  }, [allRows, search, status]);

  const outletContext = useMemo<CatalogOutletContext>(
    () => ({ reload }),
    [reload],
  );

  // The disable confirmation keeps its target while closing, so the title does not flicker.
  const [disabling, setDisabling] = useState<{
    readonly open: boolean;
    readonly row: CatalogRow | null;
  }>({ open: false, row: null });
  const [pending, setPending] = useState<string>();
  // A failed disable is explained inside its confirmation dialog (guideline I3); a failed enable, a single click, in a toast.
  const [disableError, setDisableError] = useState<string>();

  async function setActive(row: CatalogRow, active: boolean): Promise<void> {
    setPending(row.id);
    setDisableError(undefined);
    try {
      await api.request({
        path: `${kind}/${encodeURIComponent(row.id)}/${active ? 'enable' : 'disable'}`,
        method: 'POST',
      });
      toaster.show({
        type: 'success',
        title: active
          ? t(`org.${kind}.enabled`, { name: row.title })
          : t(`org.${kind}.disabled`, { name: row.title }),
      });
      setDisabling((current) => ({ ...current, open: false }));
      reload();
    } catch (cause: unknown) {
      if (cause instanceof ApiClientError && cause.status === 404) reload();
      if (active) toaster.show({ type: 'error', title: errorText(cause) });
      else setDisableError(errorText(cause));
    } finally {
      setPending(undefined);
    }
  }

  const collator = useMemo(() => new Intl.Collator(locale), [locale]);
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  const statusItems = [
    { value: 'all', label: t('org.common.allStatuses') },
    { value: 'active', label: t('org.common.active') },
    { value: 'inactive', label: t('org.common.inactive') },
  ];

  const columns = useMemo<ColumnDef<CatalogRow>[]>(() => {
    const numberField = config.numberField;
    return [
      {
        accessorKey: 'title',
        enableHiding: false,
        sortingFn: (a, b) =>
          collator.compare(a.original.title, b.original.title),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('org.common.fields.title')}
          />
        ),
        cell: ({ row }) => (
          <span className='font-medium'>{row.original.title}</span>
        ),
      },
      {
        accessorKey: 'code',
        header: t('org.common.fields.code'),
        cell: ({ row }) => (
          <span className='font-mono text-muted-foreground'>
            {row.original.code}
          </span>
        ),
      },
      {
        id: numberField,
        accessorFn: (row) => row[numberField] ?? 0,
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t(`org.${kind}.fields.number`)}
            className='justify-end text-right'
          />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {numberFormat.format(row.original[numberField] ?? 0)}
          </div>
        ),
      },
      {
        accessorKey: 'active',
        header: t('org.common.fields.status'),
        cell: ({ row }) => <ActiveBadge active={row.original.active} />,
      },
      {
        id: 'actions',
        enableHiding: false,
        header: () => (
          <span className='sr-only'>{t('org.common.actions.label')}</span>
        ),
        cell: ({ row }) =>
          canUpdate ? (
            <div className='flex justify-end'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('org.common.actions.more', {
                        name: row.original.title,
                      })}
                    />
                  }
                >
                  {pending === row.original.id ? (
                    <Spinner />
                  ) : (
                    <MoreHorizontalIcon />
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-auto min-w-40'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={
                        <Link
                          to={{
                            pathname: `edit/${encodeURIComponent(row.original.id)}`,
                            search: location.search,
                          }}
                        />
                      }
                    >
                      <PencilIcon />
                      {t('org.common.actions.edit')}
                    </DropdownMenuItem>
                    {row.original.active ? null : (
                      <DropdownMenuItem
                        disabled={pending !== undefined}
                        onClick={() => void setActive(row.original, true)}
                      >
                        <PowerIcon />
                        {t('org.common.actions.enable')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {row.original.active ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => {
                            setDisableError(undefined);
                            setDisabling({ open: true, row: row.original });
                          }}
                        >
                          <PowerOffIcon />
                          {t('org.common.actions.disable')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ];
    // setActive closes over state setters only; listing it would rebuild the columns every render.
    // eslint-disable-next-line @eslint-react/exhaustive-deps, react-hooks/exhaustive-deps
  }, [
    canUpdate,
    collator,
    config.numberField,
    kind,
    location.search,
    numberFormat,
    pending,
    t,
  ]);

  const createButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon data-icon='inline-start' />
      {t(`org.${kind}.create`)}
    </Button>
  );

  let content: ReactElement;
  if (error) {
    content = (
      <LoadError
        error={error}
        title={t(`org.${kind}.loadFailed`)}
        onRetry={() => {
          reload();
          searchRef.current?.focus();
        }}
      />
    );
  } else if (!rows || !allRows) {
    content = <TableSkeleton />;
  } else {
    content = (
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        showSelectedCount={false}
        pageSize={20}
        initialSorting={[{ id: config.numberField, desc: false }]}
        emptyMessage={
          <ApplicationTableEmpty
            title={
              hasFilters
                ? t('org.common.noResults')
                : t(`org.${kind}.emptyTitle`)
            }
            description={
              hasFilters
                ? undefined
                : canUpdate
                  ? t(`org.${kind}.emptyDescription`)
                  : t('org.common.askAdministrator')
            }
            clearFilters={
              hasFilters
                ? { label: t('org.common.clearFilters'), onClick: clearFilters }
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
        title={t(`org.${kind}.title`)}
        description={t(`org.${kind}.description`)}
      />
      <ApplicationToolbar actions={canUpdate ? createButton : null}>
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
            placeholder={t('org.common.searchByTitleOrCode')}
            aria-label={t('org.common.searchByTitleOrCode')}
          />
        </InputGroup>
        <Select
          items={statusItems}
          value={status ?? 'all'}
          onValueChange={(value: string | null) =>
            updateParams((params) => {
              if (value && value !== 'all') params.set('status', value);
              else params.delete('status');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('org.common.fields.status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
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
            {t('org.common.clearFilters')}
          </Button>
        ) : null}
        {loading && allRows !== undefined ? (
          <Spinner className='text-muted-foreground' />
        ) : null}
      </ApplicationToolbar>
      {content}

      <AlertDialog
        open={disabling.open}
        onOpenChange={(open) => {
          if (pending) return;
          setDisabling((current) => ({ ...current, open }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(`org.${kind}.disableTitle`, {
                name: disabling.row?.title ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`org.${kind}.disableDescription`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {disableError ? (
            <p role='alert' className='text-sm text-destructive'>
              {disableError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== undefined}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending !== undefined}
              onClick={() => {
                if (disabling.row) void setActive(disabling.row, false);
              }}
            >
              {pending ? <Spinner data-icon='inline-start' /> : null}
              {t('org.common.actions.disable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Outlet context={outletContext} />
    </PageContainer>
  );
}
