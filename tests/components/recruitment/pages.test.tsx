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
import locale from '../../../client/locales/modules/recruitment.en-US.js';
import List from '../../../client/pages/recruitment/index.js';
import Detail from '../../../client/pages/recruitment/detail.js';
import Form from '../../../client/pages/recruitment/form.js';
import Action from '../../../client/pages/recruitment/action.js';
import RequisitionClose from '../../../client/pages/recruitment/requisition-close.js';
import { cents, patchOf } from '../../../client/pages/recruitment/model.js';
const { api, reload, toaster, grants, identity } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  toaster: { show: vi.fn() },
  grants: new Set<string>(),
  identity: { revision: 0, listeners: new Set<() => void>() },
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
  useAuthentication: () => ({ session: { user: { id: 'owner' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAuthorizationRevision: () =>
      useSyncExternalStore(
        (listener) => {
          identity.listeners.add(listener);
          return () => {
            identity.listeners.delete(listener);
          };
        },
        () => identity.revision,
      ),
    useCan: ({ action }: { action: string }) => ({
      can: grants.has(action),
      isPending: false,
      error: undefined,
    }),
  };
});
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...locale } },
});
const record = {
  id: 'r1',
  departmentId: 'd',
  positionId: 'p',
  gradeId: 'g',
  accountId: 'a',
  year: 2026,
  quantity: 2,
  kind: 'additional',
  replacementEmployeeIds: [],
  expectedStartDate: '2026-12-01',
  jobDescription: 'Engineer',
  reason: 'Growth',
  applicantId: 'owner',
  status: 'hrDirector',
  lifecycleVersion: 4,
  createdAt: '2026-10-11T01:00:00Z',
  statusChangedAt: '2026-10-11T02:00:00Z',
};
const identities = {
  department: { id: 'd', name: 'Development' },
  position: { id: 'p', name: 'Engineer' },
  grade: { id: 'g', name: 'P5' },
};
const detail = {
  record,
  identities,
  users: [{ id: 'owner', name: 'Applicant' }],
  view: {
    record,
    state: record.status,
    available: [],
    history: { transitions: [], effectRuns: [] },
  },
  runs: [],
  taskActions: [],
  runActions: [],
  timeline: { runs: [] },
};
type Request = {
  path: string;
  method?: string;
  query?: Record<string, string>;
  json?: Record<string, unknown>;
};
function serve(custom?: (r: Request) => unknown) {
  api.request.mockImplementation(async (r: Request) => {
    const answer = custom?.(r);
    if (answer !== undefined) return answer;
    if (r.method) return { data: detail };
    if (r.path === 'recruitmentRequests')
      return {
        data: [
          {
            ...record,
            identities,
            applicant: { id: 'owner', name: 'Applicant' },
          },
        ],
        meta: { total: 1 },
      };
    if (r.path === 'recruitmentRequests/createOptions')
      return { data: { canCreate: true } };
    if (r.path === 'recruitmentRequests/formOptions')
      return {
        data: {
          editableFields: ['quantity'],
          department: identities.department,
          positions: [],
          grades: [],
        },
      };
    if (r.path.endsWith('/salary'))
      return { data: { minimumCents: 1234500, maximumCents: 2000000 } };
    if (r.path === 'recruitmentRequests/capacityOptions')
      return { data: [{ id: 'a', initialized: true }] };
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
          {
            path: 'requisitions/:requisitionId/close',
            element: <RequisitionClose />,
          },
          { path: 'detail/:requestId', element: <Detail /> },
          { path: 'form/:requestId/review-edit', element: <Form /> },
          { path: 'form/:requestId/edit', element: <Form /> },
          {
            path: 'action/:requestId/:operation/:targetId?',
            element: <Action />,
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
  toaster.show.mockReset();
  grants.clear();
  identity.revision = 0;
});
it('request list uses named identities and never fetches or renders private salary', async () => {
  serve();
  show('/list');
  expect(await screen.findByRole('link', { name: 'Engineer' })).toBeVisible();
  expect(screen.getByRole('cell', { name: 'Applicant' })).toBeVisible();
  expect(screen.queryByText('Minimum salary')).not.toBeInTheDocument();
  expect(
    api.request.mock.calls.every(
      ([r]) => !String((r as Request).path).endsWith('/salary'),
    ),
  ).toBe(true);
});
it('creation remains in toolbar when the scoped list is empty', async () => {
  grants.add('submit');
  serve((r) =>
    r.path === 'recruitmentRequests'
      ? { data: [], meta: { total: 0 } }
      : undefined,
  );
  show('/list');
  expect(await screen.findByText('No recruitment requests yet')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'New recruitment request' }),
  ).toBeVisible();
});
it('search composition writes URL only after composition ends and keeps filters', async () => {
  serve();
  const router = show('/list?status=hrbp');
  const input = screen.getByRole('textbox', {
    name: 'Search job description or reason',
  });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '工程' } });
  expect(router.state.location.search).not.toContain('q=');
  fireEvent.compositionEnd(input);
  await waitFor(() => expect(router.state.location.search).toContain('q='));
  expect(router.state.location.search).toContain('status=hrbp');
});
it('ordinary detail with no salary grant never requests private amounts', async () => {
  serve();
  show('/detail/r1');
  expect(await screen.findByText('Growth')).toBeVisible();
  expect(screen.queryByText('Minimum salary')).not.toBeInTheDocument();
  expect(
    api.request.mock.calls.every(
      ([r]) => !String((r as Request).path).endsWith('/salary'),
    ),
  ).toBe(true);
});
it('does not fetch reviewer form options without a current approve offer', async () => {
  grants.add('reviewEdit');
  serve();
  show('/detail/r1');
  expect(await screen.findByText('Growth')).toBeVisible();
  expect(
    api.request.mock.calls.some(
      ([request]) =>
        (request as Request).path === 'recruitmentRequests/formOptions',
    ),
  ).toBe(false);
});
it('independent salary denial has no retry and exposes no retained amount', async () => {
  grants.add('viewSalary');
  serve((r) =>
    r.path.endsWith('/salary')
      ? Promise.reject(
          new ApiClientError('Denied', {
            status: 403,
            method: 'GET',
            url: r.path,
          }),
        )
      : undefined,
  );
  show('/detail/r1');
  expect(
    await screen.findByText('You do not have access to this record.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('12,345.00')).not.toBeInTheDocument();
});
it('review amendments send only current editable fields without salary permission', async () => {
  serve();
  show('/form/r1/review-edit');
  const quantity = await screen.findByRole('spinbutton', {
    name: 'Quantity *',
  });
  expect(screen.queryByText('Minimum salary *')).not.toBeInTheDocument();
  fireEvent.change(quantity, { target: { value: '3' } });
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
    'Revised staffing',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Save recruitment request' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([r]) => (r as Request).method === 'POST'),
    ).toBe(true),
  );
  const write = api.request.mock.calls
    .map(([r]) => r as Request)
    .find((r) => r.method === 'POST')!;
  expect(write.path).toBe('recruitmentRequests/r1/reviewEdit');
  expect(write.json).toMatchObject({
    version: 4,
    patch: { quantity: 3 },
    reason: 'Revised staffing',
  });
  expect(Object.keys(write.json!.patch as object)).toEqual(['quantity']);
});
it('draft editing cannot replace unreadable private salary with zero', async () => {
  serve((r) =>
    r.path === 'recruitmentRequests/r1'
      ? { data: { ...detail, record: { ...record, status: 'draft' } } }
      : undefined,
  );
  show('/form/r1/edit');
  expect(
    await screen.findByText(
      'This operation is no longer available with your current permissions.',
    ),
  ).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
});
it('unoffered approval actions remain unavailable and make no writes', async () => {
  serve();
  show('/action/r1/approve/task');
  expect(
    await screen.findByText(
      'This operation is no longer available with your current permissions.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  expect(api.request.mock.calls.every(([r]) => !(r as Request).method)).toBe(
    true,
  );
});
it('safe cents and patch projection reject floating invalid amounts and surplus fields', () => {
  expect(cents('100.05')).toBe(10005);
  expect(cents('1.005')).toBeNull();
  expect(cents('-1')).toBeNull();
  const proposal = {
    ...record,
    minimumCents: 1234500,
    maximumCents: 2000000,
  } as Parameters<typeof patchOf>[0];
  expect(
    patchOf({ ...proposal, quantity: 4, minimumCents: 1 }, proposal, [
      'quantity',
    ]),
  ).toEqual({ quantity: 4 });
});
it('uncertain action retries retain the exact version, command identity and body', async () => {
  const withSubmit = {
    ...detail,
    record: { ...record, status: 'draft' },
    canSubmit: true,
    view: { ...detail.view, available: [] },
  };
  let attempts = 0;
  serve((r) => {
    if (r.method) {
      attempts++;
      if (attempts === 1) throw new Error('Network lost');
      return { data: withSubmit };
    }
    return { data: withSubmit };
  });
  show('/action/r1/submit');
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Reason for this operation *' }),
    'Submit hiring request',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Retry exact command' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => (r as Request).method === 'POST'),
    ).toHaveLength(2),
  );
  const writes = api.request.mock.calls
    .map(([r]) => r as Request)
    .filter((r) => r.method === 'POST');
  expect(writes[0].json).toEqual(writes[1].json);
  expect(writes[0].json).toMatchObject({
    version: 4,
    transition: 'submit',
    reason: 'Submit hiring request',
  });
});
it('authorization revision immediately clears loaded salary and drops obsolete pending responses', async () => {
  grants.add('viewSalary');
  let finish: ((value: unknown) => void) | undefined;
  serve((r) => {
    if (identity.revision === 1 && r.path === 'recruitmentRequests/r1')
      return new Promise((resolve) => {
        finish = resolve;
      });
    return undefined;
  });
  show('/detail/r1');
  expect(await screen.findByText('12,345.00')).toBeVisible();
  act(() => {
    identity.revision = 1;
    grants.delete('viewSalary');
    identity.listeners.forEach((listener) => listener());
  });
  expect(screen.queryByText('12,345.00')).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeDefined());
  act(() => {
    identity.revision = 2;
    identity.listeners.forEach((listener) => listener());
  });
  await act(async () => finish?.({ data: detail }));
  expect(screen.queryByText('12,345.00')).not.toBeInTheDocument();
});
it('pending review mutation aborts on authorization revision and its old success cannot toast or navigate', async () => {
  let finish: ((value: unknown) => void) | undefined;
  serve((r) =>
    r.method
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : undefined,
  );
  const router = show('/form/r1/review-edit');
  fireEvent.change(
    await screen.findByRole('spinbutton', { name: 'Quantity *' }),
    { target: { value: '3' } },
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
    'Staffing revision',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Save recruitment request' }),
  );
  await waitFor(() => expect(finish).toBeDefined());
  const write = api.request.mock.calls
    .map(([r]) => r as Request & { signal: AbortSignal })
    .find((r) => r.method)!;
  act(() => {
    identity.revision++;
    identity.listeners.forEach((listener) => listener());
  });
  expect(write.signal.aborted).toBe(true);
  await act(async () => finish?.({ data: detail }));
  expect(toaster.show).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe('/form/r1/review-edit');
});
it('409 action conflict locks the obsolete command and prevents another version or offer write', async () => {
  const offered = {
    ...detail,
    canSubmit: true,
    view: { ...detail.view, available: [] },
  };
  serve((r) =>
    r.method
      ? Promise.reject(
          new ApiClientError('Conflict', {
            status: 409,
            method: 'POST',
            url: r.path,
          }),
        )
      : { data: offered },
  );
  show('/action/r1/submit');
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Reason for this operation *' }),
    'Submit request',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(
    await screen.findByText(
      'This record changed. Load the latest data and try again.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(
    api.request.mock.calls.filter(([r]) => (r as Request).method),
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: 'Retry exact command' }),
  ).not.toBeInTheDocument();
});
it('requisition close confirms the remaining-allocation consequence and freezes its command on network failure', async () => {
  const requisition = {
    id: 'req1',
    requestId: 'r1',
    departmentId: 'd',
    positionId: 'p',
    gradeId: 'g',
    originalQuantity: 3,
    remaining: 2,
    consumed: 1,
    sourceYear: 2026,
    sourceVersion: 4,
    status: 'recruiting',
    version: 7,
    createdAt: record.createdAt,
    updatedAt: record.createdAt,
  };
  let attempts = 0;
  serve((r) => {
    if (r.method) {
      attempts++;
      if (attempts === 1) throw new Error('Unknown response');
      return { data: { ...requisition, status: 'closed' } };
    }
    return { data: requisition };
  });
  show('/requisitions/req1/close');
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Reason for this operation *' }),
    'Hiring complete',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Close remaining allocation' }),
  );
  expect(
    await screen.findByText(
      'Only remaining unconsumed recruitment allocation is released. Consumed employee history remains.',
    ),
  ).toBeVisible();
  await userEvent.click(
    (await screen.findByRole('alertdialog')).querySelector(
      'button:last-child',
    )!,
  );
  const reason = screen.getByRole('textbox', {
    name: 'Reason for this operation *',
  });
  expect(reason).toBeDisabled();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Retry exact command' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => (r as Request).method),
    ).toHaveLength(2),
  );
  const writes = api.request.mock.calls
    .map(([r]) => r as Request)
    .filter((r) => r.method);
  expect(writes[0].path).toBe('requisitions/req1/close');
  expect(writes[0].json).toEqual(writes[1].json);
  expect(writes[0].json).toMatchObject({
    version: 7,
    reason: 'Hiring complete',
  });
});

