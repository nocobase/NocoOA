import { ApiClientError, useNavigationGuard } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, it, expect, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import purchases from '../../client/locales/modules/purchases.en-US.js';
import Action from '../../client/pages/purchases/action-dialog.js';
import Form from '../../client/pages/purchases/form-page.js';
import OrderLedger from '../../client/pages/purchases/order-ledger.js';
import OrderDetail from '../../client/pages/purchases/order-detail.js';
import OrderAction from '../../client/pages/purchases/order-action-dialog.js';
import Pricing from '../../client/pages/purchases/pricing-page.js';
import { ApprovalRecipientPicker } from '../../client/components/approval-recipient-picker.js';
import {
  parseAmountCents,
  quantityText,
  exceedsAmountThreshold,
} from '../../client/pages/purchases/money.js';
const { api, reload } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: vi.fn(),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: true, isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({
    session: { user: { id: 'alice', name: 'Alice' } },
  }),
}));
vi.mock('../../client/pages/purchases/facts.js', () => ({
  PurchaseFacts: () => <p>Frozen purchase facts</p>,
}));
vi.mock('../../client/components/date-picker.js', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id: string;
    value: Date | undefined;
    onChange: (date: Date | undefined) => void;
    disabled: boolean;
  }) => (
    <input
      id={id}
      defaultValue={value?.toISOString().slice(0, 10) ?? ''}
      disabled={disabled}
      onChange={(event) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))
          onChange(new Date(`${event.target.value}T12:00:00Z`));
      }}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...purchases } },
});
const options = {
  timeZone: 'Asia/Shanghai',
  department: { id: 'dept', title: 'Operations' },
  subjects: [{ code: 'office', label: { 'en-US': 'Office' }, active: true }],
  vendors: [
    {
      id: 'vendor',
      name: 'Supplier',
      category: 'Office',
      active: true,
      status: 'manual',
    },
  ],
};
const record = {
  id: 'p1',
  applicantId: 'alice',
  number: 'PUR-1',
  status: 'purchasing',
  lifecycleVersion: 4,
  estimatedCents: 10000,
  actualCents: null,
  selectedVendorId: null,
  quotes: [],
  ruleSnapshot: { 'purchase.quotes': 50000 },
};
function data(action = 'forceComplete') {
  return {
    record,
    quoteBasisHash: 'requirements',
    users: [{ id: 'alice', name: 'Alice' }],
    runs: [],
    taskActions:
      action === 'complete'
        ? [
            {
              task: { id: 'task1', runId: 'run1' },
              onBehalfOf: null,
              actions: [
                {
                  name: action,
                  options: {},
                  contentHash: true,
                  primary: true,
                  tone: 'primary',
                },
              ],
            },
          ]
        : [],
    runActions: [
      {
        run: { id: 'run1', contentHash: 'frozen-price-hash' },
        onBehalfOf: null,
        actions:
          action === 'complete'
            ? []
            : [
                {
                  name: action,
                  options: {},
                  reasonRequired: action === 'forceComplete',
                  contentHash: true,
                  primary: true,
                  tone: 'primary',
                },
              ],
      },
    ],
    view: { available: [] },
  };
}
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, unknown>;
};
function serve(write?: (request: Request) => unknown, response = data()) {
  api.request.mockImplementation(async (request: Request) => {
    if (request.path === 'purchaseRequests/options') return { data: options };
    if (request.path.endsWith('/candidates'))
      return {
        data: {
          people: [{ id: 'recipient', name: 'Recipient' }],
          nextOffset: null,
        },
      };
    if (request.method === 'POST')
      return write?.(request) ?? { data: { record } };
    return { data: structuredClone(response) };
  });
}
function open(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/mine',
        element: <Outlet context={{ reload, update: vi.fn() }} />,
        children: [
          { path: 'newPurchase', element: <Form /> },
          { path: 'editPurchase/:requestId', element: <Form /> },
          {
            path: 'purchase/:requestId',
            element: <Outlet context={{ reload, update: vi.fn() }} />,
            children: [
              { path: 'action/:actionName/:targetId', element: <Pricing /> },
              { path: 'operation/:actionName/:targetId', element: <Action /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
beforeEach(() => {
  api.request.mockReset();
  reload.mockReset();
});
it('uses exact decimal amounts and quantities, including sub-cent frozen threshold comparisons', () => {
  expect(parseAmountCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  expect(parseAmountCents('90071992547409.92')).toBeNull();
  expect(quantityText('01.500')).toBe('1.5');
  expect(quantityText('0.00')).toBeUndefined();
  expect(exceedsAmountThreshold(100, 1)).toBe(false);
  expect(exceedsAmountThreshold(100, 0.999)).toBe(true);
});
it('sends the run id to the finite manual-copy recipient endpoint without substituting a task id', async () => {
  serve();
  render(
    <TestI18nProvider runtime={runtime}>
      <ApprovalRecipientPicker
        id='recipient'
        requestPath='purchaseRequests'
        recordId='p1'
        target={{ runId: 'run1' }}
        action='cc'
        value=''
        onChange={vi.fn()}
      />
    </TestI18nProvider>,
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'purchaseRequests/p1/candidates',
        query: expect.objectContaining({ runId: 'run1', action: 'cc' }),
      }),
    ),
  );
  expect(
    api.request.mock.calls.find(([request]) =>
      request.path.endsWith('/candidates'),
    )![0].query,
  ).not.toHaveProperty('taskId');
});
it('force closes explicitly with a reason and no fabricated procurement result or order', async () => {
  serve();
  const router = open('/mine/purchase/p1/action/forceComplete/run1'),
    user = userEvent.setup();
  expect(screen.queryByLabelText(/Actual price/)).not.toBeInTheDocument();
  await user.click(await screen.findByLabelText('Action mode'));
  await user.click(
    await screen.findByRole('option', { name: 'Force close without an order' }),
  );
  await user.type(screen.getByLabelText(/Reason/), 'Supplier cannot deliver');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/mine/purchase/p1'),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'POST',
      path: 'purchaseRequests/p1/action',
      json: expect.objectContaining({
        action: 'forceComplete',
        input: {},
        comment: 'Supplier cannot deliver',
        contentHash: 'frozen-price-hash',
        target: { runId: 'run1' },
      }),
    }),
  );
});
it('locks an uncertain pricing action and retries the identical payload and command id', async () => {
  let calls = 0;
  serve(() => {
    if (++calls === 1) throw new Error('Network response lost');
    return { data: { record } };
  });
  const router = open('/mine/purchase/p1/action/forceComplete/run1'),
    user = userEvent.setup();
  expect(screen.queryByLabelText(/Actual price/)).not.toBeInTheDocument();
  await user.click(await screen.findByLabelText('Action mode'));
  await user.click(
    await screen.findByRole('option', { name: 'Force close without an order' }),
  );
  await user.type(screen.getByLabelText(/Reason/), 'No available supplier');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await screen.findByText(purchases.purchases.unknownPricing);
  expect(screen.getByLabelText(/Reason/)).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/mine/purchase/p1'),
  );
  const writes = api.request.mock.calls.filter(
    ([request]) => request.method === 'POST',
  );
  expect(writes).toHaveLength(2);
  expect(writes[0][0].json).toEqual(writes[1][0].json);
});
it('does not create a second draft after an uncertain save and preserves a fractional quantity', async () => {
  serve(() => {
    throw new Error('Network response lost');
  });
  open('/mine/newPurchase');
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  await user.type(screen.getByLabelText(/Purpose/), 'Warehouse supplies');
  await user.type(
    screen.getByLabelText(/Expected delivery date/),
    '2026-11-12',
  );
  await user.click(screen.getByLabelText(/Budget subject/));
  await user.click(
    await screen.findByRole('option', { name: 'Office', exact: true }),
  );
  await user.type(screen.getByLabelText(/Estimated amount/), '12.34');
  await user.type(screen.getByLabelText(/Item name/), 'Cable');
  await user.type(screen.getByLabelText(/Unit/), 'kg');
  const quantity = screen.getByLabelText(/Quantity/);
  await user.clear(quantity);
  await user.type(quantity, '01.500');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(purchases.purchases.unknownCreate);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(
    api.request.mock.calls.filter(([request]) => request.method === 'POST'),
  ).toHaveLength(1);
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        items: [expect.objectContaining({ quantity: '1.5' })],
        estimatedCents: 1234,
      }),
    }),
  );
});

