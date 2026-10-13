import { Copy } from 'lucide-react';
import { useToaster } from '@nocobase/app-client';
import { Fragment, useEffect, useMemo } from 'react';
import {
  Link,
  Outlet,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';
import { ApiClientError, usePageBreadcrumb } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import { useResource } from './resource.js';
import { Failure, Loading, Refresh } from './shared.js';
import {
  accountName,
  resource,
  type Balance,
  type Journal,
  type PageContext,
} from './types.js';
const journalActions = [
  'create',
  'reconcile',
  'adjustLimit',
  'hold',
  'reviseHold',
  'allocate',
  'close',
  'consume',
  'releaseEmployee',
  'invalidateReplacement',
  'rebindOut',
  'rebindIn',
  'transferOut',
  'transferIn',
  'claimReplacement',
  'cancelReplacement',
  'fulfillReplacement',
];
export default function HeadcountDetail() {
  const { accountId = '' } = useParams(),
    { t, i18n } = useTranslation(),
    parent = useOutletContext<PageContext>(),
    [params, setParams] = useSearchParams();
  const r = useResource<{ data: Balance }>(
    `headcounts/${encodeURIComponent(accountId)}`,
  );
  const manageGrant = useCan({ resource, action: 'manage' }),
    journalGrant = useCan({ resource, action: 'viewJournal' });
  const manage =
      manageGrant.can && !manageGrant.isPending && !manageGrant.error,
    allowJournal =
      journalGrant.can && !journalGrant.isPending && !journalGrant.error;
  const page = Math.max(1, Math.floor(Number(params.get('journalPage')) || 1)),
    desc = params.get('journalDesc') !== 'false';
  const journal = useResource<{ data: Journal[]; meta: { total: number } }>(
    allowJournal && r.data && !r.error
      ? `headcounts/${encodeURIComponent(accountId)}/journal`
      : null,
    { page: String(page), pageSize: '20', desc: String(desc) },
  );
  const { reload } = parent;
  useEffect(() => {
    if (r.error instanceof ApiClientError && r.error.status === 404) reload();
  }, [r.error, reload]);
  const toaster = useToaster();
  async function copyId(id: string) {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(id);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = id;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        try {
          textarea.select();
          if (!document.execCommand('copy'))
            throw new Error('Copy unavailable');
        } finally {
          textarea.remove();
        }
      }
      toaster.show({ type: 'success', title: t('headcounts.idCopied') });
    } catch {
      toaster.show({ type: 'error', title: t('home.prompt.copyFailed') });
    }
  }
  const name = r.data ? accountName(r.data.data) : t('headcounts.view');
  usePageBreadcrumb([
    {
      label: t('headcounts.title'),
      to: { pathname: parent.source, search: parent.search },
    },
    { label: name },
  ]);
  const { update: updateAccount } = r;
  const { reload: reloadJournal } = journal;
  const context = useMemo<PageContext>(
    () => ({
      ...parent,
      onSaved: (a) => {
        updateAccount({ data: a });
        parent.onSaved(a);
        reloadJournal();
      },
    }),
    [parent, updateAccount, reloadJournal],
  );
  const columns: ColumnDef<Journal>[] = [
    {
      accessorKey: 'at',
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('headcounts.journalColumns.time')}
        />
      ),
      cell: ({ row }) =>
        new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(row.original.at)),
    },
    {
      id: 'actor',
      enableSorting: false,
      header: t('headcounts.journalColumns.actor'),
      cell: ({ row }) => row.original.actor.name,
    },
    {
      id: 'action',
      enableSorting: false,
      header: t('headcounts.journalColumns.action'),
      cell: ({ row }) =>
        t(
          journalActions.includes(row.original.action)
            ? `headcounts.journalActions.${row.original.action}`
            : 'headcounts.journalActions.other',
        ),
    },
    {
      id: 'source',
      enableSorting: false,
      header: t('headcounts.journalColumns.source'),
      cell: ({ row }) =>
        row.original.sourceLink ? (
          <Link
            className='underline'
            to={{
              pathname: `${row.original.sourceLink.kind === 'oa.recruitment' ? 'recruitment' : 'transfer'}/${encodeURIComponent(row.original.sourceLink.id)}`,
              search: params.toString(),
            }}
          >
            {t(
              row.original.sourceLink.kind === 'oa.recruitment'
                ? 'headcounts.recruitmentSource'
                : 'headcounts.transferSource',
            )}
          </Link>
        ) : (
          <TruncatedText text={row.original.sourceReference ?? '—'} />
        ),
    },
    {
      id: 'reason',
      enableSorting: false,
      header: t('headcounts.fields.reason'),
      cell: ({ row }) => <TruncatedText text={row.original.reason} />,
    },
  ];
  const fields = [
    'year',
    'id',
    'version',
    'limit',
    'used',
    'pending',
    'allocated',
    'available',
    'replacementPending',
    'replacementAllocated',
    'replacementBlocked',
    'updatedAt',
  ] as const;
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={name}
          actions={
            <>
              {manage && r.data && !r.loading && !r.error ? (
                <>
                  {!r.data.data.initialized ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: 'reconcile',
                            search: params.toString(),
                          }}
                        />
                      }
                    >
                      {t('headcounts.reconcile')}
                    </Button>
                  ) : null}
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{ pathname: 'adjust', search: params.toString() }}
                      />
                    }
                  >
                    {t('headcounts.adjust')}
                  </Button>
                </>
              ) : null}
              <Refresh
                busy={r.loading || journal.loading}
                onClick={() => {
                  r.reload();
                  journal.reload();
                }}
              />
            </>
          }
        />
        {r.error ? <Failure error={r.error} retry={r.reload} /> : null}
        {r.loading && !r.data ? <Loading /> : null}
        {r.data ? (
          <>
            <dl className='grid grid-cols-1 gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]'>
              {fields.map((key) => (
                <Fragment key={key}>
                  <dt className='text-muted-foreground'>
                    {t(`headcounts.fields.${key}`)}
                  </dt>
                  <dd className='min-w-0 break-words whitespace-pre-wrap'>
                    {key === 'id' ? (
                      <span className='inline-flex max-w-full items-center gap-2'>
                        <span className='min-w-0 break-all'>
                          {r.data!.data.id}
                        </span>
                        <Button
                          type='button'
                          variant='ghost'
                          size='icon-sm'
                          aria-label={t('home.prompt.copy')}
                          onClick={() => void copyId(r.data!.data.id)}
                        >
                          <Copy />
                        </Button>
                      </span>
                    ) : key === 'updatedAt' ? (
                      new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(r.data!.data[key]))
                    ) : key === 'year' ? (
                      String(r.data!.data.year)
                    ) : key === 'available' && !r.data!.data.initialized ? (
                      t('headcounts.uninitialized')
                    ) : typeof r.data!.data[key] === 'number' ? (
                      new Intl.NumberFormat(i18n.language).format(
                        Number(r.data!.data[key]),
                      )
                    ) : (
                      r.data!.data[key] || '—'
                    )}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </>
        ) : null}
        {r.data && !r.data.data.initialized ? (
          <Alert>
            <AlertDescription>
              {t('headcounts.uninitializedHelp')}
            </AlertDescription>
          </Alert>
        ) : null}
        <h2 className='text-base font-medium'>{t('headcounts.journal')}</h2>
        {journalGrant.isPending ? (
          <Loading />
        ) : !allowJournal ? (
          <Alert>
            <AlertDescription>
              {t('headcounts.noJournalPermission')}
            </AlertDescription>
          </Alert>
        ) : journal.error ? (
          <Failure error={journal.error} retry={journal.reload} />
        ) : journal.loading && !journal.data ? (
          <Loading />
        ) : journal.data ? (
          <DataTableServer
            columns={columns}
            rows={journal.data.data}
            total={journal.data.meta.total}
            getRowId={(a) => a.id}
            pagination={{ pageIndex: page - 1, pageSize: 20 }}
            onPaginationChange={(v) =>
              setParams((old) => {
                const n = new URLSearchParams(old);
                n.set('journalPage', String(v.pageIndex + 1));
                return n;
              })
            }
            pageSizeOptions={[20]}
            sorting={[{ id: 'at', desc }]}
            onSortingChange={(v) =>
              setParams((old) => {
                const n = new URLSearchParams(old);
                n.set('journalDesc', String(v[0]?.desc ?? true));
                n.set('journalPage', '1');
                return n;
              })
            }
            emptyMessage={t('headcounts.noJournal')}
          />
        ) : null}
        <Outlet context={context} />
      </PageContainer>
    </RouteChildPage>
  );
}
