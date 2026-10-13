import { ApplicationTableEmpty } from '#components/application-table-empty';
import { StatusBadge } from '#components/status-badge';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { reportMoney } from './presentation';
import { useSearchParams } from 'react-router';
import { useUrlSearch } from '#hooks/use-url-search';
import { ApplicationSearch } from '#components/application-search';
import { ApplicationToolbar } from '#components/application-toolbar';
import { ExpenseSummaryReport } from './expense-summary.js';
import { LeaveApprovalEfficiencyReport } from './leave-approval-efficiency.js';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { format, parseISO } from 'date-fns';
import { Badge } from '#components/ui/badge';
import { TruncatedText } from '#components/truncated-text';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from '#components/ui/empty';
import { useDatePickerLocale } from '#hooks/use-date-picker-locale';
import { DatePicker } from '#components/date-picker';
import { DepartmentPicker } from '#components/department-picker';
import { PositionFilter } from './position-filter';
import { Label } from '#components/ui/label';
import { Download, RefreshCw, ChartNoAxesCombined } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useState } from 'react';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ResponsiveTable } from '#components/responsive-table';
import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';

type Dataset =
  | 'budget-balances'
  | 'contract-ledger'
  | 'headcount-balances'
  | 'leave-monthly';
type Row = { id: string } & Record<string, unknown>;
type Result = {
  data: Row[];
  meta: { page: number; pageSize: number; total: number; generatedAt: string };
};
const datasets: readonly Dataset[] = [
  'budget-balances',
  'contract-ledger',
  'headcount-balances',
  'leave-monthly',
];

