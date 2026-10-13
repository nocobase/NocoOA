import { statusTone } from './status-tone.js';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useMemo, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, FileSignature, MoreHorizontal } from 'lucide-react';
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
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useUrlSearch } from '#hooks/use-url-search';
import { usePage } from './resource.js';
import { useResource } from '../approvals/use-resource.js';
import type { Options } from './types.js';
import { ErrorState, Choice, Refresh } from './shared.js';
import { STATUSES, type ContractRecord, type LedgerContract } from './types.js';
import { money, dateLabel } from './model.js';
export default function RequestsPage() {
  return <ContractList ledger={false} />;
}
export function ContractList({ ledger }: { ledger: boolean }) {
  const { session } = useAuthentication();
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    ref = useRef<HTMLInputElement>(null);
  const { searchParams, search, inputProps, updateParams, clear } =
    useUrlSearch({ param: 'search', resetParams: ['page'] });
  const sortKeys = ledger
    ? ['number', 'amountCents', 'updatedAt']
    : ['number', 'amountCents', 'createdAt'];
  const sort = sortKeys.includes(searchParams.get('sort') ?? '')
    ? searchParams.get('sort')!
    : sortKeys[2];
  const direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc';
  const views = ['mine', 'pending', 'done', 'copied'];
  const view = views.includes(searchParams.get('view') ?? '')
    ? searchParams.get('view')!
    : 'mine';
  const statuses: readonly string[] = ledger
    ? ['activePendingSeal', 'active', 'terminated']
    : STATUSES;
  const status = statuses.includes(searchParams.get('status') ?? '')
    ? searchParams.get('status')!
    : 'all';
  const pageValue = Number(searchParams.get('page'));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const sizeValue = Number(searchParams.get('pageSize'));
  const pageSize = [10, 20, 50, 100].includes(sizeValue) ? sizeValue : 20;
  const query = {
    page: String(page),
    pageSize: String(pageSize),
    search,
    sort,
    direction,
    ...(status !== 'all' ? { status } : {}),
    ...(!ledger ? { view } : {}),
  };
  const resource = usePage<Partial<ContractRecord> & Partial<LedgerContract>>(
    ledger ? 'contracts' : 'contractRequests',
    query,
  );
  const submit = useCan({
    resource: { type: 'composite', id: 'oa.contract' },
    action: 'submit',
  });
  const creator = useResource<Options>(
    !ledger && submit.can && !submit.isPending && !submit.error
      ? 'contractRequests/options'
      : null,
    { viewer: session?.user.id ?? '' },
  );
  const canCreate =
    !ledger &&
    submit.can &&
    !submit.isPending &&
    !submit.error &&
    !creator.loading &&
    !creator.error &&
    creator.data?.eligible === true;
  const data = resource.data,
    filtered = !!search || status !== 'all',
    empty = !!data && data.meta.total === 0 && !filtered;
  const context = useMemo(
    () => ({ reload: resource.reload, focusList: () => ref.current?.focus() }),
    [resource.reload],
  );
  const create = canCreate ? (
    <Button
      nativeButton={false}
      render={
        <Link to={{ pathname: 'newContract', search: location.search }} />
      }
    >
      <Plus data-icon='inline-start' />
      {t('contracts.new')}
    </Button>
  ) : null;
  const timeZone = data?.meta.timeZone ?? 'UTC',
    actorId = session?.user.id;
  const columns = useMemo<
    ColumnDef<Partial<ContractRecord> & Partial<LedgerContract>>[]
  >(
    () => [
      {
        accessorKey: 'number',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('contracts.number')}
          />
        ),
        cell: ({ row }) => (
          <Link
            className='font-medium text-primary underline-offset-4 hover:underline'
            to={{
              pathname: `${ledger ? 'contractLedger' : 'contract'}/${row.original.id}`,
              search: location.search,
            }}
          >
            <TruncatedText
              text={row.original.number ?? t('contracts.draftName')}
            />
          </Link>
        ),
      },
      ...(!ledger
        ? ([
            {
              id: 'operation',
              enableSorting: false,
              header: t('contracts.operation'),
              cell: ({ row }) => (
                <StatusBadge tone='neutral'>
                  {row.original.operation
                    ? t(`contracts.operations.${row.original.operation}`)
                    : '—'}
                </StatusBadge>
              ),
            },
            {
              id: 'contractType',
              enableSorting: false,
              header: t('contracts.contractType'),
              cell: ({ row }) => (
                <StatusBadge tone='neutral'>
                  {row.original.contractType ?? '—'}
                </StatusBadge>
              ),
            },
            {
              id: 'counterparty',
              enableSorting: false,
              header: t('contracts.counterparty'),
              cell: ({ row }) => (
                <TruncatedText text={row.original.counterparty?.name ?? '—'} />
              ),
            },
          ] as ColumnDef<Partial<ContractRecord> & Partial<LedgerContract>>[])
        : []),
      {
        accessorKey: 'amountCents',
        meta: { className: 'text-right' },
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('contracts.amountCents')}
          />
        ),
        cell: ({ row }) => (
          <span className='block text-right tabular-nums'>
            {money(row.original.amountCents, i18n.language)}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        enableSorting: false,
        header: t('contracts.status'),
        cell: ({ row }) => (
          <StatusBadge tone={statusTone(row.original.status)}>
            {row.original.status
              ? t(`contracts.statuses.${row.original.status}`)
              : '—'}
          </StatusBadge>
        ),
      },
      {
        accessorKey: ledger ? 'updatedAt' : 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t(ledger ? 'contracts.updatedAt' : 'contracts.createdAt')}
          />
        ),
        cell: ({ row }) =>
          dateLabel(
            ledger ? row.original.updatedAt : row.original.createdAt,
            i18n.language,
            timeZone,
          ),
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
                  disabled={resource.loading || !!resource.error}
                  aria-label={t('contracts.actionsFor', {
                    name: row.original.number ?? t('contracts.draftName'),
                  })}
                />
              }
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-auto min-w-40'>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  render={
                    <Link
                      to={{
                        pathname: `${ledger ? 'contractLedger' : 'contract'}/${row.original.id}`,
                        search: location.search,
                      }}
                    />
                  }
                >
                  {t('contracts.detail')}
                </DropdownMenuItem>
                {!ledger &&
                canCreate &&
                ['draft', 'revision'].includes(row.original.status ?? '') &&
                row.original.applicantId === actorId ? (
                  <DropdownMenuItem
                    render={
                      <Link
                        to={{
                          pathname: `editContract/${row.original.id}`,
                          search: location.search,
                        }}
                      />
                    }
                  >
                    {t('contracts.edit')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [
      t,
      i18n.language,
      ledger,
      location.search,
      resource.loading,
      resource.error,
      canCreate,
      timeZone,
      actorId,
    ],
  );
  function clearFilters() {
    clear((p) => {
      p.delete('status');
      p.delete('page');
    });
  }
  return (
    <PageContainer>
      <PageHeader
        title={t(ledger ? 'contracts.ledgerTitle' : 'contracts.title')}
        description={t(
          ledger ? 'contracts.ledgerDescription' : 'contracts.description',
        )}
      />
      <ApplicationToolbar
        actions={
          <>
            <>
              <Refresh busy={resource.loading} onClick={resource.reload} />
            </>
            {create}
          </>
        }
      >
        <ApplicationSearch
          ref={ref}
          className='sm:max-w-xs'
          aria-label={t(ledger ? 'contracts.ledgerSearch' : 'contracts.search')}
          placeholder={t(
            ledger ? 'contracts.ledgerSearch' : 'contracts.search',
          )}
          {...inputProps}
        />
        {!ledger && (
          <div className='w-full sm:w-40'>
            <Choice
              label={t('contracts.view')}
              value={view}
              items={views.map((v) => ({
                value: v,
                label: t(`contracts.views.${v}`),
              }))}
              onChange={(v) =>
                updateParams((p) => {
                  p.set('view', v);
                  p.delete('page');
                })
              }
            />
          </div>
        )}
        <div className='w-full sm:w-48'>
          <Choice
            label={t('contracts.status')}
            value={status}
            items={[
              { value: 'all', label: t('contracts.allStatuses') },
              ...statuses.map((v) => ({
                value: v,
                label: t(`contracts.statuses.${v}`),
              })),
            ]}
            onChange={(v) =>
              updateParams((p) => {
                if (v === 'all') p.delete('status');
                else p.set('status', v);
                p.delete('page');
              })
            }
          />
        </div>
        {filtered && (
          <Button variant='ghost' onClick={clearFilters}>
            {t('contracts.clear')}
          </Button>
        )}
      </ApplicationToolbar>
      {resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : null}
      {!data ? (
        !resource.error && <ApplicationTableSkeleton columns={columns.length} />
      ) : (
        <DataTableServer
          columns={columns}
          rows={data.data}
          total={data.meta.total}
          getRowId={(row) => row.id ?? ''}
          pagination={{
            pageIndex: data.meta.page - 1,
            pageSize: data.meta.pageSize,
          }}
          pageSizeOptions={[10, 20, 50, 100]}
          sorting={[{ id: sort, desc: direction === 'desc' }]}
          onPaginationChange={(v) =>
            updateParams((p) => {
              p.set('page', String(v.pageIndex + 1));
              p.set('pageSize', String(v.pageSize));
            })
          }
          onSortingChange={(v) =>
            updateParams((p) => {
              p.set('sort', v[0]?.id ?? sortKeys[2]);
              p.set('direction', v[0]?.desc === false ? 'asc' : 'desc');
              p.delete('page');
            })
          }
          emptyMessage={
            empty ? (
              <Empty className='min-h-48'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <FileSignature />
                  </EmptyMedia>
                  <EmptyTitle>
                    {t(ledger ? 'contracts.ledgerEmpty' : 'contracts.empty')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t(
                      ledger
                        ? 'contracts.ledgerEmptyDescription'
                        : canCreate
                          ? 'contracts.emptyDescription'
                          : 'contracts.emptyReadOnly',
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className='flex flex-col items-center gap-2'>
                <span>{t('contracts.noResults')}</span>
                <Button variant='outline' onClick={clearFilters}>
                  {t('contracts.clear')}
                </Button>
              </div>
            )
          }
        />
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}
