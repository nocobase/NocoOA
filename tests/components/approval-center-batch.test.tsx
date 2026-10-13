import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../client/locales/en-US.js';
import { useBatchApprove } from '../../client/pages/approvals/batch-approve.js';
import type { CenterRecord } from '../../client/pages/approvals/use-center-resource.js';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  viewer: 'manager',
  revision: 0,
}));
const api = { request: state.request };
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: state.viewer } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => state.revision,
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const rows: CenterRecord[] = [
  {
    id: 'one',
    kind: 'oa.leave',
    number: 'LV-1',
    applicantId: 'owner',
    applicant: null,
    status: 'manager',
    createdAt: null,
    startDate: null,
    endDate: null,
    amount: null,
    unit: null,
  },
];
const candidate = {
  kind: 'oa.leave',
  id: 'one',
  taskId: 'real-task',
  contentHash: 'reviewed-content',
};
const reload = vi.fn();
function Host({
  enabled = true,
  scope = 'pending',
  records = rows,
}: {
  enabled?: boolean;
  scope?: string;
  records?: CenterRecord[];
}) {
  const batch = useBatchApprove(records, enabled, scope, reload);
  const Cell = batch.column.cell as (props: {
    row: { original: CenterRecord };
  }) => React.ReactNode;
  return (
    <>
      {batch.controls}
      {records.map((record) => (
        <Cell key={record.id} row={{ original: record }} />
      ))}
    </>
  );
}
function view(
  props: { enabled?: boolean; scope?: string; records?: CenterRecord[] } = {},
) {
  return (
    <TestI18nProvider runtime={runtime}>
      <Host {...props} />
    </TestI18nProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.viewer = 'manager';
  state.revision = 0;
});
it('confirms the selected summary once, sends the reviewed target/hash and independent cryptographic request id, reports each result', async () => {
  state.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(
      path.endsWith('Options')
        ? { data: [candidate] }
        : { data: [{ kind: 'oa.leave', id: 'one', status: 'approved' }] },
    ),
  );
  render(view());
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Select LV-1' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected (1)' }),
  );
  expect(screen.getByRole('alertdialog')).toHaveTextContent('LV-1');
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected', exact: true }),
  );
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  const mutation = state.request.mock.calls.find(
    ([call]) => call.path === 'approvalCenter/batchApprove',
  )?.[0];
  expect(mutation.json.items[0]).toEqual({
    ...candidate,
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(screen.getByRole('status')).toHaveTextContent('Approved');
  expect(
    state.request.mock.calls.filter(
      ([call]) => call.path === 'approvalCenter/batchApprove',
    ),
  ).toHaveLength(1);
});
it('clears candidate selection when scope changes and never permits action while refreshing', async () => {
  state.request.mockResolvedValue({ data: [candidate] });
  const rendered = render(view());
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Select LV-1' }),
  );
  expect(
    screen.getByRole('button', { name: 'Approve selected (1)' }),
  ).toBeEnabled();
  rendered.rerender(view({ scope: 'next-page' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Approve selected (0)' }),
    ).not.toBeInTheDocument(),
  );
  rendered.rerender(view({ scope: 'next-page', enabled: false }));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('hides batch controls when no owner reports a safe current task', async () => {
  state.request.mockResolvedValue({ data: [] });
  render(view());
  await waitFor(() => expect(state.request).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('drops an in-flight old identity result and does not resurrect it when the old account returns', async () => {
  let resolveWrite!: (value: { data: unknown[] }) => void;
  state.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('Options')
      ? Promise.resolve({ data: [candidate] })
      : new Promise((resolve) => {
          resolveWrite = resolve;
        }),
  );
  const rendered = render(view());
  await userEvent.click(
    await screen.findByRole('checkbox', { name: 'Select LV-1' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected (1)' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected', exact: true }),
  );
  state.viewer = 'other-manager';
  state.revision = 1;
  rendered.rerender(view());
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Approve selected (0)' }),
    ).not.toBeInTheDocument(),
  );
  resolveWrite({ data: [{ kind: 'oa.leave', id: 'one', status: 'approved' }] });
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument(),
  );
  expect(reload).not.toHaveBeenCalled();
  state.viewer = 'manager';
  state.revision = 0;
  rendered.rerender(view());
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Approve selected (0)' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('reviews twenty summaries, blocks the twenty-first, and sends one request while busy across identity changes', async () => {
  const records = Array.from({ length: 21 }, (_, index) => ({
    ...rows[0],
    id: `record-${index}`,
    number: `LV-${index + 1}`,
  }));
  const candidates = records.map((row) => ({
    ...candidate,
    id: row.id,
    taskId: `task-${row.id}`,
  }));
  let resolveWrite!: (value: { data: unknown[] }) => void;
  state.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('Options')
      ? Promise.resolve({ data: candidates })
      : new Promise((resolve) => {
          resolveWrite = resolve;
        }),
  );
  const rendered = render(view({ records }));
  await screen.findAllByRole('checkbox');
  for (let index = 0; index < 20; index++)
    await userEvent.click(screen.getAllByRole('checkbox')[index]);
  expect(screen.getAllByRole('checkbox')[20]).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected (20)' }),
  );
  const dialog = screen.getByRole('alertdialog');
  expect(dialog.querySelectorAll('li')).toHaveLength(20);
  expect(dialog).toHaveTextContent('LV-20');
  expect(dialog).not.toHaveTextContent('LV-21');
  await userEvent.click(
    screen.getByRole('button', { name: 'Approve selected', exact: true }),
  );
  const running = screen.getByRole('button', { name: 'Approving…' });
  expect(running).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await userEvent.click(running);
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  const mutations = state.request.mock.calls.filter(
    ([call]) => call.path === 'approvalCenter/batchApprove',
  );
  expect(mutations).toHaveLength(1);
  expect(mutations[0][0].json.items).toHaveLength(20);
  expect(
    new Set(
      mutations[0][0].json.items.map(
        (item: { requestId: string }) => item.requestId,
      ),
    ).size,
  ).toBe(20);
  state.viewer = 'different-manager';
  rendered.rerender(view({ records }));
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
  );
  resolveWrite({
    data: records
      .slice(0, 20)
      .map((row) => ({ kind: row.kind, id: row.id, status: 'approved' })),
  });
  await waitFor(() =>
    expect(screen.queryByRole('status')).not.toBeInTheDocument(),
  );
  expect(reload).not.toHaveBeenCalled();
});

it('announces pending candidate checks and exposes no early confirmation', async () => {
  let resolveOptions!: (value: { data: unknown[] }) => void;
  state.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveOptions = resolve;
      }),
  );
  render(view());
  expect(screen.getByRole('status')).toHaveTextContent('Checking which tasks');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  resolveOptions({ data: [candidate] });
  await screen.findByRole('checkbox');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('refreshing the same rows requires fresh candidates while keeping the next check visible', async () => {
  let resolveOptions!: (value: { data: unknown[] }) => void;
  state.request.mockResolvedValueOnce({ data: [candidate] }).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveOptions = resolve;
      }),
  );
  const rendered = render(view());
  await userEvent.click(await screen.findByRole('checkbox'));
  rendered.rerender(view({ enabled: false }));
  rendered.rerender(view());
  expect(screen.getByRole('status')).toHaveTextContent('Checking which tasks');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  resolveOptions({ data: [candidate] });
  await screen.findByRole('checkbox');
  expect(
    screen.queryByRole('button', { name: 'Approve selected (0)' }),
  ).not.toBeInTheDocument();
});
