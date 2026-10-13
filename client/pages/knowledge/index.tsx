import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { ApplicationSearch } from '#components/application-search';
import { UserName } from '#components/user-name';
import { useMemo } from 'react';
import { cn } from 'cn';
import { Link, Outlet, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, FolderTree } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTableServer } from '#components/data-table';
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
import { KnowledgeFolderTree } from './folder-tree.js';
import { useKnowledgeResource } from './resource.js';
import { KnowledgeError } from './states.js';
import { policy, selectWidth, type Document, type Folder } from './types.js';
export default function Knowledge() {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    search = useUrlSearch({ resetParams: ['page'] });
  const p = search.searchParams,
    page = Math.max(1, Number(p.get('page')) || 1),
    pageSize = [10, 20, 50, 100].includes(Number(p.get('pageSize')))
      ? Number(p.get('pageSize'))
      : 20;
  const folderId = p.get('folderId') ?? '',
    orderBy = p.get('orderBy') ?? 'updatedAt:desc';
  const manage = useCan(policy('manage')),
    folderView = useCan(policy('view', true));
  const r = useKnowledgeResource<{ data: Document[]; meta: { total: number } }>(
    'knowledge/documents',
    {
      page: String(page),
      pageSize: String(pageSize),
      orderBy,
      ...(folderId ? { folderId } : {}),
      ...(search.search ? { q: search.search } : {}),
    },
  );
  const folders = useKnowledgeResource<{ data: Folder[] }>(
    folderView.can && !folderView.isPending && !folderView.error
      ? 'knowledge/folders'
      : null,
  );
  const link = (pathname: string) => ({ pathname, search: location.search });
  const folderName = (id: string | null) =>
    !id
      ? t('knowledge.unfiled')
      : (folders.data?.data.find((f) => f.id === id)?.title ??
        t('knowledge.restrictedOption'));
  const columns: ColumnDef<Document>[] = [
    {
      accessorKey: 'title',
      header: t('knowledge.documentTitle'),
      cell: ({ row }) => (
        <Link
          to={link(row.original.id)}
          className='font-medium underline-offset-4 hover:underline'
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'folder',
      header: t('knowledge.folder'),
      cell: ({ row }) => folderName(row.original.folderId),
    },
    { accessorKey: 'version', header: t('knowledge.version') },
    {
      id: 'owner',
      header: t('knowledge.owner'),
      cell: ({ row }) => <UserName name={row.original.owner.name} />,
    },
    {
      accessorKey: 'updatedAt',
      header: t('knowledge.updatedAt'),
      cell: ({ row }) =>
        new Date(row.original.updatedAt).toLocaleString(i18n.language),
    },
  ];
  const visibleFolders =
    folderView.can &&
    !folderView.isPending &&
    !folderView.error &&
    folders.data &&
    !folders.error &&
    !folders.loading
      ? folders.data.data
      : null;
  const context = useMemo(() => ({ reload: r.invalidate }), [r.invalidate]);
  return (
    <PageContainer>
      <PageHeader
        title={t('knowledge.title')}
        description={t('knowledge.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            <ApplicationRefreshButton
              label={t('knowledge.refresh')}
              loading={r.loading}
              onClick={r.reload}
            />
            {folderView.can && !folderView.isPending && !folderView.error ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to={link('folders')} />}
              >
                <FolderTree />
                {t('knowledge.folders')}
              </Button>
            ) : null}
            {manage.can && !manage.isPending && !manage.error ? (
              <Button nativeButton={false} render={<Link to={link('new')} />}>
                <Plus />
                {t('knowledge.new')}
              </Button>
            ) : null}
          </>
        }
      >
        <ApplicationSearch
          {...search.inputProps}
          placeholder={t('knowledge.search')}
          aria-label={t('knowledge.search')}
          className='sm:w-64'
        />
        {folderView.can && !folderView.isPending && !folderView.error ? (
          <Select
            value={folderId || 'all'}
            onValueChange={(value) =>
              search.updateParams((p) => {
                if (!value || value === 'all') p.delete('folderId');
                else p.set('folderId', value);
                p.delete('page');
              })
            }
          >
            <SelectTrigger aria-label={t('knowledge.folder')}>
              <SelectValue>
                {folderId === 'root'
                  ? t('knowledge.unfiled')
                  : folderId
                    ? folderName(folderId)
                    : t('knowledge.allFolders')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={selectWidth}>
              <SelectGroup>
                <SelectItem value='all'>{t('knowledge.allFolders')}</SelectItem>
                <SelectItem value='root'>{t('knowledge.unfiled')}</SelectItem>
                {folders.data?.data.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Select
          value={orderBy}
          onValueChange={(value) =>
            search.updateParams((p) => {
              p.set('orderBy', value ?? 'updatedAt:desc');
              p.delete('page');
            })
          }
        >
          <SelectTrigger aria-label={t('knowledge.order')}>
            <SelectValue>{t(`knowledge.orders.${orderBy}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent className={selectWidth}>
            <SelectGroup>
              {[
                'updatedAt:desc',
                'updatedAt:asc',
                'title:asc',
                'title:desc',
              ].map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`knowledge.orders.${value}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {search.search || folderId ? (
          <Button
            variant='outline'
            onClick={() =>
              search.updateParams((p) => {
                p.delete('q');
                p.delete('folderId');
                p.delete('page');
              })
            }
          >
            {t('knowledge.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {/* Keep the tree beside all document states; minmax prevents wide table content from widening the page. */}
      <div
        className={cn(
          'grid min-w-0 items-start gap-4',
          visibleFolders !== null && 'lg:grid-cols-[16rem_minmax(0,1fr)]',
        )}
      >
        {visibleFolders !== null ? (
          <KnowledgeFolderTree
            folders={visibleFolders}
            selected={folderId}
            choose={(id) =>
              search.updateParams((p) => {
                if (id) p.set('folderId', id);
                else p.delete('folderId');
                p.delete('page');
              })
            }
          />
        ) : null}
        <div className='flex min-w-0 flex-col gap-4'>
          {r.error ? <KnowledgeError error={r.error} retry={r.reload} /> : null}
          {!r.data && r.loading ? (
            <ApplicationTableSkeleton />
          ) : r.data ? (
            <DataTableServer
              columns={columns}
              rows={r.data.data}
              total={r.data.meta.total}
              getRowId={(row) => row.id}
              pageSizeOptions={[10, 20, 50, 100]}
              pagination={{ pageIndex: page - 1, pageSize }}
              onPaginationChange={(next) => {
                const value = next;
                search.updateParams((p) => {
                  p.set('page', String(value.pageIndex + 1));
                  p.set('pageSize', String(value.pageSize));
                });
              }}
              emptyMessage={
                <ApplicationTableEmpty
                  title={t(
                    search.search || folderId
                      ? 'knowledge.noMatch'
                      : 'knowledge.empty',
                  )}
                  clearFilters={
                    search.search || folderId
                      ? {
                          label: t('knowledge.clear'),
                          onClick: () =>
                            search.clear((p) => {
                              p.delete('folderId');
                              p.delete('page');
                            }),
                        }
                      : undefined
                  }
                />
              }
            />
          ) : null}
        </div>
      </div>
      <Outlet context={context} />
    </PageContainer>
  );
}
