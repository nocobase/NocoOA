import { useEffect, useContext } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { ProcessListContext } from './resource.js';
import { useProcessText } from './text.js';
import { ExecutionContext } from './execution-context.js';
import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Link,
  Outlet,
  useLocation,
  useParams,
  useSearchParams,
  useResolvedPath,
} from 'react-router';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { ResponsiveTable } from '#components/responsive-table';
import {
  TableBody,
  TableRow,
  TableHead,
  TableHeader,
  TableCell,
} from '#components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { approvalBusiness } from '../approvals/business-metadata.js';
import { useProcessResource } from './resource.js';
import { Failure, Refresh, State } from './shared.js';
import { ProcessGraph } from './graph.js';
import { TerminateProcess } from './terminate.js';
import type {
  DetailDto,
  DefinitionDto,
} from '../../../server/routes/process-management/schemas.js';
export default function ProcessExecutionPage() {
  const { kind = '', recordId = '' } = useParams(),
    { t, i18n } = useTranslation(),
    text = useProcessText(),
    location = useLocation();
  const [params, setParams] = useSearchParams();
  const resource = useProcessResource<{ data: DetailDto }>(
      `processManagement/executions/${encodeURIComponent(kind)}/${encodeURIComponent(recordId)}`,
    ),
    detail = resource.data?.data;
  const definition = useProcessResource<{ data: DefinitionDto }>(
    `processManagement/definitions/${encodeURIComponent(kind)}`,
  );
  const run =
    detail?.runs.find((r) => r.id === params.get('runId')) ??
    detail?.runs.at(-1);
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: detail?.timeZone,
        }).format(new Date(value))
      : '—';
  const history =
    detail?.transitions
      .filter((e) => e.from)
      .map((e) => ({ from: e.from!, to: e.to, name: e.name })) ?? [];
  const historicStates = [
    ...new Set(
      detail?.transitions.flatMap((e) => (e.from ? [e.from, e.to] : [e.to])) ??
        [],
    ),
  ].map((name) => ({
    name,
    final: name === detail?.record.status && Boolean(detail.record.endedAt),
  }));
  const states = [
    ...(definition.data?.data.states ?? []),
    ...historicStates.filter(
      (state) =>
        !definition.data?.data.states.some((item) => item.name === state.name),
    ),
  ];
  if (detail && !states.some((state) => state.name === detail.record.status))
    states.push({
      name: detail.record.status,
      final: Boolean(detail.record.endedAt),
    });
  const edges =
    definition.data?.data.transitions.flatMap((edge) =>
      edge.from.flatMap((from) =>
        edge.to
          .filter((to) => edge.name !== 'edit' || from === to)
          .map((to) => ({
            from,
            to,
            name: edge.name,
            condition: edge.conditions[to],
          })),
      ),
    ) ?? [];
  const label =
    detail?.record.number ??
    `${text.name(kind)} · ${detail?.record.recordLabel ?? recordId}`;
  const pagePath = useResolvedPath('.').pathname,
    parentPath = pagePath.replace(/\/[^/]+\/[^/]+$/, '');
  const parentQuery = new URLSearchParams(location.search);
  parentQuery.delete('runId');
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
      label: parentPath.includes('/definitions/')
        ? text.name(kind)
        : t('processManagement.executions'),
      to: {
        pathname: parentPath,
        search: parentQuery.toString(),
        hash: location.hash,
      },
    },
    { label: label },
  ]);
  return (
    <ExecutionContext.Provider value={resource}>
      <RouteChildPage>
        <PageContainer>
          <PageHeader
            title={label}
            actions={
              <div className='flex flex-wrap items-center gap-2'>
                {detail?.commentsReadable && approvalBusiness(kind)?.detail && (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: `${approvalBusiness(kind).detail}/${recordId}`,
                          search: location.search,
                          hash: location.hash,
                        }}
                      />
                    }
                  >
                    {t('processManagement.business')}
                  </Button>
                )}
                {detail?.actions.find((a) => a.action === 'terminate') && (
                  <TerminateProcess key={resource.identity} />
                )}
                <Refresh
                  busy={resource.loading || definition.loading}
                  onClick={() => {
                    resource.reload();
                    definition.reload();
                  }}
                />
              </div>
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
                      pathname: parentPath,
                      search: parentQuery.toString(),
                      hash: location.hash,
                    }}
                  />
                }
              >
                {t('processManagement.back')}
              </Button>
            </div>
          )}
          {!detail && resource.loading ? (
            <ApplicationTableSkeleton />
          ) : (
            detail && (
              <>
                <dl className='grid gap-3 text-sm sm:grid-cols-2'>
                  {[
                    [t('processManagement.name'), text.name(kind)],
                    [
                      t('processManagement.applicant'),
                      detail.record.applicant?.name ?? '—',
                    ],
                    [
                      t('processManagement.status'),
                      text.state(detail.record.status),
                    ],
                    [
                      t('processManagement.createdAt'),
                      date(detail.record.createdAt),
                    ],
                    [
                      t('processManagement.endedAt'),
                      date(detail.record.endedAt),
                    ],
                  ].map(([key, value]) => (
                    <div key={key} className='grid grid-cols-2 gap-3'>
                      <dt className='text-muted-foreground'>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {!(
                  detail.commentsReadable && approvalBusiness(kind)?.detail
                ) && (
                  <p className='text-sm text-muted-foreground'>
                    {t('processManagement.businessRestricted')}
                  </p>
                )}
                <div className='grid items-stretch gap-6 lg:grid-cols-2'>
                  <Card className='min-w-0'>
                    <CardHeader>
                      <CardTitle>{t('processManagement.actualPath')}</CardTitle>
                      <CardDescription>
                        {t('processManagement.actualDescription')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {definition.loading && !definition.data && (
                        <ApplicationTableSkeleton />
                      )}
                      {Boolean(definition.error) && (
                        <Failure
                          error={definition.error}
                          retry={definition.reload}
                        />
                      )}
                      {definition.data && (
                        <ProcessGraph
                          states={states}
                          edges={edges}
                          history={history}
                          initial={definition.data.data.initial}
                          current={detail.record.status}
                        />
                      )}
                    </CardContent>
                  </Card>
                  <div className='flex min-w-0 flex-col gap-6'>
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          {t('processManagement.executionHistory')}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ol className='flex flex-col gap-2'>
                          {detail.transitions.map((e) => (
                            <li key={e.id} className='text-sm'>
                              {date(e.at)} · {e.actor?.name ?? '—'} ·{' '}
                              {e.from ? text.state(e.from) : '—'} →{' '}
                              {text.state(e.to)}
                            </li>
                          ))}
                        </ol>
                      </CardContent>
                    </Card>
                    {run && (
                      <Select
                        value={run.id}
                        onValueChange={(value) =>
                          setParams(
                            (p) => {
                              const next = new URLSearchParams(p);
                              if (value) next.set('runId', value);
                              return next;
                            },
                            { replace: true },
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label={t('processManagement.run')}
                          className='w-full sm:w-80'
                        >
                          <SelectValue>
                            {t('processManagement.run')}{' '}
                            {detail.runs.indexOf(run) + 1} ·{' '}
                            {text.state(run.stage)} · {date(run.startedAt)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                          <SelectGroup>
                            {detail.runs.map((r, i) => (
                              <SelectItem key={r.id} value={r.id}>
                                {t('processManagement.run')} {i + 1} ·{' '}
                                {text.state(r.stage)} · {date(r.startedAt)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                    {run?.appoint && (
                      <Button
                        variant='outline'
                        disabled={resource.loading}
                        nativeButton={false}
                        render={
                          <Link
                            to={{
                              pathname: `actions/appoint/${run.id}`,
                              search: location.search,
                              hash: location.hash,
                            }}
                          />
                        }
                      >
                        {t('processManagement.appoint')}
                      </Button>
                    )}
                    {run?.definitionMissing && (
                      <Alert>
                        <AlertDescription>
                          {t('processManagement.definitionMissing')}
                        </AlertDescription>
                      </Alert>
                    )}
                    {!detail.commentsReadable && (
                      <Alert>
                        <AlertDescription>
                          {t('processManagement.commentsRestricted')}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('processManagement.tasks')}</CardTitle>
                        <CardDescription>
                          {t('processManagement.historical')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveTable>
                          <TableHeader>
                            <TableRow>
                              {[
                                'stage',
                                'assignee',
                                'status',
                                'answer',
                                'actor',
                                'comment',
                                'manage',
                              ].map((key) => (
                                <TableHead key={key}>
                                  {t(`processManagement.${key}`)}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {run?.tasks.map((task) => (
                              <TableRow key={task.id}>
                                <TableCell>
                                  <State value={task.stage} />
                                </TableCell>
                                <TableCell>
                                  {task.assignee.name}
                                  {task.previousTaskId && (
                                    <p className='text-xs text-muted-foreground'>
                                      {t('processManagement.previousTask')}:{' '}
                                      {task.previousTaskId}
                                    </p>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <State value={task.status} />
                                </TableCell>
                                <TableCell>
                                  {task.answer ? text.state(task.answer) : '—'}
                                </TableCell>
                                <TableCell>{task.actor?.name ?? '—'}</TableCell>
                                <TableCell className='max-w-64 whitespace-pre-wrap break-words'>
                                  {task.comment ?? '—'}
                                </TableCell>
                                <TableCell>
                                  <div className='flex gap-2'>
                                    {task.actions.map((action) => (
                                      <Button
                                        key={action}
                                        variant='outline'
                                        disabled={resource.loading}
                                        nativeButton={false}
                                        render={
                                          <Link
                                            to={{
                                              pathname: `actions/${action}/${task.id}`,
                                              search: location.search,
                                              hash: location.hash,
                                            }}
                                          />
                                        }
                                      >
                                        {t(`processManagement.${action}`)}
                                      </Button>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </ResponsiveTable>
                        {!run && (
                          <p className='text-sm text-muted-foreground'>
                            {t('processManagement.empty')}
                          </p>
                        )}
                        <div className='mt-3 flex flex-wrap gap-2'>
                          {detail.actions
                            .filter(
                              (a) => a.action !== 'terminate' && !a.allowed,
                            )
                            .map((action) => (
                              <Tooltip key={action.action}>
                                <TooltipTrigger render={<span tabIndex={0} />}>
                                  <Button variant='outline' disabled>
                                    {t(`processManagement.${action.action}`)}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t(
                                    action.reason === 'notConnected'
                                      ? 'processManagement.notConnected'
                                      : 'processManagement.unavailable',
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>{t('processManagement.timeline')}</CardTitle>
                        <CardDescription>
                          {t('processManagement.historical')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ol className='flex flex-col gap-4'>
                          {detail.events
                            .filter(
                              (e) => !run || !e.runId || e.runId === run.id,
                            )
                            .map((event) => (
                              <li
                                key={event.id}
                                className='flex flex-col gap-1 border-l-2 pl-3'
                              >
                                <p className='text-sm'>
                                  {date(event.at)} · {event.actor?.name ?? '—'}{' '}
                                  · {text.event(event.kind)}
                                </p>
                                {event.comment && (
                                  <p className='whitespace-pre-wrap break-words text-sm text-muted-foreground'>
                                    {event.comment}
                                  </p>
                                )}
                              </li>
                            ))}
                        </ol>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </>
            )
          )}
          <Outlet
            context={{ reload: reloadList, reloadDetail: resource.reload }}
          />
        </PageContainer>
      </RouteChildPage>
    </ExecutionContext.Provider>
  );
}
