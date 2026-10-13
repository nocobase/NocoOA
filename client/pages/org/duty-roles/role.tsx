import { UserNameText } from '#components/user-name';
import { UserName } from '#components/user-name';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  MoreHorizontalIcon,
  PlusIcon,
  UserMinusIcon,
  UsersIcon,
} from 'lucide-react';
import {
  type ReactElement,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import {
  Link,
  Outlet,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';

import { RouteDrawer } from '#components/route-drawer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import { Button } from '#components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { Skeleton } from '#components/ui/skeleton';
import { Spinner } from '#components/ui/spinner';

import { ActiveBadge, LoadError } from '../org-ui.js';
import { type ListBody, useErrorText } from '../shared.js';
import { useRoleTitle } from './role-title.js';
import type {
  DutyRole,
  DutyRoleMember,
  DutyRoleOutletContext,
  DutyRolesOutletContext,
} from './types.js';

/** `:code`: one duty role and its members, in a drawer over the filtered list. */
export default function DutyRolePage(): ReactElement {
  const { code = '' } = useParams();
  return <DutyRoleDrawer key={code} code={code} />;
}

function DutyRoleDrawer({ code }: { readonly code: string }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const errorText = useErrorText();
  const location = useLocation();
  const roleTitle = useRoleTitle();
  const { reload, canUpdate } = useOutletContext<DutyRolesOutletContext>();

  const [reloadCount, reloadDrawer] = useReducer(
    (count: number) => count + 1,
    0,
  );
  const [result, setResult] = useState<{
    readonly key: number;
    readonly role?: DutyRole;
    readonly members?: DutyRoleMember[];
    readonly error?: unknown;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const key = reloadCount;
    const base = `dutyRoles/${encodeURIComponent(code)}`;
    Promise.all([
      api.request<{ data: DutyRole }>({
        path: base,
        signal: controller.signal,
      }),
      api.request<ListBody<DutyRoleMember>>({
        path: `${base}/members`,
        signal: controller.signal,
      }),
    ]).then(
      ([role, members]) => {
        if (!controller.signal.aborted)
          setResult({ key, role: role.data, members: members.data });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult((previous) => ({ ...previous, key, error }));
        // Gone from under the list: refresh it too (guideline R3).
        if (error instanceof ApiClientError && error.status === 404) reload();
      },
    );
    return () => controller.abort();
  }, [api, code, reloadCount, reload]);

  const loading = result?.key !== reloadCount;
  const error = loading ? undefined : result?.error;
  const role = result?.role;
  const members = result?.members;
  const name = role ? roleTitle(role.title) : code;

  const outletContext = useMemo<DutyRoleOutletContext | undefined>(
    () =>
      role
        ? {
            role,
            roleTitle: roleTitle(role.title),
            memberIds: (members ?? []).map((member) => member.userId),
            onMembersChanged: () => {
              reloadDrawer();
              reload();
            },
          }
        : undefined,
    [role, members, roleTitle, reload],
  );

  const [removal, setRemoval] = useState<{
    readonly open: boolean;
    readonly member: DutyRoleMember | null;
  }>({ open: false, member: null });
  const [pending, setPending] = useState(false);
  const [removeError, setRemoveError] = useState<string>();

  async function remove(member: DutyRoleMember): Promise<void> {
    setPending(true);
    setRemoveError(undefined);
    try {
      await api.request({
        path: `dutyRoles/${encodeURIComponent(code)}/members/${encodeURIComponent(member.userId)}`,
        method: 'DELETE',
      });
      toaster.show({
        type: 'success',
        title: t('org.dutyRoles.members.removed', {
          name: member.user.name,
          role: name,
        }),
      });
      setRemoval((current) => ({ ...current, open: false }));
      reloadDrawer();
      reload();
    } catch (cause: unknown) {
      if (cause instanceof ApiClientError && cause.status === 404) {
        // Someone else already removed it: treat it as done (guideline R3).
        toaster.show({
          type: 'info',
          title: t('org.dutyRoles.members.alreadyRemoved'),
        });
        setRemoval((current) => ({ ...current, open: false }));
        reloadDrawer();
        reload();
      } else setRemoveError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  const addLink = (
    <Button
      variant='outline'
      nativeButton={false}
      render={
        <Link to={{ pathname: 'members/new', search: location.search }} />
      }
    >
      <PlusIcon data-icon='inline-start' />
      {t('org.dutyRoles.members.add')}
    </Button>
  );

  let body: ReactElement;
  if (error && !role) {
    body = (
      <LoadError
        error={error}
        title={t('org.dutyRoles.detailFailed')}
        onRetry={reloadDrawer}
        notFound={t('org.dutyRoles.notFound')}
      />
    );
  } else if (!role || !members) {
    body = (
      <div
        role='status'
        aria-label={t('status.loading')}
        className='flex flex-col gap-3'
      >
        <Skeleton className='h-4 w-48' />
        <Skeleton className='h-4 w-40' />
        <Skeleton className='h-24 w-full' />
      </div>
    );
  } else {
    body = (
      <div className='flex flex-col gap-6'>
        {error ? (
          <LoadError
            error={error}
            title={t('org.dutyRoles.detailFailed')}
            onRetry={reloadDrawer}
          />
        ) : null}
        <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
          <dt className='text-muted-foreground'>
            {t('org.dutyRoles.fields.code')}
          </dt>
          <dd className='font-mono'>{role.code}</dd>
          <dt className='text-muted-foreground'>
            {t('org.common.fields.status')}
          </dt>
          <dd>
            <ActiveBadge active={role.active} />
          </dd>
          <dt className='text-muted-foreground'>
            {t('org.dutyRoles.fields.description')}
          </dt>
          <dd className='whitespace-pre-line'>
            {role.description ?? (
              <span className='text-muted-foreground'>—</span>
            )}
          </dd>
        </dl>
        <section className='flex flex-col gap-3'>
          <div className='flex items-center justify-between gap-2'>
            <h3 className='text-base font-medium'>
              {t('org.dutyRoles.members.title', { count: members.length })}
            </h3>
            {canUpdate && members.length > 0 ? addLink : null}
          </div>
          {members.length === 0 ? (
            <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>{t('org.dutyRoles.members.emptyTitle')}</EmptyTitle>
                <EmptyDescription>
                  {canUpdate
                    ? t('org.dutyRoles.members.emptyDescription')
                    : t('org.common.askAdministrator')}
                </EmptyDescription>
              </EmptyHeader>
              {canUpdate ? <EmptyContent>{addLink}</EmptyContent> : null}
            </Empty>
          ) : (
            <ul className='flex flex-col divide-y rounded-lg border'>
              {members.map((member) => (
                <li
                  key={member.userId}
                  className='flex items-center gap-3 px-4 py-2'
                >
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <span className='truncate text-sm font-medium'>
                      <UserName name={member.user.name} />
                    </span>
                    {member.user.email ? (
                      <span className='truncate text-xs text-muted-foreground'>
                        {member.user.email}
                      </span>
                    ) : null}
                  </div>
                  {canUpdate ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='icon-sm'
                            aria-label={t('org.common.actions.more', {
                              name: member.user.name,
                            })}
                          />
                        }
                      >
                        <MoreHorizontalIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align='end'
                        className='w-auto min-w-40'
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => {
                              setRemoveError(undefined);
                              setRemoval({ open: true, member });
                            }}
                          >
                            <UserMinusIcon />
                            {t('org.dutyRoles.members.remove')}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <RouteDrawer
      title={name}
      description={t('org.dutyRoles.drawerDescription')}
    >
      {body}
      <AlertDialog
        open={removal.open}
        onOpenChange={(open) => {
          if (pending) return;
          setRemoval((current) => ({ ...current, open }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <UserNameText
                text={t('org.dutyRoles.members.removeTitle', {
                  name: removal.member?.user.name ?? '',
                  role: name,
                })}
                name={removal.member?.user.name ?? ''}
              />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('org.dutyRoles.members.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p role='alert' className='text-sm text-destructive'>
              {removeError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pending}
              onClick={() => {
                if (removal.member) void remove(removal.member);
              }}
            >
              {pending ? <Spinner data-icon='inline-start' /> : null}
              {t('org.dutyRoles.members.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* The add-member dialog stacks on this drawer. */}
      {outletContext ? <Outlet context={outletContext} /> : null}
    </RouteDrawer>
  );
}
