import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import transfer from '../../../client/locales/modules/transfer.en-US.js';
import { transferViewChildren } from '../../../client/route-modules/transfer.js';
import List from '../../../client/pages/transfer/index.js';
import DetailPage from '../../../client/pages/transfer/detail.js';
import Form from '../../../client/pages/transfer/form.js';
import { Transition } from '../../../server/routes/transfer/schemas.js';
import Action from '../../../client/pages/transfer/action.js';
const { api, reload, grants, identity, toaster } = vi.hoisted(() => ({
  toaster: { show: vi.fn() },
  api: { request: vi.fn() },
  reload: vi.fn(),
  grants: { salary: true, revision: 0 },
  identity: { id: 'hr' },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useNavigationGuard: () => undefined,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authorization/client')
  >()),
  useAuthorizationRevision: () => grants.revision,
  useCan: ({ action }: { action: string }) => ({
    can: action === 'viewSalary' ? grants.salary : true,
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, transfer } },
});
const record = {
  id: 'request-1',
  employeeId: 'employee',
  applicantId: 'hr',
  kinds: ['salaryChange'],
  targetDepartmentId: 'department',
  targetPositionId: 'position',
  targetGradeId: 'grade',
  targetManagerId: null,
  sourceAccountId: null,
  targetAccountId: null,
  effectiveDate: '2030-01-01',
  reason: 'Annual adjustment',
  status: 'executive',
  lifecycleVersion: 7,
  createdAt: '2026-10-11T00:00:00Z',
  executionFailureCode: null,
};
const facts = {
  employee: { id: 'employee', name: 'Employee' },
  department: { id: 'department', name: 'Department' },
  position: { id: 'position', name: 'Position' },
  grade: { id: 'grade', name: 'Grade' },
  manager: null,
};
const detail = {
  record,
  facts,
  users: [{ id: 'hr', name: 'HR' }],
  view: { available: [] },
  runs: [],
  actions: [],
  timeline: { runs: [] },
};
type Request = {
  path: string;
  query?: Record<string, string>;
  method?: string;
  json?: Record<string, unknown>;
};
function serve(overrides?: (request: Request) => unknown) {
  api.request.mockImplementation(async (request: Request) => {
    const result = overrides?.(request);
    if (result !== undefined) return result;
    if (request.path === 'transferRequests/capabilities')
      return { data: { canCreateAsHR: true } };
    if (request.path === 'transferRequests')
      return { data: [], meta: { total: 0 } };
    if (request.path === 'transferRequests/formOptions')
      return {
        data: {
          canCreateAsHR: false,
          editableFields: ['targetGradeId', 'targetSalary'],
          employee: facts.employee,
          departments: [],
          positions: [],
          grades: [facts.grade],
          managers: [],
        },
      };
    if (request.path === 'transferRequests/capacityOptions')
      return { data: { sourceAccountId: null, targetAccountId: null } };
    if (request.path.endsWith('/salary'))
      return { data: { targetSalary: '1100.00', currentSalary: 100000 } };
    return { data: detail };
  });
}
function show(path: string, selectedDetail: unknown = detail, writable = true) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <Outlet context={{ reload, detail: selectedDetail, writable }} />
        ),
        children: [
          { path: 'list', element: <List /> },
          { path: 'detail/:requestId', element: <DetailPage /> },
          { path: 'review/:requestId/reviewEdit', element: <Form /> },
          { path: 'review/:requestId/edit', element: <Form /> },
          {
            path: 'approvals/pending/transfer/:requestId',
            element: (
              <Outlet context={{ reload, detail: selectedDetail, writable }} />
            ),
            children: [
              { index: true, element: <div>Center detail</div> },
              { path: 'reviewEdit', element: <Form /> },
              { path: 'edit', element: <Form /> },
            ],
          },
          { path: 'action/:operation/:taskId?', element: <Action /> },
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
  grants.salary = true;
  grants.revision = 0;
  identity.id = 'hr';
});
it('keeps headers, pagination and one toolbar creation entry during empty and filtered results', async () => {
  serve();
  show('/list?q=none&orderBy=effectiveDate:asc#source');
  expect(await screen.findByText('No matching requests')).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'New request' })).toHaveLength(
    1,
  );
  expect(screen.getByRole('button', { name: 'New request' })).toHaveAttribute(
    'href',
    '/list/new?q=none&orderBy=effectiveDate:asc#source',
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'transferRequests',
      query: expect.objectContaining({
        q: 'none',
        orderBy: 'effectiveDate:asc',
      }),
    }),
  );
});
it('does not expose initiation when the real HR capability refuses it', async () => {
  serve((request) =>
    request.path === 'transferRequests/capabilities'
      ? { data: { canCreateAsHR: false } }
      : undefined,
  );
  show('/list');
  await screen.findByText('No personnel change requests');
  expect(
    screen.queryByRole('button', { name: 'New request' }),
  ).not.toBeInTheDocument();
});
it('clears private salary after revocation and leaves safe details visible', async () => {
  let refused = false;
  serve((request) =>
    request.path.endsWith('/salary') && refused
      ? Promise.reject(
          new ApiClientError('Denied', {
            status: 403,
            reason: 'PERMISSION_DENIED',
            method: 'GET',
            url: request.path,
          }),
        )
      : undefined,
  );
  show('/detail/request-1');
  await screen.findByText(/1,100/);
  refused = true;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText(
    'You do not have permission for this personnel change.',
  );
  expect(screen.queryByText(/1,100/)).not.toBeInTheDocument();
  expect(screen.getByText('Annual adjustment')).toBeInTheDocument();
});
it('drops an old private response when navigating to another record', async () => {
  let resolve!: (value: unknown) => void;
  const first = new Promise((value) => {
    resolve = value;
  });
  serve((request) =>
    request.path === 'transferRequests/request-1/salary'
      ? first
      : request.path === 'transferRequests/request-2'
        ? { data: { ...detail, record: { ...record, id: 'request-2' } } }
        : request.path === 'transferRequests/request-2/salary'
          ? { data: { targetSalary: '2200.00' } }
          : undefined,
  );
  const router = show('/detail/request-1');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'transferRequests/request-1/salary' }),
    ),
  );
  await act(() => router.navigate('/detail/request-2'));
  await screen.findByText(/2,200/);
  await act(async () => {
    resolve({ data: { targetSalary: '9999.00' } });
    await first;
  });
  expect(screen.queryByText(/9,999/)).not.toBeInTheDocument();
});
it('restricts executive editing to current options and avoids employee directory requests', async () => {
  serve();
  show('/review/request-1/reviewEdit');
  await screen.findByText('Changes restart approval and close existing tasks.');
  expect(screen.getByLabelText('Target salary (CNY)')).toHaveValue('1100.00');
  expect(screen.queryByLabelText('Target department')).not.toBeInTheDocument();
  expect(
    api.request.mock.calls.some(([request]) => request.path === 'employees'),
  ).toBe(false);
  const input = screen.getByLabelText('Target salary (CNY)');
  await userEvent.clear(input);
  await userEvent.type(input, '1200.00');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'transferRequests/request-1/reviewEdit',
        json: expect.objectContaining({
          patch: { targetSalary: '1200.00' },
          version: 7,
        }),
      }),
    ),
  );
});

