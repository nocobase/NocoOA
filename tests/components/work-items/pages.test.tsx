import { useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { AttachmentEditor } from '../../../client/pages/work-items/attachments.js';
import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../../client/locales/en-US.js';
import moduleEN from '../../../client/locales/modules/work-items.en-US.js';
import Page from '../../../client/pages/work-items/index.js';
import Detail from '../../../client/pages/work-items/detail.js';
import Form from '../../../client/pages/work-items/form.js';
import Handover from '../../../client/pages/work-items/handover.js';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  revision: 0,
  actor: 'creator',
  can: true,
}));
const api = { request: state.request };
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => state.revision,
  useCan: () => ({ can: state.can, isPending: false }),
}));
vi.mock('#components/user-picker', () => ({
  UserPicker: ({
    value,
    onChange,
    id,
  }: {
    value: string;
    id?: string;
    onChange: (v: string) => void;
  }) => (
    <input
      aria-label='Target picker'
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...moduleEN } },
});
const task = {
  id: 't1',
  title: 'Follow up',
  description: 'Check facts',
  creator: { id: 'creator', name: 'Alice' },
  target: { id: 'worker', name: 'Bob' },
  assignee: { id: 'worker', name: 'Bob' },
  creatorUserId: 'creator',
  confirmationOwnerUserId: 'creator',
  confirmationOwner: { id: 'creator', name: 'Alice' },
  targetUserId: 'worker',
  dutyRoleCode: null,
  assigneeUserId: 'worker',
  dutyRole: null,
  dueAt: '2035-01-01T08:00:00Z',
  requiresConfirmation: true,
  attachments: [],
  resultAttachments: [],
  result: null,
  reason: null,
  status: 'draft',
  version: 1,
  forced: false,
  completedAt: null,
  overdue: false,
  actions: ['dispatch'],
  canEdit: true,
};
let observed = { pathname: '', search: '', hash: '' };
function Probe() {
  const location = useLocation();
  useEffect(() => {
    observed = location;
  }, [location]);
  return null;
}
function tree(path: string) {
  return (
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationGuardProvider>
          <Probe />
          <Routes>
            <Route path='/work-items' element={<Page />}>
              <Route path='new' element={<Form />} />
              <Route path=':workItemId' element={<Detail />}>
                <Route path='edit' element={<Form />} />
                <Route path='handover-confirmation' element={<Handover />} />
                <Route path='actions/:action' element={<Form />} />
              </Route>
            </Route>
          </Routes>
        </NavigationGuardProvider>
      </MemoryRouter>
    </TestI18nProvider>
  );
}
function show(path: string) {
  return render(tree(path));
}
beforeEach(() => {
  state.revision = 0;
  state.actor = 'creator';
  state.can = true;
  state.request.mockReset();
  state.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) =>
      path === 'workItems/context'
        ? {
            data: {
              timeZone: 'Asia/Shanghai',
              dutyRoles: [
                {
                  code: 'admin',
                  title: { key: 'org.dutyRoles.admin', ns: 'nb3-oa' },
                },
              ],
            },
          }
        : method === 'PATCH' || method === 'POST'
          ? { data: task }
          : path === 'workItems'
            ? { data: [task], meta: { total: 1 } }
            : { data: task },
  );
});
afterEach(cleanup);
it('preserves filters and real pagination request, with one toolbar initiation', async () => {
  show('/work-items?mode=created&q=Follow&status=draft&page=2');
  await screen.findByText('Follow up');
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'workItems',
      query: expect.objectContaining({
        mode: 'created',
        q: 'Follow',
        status: 'draft',
        page: '2',
      }),
    }),
  );
  expect(screen.getAllByRole('button', { name: 'New work item' })).toHaveLength(
    1,
  );
});
it('dirty top return is guarded and successful edit navigates to exact source', async () => {
  const u = userEvent.setup();
  show('/work-items/t1/edit?mode=pool&q=Follow');
  const title = await screen.findByLabelText('Title');
  await u.clear(title);
  await u.type(title, 'Changed');
  await u.click(screen.getByRole('button', { name: 'Close' }));
  await screen.findByText('Discard unsaved changes?');
  expect(observed.pathname).toBe('/work-items/t1/edit');
  await u.click(screen.getByRole('button', { name: 'Continue editing' }));
  await u.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(observed.pathname).toBe('/work-items'));
  expect(observed.search).toBe('?mode=pool&q=Follow');
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({
        expectedVersion: 1,
        title: 'Changed',
        requestId: expect.any(String),
      }),
    }),
  );
});
it('complete requires a result and sends version without final-completion assumptions', async () => {
  state.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) =>
      path === 'workItems/context'
        ? { data: { timeZone: 'Asia/Shanghai', dutyRoles: null } }
        : method === 'POST'
          ? { data: { ...task, status: 'awaitingConfirmation' } }
          : path === 'workItems'
            ? { data: [task], meta: { total: 1 } }
            : {
                data: {
                  ...task,
                  status: 'assigned',
                  canEdit: false,
                  actions: ['complete'],
                },
              },
  );
  const u = userEvent.setup();
  show('/work-items/t1/actions/complete?mode=assigned');
  await screen.findByLabelText('Result');
  await u.click(screen.getByRole('button', { name: 'Submit result' }));
  await screen.findByText('Enter a valid value');
  await u.type(screen.getByLabelText('Result'), 'Done');
  await u.click(screen.getByRole('button', { name: 'Submit result' }));
  await waitFor(() => expect(observed.pathname).toBe('/work-items/t1'));
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'workItems/t1/complete',
      json: expect.objectContaining({ result: 'Done', expectedVersion: 1 }),
    }),
  );
});
it('refresh hides old write actions until current detail is reauthorized', async () => {
  let resolve!: (v: unknown) => void;
  const u = userEvent.setup();
  show('/work-items/t1');
  await screen.findByRole('button', { name: 'Dispatch' });
  expect(screen.getByRole('button', { name: 'Dispatch' })).toBeTruthy();
  state.request.mockImplementation(({ path }: { path: string }) =>
    path === 'workItems/t1'
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(
          path === 'workItems/context'
            ? { data: { timeZone: 'Asia/Shanghai', dutyRoles: null } }
            : { data: [task], meta: { total: 1 } },
        ),
  );
  await u.click(screen.getAllByRole('button', { name: 'Refresh' }).at(-1)!);
  expect(screen.queryByRole('button', { name: 'Dispatch' })).toBeNull();
  resolve({ data: { ...task, actions: [], canEdit: false } });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Dispatch' })).toBeNull(),
  );
});

