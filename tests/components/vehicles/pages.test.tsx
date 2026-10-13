import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import locale from '../../../client/locales/modules/vehicles.en-US.js';
import List, { VehicleList } from '../../../client/pages/vehicles/index.js';
import Detail from '../../../client/pages/vehicles/detail.js';
import Action from '../../../client/pages/vehicles/action.js';
import GarageForm from '../../../client/pages/vehicles/garage-form.js';
import { useVehicleResource } from '../../../client/pages/vehicles/resource.js';
import { parseCents } from '../../../client/pages/vehicles/money.js';
const { api, reload, toaster, identity } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  toaster: { show: vi.fn() },
  identity: { id: 'owner' },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...locale } },
});
const options = {
  actor: { id: 'owner', name: 'Applicant' },
  timeZone: 'Asia/Shanghai',
  canCreate: true,
  canManage: false,
  canManageDrivers: false,
};
const record = {
  id: 'r1',
  applicantId: 'owner',
  createdById: 'owner',
  purpose: 'Customer visit',
  destination: 'City',
  startAt: '2035-01-02T01:00:00Z',
  endAt: '2035-01-02T02:00:00Z',
  passengers: 2,
  needsDriver: false,
  number: 'VEH-1',
  status: 'completed',
  lifecycleVersion: 4,
  createdAt: '2035-01-01T01:00:00Z',
  applicant: { id: 'owner', name: 'Applicant' },
};
const detail = {
  record,
  users: [{ id: 'owner', name: 'Applicant' }],
  timeZone: 'Asia/Shanghai',
  view: {
    record,
    state: 'completed',
    available: [],
    history: { transitions: [], effectRuns: [] },
  },
  runs: [],
  taskActions: [],
  runActions: [],
  timeline: { runs: [] },
  transitions: [],
  canViewCost: false,
};
type Request = {
  path: string;
  method?: string;
  query?: Record<string, string>;
  json?: Record<string, unknown>;
  signal?: AbortSignal;
};
function serve(custom?: (request: Request) => unknown) {
  api.request.mockImplementation(async (request: Request) => {
    const value = custom?.(request);
    if (value !== undefined) return value;
    if (request.method) return { data: { record } };
    if (request.path === 'vehicleBrowser/options') return { data: options };
    if (request.path === 'vehicleBrowser/requests')
      return { data: { items: [record], total: 1 } };
    if (request.path.endsWith('/facts'))
      return {
        data: {
          dispatch: null,
          usage: {
            id: 'use',
            mileage: 1,
            exception: '',
            registeredBy: { id: 'owner', name: 'Applicant' },
            createdAt: record.createdAt,
          },
        },
      };
    return { data: detail };
  });
}
function show(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ reload }} />,
        children: [
          { path: 'list', element: <List /> },
          { path: 'garage-list', element: <VehicleList garage /> },
          { path: 'detail/:requestId', element: <Detail /> },
          {
            path: 'action/:requestId/:operation/:taskId?',
            element: <Action />,
          },
          { path: 'garage/new', element: <GarageForm /> },
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
  toaster.show.mockReset();
  reload.mockReset();
  identity.id = 'owner';
});
it('server query and IME input preserve filter URL when manually refreshed', async () => {
  serve();
  const router = show(
    '/list?tab=all&page=2&pageSize=10&sort=startAt&direction=asc&status=completed',
  );
  await screen.findByText('Customer visit');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'vehicleBrowser/requests',
        query: expect.objectContaining({
          page: '2',
          pageSize: '10',
          sort: 'startAt',
          direction: 'asc',
          status: 'completed',
          mode: 'all',
        }),
      }),
    ),
  );
  const input = screen.getByRole('textbox', { name: 'Search' });
  fireEvent.compositionStart(input);
  fireEvent.input(input, { target: { value: 'zhong' }, isComposing: true });
  await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
  expect(router.state.location.search).not.toContain('zhong');
  fireEvent.compositionEnd(input, { data: '中', target: { value: '中' } });
  fireEvent.change(input, { target: { value: '中' } });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ search: '中', page: '1' }),
      }),
    ),
  );
});
it('late private amount response cannot reappear after a current ordinary-view denial', async () => {
  let finish!: (value: unknown) => void,
    calls = 0;
  serve((request) => {
    if (request.path === 'vehicleRequests/r1/usageCost')
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (request.path === 'vehicleBrowser/requests/r1') {
      calls++;
      if (calls > 1)
        throw new ApiClientError('RAW PRIVATE ERROR', {
          status: 403,
          reason: 'DENIED',
          method: 'GET',
          url: request.path,
        });
      return { data: { ...detail, canViewCost: true } };
    }
    return undefined;
  });
  show('/detail/r1');
  await waitFor(() => expect(finish).toBeDefined());
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('You cannot access this record or operation.');
  await act(async () => finish({ data: { id: 'secret', fuelCents: 99999 } }));
  expect(screen.queryByText('999.99')).not.toBeInTheDocument();
  expect(screen.queryByText('RAW PRIVATE ERROR')).not.toBeInTheDocument();
  expect(screen.queryByText('Fuel cost')).not.toBeInTheDocument();
});
it('late operations from another record or actor never replace the current denial', async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementation((request: Request) =>
    request.path === 'private/a'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.reject(
          new ApiClientError('RAW PRIVATE ERROR', {
            status: 403,
            reason: 'DENIED',
            method: 'GET',
            url: request.path,
          }),
        ),
  );
  function Probe({ id }: { id: string }) {
    const r = useVehicleResource<{ data: { actions: string[] } }>(
      `private/${id}`,
    );
    return (
      <div>
        {r.data?.data.actions.join(',') ?? (r.error ? 'denied' : 'loading')}
      </div>
    );
  }
  const tree = (id: string) => (
    <TestI18nProvider runtime={runtime}>
      <Probe id={id} />
    </TestI18nProvider>
  );
  const view = render(tree('a'));
  await waitFor(() => expect(finish).toBeDefined());
  identity.id = 'new-actor';
  view.rerender(tree('b'));
  await screen.findByText('denied');
  await act(async () => finish({ data: { actions: ['private-dispatch'] } }));
  expect(screen.queryByText('private-dispatch')).not.toBeInTheDocument();
  expect(screen.getByText('denied')).toBeInTheDocument();
});
it('destructive withdrawal sends the current version only after explicit confirmation', async () => {
  serve((request) =>
    request.path === 'vehicleBrowser/requests/r1'
      ? {
          data: {
            ...detail,
            record: { ...record, status: 'draft' },
            transitions: ['withdraw'],
          },
        }
      : undefined,
  );
  show('/action/r1/withdraw');
  await screen.findByRole('textbox', { name: 'Comment' });
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  expect(
    api.request.mock.calls.filter(([r]: [Request]) => r.method),
  ).toHaveLength(0);
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'vehicleRequests/r1/transitions',
        json: expect.objectContaining({
          transition: 'withdraw',
          version: 4,
          requestId: expect.any(String),
        }),
      }),
    ),
  );
});
it('usage uses the actual task/hash and exact cents and never displays a synthetic withdrawal', async () => {
  const task = { id: 'usage-task', runId: 'run1' },
    run = { id: 'run1', contentHash: 'actual-hash' };
  serve((request) =>
    request.path === 'vehicleBrowser/requests/r1'
      ? {
          data: {
            ...detail,
            record: { ...record, status: 'usage' },
            runs: [{ run, tasks: [task] }],
            taskActions: [
              {
                task,
                onBehalfOf: null,
                actions: [
                  {
                    name: 'registerUsage',
                    tone: 'neutral',
                    primary: true,
                    contentHash: true,
                    options: {},
                  },
                ],
              },
            ],
          },
        }
      : undefined,
  );
  show('/action/r1/registerUsage/usage-task');
  await screen.findByRole('spinbutton', { name: 'Mileage (km)' });
  await userEvent.clear(screen.getByRole('textbox', { name: 'Fuel cost' }));
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Fuel cost' }),
    '123.45',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'vehicleRequests/r1/actions',
        json: expect.objectContaining({
          target: { taskId: 'usage-task' },
          action: 'registerUsage',
          contentHash: 'actual-hash',
          privateInput: { mileage: 0, fuelCents: 12345, exception: '' },
        }),
      }),
    ),
  );
  expect(parseCents('0.00')).toBe(0);
  expect(parseCents('1.999')).toBeNull();
  expect(parseCents('900719925474099.99')).toBeNull();
});
it('garage mandatory fields focus first invalid input without a metadata write', async () => {
  serve((request) =>
    request.path === 'vehicleBrowser/options'
      ? { data: { ...options, canManage: true } }
      : undefined,
  );
  show('/garage/new');
  await screen.findByRole('textbox', { name: 'Plate number' });
  await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
  await screen.findAllByText('This field is required');
  expect(
    api.request.mock.calls.some(([request]: [Request]) => request.method),
  ).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Plate number' })).toHaveFocus();
});

