import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import NodeSettingsDialog from '../../client/pages/process-management/node-settings-dialog.js';
import type { DefinitionDto } from '../../server/routes/process-management/schemas.js';
import {
  nodeRuleBindings,
  flowsUsingRule,
} from '../../client/pages/process-management/node-settings.js';
const { api, toast, grants, identity, reload } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
  reload: vi.fn(),
  grants: { read: true, update: true, manage: true },
  identity: { id: 'administrator', revision: 1 },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: toast }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => identity.revision,
  useCan: ({ action }: { action: keyof typeof grants }) => ({
    can: grants[action],
    isPending: false,
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const rule = (key: string, type: string, value: number) => ({
  key,
  type,
  domain: 'leave',
  area: 'rules',
  allowFuture: true,
  defaultValue: value,
  min: 0,
  current: null,
  scheduled: [],
});
const rules = [
  rule('leave.head', 'days', 3),
  rule('leave.hr', 'days', 7),
  rule('spend.vp', 'money', 50000),
  rule('spend.gm', 'money', 200000),
  rule('raise.vp', 'ratio', 0.2),
  rule('raise.gm', 'ratio', 0.3),
  rule('grade.managerRank', 'rank', 5),
  rule('grade.directorRank', 'rank', 7),
];
const config = {
  activeCommitteeVersion: 1,
  versions: [1, 2].map((version) => ({
    version,
    min: 2,
    settle: 'veto',
    seats: [
      { key: 'purchase', source: 'purchasing', veto: false },
      { key: 'finance', source: 'finance', veto: true },
      { key: 'head', source: 'applicantHead', veto: false },
    ],
  })),
  assignments: [
    [{ committeeVersion: 1, seatKey: 'purchase', personId: 'p1', version: 6 }],
    [{ committeeVersion: 2, seatKey: 'purchase', personId: 'p2', version: 9 }],
  ],
  removalHead: { personId: 'p1', version: 3 },
  knownUsers: [
    { id: 'p1', name: 'Version one purchaser' },
    { id: 'p2', name: 'Version two purchaser' },
  ],
};
function show(kind = 'oa.leave', node = 'manager') {
  const definition = {
    states: [{ name: node, final: false }],
  } as DefinitionDto;
  const router = createMemoryRouter(
    [
      {
        path: '/definitions/:kind',
        element: <Outlet context={{ definition, reload }} />,
        children: [
          { path: 'nodes/:node/settings', element: <NodeSettingsDialog /> },
        ],
      },
    ],
    {
      initialEntries: [
        `/definitions/${kind}/nodes/${node}/settings?search=keep#diagram`,
      ],
    },
  );
  const ui = (
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>
  );
  const view = render(ui);
  return { router, rerender: () => view.rerender(ui) };
}
beforeEach(() => {
  vi.clearAllMocks();
  grants.read = grants.update = grants.manage = true;
  identity.id = 'administrator';
  identity.revision = 1;
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve({
        data: method
          ? {}
          : path.endsWith('candidates')
            ? { people: config.knownUsers, nextOffset: null }
            : path === 'approvalRules'
              ? rules
              : config,
      }),
  );
});
afterEach(cleanup);
async function choose(name: string) {
  await userEvent.click(
    await screen.findByRole('combobox', { name: 'Parameter' }),
  );
  await userEvent.click(await screen.findByRole('option', { name }));
}
it('validates a node rule, saves through the existing service and preserves the parent URL', async () => {
  const { router } = show();
  const input = await screen.findByLabelText(/New value/);
  expect(input).toHaveValue('3');
  expect(screen.getByRole('dialog')).toHaveAttribute(
    'data-presentation',
    'dialog',
  );
  await userEvent.clear(input);
  await userEvent.type(input, '2.3');
  await userEvent.click(
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((element) => element.hasAttribute('form'))!,
  );
  expect(
    await screen.findByText(enUS.platform.rules.errors.halfDays),
  ).toBeVisible();
  await userEvent.clear(input);
  await userEvent.type(input, '2.5');
  await userEvent.click(
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((element) => element.hasAttribute('form'))!,
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/definitions/oa.leave'),
  );
  expect(router.state.location.search).toBe('?search=keep');
  expect(router.state.location.hash).toBe('#diagram');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'approvalRules/leave.head/versions',
      method: 'POST',
      json: { value: 2.5, effectiveFrom: undefined, note: null },
    }),
  );
  expect(reload).toHaveBeenCalledOnce();
});
it('retains drafts when switching between node parameters', async () => {
  show();
  const input = await screen.findByLabelText(/New value/);
  await userEvent.clear(input);
  await userEvent.type(input, '4.5');
  await choose(enUS.platform.rules.keys.leave_hr.label);
  expect(
    screen.getAllByLabelText(/New value/).find((el) => !el.closest('[hidden]')),
  ).toHaveValue('7');
  await choose(enUS.platform.rules.keys.leave_head.label);
  expect(input).toBeVisible();
  expect(input).toHaveValue('4.5');
});
it('shows shared impact and preserves input after a failed save', async () => {
  show('oa.reimbursement', 'finance');
  const input = await screen.findByLabelText(/New value/);
  expect(screen.getByText(/Shared setting/)).toHaveTextContent('Purchase');
  expect(screen.getByText(/Shared setting/)).toHaveTextContent('Contract');
  api.request.mockRejectedValueOnce(
    new ApiClientError('private details', {
      status: 403,
      method: 'POST',
      url: '/rules',
    }),
  );
  await userEvent.clear(input);
  await userEvent.type(input, '60000');
  await userEvent.click(
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((element) => element.hasAttribute('form'))!,
  );
  expect(await screen.findByRole('alert')).not.toHaveTextContent(
    'private details',
  );
  expect(input).toHaveValue('60000');
  expect(reload).not.toHaveBeenCalled();
});
it('converts displayed percentage to a ratio and prevents duplicate submit or dismissal while saving', async () => {
  const { router } = show('oa.transfer', 'hr');
  const input = await screen.findByLabelText(/New value/);
  expect(input).toHaveValue('20');
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.clear(input);
  await userEvent.type(input, '25');
  const button = screen
    .getAllByRole('button', { name: 'Save', exact: true })
    .find((element) => element.hasAttribute('form'))!;
  await userEvent.click(button);
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(input).toBeDisabled();
  expect(screen.getByRole('combobox')).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(router.state.location.pathname).toContain('/settings');
  fireEvent.submit(input.closest('form')!);
  expect(
    api.request.mock.calls.filter(([r]) => r.method === 'POST'),
  ).toHaveLength(1);
  await act(async () => finish({ data: {} }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/definitions/oa.transfer'),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      json: { value: 0.25, effectiveFrom: undefined, note: null },
    }),
  );
});
it.each(['read', 'update'] as const)(
  'does not expose an editor without independent rule %s permission',
  async (action) => {
    grants[action] = false;
    show();
    expect(
      await screen.findByText(enUS.processManagement.nodeSettings.forbidden),
    ).toBeVisible();
    expect(screen.queryByLabelText(/New value/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Save', exact: true }),
    ).toBeNull();
    if (action === 'read') expect(api.request).not.toHaveBeenCalled();
  },
);
it('rejects unbound nodes without fetching settings', async () => {
  show('oa.leave', 'approved');
  expect(
    await screen.findByText(enUS.processManagement.nodeSettings.unavailable),
  ).toBeVisible();
  expect(api.request).not.toHaveBeenCalled();
});
it('edits the selected committee version’s seat rather than the latest version', async () => {
  show('oa.vendorQualification', 'committee_v1');
  await screen.findByLabelText(/committee|New version/i).catch(() => undefined);
  await choose('Version 1 · purchase seat person');
  expect(await screen.findByText('Version one purchaser')).toBeVisible();
  const reason = screen
    .getAllByLabelText(/Reason/)
    .find((element) => !element.closest('[hidden]'))!;
  await userEvent.type(reason, 'Synthetic configuration change');
  await userEvent.click(
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((element) => element.hasAttribute('form'))!,
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'vendorQualifications/configuration/assignments',
        method: 'PATCH',
        json: {
          committeeVersion: 1,
          seatKey: 'purchase',
          personId: 'p1',
          expectedVersion: 6,
          reason: 'Synthetic configuration change',
        },
      }),
    ),
  );
});
it('keeps the diagram threshold registry limited to actual supported settings', () => {
  const keys = new Set(
    Object.values(nodeRuleBindings).flatMap((nodes) =>
      Object.values(nodes).flat(),
    ),
  );
  expect(keys.size).toBe(16);
  expect(keys.has('loan.head')).toBe(false);
  expect(keys.has('committee.min')).toBe(false);
  expect([...keys].some((key) => key.startsWith('sla.'))).toBe(false);
  expect(flowsUsingRule('spend.vp')).toContain('oa.contract');
});
it('allows correcting vendor validation errors and closes after a successful save', async () => {
  const { router } = show('oa.vendorQualification', 'committee_v1');
  await choose('Version 1 · purchase seat person');
  const reason = screen
    .getAllByLabelText(/Reason/)
    .find((el) => !el.closest('[hidden]'))!;
  await userEvent.type(reason, 'First draft');
  api.request.mockRejectedValueOnce(
    new ApiClientError('invalid', {
      status: 400,
      method: 'PATCH',
      url: '/configuration',
    }),
  );
  const save = () =>
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((el) => el.hasAttribute('form'))!;
  await userEvent.click(save());
  await screen.findByRole('alert');
  expect(reason).toBeEnabled();
  expect(save()).toBeEnabled();
  await userEvent.type(reason, ' corrected');
  await userEvent.click(save());
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/definitions/oa.vendorQualification',
    ),
  );
});
it('preserves vendor drafts when refreshing after a conflict fails', async () => {
  show('oa.vendorQualification', 'committee_v1');
  await choose('Version 1 · purchase seat person');
  const reason = screen
    .getAllByLabelText(/Reason/)
    .find((el) => !el.closest('[hidden]'))!;
  await userEvent.type(reason, 'Retained draft');
  api.request
    .mockRejectedValueOnce(
      new ApiClientError('conflict', {
        status: 409,
        method: 'PATCH',
        url: '/configuration',
      }),
    )
    .mockRejectedValueOnce(new Error('refresh unavailable'));
  await userEvent.click(
    screen
      .getAllByRole('button', { name: 'Save', exact: true })
      .find((el) => el.hasAttribute('form'))!,
  );
  await waitFor(() => expect(reason).toBeDisabled());
  await screen.findByText(enUS.processManagement.loadFailed);
  expect(reason).toHaveValue('Retained draft');
  expect(reason).toBeInTheDocument();
});
