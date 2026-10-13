import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
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
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { TruncatedText } from '#components/truncated-text';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { useUrlSearch } from '#hooks/use-url-search';
import { useSealResource } from './resource.js';
import { SealError } from './states.js';
import { STATES, type SealRequest } from './types.js';
export default function SealRequests() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ resetParams: ['page'] }),
    p = search.searchParams,
    page = Math.max(1, Number(p.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(p.get('pageSize')))
      ? Number(p.get('pageSize'))
      : 20,
    status = p.get('status') ?? '',
    order = p.get('order') === 'asc' ? 'asc' : 'desc';
  const grant = useCan({
      resource: { type: 'composite', id: 'oa.sealRequests' },
      action: 'create',
    }),
    r = useSealResource<{ data: SealRequest[] }>('sealRequests');
  const rows = (r.data?.data ?? [])
    .filter(
      (v) =>
        (!status || v.status === status) &&
        (!search.search ||
          [v.number, v.purpose, v.applicant.name].some((x) =>
            x?.toLocaleLowerCase().includes(search.search.toLocaleLowerCase()),
          )),
    )
    .sort(
      (a, b) =>
        (order === 'asc' ? 1 : -1) * a.createdAt.localeCompare(b.createdAt),
    );
  const columns: ColumnDef<SealRequest, unknown>[] = [
    {
      id: 'number',
      header: t('seals.number'),
      cell: ({ row }) => (
        <Link
          to={{
            pathname: row.original.id,
            search: location.search,
            hash: location.hash,
          }}
          className='font-medium hover:underline'
        >
          <TruncatedText text={row.original.number ?? t('seals.draft')} />
        </Link>
      ),
    },
    {
      id: 'purpose',
      header: t('seals.purpose'),
      cell: ({ row }) => <TruncatedText text={row.original.purpose} />,
    },
    {
      id: 'applicant',
      header: t('seals.applicant'),
      cell: ({ row }) => <UserName name={row.original.applicant.name} />,
    },
    {
      id: 'sealType',
      header: t('seals.sealType'),
      cell: ({ row }) => t(`seals.types.${row.original.sealType}`),
    },
    {
      id: 'copies',
      header: t('seals.copies'),
      cell: ({ row }) => (
        <span className='block text-right tabular-nums'>
          {row.original.copies.toLocaleString(i18n.language)}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('seals.status'),
      cell: ({ row }) => (
        <StatusBadge tone={statusTone(row.original.status)}>
          {t(`seals.states.${row.original.status}`)}
        </StatusBadge>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('seals.title')}
        description={t('seals.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('seals.refresh')}
              loading={r.loading}
              onClick={r.reload}
            />
            {grant.can && !grant.isPending && !grant.error ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: 'new',
                      search: location.search,
                      hash: location.hash,
                    }}
                  />
                }
              >
                <Plus />
                {t('seals.new')}
              </Button>
            ) : null}
          </>
        }
      >
        <ApplicationSearch
          {...search.inputProps}
          aria-label={t('seals.search')}
          placeholder={t('seals.search')}
          className='sm:w-64'
        />
        <Select
          value={status || 'all'}
          onValueChange={(v) =>
            search.updateParams((p) => {
              if (v && v !== 'all') p.set('status', v);
              else p.delete('status');
              p.delete('page');
            })
          }
        >
          <SelectTrigger aria-label={t('seals.status')}>
            <SelectValue>
              {status ? t(`seals.states.${status}`) : t('seals.all')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value='all'>{t('seals.all')}</SelectItem>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`seals.states.${s}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {status || search.search ? (
          <Button
            variant='outline'
            onClick={() =>
              search.clear((p) => {
                p.delete('status');
                p.delete('page');
              })
            }
          >
            {t('seals.clear')}
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
          {t(order === 'asc' ? 'seals.oldest' : 'seals.newest')}
        </Button>
      </ApplicationToolbar>
      {r.error ? <SealError error={r.error} retry={r.reload} /> : null}
      {r.loading && !r.data ? <ApplicationTableSkeleton /> : null}
      {r.data ? (
        <DataTableServer
          columns={columns}
          rows={rows.slice((page - 1) * pageSize, page * pageSize)}
          total={rows.length}
          getRowId={(v) => v.id}
          pagination={{ pageIndex: page - 1, pageSize }}
          onPaginationChange={(next) =>
            search.updateParams((p) => {
              p.set('page', String(next.pageIndex + 1));
              p.set('pageSize', String(next.pageSize));
            })
          }
          pageSizeOptions={[10, 20, 50, 100]}
          emptyMessage={t(
            status || search.search ? 'seals.noMatch' : 'seals.empty',
          )}
        />
      ) : null}
      <Outlet context={{ reload: r.invalidate }} />
    </PageContainer>
  );
}