it('clears salary immediately when the same actor receives a new authorization revision', async () => {
  let pending = false;
  serve((request) =>
    request.path.endsWith('/salary') && pending
      ? new Promise(() => {})
      : undefined,
  );
  const router = show('/detail/request-1');
  await screen.findByText(/1,100/);
  pending = true;
  grants.revision = 1;
  await act(() => router.navigate('/detail/request-1?revision=1'));
  expect(screen.queryByText(/1,100/)).not.toBeInTheDocument();
});
it('unmounts private unsaved form values on a same-actor authorization revision', async () => {
  let pending = false;
  serve((request) =>
    request.path === 'transferRequests/formOptions' && pending
      ? new Promise(() => {})
      : undefined,
  );
  const router = show('/review/request-1/reviewEdit');
  const salary = await screen.findByLabelText('Target salary (CNY)');
  await userEvent.clear(salary);
  await userEvent.type(salary, '9876.00');
  pending = true;
  grants.revision = 1;
  await act(() => router.navigate('/review/request-1/reviewEdit?revision=1'));
  expect(screen.queryByDisplayValue('9876.00')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Target salary (CNY)'),
  ).not.toBeInTheDocument();
});

it('sends the actual offered SDK task and retains the same command for network retry', async () => {
  const selected = {
    ...detail,
    actions: [
      {
        task: { id: 'real-task', runId: 'run' },
        onBehalfOf: null,
        actions: [
          { name: 'approve', tone: 'primary', primary: true, options: {} },
        ],
      },
    ],
  };
  let calls = 0;
  serve((request) => {
    if (request.method) {
      calls++;
      return calls === 1
        ? Promise.reject(new Error('Network'))
        : { data: detail };
    }
    return undefined;
  });
  show('/action/approve/real-task', selected);
  await userEvent.type(screen.getByLabelText('Reason'), 'Reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
  await screen.findByText(
    'The personnel change could not be completed. Refresh and try again.',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
  const commands = api.request.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === 'POST');
  expect(commands).toHaveLength(2);
  expect(commands[0].json).toMatchObject({
    target: { taskId: 'real-task' },
    action: 'approve',
    reason: 'Reviewed',
  });
  expect(commands[0].json.requestKey).toBe(commands[1].json.requestKey);
});

it('does not post an old offer while the parent read is refreshing', async () => {
  const selected = {
    ...detail,
    actions: [
      {
        task: { id: 'real-task', runId: 'run' },
        onBehalfOf: null,
        actions: [
          { name: 'approve', tone: 'primary', primary: true, options: {} },
        ],
      },
    ],
  };
  serve();
  show('/action/approve/real-task', selected, false);
  await userEvent.type(screen.getByLabelText('Reason'), 'Reviewed');
  expect(screen.getByRole('button', { name: 'Confirm action' })).toBeDisabled();
  expect(api.request.mock.calls.some(([request]) => request.method)).toBe(
    false,
  );
});
it('identifies the employee and confirms destructive withdrawal before posting', async () => {
  serve();
  show('/action/withdraw', {
    ...detail,
    view: { available: [{ name: 'withdraw', allowed: true }] },
  });
  await userEvent.type(screen.getByLabelText('Reason'), 'Mistake');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
  expect(api.request.mock.calls.some(([request]) => request.method)).toBe(
    false,
  );
  const confirm = screen.getByRole('alertdialog');
  expect(confirm).toHaveTextContent(/Employee.*request-1/);
  expect(
    within(confirm).getByText('Employee', { exact: true }),
  ).toBeInTheDocument();
  await userEvent.click(
    within(confirm).getByRole('button', { name: 'Confirm action' }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'transferRequests/request-1/transitions',
        json: expect.objectContaining({ transition: 'withdraw', version: 7 }),
      }),
    ),
  );
});
it('aborts an old action on authorization revision and ignores late completion', async () => {
  let resolve!: (value: unknown) => void;
  const old = new Promise((value) => {
    resolve = value;
  });
  const selected = {
    ...detail,
    actions: [
      {
        task: { id: 'real-task', runId: 'run' },
        onBehalfOf: null,
        actions: [
          { name: 'approve', tone: 'primary', primary: true, options: {} },
        ],
      },
    ],
  };
  serve((request) => (request.method ? old : undefined));
  const router = show('/action/approve/real-task', selected);
  await userEvent.type(screen.getByLabelText('Reason'), 'Reviewed');
  await userEvent.click(screen.getByRole('button', { name: 'Confirm action' }));
  const request = api.request.mock.calls
    .map(([request]) => request)
    .find((request) => request.method);
  grants.revision = 1;
  await act(() => router.navigate('/action/approve/real-task?revision=1'));
  expect(request.signal.aborted).toBe(true);
  await act(async () => {
    resolve({ data: detail });
    await old;
  });
  expect(router.state.location.pathname).toBe('/action/approve/real-task');
  expect(toaster.show).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
it('aborts private edits on authorization revision and ignores late completion', async () => {
  let resolve!: (value: unknown) => void;
  const old = new Promise((value) => {
    resolve = value;
  });
  serve((request) => (request.method ? old : undefined));
  const router = show('/review/request-1/reviewEdit');
  const input = await screen.findByLabelText('Target salary (CNY)');
  await userEvent.clear(input);
  await userEvent.type(input, '1200.00');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.request.mock.calls.some(([request]) => request.method)).toBe(
      true,
    ),
  );
  const request = api.request.mock.calls
    .map(([request]) => request)
    .find((request) => request.method);
  grants.revision = 1;
  await act(() => router.navigate('/review/request-1/reviewEdit?revision=1'));
  expect(request.signal.aborted).toBe(true);
  await act(async () => {
    resolve({ data: detail });
    await old;
  });
  expect(router.state.location.pathname).toBe('/review/request-1/reviewEdit');
  expect(toaster.show).not.toHaveBeenCalled();
  expect(screen.queryByDisplayValue('1200.00')).not.toBeInTheDocument();
});