it('retains the empty request table and one initiation action in the toolbar', async () => {
  serve((r) =>
    r.path === 'vehicleBrowser/requests'
      ? { data: { items: [], total: 0 } }
      : undefined,
  );
  show('/list');
  await screen.findByText('No records yet');
  expect(screen.getByRole('table')).toBeInTheDocument();
  const action = screen.getByRole('button', { name: 'New vehicle request' });
  expect(action.closest('[data-slot=application-toolbar]')).not.toBeNull();
  expect(
    screen.getAllByRole('button', { name: 'New vehicle request' }),
  ).toHaveLength(1);
});

it('claim sends the actual run hash even when the SDK offer does not require a content hash', async () => {
  const task = { id: 'dispatch-task', runId: 'dispatch-run' };
  serve((request) =>
    request.path === 'vehicleBrowser/requests/r1'
      ? {
          data: {
            ...detail,
            runs: [
              {
                run: {
                  id: 'dispatch-run',
                  contentHash: 'current-dispatch-hash',
                },
                tasks: [task],
              },
            ],
            taskActions: [
              {
                task,
                onBehalfOf: null,
                actions: [
                  {
                    name: 'claim',
                    tone: 'neutral',
                    primary: true,
                    contentHash: false,
                    options: {},
                  },
                ],
              },
            ],
          },
        }
      : undefined,
  );
  show('/action/r1/claim/dispatch-task');
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({
          action: 'claim',
          contentHash: 'current-dispatch-hash',
        }),
      }),
    ),
  );
});
it.each([403, 404])(
  'permanent %s load errors do not offer Retry',
  async (status) => {
    serve((request) => {
      if (request.path === 'vehicleBrowser/requests/r1')
        throw new ApiClientError('hidden error', {
          status,
          reason: 'DENIED',
          method: 'GET',
          url: request.path,
        });
    });
    show('/detail/r1');
    await screen.findByText(
      status === 403
        ? 'You cannot access this record or operation.'
        : 'The record is missing or outside your scope.',
    );
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  },
);

