import { ApplicationTableEmpty } from '#components/application-table-empty';
import { statusTone } from './status-tone.js';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationSearch } from '#components/application-search';
import { UserNameText } from '#components/user-name';
import { UserName } from '#components/user-name';
import { useMemo } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { useUrlSearch } from '#hooks/use-url-search';
import { useCertificateResource } from './resource.js';
import { CertificateError } from './states.js';
import { RESOURCE, STATES, selectWidth, type Certificate } from './types.js';
export default function Certificates() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ resetParams: ['page'] });
  const p = search.searchParams,
    page = Math.max(1, Number(p.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(p.get('pageSize')))
      ? Number(p.get('pageSize'))
      : 20;
  const status = STATES.find((s) => s === p.get('status')),
    order = p.get('order') === 'asc' ? 'asc' : 'desc';
  const grant = useCan({
    resource: { type: 'composite', id: RESOURCE },
    action: 'create',
  });
  const r = useCertificateResource<{
    data: { items: Certificate[]; total: number };
  }>('certificateRequests', {
    page: String(page),
    pageSize: String(pageSize),
    order,
    ...(status ? { status } : {}),
    ...(search.search ? { q: search.search } : {}),
  });
  const context = useMemo(() => ({ reload: r.invalidate }), [r.invalidate]);
  const link = (pathname: string) => ({ pathname, search: location.search });
  const columns: ColumnDef<Certificate, unknown>[] = [
    {
      id: 'name',
      header: t('certificates.name'),
      cell: ({ row }) => (
        <Link
          to={link(row.original.id)}
          className='font-medium underline-offset-4 hover:underline'
        >
          <UserNameText
            text={
              row.original.number ??
              t('certificates.recordName', {
                name: row.original.applicant.name,
              })
            }
            name={row.original.applicant.name}
          />
        </Link>
      ),
    },
    {
      id: 'type',
      header: t('certificates.type'),
      cell: ({ row }) =>
        t(`certificates.types.${row.original.certificateType}`),
    },
    {
      id: 'purpose',
      header: t('certificates.purpose'),
      cell: ({ row }) => <TruncatedText text={row.original.purpose} />,
    },
    {
      id: 'applicant',
      header: t('certificates.applicant'),
      cell: ({ row }) => <UserName name={row.original.applicant.name} />,
    },
    {
      id: 'createdAt',
      header: t('certificates.createdAt'),
      cell: ({ row }) =>
        new Date(row.original.createdAt).toLocaleString(i18n.language),
    },
    {
      id: 'status',
      header: t('certificates.status'),
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {t(`certificates.states.${row.original.status}`)}
        </StatusBadge>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('certificates.title')}
        description={t('certificates.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('certificates.refresh')}
              loading={r.loading}
              onClick={r.reload}
            />
            {grant.can && !grant.isPending && !grant.error ? (
              <Button nativeButton={false} render={<Link to={link('new')} />}>
                <Plus />
                {t('certificates.new')}
              </Button>
            ) : null}
          </>
        }
      >
        <>
          <ApplicationSearch
            {...search.inputProps}
            placeholder={t('certificates.search')}
            aria-label={t('certificates.search')}
            className='sm:w-64'
          />
          <Select
            value={status ?? 'all'}
            onValueChange={(v) =>
              search.updateParams((p) => {
                if (v === 'all') p.delete('status');
                else if (v) p.set('status', v);
                p.delete('page');
              })
            }
          >
            <SelectTrigger aria-label={t('certificates.status')}>
              <SelectValue>
                {status
                  ? t(`certificates.states.${status}`)
                  : t('certificates.all')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={selectWidth}>
              <SelectGroup>
                <SelectItem value='all'>{t('certificates.all')}</SelectItem>
                {STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`certificates.states.${s}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {search.search || status ? (
            <Button
              variant='outline'
              onClick={() =>
                search.clear((p) => {
                  p.delete('status');
                  p.delete('page');
                })
              }
            >
              {t('certificates.clear')}
            </Button>
          ) : null}
          <Button
            variant='outline'
            onClick={() =>
              search.updateParams((p) =>
                p.set('order', order === 'asc' ? 'desc' : 'asc'),
              )
            }
          >
            {t(`certificates.${order === 'asc' ? 'oldest' : 'newest'}`)}
          </Button>
        </>
      </ApplicationToolbar>
      {r.error ? <CertificateError error={r.error} retry={r.reload} /> : null}
      {r.loading && !r.data ? <ApplicationTableSkeleton /> : null}
      {r.data ? (
        <DataTableServer
          columns={columns}
          rows={r.data.data.items}
          total={r.data.data.total}
          getRowId={(v) => v.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(next) =>
            search.updateParams((p) => {
              p.set('page', String(next.pageIndex + 1));
              p.set('pageSize', String(next.pageSize));
            })
          }
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                `certificates.${search.search || status ? 'noMatch' : 'empty'}`,
              )}
              clearFilters={
                search.search || status
                  ? {
                      label: t('certificates.clear'),
                      onClick: () =>
                        search.clear((p) => {
                          p.delete('status');
                          p.delete('page');
                        }),
                    }
                  : undefined
              }
            />
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      ) : null}
      <Outlet context={context} />
    </PageContainer>
  );
}