const order = {
  id: 'order1',
  purchaseId: 'p1',
  number: 'PO-1',
  applicantId: 'alice',
  applicant: { id: 'alice', name: 'Alice' },
  departmentId: 'dept',
  items: [
    {
      id: 'item1',
      name: 'Cable',
      specification: 'Ethernet',
      quantity: '1.5',
      unit: 'kg',
    },
  ],
  actualCents: 1234,
  vendor: { id: 'vendor', code: 'V-1', name: 'Supplier', category: 'Office' },
  account: { departmentId: 'dept', year: 2026, subject: 'office' },
  status: 'awaitingReceipt',
  version: 3,
  createdAt: '2026-10-10T00:00:00Z',
  acceptedBy: null,
  acceptedAt: null,
  receiptDate: null,
  receiptReason: null,
};
function openOrders(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/purchaseOrders',
        element: <OrderLedger />,
        children: [
          {
            path: 'order/:orderId',
            element: <OrderDetail />,
            children: [{ path: ':orderAction', element: <OrderAction /> }],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
function serveOrders(
  actions = { accept: false, cancel: false },
  write?: (request: Request) => unknown,
) {
  api.request.mockImplementation(async (request: Request) => {
    if (request.method === 'POST') return write?.(request) ?? { data: order };
    if (request.path.startsWith('purchaseOrders?'))
      return {
        data: [order],
        meta: { total: 42, page: 2, pageSize: 10 },
        timeZone: 'Asia/Shanghai',
      };
    return {
      data: {
        record: order,
        payments: { pendingCents: 0, paidCents: 0 },
        actions,
        timeZone: 'Asia/Shanghai',
      },
    };
  });
}
it('keeps ledger ordering and pagination on the server and opens an order over the current ledger query', async () => {
  serveOrders();
  const router = openOrders(
    '/purchaseOrders?page=2&pageSize=10&sort=actualCents&direction=asc',
  );
  await screen.findByText('PO-1');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'purchaseOrders?page=2&pageSize=10&sort=actualCents&direction=asc',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Actions for "PO-1"' }),
  );
  await userEvent.click(await screen.findByRole('menuitem', { name: 'View' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/purchaseOrders/order/order1'),
  );
  expect(router.state.location.search).toBe(
    '?page=2&pageSize=10&sort=actualCents&direction=asc',
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm receipt' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Cancel order' }),
  ).not.toBeInTheDocument();
});
it('freezes an uncertain receipt and retries the same receipt facts, version and request key', async () => {
  let writes = 0;
  serveOrders({ accept: true, cancel: false }, () => {
    if (++writes === 1) throw new Error('Response lost');
    return { data: { ...order, status: 'accepted' } };
  });
  const router = openOrders('/purchaseOrders/order/order1/accept'),
    user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Receipt date/), '2026-10-11');
  await user.type(screen.getByLabelText(/Reason/), 'Items received');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await screen.findByText(purchases.purchases.unknownOrderAction);
  expect(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
  expect(screen.getByLabelText(/Reason/)).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/purchaseOrders/order/order1'),
  );
  const requests = api.request.mock.calls.filter(
    ([request]) => request.method === 'POST',
  );
  expect(requests).toHaveLength(2);
  expect(requests[0][0].json).toEqual(requests[1][0].json);
  expect(requests[0][0].json).toMatchObject({
    version: 3,
    receiptDate: '2026-10-11',
    reason: 'Items received',
  });
});

