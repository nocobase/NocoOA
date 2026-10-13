import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  MoreHorizontalIcon,
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  UsersIcon,
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
  ORG_SETTINGS,
  SELECT_CONTENT_CLASS,
  useCanUpdate,
  useErrorText,
} from '../shared.js';
import { useRoleTitle } from './role-title.js';
import type { DutyRole, DutyRolesOutletContext } from './types.js';

type StatusFilter = 'active' | 'inactive';

function isStatusFilter(value: string | null): value is StatusFilter {
  return value === 'active' || value === 'inactive';
}

/**
 * Settings → 职能角色池. The fourteen duty roles approval resolution looks up are seeded, so the page lists, enables and
 * disables them and manages their members in a drawer; it creates none. The pool is bounded, so it is searched and
 * sorted in the browser.
 */
export default function DutyRolesPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const toaster = useToaster();
  const errorText = useErrorText();
  const location = useLocation();
  const roleTitle = useRoleTitle();
  const canUpdate = useCanUpdate(ORG_SETTINGS.dutyRoles);
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
    readonly roles?: DutyRole[];
    readonly error?: unknown;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const key = reloadCount;
    api
      .request<ListBody<DutyRole>>({
        path: 'dutyRoles',
        signal: controller.signal,
      })
      .then(
        ({ data }) => {
          if (!controller.signal.aborted) setResult({ key, roles: data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, reloadCount]);
  const loading = result?.key !== reloadCount;
  const error = loading ? undefined : result?.error;
  const allRoles = result?.roles;

  const roles = useMemo(() => {
    if (!allRoles) return undefined;
    const needle = search.toLowerCase();
    return allRoles.filter(
      (role) =>
        (!status || role.active === (status === 'active')) &&
        (!needle ||
          roleTitle(role.title).toLowerCase().includes(needle) ||
          role.code.toLowerCase().includes(needle)),
    );
  }, [allRoles, search, status, roleTitle]);

  const outletContext = useMemo<DutyRolesOutletContext>(
    () => ({ reload, canUpdate }),
    [canUpdate],
  );

  const [disabling, setDisabling] = useState<{
    readonly open: boolean;
    readonly role: DutyRole | null;
  }>({ open: false, role: null });
  const [pending, setPending] = useState<string>();
  const [disableError, setDisableError] = useState<string>();

  async function setActive(role: DutyRole, active: boolean): Promise<void> {
    setPending(role.code);
    setDisableError(undefined);
    const name = roleTitle(role.title);
    try {
      await api.request({
        path: `dutyRoles/${encodeURIComponent(role.code)}/${active ? 'enable' : 'disable'}`,
        method: 'POST',
      });
      toaster.show({
        type: 'success',
        title: active
          ? t('org.dutyRoles.enabled', { name })
          : t('org.dutyRoles.disabled', { name }),
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

  const columns = useMemo<ColumnDef<DutyRole>[]>(
    () => [
      {
        id: 'title',
        accessorFn: (role) => roleTitle(role.title),
        enableHiding: false,
        sortingFn: (a, b) =>
          collator.compare(
            roleTitle(a.original.title),
            roleTitle(b.original.title),
          ),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('org.common.fields.title')}
          />
        ),
        cell: ({ row }) => (
          <Link
            to={{
              pathname: encodeURIComponent(row.original.code),
              search: location.search,
            }}
            className='font-medium hover:underline'
          >
            {roleTitle(row.original.title)}
          </Link>
        ),
      },
      {
        accessorKey: 'code',
        header: t('org.dutyRoles.fields.code'),
        cell: ({ row }) => (
          <span className='font-mono text-muted-foreground'>
            {row.original.code}
          </span>
        ),
      },
      {
        accessorKey: 'memberCount',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('org.dutyRoles.fields.memberCount')}
            className='justify-end text-right'
          />
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {numberFormat.format(row.original.memberCount)}
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
        cell: ({ row }) => {
          const name = roleTitle(row.original.title);
          return (
            <div className='flex justify-end'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('org.common.actions.more', { name })}
                    />
                  }
                >
                  {pending === row.original.code ? (
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
                            pathname: encodeURIComponent(row.original.code),
                            search: location.search,
                          }}
                        />
                      }
                    >
                      <UsersIcon />
                      {t('org.dutyRoles.viewMembers')}
                    </DropdownMenuItem>
                    {canUpdate && !row.original.active ? (
                      <DropdownMenuItem
                        disabled={pending !== undefined}
                        onClick={() => void setActive(row.original, true)}
                      >
                        <PowerIcon />
                        {t('org.common.actions.enable')}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>
                  {canUpdate && row.original.active ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => {
                            setDisableError(undefined);
                            setDisabling({ open: true, role: row.original });
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
          );
        },
      },
    ],
    // setActive closes over stable setters; listing it would rebuild the columns every render.
    // eslint-disable-next-line @eslint-react/exhaustive-deps, react-hooks/exhaustive-deps
    [canUpdate, collator, location.search, numberFormat, pending, roleTitle, t],
  );

  let content: ReactElement;
  if (error) {
    content = (
      <LoadError
        error={error}
        title={t('org.dutyRoles.loadFailed')}
        onRetry={() => {
          reload();
          searchRef.current?.focus();
        }}
      />
    );
  } else if (!roles || !allRoles) {
    content = <TableSkeleton />;
  } else {
    content = (
      <DataTable
        columns={columns}
        data={roles}
        getRowId={(role) => role.code}
        showSelectedCount={false}
        pageSize={20}
        emptyMessage={
          <ApplicationTableEmpty
            title={
              hasFilters
                ? t('org.common.noResults')
                : t('org.dutyRoles.emptyTitle')
            }
            description={
              hasFilters ? undefined : t('org.dutyRoles.emptyDescription')
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
        title={t('org.dutyRoles.title')}
        description={t('org.dutyRoles.description')}
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
        {loading && allRoles !== undefined ? (
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
              {t('org.dutyRoles.disableTitle', {
                name: disabling.role ? roleTitle(disabling.role.title) : '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('org.dutyRoles.disableDescription')}
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
                if (disabling.role) void setActive(disabling.role, false);
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
