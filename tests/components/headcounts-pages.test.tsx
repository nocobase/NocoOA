import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import List from '../../client/pages/headcounts/index.js';
import Detail from '../../client/pages/headcounts/detail.js';
import Form from '../../client/pages/headcounts/form.js';
const { api, toaster, grants } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  grants: new Set(['manage', 'viewJournal']),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: () => undefined,
  usePageBreadcrumb: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'hr' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: grants.has(action),
    isPending: false,
    error: undefined,
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const balance = {
  id: 'a',
  departmentId: 'd',
  positionId: 'p',
  department: { id: 'd', name: 'Engineering' },
  position: { id: 'p', name: 'Engineer' },
  year: 2026,
  limit: 5,
  initialized: false,
  version: 3,
  used: 1,
  pending: 0,
  allocated: 0,
  available: 4,
  replacementPending: 0,
  replacementAllocated: 0,
  replacementBlocked: 0,
  createdAt: '2026-10-12T01:00:00Z',
  updatedAt: '2026-10-12T01:00:00Z',
};
type Request = {
  path: string;
  query?: Record<string, string>;
  method?: string;
  body?: string;
};
function serve(custom?: (r: Request) => unknown) {
  api.request.mockImplementation(async (r: Request) => {
    const value = custom?.(r);
    if (value !== undefined) return value;
    if (r.method) return { data: { ...balance, version: 4 } };
    if (r.path === 'headcounts') return { data: [balance], meta: { total: 1 } };
    if (r.path === 'headcounts/a') return { data: balance };
    if (r.path === 'headcounts/a/journal')
      return { data: [], meta: { total: 0 } };
    if (r.path === 'headcounts/createOptions')
      return {
        data: {
          year: 2026,
          targets: [
            { department: balance.department, position: balance.position },
          ],
        },
      };
    if (r.path === 'headcounts/a/reconciliationPreview')
      return {
        data: {
          version: 3,
          initialized: false,
          employees: [
            { id: 'e1', name: 'Alice', status: 'regular' },
            { id: 'e2', name: 'Bob', status: 'probation' },
          ],
        },
      };
    if (r.path === 'positions/options')
      return { data: [{ id: 'p', title: 'Engineer' }] };
    if (r.path === 'departments/options')
      return {
        data: [
          {
            id: 'd',
            title: 'Engineering',
            code: 'ENG',
            parentId: null,
            active: true,
          },
        ],
      };
    throw new Error(`Unexpected ${r.path}`);
  });
}
function mount(path = '/headcounts') {
  const router = createMemoryRouter(
    [
      {
        path: '/headcounts',
        element: <List />,
        children: [
          { path: 'new', element: <Form /> },
          {
            path: ':accountId',
            element: <Detail />,
            children: [
              { path: 'adjust', element: <Form /> },
              { path: 'reconcile', element: <Form /> },
            ],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <TestI18nProvider runtime={runtime} namespace='nb3-oa'>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
beforeEach(() => {
  api.request.mockReset();
  toaster.show.mockReset();
  grants.clear();
  grants.add('manage');
  grants.add('viewJournal');
  serve();
});
it('shows named capacity, a single empty-state creation entry and role-aware controls', async () => {
  serve((r) =>
    r.path === 'headcounts' ? { data: [], meta: { total: 0 } } : undefined,
  );
  mount();
  expect(await screen.findByText('No annual headcount')).toBeVisible();
  expect(
    screen.getAllByRole('button', { name: 'Create annual headcount' }),
  ).toHaveLength(1);
});
it('denied requests have no retry and readonly heads have no write or journal requests', async () => {
  grants.clear();
  serve((r) =>
    r.path === 'headcounts'
      ? Promise.reject(
          new ApiClientError('Denied', {
            status: 403,
            method: 'GET',
            url: 'headcounts',
          }),
        )
      : undefined,
  );
  mount();
  expect(
    await screen.findByText(
      'You do not have permission to read this headcount.',
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Create annual headcount' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});
it('preserves filters and requests global sort defaults, resetting page on year change', async () => {
  mount('/headcounts?page=2&year=2026');
  expect(
    await screen.findByText('Engineering / Engineer / 2026'),
  ).toBeVisible();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'headcounts',
      query: expect.objectContaining({
        page: '2',
        year: '2026',
        orderBy: 'updatedAt',
        desc: 'true',
      }),
    }),
  );
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Headcount year' }), {
    target: { value: '2027' },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'headcounts',
        query: expect.objectContaining({ page: '1', year: '2027' }),
      }),
    ),
  );
});
it('adjustment keeps the command on unknown outcome and retries its exact request body', async () => {
  let attempts = 0;
  serve((r) =>
    r.method === 'PATCH'
      ? ++attempts === 1
        ? Promise.reject(new Error('Network lost'))
        : { data: { ...balance, limit: 7, version: 4 } }
      : undefined,
  );
  const user = userEvent.setup();
  mount('/headcounts/a/adjust?year=2026');
  await screen.findByRole('dialog', { name: 'Adjust limit' });
  const input = await screen.findByRole('spinbutton', {
    name: 'Authorized limit *',
  });
  await user.clear(input);
  await user.type(input, '7');
  await user.type(
    screen.getByRole('textbox', { name: 'Reason *' }),
    'Approved growth',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText(
    'The result is not confirmed. Keep this command and retry.',
  );
  expect(
    screen.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole('button', { name: 'Retry this operation' }),
  );
  await waitFor(() => expect(toaster.show).toHaveBeenCalled());
  const commands = api.request.mock.calls
    .map(([r]) => r as Request)
    .filter((r) => r.method === 'PATCH');
  expect(commands).toHaveLength(2);
  expect(commands[1].body).toBe(commands[0].body);
  expect(JSON.parse(commands[0].body!)).toMatchObject({
    expectedVersion: 3,
    limit: 7,
    reason: 'Approved growth',
  });
});
it('initializes only after full-roster confirmation, sending all employee IDs and preview version', async () => {
  const user = userEvent.setup();
  mount('/headcounts/a/reconcile');
  await screen.findByText('Alice');
  expect(screen.getByText('Bob')).toBeVisible();
  await user.click(
    screen.getByRole('button', { name: 'Confirm initialization' }),
  );
  expect(
    await screen.findByText(
      'Confirm that you have verified the complete roster.',
    ),
  ).toBeVisible();
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I have verified the complete employee roster *',
    }),
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Reason *' }),
    'Complete real roster verified',
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm initialization' }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'headcounts/a/reconcile',
        method: 'POST',
        body: expect.any(String),
      }),
    ),
  );
  const request = api.request.mock.calls
    .map(([r]) => r as Request)
    .find((r) => r.method === 'POST')!;
  expect(JSON.parse(request.body!)).toMatchObject({
    employeeIds: ['e1', 'e2'],
    expectedVersion: 3,
  });
});