it('uses resolved candidate labels and disables recipient commands while their current source reloads', async () => {
  const selected = {
    ...detail,
    actions: [
      {
        task: { id: 'real-task', runId: 'run' },
        onBehalfOf: null,
        actions: [
          { name: 'reassign', tone: 'default', primary: false, options: {} },
        ],
      },
    ],
  };
  serve((request) =>
    request.path.endsWith('/candidates')
      ? request.query?.search
        ? new Promise(() => {})
        : {
            data: {
              people: [{ id: 'manager-id', name: 'Manager' }],
              nextOffset: null,
            },
          }
      : undefined,
  );
  show('/action/reassign/real-task', selected);
  await userEvent.type(screen.getByLabelText('Reason'), 'Handover');
  const picker = await screen.findByRole('combobox');
  await waitFor(() => expect(picker).not.toBeDisabled());
  await userEvent.click(picker);
  await userEvent.click(await screen.findByRole('option', { name: 'Manager' }));
  expect(screen.getByRole('combobox')).toHaveTextContent('Manager');
  expect(screen.getByRole('button', { name: 'Confirm action' })).toBeEnabled();
  await userEvent.type(screen.getByLabelText('Search candidate name'), 'New');
  expect(screen.getByRole('button', { name: 'Confirm action' })).toBeDisabled();
});