it('annual headcount guides an empty candidate list to the ledger', async () => {
  grants.add('viewSalary');
  serve((r) => {
    if (r.path === 'recruitmentRequests/formOptions')
      return {
        data: {
          editableFields: ['accountId'],
          department: identities.department,
          positions: [{ ...identities.position }],
          grades: [],
        },
      };
    if (r.path === 'recruitmentRequests/capacityOptions') return { data: [] };
    return undefined;
  });
  show('/form/r1/edit');
  expect(
    await screen.findByText(
      'No matching initialized annual headcount. Ask HR to create and initialize it.',
    ),
  ).toBeVisible();
});

it('annual headcount renders a department, position and year instead of the account ID', async () => {
  grants.add('viewSalary');
  serve((r) =>
    r.path === 'recruitmentRequests/formOptions'
      ? {
          data: {
            editableFields: ['accountId'],
            department: identities.department,
            positions: [identities.position],
            grades: [],
          },
        }
      : undefined,
  );
  show('/form/r1/edit');
  expect(
    await screen.findByText('Development / Engineer / 2026'),
  ).toBeVisible();
});

it('hides creation when submit is granted but the user cannot create for any department', async () => {
  grants.add('submit');
  serve((r) =>
    r.path === 'recruitmentRequests/createOptions'
      ? { data: { canCreate: false } }
      : undefined,
  );
  show('/list');
  expect(await screen.findByRole('link', { name: 'Engineer' })).toBeVisible();
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'recruitmentRequests/createOptions' }),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'New recruitment request' }),
  ).not.toBeInTheDocument();
});