it('the actual server interval conflict reason maps to actionable localized feedback', async () => {
  const { errorKey } = await import('../../../client/pages/vehicles/errors.js');
  expect(
    errorKey(
      new ApiClientError('raw backend message', {
        status: 409,
        reason: 'VEHICLE_INTERVAL_CONFLICT',
        method: 'POST',
        url: 'vehicleRequests/r1/actions',
      }),
    ),
  ).toBe('VEHICLE_CONFLICT');
});

it('dispatch selection retains the human vehicle name instead of exposing its id', async () => {
  const task = { id: 'dispatch-task', runId: 'dispatch-run' };
  serve((request) => {
    if (request.path.endsWith('/dispatchCandidates'))
      return {
        data: {
          vehicles: [
            {
              id: 'private-vehicle-id',
              name: 'Human vehicle',
              plateNumber: 'PLATE',
            },
          ],
          drivers: [],
        },
      };
    if (request.path === 'vehicleBrowser/requests/r1')
      return {
        data: {
          ...detail,
          runs: [
            {
              run: { id: 'dispatch-run', contentHash: 'current-hash' },
              tasks: [task],
            },
          ],
          taskActions: [
            {
              task,
              onBehalfOf: null,
              actions: [
                {
                  name: 'complete',
                  tone: 'neutral',
                  primary: true,
                  contentHash: true,
                  options: {},
                },
              ],
            },
          ],
        },
      };
    return undefined;
  });
  show('/action/r1/complete/dispatch-task');
  await userEvent.click(
    await screen.findByRole('combobox', { name: 'Vehicle' }),
  );
  await userEvent.click(
    await screen.findByRole('option', { name: 'Human vehicle · PLATE' }),
  );
  expect(screen.getByRole('combobox', { name: 'Vehicle' })).toHaveTextContent(
    'Human vehicle · PLATE',
  );
  expect(
    screen.getByRole('combobox', { name: 'Vehicle' }),
  ).not.toHaveTextContent('private-vehicle-id');
});

it('both locales cover the public SDK progress state vocabulary without raw state fallback', async () => {
  const zh = (await import('../../../client/locales/modules/vehicles.zh-CN.js'))
    .default;
  for (const copy of [
    locale.vehicles.progressStatus,
    zh.vehicles.progressStatus,
  ])
    for (const state of [
      'done',
      'current',
      'rejected',
      'returned',
      'ended',
      'upcoming',
      'skipped',
    ] as const) {
      expect(copy[state]).toBeTruthy();
      expect(copy[state]).not.toBe(state);
    }
});

it('owner action links preserve the source query and hash before entering a nested overlay', async () => {
  serve((request) =>
    request.path === 'vehicleBrowser/requests/r1'
      ? { data: { ...detail, transitions: ['withdraw'] } }
      : undefined,
  );
  show('/detail/r1?kind=oa.vehicleRequest&page=2#source');
  const withdraw = await screen.findByRole('button', {
    name: 'Withdraw',
    exact: true,
  });
  expect(withdraw).toHaveAttribute(
    'href',
    '/detail/r1/action/withdraw?kind=oa.vehicleRequest&page=2#source',
  );
});

it('garage filters retain status labels and driver-only operation visibility', async () => {
  serve((request) => {
    if (request.path === 'vehicleBrowser/options')
      return {
        data: {
          ...options,
          canViewGarage: true,
          canManage: true,
          canManageDrivers: false,
        },
      };
    if (
      ['vehicleBrowser/garage', 'vehicleBrowser/drivers'].includes(request.path)
    )
      return { data: { items: [], total: 0 } };
  });
  const router = show('/garage-list');
  await screen.findByRole('combobox', { name: 'Status' });
  expect(screen.getByRole('textbox', { name: 'Search' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await userEvent.click(
    screen.getByRole('tab', { name: 'Drivers', exact: true }),
  );
  await waitFor(() =>
    expect(router.state.location.search).toContain('tab=drivers'),
  );
  expect(
    screen.queryByRole('combobox', { name: 'Status' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'New driver' }),
  ).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Search' }),
    'driver',
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'vehicleBrowser/drivers',
        query: expect.objectContaining({ search: 'driver' }),
      }),
    ),
  );
});
