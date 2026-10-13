import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import expenseEn from '../../client/locales/modules/reports-expense.en-US.js';
import expenseZh from '../../client/locales/modules/reports-expense.zh-CN.js';
import { ExpenseSummaryReport } from '../../client/pages/reports/expense-summary.js';
const { api, toaster, identity } = vi.hoisted(() => ({
  api: { request: vi.fn(), stream: vi.fn() },
  toaster: { show: vi.fn() },
  identity: { actor: 'reader', revision: 1 },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({
    refresh: vi.fn(),
    session: { user: { id: identity.actor } },
  }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => identity.revision,
}));
const meta = {
  page: 1,
  pageSize: 20,
  total: 1,
  generatedAt: '2026-10-12T03:00:00.000Z',
  filters: { year: 2026 },
};
const row = {
  id: 'r',
  year: 2026,
  month: 1,
  category: 'other',
  settledRequestCount: 2,
  settledExpenseCents: 1234,
  privateBank: 'private bank',
};
function error(status: number) {
  return new ApiClientError('private error', {
    status,
    method: 'GET',
    url: '/api/reports/expense-summary',
  });
}
async function show(locale = 'en-US', url = '/reports') {
  const runtime = await createTestI18nRuntime({
    locale,
    application: {
      namespace: 'nb3-oa',
      resources:
        locale === 'zh-CN'
          ? { ...zhCN, ...expenseZh }
          : { ...enUS, ...expenseEn },
    },
  });
  const view = () => (
    <MemoryRouter initialEntries={[url]}>
      <TestI18nProvider runtime={runtime}>
        <ExpenseSummaryReport />
      </TestI18nProvider>
    </MemoryRouter>
  );
  const rendered = render(view());
  return { ...rendered, redraw: () => rendered.rerender(view()) };
}
beforeEach(() => {
  identity.actor = 'reader';
  identity.revision = 1;
  api.request.mockResolvedValue({ data: [row], meta });
  api.stream.mockRejectedValue(new Error('private stream'));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each(['en-US', 'zh-CN'])(
  'renders fixed safe gross columns in %s',
  async (locale) => {
    await show(locale);
    await screen.findByText('other');
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    expect(screen.getByText('12.34')).toBeInTheDocument();
    expect(screen.queryByText('private bank')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        locale === 'zh-CN'
          ? '已结算费用毛额（元，非现金实付）'
          : 'Settled gross expense (CNY, not cash)',
      ),
    ).toBeInTheDocument();
  },
);
it('pins effective year in export, preserves year/month across pagination and clears filters', async () => {
  api.request.mockImplementation(
    async ({ query }: { query: Record<string, string> }) => ({
      data: [row],
      meta: { ...meta, page: Number(query.page), total: 21 },
    }),
  );
  await show('en-US', '/reports?expenseYear=2026&expenseMonth=1&other=keep');
  await screen.findByText('other');
  await userEvent.click(
    screen.getByRole('button', { name: 'Next', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          year: '2026',
          month: '1',
          locale: 'en-US',
          page: '2',
          pageSize: '20',
        },
      }),
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Export Excel', exact: true }),
  );
  await screen.findByText(
    'Export failed. Check permissions or filters and try again.',
  );
  expect(api.stream).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reports/expense-summary/export',
      query: { year: '2026', month: '1', locale: 'en-US' },
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Clear filters', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: { locale: 'en-US', page: '1', pageSize: '20' },
      }),
    ),
  );
  expect(screen.getByLabelText('Year')).toHaveValue('');
});
it('validates without sending invalid range, keeps input reliable and removes old rows', async () => {
  await show();
  await screen.findByText('other');
  const calls = api.request.mock.calls.length;
  const input = screen.getByLabelText('Year');
  await userEvent.type(input, '20');
  expect(input).toHaveValue('20');
  expect(api.request.mock.calls.length).toBe(calls);
  expect(screen.queryByText('other')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: '2026' } });
  await screen.findByText('other');
  fireEvent.change(screen.getByLabelText('Expense month (1–12, optional)'), {
    target: { value: '13' },
  });
  await screen.findByText(
    'Enter a year from 1900 to 9999 and a month from 1 to 12, or clear the filters.',
  );
  expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
});
it.each([401, 403, 412, 500])(
  'handles %i refresh safely and clears old authorized rows',
  async (status) => {
    await show();
    await screen.findByText('other');
    api.request.mockRejectedValueOnce(error(status));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.queryByText('other')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('private error')).not.toBeInTheDocument();
    if (status === 401)
      await screen.findByRole('button', { name: 'Sign in again' });
    if (status === 403)
      await screen.findByText(expenseEn.reportsExpense.forbidden);
    if (status === 412)
      await screen.findByText(expenseEn.reportsExpense.precondition);
    if ([401, 403].includes(status))
      expect(
        screen.queryByRole('button', { name: 'Export Excel' }),
      ).not.toBeInTheDocument();
    if (status === 500) {
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByText('other');
    } else
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
  },
);
it('renders initial skeleton and distinct empty/filter states with recovery', async () => {
  let done!: (value: unknown) => void;
  api.request.mockReturnValueOnce(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  await show();
  await screen.findByRole('table', { name: 'Loading' });
  done({ data: [], meta: { ...meta, total: 0 } });
  await screen.findByText(expenseEn.reportsExpense.empty);
  api.request.mockResolvedValue({ data: [], meta: { ...meta, total: 0 } });
  fireEvent.change(screen.getByLabelText('Year'), {
    target: { value: '2026' },
  });
  await screen.findByText('No matching records.');
  expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(
    2,
  );
});
it('locks export duplicate clicks and filters, then clears rows on export permission revocation', async () => {
  let reject!: (value: unknown) => void;
  api.stream.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await show();
  await screen.findByText('other');
  await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  expect(screen.getByLabelText('Year')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  reject(error(403));
  await screen.findByText(expenseEn.reportsExpense.forbidden);
  expect(screen.queryByText('other')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Export Excel' }),
  ).not.toBeInTheDocument();
  expect(api.stream).toHaveBeenCalledTimes(1);
});

it('keeps authorized previous rows with a notice while new filters load, and clears them when loading fails', async () => {
  await show();
  await screen.findByText('other');
  let fail!: (error: unknown) => void;
  api.request.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  fireEvent.change(screen.getByLabelText('Year'), {
    target: { value: '2025' },
  });
  await screen.findByText(expenseEn.reportsExpense.reloading);
  expect(screen.getByText('other')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
  fail(error(403));
  await screen.findByText(expenseEn.reportsExpense.forbidden);
  expect(screen.queryByText('other')).not.toBeInTheDocument();
});

it('keeps character typing, middle edits and IME drafts stable until committed', async () => {
  await show('en-US', '/reports?expenseYear=2026&expenseMonth=1');
  await screen.findByText('other');
  const user = userEvent.setup(),
    input = screen.getByLabelText('Year');
  await user.click(input);
  await user.keyboard('{Control>}a{/Control}');
  await user.type(input, '2026', { skipClick: true });
  expect(input).toHaveValue('2026');
  (input as HTMLInputElement).setSelectionRange(2, 3);
  await user.keyboard('3');
  expect(input).toHaveValue('2036');
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ year: '2036', month: '1' }),
      }),
    ),
  );
  const count = api.request.mock.calls.length;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'nian' }, isComposing: true });
  expect(input).toHaveValue('nian');
  expect(api.request.mock.calls.length).toBe(count);
  fireEvent.change(input, { target: { value: '2026' } });
  fireEvent.compositionEnd(input, { data: '2026' });
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ year: '2026' }),
      }),
    ),
  );
});

