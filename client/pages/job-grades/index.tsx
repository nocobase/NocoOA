import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationToolbar } from '#components/application-toolbar';
import { UserName } from '#components/user-name';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Layers, MoreHorizontal, RefreshCw, Eye } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { DataTableServer, DataTableColumnHeader } from '#components/data-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Label } from '#components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { Spinner } from '#components/ui/spinner';
import { useUrlSearch } from '#hooks/use-url-search';
import { useResource } from './resource.js';
import { Failure, Loading } from './states.js';
import {
  resource,
  date,
  type Current,
  type Grade,
  type History,
  readPending,
  type Metadata,
  type SourceContext,
} from './types.js';
export default function SalaryGradeHistory() {
  const { t, i18n } = useTranslation(),
    location = useLocation();
  const { session } = useAuthentication();
  const actorId = session?.user.id ?? '';
  useEffect(() => {
    try {
      readPending(actorId);
    } catch {
      /* Storage is verified before publication; history never reads the private body. */
    }
  }, [actorId]);
  const headingRef = useRef<HTMLDivElement>(null);
  const { searchParams, updateParams, text, inputProps, clear } = useUrlSearch({
    param: 'search',
  });
  const salary = useCan({ resource, action: 'viewSalary' }),
    manage = useCan({ resource, action: 'manage' }),
    view = useCan({ resource, action: 'view' });
  const canRead = salary.can && !salary.isPending && !salary.error;
  const canManage = manage.can && !manage.isPending && !manage.error;
  const eligible = canRead && canManage;
  const page = Math.max(1, Math.floor(Number(searchParams.get('page')) || 1)),
    pageSize = [10, 20, 50, 100].includes(Number(searchParams.get('pageSize')))
      ? Number(searchParams.get('pageSize'))
      : 20;
  const sort =
      searchParams.get('sort') === 'createdAt' ? 'createdAt' : 'version',
    direction = searchParams.get('direction') === 'asc' ? 'asc' : 'desc',
    search = searchParams.get('search') ?? '';
  const history = useResource<History>(view.can ? 'salaryGradeTables' : null, {
    search,
    page: String(page),
    pageSize: String(pageSize),
    sort,
    direction,
  });
  const current = useResource<{ data: Current }>(
    eligible ? 'salaryGradeTables/current' : null,
  );
  const grades = useResource<{ data: Grade[] }>(
    eligible ? 'grades/options' : null,
  );
  const ready =
    eligible &&
    !!current.data &&
    !!grades.data &&
    !current.loading &&
    !grades.loading &&
    !current.error &&
    !grades.error;
  const reloadHistory = history.reload,
    reloadCurrent = current.reload,
    reloadGrades = grades.reload;
  const refresh = useCallback(() => {
    reloadHistory();
    reloadCurrent();
    reloadGrades();
  }, [reloadHistory, reloadCurrent, reloadGrades]);
  const focusList = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const h = headingRef.current?.querySelector('h1');
        if (h) {
          h.tabIndex = -1;
          h.focus();
        }
      }),
    );
  }, []);
  const context: SourceContext = {
    source:
      location.pathname.split('/salaryGradeTables')[0] + '/salaryGradeTables',
    search: location.search,
    reload: refresh,
    onPublished: (revision) => {
      current.update({ data: { version: revision.version, revision } });
      refresh();
    },
    focusList,
  };
  const columns = useMemo<ColumnDef<Metadata>[]>(
    () => [
      {
        accessorKey: 'version',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('jobGrades.versionColumn')}
          />
        ),
        cell: ({ row }) =>
          canRead ? (
            <Link
              className='font-medium underline-offset-4 hover:underline'
              to={{ pathname: row.original.id, search: location.search }}
            >
              {t('jobGrades.version', { version: row.original.version })}
            </Link>
          ) : (
            t('jobGrades.version', { version: row.original.version })
          ),
      },
      {
        id: 'createdBy',
        header: t('jobGrades.publisher'),
        enableSorting: false,
        cell: ({ row }) => <UserName name={row.original.createdBy.name} />,
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('jobGrades.publishedAt')}
          />
        ),
        cell: ({ row }) =>
          date(
            row.original.createdAt,
            history.data!.meta.timeZone,
            i18n.language,
          ),
      },
      ...(canRead
        ? [
            {
              id: 'actions',
              header: '',
              enableSorting: false,
              cell: ({ row }: { row: { original: Metadata } }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('jobGrades.rowActions', {
                          version: row.original.version,
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
                              pathname: row.original.id,
                              search: location.search,
                            }}
                          />
                        }
                      >
                        <Eye />
                        {t('jobGrades.view')}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]
        : []),
    ],
    [t, canRead, location.search, history.data, i18n.language],
  );
  const publish = ready ? (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'publish', search: location.search }} />}
    >
      <Layers data-icon='inline-start' />
      {t('jobGrades.publish')}
    </Button>
  ) : null;
  const refreshing = history.loading || current.loading || grades.loading;
  return (
    <PageContainer>
      <div ref={headingRef}>
        <PageHeader
          title={t('jobGrades.title')}
          description={t('jobGrades.description')}
        />
      </div>
      <ApplicationToolbar
        actions={
          <>
            {publish}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label={t('jobGrades.refresh')}
                    disabled={refreshing}
                    onClick={refresh}
                  />
                }
              >
                <RefreshCw
                  className={refreshing ? 'animate-spin' : undefined}
                />
              </TooltipTrigger>
              <TooltipContent>{t('jobGrades.refresh')}</TooltipContent>
            </Tooltip>
          </>
        }
      >
        <div data-slot='application-filter' className='flex flex-col gap-2'>
          <Label htmlFor='salary-version-search'>{t('jobGrades.search')}</Label>
          <ApplicationSearch
            id='salary-version-search'
            placeholder={t('jobGrades.search')}
            inputMode='numeric'
            {...inputProps}
            value={text}
          />
        </div>
        {search ? (
          <Button
            variant='outline'
            onClick={() => clear((p) => p.delete('page'))}
          >
            {t('jobGrades.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {view.error ? (
        <Failure error={view.error} retry={view.retry} />
      ) : !view.isPending && !view.can ? (
        <Alert variant='destructive'>
          <AlertDescription>{t('jobGrades.privateDenied')}</AlertDescription>
        </Alert>
      ) : null}
      {history.error ? (
        <Failure error={history.error} retry={history.reload} />
      ) : null}
      {current.error ? (
        <Failure error={current.error} retry={current.reload} />
      ) : null}
      {grades.error ? (
        <Failure error={grades.error} retry={grades.reload} />
      ) : null}
      {(view.isPending || history.loading) && !history.data ? (
        <Loading />
      ) : history.data ? (
        <>
          {history.loading ? (
            <Spinner aria-label={t('jobGrades.loading')} />
          ) : null}
          {
            <DataTableServer
              columns={columns}
              rows={history.data.data}
              total={history.data.meta.total}
              getRowId={(row) => row.id}
              pagination={{ pageIndex: page - 1, pageSize }}
              onPaginationChange={(p) =>
                updateParams((v) => {
                  v.set('page', String(p.pageIndex + 1));
                  v.set('pageSize', String(p.pageSize));
                })
              }
              sorting={[{ id: sort, desc: direction === 'desc' }]}
              onSortingChange={(s) =>
                updateParams((p) => {
                  p.set('sort', s[0]?.id ?? 'version');
                  p.set('direction', s[0]?.desc === false ? 'asc' : 'desc');
                  p.delete('page');
                })
              }
              pageSizeOptions={[10, 20, 50, 100]}
              emptyMessage={
                <ApplicationTableEmpty
                  title={t(search ? 'jobGrades.noMatches' : 'jobGrades.empty')}
                  description={t(
                    search
                      ? 'jobGrades.noMatchesDescription'
                      : publish
                        ? 'jobGrades.emptyDescription'
                        : 'jobGrades.emptyReadonly',
                  )}
                  clearFilters={
                    search
                      ? {
                          label: t('jobGrades.clear'),
                          onClick: () => clear((p) => p.delete('page')),
                        }
                      : undefined
                  }
                />
              }
            />
          }
        </>
      ) : null}
      <Outlet context={context} />
    </PageContainer>
  );
}