it('sends an exact completed price through the current handling task and frozen hash', async () => {
  serve(undefined, data('complete'));
  const router = open('/mine/purchase/p1/action/complete/task1'),
    user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByLabelText(/Actual price/)).toBeEnabled(),
  );
  await user.type(screen.getByLabelText(/Actual price/), '0.29');
  await user.click(screen.getByLabelText('Vendor *'));
  await user.click(
    await screen.findByRole('option', { name: 'Supplier · Office' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/mine/purchase/p1'),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'POST',
      json: expect.objectContaining({
        target: { taskId: 'task1' },
        contentHash: 'frozen-price-hash',
        input: { actualCents: 29, selectedVendorId: 'vendor', quotes: [] },
      }),
    }),
  );
});
it('blocks pricing above the frozen quote threshold without three different vendor evidence groups', async () => {
  serve(undefined, data('complete'));
  open('/mine/purchase/p1/action/complete/task1');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Actual price/), '50000.01');
  await user.click(screen.getByLabelText('Vendor *'));
  await user.click(
    await screen.findByRole('option', { name: 'Supplier · Office' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await screen.findByText(purchases.purchases.threeQuotesRequired);
  expect(
    api.request.mock.calls.filter(([request]) => request.method === 'POST'),
  ).toHaveLength(0);
  expect(document.getElementById('purchase-quotes-error')).toHaveFocus();
});

it('preserves pricing inputs after a version conflict and refreshes the offered content hash', async () => {
  let latest = false,
    writes = 0;
  serve((_request) => {
    if (++writes === 1) {
      latest = true;
      throw new ApiClientError('Changed', {
        status: 409,
        method: 'POST',
        url: '/api/purchaseRequests/p1/action',
      } as ConstructorParameters<typeof ApiClientError>[1]);
    }
    return { data: { record } };
  }, data('complete'));
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) => {
    if (latest && request.path === 'purchaseRequests/p1' && !request.method) {
      const next = data('complete');
      next.record = { ...next.record, lifecycleVersion: 5 };
      next.runActions[0].run.contentHash = 'new-reviewed-hash';
      return { data: next };
    }
    return original(request);
  });
  const router = open('/mine/purchase/p1/action/complete/task1'),
    user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByLabelText(/Actual price/)).toBeEnabled(),
  );
  await user.type(screen.getByLabelText(/Actual price/), '0.29');
  await user.click(screen.getByLabelText('Vendor *'));
  await user.click(
    await screen.findByRole('option', { name: 'Supplier · Office' }),
  );
  await user.type(screen.getByLabelText(/Reason/), 'Keep this price note');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.path === 'purchaseRequests/p1',
      ),
    ).toHaveLength(2),
  );
  expect(screen.getByLabelText(/Actual price/)).toHaveValue('0.29');
  expect(screen.getByLabelText(/Reason/)).toHaveValue('Keep this price note');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Confirm', exact: true }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/mine/purchase/p1'),
  );
  const requests = api.request.mock.calls.filter(
    ([request]) => request.method === 'POST',
  );
  expect(requests[1][0].json).toMatchObject({
    contentHash: 'new-reviewed-hash',
    comment: 'Keep this price note',
    input: { actualCents: 29, selectedVendorId: 'vendor', quotes: [] },
  });
  expect(requests[0][0].json.requestId).not.toBe(requests[1][0].json.requestId);
});
it('freezes pricing while refreshed options fail and keeps the proposal', async () => {
  let failOptions = false;
  serve(undefined, data('complete'));
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) => {
    if (failOptions && request.path === 'purchaseRequests/options')
      throw new Error('Options unavailable');
    return original(request);
  });
  open('/mine/purchase/p1/action/complete/task1');
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByLabelText(/Actual price/)).toBeEnabled(),
  );
  await user.type(screen.getByLabelText(/Actual price/), '0.29');
  failOptions = true;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(enUS.approvals.error.failed);
  expect(screen.getByLabelText(/Actual price/)).toHaveValue('0.29');
  expect(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  ).toBeDisabled();
});
it('preserves receipt date and notes after loading a new order version', async () => {
  let latest = false,
    writes = 0;
  serveOrders({ accept: true, cancel: false }, () => {
    if (++writes === 1) {
      latest = true;
      throw new ApiClientError('Changed', {
        status: 409,
        method: 'POST',
        url: '/api/purchaseOrders/order1/accept',
      } as ConstructorParameters<typeof ApiClientError>[1]);
    }
    return { data: { ...order, status: 'accepted' } };
  });
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) => {
    if (latest && request.path === 'purchaseOrders/order1' && !request.method)
      return {
        data: {
          record: { ...order, version: 4 },
          payments: { pendingCents: 0, paidCents: 0 },
          actions: { accept: true, cancel: false },
          timeZone: 'Asia/Shanghai',
        },
      };
    return original(request);
  });
  const router = openOrders('/purchaseOrders/order/order1/accept'),
    user = userEvent.setup();
  await user.type(await screen.findByLabelText(/Receipt date/), '2026-10-11');
  await user.type(screen.getByLabelText(/Reason/), 'Keep these receipt notes');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  const latestButton = await screen.findByRole('button', {
    name: 'Load latest',
    exact: true,
  });
  const readsBeforeReload = api.request.mock.calls.filter(
    ([request]) => request.path === 'purchaseOrders/order1',
  ).length;
  await user.click(latestButton);
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(
        ([request]) => request.path === 'purchaseOrders/order1',
      ),
    ).toHaveLength(readsBeforeReload + 1),
  );
  expect(screen.getByLabelText(/Receipt date/)).toHaveValue('2026-10-11');
  expect(screen.getByLabelText(/Reason/)).toHaveValue(
    'Keep these receipt notes',
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  if (screen.queryByRole('alertdialog'))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Confirm',
        exact: true,
      }),
    );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/purchaseOrders/order/order1'),
  );
  const requests = api.request.mock.calls.filter(
    ([request]) => request.method === 'POST',
  );
  expect(requests[1][0].json).toMatchObject({
    version: 4,
    receiptDate: '2026-10-11',
    reason: 'Keep these receipt notes',
  });
});

