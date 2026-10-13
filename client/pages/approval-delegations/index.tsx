import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  BanIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '#components/ui/alert-dialog';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
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
import { Spinner } from '#components/ui/spinner';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useUrlSearch } from '#hooks/use-url-search';
import { TableSkeleton } from '../org/org-ui.js';
import { ErrorState } from '../approvals/states.js';
import { useResource } from '../approvals/use-resource.js';
import {
  DELEGATION_SETTINGS,
  SELECT_POPUP,
  isEffective,
  type Delegation,
  type DelegationContext,
} from './types.js';

export default function DelegationsPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const location = useLocation();
  const searchRef = useRef<HTMLInputElement>(null);
  const permission = useCan({
    resource: { type: 'settings', id: DELEGATION_SETTINGS },
    action: 'update',
  });
  const canUpdate =
    permission.can && !permission.isPending && !permission.error;
  const resource = useResource<Delegation[]>('approvalDelegations');
  const options = useResource<{ timeZone: string }>('leaveRequests/options');
  const zone = options.data?.timeZone;
  const { searchParams, search, inputProps, updateParams, clear } =
    useUrlSearch({ resetParams: ['page'] });
  const status = searchParams.get('status') ?? 'all';
  const source = searchParams.get('source') ?? 'all';
  const sort = ['from', 'to', 'createdAt'].includes(
    searchParams.get('sort') ?? '',
  )
    ? searchParams.get('sort')!
    : 'createdAt';
  const desc = searchParams.get('direction') !== 'asc';
  const filtered = useMemo(
    () =>
      (resource.data ?? [])
        .filter(
          (row) =>
            (!search ||
              `${row.principal.name} ${row.delegate.name}`
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase())) &&
            (source === 'all' || row.source === source) &&
            (status === 'all' || isEffective(row) === (status === 'active')),
        )
        .sort(
          (a, b) =>
            (Date.parse(a[sort as 'from']) - Date.parse(b[sort as 'from'])) *
            (desc ? -1 : 1),
        ),
    [resource.data, search, status, source, sort, desc],
  );
  const pageSize = [10, 20, 50].includes(Number(searchParams.get('pageSize')))
    ? Number(searchParams.get('pageSize'))
    : 10;
  const pageIndex = Math.min(
    Math.max(0, Number(searchParams.get('page') ?? 1) - 1) || 0,
    Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
  );
  const [selected, setSelected] = useState<Delegation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const onSaved = useCallback(
    (row: Delegation) => {
      resource.update(
        (resource.data ?? []).some((entry) => entry.id === row.id)
          ? (resource.data ?? []).map((entry) =>
              entry.id === row.id ? row : entry,
            )
          : [row, ...(resource.data ?? [])],
      );
      resource.reload();
    },
    [resource],
  );
  const context = useMemo<DelegationContext>(
    () => ({ reload: resource.reload, onSaved }),
    [resource.reload, onSaved],
  );
  const refresh = () => {
    resource.reload();
    options.reload();
  };
  async function disable() {
    if (!selected || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await api.request<{ data: Delegation }>({
        path: `approvalDelegations/${encodeURIComponent(selected.id)}/disable`,
        method: 'POST',
      });
      onSaved(result.data);
      toaster.show({
        type: 'success',
        title: t('approvals.delegations.disabled', {
          name: selected.principal.name,
        }),
      });
      setSelected(null);
      searchRef.current?.focus();
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiClientError && failure.status === 404)
        resource.reload();
    } finally {
      setSaving(false);
    }
  }
  const columns = useMemo<ColumnDef<Delegation>[]>(
    () => [
      {
        id: 'principal',
        header: t('approvals.delegations.principal'),
        cell: ({ row: { original: row } }) =>
          row.source === 'leave' && row.sourceApplication ? (
            <Link
              className='font-medium text-primary hover:underline'
              to={{
                pathname: `leave/${encodeURIComponent(row.sourceApplication)}`,
                search: location.search,
              }}
            >
              <UserName name={row.principal.name} />
            </Link>
          ) : canUpdate ? (
            <Link
              className='font-medium text-primary hover:underline'
              to={{
                pathname: `edit/${encodeURIComponent(row.id)}`,
                search: location.search,
              }}
            >
              <UserName name={row.principal.name} />
            </Link>
          ) : (
            <UserName name={row.principal.name} />
          ),
      },
      {
        accessorFn: (row) => row.delegate.name,
        id: 'delegate',
        cell: ({ row }) => <UserName name={row.original.delegate.name} />,
        header: t('approvals.delegations.delegate'),
      },
      {
        id: 'scope',
        header: t('approvals.delegations.scope'),
        cell: ({ row }) => (
          <Badge variant='outline'>
            {t(
              row.original.scope === 'all'
                ? 'approvals.delegations.allScope'
                : 'approvals.delegations.leaveScope',
            )}
          </Badge>
        ),
      },
      ...(['from', 'to'] as const).map((field) => ({
        accessorKey: field,
        header: ({
          column,
        }: {
          column: Parameters<
            typeof DataTableColumnHeader<Delegation, unknown>
          >[0]['column'];
        }) => (
          <DataTableColumnHeader
            column={column}
            title={t(`approvals.delegations.${field}`)}
          />
        ),
        cell: ({ row }: { row: { original: Delegation } }) =>
          zone
            ? new Intl.DateTimeFormat(i18n.language, {
                timeZone: zone,
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(row.original[field]))
            : '—',
      })),
      {
        id: 'source',
        header: t('approvals.delegations.source'),
        cell: ({ row }) => (
          <Badge variant='secondary'>
            {t(`approvals.delegations.${row.original.source}`)}
          </Badge>
        ),
      },
      {
        id: 'status',
        header: t('approvals.status'),
        cell: ({ row }) => (
          <Badge variant={isEffective(row.original) ? 'secondary' : 'outline'}>
            {t(
              isEffective(row.original)
                ? 'approvals.delegations.active'
                : 'approvals.delegations.inactive',
            )}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row: { original: row } }) =>
          row.source === 'leave' ? (
            <Tooltip>
              <TooltipTrigger
                render={<span tabIndex={0} className='text-muted-foreground' />}
              >
                {t('approvals.delegations.leave')}
              </TooltipTrigger>
              <TooltipContent>
                {t('approvals.delegations.sourceLeave')}
              </TooltipContent>
            </Tooltip>
          ) : canUpdate ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('approvals.actions', {
                      name: row.principal.name,
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
                          pathname: `edit/${encodeURIComponent(row.id)}`,
                          search: location.search,
                        }}
                      />
                    }
                  >
                    {t('approvals.edit')}
                  </DropdownMenuItem>
                  {row.active ? (
                    <DropdownMenuItem
                      onClick={() => {
                        setSelected(row);
                        setError(undefined);
                      }}
                    >
                      <BanIcon />
                      {t('approvals.delegations.disable')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [t, zone, i18n.language, location.search, canUpdate],
  );
  const firstLoading = resource.loading && !resource.data;
  const empty = resource.data?.length === 0;
  const createButton = (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon data-icon='inline-start' />
      {t('approvals.delegations.new')}
    </Button>
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('approvals.navigation.delegations')}
        description={t('approvals.delegations.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            {canUpdate ? createButton : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={refresh}
                    aria-label={t('approvals.refresh')}
                    disabled={resource.loading || options.loading}
                  />
                }
              >
                <RefreshCwIcon
                  className={
                    resource.loading || options.loading
                      ? 'animate-spin'
                      : undefined
                  }
                />
              </TooltipTrigger>
              <TooltipContent>{t('approvals.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      >
        <ApplicationSearch
          ref={searchRef}
          {...inputProps}
          aria-label={t('approvals.delegations.search')}
          placeholder={t('approvals.delegations.search')}
          className='w-full sm:max-w-xs'
        />
        {(['status', 'source'] as const).map((field) => (
          <Select
            key={field}
            value={field === 'status' ? status : source}
            items={(field === 'status'
              ? ['all', 'active', 'inactive']
              : ['all', 'manual', 'leave']
            ).map((value) => ({
              value,
              label: t(
                value === 'all'
                  ? 'approvals.all'
                  : `approvals.delegations.${value}`,
              ),
            }))}
            onValueChange={(value) =>
              updateParams((params) => {
                params.set(field, value ?? 'all');
                params.delete('page');
              })
            }
          >
            <SelectTrigger
              aria-label={t(
                field === 'status'
                  ? 'approvals.status'
                  : 'approvals.delegations.source',
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={SELECT_POPUP}>
              <SelectGroup>
                {(field === 'status'
                  ? ['all', 'active', 'inactive']
                  : ['all', 'manual', 'leave']
                ).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(
                      value === 'all'
                        ? 'approvals.all'
                        : `approvals.delegations.${value}`,
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </ApplicationToolbar>
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : firstLoading ? (
        <TableSkeleton />
      ) : (
        <DataTableServer
          columns={columns}
          rows={filtered.slice(
            pageIndex * pageSize,
            (pageIndex + 1) * pageSize,
          )}
          total={filtered.length}
          getRowId={(row) => row.id}
          pagination={{ pageIndex, pageSize }}
          pageSizeOptions={[10, 20, 50]}
          sorting={[{ id: sort, desc }]}
          onSortingChange={(next) =>
            updateParams((params) => {
              params.set('sort', next[0]?.id ?? 'createdAt');
              params.set('direction', next[0]?.desc === false ? 'asc' : 'desc');
              params.delete('page');
            })
          }
          onPaginationChange={(next) =>
            updateParams((params) => {
              params.set('page', String(next.pageIndex + 1));
              params.set('pageSize', String(next.pageSize));
            })
          }
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                empty ? 'approvals.delegations.empty' : 'approvals.noResults',
              )}
              description={
                empty ? t('approvals.delegations.emptyDescription') : undefined
              }
              clearFilters={
                !empty
                  ? {
                      label: t('approvals.clear'),
                      onClick: () =>
                        clear((params) => {
                          params.delete('status');
                          params.delete('source');
                          params.delete('page');
                        }),
                    }
                  : undefined
              }
            />
          }
        />
      )}
      {options.error ? (
        <ErrorState error={options.error} retry={options.reload} />
      ) : zone ? (
        <p className='text-sm text-muted-foreground'>
          {t('approvals.delegations.timeZone', { zone })}
        </p>
      ) : null}
      <AlertDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !saving) setSelected(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('approvals.delegations.disableTitle', {
                principal: selected?.principal.name ?? '',
                delegate: selected?.delegate.name ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('approvals.delegations.disableDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <ErrorState error={error} retry={() => void disable()} />
          ) : null}
          <AlertDialogFooter>
            <Button
              variant='outline'
              disabled={saving}
              onClick={() => setSelected(null)}
            >
              {t('approvals.cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={
                saving ||
                (error instanceof ApiClientError &&
                  [401, 403, 404].includes(error.status))
              }
              onClick={() => void disable()}
            >
              {saving ? <Spinner data-icon='inline-start' /> : null}
              {t('approvals.delegations.disable')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Outlet context={context} />
    </PageContainer>
  );
}
