import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useMemo, useRef, useEffect } from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef, CellContext } from '@tanstack/react-table';
import { BadgeCheck, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { useUrlSearch } from '#hooks/use-url-search';
import { useVendorResource } from '../vendors/resource.js';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from './states.js';
import {
  STATUSES,
  stageLabel,
  type QualificationRecord,
  type QualificationOptions,
} from './types.js';
import { Choice } from './shared.js';
interface ListResult {
  data: QualificationRecord[];
  meta: { total: number; page: number; pageSize: number; timeZone: string };
}
export default function QualificationList() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    { session } = useAuthentication();
  const searchRef = useRef<HTMLInputElement>(null);
  const onList = !!useMatch({ path: '/vendorQualifications', end: true });
  const { searchParams, search, inputProps, updateParams, clear } =
    useUrlSearch({ param: 'search', resetParams: ['page'] });
  const view = ['mine', 'pending', 'done', 'copied'].includes(
    searchParams.get('view') ?? '',
  )
    ? searchParams.get('view')!
    : 'mine';
  const status = searchParams.get('status') ?? 'all';
  const sort = ['name', 'number', 'createdAt'].includes(
    searchParams.get('sort') ?? '',
  )
    ? searchParams.get('sort')!
    : 'createdAt';
  const direction = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const p = Number(searchParams.get('page')),
    page = Number.isSafeInteger(p) && p > 0 ? p : 1;
  const size = Number(searchParams.get('pageSize')),
    pageSize = [10, 20, 50, 100].includes(size) ? size : 20;
  const grant = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'submit',
  });
  const ready = grant.can && !grant.isPending && !grant.error;
  const options = useResource<QualificationOptions>(
    ready ? 'vendorQualifications/options' : null,
    { viewer: session?.user.id ?? '' },
  );
  const canCreate =
    ready &&
    !options.loading &&
    !options.error &&
    !!options.data &&
    (options.data.canCreateQualification || options.data.canCreateRemoval);
  const viewGrant = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'view',
  });
  const resource = useVendorResource<ListResult>(
    viewGrant.can && !viewGrant.isPending && !viewGrant.error
      ? 'vendorQualifications'
      : null,
    {
      view,
      page: String(page),
      pageSize: String(pageSize),
      search,
      ...(status !== 'all' ? { status } : {}),
      sort,
      direction,
      viewer: session?.user.id ?? '',
    },
  );
  useEffect(() => {
    if (
      onList &&
      resource.data &&
      !resource.loading &&
      resource.data.meta.page !== page
    )
      updateParams((params) =>
        params.set('page', String(resource.data!.meta.page)),
      );
  }, [onList, resource.data, resource.loading, page, updateParams]);
  const outlet = useMemo(
    () => ({
      reload: resource.reload,
      focusList: () => searchRef.current?.focus(),
    }),
    [resource.reload],
  );
  const columns = useMemo<ColumnDef<QualificationRecord>[]>(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('vendorQualifications.fields.number')}
          />
        ),
        cell: NumberCell,
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('vendorQualifications.fields.name')}
          />
        ),
        cell: ({ row }) => <TruncatedText text={row.original.name} />,
      },
      {
        accessorKey: 'operation',
        header: t('vendorQualifications.fields.operation'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone='neutral'>
            {t(`vendorQualifications.operations.${row.original.operation}`)}
          </StatusBadge>
        ),
      },
      {
        id: 'applicant',
        header: t('vendorQualifications.fields.applicant'),
        enableSorting: false,
        cell: ({ row }) => (
          <UserName
            name={row.original.applicant?.name ?? t('approvals.unknownPerson')}
          />
        ),
      },
      {
        accessorKey: 'status',
        header: t('vendorQualifications.fields.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge tone={statusTone(row.original.status)}>
            {stageLabel(row.original.status, t)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('vendorQualifications.fields.createdAt')}
          />
        ),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeZone: resource.data?.meta.timeZone ?? 'UTC',
          }).format(new Date(row.original.createdAt)),
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
                  aria-label={t('vendorQualifications.rowActions', {
                    name: row.original.name,
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-auto min-w-40' align='end'>
              <DropdownMenuItem
                render={
                  <Link
                    to={{ pathname: row.original.id, search: location.search }}
                  />
                }
              >
                {t('vendorQualifications.details')}
              </DropdownMenuItem>
              {ready &&
                ['draft', 'revision'].includes(row.original.status) &&
                row.original.applicantId === session?.user.id && (
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
                    {t('vendorQualifications.edit')}
                  </DropdownMenuItem>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [
      t,
      i18n.language,
      location.search,
      ready,
      session?.user.id,
      resource.data?.meta.timeZone,
    ],
  );
  const filters = !!search || status !== 'all';
  const empty = resource.data?.meta.total === 0 && !filters;
  const create = canCreate ? (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <Plus />
      {t('vendorQualifications.new')}
    </Button>
  ) : null;
  return (
    <PageContainer>
      <PageHeader
        title={t('vendorQualifications.title')}
        description={t('vendorQualifications.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      disabled={resource.loading}
                      aria-label={t('vendorQualifications.common.refresh')}
                      onClick={() => {
                        resource.reload();
                        options.reload();
                      }}
                    />
                  }
                >
                  <RefreshCw
                    className={resource.loading ? 'animate-spin' : undefined}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t('vendorQualifications.common.refresh')}
                </TooltipContent>
              </Tooltip>
            </>
            {create}
          </>
        }
      >
        <ApplicationSearch
          ref={searchRef}
          className='sm:max-w-xs'
          {...inputProps}
          placeholder={t('vendorQualifications.common.search')}
          aria-label={t('vendorQualifications.common.search')}
        />
        <Choice
          label={t('vendorQualifications.view')}
          value={view}
          items={['mine', 'pending', 'done', 'copied'].map((value) => ({
            value,
            label: t(`approvals.tabs.${value === 'pending' ? 'todo' : value}`),
          }))}
          onChange={(value) =>
            updateParams((params) => {
              params.set('view', value);
              params.delete('page');
            })
          }
        />
        <Choice
          label={t('vendorQualifications.fields.status')}
          value={status}
          items={[
            { value: 'all', label: t('vendorQualifications.allStatuses') },
            ...STATUSES.map((value) => ({
              value,
              label: stageLabel(value, t),
            })),
            ...(options.data?.committeeVersions ?? []).map((v) => ({
              value: `committee_v${v.version}`,
              label: stageLabel(`committee_v${v.version}`, t),
            })),
          ]}
          onChange={(value) =>
            updateParams((params) => {
              params.set('status', value);
              params.delete('page');
            })
          }
        />
        {filters && (
          <Button
            variant='ghost'
            onClick={() =>
              clear((params) => {
                params.delete('status');
                params.delete('page');
              })
            }
          >
            {t('vendorQualifications.clearFilters')}
          </Button>
        )}
      </ApplicationToolbar>
      {!!resource.error && (
        <ErrorState
          context='load'
          error={resource.error}
          retry={resource.reload}
        />
      )}{' '}
      {!!options.error && (
        <ErrorState
          context='load'
          error={options.error}
          retry={options.reload}
        />
      )}
      {!viewGrant.isPending && (viewGrant.error || !viewGrant.can) ? (
        <p className='text-sm text-muted-foreground'>
          {t('vendorQualifications.errors.forbidden')}
        </p>
      ) : !resource.data ? (
        !resource.error && <ApplicationTableSkeleton columns={columns.length} />
      ) : (
        <DataTableServer
          columns={columns}
          rows={resource.data.data}
          total={resource.data.meta.total}
          getRowId={(row) => row.id}
          pagination={{ pageIndex: resource.data.meta.page - 1, pageSize }}
          pageSizeOptions={[10, 20, 50, 100]}
          onPaginationChange={(next) =>
            updateParams((params) => {
              params.set('page', String(next.pageIndex + 1));
              params.set('pageSize', String(next.pageSize));
            })
          }
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onSortingChange={(next) =>
            updateParams((params) => {
              params.set('sort', next[0]?.id ?? 'createdAt');
              params.set('order', next[0]?.desc ? 'desc' : 'asc');
              params.delete('page');
            })
          }
          emptyMessage={
            empty ? (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <BadgeCheck />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t('vendorQualifications.common.empty')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t('vendorQualifications.emptyDescription')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              t('vendorQualifications.common.noResults')
            )
          }
        />
      )}
      <Outlet context={outlet} />
    </PageContainer>
  );
}
function NumberCell({ row }: CellContext<QualificationRecord, unknown>) {
  const location = useLocation(),
    { t } = useTranslation();
  return (
    <Link
      className='font-medium hover:underline'
      to={{ pathname: row.original.id, search: location.search }}
    >
      <TruncatedText text={row.original.number ?? t('approvals.draft')} />
    </Link>
  );
}
