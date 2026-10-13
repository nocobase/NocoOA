import { useEffect, useContext } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { ProcessListContext } from './resource.js';
import { useProcessText } from './text.js';
import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useResolvedPath,
  useNavigate,
} from 'react-router';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { useProcessResource } from './resource.js';
import { EmptyList, Failure, Refresh, State } from './shared.js';
import { ProcessGraph } from './graph.js';
import { useNodeSettings } from './use-node-settings.js';
import {
  rulesForNode,
  hasVendorNodeSettings,
  committeeVersionForNode,
} from './node-settings.js';
import type {
  DefinitionDto,
  ExecutionDto,
} from '../../../server/routes/process-management/schemas.js';
export default function ProcessDefinitionPage() {
  const { kind = '' } = useParams(),
    { t } = useTranslation(),
    text = useProcessText(),
    location = useLocation();
  const resource = useProcessResource<{ data: DefinitionDto }>(
      `processManagement/definitions/${encodeURIComponent(kind)}`,
    ),
    data = resource.data?.data;
  const recent = useProcessResource<{ data: ExecutionDto[] }>(
    'processManagement/executions',
    { kind, pageSize: '5' },
  );
  const pagePath = useResolvedPath('.').pathname;
  const navigate = useNavigate();
  const settings = useNodeSettings(kind, Boolean(data) && !resource.error);
  const configurableNodes = new Set(
    data?.states
      .filter(
        (state) =>
          (settings.canUpdateRules &&
            rulesForNode(kind, state.name).length > 0) ||
          (settings.canManageVendor &&
            hasVendorNodeSettings(kind, state.name) &&
            (state.name === 'removalReview' ||
              settings.configuration.data?.data.versions.some(
                (v) => v.version === committeeVersionForNode(kind, state.name),
              ))),
      )
      .map((state) => state.name),
  );
  const reloadList = useContext(ProcessListContext);
  useEffect(() => {
    if (
      resource.error instanceof ApiClientError &&
      [403, 404].includes(resource.error.status)
    )
      reloadList();
  }, [resource.error, reloadList]);
  usePageBreadcrumb([
    {
      label: t('processManagement.definitions'),
      to: {
        pathname: pagePath.replace(/\/[^/]+$/, ''),
        search: location.search,
        hash: location.hash,
      },
    },
    { label: text.name(kind) },
  ]);
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={text.name(kind)}
          actions={
            <Refresh
              busy={resource.loading || recent.loading}
              onClick={() => {
                resource.reload();
                recent.reload();
              }}
            />
          }
        />
        {Boolean(resource.error) && (
          <div className='flex flex-col gap-2'>
            <Failure error={resource.error} retry={resource.reload} />
            <Button
              nativeButton={false}
              variant='outline'
              render={
                <Link
                  to={{
                    pathname: pagePath.replace(/\/[^/]+$/, ''),
                    search: location.search,
                    hash: location.hash,
                  }}
                />
              }
            >
              {t('processManagement.back')}
            </Button>
          </div>
        )}
        {!data && resource.loading ? (
          <ApplicationTableSkeleton />
        ) : (
          data && (
            <>
              <div className='grid items-stretch gap-6 lg:grid-cols-2'>
                <Card className='min-w-0'>
                  <CardHeader>
                    <CardTitle>
                      {t('processManagement.definitionGraph')}
                    </CardTitle>
                    <CardDescription>
                      {t('processManagement.graphDescription')}{' '}
                      {t('processManagement.snapshotConditions')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ProcessGraph
                      definition
                      configurableNodes={configurableNodes}
                      onConfigure={(node) => {
                        void navigate({
                          pathname: `${pagePath}/nodes/${encodeURIComponent(node)}/settings`,
                          search: location.search,
                          hash: location.hash,
                        });
                      }}
                      states={data.states}
                      initial={data.initial}
                      edges={data.transitions.flatMap((edge) =>
                        edge.from.flatMap((from) =>
                          edge.to.map((to) => ({
                            from,
                            to,
                            name: edge.name,
                            conditional:
                              edge.name !== 'edit' && edge.to.length > 1,
                            condition: edge.conditions[to],
                          })),
                        ),
                      )}
                    />
                    <section className='mt-6 flex flex-col gap-2 border-t pt-4'>
                      <h3 className='text-sm font-medium'>
                        {t('processManagement.capabilities')}
                      </h3>
                      <div className='flex flex-wrap gap-2 text-sm'>
                        {data.capabilities.length ? (
                          data.capabilities.map((action) => (
                            <Badge key={action} variant='secondary'>
                              {t(`processManagement.${action}`)}
                            </Badge>
                          ))
                        ) : (
                          <span>{t('processManagement.readOnly')}</span>
                        )}
                      </div>
                      <p className='text-sm text-muted-foreground'>
                        {t('processManagement.safeHistory')}
                      </p>
                    </section>
                  </CardContent>
                </Card>
                <Card className='min-w-0'>
                  <CardHeader>
                    <CardTitle>{t('processManagement.rules')}</CardTitle>
                    <CardDescription className='text-xs'>
                      {t('processManagement.dynamicPeople')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className='text-xs leading-5'>
                    <div className='flex flex-col gap-4'>
                      {data.states.map((state) => {
                        const stage = data.stages.find(
                          (item) => item.name === state.name,
                        );
                        const transitions = data.transitions.filter((edge) =>
                          edge.from.includes(state.name),
                        );
                        if (!stage && !transitions.length) return null;
                        return (
                          <section
                            key={state.name}
                            className='flex flex-col gap-1.5'
                          >
                            <h3 className='text-sm font-medium'>
                              <State value={state.name} />
                            </h3>
                            {stage && (
                              <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                                <span>
                                  {t('processManagement.policy')}:{' '}
                                  {t(
                                    `processManagement.policies.${stage.policy}`,
                                    { defaultValue: stage.policy },
                                  )}
                                </span>
                                <span>
                                  {t('processManagement.peopleSource')}:{' '}
                                  {t(
                                    `processManagement.peopleSources.${stage.peopleSource}`,
                                  )}
                                </span>
                                <span>
                                  {t('processManagement.coveredCount', {
                                    count: stage.covered.length,
                                  })}
                                </span>
                              </div>
                            )}
                            <ul className='flex flex-col gap-1 text-xs'>
                              {transitions.flatMap((edge) =>
                                // Editable state unions describe content edits, not cross-state changes.
                                edge.to
                                  .filter(
                                    (to) =>
                                      edge.name !== 'edit' || to === state.name,
                                  )
                                  .map((to) => (
                                    <li
                                      key={`${edge.name}:${to}`}
                                      className='flex flex-wrap items-baseline gap-2'
                                    >
                                      <span>
                                        {text.transition(edge.name)} →{' '}
                                        {text.state(to)}
                                      </span>
                                      <span className='text-xs text-muted-foreground'>
                                        {t(
                                          edge.manual
                                            ? 'processManagement.manual'
                                            : 'processManagement.automatic',
                                        )}
                                      </span>
                                      {edge.conditions[to] && (
                                        <span className='text-muted-foreground'>
                                          {t(
                                            `processManagement.branchConditions.${edge.conditions[to]}`,
                                          )}
                                        </span>
                                      )}
                                    </li>
                                  )),
                              )}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                    <p className='mt-4 text-xs text-muted-foreground'>
                      {t('processManagement.frozenCount', {
                        count: data.frozen.length,
                      })}
                    </p>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>{t('processManagement.executions')}</CardTitle>
                  <CardDescription>
                    {t('processManagement.recentDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {Boolean(recent.error) && (
                    <Failure error={recent.error} retry={recent.reload} />
                  )}
                  {recent.loading && !recent.data && (
                    <ApplicationTableSkeleton />
                  )}
                  <ul className='flex flex-col gap-2'>
                    {recent.data?.data.map((record) => (
                      <li key={record.id}>
                        <Link
                          className='text-primary hover:underline'
                          to={{
                            pathname: `executions/${record.id}`,
                            search: location.search,
                            hash: location.hash,
                          }}
                        >
                          {record.number ?? record.recordLabel}
                        </Link>{' '}
                        · <State value={record.status} />
                      </li>
                    ))}
                  </ul>
                  {recent.data && !recent.data.data.length && (
                    <EmptyList
                      definitions={false}
                      filtered={false}
                      onClear={() => {}}
                    />
                  )}
                  <div className='mt-4 border-t pt-4'>
                    <Link
                      className='text-sm text-primary underline-offset-4 hover:underline'
                      to={{
                        pathname: '../../executions',
                        search: new URLSearchParams({ kind }).toString(),
                        hash: location.hash,
                      }}
                    >
                      {t('processManagement.viewExecutions')}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </>
          )
        )}
        <Outlet
          context={{
            definition: data,
            loading: resource.loading,
            error: resource.error,
            reload: () => {
              resource.reload();
              settings.rules.reload();
              settings.configuration.reload();
            },
          }}
        />
      </PageContainer>
    </RouteChildPage>
  );
}