it('renders the actual completed lifecycle status as effective', async () => {
  serve((request) =>
    request.path === 'transferRequests/request-1'
      ? { data: { ...detail, record: { ...record, status: 'completed' } } }
      : undefined,
  );
  show('/detail/request-1');
  expect(await screen.findByText('Effective')).toBeInTheDocument();
});
it('maps safe server field violations to the correct private input and focuses it', async () => {
  serve((request) =>
    request.method
      ? Promise.reject(
          new ApiClientError('PRIVATE SQL', {
            status: 400,
            method: 'POST',
            url: request.path,
            reason: 'INVALID_INPUT',
            payload: {
              error: {
                fieldViolations: [
                  {
                    field: 'proposal.targetSalary',
                    description: 'PRIVATE SQL',
                  },
                ],
              },
            },
          }),
        )
      : undefined,
  );
  show('/review/request-1/reviewEdit');
  const input = await screen.findByLabelText('Target salary (CNY)');
  await userEvent.clear(input);
  await userEvent.type(input, '1200.00');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(
    'Enter a salary within the allowed range with up to two decimal places.',
  );
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.queryByText('PRIVATE SQL')).not.toBeInTheDocument();
});

it('preserves center source query after reviewer save and refreshes the host', async () => {
  serve();
  const router = show(
    '/approvals/pending/transfer/request-1/reviewEdit?q=needle&page=3#source',
  );
  const input = await screen.findByLabelText('Target salary (CNY)');
  await waitFor(() => expect(input).toHaveValue('1100.00'));
  await userEvent.clear(input);
  await userEvent.type(input, '1200.00');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/approvals/pending/transfer/request-1',
    ),
  );
  expect(router.state.location.search).toBe('?q=needle&page=3');
  expect(router.state.location.hash).toBe('#source');
  expect(reload).toHaveBeenCalledOnce();
});
it('gives center transfer children unique owner names and independent owner policies', () => {
  const routes = transferViewChildren('pending');
  expect(routes.map((r) => r.path)).toEqual([
    'newTransfer',
    'editTransfer/:requestId',
    'transfer/:requestId',
  ]);
  const all = routes.flatMap((r) => [r, ...(r.children ?? [])]);
  expect(new Set(all.map((r) => r.name)).size).toBe(all.length);
  for (const route of all)
    expect(route.authz).toMatchObject({ resource: { id: 'oa.transfer' } });
});

