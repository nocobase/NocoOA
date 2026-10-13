import { UserName } from '#components/user-name';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useOutletContext,
} from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ApplicationRefreshButton } from '#components/application-refresh-button';
import { MarkdownView } from '#components/markdown-view';
import { RouteChildPage } from '#components/route-child-page';
import { BackButton } from '#components/back-button';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { DataTable } from '#components/data-table';
import { useKnowledgeResource } from './resource.js';
import { KnowledgeError, KnowledgeSkeleton } from './states.js';
import { policy, type Detail, type Version, type Context } from './types.js';
export default function KnowledgeDetail() {
  const { documentId } = useParams(),
    { t, i18n } = useTranslation(),
    location = useLocation(),
    parent = useOutletContext<Context>();
  const r = useKnowledgeResource<{ data: Detail }>(
      `knowledge/documents/${encodeURIComponent(documentId!)}`,
    ),
    manage = useCan(policy('manage'));
  const d = r.data?.data,
    selected = new URLSearchParams(location.search).get('version'),
    v = d?.versions.find(
      (x) => x.id === (selected || d.document.latestVersionId),
    );
  const link = (pathname: string) => ({ pathname, search: location.search });
  return (
    <>
      <RouteChildPage>
        <PageContainer className='max-w-4xl'>
          <BackButton />
          <PageHeader
            title={d?.document.title ?? t('knowledge.detail')}
            actions={
              <>
                {d &&
                manage.can &&
                !manage.isPending &&
                !manage.error &&
                !r.loading &&
                !r.error ? (
                  <Button
                    nativeButton={false}
                    render={<Link to={link('edit')} />}
                  >
                    {t('knowledge.edit')}
                  </Button>
                ) : null}
                <ApplicationRefreshButton
                  label={t('knowledge.refresh')}
                  loading={r.loading}
                  onClick={r.reload}
                />
              </>
            }
          />
          {r.error ? <KnowledgeError error={r.error} retry={r.reload} /> : null}
          {r.loading && !d ? <KnowledgeSkeleton /> : null}
          {d ? (
            <>
              <dl className='grid gap-4 text-sm sm:grid-cols-2 [&>div]:min-w-0 [&_dt]:text-muted-foreground [&_dd]:break-words'>
                <div>
                  <dt>{t('knowledge.owner')}</dt>
                  <dd>
                    <UserName name={d.document.owner.name} />
                  </dd>
                </div>
                <div>
                  <dt>{t('knowledge.updatedAt')}</dt>
                  <dd>
                    {new Date(d.document.updatedAt).toLocaleString(
                      i18n.language,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t('knowledge.version')}</dt>
                  <dd>{d.document.version}</dd>
                </div>
              </dl>
              <section className='flex flex-col gap-3'>
                <h2 className='text-base font-medium'>
                  {t('knowledge.content')}
                </h2>
                {v ? (
                  <Badge
                    className='w-fit'
                    variant={
                      v.id === d.document.latestVersionId
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {t(
                      v.id === d.document.latestVersionId
                        ? 'knowledge.latestVersion'
                        : 'knowledge.historicalVersion',
                    )}{' '}
                    · {v.version}
                  </Badge>
                ) : null}
                {v?.kind === 'markdown' ? (
                  <MarkdownView content={v.markdown ?? ''} />
                ) : v ? (
                  <>
                    <p>{t('knowledge.fileContent')}</p>
                    {!r.loading && !r.error ? (
                      <Button
                        className='w-fit'
                        nativeButton={false}
                        variant='outline'
                        render={
                          <Link
                            to={link(
                              `versions/${encodeURIComponent(v.id)}/preview`,
                            )}
                          />
                        }
                      >
                        {t('knowledge.preview')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <p>{t('knowledge.noReadableVersion')}</p>
                )}
              </section>
              <section>
                <h2 className='mb-3 text-base font-medium'>
                  {t('knowledge.history')}
                </h2>
                <DataTable
                  data={d.versions}
                  columns={[
                    {
                      accessorKey: 'version',
                      header: t('knowledge.version'),
                      cell: ({ row }: { row: { original: Version } }) => (
                        <div className='flex flex-wrap gap-2'>
                          {row.original.version}
                          <Badge
                            variant={
                              row.original.id === d.document.latestVersionId
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {t(
                              row.original.id === d.document.latestVersionId
                                ? 'knowledge.latestVersion'
                                : 'knowledge.historicalVersion',
                            )}
                          </Badge>
                        </div>
                      ),
                    },
                    {
                      id: 'kind',
                      header: t('knowledge.kind'),
                      cell: ({ row }: { row: { original: Version } }) =>
                        t(`knowledge.kinds.${row.original.kind}`),
                    },
                    {
                      id: 'author',
                      header: t('knowledge.author'),
                      cell: ({ row }: { row: { original: Version } }) =>
                        row.original.author.name,
                    },
                    {
                      id: 'date',
                      header: t('knowledge.createdAt'),
                      cell: ({ row }: { row: { original: Version } }) =>
                        new Date(row.original.createdAt).toLocaleString(
                          i18n.language,
                        ),
                    },
                    {
                      id: 'open',
                      header: t('knowledge.content'),
                      cell: ({ row }: { row: { original: Version } }) => (
                        <Link
                          className='underline'
                          to={{
                            search: (() => {
                              const p = new URLSearchParams(location.search);
                              p.set('version', row.original.id);
                              return `?${p}`;
                            })(),
                          }}
                        >
                          {t('knowledge.viewVersion')}
                        </Link>
                      ),
                    },
                  ]}
                  emptyMessage={t('knowledge.noHistory')}
                />
              </section>
            </>
          ) : null}
        </PageContainer>
      </RouteChildPage>
      <Outlet
        context={{
          reload: () => {
            r.invalidate();
            parent.reload();
          },
        }}
      />
    </>
  );
}