it('authorization revision during a pending edit clears input and releases navigation', async () => {
  let resolve!: (v: unknown) => void;
  const u = userEvent.setup(),
    view = show('/work-items/t1/edit?mode=created');
  const title = await screen.findByLabelText('Title');
  await u.clear(title);
  await u.type(title, 'Private changed input');
  state.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      method === 'PATCH'
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve(
            path === 'workItems/context'
              ? { data: { timeZone: 'Asia/Shanghai', dutyRoles: null } }
              : path === 'workItems'
                ? { data: [task], meta: { total: 1 } }
                : { data: task },
          ),
  );
  await u.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH' }),
    ),
  );
  state.can = false;
  state.revision++;
  view.rerender(tree('/work-items/t1/edit?mode=created'));
  await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
  await u.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(observed.pathname).toBe('/work-items/t1'));
  resolve({ data: task });
  expect(observed.search).toBe('?mode=created');
});

it('server target field violation focuses the picker and links its localized error', async () => {
  const u = userEvent.setup();
  show('/work-items/t1/edit');
  await screen.findByLabelText('Title');
  state.request.mockRejectedValueOnce(
    new ApiClientError('private diagnostic', {
      status: 400,
      method: 'PATCH',
      url: '/api/workItems/t1',
      payload: { error: { fieldViolations: [{ field: 'targetUserId' }] } },
    }),
  );
  await u.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(document.activeElement?.id).toBe('task-target'));
  expect(
    document.getElementById('task-target')?.getAttribute('aria-describedby'),
  ).toBe('task-target-error');
});
it('late owner version read after upload cannot restore selections after unmount', async () => {
  let resolve!: (v: unknown) => void;
  const change = vi.fn(),
    u = userEvent.setup();
  state.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('uploadOne')
      ? Promise.resolve({ data: { record: { id: 'file1' } } })
      : new Promise((r) => {
          resolve = r;
        }),
  );
  const v = render(
    <TestI18nProvider runtime={runtime}>
      <AttachmentEditor
        id='t1'
        ids={[]}
        onChange={change}
        disabled={false}
        onBusy={() => {}}
      />
    </TestI18nProvider>,
  );
  await u.upload(
    screen.getByLabelText('Upload attachment'),
    new File(['proof'], 'proof.txt', { type: 'text/plain' }),
  );
  await waitFor(() =>
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'workItems/t1' }),
    ),
  );
  v.unmount();
  await act(async () => resolve({ data: task }));
  expect(change).not.toHaveBeenCalled();
});
it('unknown action displays a localized unavailable title and never offers submission', async () => {
  show('/work-items/t1/actions/notReal');
  await screen.findByText('Operation unavailable');
  expect(
    screen.queryByRole('button', { name: 'Operation unavailable' }),
  ).toBeNull();
  expect(state.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(
    false,
  );
});

it('confirmation handover sends actual owner and version and preserves source query/hash', async () => {
  state.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) =>
      path === 'workItems/context'
        ? { data: { timeZone: 'Asia/Shanghai', dutyRoles: null } }
        : path === 'workItems'
          ? { data: [task], meta: { total: 1 } }
          : {
              data: {
                ...task,
                status: 'assigned',
                canEdit: false,
                actions: [],
                canHandoverConfirmation: method !== 'POST',
              },
            },
  );
  const u = userEvent.setup();
  show('/work-items/t1/handover-confirmation?mode=all#selected');
  await screen.findByLabelText('New confirmation owner');
  await u.type(screen.getByLabelText('New confirmation owner'), 'successor');
  await u.type(
    screen.getByLabelText('Reason'),
    'Clear confirmation responsibility',
  );
  await u.click(screen.getByRole('button', { name: 'Hand over confirmation' }));
  await waitFor(() => expect(observed.pathname).toBe('/work-items/t1'));
  expect(observed.search).toBe('?mode=all');
  expect(observed.hash).toBe('#selected');
  expect(state.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'workItems/t1/handoverConfirmation',
      method: 'POST',
      json: expect.objectContaining({
        fromUserId: 'creator',
        toUserId: 'successor',
        expectedVersion: 1,
        reason: 'Clear confirmation responsibility',
        requestId: expect.any(String),
      }),
    }),
  );
});
it('confirmation handover fails closed without current record capability', async () => {
  show('/work-items/t1/handover-confirmation');
  await screen.findByText('You do not have permission for this operation');
  expect(screen.queryByLabelText('New confirmation owner')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Hand over confirmation' }),
  ).toBeNull();
});
it('confirmation handover rejects the actual handler and blank reason without writing', async () => {
  state.request.mockImplementation(async ({ path }: { path: string }) =>
    path === 'workItems/context'
      ? { data: { timeZone: 'Asia/Shanghai', dutyRoles: null } }
      : path === 'workItems'
        ? { data: [task], meta: { total: 1 } }
        : {
            data: {
              ...task,
              status: 'assigned',
              canHandoverConfirmation: true,
            },
          },
  );
  const u = userEvent.setup();
  show('/work-items/t1/handover-confirmation');
  await screen.findByLabelText('New confirmation owner');
  await u.type(screen.getByLabelText('New confirmation owner'), 'worker');
  await u.type(screen.getByLabelText('Reason'), '  ');
  await u.click(screen.getByRole('button', { name: 'Hand over confirmation' }));
  await screen.findByText('Enter a valid value');
  await u.clear(screen.getByLabelText('Reason'));
  await u.type(screen.getByLabelText('Reason'), 'Transfer');
  await u.click(screen.getByRole('button', { name: 'Hand over confirmation' }));
  await waitFor(() =>
    expect(document.activeElement?.id).toBe('handover-target'),
  );
  expect(state.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(
    false,
  );
});

it('labels both filters and shows clear only while a filter is applied', async () => {
  const u = userEvent.setup();
  show('/work-items?mode=created&status=draft&overdue=true&page=3');
  expect(
    await screen.findByRole('combobox', { name: 'Status' }),
  ).toHaveTextContent('Draft');
  expect(screen.getByRole('combobox', { name: 'Overdue' })).toHaveTextContent(
    'Overdue',
  );
  await u.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(observed.search).toBe('?mode=created'));
  expect(
    screen.queryByRole('button', { name: 'Clear filters' }),
  ).not.toBeInTheDocument();
});