it('hides creation until eligibility resolves and after an authorization revision revokes it', async () => {
  grants.add('submit');
  let resolve!: (value: unknown) => void;
  serve((r) =>
    r.path === 'recruitmentRequests/createOptions'
      ? new Promise((done) => {
          resolve = done;
        })
      : undefined,
  );
  show('/list');
  expect(await screen.findByRole('link', { name: 'Engineer' })).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'New recruitment request' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    resolve({ data: { canCreate: true } });
  });
  expect(
    await screen.findByRole('button', { name: 'New recruitment request' }),
  ).toBeVisible();
  await act(async () => {
    identity.revision++;
    identity.listeners.forEach((listener) => listener());
  });
  expect(
    screen.queryByRole('button', { name: 'New recruitment request' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    resolve({ data: { canCreate: false } });
  });
  expect(
    screen.queryByRole('button', { name: 'New recruitment request' }),
  ).not.toBeInTheDocument();
});

it('reassignment uses one searchable recipient control and submits the selected user', async () => {
  const offered = {
    ...detail,
    taskActions: [
      {
        task: { id: 'task1' },
        actions: [
          { name: 'reassign', options: {}, batch: false, contentHash: false },
        ],
      },
    ],
  };
  serve((r) =>
    r.path.endsWith('/candidates')
      ? {
          data: {
            people: [{ id: 'replacement', name: 'Replacement reviewer' }],
            nextOffset: null,
          },
        }
      : { data: offered },
  );
  show('/action/r1/reassign/task1');
  const picker = await screen.findByRole('combobox');
  expect(picker).toHaveAttribute('placeholder', 'Search eligible recipients');
  await userEvent.type(picker, 'R');
  await userEvent.click(
    await screen.findByRole('option', { name: 'Replacement reviewer' }),
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
    'Cover absence',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Reassign' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(dialog.querySelector('button:last-child')!);
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({
          action: 'reassign',
          input: { to: 'replacement', override: false },
        }),
      }),
    ),
  );
});