it('saves the draft and submits with the strict owner reason, version and durable key', async () => {
  const draft = { ...detail, record: { ...record, status: 'draft' } };
  serve((request) => {
    if (
      request.path === 'transferRequests/request-1' &&
      request.method === 'PATCH'
    )
      return {
        data: { ...draft, record: { ...draft.record, lifecycleVersion: 8 } },
      };
    if (request.path === 'transferRequests/request-1') return { data: draft };
    if (request.path === 'transferRequests/request-1/transitions') {
      expect(Transition.parse(request.json)).toMatchObject({
        transition: 'submit',
        version: 8,
        reason: 'Annual adjustment',
      });
      return {
        data: { record: { ...record, lifecycleVersion: 9, status: 'manager' } },
      };
    }
    return undefined;
  });
  show('/review/request-1/edit', draft);
  await screen.findByLabelText('Target salary (CNY)');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Submit', exact: true }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Submit', exact: true }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'transferRequests/request-1/transitions',
      }),
    ),
  );
  await waitFor(() =>
    expect(toaster.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    ),
  );
});

it('offers current-year rebind for the actual server failure code in the fixed detail footer', async () => {
  serve((request) =>
    request.path === 'transferRequests/request-1'
      ? {
          data: {
            ...detail,
            record: {
              ...record,
              status: 'pendingEffective',
              executionFailureCode: 'TRANSFER_YEAR_REBIND_REQUIRED',
            },
          },
        }
      : undefined,
  );
  show('/detail/request-1?q=kept&page=2#source');
  const action = await screen.findByRole('button', {
    name: 'Rebind current-year capacity',
  });
  expect(action).toHaveAttribute(
    'href',
    '/detail/request-1/action/rebind?q=kept&page=2#source',
  );
  expect(action.closest('[data-slot="route-overlay-footer"]')).not.toBeNull();
  expect(
    screen.getByRole('dialog', { name: 'Personnel changes' }),
  ).toBeInTheDocument();
});

it('shows the translated URL status before opening the filter and clears it without losing sorting', async () => {
  serve();
  const router = show(
    '/list?status=executive&page=3&orderBy=effectiveDate:asc#source',
  );
  const status = await screen.findByRole('combobox', { name: 'Status' });
  expect(status).toHaveTextContent('Executive review');
  await userEvent.click(
    within(screen.getByRole('table')).getByRole('button', {
      name: 'Clear filters',
    }),
  );
  await waitFor(() => expect(status).toHaveTextContent('All statuses'));
  expect(router.state.location.search).toBe('?orderBy=effectiveDate%3Aasc');
});