it('keeps work-item fields in a drawer and actions in its fixed footer; rejects an expired deadline before sending', async () => {
  const u = userEvent.setup();
  show('/work-items/t1/edit?mode=created#filters');
  await screen.findByLabelText('Title');
  const save = screen.getByRole('button', { name: 'Save draft' });
  expect(save.closest('[data-slot="route-overlay-footer"]')).not.toBeNull();
  expect(screen.getByRole('dialog').getAttribute('data-presentation')).toBe(
    'drawer',
  );
  const now = vi
    .spyOn(Date, 'now')
    .mockReturnValue(Date.parse('2036-01-01T00:00:00Z'));
  try {
    await u.click(save);
    await screen.findByText('Choose a due date and time later than now');
    expect(
      state.request.mock.calls.some(([request]) => request.method === 'PATCH'),
    ).toBe(false);
    expect(screen.getByLabelText('Title')).toHaveValue('Follow up');
  } finally {
    now.mockRestore();
  }
});

it('shows a server deadline violation inline while retaining unsaved input', async () => {
  const u = userEvent.setup();
  show('/work-items/t1/edit');
  const title = await screen.findByLabelText('Title');
  await u.clear(title);
  await u.type(title, 'Keep the revised title');
  state.request.mockRejectedValueOnce(
    new ApiClientError('INVALID_INPUT', {
      status: 400,
      method: 'PATCH',
      url: '/api/workItems/t1',
      payload: { error: { fieldViolations: [{ field: 'dueAt' }] } },
    }),
  );
  await u.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Choose a due date and time later than now');
  expect(title).toHaveValue('Keep the revised title');
});