function Report({ dataset }: { dataset: Dataset }) {
  const api = useApiClient(),
    { t } = useTranslation();
  const dateLocale = useDatePickerLocale();
  const thirdFilterId = useId();
  const yearFilterId = useId();
  const departmentFilterId = useId();
  const [generation, reload] = useReducer((n: number) => n + 1, 0);
  const search = useUrlSearch({
    param: `${dataset}-first`,
    resetParams: [`${dataset}-page`],
  });
  const secondSearch = useUrlSearch({
    param: `${dataset}-second`,
    resetParams: [`${dataset}-page`],
    writeParams: search.updateParams,
  });
  const thirdSearch = useUrlSearch({
    param: `${dataset}-third`,
    resetParams: [`${dataset}-page`],
    writeParams: search.updateParams,
  });
  const params = search.searchParams;
  const page = Math.max(1, Number(params.get(`${dataset}-page`)) || 1);
  const sort = useMemo(
    () => ({
      field: params.get(`${dataset}-sort`) || 'month',
      direction: params.get(`${dataset}-direction`) === 'asc' ? 'asc' : 'desc',
    }),
    [params, dataset],
  );
  const filters = useMemo(
    () => ({
      first: search.search,
      second: params.get(`${dataset}-second`) || '',
      third: params.get(`${dataset}-third`) || '',
    }),
    [params, dataset, search.search],
  );
  function setPage(value: number | ((old: number) => number)) {
    search.updateParams((p) =>
      p.set(
        `${dataset}-page`,
        String(typeof value === 'function' ? value(page) : value),
      ),
    );
  }
  function setFilters(
    value: typeof filters | ((old: typeof filters) => typeof filters),
  ) {
    const next = typeof value === 'function' ? value(filters) : value;
    search.updateParams((p) => {
      for (const key of ['first', 'second', 'third'] as const) {
        if (next[key]) p.set(`${dataset}-${key}`, next[key]);
        else p.delete(`${dataset}-${key}`);
      }
      p.delete(`${dataset}-page`);
    });
  }
  function setSort(updater: (old: typeof sort) => typeof sort) {
    const next = updater(sort);
    search.updateParams((p) => {
      p.set(`${dataset}-sort`, next.field);
      p.set(`${dataset}-direction`, next.direction);
      p.delete(`${dataset}-page`);
    });
  }
  const [result, setResult] = useState<{
    data?: Result;
    error?: unknown;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    const abort = new AbortController();
    void Promise.resolve().then(() => {
      if (!abort.signal.aborted)
        setResult((old) => ({ data: old.data, loading: true }));
    });
    if (
      dataset === 'leave-monthly' &&
      ((filters.second &&
        (!/^\d{4}$/.test(filters.second) || Number(filters.second) < 1900)) ||
        (filters.third &&
          (!/^\d{1,2}$/.test(filters.third) ||
            Number(filters.third) < 1 ||
            Number(filters.third) > 12)))
    ) {
      void Promise.resolve().then(() => {
        if (!abort.signal.aborted)
          setResult({
            error: new Error('Invalid month or year'),
            loading: false,
          });
      });
      return () => abort.abort();
    }
    const query: Record<string, string> = {
      page: String(page),
      pageSize: '20',
    };
    if (dataset === 'leave-monthly') {
      query.sort = sort.field;
      query.direction = sort.direction;
      query.locale = dateLocale.code === 'zh-CN' ? 'zh-CN' : 'en-US';
    }
    if (filters.first)
      query[dataset === 'contract-ledger' ? 'search' : 'departmentId'] =
        filters.first;
    if (filters.second)
      query[dataset === 'contract-ledger' ? 'status' : 'year'] = filters.second;
    if (filters.third)
      query[
        dataset === 'contract-ledger'
          ? 'endsBefore'
          : dataset === 'leave-monthly'
            ? 'month'
            : 'positionId'
      ] = filters.third;
    api
      .request<Result>({
        path: `reports/${dataset}`,
        query,
        signal: abort.signal,
      })
      .then(
        (data) => !abort.signal.aborted && setResult({ data, loading: false }),
        (error: unknown) =>
          !abort.signal.aborted && setResult({ error, loading: false }),
      );
    return () => abort.abort();
  }, [api, dataset, filters, generation, page, sort, dateLocale.code]);
  const rows = result.data?.data ?? [];
  const columns: readonly string[] = {
    'budget-balances': [
      'departmentName',
      'year',
      'subjectName',
      'allocatedCents',
      'heldCents',
      'usedCents',
      'availableCents',
    ],
    'headcount-balances': [
      'departmentName',
      'positionName',
      'year',
      'limit',
      'used',
      'pending',
      'allocated',
      'replacementPending',
      'replacementAllocated',
      'replacementBlocked',
      'available',
      'capacityState',
    ],
    'contract-ledger': [
      'number',
      'departmentName',
      'status',
      'amountCents',
      'heldCents',
      'paidCents',
      'availableCents',
      'startsOn',
      'endsOn',
      'asOf',
      'expiryState',
      'paymentState',
      'paidBasisPoints',
    ],
    'leave-monthly': [
      'leaveType',
      'year',
      'month',
      'approvedRequestCount',
      'approvedRequestedDays',
    ],
  }[dataset];
  const forbidden =
    result.error instanceof ApiClientError && result.error.status === 403;
  const expired =
    result.error instanceof ApiClientError && result.error.status === 401;
  const invalidFilters =
    result.error instanceof Error &&
    result.error.message === 'Invalid month or year';
  const tooLarge =
    dataset === 'leave-monthly' &&
    result.error instanceof ApiClientError &&
    result.error.status === 412;
  const hasFilters = !!(
    search.text ||
    filters.second ||
    filters.third ||
    secondSearch.text ||
    thirdSearch.text
  );
  const pendingFilters =
    secondSearch.text.trim() !== filters.second ||
    (dataset === 'leave-monthly' && thirdSearch.text.trim() !== filters.third);
  function clearFilters() {
    // Cancel each pending input write before removing the complete filter set.
    secondSearch.clear();
    thirdSearch.clear();
    search.clear((params) => {
      params.delete(`${dataset}-second`);
      params.delete(`${dataset}-third`);
      params.delete(`${dataset}-page`);
    });
  }
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  async function download() {
    if (exporting || pendingFilters) return;
    setExporting(true);
    setExportError(null);
    const query: Record<string, string> = {};
    if (dataset === 'leave-monthly') {
      query.sort = sort.field;
      query.direction = sort.direction;
      query.locale = dateLocale.code === 'zh-CN' ? 'zh-CN' : 'en-US';
    }
    if (filters.first)
      query[dataset === 'contract-ledger' ? 'search' : 'departmentId'] =
        filters.first;
    if (filters.second)
      query[dataset === 'contract-ledger' ? 'status' : 'year'] = filters.second;
    if (filters.third)
      query[
        dataset === 'contract-ledger'
          ? 'endsBefore'
          : dataset === 'leave-monthly'
            ? 'month'
            : 'positionId'
      ] = filters.third;
    try {
      const stream = await api.stream({
        path: `reports/${dataset}.xlsx`,
        query,
      });
      const reader = stream.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        chunks.push(item.value);
        size += item.value.byteLength;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `${dataset}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error: unknown) {
      if (
        dataset === 'leave-monthly' &&
        error instanceof ApiClientError &&
        [401, 403].includes(error.status)
      )
        setResult({ error, loading: false });
      setExportError(
        dataset === 'leave-monthly' &&
          error instanceof ApiClientError &&
          error.status === 412
          ? 'reports.sourceLimit'
          : 'reports.exportFailed',
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`reports.datasets.${dataset}.title`)}</CardTitle>
        <CardDescription>
          {t(`reports.datasets.${dataset}.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <ApplicationToolbar
          actions={
            <>
              {hasFilters ? (
                <Button variant='outline' onClick={clearFilters}>
                  {t('reports.clearFilters')}
                </Button>
              ) : null}
              {dataset !== 'leave-monthly' || (!forbidden && !expired) ? (
                <Button
                  variant='outline'
                  disabled={
                    forbidden ||
                    result.loading ||
                    !!result.error ||
                    exporting ||
                    pendingFilters
                  }
                  onClick={() => void download()}
                >
                  <Download data-icon='inline-start' />
                  {t(exporting ? 'reports.exporting' : 'reports.export')}
                </Button>
              ) : null}
              <Button
                variant='outline'
                size='icon'
                aria-label={t('reports.refresh')}
                title={t('reports.refresh')}
                onClick={reload}
              >
                <RefreshCw
                  className={result.loading ? 'animate-spin' : undefined}
                />
              </Button>
            </>
          }
        >
          {dataset === 'contract-ledger' ? (
            <ApplicationSearch
              className='sm:w-56'
              aria-label={t('reports.filters.search')}
              placeholder={t('reports.filters.search')}
              {...search.inputProps}
            />
          ) : dataset !== 'leave-monthly' ? (
            <div
              data-slot='application-filter'
              className='flex min-w-0 flex-col gap-2'
            >
              <Label htmlFor={departmentFilterId}>
                {t('reports.filters.department')}
              </Label>
              <DepartmentPicker
                id={departmentFilterId}
                className='w-full sm:w-56'
                includeInactive
                value={filters.first}
                onChange={(departmentId) => {
                  setPage(1);
                  setFilters((value) => ({ ...value, first: departmentId }));
                }}
              />
            </div>
          ) : null}
          <div
            data-slot='application-filter'
            data-context='true'
            className='flex flex-col gap-2'
          >
            {dataset !== 'contract-ledger' ? (
              <Label htmlFor={yearFilterId}>{t('reports.filters.year')}</Label>
            ) : null}
            <Input
              id={dataset !== 'contract-ledger' ? yearFilterId : undefined}
              className='sm:w-44'
              type={dataset === 'contract-ledger' ? 'text' : 'number'}
              aria-label={t(
                dataset === 'contract-ledger'
                  ? 'reports.filters.status'
                  : 'reports.filters.year',
              )}
              placeholder={t(
                dataset === 'contract-ledger'
                  ? 'reports.filters.statusHint'
                  : 'reports.filters.year',
              )}
              {...secondSearch.inputProps}
            />
          </div>
          {dataset !== 'budget-balances' ? (
            <div
              data-slot='application-filter'
              data-context='true'
              className='flex flex-col gap-2'
            >
              <Label htmlFor={thirdFilterId}>
                {t(
                  dataset === 'contract-ledger'
                    ? 'reports.filters.endsBefore'
                    : dataset === 'leave-monthly'
                      ? 'reports.filters.month'
                      : 'reports.filters.position',
                )}
              </Label>
              {dataset === 'contract-ledger' ? (
                <DatePicker
                  id={thirdFilterId}
                  className='w-full sm:w-56'
                  placeholder={t('reports.filters.endsBefore')}
                  value={filters.third ? parseISO(filters.third) : undefined}
                  onChange={(date) => {
                    setPage(1);
                    setFilters((value) => ({
                      ...value,
                      third: date ? format(date, 'yyyy-MM-dd') : '',
                    }));
                  }}
                />
              ) : dataset === 'leave-monthly' ? (
                <Input
                  id={thirdFilterId}
                  type='number'
                  min={1}
                  max={12}
                  {...thirdSearch.inputProps}
                />
              ) : (
                <PositionFilter
                  id={thirdFilterId}
                  value={filters.third}
                  onChange={(positionId) => {
                    setPage(1);
                    setFilters((value) => ({ ...value, third: positionId }));
                  }}
                />
              )}
            </div>
          ) : null}
        </ApplicationToolbar>
        {dataset === 'headcount-balances' ? (
          <p className='text-sm text-muted-foreground'>
            {t('reports.capacityNotice')}
          </p>
        ) : null}
        {exportError ? (
          <Alert variant='destructive'>
            <AlertDescription>{t(exportError)}</AlertDescription>
          </Alert>
        ) : null}
        {result.loading && result.data ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('reportsExpense.reloading')}
          </p>
        ) : null}
        {result.loading && !result.data ? (
          <ApplicationTableSkeleton columns={5} />
        ) : null}
        {expired ? <SessionExpiredAlert /> : null}
        {result.error && !result.data && !expired ? (
          <Alert variant={forbidden ? 'default' : 'destructive'}>
            <AlertDescription>
              {t(
                forbidden
                  ? dataset === 'leave-monthly'
                    ? 'reports.monthlyForbidden'
                    : 'reports.forbidden'
                  : tooLarge
                    ? 'reports.sourceLimit'
                    : invalidFilters
                      ? 'reports.invalidFilters'
                      : 'reports.failed',
              )}
            </AlertDescription>
            {!forbidden && !tooLarge && !invalidFilters ? (
              <AlertAction>
                <Button variant='outline' onClick={reload}>
                  {t('reports.retry')}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
        {result.data &&
          (rows.length ? (
            <ResponsiveTable>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column}
                      className={
                        column.endsWith('Cents') ||
                        (dataset === 'leave-monthly' && column !== 'leaveType')
                          ? 'text-right'
                          : undefined
                      }
                    >
                      {dataset === 'leave-monthly' && column !== 'leaveType' ? (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setPage(1);
                            setSort((value) => ({
                              field: column,
                              direction:
                                value.field === column &&
                                value.direction === 'desc'
                                  ? 'asc'
                                  : 'desc',
                            }));
                          }}
                        >
                          {t(`reports.fields.${column}`)}
                          {sort.field === column
                            ? sort.direction === 'asc'
                              ? ' ↑'
                              : ' ↓'
                            : ''}
                        </Button>
                      ) : (
                        t(`reports.fields.${column}`, { defaultValue: column })
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    {columns.map((column) => (
                      <TableCell
                        key={column}
                        className={
                          column.endsWith('Cents') ||
                          (dataset === 'leave-monthly' &&
                            column !== 'leaveType')
                            ? 'text-right tabular-nums'
                            : undefined
                        }
                      >
                        {column.endsWith('Cents') &&
                        typeof row[column] === 'number' ? (
                          reportMoney(row[column], dateLocale.code ?? 'en-US')
                        ) : column === 'subjectName' ? (
                          String(
                            (
                              row.subjectLabel as
                                Record<string, string> | undefined
                            )?.[
                              dateLocale.code === 'zh-CN' ? 'zh-CN' : 'en-US'
                            ] ??
                              (typeof row.subject === 'string'
                                ? row.subject
                                : '—'),
                          )
                        ) : column === 'status' &&
                          typeof row[column] === 'string' ? (
                          <StatusBadge
                            tone={
                              row[column] === 'terminated'
                                ? 'neutral'
                                : row[column] === 'activePendingSeal'
                                  ? 'warning'
                                  : 'info'
                            }
                          >
                            {t(`reports.states.${row[column]}`)}
                          </StatusBadge>
                        ) : dataset === 'leave-monthly' &&
                          typeof row[column] === 'number' ? (
                          row[column].toLocaleString(dateLocale.code, {
                            useGrouping: !['year', 'month'].includes(column),
                          })
                        ) : dataset === 'leave-monthly' &&
                          column === 'leaveType' ? (
                          <TruncatedText text={String(row[column])}>
                            <Badge variant='outline'>
                              {String(row[column])}
                            </Badge>
                          </TruncatedText>
                        ) : column === 'available' &&
                          row.initialized === false ? (
                          <StatusBadge tone='warning'>
                            {t('reports.states.uninitialized')}
                          </StatusBadge>
                        ) : [
                            'capacityState',
                            'expiryState',
                            'paymentState',
                          ].includes(column) &&
                          typeof row[column] === 'string' ? (
                          <StatusBadge
                            tone={
                              [
                                'blocked',
                                'uninitialized',
                                'overpaid',
                                'expired',
                              ].includes(row[column])
                                ? 'warning'
                                : ['paid', 'ready'].includes(row[column])
                                  ? 'success'
                                  : row[column] === 'terminated'
                                    ? 'neutral'
                                    : 'info'
                            }
                          >
                            {t(`reports.states.${row[column]}`)}
                          </StatusBadge>
                        ) : ['startsOn', 'endsOn', 'asOf'].includes(column) &&
                          typeof row[column] === 'string' ? (
                          format(parseISO(row[column]), 'PPP', {
                            locale: dateLocale,
                          })
                        ) : column === 'paidBasisPoints' &&
                          typeof row[column] === 'number' ? (
                          (row[column] / 10000).toLocaleString(
                            dateLocale.code,
                            { style: 'percent', maximumFractionDigits: 2 },
                          )
                        ) : typeof row[column] === 'string' ||
                          typeof row[column] === 'number' ||
                          typeof row[column] === 'boolean' ? (
                          String(row[column])
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </ResponsiveTable>
          ) : dataset === 'leave-monthly' ? (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ChartNoAxesCombined />
                </EmptyMedia>
                <EmptyTitle>
                  {t(hasFilters ? 'reports.empty' : 'reports.monthlyEmpty')}
                </EmptyTitle>
                <EmptyDescription>
                  {t('reports.monthlyEmptyHint')}
                </EmptyDescription>
              </EmptyHeader>
              {hasFilters ? (
                <EmptyContent>
                  <Button variant='outline' onClick={clearFilters}>
                    {t('reports.clearFilters')}
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ResponsiveTable>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column}>
                      {t(`reports.fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <ApplicationTableEmpty
                      title={t(hasFilters ? 'reports.empty' : 'reports.noData')}
                      clearFilters={
                        hasFilters
                          ? {
                              label: t('reports.clearFilters'),
                              onClick: clearFilters,
                            }
                          : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              </TableBody>
            </ResponsiveTable>
          ))}
        {result.data ? (
          <div
            data-slot='table-pagination'
            className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'
          >
            <span>
              {t('reports.total', { count: result.data.meta.total })} ·{' '}
              {t('reports.generatedAt', {
                value: new Date(result.data.meta.generatedAt).toLocaleString(
                  dateLocale.code,
                ),
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={result.loading || result.data.meta.page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {t('reports.previous')}
              </Button>
              <Button
                variant='outline'
                disabled={
                  result.loading ||
                  result.data.meta.page * result.data.meta.pageSize >=
                    result.data.meta.total
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {t('reports.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  return <AuthorizedReportsPage key={`${session?.user.id}:${revision}`} />;
}
function AuthorizedReportsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const api = useApiClient();
  const [visible, setVisible] = useState<string[]>();
  const [error, setError] = useState<unknown>();
  const [generation, reload] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    api
      .request<{ data: string[] }>({
        path: 'reports/datasets',
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (!controller.signal.aborted) {
            setVisible(result.data);
            setError(undefined);
          }
        },
        (failure) => {
          if (!controller.signal.aborted) {
            setVisible(undefined);
            setError(failure);
          }
        },
      );
    return () => controller.abort();
  }, [api, generation]);
  const requested = params.get('dataset');
  const selected =
    requested && visible?.includes(requested)
      ? requested
      : (visible?.[0] ?? '');

  return (
    <PageContainer>
      <PageHeader
        title={t('reports.title')}
        description={t('reports.description')}
      />
      {error instanceof ApiClientError && error.status === 401 ? (
        <SessionExpiredAlert />
      ) : error ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              error instanceof ApiClientError &&
                [403, 404].includes(error.status)
                ? 'reports.forbidden'
                : 'reports.failed',
            )}
          </AlertDescription>
          {!(
            error instanceof ApiClientError && [403, 404].includes(error.status)
          ) ? (
            <AlertAction>
              <Button variant='outline' onClick={reload}>
                {t('reports.retry')}
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : !visible ? (
        <ApplicationTableSkeleton columns={5} />
      ) : !visible.length ? (
        <Alert>
          <AlertDescription>{t('reports.forbidden')}</AlertDescription>
        </Alert>
      ) : null}
      {visible?.length ? (
        <Tabs
          value={selected}
          onValueChange={(value: string) =>
            setParams(
              (old) => {
                const next = new URLSearchParams(old);
                next.set('dataset', value);
                return next;
              },
              { replace: true },
            )
          }
        >
          <TabsList
            variant='line'
            className='h-auto max-w-full flex-wrap gap-y-2 group-data-horizontal/tabs:h-auto'
          >
            {datasets
              .filter((dataset) => visible?.includes(dataset))
              .map((dataset) => (
                <TabsTrigger
                  key={dataset}
                  value={dataset}
                  className='h-auto min-h-8'
                >
                  {t(`reports.datasets.${dataset}.title`)}
                </TabsTrigger>
              ))}
            {visible.includes('leave-approval-efficiency') ? (
              <TabsTrigger
                value='leave-approval-efficiency'
                className='h-auto min-h-8'
              >
                {t('reportsEfficiency.title')}
              </TabsTrigger>
            ) : null}
            {visible.includes('expense-summary') ? (
              <TabsTrigger value='expense-summary' className='h-auto min-h-8'>
                {t('reportsExpense.title')}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value='expense-summary'>
            <ExpenseSummaryReport />
          </TabsContent>
          <TabsContent value='leave-approval-efficiency'>
            <LeaveApprovalEfficiencyReport />
          </TabsContent>
          {datasets
            .filter((dataset) => visible?.includes(dataset))
            .map((dataset) => (
              <TabsContent key={dataset} value={dataset}>
                <Report dataset={dataset} />
              </TabsContent>
            ))}
        </Tabs>
      ) : null}
    </PageContainer>
  );
}
