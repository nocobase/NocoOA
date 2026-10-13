import { reportMoney } from './presentation';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { ChartNoAxesCombined, Download, RefreshCw } from 'lucide-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useUrlSearch } from '#hooks/use-url-search';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { DataTable } from '#components/data-table';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { TruncatedText } from '#components/truncated-text';
import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { useDatePickerLocale } from '#hooks/use-date-picker-locale';

type ExpenseRow = {
  id: string;
  year: number;
  month: number;
  category: string;
  settledRequestCount: number;
  settledExpenseCents: number;
};
type ExpenseResult = {
  data: ExpenseRow[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    generatedAt: string;
    filters: { year: number; month?: number };
  };
};
const params = ['expenseYear', 'expenseMonth', 'expensePage'] as const;

/** Read-only owner projection; gross cents never allocate whole-request offsets to categories. */
export function ExpenseSummaryReport() {
  const { session } = useAuthentication();
  const revision = useAuthorizationRevision();
  // Source permission/account changes drop old rows and abort list/download even when the shared client stays stable.
  return (
    <ExpenseSummaryContent key={`${session?.user.id ?? ''}:${revision}`} />
  );
}

function ExpenseSummaryContent() {
  const api = useApiClient();
  const toaster = useToaster();
  const { t } = useTranslation();
  const dateLocale = useDatePickerLocale();
  const locale = dateLocale.code === 'zh-CN' ? 'zh-CN' : 'en-US';
  const yearId = useId(),
    monthId = useId();
  const yearSearch = useUrlSearch({
    param: params[0],
    resetParams: [params[2]],
  });
  const search = yearSearch.searchParams;
  const year = yearSearch.search,
    month = search.get(params[1]) ?? '';
  const yearDraft = yearSearch.text;
  const [monthDraft, setMonthDraft] = useState(month);
  const [seenMonth, setSeenMonth] = useState(month);
  const ownMonthRef = useRef(month);
  const [composingMonth, setComposingMonth] = useState(false);
  if (month !== seenMonth) {
    setSeenMonth(month);
    if (month !== ownMonthRef.current) {
      ownMonthRef.current = month;
      setMonthDraft(month);
    }
  }
  const updateParamsRef = useRef(yearSearch.updateParams);
  useEffect(() => {
    updateParamsRef.current = yearSearch.updateParams;
  });
  useEffect(() => {
    if (composingMonth || monthDraft === month) return;
    const timer = window.setTimeout(() => {
      ownMonthRef.current = monthDraft;
      // Both draft timers write through one latest URL ref; independent refs would lose simultaneous filters.
      updateParamsRef.current((next) => {
        if (monthDraft) next.set(params[1], monthDraft);
        else next.delete(params[1]);
        next.delete(params[2]);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [monthDraft, month, composingMonth]);
  const rawPage = search.get(params[2]) ?? '1';
  const page =
    /^\d+$/.test(rawPage) &&
    Number.isSafeInteger(Number(rawPage)) &&
    Number(rawPage) > 0
      ? Number(rawPage)
      : 1;
  const invalid = !!(
    (yearDraft && (!/^\d{4}$/.test(yearDraft) || Number(yearDraft) < 1900)) ||
    (monthDraft &&
      (!/^\d{1,2}$/.test(monthDraft) ||
        Number(monthDraft) < 1 ||
        Number(monthDraft) > 12))
  );
  const query = useMemo(
    () => ({ locale, ...(year ? { year } : {}), ...(month ? { month } : {}) }),
    [locale, year, month],
  );
  const queryKey = JSON.stringify({ ...query, page });
  const [generation, reload] = useReducer((n: number) => n + 1, 0);
  const [result, setResult] = useState<{
    key?: string;
    data?: ExpenseResult;
    error?: unknown;
    loading: boolean;
  }>({ loading: true });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => exportControllerRef.current?.abort(), [queryKey]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setExportError(null);
        setResult((old) => ({
          key: queryKey,
          data: invalid ? undefined : old.data,
          loading: !invalid,
        }));
      }
    });
    if (!invalid)
      void api
        .request<ExpenseResult>({
          path: 'reports/expense-summary',
          query: { ...query, page: String(page), pageSize: '20' },
          signal: controller.signal,
        })
        .then(
          (data) =>
            !controller.signal.aborted &&
            setResult({ key: queryKey, data, loading: false }),
          (error: unknown) =>
            !controller.signal.aborted &&
            setResult({ key: queryKey, error, loading: false }),
        );
    return () => controller.abort();
  }, [api, query, queryKey, page, generation, invalid]);
  const current =
    result.key === queryKey
      ? result
      : { data: invalid ? undefined : result.data, loading: !invalid };
  const forbidden =
    current.error instanceof ApiClientError && current.error.status === 403;
  const expired =
    current.error instanceof ApiClientError && current.error.status === 401;
  const precondition =
    current.error instanceof ApiClientError && current.error.status === 412;
  const hasFilters = !!(yearDraft || monthDraft);
  const columns = useMemo<ColumnDef<ExpenseRow, unknown>[]>(
    () => [
      ...(['year', 'month'] as const).map((field) => ({
        accessorKey: field,
        header: t(`reportsExpense.fields.${field}`),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }: { row: { original: ExpenseRow } }) => (
          <div className='text-right tabular-nums'>
            {row.original[field].toLocaleString(locale, { useGrouping: false })}
          </div>
        ),
      })),
      {
        accessorKey: 'category',
        enableSorting: false,
        enableHiding: false,
        header: t('reportsExpense.fields.category'),
        cell: ({ row }) => (
          <TruncatedText text={row.original.category}>
            <Badge variant='outline'>{row.original.category}</Badge>
          </TruncatedText>
        ),
      },
      ...(['settledRequestCount', 'settledExpenseCents'] as const).map(
        (field) => ({
          accessorKey: field,
          header: t(`reportsExpense.fields.${field}`),
          enableSorting: false,
          enableHiding: false,
          cell: ({ row }: { row: { original: ExpenseRow } }) => (
            <div className='text-right tabular-nums'>
              {field === 'settledExpenseCents'
                ? reportMoney(row.original[field], locale)
                : row.original[field].toLocaleString(locale)}
            </div>
          ),
        }),
      ),
    ],
    [t, locale],
  );
  function change(name: string, value: string) {
    yearSearch.updateParams((next) => {
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== params[2]) next.delete(params[2]);
    });
  }
  function clear() {
    ownMonthRef.current = '';
    setMonthDraft('');
    yearSearch.clear((next) => {
      for (const param of params) next.delete(param);
    });
  }
  async function download() {
    if (
      exportControllerRef.current ||
      !current.data ||
      current.loading ||
      invalid ||
      yearDraft !== year ||
      monthDraft !== month
    )
      return;
    const controller = new AbortController();
    exportControllerRef.current = controller;
    setExporting(true);
    setExportError(null);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      // Pin the owner-resolved company year so an annual clock rollover cannot change export scope.
      const stream = await api.stream({
        path: 'reports/expense-summary/export',
        query: { ...query, year: String(current.data.meta.filters.year) },
        signal: controller.signal,
      });
      reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        chunks.push(item.value);
        size += item.value.byteLength;
      }
      if (controller.signal.aborted) return;
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
      link.download = 'expense-summary.xlsx';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toaster.show({
        type: 'success',
        title: t('reportsExpense.exportStarted'),
      });
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        if (
          error instanceof ApiClientError &&
          [401, 403].includes(error.status)
        )
          setResult({ key: queryKey, error, loading: false });
        toaster.show({ type: 'error', title: t('reports.exportFailed') });
        setExportError(
          error instanceof ApiClientError && error.status === 412
            ? 'reportsExpense.precondition'
            : 'reports.exportFailed',
        );
      }
    } finally {
      reader?.releaseLock();
      exportControllerRef.current = null;
      setExporting(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reportsExpense.title')}</CardTitle>
        <CardDescription>{t('reportsExpense.description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-4'>
        <ApplicationToolbar
          actions={
            <>
              {hasFilters ? (
                <Button variant='outline' disabled={exporting} onClick={clear}>
                  {t('reports.clearFilters')}
                </Button>
              ) : null}
              {!forbidden && !expired ? (
                <Button
                  variant='outline'
                  disabled={
                    exporting ||
                    yearDraft !== year ||
                    monthDraft !== month ||
                    current.loading ||
                    !!current.error ||
                    invalid ||
                    !current.data
                  }
                  onClick={() => void download()}
                >
                  <Download data-icon='inline-start' />
                  {t(exporting ? 'reports.exporting' : 'reports.export')}
                </Button>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={t('reports.refresh')}
                      disabled={exporting || current.loading}
                      onClick={reload}
                    />
                  }
                >
                  <RefreshCw
                    className={current.loading ? 'animate-spin' : undefined}
                  />
                </TooltipTrigger>
                <TooltipContent>{t('reports.refresh')}</TooltipContent>
              </Tooltip>
            </>
          }
        >
          <div
            data-slot='application-filter'
            data-context='true'
            className='flex flex-col gap-2'
          >
            <Label htmlFor={yearId}>{t('reports.filters.year')}</Label>
            <Input
              id={yearId}
              className='sm:w-44'
              inputMode='numeric'
              {...yearSearch.inputProps}
              disabled={exporting}
            />
          </div>
          <div
            data-slot='application-filter'
            data-context='true'
            className='flex flex-col gap-2'
          >
            <Label htmlFor={monthId}>{t('reportsExpense.month')}</Label>
            <Input
              id={monthId}
              className='sm:w-44'
              inputMode='numeric'
              value={monthDraft}
              onChange={(event) => setMonthDraft(event.target.value)}
              onCompositionStart={() => setComposingMonth(true)}
              onCompositionEnd={() => setComposingMonth(false)}
              disabled={exporting}
            />
          </div>
        </ApplicationToolbar>
        <p className='text-sm text-muted-foreground'>
          {t('reportsExpense.sourceNotice')}
        </p>
        {current.data ? (
          <p className='text-sm text-muted-foreground'>
            {t('reportsExpense.effectiveYear', {
              year: String(current.data.meta.filters.year),
            })}
          </p>
        ) : null}
        {current.loading && current.data ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('reportsExpense.reloading')}
          </p>
        ) : null}
        {exporting ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('reportsExpense.exportLock')}
          </p>
        ) : null}
        {exportError ? (
          <Alert variant='destructive'>
            <AlertDescription>{t(exportError)}</AlertDescription>
          </Alert>
        ) : null}
        {current.loading && !current.data ? (
          <ApplicationTableSkeleton columns={5} />
        ) : null}
        {expired ? <SessionExpiredAlert /> : null}
        {(current.error || invalid) && !expired ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t(
                invalid
                  ? 'reports.invalidFilters'
                  : forbidden
                    ? 'reportsExpense.forbidden'
                    : precondition
                      ? 'reportsExpense.precondition'
                      : 'reports.failed',
              )}
            </AlertDescription>
            {!forbidden && !precondition && !invalid ? (
              <AlertAction>
                <Button variant='outline' onClick={reload}>
                  {t('reports.retry')}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
        {current.data ? (
          current.data.data.length ? (
            <DataTable
              columns={columns}
              data={current.data.data}
              getRowId={(row) => row.id}
              pagination={false}
            />
          ) : (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ChartNoAxesCombined />
                </EmptyMedia>
                <EmptyTitle>
                  {t(
                    current.data.meta.total > 0
                      ? 'reportsExpense.pageEmpty'
                      : hasFilters
                        ? 'reports.empty'
                        : 'reportsExpense.empty',
                  )}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    current.data.meta.total > 0
                      ? 'reportsExpense.pageEmptyHint'
                      : 'reportsExpense.emptyHint',
                  )}
                </EmptyDescription>
              </EmptyHeader>
              {current.data.meta.total > 0 || hasFilters ? (
                <EmptyContent>
                  {current.data.meta.total > 0 ? (
                    <Button
                      variant='outline'
                      disabled={exporting}
                      onClick={() => change(params[2], '1')}
                    >
                      {t('reportsExpense.firstPage')}
                    </Button>
                  ) : null}
                  {hasFilters ? (
                    <Button
                      variant='outline'
                      disabled={exporting}
                      onClick={clear}
                    >
                      {t('reports.clearFilters')}
                    </Button>
                  ) : null}
                </EmptyContent>
              ) : null}
            </Empty>
          )
        ) : null}
        {current.data ? (
          <div
            data-slot='table-pagination'
            className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'
          >
            <span>
              {t('reports.total', { count: current.data.meta.total })} ·{' '}
              {t('reports.generatedAt', {
                value: new Date(current.data.meta.generatedAt).toLocaleString(
                  locale,
                ),
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={
                  exporting || current.loading || current.data.meta.page <= 1
                }
                onClick={() => change(params[2], String(Math.max(1, page - 1)))}
              >
                {t('reports.previous')}
              </Button>
              <Button
                variant='outline'
                disabled={
                  exporting ||
                  yearDraft !== year ||
                  monthDraft !== month ||
                  current.loading ||
                  current.data.meta.page * current.data.meta.pageSize >=
                    current.data.meta.total
                }
                onClick={() => change(params[2], String(page + 1))}
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
