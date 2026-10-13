import { ApplicationTableEmpty } from '#components/application-table-empty';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useMemo } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Eye,
  Pencil,
  Upload,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTableServer } from '#components/data-table';
import { StatusBadge } from '#components/status-badge';
import { TruncatedText } from '#components/truncated-text';
import { Button } from '#components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from '#components/ui/dropdown-menu';
import { Spinner } from '#components/ui/spinner';
import { useResource } from './resource.js';
import {
  ALL_SOURCES,
  supported,
  selectWidth,
  type Template,
  type Page,
} from './types.js';
import { Loading, ErrorState } from './states.js';
export default function Templates() {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const source = ALL_SOURCES.find((s) => s === params.get('source'));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize'))
    : 20;
  const r = useResource<Page>('printTemplates', {
    mode: 'manage',
    page: String(page),
    pageSize: String(size),
    ...(source ? { source } : {}),
  });
  const context = useMemo(() => ({ reload: r.reload }), [r.reload]);
  const link = (path: string) => ({ pathname: path, search: location.search });
  const newButton = (
    <Button render={<Link to={link('new')} />}>
      <Plus />
      {t('templatePrintUI.new')}
    </Button>
  );
  const clear = () =>
    setParams((p) => {
      p.delete('source');
      p.delete('page');
      return p;
    });
  const columns: ColumnDef<Template, unknown>[] = [
    {
      id: 'name',
      header: t('templatePrintUI.name'),
      cell: ({ row }) => (
        <Link
          className='rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-ring focus-visible:outline-2'
          to={link(row.original.id)}
        >
          <TruncatedText
            text={row.original.name ?? t('templatePrintUI.unreadable')}
          />
        </Link>
      ),
    },
    {
      id: 'source',
      header: t('templatePrintUI.source'),
      cell: ({ row }) => (
        <StatusBadge tone='neutral'>
          {row.original.source
            ? t(`templatePrintUI.sourceLabels.${row.original.source}`)
            : t('templatePrintUI.unreadable')}
        </StatusBadge>
      ),
    },
    {
      id: 'status',
      header: t('templatePrintUI.active'),
      cell: ({ row }) => {
        const v = row.original;
        const key = !supported(v.source)
          ? 'unsupported'
          : typeof v.active !== 'boolean' ||
              !Object.hasOwn(v, 'currentRevisionId')
            ? 'unreadable'
            : !v.active
              ? 'inactive'
              : !v.currentRevisionId
                ? 'noRevision'
                : 'active';
        return (
          <StatusBadge tone={key === 'active' ? 'success' : 'neutral'}>
            {t(`templatePrintUI.${key}`)}
          </StatusBadge>
        );
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label={t('templatePrintUI.actions', {
                  name: row.original.name ?? row.original.id,
                })}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent className='w-auto min-w-40' align='end'>
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to={link(row.original.id)} />}>
                <Eye />
                {t('templatePrintUI.view')}
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<Link to={link(`edit/${row.original.id}`)} />}
              >
                <Pencil />
                {t('templatePrintUI.edit')}
              </DropdownMenuItem>
              {supported(row.original.source) ? (
                <DropdownMenuItem
                  render={<Link to={link(`upload/${row.original.id}`)} />}
                >
                  <Upload />
                  {t('templatePrintUI.upload')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('templatePrintUI.title')}
        description={t('templatePrintUI.description')}
      />
      <ApplicationToolbar
        actions={
          <>
            {newButton}
            <Button
              data-print-management-focus
              variant='outline'
              size='icon'
              aria-label={t('templatePrintUI.refresh')}
              title={t('templatePrintUI.refresh')}
              onClick={r.reload}
              disabled={r.loading}
            >
              {r.loading ? <Spinner /> : <RefreshCw />}
            </Button>
          </>
        }
      >
        <Select
          items={[
            { value: 'all', label: t('templatePrintUI.all') },
            ...ALL_SOURCES.map((value) => ({
              value,
              label: t(`templatePrintUI.sourceLabels.${value}`),
            })),
          ]}
          value={source ?? 'all'}
          onValueChange={(v) =>
            setParams((p) => {
              if (v === 'all') p.delete('source');
              else if (v && ALL_SOURCES.some((s) => s === v))
                p.set('source', v);
              p.delete('page');
              return p;
            })
          }
        >
          <SelectTrigger aria-label={t('templatePrintUI.source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectWidth}>
            <SelectGroup>
              <SelectItem value='all'>{t('templatePrintUI.all')}</SelectItem>
              {ALL_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`templatePrintUI.sourceLabels.${s}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {source ? (
          <Button variant='outline' onClick={clear}>
            {t('templatePrintUI.clear')}
          </Button>
        ) : null}
      </ApplicationToolbar>
      {r.error ? <ErrorState error={r.error} retry={r.reload} /> : null}
      {!r.data && r.loading ? <Loading /> : null}
      {r.data ? (
        <DataTableServer
          columns={columns}
          rows={r.data.data}
          total={r.data.meta.total}
          getRowId={(v) => v.id}
          pagination={{ pageIndex: page - 1, pageSize: size }}
          onPaginationChange={(p) =>
            setParams((v) => {
              v.set('page', String(p.pageIndex + 1));
              v.set('pageSize', String(p.pageSize));
              return v;
            })
          }
          emptyMessage={
            <ApplicationTableEmpty
              title={t(
                source ? 'templatePrintUI.noResults' : 'templatePrintUI.empty',
              )}
              description={t(
                source
                  ? 'templatePrintUI.noResultsDescription'
                  : 'templatePrintUI.emptyDescription',
              )}
              clearFilters={
                source
                  ? { label: t('templatePrintUI.clear'), onClick: clear }
                  : undefined
              }
            />
          }
          pageSizeOptions={[10, 20, 50, 100]}
        />
      ) : null}
      <Outlet context={context} />
    </PageContainer>
  );
}
