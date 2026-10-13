import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { Link, Outlet, useLocation } from 'react-router';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTable } from '#components/data-table';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { useSealResource } from './resource.js';
import { SealError } from './states.js';
export interface SealInstance {
  id: string;
  code: string;
  name: string;
  sealType: string;
  active: boolean;
  version: number;
}
export default function Instances() {
  const { t } = useTranslation(),
    location = useLocation();
  const r = useSealResource<{ data: SealInstance[] }>('seals');
  const manage = useCan({
    resource: { type: 'composite', id: 'oa.seals' },
    action: 'manage',
  });
  const allowed = manage.can && !manage.isPending && !manage.error;
  const link = (pathname: string) => ({
    pathname,
    search: location.search,
    hash: location.hash,
  });
  const columns: ColumnDef<SealInstance, unknown>[] = [
    { accessorKey: 'code', header: t('seals.instanceCode') },
    { accessorKey: 'name', header: t('seals.instanceName') },
    {
      accessorKey: 'sealType',
      header: t('seals.sealType'),
      cell: ({ row }) => (
        <Badge variant='outline'>{row.original.sealType}</Badge>
      ),
    },
    {
      id: 'active',
      header: t('seals.instanceActive'),
      cell: ({ row }) => (
        <Badge variant='outline'>
          {t(row.original.active ? 'seals.yes' : 'seals.no')}
        </Badge>
      ),
    },
    { accessorKey: 'version', header: t('seals.instanceVersion') },
    ...(allowed
      ? [
          {
            id: 'edit',
            header: t('seals.editInstance'),
            cell: ({ row }: { row: { original: SealInstance } }) => (
              <Button
                variant='ghost'
                nativeButton={false}
                render={<Link to={link(`edit/${row.original.id}`)} />}
              >
                {t('seals.editInstance')}
              </Button>
            ),
          },
        ]
      : []),
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('seals.instances')}
        description={t('seals.instanceNotice')}
      />
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('seals.refresh')}
              loading={r.loading}
              onClick={r.reload}
            />
            {allowed ? (
              <Button nativeButton={false} render={<Link to={link('new')} />}>
                {t('seals.newInstance')}
              </Button>
            ) : null}
          </>
        }
      />
      {r.error ? (
        <SealError
          returnTo='/seal-instances'
          error={r.error}
          retry={r.reload}
        />
      ) : null}
      {r.loading && !r.data ? <ApplicationTableSkeleton /> : null}
      {r.data ? (
        <DataTable
          columns={columns}
          data={r.data.data}
          emptyMessage={t('seals.emptyInstances')}
        />
      ) : null}
      <Outlet context={{ reload: r.invalidate }} />
    </PageContainer>
  );
}
