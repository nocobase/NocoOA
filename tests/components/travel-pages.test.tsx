import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, it, expect, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import travel from '../../client/locales/modules/travel.en-US.js';
import Form from '../../client/pages/travel/form-dialog.js';
import Detail from '../../client/pages/travel/detail.js';
import Action from '../../client/pages/travel/action-dialog.js';
import CancellationAction from '../../client/pages/travel-cancellations/action-dialog.js';
import {
  parseAmountCents,
  amountText,
} from '../../client/pages/travel/money.js';
const { api, reload, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  permission: { can: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: permission.can, isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'alice' } } }),
}));
// DateTimePicker wall-clock conversion has its own suite; isolate form serialization here.
vi.mock('../../client/components/date-time-picker.js', () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    disabled: boolean;
  }) => (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...travel } },
});
const record = {
  id: 'b1',
  applicantId: 'alice',
  createdById: 'alice',
  number: null,
  departmentId: 'dept',
  destination: 'Shanghai',
  international: false,
  companionIds: [],
  attachments: [],
  needsBooking: false,
  needsLoan: false,
  transportCents: 29,
  lodgingCents: 0,
  allowanceCents: 0,
  approvalGrantedAt: null,
  bookingInformation: null,
  exceptionReason: null,
  cancelledAt: null,
  startAt: '2026-11-12T01:00:00Z',
  endAt: '2026-11-12T09:00:00Z',
  usesWorkingTime: true,
  amountCents: 29,
  attendanceRecorded: false,
  authorizationId: null,
  managerApproverId: 'manager',
  executiveApproverId: 'exec',
  gmApproverId: 'gm',
  headMerged: null,
  gmMerged: null,
  hrRecipients: ['hr'],
  reason: 'Budget change',
  status: 'draft',
  lifecycleVersion: 4,
  ruleSnapshot: null,
  headApproverId: 'head',
  createdAt: '2026-10-11T00:00:00Z',
};
function detail(overrides = {}) {
  const r = { ...record, ...overrides };
  return {
    record: r,
    timeZone: 'Asia/Shanghai',
    users: [{ id: 'alice', name: 'Alice' }],
    view: {
      state: r.status,
      record: r,
      version: 4,
      available: [
        { name: 'edit', allowed: true, blockers: [] },
        { name: 'submit', allowed: true, blockers: [] },
      ],
      history: { transitions: [], effectRuns: [] },
    },
    runs: [],
    taskActions: [],
    runActions: [],
    upcoming: [],
    timeline: { runs: [] },
  };
}
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
};
function serve(write?: (r: Request) => unknown, data = detail()) {
  api.request.mockImplementation(async (r: Request) => {
    if (r.path === 'travelRequests/options')
      return { data: { timeZone: 'Asia/Shanghai' } };
    if (r.path === 'users') return { data: [], meta: { total: 0 } };
    if (r.method === 'POST') return write?.(r) ?? { data: { record } };
    return { data };
  });
}
function open(path = '/mine/newTravel') {
  const router = createMemoryRouter(
    [
      {
        path: '/mine',
        element: (
          <NavigationGuardProvider>
            <Outlet context={{ reload }} />
          </NavigationGuardProvider>
        ),
        children: [
          { path: 'newTravel', element: <Form /> },
          {
            path: 'travelCancellation/:requestId/action/:actionName/:targetId',
            element: <Outlet context={{ reload, update: vi.fn() }} />,
            children: [{ index: true, element: <CancellationAction /> }],
          },
          { path: 'editTravel/:requestId', element: <Form /> },
          {
            path: 'travel/:requestId',
            element: <Detail />,
            children: [
              { path: 'edit', element: <Form /> },
              { path: 'action/:actionName/:targetId', element: <Action /> },
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

async function fill(amount = '0.29') {
  const user = userEvent.setup();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  await user.type(screen.getByLabelText(/Destination/), 'Shanghai');
  await user.type(screen.getByLabelText(/Starts at/), '2026-11-12T01:00:00Z');
  await user.type(screen.getByLabelText(/Ends at/), '2026-11-12T09:00:00Z');
  await user.clear(screen.getByLabelText(/Transport/));
  await user.type(screen.getByLabelText(/Transport/), amount);
  await user.type(screen.getByLabelText(/Reason/), 'Learning');
  return user;
}
beforeEach(() => {
  api.request.mockReset();
  reload.mockReset();
});
it('accepts zero and preserves exact cents while rejecting subcents and unsafe values', () => {
  expect(parseAmountCents('0')).toBe(0);
  expect(parseAmountCents('0.29')).toBe(29);
  expect(amountText(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  for (const value of ['-1', '1e3', '0.001', '90071992547409.92'])
    expect(parseAmountCents(value)).toBeNull();
});
it('creates zero-cost trip with UTC interval and no invented budget fields', async () => {
  serve();
  const router = open();
  const user = await fill('0');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/mine'));
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'travelRequests',
      method: 'POST',
      json: {
        destination: 'Shanghai',
        international: false,
        companionIds: [],
        attachments: [],
        needsLoan: false,
        needsBooking: false,
        startAt: '2026-11-12T01:00:00Z',
        endAt: '2026-11-12T09:00:00Z',
        transportCents: 0,
        lodgingCents: 0,
        allowanceCents: 0,
        reason: 'Learning',
      },
    }),
  );
});
it('rejects subcent fees without a write', async () => {
  serve();
  open();
  const user = await fill('0.001');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(
    await screen.findByText(travel.travel.amountInvalid),
  ).toBeInTheDocument();
  expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
});
it('locks an uncertain creation so retry cannot create duplicates', async () => {
  serve(() => {
    throw new Error('response lost');
  });
  open();
  const user = await fill();
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(
    await screen.findByText(travel.travel.uncertainCreate),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(1);
});

it('requires cancellation evidence and submits handling output with its offered content hash', async () => {
  const data = {
    ...detail(),
    record: {
      ...record,
      sourceId: 'original-trip',
      needsUnbooking: true,
      unbookingInformation: null,
      status: 'unbooking',
    },
    taskActions: [
      {
        task: { id: 'task', runId: 'run', status: 'pending' },
        actions: [
          {
            name: 'complete',
            allowed: true,
            reasonRequired: false,
            options: {},
            contentHash: 'current-content',
          },
        ],
      },
    ],
    runActions: [],
    runs: [
      {
        run: { id: 'run', contentHash: 'current-content', status: 'open' },
        tasks: [],
      },
    ],
  };
  api.request.mockImplementation(async (r: Request) =>
    r.method === 'POST' ? { data: { record: data.record } } : { data },
  );
  open('/mine/travelCancellation/b1/action/complete/task');
  const user = userEvent.setup();
  const input = await screen.findByLabelText(
    /Cancellation order and refund arrangements/,
  );
  await user.click(
    screen.getByRole('button', {
      name: 'Complete administrative cancellation',
    }),
  );
  expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
  await user.type(
    input,
    'Order cancelled; refund application R remains pending',
  );
  await user.click(
    screen.getByRole('button', {
      name: 'Complete administrative cancellation',
    }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'travelCancellations/b1/action',
        json: expect.objectContaining({
          action: 'complete',
          input: {
            bookingInformation:
              'Order cancelled; refund application R remains pending',
          },
          contentHash: 'current-content',
        }),
      }),
    ),
  );
});

it('prefills company-date grade standards and preserves manually typed estimates', async () => {
  serve();
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) =>
    request.path === 'travelRequests/options'
      ? {
          data: {
            timeZone: 'Asia/Shanghai',
            standard: { code: 'g1', lodgingPerNight: 100, allowancePerDay: 29 },
          },
        }
      : fallback(request),
  );
  open();
  const user = await fill();
  const lodging = screen.getByLabelText(/^Lodging/);
  const allowance = screen.getByLabelText(/^Allowance/);
  await waitFor(() => expect(allowance).toHaveValue('29.00'));
  await user.clear(screen.getByLabelText(/Ends at/));
  await user.type(screen.getByLabelText(/Ends at/), '2026-11-13T09:00:00Z');
  await waitFor(() => expect(lodging).toHaveValue('100.00'));
  expect(allowance).toHaveValue('58.00');
  await user.clear(lodging);
  await user.type(lodging, '80');
  await user.clear(screen.getByLabelText(/Ends at/));
  await user.type(screen.getByLabelText(/Ends at/), '2026-11-14T09:00:00Z');
  await waitFor(() => expect(allowance).toHaveValue('87.00'));
  expect(lodging).toHaveValue('80');
});

it('fetches the chosen applicant standard instead of retaining the submitter grade', async () => {
  serve();
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) => {
    if (request.path === 'users')
      return {
        data: [{ id: 'bob', name: 'Bob target', username: 'bob', email: null }],
        meta: { total: 1 },
      };
    if (request.path === 'travelRequests/options')
      return {
        data: {
          applicantId: 'alice',
          timeZone: 'Asia/Shanghai',
          standard: { lodgingPerNight: 200, allowancePerDay: 100 },
        },
      };
    if (request.path === 'travelRequests/options?applicantId=bob')
      return {
        data: {
          applicantId: 'bob',
          timeZone: 'Asia/Shanghai',
          standard: { lodgingPerNight: 29, allowancePerDay: 20 },
        },
      };
    return fallback(request);
  });
  open();
  const user = await fill();
  await waitFor(() =>
    expect(screen.getByLabelText(/^Allowance/)).toHaveValue('100.00'),
  );
  await user.click(screen.getByLabelText(/^Applicant/));
  await user.click(await screen.findByRole('option', { name: /Bob target/ }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'travelRequests/options?applicantId=bob',
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/^Allowance/)).toHaveValue('20.00'),
  );
});