it('commits nearly simultaneous year and month drafts without losing either URL filter', async () => {
  await show();
  await screen.findByText('other');
  fireEvent.change(screen.getByLabelText('Year'), {
    target: { value: '2025' },
  });
  fireEvent.change(screen.getByLabelText('Expense month (1–12, optional)'), {
    target: { value: '2' },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          year: '2025',
          month: '2',
          locale: 'en-US',
          page: '1',
          pageSize: '20',
        },
      }),
    ),
  );
});

it.each(['revision', 'actor'] as const)(
  'drops old rows and delayed download immediately on %s change',
  async (kind) => {
    const view = await show();
    await screen.findByText('other');
    let complete!: (stream: ReadableStream<Uint8Array>) => void;
    api.stream.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    const downloadSignal = api.stream.mock.calls.at(-1)?.[0]
      .signal as AbortSignal;
    api.request.mockReturnValueOnce(new Promise(() => {}));
    if (kind === 'revision') identity.revision += 1;
    else identity.actor = 'other-reader';
    view.redraw();
    expect(screen.queryByText('other')).not.toBeInTheDocument();
    expect(downloadSignal.aborted).toBe(true);
    await screen.findByRole('table', { name: 'Loading' });
    complete(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.close();
        },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText('other')).not.toBeInTheDocument();
    click.mockRestore();
  },
);

it.each(['en-US', 'zh-CN'])(
  'offers accurate recovery for a scope-shrunk empty page in %s',
  async (locale) => {
    api.request.mockImplementation(
      async ({ query }: { query: Record<string, string> }) => ({
        data: query.page === '2' ? [] : [row],
        meta: { ...meta, page: Number(query.page), total: 1 },
      }),
    );
    await show(locale, '/reports?expenseYear=2026&expensePage=2');
    await screen.findByText(
      locale === 'en-US'
        ? expenseEn.reportsExpense.pageEmpty
        : expenseZh.reportsExpense.pageEmpty,
    );
    expect(screen.queryByText('No matching records.')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: locale === 'en-US' ? 'Go to first page' : '返回第一页',
        exact: true,
      }),
    );
    await screen.findByText('other');
  },
);

it('offers safe recovery for a rejected network request', async () => {
  api.request.mockRejectedValueOnce(
    new TypeError('private network host unreachable'),
  );
  await show();
  await screen.findByText('This report could not be loaded. Try again.');
  expect(
    screen.queryByText('private network host unreachable'),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry', exact: true }),
  );
  await screen.findByText('other');
});

it('does not download a partial failed stream and releases its reader lock', async () => {
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(new Uint8Array([1, 2]));
      else controller.error(new Error('private interrupted export'));
    },
  });
  api.stream.mockResolvedValueOnce(stream);
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  await show();
  await screen.findByText('other');
  await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  await screen.findByText(
    'Export failed. Check permissions or filters and try again.',
  );
  expect(stream.locked).toBe(false);
  expect(click).not.toHaveBeenCalled();
  expect(
    screen.queryByText('private interrupted export'),
  ).not.toBeInTheDocument();
  click.mockRestore();
});
