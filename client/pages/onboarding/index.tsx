import { ApplicationTableEmpty } from '#components/application-table-empty';
import { StatusBadge } from '#components/status-badge';
import { statusTone } from './status-tone.js';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { UserName } from '#components/user-name';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Link,
  Outlet,
  useLocation,
  useResolvedPath,
  useSearchParams,
} from 'react-router';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer } from '#components/data-table';
import { Button } from '#components/ui/button';
import { OptionSelect } from '../work-items/select.js';
import { Failure } from '../work-items/states.js';
import { useOnboardingResource } from './resource.js';
import { resource, type RecordDto } from './types.js';
export default function List() {
  const { t } = useTranslation(),
    location = useLocation(),
    basePath = useResolvedPath('.').pathname,
    [params, setParams] = useSearchParams();
  const view = useCan({ resource, action: 'view' }),
    create = useCan({ resource, action: 'create' }),
    allowed = view.can && !view.isPending && !view.error;
  const status = ['handling', 'completed', 'cancelled'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : 'all';
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(Number(params.get('pageSize')))
      ? Number(params.get('pageSize'))
      : 20;
  const r = useOnboardingResource<{
    data: RecordDto[];
    meta: { total: number };
  }>(allowed ? 'onboardings' : null, {
    page: String(page),
    pageSize: String(pageSize),
    ...(status === 'all' ? {} : { status }),
  });
  const columns: ColumnDef<RecordDto>[] = [
    {
      id: 'employee',
      header: t('onboarding.employee'),
      cell: ({ row }) => (
        <Link
          className='font-medium text-foreground underline-offset-4 hover:underline'
          to={{
            pathname: `${basePath}/${row.original.id}`,
            search: location.search,
            hash: location.hash,
          }}
        >
          <UserName name={row.original.user.name} />
        </Link>
      ),
    },
    { accessorKey: 'hireDate', header: t('onboarding.fields.hireDate') },
    {
      id: 'creator',
      header: t('onboarding.creator'),
      cell: ({ row }) => <UserName name={row.original.creator.name} />,
    },
    {
      accessorKey: 'status',
      header: t('onboarding.status'),
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {t(`onboarding.states.${row.original.status}`)}
        </StatusBadge>
      ),
    },
  ];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('onboarding.title')}
          description={t('onboarding.description')}
        />
        {view.isPending ? (
          <ApplicationTableSkeleton columns={4} />
        ) : !allowed ? (
          <Failure denied error={view.error} />
        ) : (
          <>
            <ApplicationToolbar
              actions={
                <>
                  <ApplicationRefreshButton
                    label={t('onboarding.refresh')}
                    loading={r.loading}
                    onClick={r.reload}
                  />
                  {create.can && !create.isPending && !create.error ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: `${basePath}/new`,
                            search: location.search,
                            hash: location.hash,
                          }}
                        />
                      }
                    >
                      <Plus />
                      {t('onboarding.new')}
                    </Button>
                  ) : null}
                </>
              }
            >
              <OptionSelect
                value={status}
                options={['all', 'handling', 'completed', 'cancelled'].map(
                  (value) => ({
                    value,
                    label: t(`onboarding.states.${value}`),
                  }),
                )}
                onChange={(value) =>
                  setParams((old) => {
                    old.set('status', value);
                    old.delete('page');
                    return old;
                  })
                }
              />
            </ApplicationToolbar>
            {r.loading && !r.data ? (
              <ApplicationTableSkeleton columns={4} />
            ) : r.error ? (
              <Failure module='onboarding' error={r.error} retry={r.reload} />
            ) : r.data ? (
              <DataTableServer
                columns={columns}
                rows={r.data.data}
                total={r.data.meta.total}
                getRowId={(row) => row.id}
                pageSizeOptions={[10, 20, 50, 100]}
                pagination={{ pageIndex: page - 1, pageSize }}
                onPaginationChange={(v) =>
                  setParams((old) => {
                    old.set('page', String(v.pageIndex + 1));
                    old.set('pageSize', String(v.pageSize));
                    return old;
                  })
                }
                emptyMessage={
                  <ApplicationTableEmpty
                    title={t('onboarding.empty')}
                    clearFilters={
                      status
                        ? {
                            label: t('onboarding.clear'),
                            onClick: () =>
                              setParams((p) => {
                                p.delete('status');
                                p.delete('page');
                                return p;
                              }),
                          }
                        : undefined
                    }
                  />
                }
              />
            ) : null}
          </>
        )}
      </PageContainer>
      <Outlet context={{ basePath, reload: r.reload }} />
    </>
  );
}