it('locks an uncertain generic action and replays its exact command', async () => {
  let writes = 0;
  serve(() => {
    if (++writes === 1) throw new Error('Response lost');
    return { data: { record } };
  }, data('cc'));
  const user = userEvent.setup();
  open('/mine/purchase/p1/operation/cc/run1');
  await user.type(
    await screen.findByLabelText(/Reason/),
    'Same immutable note',
  );
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: 'Recipient' }));
  await user.click(screen.getByRole('button', { name: 'Copy', exact: true }));
  await screen.findByText(purchases.purchases.unknownPricing);
  expect(screen.getByLabelText(/Reason/)).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry', exact: true }));
  await waitFor(() => expect(writes).toBe(2));
  const commands = api.request.mock.calls.filter(([r]) => r.method === 'POST');
  expect(commands[0][0].json).toEqual(commands[1][0].json);
});
it('keeps local edit inputs when uncertain verification finds another version', async () => {
  const detail = {
    ...data(),
    record: {
      ...record,
      items: [
        {
          id: 'line',
          name: 'Cable',
          specification: '',
          quantity: '1',
          unit: 'kg',
        },
      ],
      subject: 'office',
      purpose: 'Original purpose',
      expectedDate: '2026-11-12',
      suggestedVendorId: null,
    },
    view: { available: [{ name: 'edit', allowed: true }] },
  };
  let changed = false;
  serve(() => {
    changed = true;
    throw new Error('Unknown');
  }, detail);
  const original = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (r: Request) =>
    r.path === 'purchaseRequests/p1' && changed && !r.method
      ? {
          data: {
            ...detail,
            record: {
              ...detail.record,
              lifecycleVersion: 5,
              purpose: 'Someone else edited',
            },
          },
        }
      : original(r),
  );
  const user = userEvent.setup();
  open('/mine/editPurchase/p1');
  await waitFor(() => expect(screen.getByLabelText(/Purpose/)).toBeEnabled());
  await user.clear(screen.getByLabelText(/Purpose/));
  await user.type(screen.getByLabelText(/Purpose/), 'Retain my local purpose');
  await user.click(
    screen.getByRole('button', { name: 'Save draft', exact: true }),
  );
  await screen.findByText(purchases.purchases.unknownEdit);
  await user.click(screen.getByRole('button', { name: 'Load latest request' }));
  await screen.findByText(purchases.purchases.localInputsRetained);
  expect(screen.getByLabelText(/Purpose/)).toHaveValue(
    'Retain my local purpose',
  );
  expect(
    screen.getByRole('button', { name: 'Save draft', exact: true }),
  ).toBeEnabled();
});

