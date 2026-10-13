import Action from '../../../client/pages/vendor-qualifications/action-dialog.js';
import Detail from '../../../client/pages/vendor-qualifications/detail.js';
import { Missing } from '../../../client/pages/vendor-qualifications/missing.js';
import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import base from '../../../client/locales/en-US.js';
import copy from '../../../client/locales/modules/vendor-qualification.en-US.js';
import List from '../../../client/pages/vendor-qualifications/index.js';
import Form from '../../../client/pages/vendor-qualifications/form-page.js';
import AccountDialog, {
  PaymentAccountSection,
} from '../../../client/pages/vendor-qualifications/payment-account.js';
import type { QualificationRecord } from '../../../client/pages/vendor-qualifications/types.js';
const { api, permission, actor, toast, reload } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: {
    submit: true,
    view: true,
    paymentAccount: true,
    updatePaymentAccount: true,
    isPending: false,
    error: undefined as unknown,
  },
  actor: { id: 'owner' },
  toast: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: toast }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: actor.id } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: keyof typeof permission }) => ({
    can: permission[action],
    isPending: permission.isPending,
    error: permission.error,
  }),
}));
vi.mock(
  '../../../client/pages/vendor-qualifications/shared.js',
  async (original) => ({
    ...(await original<
      typeof import('../../../client/pages/vendor-qualifications/shared.js')
    >()),
    Choice: ({
      id,
      label,
      value,
      items,
      onChange,
      disabled,
    }: {
      id: string;
      label: string;
      value: string;
      items: { value: string; label: string }[];
      onChange: (value: string) => void;
      disabled: boolean;
    }) => (
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value='' />
        {items.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </select>
    ),
  }),
);
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...base, ...copy } },
});
const vendor = '11111111-1111-4111-8111-111111111111';
const options = {
  applicant: { id: 'owner', name: 'Owner' },
  timeZone: 'Asia/Shanghai',
  canCreateQualification: true,
  canCreateRemoval: false,
  vendors: [
    {
      id: vendor,
      name: 'Named supplier',
      category: 'services',
      status: 'manual',
      eligibleOperations: ['qualify'],
    },
  ],
  categories: [{ code: 'services', label: { 'en-US': 'Services' } }],
  committeeVersions: [],
  activeCommitteeVersion: 1,
};
const record = {
  id: 'request-1',
  operation: 'qualify',
  vendorId: vendor,
  name: 'Named supplier',
  category: 'services',
  reason: '',
  quoteCents: 0,
  cases: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  attachments: [],
  qualificationExpiry: null,
  applicantId: 'owner',
  createdById: 'owner',
  applicant: { id: 'owner', name: 'Owner' },
  createdBy: { id: 'owner', name: 'Owner' },
  number: 'SQ-1',
  status: 'draft',
  lifecycleVersion: 1,
  sourceVendorVersion: null,
  committeeVersion: null,
  committeeSnapshot: null,
  createdAt: '2026-10-10T17:00:00Z',
} satisfies QualificationRecord;
const detail = {
  record,
  view: { available: [{ name: 'edit', allowed: true }] },
  runs: [],
  actions: [],
  runActions: [],
  timeline: { runs: [] },
  upcoming: [],
  knownUsers: [],
  timeZone: 'Asia/Shanghai',
};
function show(element: React.ReactNode, path = '/source') {
  const router = createMemoryRouter(
    [
      {
        path: '/source',
        element: (
          <NavigationGuardProvider>
            <Outlet
              context={{ reload, detail, writable: true, reloadDetail: reload }}
            />
          </NavigationGuardProvider>
        ),
        children: [
          { index: true, element: <div>Original source</div> },
          { path: 'new', element },
          { path: ':requestId', element },
        ],
      },
      {
        path: '/vendorQualifications',
        element: <NavigationGuardProvider>{element}</NavigationGuardProvider>,
        children: [{ path: ':requestId', element: <div>Opened request</div> }],
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
  vi.clearAllMocks();
  localStorage.clear();
  actor.id = 'owner';
  Object.assign(permission, {
    submit: true,
    view: true,
    paymentAccount: true,
    updatePaymentAccount: true,
    isPending: false,
    error: undefined,
  });
});
afterEach(cleanup);
it('uses server total/page/timeZone, sends filters before paging and preserves source query', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path.endsWith('/options')
        ? { data: options }
        : {
            data: [record],
            meta: {
              total: 101,
              page: 3,
              pageSize: 20,
              timeZone: 'Asia/Shanghai',
            },
          },
    ),
  );
  const router = show(
    <List />,
    '/vendorQualifications?view=done&page=3&search=Named&status=draft',
  );
  const link = await screen.findByRole('link', { name: 'SQ-1' });
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'vendorQualifications',
      query: expect.objectContaining({
        view: 'done',
        page: '3',
        search: 'Named',
        status: 'draft',
      }),
    }),
  );
  expect(screen.getByText('Page 3 of 6')).toBeTruthy();
  expect(screen.getByText('Oct 11, 2026')).toBeTruthy();
  expect(link.getAttribute('href')).toContain(
    '?view=done&page=3&search=Named&status=draft',
  );
  fireEvent.click(link);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/vendorQualifications/request-1',
    ),
  );
});
it('places one create button inside a real empty state and hides it while permission is pending', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path.endsWith('/options')
        ? { data: options }
        : {
            data: [],
            meta: {
              total: 0,
              page: 1,
              pageSize: 20,
              timeZone: 'Asia/Shanghai',
            },
          },
    ),
  );
  show(<List />, '/vendorQualifications');
  await screen.findByText('No supplier requests');
  expect(
    screen.getAllByRole('button', { name: 'New application' }),
  ).toHaveLength(1);
  cleanup();
  permission.isPending = true;
  show(<List />, '/vendorQualifications');
  await screen.findByLabelText('Loading');
  expect(screen.queryByRole('button', { name: 'New application' })).toBeNull();
});
it('creates the exact public draft with durable key and no private bank fields', async () => {
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve(
        path.endsWith('/options')
          ? { data: options }
          : method === 'POST'
            ? { data: { record } }
            : { data: detail },
      ),
  );
  const router = show(<Form />, '/source/new?view=pending');
  await screen.findByRole('combobox', { name: 'Supplier' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Supplier' }), {
    target: { value: vendor },
  });
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Our supplier' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/source'));
  const post = api.request.mock.calls.find(
    ([call]) => call.method === 'POST',
  )?.[0];
  expect(post.json.requestId).toBeTruthy();
  expect(post.json.input).toEqual({
    operation: 'qualify',
    vendorId: vendor,
    name: 'Named supplier',
    category: 'services',
    reason: 'Our supplier',
    quoteCents: 0,
    cases: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    attachments: [],
    qualificationExpiry: null,
  });
  expect(post.json.input).not.toHaveProperty('bankAccount');
  expect(router.state.location.search).toBe('?view=pending');
});
it('persists unknown creation across remount and retries the same actor/key/body without editing', async () => {
  let posts = 0;
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (path.endsWith('/options')) return Promise.resolve({ data: options });
      if (method === 'POST' && posts++ === 0)
        return Promise.reject(
          new ApiClientError('Server error', {
            status: 500,
            method: 'POST',
            url: 'vendorQualifications',
          }),
        );
      return Promise.resolve({ data: method === 'POST' ? { record } : detail });
    },
  );
  let router = show(<Form />, '/source/new');
  await screen.findByRole('combobox', { name: 'Supplier' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Supplier' }), {
    target: { value: vendor },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByRole('button', { name: 'Retry original creation' });
  const original = api.request.mock.calls.find(
    ([call]) => call.method === 'POST',
  )?.[0].json;
  router.dispose();
  cleanup();
  router = show(<Form />, '/source/new');
  await screen.findByRole('button', { name: 'Retry original creation' });
  expect(screen.getByLabelText('Supplier name *')).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry original creation' }),
  );
  await waitFor(() => expect(posts).toBe(2));
  const bodies = api.request.mock.calls
    .filter(([call]) => call.method === 'POST')
    .map(([call]) => call.json);
  expect(bodies[1]).toEqual(original);
  expect(router.state.location.pathname).toBe('/source/new');
});
it('clears private output synchronously when viewer or either grant changes', async () => {
  api.request.mockResolvedValue({
    data: {
      account: {
        bankName: 'Secret bank',
        bankAccount: '12345',
        bankAccountName: 'Private owner',
        version: 4,
      },
      lifecycleVersion: 1,
    },
  });
  const ui = show(
    <PaymentAccountSection record={record} refreshKey={0} canWrite />,
    '/source/request-1',
  );
  await screen.findByText('12345');
  permission.view = false;
  actor.id = 'other';
  ui.navigate('/source/request-1?changed=1');
  await waitFor(() => expect(screen.queryByText('12345')).toBeNull());
  expect(screen.getByText('You cannot view banking information.')).toBeTruthy();
});
it('private PATCH uses actual bank/lifecycle versions and a separate audit reason', async () => {
  api.request.mockResolvedValue({
    data: {
      account: {
        bankName: 'Bank',
        bankAccount: '12345',
        bankAccountName: 'Owner',
        version: 4,
      },
      lifecycleVersion: 9,
    },
  });
  show(<AccountDialog />, '/source/request-1');
  await screen.findByDisplayValue('12345');
  fireEvent.change(screen.getByLabelText('Reason for change *'), {
    target: { value: 'Correct account' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        path: 'vendorQualifications/request-1/paymentAccount',
        json: {
          bankVersion: 4,
          lifecycleVersion: 9,
          reason: 'Correct account',
          account: {
            bankName: 'Bank',
            bankAccount: '12345',
            bankAccountName: 'Owner',
          },
        },
      }),
    ),
  );
});
it('never invents bank version zero or permits PATCH when the private row is absent', async () => {
  api.request.mockResolvedValue({
    data: { account: null, lifecycleVersion: 3 },
  });
  show(<AccountDialog />, '/source/request-1');
  await screen.findByText('Account record missing. Reload before editing.');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(api.request.mock.calls.some(([call]) => call.method === 'PATCH')).toBe(
    false,
  );
});
it('requires an explicit discard decision before closing a changed bank form', async () => {
  api.request.mockResolvedValue({
    data: {
      account: {
        bankName: 'Bank',
        bankAccount: '12345',
        bankAccountName: 'Owner',
        version: 4,
      },
      lifecycleVersion: 9,
    },
  });
  show(<AccountDialog />, '/source/request-1');
  await screen.findByDisplayValue('12345');
  fireEvent.change(screen.getByLabelText('Reason for change *'), {
    target: { value: 'Unsaved correction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await screen.findByRole('alertdialog');
  expect(
    screen.getByRole('heading', { name: 'Discard changes?' }),
  ).toBeTruthy();
  expect(api.request.mock.calls.some(([call]) => call.method === 'PATCH')).toBe(
    false,
  );
});

it('explains revoked detail view and hides old facts without an infinite skeleton', async () => {
  permission.view = false;
  api.request.mockResolvedValue({ data: detail });
  show(<Detail />, '/source/request-1');
  expect(
    await screen.findByText('Access unavailable. Contact an administrator.'),
  ).toBeVisible();
  expect(screen.queryByText('Reason')).toBeNull();
  expect(screen.queryByLabelText('Loading')).toBeNull();
});
it('preserves exact quote cents and rejects exponent, precision, negative and unsafe amounts', async () => {
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve({
        data:
          method === 'POST'
            ? { record }
            : path.endsWith('/options')
              ? options
              : detail,
      }),
  );
  show(<Form />, '/source/new');
  await screen.findByLabelText('Supplier *');
  fireEvent.change(screen.getByLabelText('Supplier *'), {
    target: { value: vendor },
  });
  const amount = screen.getByLabelText('Quote');
  expect(screen.getByText('CNY (yuan), up to 2 decimal places')).toBeVisible();
  for (const value of ['1e3', '-1', '1.001', '90071992547409.92']) {
    fireEvent.change(amount, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      api.request.mock.calls.filter(([v]) => v.method === 'POST'),
    ).toHaveLength(0);
  }
  fireEvent.change(amount, { target: { value: '0.29' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([v]) => v.method === 'POST' && v.json.input.quoteCents === 29,
      ),
    ).toBe(true),
  );
});
it('missing stacked record returns to its source with query, one persistent toast and two-frame focus', async () => {
  const focus = vi.fn();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  const router = createMemoryRouter(
    [
      {
        path: '/approvals/pending',
        element: (
          <NavigationGuardProvider>
            <Outlet />
          </NavigationGuardProvider>
        ),
        children: [
          { index: true, element: <div>Recovered source</div> },
          {
            path: 'vendorQualification/:requestId/action/:actionName/:targetId',
            element: (
              <Missing
                name='Named supplier'
                onMissing={reload}
                focusList={focus}
              />
            ),
          },
        ],
      },
    ],
    {
      initialEntries: [
        '/approvals/pending/vendorQualification/request-1/action/reject/task-1?search=Keep&page=3',
      ],
    },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  await screen.findByText('Recovered source');
  expect(router.state.location.pathname).toBe('/approvals/pending');
  expect(router.state.location.search).toBe('?search=Keep&page=3');
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Named supplier is unavailable. Returned to the source.',
    }),
  );
  expect(reload).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
  frames.shift()?.(0);
  expect(focus).not.toHaveBeenCalled();
  frames.shift()?.(0);
  expect(focus).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it('shows only real permission pending as loading, then explains a grant-check failure', async () => {
  permission.isPending = true;
  api.request.mockResolvedValue({ data: detail });
  const router = show(<Detail />, '/source/request-1');
  expect(
    screen.queryByText('Access unavailable. Contact an administrator.'),
  ).toBeNull();
  permission.isPending = false;
  permission.error = new Error('grant check failed');
  await router.navigate('/source/request-2');
  expect(
    await screen.findByText('Access unavailable. Contact an administrator.'),
  ).toBeVisible();
});

function nestedMissing(element: React.ReactNode, child: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/approvals/pending',
        element: (
          <NavigationGuardProvider>
            <Outlet
              context={{ detail, writable: true, reload, reloadDetail: reload }}
            />
          </NavigationGuardProvider>
        ),
        children: [
          { index: true, element: <div>Recovered source</div> },
          { path: child, element },
        ],
      },
    ],
    {
      initialEntries: [
        `/approvals/pending/${child.replace(':requestId', 'request-1').replace(':actionName', 'comment').replace(':targetId', 'task-1')}?search=Keep`,
      ],
    },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
it.each([
  'account-read',
  'account-write',
  'action-read',
  'form-write',
  'form-latest',
])(
  'recovers the source from a real nested %s 404 without a discard trap',
  async (mode) => {
    let reads = 0;
    api.request.mockImplementation(
      ({ path, method }: { path: string; method?: string }) => {
        const missing =
          (mode === 'account-read' && path.endsWith('/paymentAccount')) ||
          (mode === 'account-write' && method === 'PATCH') ||
          (mode === 'action-read' && !method) ||
          (mode === 'form-write' && method === 'POST') ||
          (mode === 'form-latest' &&
            !method &&
            !path.endsWith('/options') &&
            reads++ > 0);
        if (missing)
          return Promise.reject(
            new ApiClientError('Missing', {
              status: 404,
              method: method ?? 'GET',
              url: path,
            }),
          );
        if (mode === 'form-latest' && method === 'POST')
          return Promise.reject(
            new ApiClientError('Conflict', { status: 409, method, url: path }),
          );
        return Promise.resolve({
          data: path.endsWith('/options')
            ? options
            : path.endsWith('/paymentAccount')
              ? {
                  account: {
                    bankName: 'Old bank',
                    bankAccount: '12345',
                    bankAccountName: 'Owner',
                    version: 4,
                  },
                  lifecycleVersion: 9,
                }
              : detail,
        });
      },
    );
    const element = mode.startsWith('account') ? (
      <AccountDialog />
    ) : mode === 'action-read' ? (
      <Action />
    ) : (
      <Form />
    );
    const child = mode.startsWith('account')
      ? 'vendorQualification/:requestId/paymentAccount'
      : mode === 'action-read'
        ? 'vendorQualification/:requestId/action/:actionName/:targetId'
        : 'editVendorQualification/:requestId';
    const router = nestedMissing(element, child);
    if (mode === 'account-write') {
      const reason = await screen.findByLabelText('Reason for change *');
      fireEvent.change(reason, { target: { value: 'Changed bank' } });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    } else if (mode.startsWith('form-')) {
      await waitFor(() =>
        expect(document.getElementById('qualification-name')).toHaveValue(
          record.name,
        ),
      );
      fireEvent.change(screen.getByLabelText('Reason *'), {
        target: { value: 'Dirty proposal' },
      });
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save draft' }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    }
    await screen.findByText('Recovered source');
    expect(router.state.location.search).toBe('?search=Keep');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0 }),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  },
);

