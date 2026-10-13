import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  BanIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react';
import { type ReactElement, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { DataTable } from '#components/data-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { SessionExpiredAlert } from '#components/session-expired-alert';
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
import { Badge } from '#components/ui/badge';
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

import { statusOf } from '../shared/errors.js';
import { LoadErrorAlert, TableSkeleton } from '../shared/states.js';
import {
  labelOf,
  type DictionaryEntry,
  type DictionaryType,
} from '../shared/types.js';
import { useListResource } from '../shared/use-resource.js';
import {
  DEFAULT_DICTIONARY_TYPE,
  DICTIONARIES_SETTINGS,
  type DictionariesOutletContext,
} from './constants.js';
import { ExtraSummary } from './extra-summary.js';

const STATUSES = ['all', 'active', 'inactive'] as const;
type StatusFilter = (typeof STATUSES)[number];
const SELECT_CONTENT_CLASS =
  'w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal';

/**
 * Route /dictionaries: the entries of one dictionary type (`?type=`), filtered in the browser by `?q=` and
 * `?status=`. A type holds tens of entries, so the whole type is loaded and sorted here. Entries are disabled, never
 * deleted: requests keep the codes they were filed with.
 */
export default function DictionariesPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const update = useCan({
    resource: { type: 'settings', id: DICTIONARIES_SETTINGS },
    action: 'update',
  });
  const canUpdate = update.can && !update.isPending && !update.error;

  const { searchParams, search, text, inputProps, updateParams, clear } =
    useUrlSearch();
  const types = useListResource<DictionaryType>('dictionaryTypes');
  const typeList = types.data?.data;
  const requestedType = searchParams.get('type') ?? DEFAULT_DICTIONARY_TYPE;
  const type =
    typeList && !typeList.some((item) => item.type === requestedType)
      ? DEFAULT_DICTIONARY_TYPE
      : requestedType;
  const definition = typeList?.find((item) => item.type === type);
  const statusParam = searchParams.get('status');
  const status: StatusFilter = STATUSES.includes(statusParam as StatusFilter)
    ? (statusParam as StatusFilter)
    : 'all';

  const entriesPath = `dictionaryTypes/${encodeURIComponent(type)}/entries`;
  const entries = useListResource<DictionaryEntry>(entriesPath, {
    includeInactive: 'true',
  });
  // While another type loads, the previous type's rows are not shown under its name.
  const rowsOfType =
    entries.dataPath === entriesPath ? entries.data?.data : undefined;

  const hasFilters = text.trim() !== '' || status !== 'all';
  const rows = useMemo(() => {
    if (!rowsOfType) return undefined;
    const term = search.toLowerCase();
    return rowsOfType.filter(
      (row) =>
        (status === 'all' || (status === 'active') === row.active) &&
        (!term ||
          row.code.toLowerCase().includes(term) ||
          [row.label['zh-CN'], row.label['en-US']].some((label) =>
            label?.toLowerCase().includes(term),
          )),
    );
  }, [rowsOfType, search, status]);

  function clearFilters(): void {
    clear((params) => params.delete('status'));
    searchRef.current?.focus();
  }

  const { reload } = entries;
  const outletContext = useMemo<DictionariesOutletContext>(
    () => ({ type, reload }),
    [type, reload],
  );

  const [disabling, setDisabling] = useState<{
    readonly open: boolean;
    readonly entry: DictionaryEntry | null;
  }>({ open: false, entry: null });

  const typeItems = useMemo(
    () =>
      (typeList ?? []).map((item) => ({
        value: item.type,
        label: t(`platform.dictionaries.types.${item.type}`),
      })),
    [t, typeList],
  );
  const statusItems = STATUSES.map((value) => ({
    value,
    label: t(`platform.dictionaries.status.${value}`),
  }));
  const collator = useMemo(() => new Intl.Collator(locale), [locale]);

  const columns = useMemo<ColumnDef<DictionaryEntry>[]>(() => {
    const list: ColumnDef<DictionaryEntry>[] = [
      {
        id: 'label',
        accessorFn: (row) => labelOf(row, locale),
        enableHiding: false,
        sortingFn: (a, b) =>
          collator.compare(
            labelOf(a.original, locale),
            labelOf(b.original, locale),
          ),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('platform.dictionaries.fields.label')}
          />
        ),
        cell: ({ row }) => (
          <span className='font-medium'>{labelOf(row.original, locale)}</span>
        ),
      },
      {
        accessorKey: 'code',
        header: t('platform.dictionaries.fields.code'),
        cell: ({ row }) => <code className='text-xs'>{row.original.code}</code>,
      },
      {
        id: 'extra',
        header: t('platform.dictionaries.fields.extra'),
        cell: ({ row }) => (
          <ExtraSummary
            fields={definition?.extraFields ?? []}
            extra={row.original.extra}
          />
        ),
      },
      {
        accessorKey: 'sortOrder',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('platform.dictionaries.fields.sortOrder')}
            className='justify-end text-right'
          />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {row.original.sortOrder}
          </div>
        ),
      },
      {
        accessorKey: 'active',
        header: t('platform.dictionaries.fields.status'),
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant='secondary'>
              {t('platform.dictionaries.status.active')}
            </Badge>
          ) : (
            <Badge variant='outline'>
              {t('platform.dictionaries.status.inactive')}
            </Badge>
          ),
      },
    ];
    if (canUpdate)
      list.push({
        id: 'actions',
        enableHiding: false,
        header: () => (
          <span className='sr-only'>{t('platform.common.actions')}</span>
        ),
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('platform.common.actionsFor', {
                      name: labelOf(row.original, locale),
                    })}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-auto min-w-40'>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    render={
                      <Link
                        to={{
                          pathname: `edit/${row.original.id}`,
                          search: location.search,
                        }}
                      />
                    }
                  >
                    <PencilIcon />
                    {t('platform.common.edit')}
                  </DropdownMenuItem>
                  {row.original.active ? null : (
                    <EnableMenuItem entry={row.original} onDone={reload} />
                  )}
                </DropdownMenuGroup>
                {row.original.active ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant='destructive'
                        onClick={() =>
                          setDisabling({ open: true, entry: row.original })
                        }
                      >
                        <BanIcon />
                        {t('platform.dictionaries.disable')}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      });
    return list;
  }, [canUpdate, collator, definition, locale, location.search, reload, t]);

  const newLink = { pathname: 'new', search: location.search };
  const newButton = (
    <Button render={<Link to={newLink} />} nativeButton={false}>
      <PlusIcon data-icon='inline-start' />
      {t('platform.dictionaries.create.action')}
    </Button>
  );

  const loadError = types.error ?? entries.error;
  let content: ReactElement;
  if (statusOf(loadError) === 401) {
    content = <SessionExpiredAlert />;
  } else if (loadError) {
    content = (
      <LoadErrorAlert
        error={loadError}
        title={t('platform.dictionaries.loadFailedTitle')}
        onRetry={() => {
          types.reload();
          entries.reload();
        }}
      />
    );
  } else if (rows === undefined || !definition || update.isPending) {
    content = <TableSkeleton columns={5} />;
  } else {
    content = (
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        showSelectedCount={false}
        pageSize={20}
        initialSorting={[{ id: 'sortOrder', desc: false }]}
        emptyMessage={
          <ApplicationTableEmpty
            title={
              hasFilters
                ? t('platform.common.noResults')
                : t('platform.dictionaries.empty.title')
            }
            description={
              hasFilters
                ? undefined
                : t(
                    canUpdate
                      ? 'platform.dictionaries.empty.description'
                      : 'platform.dictionaries.empty.readOnly',
                  )
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
        title={t('platform.dictionaries.title')}
        description={t('platform.dictionaries.description')}
      />
      <ApplicationToolbar actions={canUpdate ? newButton : null}>
        <Select
          items={typeItems}
          value={type}
          onValueChange={(value) => {
            if (value) updateParams((params) => params.set('type', value));
          }}
        >
          <SelectTrigger
            className='w-full sm:w-48'
            aria-label={t('platform.dictionaries.fields.type')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS}>
            <SelectGroup>
              {typeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
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
            placeholder={t('platform.dictionaries.searchPlaceholder')}
            aria-label={t('platform.dictionaries.searchLabel')}
          />
        </InputGroup>
        <Select
          items={statusItems}
          value={status}
          onValueChange={(value) =>
            updateParams((params) => {
              if (value && value !== 'all') params.set('status', value);
              else params.delete('status');
            })
          }
        >
          <SelectTrigger
            className='w-full sm:w-40'
            aria-label={t('platform.dictionaries.fields.status')}
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
            {t('platform.common.clearFilters')}
          </Button>
        ) : null}
        {entries.loading && rowsOfType !== undefined ? (
          <Spinner className='text-muted-foreground' />
        ) : null}
      </ApplicationToolbar>
      {content}
      <DisableEntryDialog
        open={disabling.open}
        entry={disabling.entry}
        onOpenChange={(open) =>
          setDisabling((current) => ({ ...current, open }))
        }
        onDone={() => {
          setDisabling((current) => ({ ...current, open: false }));
          entries.reload();
        }}
      />
      <Outlet context={outletContext} />
    </PageContainer>
  );
}

function DisableEntryDialog({
  open,
  entry,
  onOpenChange,
  onDone,
}: {
  readonly open: boolean;
  readonly entry: DictionaryEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const toaster = useToaster();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    'sessionExpired' | 'forbidden' | 'failed'
  >();
  const name = entry ? labelOf(entry, locale) : '';

  async function disable(target: DictionaryEntry): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `dictionaryTypes/${encodeURIComponent(target.type)}/entries/${target.id}`,
        method: 'PATCH',
        json: { active: false },
      });
    } catch (caught: unknown) {
      const status = statusOf(caught);
      setError(
        status === 401
          ? 'sessionExpired'
          : status === 403
            ? 'forbidden'
            : 'failed',
      );
      setPending(false);
      return;
    }
    setPending(false);
    toaster.show({
      type: 'success',
      title: t('platform.dictionaries.disabled', { name }),
    });
    onDone();
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (!next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('platform.dictionaries.disableTitle', { name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('platform.dictionaries.disableDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error === 'sessionExpired' ? (
          <SessionExpiredAlert />
        ) : error ? (
          <p role='alert' className='text-sm text-destructive'>
            {error === 'forbidden'
              ? t('platform.common.writeForbidden')
              : t('platform.common.saveFailed')}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            disabled={pending || (error !== undefined && error !== 'failed')}
            onClick={() => {
              if (entry) void disable(entry);
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('platform.dictionaries.disable')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Enables a disabled entry at once (no confirmation: nothing is lost), with a toast either way. */
function EnableMenuItem({
  entry,
  onDone,
}: {
  readonly entry: DictionaryEntry;
  readonly onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const toaster = useToaster();

  async function enable(): Promise<void> {
    try {
      await api.request({
        path: `dictionaryTypes/${encodeURIComponent(entry.type)}/entries/${entry.id}`,
        method: 'PATCH',
        json: { active: true },
      });
      toaster.show({
        type: 'success',
        title: t('platform.dictionaries.enabled', {
          name: labelOf(entry, locale),
        }),
      });
    } catch (error: unknown) {
      toaster.show({
        type: 'error',
        title:
          statusOf(error) === 403
            ? t('platform.common.writeForbidden')
            : t('platform.common.saveFailed'),
      });
    }
    onDone();
  }

  return (
    <DropdownMenuItem onClick={() => void enable()}>
      <CheckIcon />
      {t('platform.dictionaries.enable')}
    </DropdownMenuItem>
  );
}
