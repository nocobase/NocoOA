import { MemoryRouter } from 'react-router';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import { ApiClientError } from '@nocobase/app-client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import ReportsPage from '../../client/pages/reports/index.js';

const { api } = vi.hoisted(() => ({
  api: { request: vi.fn(), stream: vi.fn() },
}));

const reportApi = {
  ...api,
  request: (args: { path: string }) =>
    args.path === 'reports/datasets'
      ? Promise.resolve({
          data: [
            'budget-balances',
            'contract-ledger',
            'headcount-balances',
            'leave-monthly',
            'leave-approval-efficiency',
            'expense-summary',
          ],
        })
      : api.request(args),
};

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => reportApi,
}));
vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({
    session: { user: { id: 'reports-test-reader' } },
    refresh: vi.fn(),
  }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authorization/client')
  >()),
  useAuthorizationRevision: () => 0,
}));
// The shared DatePicker's calendar behavior is tested in date-picker.test.tsx; verify this page's date-only transport here.
vi.mock('../../client/components/date-picker.js', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      value={
        value
          ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
          : ''
      }
      onChange={(e) =>
        onChange(
          e.target.value ? new Date(`${e.target.value}T12:00:00`) : undefined,
        )
      }
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
function show() {
  return render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </TestI18nProvider>,
  );
}

const meta = {
  page: 1,
  pageSize: 20,
  total: 1,
  generatedAt: '2026-10-11T03:00:00.000Z',
};

it('keeps typed report filters stable and cancels pending input when clearing', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    await screen.findByRole('tab', { name: 'Monthly leave requests' }),
  );
  const year = screen.getByLabelText('Year', { exact: true });
  await user.type(year, '2026');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/leave-monthly',
        query: expect.objectContaining({ year: '2026' }),
      }),
    ),
  );
  await user.clear(year);
  await user.type(year, '2027');
  expect(year).toHaveValue(2027);
  await user.click(
    screen.getByRole('button', { name: 'Clear filters', exact: true }),
  );
  await waitFor(() => expect(year).toHaveValue(null));
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(year).toHaveValue(null);
  expect(api.request).not.toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reports/leave-monthly',
      query: expect.objectContaining({ year: '2027' }),
    }),
  );
});

beforeEach(() => {
  api.request.mockImplementation(
    async ({ path }: { path: string; query: Record<string, string> }) =>
      path === 'departments/options'
        ? {
            data: [
              {
                id: 'dept-2',
                title: 'Finance',
                code: 'FIN',
                parentId: null,
                active: true,
              },
            ],
          }
        : path === 'positions/options'
          ? {
              data: [
                {
                  id: 'position-1',
                  title: 'Engineer',
                  code: 'ENG',
                  active: true,
                },
              ],
            }
          : {
              data: [
                path === 'reports/contract-ledger'
                  ? { id: 'c1', number: 'C-001', amountCents: 100 }
                  : {
                      id: path,
                      departmentId: 'dept-1',
                      departmentName: 'Accounting',
                      year: 2026,
                    },
              ],
              meta,
            },
  );
  api.stream.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('loads every independently authorized dataset and sends its filters', async () => {
  show();
  const user = userEvent.setup();
  await screen.findByText('Accounting');

  const department = screen.getByLabelText('Department');
  await user.type(department, 'Finance');
  await user.click(await screen.findByRole('option', { name: /Finance/ }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/budget-balances',
        query: expect.objectContaining({ departmentId: 'dept-2', page: '1' }),
      }),
    ),
  );
  await user.click(
    await screen.findByRole('tab', {
      name: 'Contract ledger',
    }),
  );
  await user.click(
    await screen.findByRole('tab', {
      name: 'Headcount balances',
    }),
  );
  await waitFor(() => expect(api.request.mock.calls.length).toBeGreaterThan(3));
  expect(api.request.mock.calls.map(([call]) => call.path)).toEqual(
    expect.arrayContaining([
      'reports/budget-balances',
      'reports/contract-ledger',
      'reports/headcount-balances',
    ]),
  );
});

it('shows a non-retryable source denial without exposing an exception', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'departments/options') return { data: [] };
    throw new ApiClientError('private database failure', {
      status: 403,
      method: 'GET',
      url: '/api/reports/budget-balances',
    });
  });
  show();
  expect(
    (
      await screen.findAllByText(
        'You do not have permission to read this report source.',
      )
    ).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByText('private database failure'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});