it('requires an object-named destructive confirmation before cancelling an order', async () => {
  serveOrders({ accept: false, cancel: true });
  const user = userEvent.setup();
  openOrders('/purchaseOrders/order/order1/cancel');
  await user.type(await screen.findByLabelText(/Reason/), 'Supplier cancelled');
  await user.click(
    screen.getByRole('button', { name: 'Confirm', exact: true }),
  );
  const confirmation = await screen.findByRole('alertdialog');
  expect(
    within(confirmation).getByText('Cancel order PO-1?'),
  ).toBeInTheDocument();
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(0);
  await user.click(
    within(confirmation).getByRole('button', { name: 'Confirm', exact: true }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.method === 'POST'),
    ).toHaveLength(1),
  );
});
it('uses accessible discard confirmation and blocks navigation while an action is uncertain', async () => {
  serve();
  const user = userEvent.setup();
  open('/mine/newPurchase');
  await user.type(await screen.findByLabelText(/Purpose/), 'Unsaved proposal');
  const guard = () => vi.mocked(useNavigationGuard).mock.calls.at(-1)![0];
  act(() => {
    expect(guard()()).toBe(false);
  });
  const dialog = await screen.findByRole('alertdialog');
  await user.click(
    within(dialog).getByRole('button', { name: 'Cancel', exact: true }),
  );
  expect(screen.getByLabelText(/Purpose/)).toHaveValue('Unsaved proposal');
  act(() => {
    expect(guard()()).toBe(false);
  });
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Discard changes',
    }),
  );
  await user.type(screen.getByLabelText(/Purpose/), ' updated');
  act(() => {
    expect(guard()()).toBe(false);
  });
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Discard changes',
    }),
  );
  expect(guard()()).toBe(true);
});
