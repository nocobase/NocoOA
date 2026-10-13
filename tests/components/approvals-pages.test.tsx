import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import ApprovalsPage from '../../client/pages/approvals/index.js';
import ApprovalList from '../../client/pages/approvals/list.js';
import LeaveDetail from '../../client/pages/approvals/detail.js';
import LeaveForm from '../../client/pages/approvals/form-page.js';
import ActionDialog from '../../client/pages/approvals/action-dialog.js';
const { api, toaster, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn() },
  permission: { can: true, only: null as string | null },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: (request: { resource: { id: string } }) => ({
    can:
      permission.can &&
      (!permission.only || request.resource.id === permission.only),
    isPending: false,
  }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({
    refresh: vi.fn(),
    session: { user: { id: 'alice' } },
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const chineseRuntime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: zhCN },
  locale: 'zh-CN',
});
function I18n({ children }: { children: ReactNode }) {
  return <TestI18nProvider runtime={runtime}>{children}</TestI18nProvider>;
}
const record = {
  id: 'l1',
  applicantId: 'alice',
  applicant: { id: 'alice', name: 'Alice' },
  createdById: 'alice',
  number: 'LEA-1',
  leaveType: 'personal',
  startDate: '2026-10-12',
  endDate: '2026-10-12',
  startHalf: 'am',
  endHalf: 'pm',
  days: 1,
  reason: 'Family appointment',
  attachments: [],
  handoverUserId: null,
  enableDelegation: false,
  status: 'draft',
  lifecycleVersion: 3,
  createdAt: '2026-10-10T10:00:00Z',
};
const detail = () => ({
  record: { ...record },
  users: [{ id: 'alice', name: 'Alice' }],
  view: {
    record,
    state: 'draft',
    version: 3,
    available: [
      {
        name: 'edit',
        allowed: true,
        blockers: [],
        to: ['draft'],
        title: 'Edit',
      },
      {
        name: 'submit',
        allowed: true,
        blockers: [],
        to: ['manager'],
        title: 'Submit',
      },
    ],
    history: { transitions: [], effectRuns: [] },
  },
  runs: [],
  taskActions: [],
  runActions: [],
  upcoming: [],
  timeline: { runs: [] },
});
const options = {
  leaveTypes: [
    {
      code: 'personal',
      label: { 'en-US': 'Personal leave' },
      active: true,
      extra: {},
    },
  ],
  balanceAvailable: false,
  timeZone: 'Asia/Shanghai',
};
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, string>;
};
function serve(
  handler: (request: Request) => unknown,
  optionData: unknown = options,
) {
  api.request.mockImplementation((request: Request) => {
    try {
      if (request.path === 'approvalCenter/batchApproveOptions')
        return Promise.resolve({ data: [] });
      if (request.path === 'approvalCenter') {
        const result = handler({ ...request, path: 'leaveRequests' }) as {
          data: (typeof record)[];
        };
        const rows = result.data.map((r) => ({
          ...r,
          kind: 'oa.leave',
          amount: r.days,
          unit: 'days',
        }));
        return Promise.resolve({
          data: rows,
          meta: {
            total: rows.length,
            page: 1,
            pageSize: 20,
            kinds: ['oa.leave'],
          },
        });
      }
      if (request.path === 'users')
        return Promise.resolve({
          data: [],
          meta: { total: 0, page: 1, pageSize: 20 },
        });
      if (request.path === 'leaveRequests/options')
        return Promise.resolve({ data: optionData });
      if (request.path === 'leaveRequests/preview')
        return Promise.resolve({
          data: {
            days: 1,
            route: { mode: 'stages', steps: [], problems: [], notes: [] },
          },
        });
      return Promise.resolve(handler(request));
    } catch (e) {
      return Promise.reject(e);
    }
  });
}
function error(status: number) {
  return new ApiClientError('private failure', {
    status,
    method: 'GET',
    url: '/api/leaveRequests',
  } as ConstructorParameters<typeof ApiClientError>[1]);
}
function open(path: string, locale = 'en-US') {
  const routes = [
    {
      path: '/approvals',
      element: (
        <NavigationGuardProvider>
          <ApprovalsPage />
        </NavigationGuardProvider>
      ),
      children: ['todo', 'done', 'copied', 'mine'].map((tab) => ({
        path: tab,
        element: <ApprovalList />,
        children: [
          { path: 'newLeave', element: <LeaveForm /> },
          { path: 'editLeave/:requestId', element: <LeaveForm /> },
          {
            path: 'leave/:requestId',
            element: <LeaveDetail />,
            children: [
              { path: 'edit', element: <LeaveForm /> },
              {
                path: 'action/:actionName/:targetId',
                element: <ActionDialog />,
              },
            ],
          },
        ],
      })),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />, {
    wrapper:
      locale === 'zh-CN'
        ? ({ children }) => (
            <TestI18nProvider runtime={chineseRuntime}>
              {children}
            </TestI18nProvider>
          )
        : I18n,
  });
  return router;
}
beforeEach(() => {
  // LAN HTTP origins expose getRandomValues but not randomUUID.
  vi.stubGlobal('crypto', {
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  });
  api.request.mockReset();
  toaster.show.mockReset();
  permission.can = true;
  permission.only = null;
});
afterEach(() => vi.unstubAllGlobals());
describe('approval center', () => {
  it('clears sorting by the removed period column while preserving other query options', async () => {
    permission.can = false;
    serve(() => ({ data: [record] }));
    const router = open(
      '/approvals/todo?orderBy=startDate&direction=asc&kind=oa.leave&page=3',
    );
    await screen.findByRole('link', { name: 'LEA-1' });
    await waitFor(() => {
      const query = new URLSearchParams(router.state.location.search);
      expect(query.has('orderBy')).toBe(false);
      expect(query.has('page')).toBe(false);
      expect(query.get('direction')).toBe('asc');
      expect(query.get('kind')).toBe('oa.leave');
    });
    for (const [request] of api.request.mock.calls) {
      if (request.path === 'approvalCenter')
        expect(request.query.orderBy).toBe('createdAt');
    }
  });
  it.each(['todo', 'done', 'copied', 'mine'])(
    'removes the retired status filter from the %s tab and bookmarked queries',
    async (tab) => {
      permission.can = false;
      serve(() => ({ data: [record] }));
      const router = open(
        `/approvals/${tab}?status=manager&kind=oa.leave&q=Alice&page=3&pageSize=10`,
      );
      await screen.findByRole('link', { name: 'LEA-1' });
      await waitFor(() => {
        const query = new URLSearchParams(router.state.location.search);
        expect(query.has('status')).toBe(false);
        expect(query.has('page')).toBe(false);
        expect(query.get('kind')).toBe('oa.leave');
        expect(query.get('q')).toBe('Alice');
        expect(query.get('pageSize')).toBe('10');
      });
      expect(
        screen.queryByRole('combobox', { name: enUS.approvals.status }),
      ).toBeNull();
      expect(
        screen.getByRole('combobox', { name: enUS.approvalCenter.kind }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('columnheader', { name: enUS.approvals.status }),
      ).toBeInTheDocument();
      const initiator = screen.queryByRole('columnheader', {
        name: enUS.approvalCenter.initiator,
      });
      if (tab === 'mine') expect(initiator).toBeNull();
      else expect(initiator).toBeInTheDocument();
      for (const [request] of api.request.mock.calls) {
        if (request.path === 'approvalCenter')
          expect(request.query).not.toHaveProperty('status');
      }
    },
  );
  it.each([
    ['en-US', enUS],
    ['zh-CN', zhCN],
  ] as const)(
    'uses business-neutral headers for mixed pending tasks in %s',
    async (locale, copy) => {
      permission.can = false;
      api.request.mockResolvedValue({
        data: [
          {
            ...record,
            kind: 'oa.leave',
            status: 'manager',
            amount: 1,
            unit: 'days',
          },
          {
            ...record,
            id: 'r1',
            number: 'REI-1',
            kind: 'oa.reimbursement',
            status: 'manager',
            startDate: null,
            endDate: null,
            amount: 10000,
            unit: 'cents',
          },
        ],
        meta: {
          total: 2,
          page: 1,
          pageSize: 20,
          kinds: ['oa.leave', 'oa.reimbursement'],
        },
      });
      open('/approvals/todo', locale);
      const reimbursement = await screen.findByRole('link', { name: 'REI-1' });
      expect(reimbursement).toHaveAttribute(
        'href',
        '/approvals/todo/reimbursement/r1',
      );
      expect(screen.getByRole('link', { name: 'LEA-1' })).toHaveAttribute(
        'href',
        '/approvals/todo/leave/l1',
      );
      expect(
        screen.getByRole('columnheader', {
          name: copy.approvalCenter.reference,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('columnheader', { name: copy.approvalCenter.kind }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('columnheader', { name: copy.approvals.type }),
      ).toBeNull();
      expect(screen.getAllByRole('columnheader')).toHaveLength(7);
      expect(
        screen.queryByRole('columnheader', {
          name: new RegExp(copy.approvalCenter.period),
        }),
      ).toBeNull();
      expect(
        screen.queryByRole('columnheader', {
          name: copy.approvalCenter.amount,
        }),
      ).toBeNull();
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'approvalCenter',
          query: expect.objectContaining({ view: 'pending' }),
        }),
      );
      expect(api.request.mock.calls[0][0].query).not.toHaveProperty('kind');
    },
  );
  it.each(['todo', 'done', 'copied', 'mine'])(
    'opens request picker from the %s toolbar and closes before navigating',
    async (tab) => {
      serve((r) =>
        r.path === 'leaveRequests' ? { data: [] } : { data: detail() },
      );
      const router = open(`/approvals/${tab}?kind=oa.leave`);
      const trigger = await screen.findByRole('button', {
        name: enUS.approvalCenter.newRequest,
      });
      expect(
        screen.getAllByRole('button', { name: enUS.approvalCenter.newRequest }),
      ).toHaveLength(1);
      await userEvent.click(trigger);
      const picker = await screen.findByRole('dialog', {
        name: enUS.approvalCenter.newRequest,
      });
      const leave = within(picker).getByRole('button', {
        name: enUS.approvalCenter.kinds.leave,
        exact: true,
      });
      expect(leave).toHaveAttribute(
        'href',
        `/approvals/${tab}/newLeave?kind=oa.leave`,
      );
      expect(
        within(picker).queryByText(enUS.approvals.newLeave),
      ).not.toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', {
            name: enUS.approvalCenter.newRequest,
          }),
        ).toBeNull(),
      );
      expect(trigger).toHaveFocus();
      await userEvent.click(trigger);
      await userEvent.click(
        await screen.findByRole('button', {
          name: enUS.approvalCenter.kinds.leave,
          exact: true,
        }),
      );
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(
          `/approvals/${tab}/newLeave`,
        ),
      );
      expect(router.state.location.search).toBe('?kind=oa.leave');
      expect(
        screen.queryByRole('dialog', { name: enUS.approvalCenter.newRequest }),
      ).toBeNull();
    },
  );
  it('offers a picker for payment-only users and omits other requests', async () => {
    permission.only = 'oa.payment';
    serve(() => ({ data: [] }));
    open('/approvals/mine');
    await userEvent.click(
      await screen.findByRole('button', {
        name: enUS.approvalCenter.newRequest,
      }),
    );
    const picker = await screen.findByRole('dialog', {
      name: enUS.approvalCenter.newRequest,
    });
    expect(
      within(picker).getByRole('button', {
        name: enUS.approvalCenter.kinds.payment,
        exact: true,
      }),
    ).toHaveAttribute('href', '/approvals/mine/newPayment');
    expect(
      within(picker).queryByRole('button', {
        name: enUS.approvalCenter.kinds.leave,
        exact: true,
      }),
    ).toBeNull();
  });
  it('hides the request picker when no creation permissions are granted', async () => {
    permission.can = false;
    serve(() => ({ data: [] }));
    open('/approvals/mine');
    await screen.findByText(enUS.approvals.emptyMineTitle);
    expect(
      screen.queryByRole('button', { name: enUS.approvalCenter.newRequest }),
    ).toBeNull();
  });

  it('confirms submission over HTTP, shows failures and reuses the request id on retry', async () => {
    let attempts = 0;
    serve((r) => {
      if (r.path === 'leaveRequests') return { data: [record] };
      if (r.method === 'POST') {
        if (++attempts === 1) throw error(500);
        return { data: { record: { ...record, status: 'manager' } } };
      }
      return { data: detail() };
    });
    open('/approvals/mine/leave/l1');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Submit' }),
    );
    const confirmation = await screen.findByRole('alertdialog');
    expect(
      api.request.mock.calls.filter(
        ([r]) =>
          r.method === 'POST' &&
          r.path !== 'approvalCenter/batchApproveOptions',
      ),
    ).toHaveLength(0);
    await userEvent.click(
      within(confirmation).getByRole('button', { name: 'Submit' }),
    );
    expect(
      await within(confirmation).findByText(enUS.approvals.error.failed),
    ).toBeInTheDocument();
    await userEvent.click(
      within(confirmation).getByRole('button', { name: 'Submit' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const writes = api.request.mock.calls.filter(
      ([r]) =>
        r.method === 'POST' && r.path !== 'approvalCenter/batchApproveOptions',
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]![0].json).toMatchObject({
      transition: 'submit',
      version: 3,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
    });
    expect(writes[1]![0].json.requestId).toBe(writes[0]![0].json.requestId);
    expect(toaster.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });
  it('redirects only bare center and retains query', async () => {
    serve(() => ({ data: [] }));
    const router = open('/approvals?q=Alice');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/approvals/todo'),
    );
    expect(router.state.location.search).toBe('?q=Alice');
    expect(await screen.findByText('No matching records')).toBeInTheDocument();
  });
  it('shows resolved applicant and opens detail over the same filtered tab', async () => {
    serve((r) =>
      r.path === 'leaveRequests' ? { data: [record] } : { data: detail() },
    );
    const router = open('/approvals/mine?kind=oa.leave');
    await userEvent.click(await screen.findByRole('link', { name: /LEA-1/ }));
    expect(router.state.location.pathname).toBe('/approvals/mine/leave/l1');
    expect(router.state.location.search).toBe('?kind=oa.leave');
    expect(await screen.findByText('Family appointment')).toBeInTheDocument();
  });
  it('has a single create action in empty state and hides it without permission', async () => {
    permission.can = false;
    serve(() => ({ data: [] }));
    open('/approvals/todo');
    expect(await screen.findByText('No pending approvals')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'New leave request' }),
    ).toBeNull();
  });
  it('clears previously authorized detail and write controls on refreshed 403', async () => {
    let refused = false;
    serve((r) => {
      if (r.path === 'leaveRequests') return { data: [record] };
      if (refused) throw error(403);
      return { data: detail() };
    });
    open('/approvals/mine/leave/l1');
    expect(await screen.findByText('Family appointment')).toBeInTheDocument();
    refused = true;
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!,
    );
    expect(
      await screen.findByText('Access denied. Contact an administrator.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Family appointment')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });
  it('does not retain first record facts while a different record loads', async () => {
    serve((r) =>
      r.path === 'leaveRequests'
        ? { data: [record] }
        : r.path.endsWith('l1')
          ? { data: detail() }
          : new Promise(() => {}),
    );
    const router = open('/approvals/mine/leave/l1');
    await screen.findByText('Family appointment');
    await router.navigate('/approvals/mine/leave/l2');
    await waitFor(() =>
      expect(screen.queryByText('Family appointment')).toBeNull(),
    );
  });
});
describe('leave editing', () => {
  it('validates only submit and preserves the page on missing fields', async () => {
    serve((r) =>
      r.path === 'leaveRequests'
        ? { data: [] }
        : r.path === 'leaveRequests/options'
          ? { data: options }
          : { data: [] },
    );
    open('/approvals/mine/newLeave');
    await screen.findByRole('button', { name: 'Save draft' });
    expect(screen.queryByText('Enter a value.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findAllByText('Enter a value.')).not.toHaveLength(0);
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: 'leaveRequests' }),
    );
    expect(
      screen.getByText(enUS.approvals.attachmentLimit),
    ).toBeInTheDocument();
  });
  it('reads latest edit and sends its version with no fake attachments', async () => {
    serve((r) =>
      r.path === 'leaveRequests'
        ? { data: [record] }
        : r.path === 'leaveRequests/options'
          ? { data: options }
          : r.method === 'POST'
            ? { data: { record: { ...record, reason: 'Updated' } } }
            : { data: detail() },
    );
    const router = open('/approvals/mine/editLeave/l1');
    const field = await screen.findByLabelText(/Reason/);
    await userEvent.clear(field);
    await userEvent.type(field, 'Updated');
    await userEvent.click(
      screen.getByRole('button', { name: enUS.approvals.saveDraft }),
    );
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'leaveRequests/l1/transition',
          json: expect.objectContaining({
            transition: 'edit',
            version: 3,
            input: expect.objectContaining({
              reason: 'Updated',
              attachments: [],
            }) as unknown,
          }) as unknown,
        }),
      ),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/approvals/mine/leave/l1'),
    );
    const writes = api.request.mock.calls
      .map(([request]) => request as Request)
      .filter((request) => request.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0].json?.transition).toBe('edit');
  });
});
describe('approval action dialog', () => {
  function offeredDetail() {
    return {
      ...detail(),
      record: { ...record, status: 'manager' },
      view: { ...detail().view, available: [] },
      runActions: [
        {
          run: { id: 'run-1', contentHash: 'reviewed-hash' },
          onBehalfOf: null,
          actions: [
            {
              name: 'approve',
              options: {},
              batch: false,
              contentHash: true,
              tone: 'primary',
              primary: true,
            },
            {
              name: 'reject',
              options: { reasonRequired: true },
              batch: false,
              contentHash: true,
              tone: 'danger',
              primary: false,
            },
          ],
        },
      ],
    };
  }
  it('posts the reviewed hash and target, then reloads and returns to the same detail', async () => {
    let detailReads = 0;
    serve((r) => {
      if (r.path === 'leaveRequests') return { data: [record] };
      if (r.method === 'POST') return { data: { outcome: 'approved' } };
      detailReads += 1;
      return {
        data: {
          ...offeredDetail(),
          record: {
            ...offeredDetail().record,
            reason:
              detailReads === 1
                ? 'Family appointment'
                : 'Fresh reason for this decision',
          },
        },
      };
    });
    const router = open('/approvals/done/leave/l1?q=Alice');
    await screen.findByText('Family appointment');
    await router.navigate(
      '/approvals/done/leave/l1/action/approve/run-1?q=Alice',
    );
    const dialog = await screen.findByRole('dialog', { name: /^Approve/ });
    expect(dialog).toHaveAttribute('data-presentation', 'drawer');
    expect(
      await within(dialog).findByText('Fresh reason for this decision'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Family appointment')).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Comment'), 'Reviewed');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve' }),
    );
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'leaveRequests/l1/action',
          json: expect.objectContaining({
            action: 'approve',
            target: { runId: 'run-1' },
            contentHash: 'reviewed-hash',
            comment: 'Reviewed',
            requestId: expect.any(String) as unknown,
          }) as unknown,
        }),
      ),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/approvals/done/leave/l1'),
    );
    expect(router.state.location.search).toBe('?q=Alice');
  });
  it('requires a rejection reason and validates as it changes after first failure', async () => {
    serve((r) =>
      r.path === 'leaveRequests'
        ? { data: [record] }
        : { data: offeredDetail() },
    );
    open('/approvals/todo/leave/l1/action/reject/run-1');
    const dialog = await screen.findByRole('dialog', { name: /^Reject/ });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject' }),
    );
    expect(
      await within(dialog).findByText('Enter a value.'),
    ).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/),
      'Incorrect dates',
    );
    await waitFor(() =>
      expect(within(dialog).queryByText('Enter a value.')).toBeNull(),
    );
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'leaveRequests/l1/action',
      }),
    );
  });
  it('disables balance-backed submission before posting', async () => {
    const annual = { ...record, leaveType: 'annual' };
    serve((r) =>
      r.path === 'leaveRequests'
        ? { data: [annual] }
        : { data: { ...detail(), record: annual } },
    );
    open('/approvals/mine/leave/l1');
    expect(
      await screen.findByRole('button', { name: 'Submit' }),
    ).toBeDisabled();
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'leaveRequests/l1/transition',
      }),
    );
  });
  it('allows balance-backed submission when the ledger is available', async () => {
    const annual = { ...record, leaveType: 'annual' };
    serve(
      (r) =>
        r.path === 'leaveRequests'
          ? { data: [annual] }
          : { data: { ...detail(), record: annual } },
      { ...options, balanceAvailable: true },
    );
    open('/approvals/mine/leave/l1');
    expect(await screen.findByRole('button', { name: 'Submit' })).toBeEnabled();
    expect(
      screen.queryByText(enUS.approvals.balanceLimit),
    ).not.toBeInTheDocument();
  });
  it('requires discard confirmation before replacing conflicting edits with latest values', async () => {
    let latest = false;
    serve((r) => {
      if (r.path === 'leaveRequests') return { data: [record] };
      if (r.method === 'POST') {
        latest = true;
        throw error(409);
      }
      return {
        data: {
          ...detail(),
          record: {
            ...record,
            lifecycleVersion: latest ? 4 : 3,
            reason: latest ? 'Other writer' : 'Family appointment',
          },
        },
      };
    });
    open('/approvals/mine/editLeave/l1');
    const reason = await screen.findByLabelText(/Reason/);
    await userEvent.clear(reason);
    await userEvent.type(reason, 'My edit');
    await userEvent.click(
      screen.getByRole('button', { name: enUS.approvals.saveDraft }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Load latest' }),
    );
    expect(reason).toHaveValue('My edit');
    const confirmation = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(confirmation).getByRole('button', { name: 'Load latest' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/Reason/)).toHaveValue('Other writer'),
    );
  });
  it('reports a completed decision separately from a failed refresh and prevents another write', async () => {
    let posted = false;
    serve((r) => {
      if (r.path === 'leaveRequests') return { data: [record] };
      if (r.method === 'POST') {
        posted = true;
        return { data: {} };
      }
      if (posted) throw error(500);
      return { data: offeredDetail() };
    });
    open('/approvals/todo/leave/l1/action/approve/run-1');
    const dialog = await screen.findByRole('dialog', { name: /^Approve/ });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve' }),
    );
    expect(
      await screen.findByText(enUS.approvals.refreshAfterSuccess),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Approve' }),
    ).toBeDisabled();
    expect(
      api.request.mock.calls.filter(
        ([r]) =>
          r.method === 'POST' &&
          r.path !== 'approvalCenter/batchApproveOptions',
      ),
    ).toHaveLength(1);
  });
  it('disables dictionary-defined attachment requirements', async () => {
    const custom = { ...record, leaveType: 'medicalSupport' };
    serve(
      (r) =>
        r.path === 'leaveRequests'
          ? { data: [custom] }
          : { data: { ...detail(), record: custom } },
      {
        ...options,
        leaveTypes: [
          {
            code: 'medicalSupport',
            active: true,
            label: { 'en-US': 'Medical support' },
            extra: { requiresAttachment: true, attachmentAboveDays: 0.5 },
          },
        ],
      },
    );
    open('/approvals/mine/leave/l1');
    await screen.findAllByText('Medical support');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });
});
it('shows the budget approval stage using only the common columns', async () => {
  api.request.mockResolvedValue({
    data: [
      {
        id: 'budget-max',
        kind: 'oa.budgetAdjustment',
        number: 'BUD-1',
        applicantId: 'alice',
        applicant: { id: 'alice', name: 'Alice' },
        status: 'finance',
        createdAt: '2026-10-11T00:00:00Z',
        startDate: null,
        endDate: null,
        amount: Number.MAX_SAFE_INTEGER,
        unit: 'cents',
      },
    ],
    meta: { total: 1, page: 1, pageSize: 20, kinds: ['oa.budgetAdjustment'] },
  });
  open('/approvals/todo');
  expect(
    await screen.findByRole('link', { name: 'BUD-1' }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(enUS.budgetAdjustments.stages.finance),
  ).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  expect(screen.queryByText('90071992547409.91 yuan')).toBeNull();
});