it('paginates with the current filters and reports an export failure', async () => {
  api.request.mockImplementation(
    async ({ path, query }: { path: string; query: Record<string, string> }) =>
      path === 'departments/options'
        ? { data: [] }
        : {
            data: [
              {
                id: `${path}-${query.page}`,
                departmentId: 'dept-1',
                departmentName: 'Accounting',
              },
            ],
            meta: {
              ...meta,
              page: Number(query.page),
              total: 21,
            },
          },
  );
  api.stream.mockRejectedValue(new Error('download unavailable'));
  show();
  await screen.findByText('Accounting');
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/budget-balances',
        query: expect.objectContaining({ page: '2' }),
      }),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(
    await screen.findByText(
      'Export failed. Check permissions or filters and try again.',
    ),
  ).toBeInTheDocument();
});

it('offers retry for a transient list failure and reloads the dataset', async () => {
  let failed = false;
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'departments/options') return { data: [] };
    if (!failed) {
      failed = true;
      throw new ApiClientError('private database failure', {
        status: 500,
        method: 'GET',
        url: '/api/reports/budget-balances',
      });
    }
    return { data: [], meta: { ...meta, total: 0 } };
  });
  show();
  expect(
    await screen.findByText('This report could not be loaded. Try again.'),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([call]) =>
        call.path.startsWith('reports/'),
      ),
    ).toHaveLength(2),
  );
  expect(await screen.findByText('No report data yet')).toBeInTheDocument();
  expect(
    screen.queryByText('private database failure'),
  ).not.toBeInTheDocument();
});

