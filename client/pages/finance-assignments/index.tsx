import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { useEffect } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, Outlet, useLocation } from 'react-router';
import { Plus, RefreshCw, MoreHorizontal, Eye, Pencil } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { DepartmentPicker } from '#components/department-picker';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Label } from '#components/ui/label';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useUrlSearch } from '#hooks/use-url-search';
import { TruncatedText } from '../platform/shared/truncated-text.js';
import { SETTINGS, type Assignment, type Page } from './types.js';
import { useFinanceResource } from './resource.js';
import { FinanceError, FinanceSkeleton } from './states.js';
export default function FinanceAssignments() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    { searchParams, updateParams } = useUrlSearch();
  const permission = useCan({
      resource: { type: 'settings', id: SETTINGS },
      action: 'update',
    }),
    canUpdate = permission.can && !permission.isPending && !permission.error;
  const departmentId = searchParams.get('departmentId') ?? '',
    page =
      Number.isSafeInteger(Number(searchParams.get('page'))) &&
      Number(searchParams.get('page')) > 0
        ? Number(searchParams.get('page'))
        : 1,
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20,
    order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const r = useFinanceResource<Page>('financeAssignments', {
    page: String(page),
    pageSize: String(pageSize),
    order,
    ...(departmentId ? { departmentId } : {}),
  });
  useEffect(() => {
    if (r.data?.meta.page && r.data.meta.page !== page)
      updateParams((p) => p.set('page', String(r.data!.meta.page)));
  }, [r.data?.meta.page, page, updateParams, r.data]);
  const link = (path: string) => ({ pathname: path, search: location.search });
  const create = canUpdate ? (
    <Button render={<Link to={link('new')} />}>
      <Plus data-icon='inline-start' />
      {t('financeAssignments.new')}
    </Button>
  ) : null;
  const columns: ColumnDef<Assignment>[] = [
    {
      id: 'department',
      header: t('financeAssignments.department'),
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          className='font-medium hover:underline underline-offset-4'
          to={link(row.original.id)}
        >
          <TruncatedText text={row.original.department.title} />
        </Link>
      ),
    },
    {
      id: 'accountant',
      header: t('financeAssignments.accountant'),
      enableSorting: false,
      cell: ({ row }) => <UserName name={row.original.accountant.name} />,
    },
    {
      id: 'active',
      header: t('financeAssignments.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <StatusBadge tone={row.original.active ? 'success' : 'neutral'}>
          {t(
            `financeAssignments.${row.original.active ? 'active' : 'inactive'}`,
          )}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('financeAssignments.updatedAt')}
        />
      ),
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString(i18n.language),
    },
    {
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label={t('financeAssignments.rowActions', {
                  name: row.original.department.title,
                })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-auto min-w-40'>
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to={link(row.original.id)} />}>
                <Eye />
                {t('financeAssignments.view')}
              </DropdownMenuItem>
              {canUpdate ? (
                <DropdownMenuItem
                  render={<Link to={link(`edit/${row.original.id}`)} />}
                >
                  <Pencil />
                  {t('financeAssignments.edit')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('financeAssignments.title')}
        description={t('financeAssignments.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            {create}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('financeAssignments.refresh')}
                    disabled={r.loading}
                    onClick={r.reload}
                  />
                }
              >
                <RefreshCw className={r.loading ? 'animate-spin' : undefined} />
              </TooltipTrigger>
              <TooltipContent>{t('financeAssignments.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      >
        <div data-slot='application-filter' className='flex flex-col gap-2'>
          <Label htmlFor='finance-department'>
            {t('financeAssignments.department')}
          </Label>
          <DepartmentPicker
            id='finance-department'
            value={departmentId}
            onChange={(v) =>
              updateParams((p) => {
                if (v) p.set('departmentId', v);
                else p.delete('departmentId');
                p.delete('page');
              })
            }
          />
        </div>
        {departmentId ? (
          <Button
            variant='outline'
            onClick={() =>
              updateParams((p) => {
                p.delete('departmentId');
                p.delete('page');
              })
            }
          >
            {t('financeAssignments.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <FinanceError error={r.error} retry={r.reload} /> : null}
      {!r.data ? (
        r.loading ? (
          <FinanceSkeleton />
        ) : null
      ) : (
        <DataTableServer
          rows={r.data.data}
          columns={columns}
          total={r.data.meta.total}
          getRowId={(r) => r.id}
          pagination={{ pageIndex: r.data.meta.page - 1, pageSize }}
          onPaginationChange={(v) =>
            updateParams((p) => {
              p.set('page', String(v.pageIndex + 1));
              p.set('pageSize', String(v.pageSize));
            })
          }
          sorting={[{ id: 'updatedAt', desc: order === 'desc' }]}
          onSortingChange={(v) =>
            updateParams((p) => {
              p.set('order', v[0]?.desc === false ? 'asc' : 'desc');
              p.delete('page');
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                `financeAssignments.empty.${departmentId ? 'filtered' : canUpdate ? 'accounts' : 'readonly'}Title`,
              )}
              description={t(
                `financeAssignments.empty.${departmentId ? 'filtered' : canUpdate ? 'accounts' : 'readonly'}Description`,
              )}
              clearFilters={
                departmentId
                  ? {
                      label: t('financeAssignments.clear'),
                      onClick: () =>
                        updateParams((p) => {
                          p.delete('departmentId');
                          p.delete('page');
                        }),
                    }
                  : undefined
              }
            />
          }
        />
      )}
      <Outlet context={{ onSaved: r.reload }} />
    </PageContainer>
  );
}
