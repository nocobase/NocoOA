import { useUrlSearch } from '#hooks/use-url-search';
import { ApplicationToolbar } from '#components/application-toolbar';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { ChartNoAxesCombined, Download, RefreshCw } from 'lucide-react';
import { ApplicationTableSkeleton } from '#components/application-table-skeleton';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { ResponsiveTable } from '#components/responsive-table';
import { TruncatedText } from '#components/truncated-text';
import { Badge } from '#components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';

type Row = {
  id: string;
  stage: string;
  completedTaskCount: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
};
type Result = {
  data: Row[];
  meta: { page: number; pageSize: number; total: number; generatedAt: string };
};
const columns = [
  'stage',
  'completedTaskCount',
  'totalElapsedMs',
  'averageElapsedMs',
] as const;
export function LeaveApprovalEfficiencyReport() {
  const { session } = useAuthentication();
  const authorizationRevision = useAuthorizationRevision();
  return (
    <EfficiencyReport key={`${session?.user.id}:${authorizationRevision}`} />
  );
}

function EfficiencyReport() {
  const api = useApiClient();
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US';
  const id = useId();
  const search = useUrlSearch({
    param: 'efficiencyYear',
    resetParams: ['efficiencyPage'],
    delay: 300,
  });
  const year = search.search;
  const month = search.searchParams.get('efficiencyMonth') ?? '';
  const page = Math.max(
    1,
    Number(search.searchParams.get('efficiencyPage')) || 1,
  );
  function setMonth(value: string) {
    search.updateParams((p) => {
      if (value) p.set('efficiencyMonth', value);
      else p.delete('efficiencyMonth');
      p.delete('efficiencyPage');
    });
  }
  function setPage(value: number | ((old: number) => number)) {
    search.updateParams((p) =>
      p.set(
        'efficiencyPage',
        String(typeof value === 'function' ? value(page) : value),
      ),
    );
  }
  const [generation, reload] = useReducer((n: number) => n + 1, 0);
  const [state, setState] = useState<{
    data?: Result;
    error?: unknown;
    loading: boolean;
  }>({ loading: false });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const exportingRef = useRef(false);
  const revisionRef = useRef(0);
  const previousQueryRef = useRef('');
  const [exportSuccess, setExportSuccess] = useState(false);
  const valid =
    /^\d{4}$/.test(year) &&
    Number(year) >= 1900 &&
    Number(year) <= 9998 &&
    (!month ||
      (/^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12));
  const query: Record<string, string> = {
    year,
    locale,
    ...(month ? { month } : {}),
  };
  useEffect(() => {
    const abort = new AbortController();
    revisionRef.current += 1;
    const key = JSON.stringify([year, month, locale, page]);
    const sameQuery = previousQueryRef.current === key;
    previousQueryRef.current = key;
    void Promise.resolve().then(() => {
      if (!abort.signal.aborted) {
        setState((old) => ({
          loading: valid,
          data: valid && sameQuery ? old.data : undefined,
        }));
        setExportSuccess(false);
        setExportError(undefined);
      }
    });
    if (valid)
      api
        .request<Result>({
          path: 'reports/leave-approval-efficiency',
          query: {
            year,
            locale,
            ...(month ? { month } : {}),
            page: String(page),
            pageSize: '20',
          },
          signal: abort.signal,
        })
        .then(
          (data) => {
            if (!abort.signal.aborted) setState({ data, loading: false });
          },
          (error: unknown) => {
            if (!abort.signal.aborted) setState({ error, loading: false });
          },
        );
    return () => {
      abort.abort();
      revisionRef.current += 1;
    };
  }, [api, year, month, locale, page, valid, generation]);
  const status =
    state.error instanceof ApiClientError ? state.error.status : undefined;
  const denied = status === 401 || status === 403;
  function clear() {
    search.clear((p) => {
      p.delete('efficiencyMonth');
      p.delete('efficiencyPage');
    });
  }
  async function download() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(undefined);
    const current = revisionRef.current;
    try {
      const stream = await api.stream({
        path: 'reports/leave-approval-efficiency/export',
        query,
      });
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          chunks.push(item.value);
          size += item.value.byteLength;
        }
      } finally {
        reader.releaseLock();
      }
      if (current !== revisionRef.current) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'leave-approval-efficiency.xlsx';
      document.body.append(link);
      link.click();
      setExportSuccess(true);
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error: unknown) {
      if (current !== revisionRef.current) return;
      const code = error instanceof ApiClientError ? error.status : undefined;
      if (code === 401 || code === 403) setState({ error, loading: false });
      setExportError(code === 412 ? 'precondition' : 'exportFailed');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }
  const text = (key: string) => t(`reportsEfficiency.${key}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{text('title')}</CardTitle>
        <CardDescription>{text('description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <ApplicationToolbar
          actions={
            <>
              {year || month ? (
                <Button variant='outline' disabled={exporting} onClick={clear}>
                  {text('clear')}
                </Button>
              ) : null}
              {!denied && state.data ? (
                <Button
                  variant='outline'
                  disabled={!valid || state.loading || !state.data || exporting}
                  onClick={() => void download()}
                >
                  <Download data-icon='inline-start' />
                  {text(exporting ? 'exporting' : 'export')}
                </Button>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='outline'
                      size='icon'
                      aria-label={text('refresh')}
                      title={text('refresh')}
                      disabled={!valid || state.loading || exporting}
                      onClick={reload}
                    >
                      <RefreshCw
                        className={state.loading ? 'animate-spin' : undefined}
                      />
                    </Button>
                  }
                />
                <TooltipContent>{text('refresh')}</TooltipContent>
              </Tooltip>
            </>
          }
        >
          <div
            data-slot='application-filter'
            data-context='true'
            className='flex flex-col gap-2'
          >
            <Label htmlFor={`${id}-year`}>{text('year')}</Label>
            <Input
              id={`${id}-year`}
              inputMode='numeric'
              {...search.inputProps}
              disabled={exporting}
            />
          </div>
          <div
            data-slot='application-filter'
            data-context='true'
            className='flex flex-col gap-2'
          >
            <Label htmlFor={`${id}-month`}>{text('month')}</Label>
            <Input
              id={`${id}-month`}
              inputMode='numeric'
              value={month}
              disabled={exporting}
              onChange={(event) => {
                setMonth(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </ApplicationToolbar>
        {!valid ? (
          <p className='text-sm text-muted-foreground'>
            {text(year || month ? 'invalid' : 'selectYear')}
          </p>
        ) : null}
        {exportSuccess ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {text('exported')}
          </p>
        ) : null}
        {exportError && !denied ? (
          <Alert variant='destructive'>
            <AlertDescription>{text(exportError)}</AlertDescription>
          </Alert>
        ) : null}
        {state.loading && !state.data ? (
          <ApplicationTableSkeleton columns={4} />
        ) : null}
        {status === 401 ? <SessionExpiredAlert /> : null}
        {state.error && status !== 401 ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {text(
                status === 403
                  ? 'forbidden'
                  : status === 412
                    ? 'precondition'
                    : 'failed',
              )}
            </AlertDescription>
            {status !== 403 && status !== 412 ? (
              <AlertAction>
                <Button variant='outline' onClick={reload}>
                  {text('retry')}
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        ) : null}
        {state.data ? (
          state.data.data.length ? (
            <ResponsiveTable>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column}
                      className={column === 'stage' ? undefined : 'text-right'}
                    >
                      {text(`fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.data.data.map((row) => (
                  <TableRow key={row.id}>
                    {columns.map((column) => (
                      <TableCell
                        key={column}
                        className={
                          column === 'stage'
                            ? undefined
                            : 'text-right tabular-nums'
                        }
                      >
                        {column === 'stage' ? (
                          <TruncatedText
                            text={
                              ['manager', 'head', 'hr'].includes(row.stage)
                                ? text(`stages.${row.stage}`)
                                : row.stage
                            }
                          >
                            <Badge variant='outline'>
                              {['manager', 'head', 'hr'].includes(row.stage)
                                ? text(`stages.${row.stage}`)
                                : row.stage}
                            </Badge>
                          </TruncatedText>
                        ) : (
                          row[column].toLocaleString(locale)
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </ResponsiveTable>
          ) : (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ChartNoAxesCombined />
                </EmptyMedia>
                <EmptyTitle>{text(month ? 'noResults' : 'empty')}</EmptyTitle>
                <EmptyDescription>{text('emptyHint')}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant='outline' disabled={exporting} onClick={clear}>
                  {text('clear')}
                </Button>
              </EmptyContent>
            </Empty>
          )
        ) : null}
        {state.data ? (
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground'>
            <span>
              {t('reportsEfficiency.total', { count: state.data.meta.total })} ·{' '}
              {t('reportsEfficiency.generatedAt', {
                value: new Date(state.data.meta.generatedAt).toLocaleString(
                  locale,
                ),
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                disabled={
                  exporting || state.loading || state.data.meta.page <= 1
                }
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                {text('previous')}
              </Button>
              <Button
                variant='outline'
                disabled={
                  exporting ||
                  state.loading ||
                  state.data.meta.page * state.data.meta.pageSize >=
                    state.data.meta.total
                }
                onClick={() => setPage((value) => value + 1)}
              >
                {text('next')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