it('clears previous rows when refreshed source access is revoked', async () => {
  show();
  await screen.findByText('Accounting');
  api.request.mockRejectedValueOnce(
    new ApiClientError('revoked', {
      status: 403,
      method: 'GET',
      url: '/api/reports/budget-balances',
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(
    'You do not have permission to read this report source.',
  );
  expect(screen.queryByText('Accounting')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
});

it('filters the immutable contract expiry and headcount position without changing export scope', async () => {
  show();
  await userEvent.click(
    await screen.findByRole('tab', { name: 'Contract ledger' }),
  );
  await userEvent.setup().clear(screen.getByLabelText('Ends on or before'));
  fireEvent.change(screen.getByLabelText('Ends on or before'), {
    target: { value: '2026-12-31' },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/contract-ledger',
        query: expect.objectContaining({ endsBefore: '2026-12-31' }),
      }),
    ),
  );
  api.stream.mockRejectedValue(new Error('synthetic'));
  await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(api.stream).toHaveBeenCalledWith(
    expect.objectContaining({ query: { endsBefore: '2026-12-31' } }),
  );
  await userEvent.click(
    await screen.findByRole('tab', { name: 'Headcount balances' }),
  );
  await userEvent.type(screen.getByLabelText('Position'), 'Engineer');
  await userEvent.click(
    await screen.findByRole('option', { name: /Engineer/ }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/headcount-balances',
        query: expect.objectContaining({ positionId: 'position-1' }),
      }),
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(api.stream).toHaveBeenCalledWith(
    expect.objectContaining({ query: { positionId: 'position-1' } }),
  );
});

it.each(['en-US', 'zh-CN'])(
  'renders uninitialized capacity and blocked replacements in %s',
  async (locale) => {
    const localized = await createTestI18nRuntime({
      locale,
      application: {
        namespace: 'nb3-oa',
        resources: locale === 'zh-CN' ? zhCN : enUS,
      },
    });
    api.request.mockResolvedValue({
      data: [
        {
          id: 'a',
          initialized: false,
          available: 0,
          capacityState: 'uninitialized',
        },
        { id: 'b', initialized: true, available: 0, capacityState: 'blocked' },
      ],
      meta: { ...meta, total: 2 },
    });
    render(
      <TestI18nProvider runtime={localized}>
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </TestI18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole('tab', {
        name: locale === 'zh-CN' ? '编制余额' : 'Headcount balances',
      }),
    );
    await screen.findAllByText(
      locale === 'zh-CN' ? '替补阻断' : 'Blocked replacement',
    );
    expect(
      screen.getAllByText(locale === 'zh-CN' ? '未初始化' : 'Uninitialized'),
    ).toHaveLength(2);
  },
);

it.each(['en-US', 'zh-CN'])(
  'formats immutable dates, grouped basis points and status badges in %s',
  async (locale) => {
    const localized = await createTestI18nRuntime({
      locale,
      application: {
        namespace: 'nb3-oa',
        resources: locale === 'zh-CN' ? zhCN : enUS,
      },
    });
    api.request.mockResolvedValue({
      data: [
        {
          id: 'contract',
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
          asOf: '2026-10-11',
          expiryState: 'current',
          paymentState: 'overpaid',
          paidBasisPoints: 12500,
        },
      ],
      meta,
    });
    render(
      <TestI18nProvider runtime={localized}>
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </TestI18nProvider>,
    );
    await userEvent.click(
      await screen.findByRole('tab', {
        name: locale === 'zh-CN' ? '合同台账' : 'Contract ledger',
      }),
    );
    const state = await screen.findByText(
      locale === 'zh-CN' ? '超额付款' : 'Overpaid',
    );
    expect(state).toHaveAttribute('data-slot', 'badge');
    expect(
      screen.getByText(
        locale === 'zh-CN' ? '2026年12月31日' : 'December 31st, 2026',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.queryByText('2026-12-31')).not.toBeInTheDocument();
  },
);

it('searches labels without submitting opaque IDs, then clears the selected position filter', async () => {
  show();
  await userEvent.click(
    await screen.findByRole('tab', { name: 'Headcount balances' }),
  );
  const input = screen.getByLabelText('Position');
  await userEvent.type(input, 'Engineer');
  expect(
    api.request.mock.calls
      .filter(([call]) => call.path === 'reports/headcount-balances')
      .every(([call]) => !call.query.positionId),
  ).toBe(true);
  await userEvent.click(
    await screen.findByRole('option', { name: /Engineer/ }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/headcount-balances',
        query: expect.objectContaining({ positionId: 'position-1', page: '1' }),
      }),
    ),
  );
  await userEvent.click(
    document.querySelector('[data-slot="combobox-clear"]') as HTMLElement,
  );
  await waitFor(() => {
    const calls = api.request.mock.calls.filter(
      ([call]) => call.path === 'reports/headcount-balances',
    );
    expect(calls.at(-1)?.[0].query).not.toHaveProperty('positionId');
  });
});

it('fails closed for position metadata denial while leaving independent authorized report readable', async () => {
  const existing = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (call) => {
    if (call.path === 'positions/options')
      throw new ApiClientError('secret', {
        status: 403,
        method: 'GET',
        url: '/api/positions/options',
      });
    return existing(call);
  });
  show();
  await userEvent.click(
    await screen.findByRole('tab', { name: 'Headcount balances' }),
  );
  await screen.findByText('Position options could not be loaded.');
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Position')).not.toBeInTheDocument();
  expect(screen.queryByText('secret')).not.toBeInTheDocument();
  await screen.findByText('Accounting');
});

it('uses identical monthly leave filters for list and Excel, rejects invalid month and clears stale rows', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ path }: { path: string }) =>
    path === 'departments/options'
      ? { data: [] }
      : path === 'reports/leave-monthly'
        ? {
            data: [
              {
                id: '2026-1-annual',
                year: 2026,
                month: 1,
                leaveType: 'annual',
                approvedRequestCount: 2,
                approvedRequestedDays: 3,
              },
            ],
            meta,
          }
        : { data: [], meta },
  );
  show();
  await user.click(
    await screen.findByRole('tab', { name: 'Monthly leave requests' }),
  );
  expect(await screen.findByText('annual')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Year'), {
    target: { value: '2026' },
  });
  fireEvent.change(screen.getByLabelText('Start month (1–12, optional)'), {
    target: { value: '1' },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/leave-monthly',
        query: {
          page: '1',
          pageSize: '20',
          year: '2026',
          month: '1',
          sort: 'month',
          direction: 'desc',
          locale: 'en-US',
        },
      }),
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Export Excel' }));
  await waitFor(() =>
    expect(api.stream).toHaveBeenCalledWith({
      path: 'reports/leave-monthly.xlsx',
      query: {
        year: '2026',
        month: '1',
        sort: 'month',
        direction: 'desc',
        locale: 'en-US',
      },
    }),
  );
  const count = api.request.mock.calls.length;
  fireEvent.change(screen.getByLabelText('Start month (1–12, optional)'), {
    target: { value: '13' },
  });
  await screen.findByText(
    'Enter a year from 1900 to 9999 and a month from 1 to 12, or clear the filters.',
  );
  expect(api.request.mock.calls.length).toBe(count);
  expect(screen.queryByText('annual')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled();
});

