import { UserName } from '#components/user-name';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { useCallback, useMemo, useState, useRef } from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';
import {
  ApiClientError,
  useApiClient,
  usePageBreadcrumb,
  useToaster,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { ColumnDef } from '@tanstack/react-table';

import { RecordDetailDrawer } from '#components/record-detail-drawer';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '#components/ui/card';
import { Badge } from '#components/ui/badge';
import { useAuthorizationClient } from '../administration/authorization/use-authorization-client.js';
import { titleText } from '../administration/authorization/i18n.js';
import { ConfirmDialog } from '../administration/authorization/components/confirm-dialog.js';
import type { DutyRoleMember } from '../org/duty-roles/types.js';
import type { DefinitionSnapshot, AccessSnapshot } from './types.js';
import { actionRows } from './model.js';
import { AccessModulePermissions } from './module-permissions.js';
import { resourceKey } from '../administration/authorization/pages/permission-sets/drafts.js';
import { useCatalog, useLoad, useSnapshot } from './hooks.js';
import { Blank, ErrorState, Loading, Refresh } from './ui.js';

export default function SubjectDetail() {
  const { type = '', id = '' } = useParams();
  const { t } = useTranslation();
  const api = useApiClient();
  const client = useAuthorizationClient();
  const location = useLocation();
  const focusTargetRef = useRef<HTMLElement>(null);
  const parent = useOutletContext<{ reload: () => void }>();
  const snapshot = useSnapshot();

  const catalog = useCatalog();
  const title = useLoad(
    useCallback(async () => {
      if (type === 'system') return t('access.systemAdmin');
      if (type === 'authenticated') return t('access.baseline');
      const names = await client.resolveSubjects('permissionSets', type, [id]);
      if (!names[0])
        throw new ApiClientError('Not found', {
          status: 404,
          method: 'GET',
          url: 'access/subjects',
        });
      return titleText(names[0].title, t);
    }, [client, type, id, t]),
  );
  const isDuty = type === 'org.dutyRole';
  const canMembers = useCan({
    resource: { type: 'settings', id: 'oa.org.dutyRoles' },
    action: 'read',
  }).can;
  const canUpdateMembers = useCan({
    resource: { type: 'settings', id: 'oa.org.dutyRoles' },
    action: 'update',
  }).can;
  const canReadUsers = useCan({
    resource: { type: 'user', id: '*' },
    action: 'read',
  }).can;
  const canUpdate = useCan({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    action: 'update',
  }).can;
  const canAssign = useCan({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    action: 'assign',
  }).can;
  const members = useLoad(
    useCallback(
      async () =>
        isDuty && canMembers
          ? (
              await api.request<{ data: DutyRoleMember[] }>({
                path: `dutyRoles/${encodeURIComponent(id)}/members`,
              })
            ).data
          : [],
      [api, id, isDuty, canMembers],
    ),
  );
  const sets =
    snapshot.data?.sets.filter((set) =>
      type === 'system'
        ? set.key === id
        : snapshot.data?.assignments.some(
            (entry) =>
              entry.permissionSet === set.key &&
              entry.subject.type === type &&
              entry.subject.id === id,
          ),
    ) ?? [];
  const base = `/access/roles/${encodeURIComponent(type)}/${encodeURIComponent(id)}`;
  const tab = location.pathname.includes('/members')
    ? 'members'
    : 'permissions';
  const name = title.data ?? t('access.loading');
  usePageBreadcrumb([
    { label: t('access.title'), to: `/access/roles${location.search}` },
    { label: name },
  ]);
  const reload = () => {
    snapshot.reload();
    members.reload();
    catalog.reload();
    title.reload();
    parent?.reload();
  };
  const toaster = useToaster();
  const [removing, setRemoving] = useState<DutyRoleMember>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const columns = useMemo<ColumnDef<DutyRoleMember>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (row) => row.user.name,
        sortingFn: (a, b) =>
          a.original.user.name.localeCompare(b.original.user.name),
        header: t('access.name'),
        cell: ({ row }) => <UserName name={row.original.user.name} />,
      },
      {
        id: 'actions',
        header: t('access.actions'),
        cell: ({ row }) =>
          canUpdateMembers ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('access.actionsFor', {
                      name: row.original.user.name,
                    })}
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-auto min-w-40' align='end'>
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => setRemoving(row.original)}
                >
                  {t('access.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
      },
    ],
    [t, canUpdateMembers, setRemoving],
  );
  const add =
    canUpdateMembers && canReadUsers ? (
      <Button
        nativeButton={false}
        render={<Link to={`${base}/members/add${location.search}`} />}
      >
        {t('access.addMember')}
      </Button>
    ) : null;
  return (
    <RecordDetailDrawer
      beforeClose={() => !busy}
      title={name}
      description={t('access.roleHelp')}
      footer={<Refresh busy={snapshot.busy || members.busy} reload={reload} />}
    >
      <div className='space-y-6'>
        <nav ref={focusTargetRef} tabIndex={-1} className='flex gap-2'>
          <Button
            variant={tab === 'permissions' ? 'secondary' : 'ghost'}
            nativeButton={false}
            render={<Link to={`${base}/permissions${location.search}`} />}
          >
            {t('access.permissions')}
          </Button>
          {isDuty ? (
            <Button
              variant={tab === 'members' ? 'secondary' : 'ghost'}
              nativeButton={false}
              render={<Link to={`${base}/members${location.search}`} />}
            >
              {t('access.members')}
            </Button>
          ) : null}
        </nav>
        {error ? <ErrorState error={error} /> : null}
        {snapshot.error || title.error || catalog.error ? (
          <ErrorState
            error={snapshot.error ?? title.error ?? catalog.error}
            retry={reload}
            backTo={`/access/roles${location.search}`}
            onBack={parent?.reload}
          />
        ) : !snapshot.data || !catalog.options ? (
          <Loading />
        ) : tab === 'members' ? (
          !canMembers ? (
            <p>{t('access.memberDenied')}</p>
          ) : members.error ? (
            <ErrorState error={members.error} retry={members.reload} />
          ) : members.busy && !members.data ? (
            <Loading />
          ) : members.data?.length ? (
            <>
              <div className='flex justify-end'>{add}</div>
              <p className='text-sm text-muted-foreground'>
                {t('access.memberImpact')}
              </p>
              <DataTable
                pageSizeOptions={[20, 50, 100]}
                initialSorting={[{ id: 'name', desc: false }]}
                columns={columns}
                data={members.data}
                showSelectedCount={false}
                getRowId={(row) => row.userId}
              />
            </>
          ) : (
            <Blank
              title={t('access.missingMembers')}
              description={t('access.memberImpact')}
              action={add}
            />
          )
        ) : (
          <>
            <div className='flex justify-end'>
              {canAssign && type !== 'system' && sets.length ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link to={`${base}/permissions/assign${location.search}`} />
                  }
                >
                  {t('access.assign')}
                </Button>
              ) : null}
            </div>
            <p className='text-sm text-muted-foreground'>{t('access.rules')}</p>
            {sets.length ? (
              sets.map((set) => {
                const rows = actionRows(catalog.options!, set).filter(
                  (row) => row.enabled,
                );
                const assignments = snapshot.data!.assignments.filter(
                  (entry) => entry.permissionSet === set.key,
                );
                const editable =
                  !set.protection || set.protection.allow.includes('update');
                return (
                  <Card key={set.key}>
                    <CardHeader>
                      <CardTitle>
                        {titleText(set.title, t, t('access.permissions'))}
                      </CardTitle>
                      <p className='text-sm text-muted-foreground'>
                        {t('access.usedBy', { count: assignments.length })}
                      </p>
                      {canUpdate && editable ? (
                        <Button
                          variant='outline'
                          nativeButton={false}
                          render={
                            <Link
                              to={`${base}/permissions/${encodeURIComponent(set.key)}/edit${location.search}`}
                            />
                          }
                        >
                          {t('access.edit')}
                        </Button>
                      ) : null}
                    </CardHeader>
                    <CardContent>
                      {set.grants.some((grant) =>
                        grant.actions.some(
                          (action) =>
                            !rows.some(
                              (row) =>
                                row.resource.type === grant.resource.type &&
                                row.resource.value === grant.resource.id &&
                                row.action === action.action,
                            ),
                        ),
                      ) ? (
                        <p className='text-sm text-muted-foreground'>
                          {t('access.specialReadOnly')}
                        </p>
                      ) : null}
                      {set.unrestricted ? (
                        <Badge>{t('access.unrestricted')}</Badge>
                      ) : rows.length ? (
                        <AccessModulePermissions
                          options={catalog.options!}
                          enabled={
                            new Set(
                              rows.map((row) =>
                                resourceKey(
                                  row.resource.type,
                                  row.resource.value,
                                ),
                              ),
                            )
                          }
                        >
                          {(keys) => (
                            <div className='flex flex-col gap-3'>
                              {!rows.some((row) =>
                                keys.has(
                                  resourceKey(
                                    row.resource.type,
                                    row.resource.value,
                                  ),
                                ),
                              ) ? (
                                <p className='text-sm text-muted-foreground'>
                                  {t('access.noModulePermissions')}
                                </p>
                              ) : null}
                              {rows
                                .filter((row) =>
                                  keys.has(
                                    resourceKey(
                                      row.resource.type,
                                      row.resource.value,
                                    ),
                                  ),
                                )
                                .map((row) => (
                                  <div
                                    key={row.id}
                                    className='grid gap-2 border-b pb-3 sm:grid-cols-3'
                                  >
                                    <span>{row.resource.label}</span>
                                    <span>{row.label}</span>
                                    <span className='text-sm text-muted-foreground'>
                                      {row.custom
                                        ? t('access.special')
                                        : (
                                            row.resource.dataScopes?.[
                                              row.action
                                            ] ?? []
                                          )
                                            .map(
                                              (scope) =>
                                                `${scope.label}：${scope.options.find((option) => option.value === row.scopes[scope.key])?.label ?? t('access.special')}`,
                                            )
                                            .join('；') || t('access.noScope')}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </AccessModulePermissions>
                      ) : (
                        <p>{t('access.special')}</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            ) : (
              <Blank
                title={t('access.none')}
                description={t('access.noneHelp')}
                action={
                  canAssign && type !== 'system' ? (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={`${base}/permissions/assign${location.search}`}
                        />
                      }
                    >
                      {t('access.assign')}
                    </Button>
                  ) : undefined
                }
              />
            )}
          </>
        )}
        <ConfirmDialog
          open={Boolean(removing)}
          title={t('access.removeTitle', { name: removing?.user.name ?? '' })}
          confirmLabel={t('access.remove')}
          cancelLabel={t('access.cancel')}
          busy={busy}
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => {
            if (!removing) return;
            setBusy(true);
            setError(undefined);
            void api
              .request({
                path: `dutyRoles/${encodeURIComponent(id)}/members/${encodeURIComponent(removing.userId)}`,
                method: 'DELETE',
              })
              .then(async () => {
                const result = await api.request<{ data: DutyRoleMember[] }>({
                  path: `dutyRoles/${encodeURIComponent(id)}/members`,
                });
                members.replace(result.data);
                parent?.reload();
                setRemoving(undefined);
                requestAnimationFrame(() => focusTargetRef.current?.focus());
                toaster.show({
                  title: t('access.removed', { name: removing.user.name }),
                  type: 'success',
                });
              })
              .catch((cause: unknown) => setError(cause))
              .finally(() => setBusy(false));
          }}
        >
          {t('access.memberImpact')}
        </ConfirmDialog>
        <Outlet
          context={{
            reload,
            membersSaved: (data: DutyRoleMember[]) => {
              members.replace(data);
              parent?.reload();
            },
            assignmentsSaved: (data: AccessSnapshot) => {
              snapshot.replace(data);
              parent?.reload();
            },
            definitionSaved: (data: DefinitionSnapshot) => {
              if (snapshot.data)
                snapshot.replace({
                  ...snapshot.data,
                  sets: snapshot.data.sets.map((set) =>
                    set.key === data.definition.key ? data.definition : set,
                  ),
                });
              parent?.reload();
            },
            memberIds: members.data?.map((entry) => entry.userId) ?? [],
            name,
          }}
        />
      </div>
    </RecordDetailDrawer>
  );
}
