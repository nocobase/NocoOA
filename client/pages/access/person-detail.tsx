import { UserName } from '#components/user-name';
import { useCallback, useMemo } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import { usePageBreadcrumb } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { useAuthorizationClient } from '../administration/authorization/use-authorization-client.js';
import { titleText } from '../administration/authorization/i18n.js';
import type { AuthorizationInspection } from '../administration/authorization/authorization-client.js';
import { useCatalog, useLoad } from './hooks.js';
import { resources } from './model.js';
import { AccessModulePermissions } from './module-permissions.js';
import { resourceKey } from '../administration/authorization/pages/permission-sets/drafts.js';
import { Blank, ErrorState, Loading, Refresh } from './ui.js';

export default function PersonDetail() {
  const { userId = '' } = useParams();
  const { t } = useTranslation();
  const client = useAuthorizationClient();
  const location = useLocation();
  const parent = useOutletContext<{ reload: () => void }>();
  const catalog = useCatalog('inspector');
  const subject = useMemo(() => ({ type: 'user', id: userId }), [userId]);
  const data = useLoad(
    useCallback(async () => {
      const configured = await client.inspectConfigured(subject);
      const [namesResult, definitionsResult] = await Promise.allSettled([
        client.resolveSubjects('inspector', 'user', [userId]),
        client.getEffective(subject),
      ]);
      const names = namesResult.status === 'fulfilled' ? namesResult.value : [];
      const definitions =
        definitionsResult.status === 'fulfilled' ? definitionsResult.value : [];
      let sourceError: unknown =
        namesResult.status === 'rejected' ? namesResult.reason : undefined;
      const definitionsError: unknown =
        definitionsResult.status === 'rejected'
          ? definitionsResult.reason
          : undefined;
      const inherited = [
        ...new Map(
          (configured.sets ?? [])
            .flatMap((set) => set.sources)
            .map((entry) => [JSON.stringify(entry), entry]),
        ).values(),
      ];
      const sourceNames: Record<string, string> = {};
      for (const type of new Set(inherited.map((entry) => entry.type))) {
        try {
          const entries = await client.resolveSubjects(
            'inspector',
            type,
            inherited
              .filter((entry) => entry.type === type)
              .map((entry) => entry.id),
          );
          for (const entry of entries)
            sourceNames[`${type}:${entry.id}`] = titleText(entry.title, t);
        } catch (cause) {
          sourceError = cause;
        }
      }
      return {
        configured,
        definitions,
        sourceError,
        definitionsError,
        name: names[0]
          ? titleText(names[0].title, t)
          : t('access.personUnknown'),
        sourceNames,
      };
    }, [client, subject, userId, t]),
  );
  const checks = useMemo(
    () =>
      catalog.options
        ? resources(catalog.options).flatMap((resource) =>
            (
              resource.actions ?? [{ value: 'access', label: resource.label }]
            ).map((action) => ({
              resource: { type: resource.type, id: resource.value },
              action: action.value,
            })),
          )
        : [],
    [catalog.options],
  );
  const decisions = useLoad(
    useCallback(async (): Promise<{
      items: AuthorizationInspection[];
      failed: boolean;
      failedChecks: typeof checks;
    }> => {
      const items: AuthorizationInspection[] = [];
      let failed = false;
      const failedChecks: typeof checks = [];
      for (let offset = 0; offset < checks.length; offset += 100) {
        try {
          items.push(
            ...(await client.inspectBatch(
              subject,
              checks.slice(offset, offset + 100),
            )),
          );
        } catch {
          failed = true;
          failedChecks.push(...checks.slice(offset, offset + 100));
        }
      }
      return { items, failed, failedChecks };
    }, [client, subject, checks]),
  );
  const canAssign = useCan({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    action: 'assign',
  }).can;
  const canReadSets = useCan({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    action: 'read',
  }).can;
  const base = `/access/people/${encodeURIComponent(userId)}`;
  const tab = location.pathname.includes('/personal') ? 'personal' : 'sources';
  const name = data.data?.name ?? t('access.loading');
  usePageBreadcrumb([
    { label: t('access.title'), to: `/access/people${location.search}` },
    { label: name },
  ]);
  const reload = () => {
    data.reload();
    decisions.reload();
    catalog.reload();
    parent?.reload();
  };
  return (
    <RecordDetailDrawer
      title={<UserName name={name} />}
      description={t('access.personHelp')}
      footer={<Refresh busy={data.busy || decisions.busy} reload={reload} />}
    >
      <div className='space-y-6'>
        <nav className='flex gap-2'>
          <Button
            variant={tab === 'sources' ? 'secondary' : 'ghost'}
            nativeButton={false}
            render={<Link to={`${base}/sources${location.search}`} />}
          >
            {t('access.source')}
          </Button>
          <Button
            variant={tab === 'personal' ? 'secondary' : 'ghost'}
            nativeButton={false}
            render={<Link to={`${base}/personal${location.search}`} />}
          >
            {t('access.personal')}
          </Button>
        </nav>
        {data.error || catalog.error ? (
          <ErrorState
            error={data.error ?? catalog.error}
            retry={reload}
            backTo={`/access/people${location.search}`}
            onBack={parent?.reload}
          />
        ) : !data.data || !catalog.options ? (
          <Loading />
        ) : (
          <>
            {data.data.sourceError ? (
              <ErrorState error={data.data.sourceError} retry={data.reload} />
            ) : null}
            {data.data.definitionsError ? (
              <ErrorState
                error={data.data.definitionsError}
                retry={data.reload}
              />
            ) : null}
            <p className='text-sm text-muted-foreground'>
              {t('access.ruleHelp')}
            </p>
            {canAssign && canReadSets ? (
              <div className='flex justify-end'>
                <Button
                  nativeButton={false}
                  render={
                    <Link to={`${base}/${tab}/assign${location.search}`} />
                  }
                >
                  {t('access.changePersonal')}
                </Button>
              </div>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t('access.source')}</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-col gap-3'>
                {(data.data.configured.sets ?? [])
                  .filter(
                    (set) =>
                      tab !== 'personal' ||
                      set.sources.some(
                        (source) =>
                          source.type === 'user' && source.id === userId,
                      ),
                  )
                  .map((set) => (
                    <div key={set.key} className='grid gap-2 sm:grid-cols-2'>
                      <span>
                        {titleText(set.title, t, t('access.permissions'))}
                      </span>
                      <span className='text-sm text-muted-foreground'>
                        {set.sources.length
                          ? set.sources.map((source, index) => {
                              const direct =
                                source.type === 'user' && source.id === userId;
                              const known =
                                data.data!.sourceNames[
                                  `${source.type}:${source.id}`
                                ];
                              const canNavigate =
                                !direct &&
                                known &&
                                [
                                  'org.dutyRole',
                                  'org.department',
                                  'org.position',
                                  'authenticated',
                                  'org.reportingManager',
                                  'org.departmentHead',
                                ].includes(source.type);
                              const label = direct
                                ? t('access.direct')
                                : (known ?? t('access.inherited'));
                              return (
                                <span key={`${source.type}:${source.id}`}>
                                  {index ? '、' : ''}
                                  {canNavigate ? (
                                    <Link
                                      className='text-primary hover:underline'
                                      to={`/access/roles/${encodeURIComponent(source.type)}/${encodeURIComponent(source.id)}/permissions${location.search}`}
                                    >
                                      {label}
                                    </Link>
                                  ) : (
                                    label
                                  )}
                                </span>
                              );
                            })
                          : t('access.automatic')}
                      </span>
                    </div>
                  ))}
              </CardContent>
            </Card>
            {decisions.data?.failed ? (
              <ErrorState
                error={new Error('PARTIAL')}
                retry={decisions.reload}
              />
            ) : null}
            {decisions.busy ? (
              <Loading />
            ) : decisions.data ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('access.permissions')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  <AccessModulePermissions
                    options={catalog.options}
                    enabled={
                      new Set(
                        data.data.definitions.flatMap((set) =>
                          set.grants
                            .filter((grant) => grant.actions.length > 0)
                            .map((grant) =>
                              resourceKey(
                                grant.resource.type,
                                grant.resource.id,
                              ),
                            ),
                        ),
                      )
                    }
                  >
                    {(keys) => (
                      <div className='flex flex-col gap-3'>
                        {!decisions.data!.items.some((entry) =>
                          keys.has(
                            resourceKey(entry.resource.type, entry.resource.id),
                          ),
                        ) &&
                        !decisions.data!.failedChecks.some((entry) =>
                          keys.has(
                            resourceKey(entry.resource.type, entry.resource.id),
                          ),
                        ) ? (
                          <p className='text-sm text-muted-foreground'>
                            {t('access.noModuleMatches')}
                          </p>
                        ) : null}
                        {decisions
                          .data!.items.filter((entry) =>
                            keys.has(
                              resourceKey(
                                entry.resource.type,
                                entry.resource.id,
                              ),
                            ),
                          )
                          .map((entry) => {
                            const resource = resources(catalog.options!).find(
                              (row) =>
                                row.type === entry.resource.type &&
                                row.value === entry.resource.id,
                            );
                            const action = resource?.actions?.find(
                              (row) => row.value === entry.action,
                            );
                            const scopes = data.data!.definitions.flatMap(
                              (set) =>
                                set.grants
                                  .filter(
                                    (grant) =>
                                      grant.resource.type ===
                                        entry.resource.type &&
                                      grant.resource.id === entry.resource.id,
                                  )
                                  .flatMap((grant) =>
                                    grant.actions
                                      .filter(
                                        (action) =>
                                          action.action === entry.action,
                                      )
                                      .flatMap((action) => {
                                        if (
                                          action.policy &&
                                          action.policy.type !== 'composite'
                                        )
                                          return [t('access.special')];
                                        const values = (action.policy?.scopes ??
                                          {}) as Record<string, unknown>;
                                        return Object.entries(values).map(
                                          ([key, value]) =>
                                            resource?.dataScopes?.[entry.action]
                                              ?.find(
                                                (scope) => scope.key === key,
                                              )
                                              ?.options.find(
                                                (option) =>
                                                  option.value === value,
                                              )?.label ?? t('access.special'),
                                        );
                                      }),
                                  ),
                            );
                            const sourceTitles = data
                              .data!.definitions.filter((set) =>
                                set.grants.some(
                                  (grant) =>
                                    grant.resource.type ===
                                      entry.resource.type &&
                                    grant.resource.id === entry.resource.id &&
                                    grant.actions.some(
                                      (action) =>
                                        action.action === entry.action,
                                    ),
                                ),
                              )
                              .map((set) =>
                                titleText(
                                  set.title,
                                  t,
                                  t('access.permissions'),
                                ),
                              );
                            return (
                              <div
                                key={JSON.stringify([
                                  entry.resource,
                                  entry.action,
                                ])}
                                className='grid gap-2 border-b pb-3 sm:grid-cols-3'
                              >
                                <span>
                                  {resource?.label ?? t('access.special')}
                                </span>
                                <span>
                                  {action?.label ?? t('access.special')}
                                </span>
                                <Badge variant='outline'>
                                  {entry.decision.effect === 'conditional'
                                    ? t('access.conditional')
                                    : entry.decision.effect === 'deny'
                                      ? t('access.deniedAction')
                                      : t('access.permitted')}
                                </Badge>
                                {entry.decision.effect === 'conditional' ? (
                                  <p className='text-sm text-muted-foreground sm:col-span-3'>
                                    {t('access.conditionalSpecial')} ·{' '}
                                    {t('access.conditionalHelp')}
                                  </p>
                                ) : null}
                                {sourceTitles.length ? (
                                  <p className='text-sm text-muted-foreground sm:col-span-3'>
                                    {t('access.source')}:{' '}
                                    {sourceTitles.join('、')}
                                  </p>
                                ) : null}
                                {scopes.length ? (
                                  <p className='text-sm text-muted-foreground sm:col-span-3'>
                                    {t('access.configuredScopes')}:{' '}
                                    {[...new Set(scopes)].join('、')}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        {decisions
                          .data!.failedChecks.filter((entry) =>
                            keys.has(
                              resourceKey(
                                entry.resource.type,
                                entry.resource.id,
                              ),
                            ),
                          )
                          .map((entry) => {
                            const resource = resources(catalog.options!).find(
                              (row) =>
                                row.type === entry.resource.type &&
                                row.value === entry.resource.id,
                            );
                            return (
                              <div
                                key={JSON.stringify(entry)}
                                className='grid gap-2 sm:grid-cols-3'
                              >
                                <span>
                                  {resource?.label ?? t('access.special')}
                                </span>
                                <span>
                                  {resource?.actions?.find(
                                    (action) => action.value === entry.action,
                                  )?.label ?? t('access.special')}
                                </span>
                                <Badge variant='outline'>
                                  {t('access.unchecked')}
                                </Badge>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </AccessModulePermissions>
                  {!decisions.data.failed &&
                  !decisions.data.items.some(
                    (entry) => entry.decision.effect !== 'deny',
                  ) ? (
                    <Blank
                      title={t('access.none')}
                      description={t('access.noneHelp')}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
        <Outlet
          context={{
            reload,
            name,
            assignmentsSaved: async () => {
              await Promise.all([data.refresh(), decisions.refresh()]);
              parent?.reload();
            },
          }}
        />
      </div>
    </RecordDetailDrawer>
  );
}