it('monthly numeric sorting is sent to the owner and clear filters restores defaults', async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    await screen.findByRole('tab', { name: 'Monthly leave requests' }),
  );
  await screen.findByRole('button', { name: 'Approved requests' });
  await user.click(screen.getByRole('button', { name: 'Approved requests' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/leave-monthly',
        query: expect.objectContaining({
          sort: 'approvedRequestCount',
          direction: 'desc',
          locale: 'en-US',
        }),
      }),
    ),
  );
  fireEvent.change(screen.getByLabelText('Year'), {
    target: { value: '2026' },
  });
  await user.click(
    screen.getByRole('button', { name: 'Clear filters', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: 'reports/leave-monthly',
        query: expect.not.objectContaining({ year: '2026' }),
      }),
    ),
  );
  expect(screen.getByLabelText('Year')).toHaveValue(null);
});

it('monthly source limit gives a range correction instead of blind retry', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'reports/leave-monthly')
      throw new ApiClientError('private source details', {
        status: 412,
        method: 'GET',
        url: '/reports/leave-monthly',
      });
    return path === 'departments/options' ? { data: [] } : { data: [], meta };
  });
  show();
  await user.click(
    await screen.findByRole('tab', { name: 'Monthly leave requests' }),
  );
  expect(
    await screen.findByText(
      'This range exceeds 10,000 authorized approved requests. Select a month or another year, then try again.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('private source details')).not.toBeInTheDocument();
});

it('monthly known source denial hides Excel and gives the next step', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'reports/leave-monthly')
      throw new ApiClientError('private denial', {
        status: 403,
        method: 'GET',
        url: '/reports/leave-monthly',
      });
    return path === 'departments/options' ? { data: [] } : { data: [], meta };
  });
  show();
  await user.click(
    await screen.findByRole('tab', { name: 'Monthly leave requests' }),
  );
  expect(
    await screen.findByText(
      'You do not have access to the current leave request source. Contact an administrator to check source permissions.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Export Excel' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});

it('composes both new source reports without mixing their filters or private fields', async () => {
  const user = userEvent.setup();
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path === 'departments/options') return { data: [] };
    if (path === 'reports/expense-summary')
      return {
        data: [
          {
            id: 'expense-group',
            year: 2026,
            month: 10,
            category: 'travel',
            settledRequestCount: 2,
            settledExpenseCents: 1200,
            bankAccount: 'must-never-render',
          },
        ],
        meta: { ...meta, filters: { year: 2026 } },
      };
    if (path === 'reports/leave-approval-efficiency')
      return {
        data: [
          {
            id: 'manager',
            stage: 'manager',
            completedTaskCount: 2,
            totalElapsedMs: 4000,
            averageElapsedMs: 2000,
            reason: 'must-never-render',
          },
        ],
        meta,
      };
    return { data: [], meta };
  });
  render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter
        initialEntries={['/reports?expenseYear=2026&expenseMonth=10']}
      >
        <ReportsPage />
      </MemoryRouter>
    </TestI18nProvider>,
  );
  await user.click(
    await screen.findByRole('tab', { name: enUS.reportsExpense.title }),
  );
  expect(await screen.findByText('travel')).toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reports/expense-summary',
      query: expect.objectContaining({ year: '2026', month: '10' }),
    }),
  );
  expect(screen.queryByText('must-never-render')).not.toBeInTheDocument();
  await user.click(
    await screen.findByRole('tab', { name: enUS.reportsEfficiency.title }),
  );
  expect(
    await screen.findByText(enUS.reportsEfficiency.selectYear),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(enUS.reportsEfficiency.year), {
    target: { value: '2026' },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reports/leave-approval-efficiency',
        query: expect.objectContaining({ year: '2026' }),
      }),
    ),
  );
  expect(screen.queryByText('must-never-render')).not.toBeInTheDocument();
});