it('blocks saving when the selected target standard is denied instead of submitting the actor standard', async () => {
  serve();
  const fallback = api.request.getMockImplementation()!;
  api.request.mockImplementation(async (request: Request) => {
    if (request.path === 'users')
      return {
        data: [{ id: 'bob', name: 'Bob target', username: 'bob', email: null }],
        meta: { total: 1 },
      };
    if (request.path === 'travelRequests/options')
      return {
        data: {
          applicantId: 'alice',
          timeZone: 'Asia/Shanghai',
          standard: { lodgingPerNight: 200, allowancePerDay: 100 },
        },
      };
    if (request.path === 'travelRequests/options?applicantId=bob')
      throw new ApiClientError('Scoped target denied', {
        status: 403,
        reason: 'TRAVEL_STANDARD_TARGET_DENIED',
        method: 'GET',
        url: '/api/travelRequests/options',
      });
    return fallback(request);
  });
  open();
  const user = await fill();
  await user.click(screen.getByLabelText(/^Applicant/));
  await user.click(await screen.findByRole('option', { name: /Bob target/ }));
  expect(
    await screen.findByText(travel.travel.standardTargetUnavailable),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(false);
});

it('requires an itinerary for international submission before any write, while allowing a draft', async () => {
  serve();
  open();
  const user = await fill('0');
  await user.click(
    screen.getByRole('checkbox', { name: travel.travel.international }),
  );
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(
    await screen.findByText(
      travel.travel.businessErrors.TRAVEL_ITINERARY_REQUIRED,
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.getElementById('travel-file')).toHaveFocus(),
  );
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([call]) => call.method === 'POST'),
    ).toBe(true),
  );
});
