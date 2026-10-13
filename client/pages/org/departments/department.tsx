import { UserNameText } from '#components/user-name';
import { UserName } from '#components/user-name';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  StarIcon,
  UserMinusIcon,
  UsersIcon,
} from 'lucide-react';
import {
  type ReactElement,
  type ReactNode,
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

import { DataTable } from '#components/data-table';
import { DataTableColumnHeader } from '#components/data-table/column-header';
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
import { Alert, AlertDescription } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

import { LoadError, TableSkeleton } from '../org-ui.js';
import { type ListBody, useErrorText } from '../shared.js';
import {
  chainOf,
  type DepartmentMember,
  type DepartmentOutletContext,
  type DepartmentsOutletContext,
} from './types.js';

/** `:departmentId`: the selected department beside the tree. */
export default function DepartmentPage(): ReactElement {
  const { departmentId = '' } = useParams();
  return <DepartmentDetail key={departmentId} departmentId={departmentId} />;
}

function Value({ children }: { readonly children: ReactNode }): ReactElement {
  return <dd className='min-w-0 break-words'>{children}</dd>;
}

function Dash(): ReactElement {
  return <span className='text-muted-foreground'>—</span>;
}

function DepartmentDetail({
  departmentId,
}: {
  readonly departmentId: string;
}): ReactElement {
  const { t } = useTranslation();
  const { departments, canUpdate, reload } =
    useOutletContext<DepartmentsOutletContext>();
  const api = useApiClient();
  const toaster = useToaster();
  const errorText = useErrorText();
  const location = useLocation();

  const department = departments?.find((row) => row.id === departmentId);
  const chain = useMemo(
    () => (departments ? chainOf(departments, departmentId) : []),
    [departments, departmentId],
  );
  const parent = chain[1];
  // The executive is inherited from the nearest ancestor that names one (plan 01 §1).
  const executiveSource = chain.find((row) => row.executiveId !== null);
  const disabledAncestor = chain.slice(1).find((row) => !row.active);

  const [membersCount, reloadMembers] = useReducer(
    (count: number) => count + 1,
    0,
  );
  const [members, setMembers] = useState<{
    readonly key: number;
    readonly rows?: DepartmentMember[];
    readonly error?: unknown;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    const key = membersCount;
    api
      .request<ListBody<DepartmentMember>>({
        path: `departments/${encodeURIComponent(departmentId)}/members`,
        signal: controller.signal,
      })
      .then(
        ({ data }) => {
          if (!controller.signal.aborted) setMembers({ key, rows: data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setMembers((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, departmentId, membersCount]);
  const membersLoading = members?.key !== membersCount;
  const membersError = membersLoading ? undefined : members?.error;
  const memberRows = members?.rows;

  const outletContext = useMemo<DepartmentOutletContext | undefined>(
    () =>
      department
        ? {
            department,
            reload,
            reloadMembers,
            memberIds: (memberRows ?? []).map((row) => row.userId),
          }
        : undefined,
    [department, reload, reloadMembers, memberRows],
  );

  // Confirmations keep their target while closing, so their titles do not flicker.
  const [confirm, setConfirm] = useState<{
    readonly open: boolean;
    readonly kind: 'disable' | 'remove';
    readonly member?: DepartmentMember;
  }>({ open: false, kind: 'disable' });
  const [pending, setPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();

  async function run(
    request: () => Promise<unknown>,
    success: string,
    options: { inDialog: boolean; members?: boolean },
  ): Promise<void> {
    setPending(true);
    setConfirmError(undefined);
    try {
      await request();
      toaster.show({ type: 'success', title: success });
      setConfirm((current) => ({ ...current, open: false }));
      if (options.members) reloadMembers();
      reload();
    } catch (cause: unknown) {
      if (cause instanceof ApiClientError && cause.status === 404) {
        reloadMembers();
        reload();
      }
      if (options.inDialog) setConfirmError(errorText(cause));
      else toaster.show({ type: 'error', title: errorText(cause) });
    } finally {
      setPending(false);
    }
  }

  const base = `departments/${encodeURIComponent(departmentId)}`;

  const { locale } = useLocale();
  const collator = useMemo(() => new Intl.Collator(locale), [locale]);
  const columns = useMemo<ColumnDef<DepartmentMember>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (row) => row.user.name,
        enableHiding: false,
        sortingFn: (a, b) =>
          collator.compare(a.original.user.name, b.original.user.name),
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('org.common.fields.name')}
          />
        ),
        cell: ({ row }) => (
          <span className='font-medium'>
            <UserName name={row.original.user.name} />
          </span>
        ),
      },
      {
        id: 'email',
        header: t('org.common.fields.email'),
        cell: ({ row }) =>
          row.original.user.email ? (
            <span className='text-muted-foreground'>
              {row.original.user.email}
            </span>
          ) : (
            <Dash />
          ),
      },
      {
        id: 'primary',
        header: t('org.departments.members.primary'),
        cell: ({ row }) =>
          row.original.primary ? (
            <Badge variant='secondary'>
              {t('org.departments.members.primaryBadge')}
            </Badge>
          ) : (
            <span className='text-muted-foreground'>
              {t('org.departments.members.secondaryBadge')}
            </span>
          ),
      },
      {
        id: 'actions',
        enableHiding: false,
        header: () => (
          <span className='sr-only'>{t('org.common.actions.label')}</span>
        ),
        cell: ({ row }) =>
          canUpdate ? (
            <div className='flex justify-end'>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('org.common.actions.more', {
                        name: row.original.user.name,
                      })}
                    />
                  }
                >
                  <MoreHorizontalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-auto min-w-40'>
                  {row.original.primary ? null : (
                    <>
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          disabled={pending}
                          onClick={() =>
                            void run(
                              () =>
                                api.request({
                                  path: `${base}/members/${encodeURIComponent(row.original.userId)}/makePrimary`,
                                  method: 'POST',
                                }),
                              t('org.departments.members.primarySet', {
                                name: row.original.user.name,
                              }),
                              { inDialog: false, members: true },
                            )
                          }
                        >
                          <StarIcon />
                          {t('org.departments.members.makePrimary')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant='destructive'
                      onClick={() => {
                        setConfirmError(undefined);
                        setConfirm({
                          open: true,
                          kind: 'remove',
                          member: row.original,
                        });
                      }}
                    >
                      <UserMinusIcon />
                      {t('org.departments.members.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    // run and base close over stable setters and the id; listing them would rebuild the columns every render.
    // eslint-disable-next-line @eslint-react/exhaustive-deps, react-hooks/exhaustive-deps
    [canUpdate, collator, pending, t],
  );

  if (!departments) {
    return (
      <Card>
        <CardContent className='flex flex-col gap-3'>
          <div
            role='status'
            aria-label={t('status.loading')}
            className='flex flex-col gap-3'
          >
            <Skeleton className='h-6 w-40' />
            <Skeleton className='h-4 w-64' />
            <Skeleton className='h-4 w-56' />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!department || !outletContext) {
    // The tree no longer has it: someone else changed the tree, or the link is stale (guideline R3, no "Retry").
    return (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertDescription>
          {t('org.departments.notFound')}{' '}
          <Link
            to={{ pathname: '..', search: location.search }}
            className='underline underline-offset-4'
          >
            {t('org.departments.backToTree')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const disableTitle = t('org.departments.disableTitle', {
    name: department.title,
  });

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2 text-base font-medium'>
            <h2>{department.title}</h2>
            {department.active ? null : (
              <Badge variant='outline'>{t('org.common.inactive')}</Badge>
            )}
            {department.active && disabledAncestor ? (
              <Badge variant='outline'>
                {t('org.departments.inactiveByAncestor', {
                  name: disabledAncestor.title,
                })}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            {parent
              ? chain
                  .slice()
                  .reverse()
                  .map((row) => row.title)
                  .join(' / ')
              : t('org.departments.topLevel')}
          </CardDescription>
          {canUpdate ? (
            <CardAction className='flex items-center gap-2'>
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'edit', search: location.search }} />
                }
              >
                <PencilIcon data-icon='inline-start' />
                {t('org.common.actions.edit')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('org.common.actions.more', {
                        name: department.title,
                      })}
                    />
                  }
                >
                  {pending ? <Spinner /> : <MoreHorizontalIcon />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end' className='w-auto min-w-40'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={
                        <Link
                          to={{ pathname: 'new', search: location.search }}
                        />
                      }
                    >
                      <PlusIcon />
                      {t('org.departments.createChild')}
                    </DropdownMenuItem>
                    {department.active ? null : (
                      <DropdownMenuItem
                        disabled={pending}
                        onClick={() =>
                          void run(
                            () =>
                              api.request({
                                path: `${base}/enable`,
                                method: 'POST',
                              }),
                            t('org.departments.enabled', {
                              name: department.title,
                            }),
                            { inDialog: false },
                          )
                        }
                      >
                        <PowerIcon />
                        {t('org.common.actions.enable')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuGroup>
                  {department.active ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => {
                            setConfirmError(undefined);
                            setConfirm({ open: true, kind: 'disable' });
                          }}
                        >
                          <PowerOffIcon />
                          {t('org.common.actions.disable')}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
            <dt className='text-muted-foreground'>
              {t('org.common.fields.code')}
            </dt>
            <Value>{department.code ?? <Dash />}</Value>
            <dt className='text-muted-foreground'>
              {t('org.departments.fields.parent')}
            </dt>
            <Value>{parent?.title ?? <Dash />}</Value>
            <dt className='text-muted-foreground'>
              {t('org.departments.fields.manager')}
            </dt>
            <Value>
              <UserName name={department.manager?.name} />
            </Value>
            <dt className='text-muted-foreground'>
              {t('org.departments.fields.executive')}
            </dt>
            <Value>
              {department.executive ? (
                <UserName name={department.executive.name} />
              ) : executiveSource?.executive ? (
                <>
                  <UserName name={executiveSource.executive.name} />{' '}
                  <span className='text-muted-foreground'>
                    {t('org.departments.inheritedFrom', {
                      name: executiveSource.title,
                    })}
                  </span>
                </>
              ) : (
                <Dash />
              )}
            </Value>
            <dt className='text-muted-foreground'>
              {t('org.common.fields.status')}
            </dt>
            <Value>
              {department.active
                ? t('org.common.active')
                : t('org.common.inactive')}
            </Value>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base font-medium'>
            <h3>
              {t('org.departments.members.title', {
                count: memberRows?.length ?? department.memberCount,
              })}
            </h3>
          </CardTitle>
          <CardDescription>
            {t('org.departments.members.description')}
          </CardDescription>
          {canUpdate && memberRows && memberRows.length > 0 ? (
            <CardAction>
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={{ pathname: 'members/new', search: location.search }}
                  />
                }
              >
                <PlusIcon data-icon='inline-start' />
                {t('org.departments.members.add')}
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {membersError ? (
            <LoadError
              error={membersError}
              title={t('org.departments.members.loadFailed')}
              onRetry={reloadMembers}
            />
          ) : !memberRows ? (
            <TableSkeleton rows={3} />
          ) : memberRows.length === 0 ? (
            <Empty className='min-h-40 border border-dashed p-6 md:p-6'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>
                  {t('org.departments.members.emptyTitle')}
                </EmptyTitle>
                <EmptyDescription>
                  {canUpdate
                    ? t('org.departments.members.emptyDescription')
                    : t('org.common.askAdministrator')}
                </EmptyDescription>
              </EmptyHeader>
              {canUpdate ? (
                <EmptyContent>
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: 'members/new',
                          search: location.search,
                        }}
                      />
                    }
                  >
                    <PlusIcon data-icon='inline-start' />
                    {t('org.departments.members.add')}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <DataTable
              columns={columns}
              data={memberRows}
              getRowId={(row) => row.userId}
              showSelectedCount={false}
            />
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirm.open}
        onOpenChange={(open) => {
          if (pending) return;
          setConfirm((current) => ({ ...current, open }));
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <UserNameText
                text={
                  confirm.kind === 'disable'
                    ? disableTitle
                    : t('org.departments.members.removeTitle', {
                        name: confirm.member?.user.name ?? '',
                        department: department.title,
                      })
                }
                name={confirm.member?.user.name ?? ''}
              />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm.kind === 'disable'
                ? t('org.departments.disableDescription')
                : t('org.departments.members.removeDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmError ? (
            <p role='alert' className='text-sm text-destructive'>
              {confirmError}
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
                if (confirm.kind === 'disable')
                  void run(
                    () =>
                      api.request({ path: `${base}/disable`, method: 'POST' }),
                    t('org.departments.disabled', { name: department.title }),
                    { inDialog: true },
                  );
                else if (confirm.member)
                  void run(
                    () =>
                      api.request({
                        path: `${base}/members/${encodeURIComponent(confirm.member!.userId)}`,
                        method: 'DELETE',
                      }),
                    t('org.departments.members.removed', {
                      name: confirm.member.user.name,
                      department: department.title,
                    }),
                    { inDialog: true, members: true },
                  );
              }}
            >
              {pending ? <Spinner data-icon='inline-start' /> : null}
              {confirm.kind === 'disable'
                ? t('org.common.actions.disable')
                : t('org.departments.members.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit, create-child and add-member dialogs stack on this department. */}
      <Outlet context={outletContext} />
    </div>
  );
}