it('recipient request failures show a relevant message with retry rather than staffing validation', async () => {
  const offered = {
    ...detail,
    taskActions: [
      {
        task: { id: 'task1' },
        actions: [
          { name: 'reassign', options: {}, batch: false, contentHash: false },
        ],
      },
    ],
  };
  serve((r) =>
    r.path.endsWith('/candidates')
      ? Promise.reject(
          new ApiClientError('Bad request', {
            status: 400,
            method: 'GET',
            url: r.path,
          }),
        )
      : { data: offered },
  );
  show('/action/r1/reassign/task1');
  await userEvent.type(await screen.findByRole('combobox'), 'R');
  expect(
    await screen.findByText(
      'Could not load recipients. Retry, or refresh the approval details and try again.',
    ),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.queryByText(/initialized headcount/)).not.toBeInTheDocument();
});

it('identifies the invalid recruitment quantity and keeps the proposal for correction', async () => {
  serve();
  show('/form/r1/review-edit');
  const quantity = await screen.findByRole('spinbutton', {
    name: 'Quantity *',
  });
  fireEvent.change(quantity, { target: { value: '0' } });
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
    { target: { value: 'Revised staffing' } },
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Save recruitment request' }),
  );
  expect(
    await screen.findByText(
      'Enter a positive whole number of recruits within the supported range.',
    ),
  ).toBeVisible();
  expect(quantity).toHaveFocus();
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  fireEvent.change(quantity, { target: { value: '3' } });
  expect(
    screen.queryByText(
      'Enter a positive whole number of recruits within the supported range.',
    ),
  ).toBeNull();
  expect(
    screen.getByRole('textbox', { name: 'Reason for this operation *' }),
  ).toHaveValue('Revised staffing');
});