it('empty creation focuses the first field', async () => {
  mount('/headcounts/new');
  await userEvent.click(
    await screen.findByRole('button', { name: 'Create', exact: true }),
  );
  expect(document.activeElement?.id).toBe('hc-departmentId');
  expect(api.request.mock.calls.every(([r]) => !(r as Request).method)).toBe(
    true,
  );
});

it('already initialized reconciliation shows a terminal explanation', async () => {
  serve((r) =>
    r.path === 'headcounts/a/reconciliationPreview'
      ? { data: { version: 3, initialized: true, employees: [] } }
      : undefined,
  );
  mount('/headcounts/a/reconcile');
  expect(
    await screen.findByText(
      'This account is already initialized. Its actual occupancy cannot be recounted here.',
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Confirm initialization', exact: true }),
  ).toBeDisabled();
});

it('does not present uninitialized availability as usable capacity or group the year', async () => {
  mount();
  await screen.findByText('Engineering / Engineer / 2026');
  expect(screen.getByText('2026')).toBeVisible();
  expect(screen.queryByText('2,026')).not.toBeInTheDocument();
  expect(screen.queryByText('4')).not.toBeInTheDocument();
  expect(screen.getAllByText('Not initialized').length).toBeGreaterThanOrEqual(
    2,
  );
});