it('prepares private banking in a resumed new form and submits complete public facts separately', async () => {
  const complete = {
    ...record,
    reason: 'Our supplier',
    attachments: ['file-1'],
    qualificationExpiry: '2099-12-31',
  };
  localStorage.setItem(
    'oa:vendor-qualification:create:owner',
    JSON.stringify({
      actorId: 'owner',
      requestId: 'create-key',
      recordId: record.id,
      input: complete,
    }),
  );
  let bankVersion = 4;
  api.request.mockImplementation(
    async ({
      path,
      method,
      json,
    }: {
      path: string;
      method?: string;
      json?: Record<string, unknown>;
    }) => {
      if (path === 'vendorQualificationAttachments/findMany')
        return { data: [] };
      if (path.endsWith('/options')) return { data: options };
      if (path.endsWith('/paymentAccount')) {
        if (method === 'PATCH') {
          bankVersion += 1;
          return { data: {} };
        }
        return {
          data: {
            account: {
              bankName: '',
              bankAccount: '',
              bankAccountName: '',
              version: bankVersion,
            },
            lifecycleVersion: 1,
          },
        };
      }
      if (path.endsWith('/transition')) {
        expect(json).toMatchObject({ version: 1 });
        if (json?.name === 'edit') return { data: { record: complete } };
        return {
          data: {
            record: { ...record, status: 'review', lifecycleVersion: 2 },
          },
        };
      }
      if (method === 'POST')
        return { data: { record: { ...record, reason: 'Our supplier' } } };
      return { data: { ...detail, record: complete } };
    },
  );
  const router = show(<Form />, '/source/new');
  await screen.findByRole('combobox', { name: 'Supplier' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Supplier' }), {
    target: { value: vendor },
  });
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Our supplier' },
  });
  fireEvent.change(screen.getByLabelText('Bank'), {
    target: { value: 'Controlled bank' },
  });
  fireEvent.change(screen.getByLabelText('Account number'), {
    target: { value: 'Private123' },
  });
  fireEvent.change(screen.getByLabelText('Account holder'), {
    target: { value: 'Supplier' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/source'));
  const writes = api.request.mock.calls
    .map(([request]) => request)
    .filter(
      (request) =>
        request.path.startsWith('vendorQualifications') &&
        ['POST', 'PATCH'].includes(request.method),
    );
  expect(writes.map((request) => request.path)).toEqual([
    'vendorQualifications/request-1/transition',
    'vendorQualifications/request-1/paymentAccount',
    'vendorQualifications/request-1/transition',
  ]);
  expect(JSON.stringify(writes[0].json)).not.toContain('Private123');
  expect(writes[1].json).toMatchObject({
    bankVersion: 4,
    lifecycleVersion: 1,
    reason: 'Our supplier',
    account: { bankAccount: 'Private123' },
  });
  expect(JSON.stringify(sessionStorage)).not.toContain('Private123');
});

it('blocks incomplete qualification submission with field errors but still allows saving a draft', async () => {
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve({
        data: path.endsWith('/options')
          ? options
          : method === 'POST'
            ? { record }
            : detail,
      }),
  );
  show(<Form />, '/source/new');
  fireEvent.change(await screen.findByRole('combobox', { name: 'Supplier' }), {
    target: { value: vendor },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByText('Required')).toBeVisible();
  expect(
    screen.getByText(
      'Upload or select at least one qualification evidence file.',
    ),
  ).toBeVisible();
  expect(
    screen.getAllByText(
      'Select an expiry date later than today in the company time zone.',
    ),
  ).toHaveLength(2);
  expect(screen.getByLabelText('Reason *')).toHaveFocus();
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([call]) => call.method === 'POST'),
    ).toBe(true),
  );
});
it('rejects expiry on the company-local today even while the UTC date is yesterday', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(
    new Date('2026-10-13T17:00:00Z').getTime(),
  );
  // Intl receives the current Date, so mock only the constructor's no-argument case.
  const RealDate = Date;
  vi.stubGlobal(
    'Date',
    class extends RealDate {
      constructor(value?: string | number) {
        super(value ?? '2026-10-13T17:00:00Z');
      }
    },
  );
  const current = {
    ...record,
    reason: 'Qualification',
    attachments: ['file-1'],
    qualificationExpiry: '2026-10-14',
  };
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({
      data:
        path === 'vendorQualificationAttachments/findMany'
          ? []
          : path.endsWith('/options')
            ? options
            : path.endsWith('/paymentAccount')
              ? { account: null, lifecycleVersion: 1 }
              : { ...detail, record: current },
    }),
  );
  try {
    show(<Form />, '/source/request-1');
    await screen.findByDisplayValue('Qualification');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(
      screen.getAllByText(
        'Select an expiry date later than today in the company time zone.',
      ),
    ).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Reason *'), {
      target: { value: 'Qualification' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByLabelText('Qualification expiry *')).toHaveFocus();
    expect(
      api.request.mock.calls.some(
        ([call]) =>
          call.method === 'POST' &&
          call.path.startsWith('vendorQualifications'),
      ),
    ).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

it('lists remain readable when the viewer cannot create without an employee archive', async () => {
  actor.id = 'administrator';
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path.endsWith('/options')
        ? {
            data: {
              ...options,
              canCreateQualification: false,
              canCreateRemoval: false,
            },
          }
        : {
            data: [record],
            meta: {
              total: 1,
              page: 1,
              pageSize: 20,
              timeZone: 'Asia/Singapore',
            },
          },
    ),
  );
  show(<List />, '/vendorQualifications');
  expect(
    await screen.findByRole('link', { name: record.number! }),
  ).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('list loading errors do not instruct the viewer to complete application fields', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('/options')
      ? Promise.resolve({ data: options })
      : Promise.reject(
          new ApiClientError('Invalid query', {
            status: 400,
            method: 'GET',
            url: path,
          }),
        ),
  );
  show(<List />, '/vendorQualifications');
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(
    screen.queryByText(copy.vendorQualifications.errors.invalid),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
});
