import userEvent from '@testing-library/user-event';
import {
  ApiClientError,
  NavigationGuardProvider,
  PageBreadcrumbProvider,
} from '@nocobase/app-client';
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
import copy from '../../../client/locales/modules/contracts.en-US.js';
import List from '../../../client/pages/contracts/index.js';
import Ledger from '../../../client/pages/contracts/ledger.js';
import Form from '../../../client/pages/contracts/form-page.js';
import { CandidatePicker } from '../../../client/pages/contracts/candidate-picker.js';
import Detail from '../../../client/pages/contracts/detail.js';
import Rebase from '../../../client/pages/contracts/rebase-dialog.js';
import LedgerDetail from '../../../client/pages/contracts/ledger-detail.js';
import Action from '../../../client/pages/contracts/action-dialog.js';
import {
  FileEditor,
  SecureFiles,
} from '../../../client/pages/contracts/files.js';
import {
  EMPTY,
  proposalOf,
  type ContractDetail,
} from '../../../client/pages/contracts/types.js';
const { api, actor, permission, toast, reload, apply } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  actor: { id: 'owner' },
  permission: {
    submit: true,
    view: true,
    historicalEntry: false,
    access: true,
  },
  toast: vi.fn(),
  reload: vi.fn(),
  apply: vi.fn(),
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
    isPending: false,
  }),
}));
vi.mock('../../../client/pages/contracts/shared.js', async (original) => ({
  ...(await original<
    typeof import('../../../client/pages/contracts/shared.js')
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
    onChange: (v: string) => void;
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
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...base, ...copy } },
});
const record = {
  ...EMPTY,
  id: 'request-1',
  applicantId: 'owner',
  creatorId: 'owner',
  departmentId: 'dep',
  number: null,
  operation: 'new' as const,
  contractId: 'ledger-1',
  baseVersion: 0,
  contractType: 'sales',
  counterparty: { kind: 'customer' as const, name: 'Original customer' },
  amountCents: 10001,
  startsOn: '2026-10-01',
  endsOn: '2026-10-31',
  reason: 'Business reason',
  paymentTerms: 'Pay on delivery',
  status: 'draft',
  lifecycleVersion: 1,
  createdAt: '2026-10-11T00:00:00Z',
  nonStandard: null,
  applicant: { id: 'owner', name: 'Owner' },
  creator: { id: 'owner', name: 'Owner' },
};
const detail = {
  record,
  knownUsers: [record.applicant],
  view: {
    available: [
      { name: 'edit', allowed: true },
      { name: 'submit', allowed: true },
    ],
  },
  runs: [],
  actions: [],
  runActions: [],
  timeline: { runs: [] },
  upcoming: [],
  timeZone: 'Asia/Shanghai',
} as unknown as ContractDetail;
const options = {
  eligible: true,
  applicant: record.applicant,
  department: { id: 'dep', name: 'Department' },
  timeZone: 'Asia/Shanghai',
  contractTypes: [{ code: 'sales', active: true, label: { 'en-US': 'Sales' } }],
  vendors: [],
  contracts: [],
};
const text = {
  id: 'text-1',
  requestId: 'request-1',
  fileId: 'file-1',
  version: 1,
};
const file = {
  id: 'file-1',
  filename: 'contract',
  ext: 'pdf',
  contentUrl: '/guarded/private.pdf',
};
function show(
  element: React.ReactNode,
  path = '/contractRequests',
  action = false,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/contractRequests',
        element: (
          <NavigationGuardProvider>
            <PageBreadcrumbProvider>
              <Outlet context={{ reload, apply, detail }} />
            </PageBreadcrumbProvider>
          </NavigationGuardProvider>
        ),
        children: action
          ? [
              {
                path: 'contract/:requestId',
                element: <Outlet context={{ reload, apply, detail }} />,
                children: [{ path: 'action/:actionName/:targetId', element }],
              },
            ]
          : [
              { index: true, element },
              { path: 'newContract', element },
              { path: 'editContract/:requestId', element },
              {
                path: 'contract/:requestId',
                element: <div>Opened request</div>,
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
function standard({
  path,
  method,
  json,
}: {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
}) {
  if (path === 'contractRequests/options')
    return Promise.resolve({ data: options });
  if (path === 'contractRequests/request-1')
    return Promise.resolve({ data: detail });
  if (path.endsWith('/textVersions'))
    return Promise.resolve({ data: { textVersion: null } });
  if (path === 'contractAttachments/findMany')
    return Promise.resolve({ data: [] });
  if (method === 'POST' && path.endsWith('/transition'))
    return Promise.resolve({
      data: { ...record, ...(json?.input as object), lifecycleVersion: 2 },
    });
  return Promise.resolve({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  actor.id = 'owner';
  Object.assign(permission, {
    submit: true,
    view: true,
    historicalEntry: false,
    access: true,
  });
  api.request.mockImplementation(standard);
});
afterEach(cleanup);
it('sends complete server paging/filter/sort and retains a nondefault source URL', async () => {
  api.request.mockResolvedValue({
    data: [{ ...record, number: 'CT-100' }],
    meta: { page: 3, pageSize: 20, total: 101 },
  });
  const router = show(
    <List />,
    '/contractRequests?view=done&page=3&search=Original&status=draft&sort=amountCents&direction=asc',
  );
  const link = await screen.findByRole('link', { name: 'CT-100' });
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'contractRequests',
      query: expect.objectContaining({
        view: 'done',
        page: '3',
        search: 'Original',
        status: 'draft',
        sort: 'amountCents',
        direction: 'asc',
      }),
    }),
  );
  expect(screen.getByText('Page 3 of 6')).toBeTruthy();
  expect(link.getAttribute('href')).toContain(
    '?view=done&page=3&search=Original',
  );
  fireEvent.click(link);
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/contractRequests/contract/request-1',
    ),
  );
});
it('keeps one create action in the true empty state and no create on readonly ledger', async () => {
  show(<List />);
  expect(await screen.findByText('No contract requests')).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'New contract' }),
    ).toHaveLength(1),
  );
  cleanup();
  show(<Ledger />);
  expect(await screen.findByText('No contracts')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'New contract' })).toBeNull();
});
it('distinguishes filtered zero results and clears only filter/page while preserving view', async () => {
  const router = show(
    <List />,
    '/contractRequests?view=done&search=missing&status=draft&page=2',
  );
  expect(await screen.findByText('No matches')).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Clear filters' }).at(-1)!,
  );
  await waitFor(() => {
    expect(router.state.location.search).toContain('view=done');
    expect(router.state.location.search).not.toContain('search=');
    expect(router.state.location.search).not.toContain('status=');
    expect(router.state.location.search).not.toContain('page=');
  });
});
it('does not retry a permission refusal or expose a raw error', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('RAW private SQL', {
      status: 403,
      method: 'GET',
      url: 'contractRequests',
    }),
  );
  show(<List />);
  expect(
    await screen.findByText(
      'No access to this contract. Contact an administrator.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(screen.queryByText('RAW private SQL')).toBeNull();
});
it('loads the latest complete edit and locks partial proposal replacements', async () => {
  api.request.mockImplementation(({ path, ...rest }: { path: string }) => {
    if (path === 'contractRequests/request-1') {
      const partial = { ...record };
      delete (partial as Partial<typeof record>).reason;
      return Promise.resolve({ data: { ...detail, record: partial } });
    }
    return standard({ path, ...rest });
  });
  show(<Form />, '/contractRequests/editContract/request-1');
  await screen.findByLabelText('Counterparty *');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
});
it('validates on submit, focuses first error and preserves typed input', async () => {
  show(<Form />, '/contractRequests/newContract');
  const input = await screen.findByLabelText('Counterparty *');
  const user = userEvent.setup();
  await user.type(input, 'New customer');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(screen.getAllByText('Enter this field').length).toBeGreaterThan(0),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Contract type *') as HTMLElement).toBe(
      document.activeElement,
    ),
  );
  expect((input as HTMLInputElement).value).toBe('New customer');
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
});
it('binds uploaded immutable PDF through append then latest full proposal edit', async () => {
  let current = structuredClone(detail);
  api.request.mockImplementation(
    ({
      path,
      method,
      json,
      ...rest
    }: {
      path: string;
      method?: string;
      json?: Record<string, unknown>;
    }) => {
      if (path === 'contractRequests/request-1')
        return Promise.resolve({ data: structuredClone(current) });
      if (path === 'contractAttachments/uploadOne')
        return Promise.resolve({ data: { record: file } });
      if (method === 'POST' && path.endsWith('/textVersions'))
        return Promise.resolve({ data: { textVersion: text } });
      if (method === 'GET' && path.endsWith('/textVersions'))
        return Promise.resolve({
          data: { textVersion: current.record.textVersionId ? text : null },
        });
      if (path === 'contractAttachments/findMany')
        return Promise.resolve({
          data: current.record.textVersionId ? [file] : [],
        });
      if (path.endsWith('/transition')) {
        current = {
          ...current,
          record: {
            ...current.record,
            ...(json?.input as object),
            lifecycleVersion: 2,
          },
        };
        return Promise.resolve({ data: { record: current.record } });
      }
      return standard({ path, method, json, ...rest });
    },
  );
  show(<Form />, '/contractRequests/editContract/request-1');
  const input = await screen.findByLabelText('Contract text');
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(input, {
    target: {
      files: [new File(['%PDF'], 'contract.pdf', { type: 'application/pdf' })],
    },
  });
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Text version 1 bound' }),
    ),
  );
  const writes = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.method === 'POST');
  expect(writes.map((v) => v.path)).toEqual(
    expect.arrayContaining([
      'contractAttachments/uploadOne',
      'contractRequests/request-1/textVersions',
      'contractRequests/request-1/transition',
    ]),
  );
  const upload = writes.find((v) => v.path === 'contractAttachments/uploadOne');
  expect(upload.headers).toEqual({
    'x-contract-request-id': 'request-1',
    'x-contract-file-purpose': 'text',
  });
  expect(upload.body.getAll('file')).toHaveLength(1);
  const binding = writes.find((v) => v.path.endsWith('/transition'));
  expect(binding.json.input).toEqual({
    ...proposalOf(record),
    textVersionId: 'text-1',
  });
  expect(binding.json.input).not.toHaveProperty('lifecycleVersion');
});
it('guards current text metadata with the owning application and never manufactures a URL', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({
      data: path.endsWith('/textVersions') ? { textVersion: text } : [file],
    }),
  );
  show(<SecureFiles requestId='request-1' text />);
  const link = await screen.findByRole('link', { name: 'contract.pdf' });
  expect(link.getAttribute('href')).toBe('/guarded/private.pdf');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'contractAttachments/findMany',
      headers: {
        'x-contract-request-id': 'request-1',
        'x-contract-file-purpose': 'text',
      },
    }),
  );
});
it('does not retry unknown multipart upload after remount; existing file selection is explicit', async () => {
  const choose = vi.fn().mockResolvedValue(undefined);
  api.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('/uploadOne')
      ? Promise.reject(new Error('lost response'))
      : Promise.resolve({ data: [file] }),
  );
  const element = (
    <FileEditor
      requestId='request-1'
      purpose='text'
      disabled={false}
      onChoose={choose}
      onBusy={() => {}}
    />
  );
  show(element);
  fireEvent.change(screen.getByLabelText('Contract text'), {
    target: {
      files: [new File(['%PDF'], 'contract.pdf', { type: 'application/pdf' })],
    },
  });
  await screen.findByText(
    'Upload result needs checking. Choose an uploaded file; do not upload again.',
  );
  cleanup();
  show(element);
  expect(
    (screen.getByLabelText('Contract text') as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Choose uploaded file' }));
  fireEvent.click(await screen.findByRole('button', { name: 'contract.pdf' }));
  await waitFor(() => expect(choose).toHaveBeenCalledWith(file));
  expect(
    api.request.mock.calls.filter(([v]) => v.path.endsWith('/uploadOne')),
  ).toHaveLength(1);
});
function approvalDetail(order = 0, depth = 0) {
  const task = {
    id: 'task-1',
    stage: 'legalFinance',
    order,
    depth,
    via: depth ? 'addSigner' : 'plan',
    kind: 'decide',
    runId: 'run-1',
    assigneeId: 'owner',
    status: 'claimed',
  };
  return {
    ...detail,
    record: { ...record, status: 'legalFinance' },
    runs: [
      { run: { id: 'run-1', contentHash: 'displayed-hash' }, tasks: [task] },
    ],
    actions: [
      {
        task,
        onBehalfOf: null,
        actions: [
          {
            name: 'approve',
            batch: false,
            contentHash: true,
            tone: 'primary',
            primary: true,
            options: {},
          },
        ],
      },
    ],
  } as unknown as ContractDetail;
}
it('requires an explicit original legal opinion and sends the displayed target/hash', async () => {
  const current = approvalDetail();
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      Promise.resolve({
        data: path.endsWith('/action') && method === 'POST' ? {} : current,
      }),
  );
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/approve/task-1',
    true,
  );
  await screen.findByLabelText('Nonstandard legal opinion *');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Enter this field');
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(0);
  fireEvent.change(screen.getByLabelText('Select a legal opinion'), {
    target: { value: 'no' },
  });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  const command = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'POST');
  expect(command.json).toEqual(
    expect.objectContaining({
      target: { taskId: 'task-1' },
      contentHash: 'displayed-hash',
      input: { data: { nonStandard: false } },
    }),
  );
});
it('omits legal output controls for finance and added signers', async () => {
  api.request.mockResolvedValue({ data: approvalDetail(1) });
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/approve/task-1',
    true,
  );
  await screen.findByLabelText('Comment or reason');
  expect(screen.queryByLabelText('Select a legal opinion')).toBeNull();
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(apply).toHaveBeenCalled());
  const command = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'POST');
  expect(command.json.input).toEqual({});
  cleanup();
  api.request.mockResolvedValue({ data: approvalDetail(0, 1) });
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/approve/task-1',
    true,
  );
  await screen.findByLabelText('Comment or reason');
  expect(screen.queryByLabelText('Select a legal opinion')).toBeNull();
});
it('retries the original unknown action across remount without changing its key or input', async () => {
  const current = approvalDetail(1);
  let writes = 0;
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (path.endsWith('/action') && method === 'POST') {
        writes++;
        return writes === 1
          ? Promise.reject(new Error('lost response'))
          : Promise.resolve({ data: {} });
      }
      return Promise.resolve({ data: current });
    },
  );
  const url = '/contractRequests/contract/request-1/action/approve/task-1';
  show(<Action />, url, true);
  const input = await screen.findByLabelText('Comment or reason');
  fireEvent.change(input, { target: { value: 'Original decision' } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText(
    'Result needs checking. Input is locked; retry the original operation.',
  );
  const first = structuredClone(
    api.request.mock.calls.map(([v]) => v).find((v) => v.method === 'POST')
      .json,
  );
  cleanup();
  show(<Action />, url, true);
  expect(
    ((await screen.findByLabelText('Comment or reason')) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry original operation' }),
  );
  await waitFor(() => expect(writes).toBe(2));
  const commands = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.method === 'POST');
  expect(commands[1].json).toEqual(first);
  expect(commands[0].json).toEqual(first);
});
it('clears private action input and pending envelopes after a fresh 403', async () => {
  let refused = false;
  const current = approvalDetail(1);
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') {
        refused = true;
        return Promise.reject(
          new ApiClientError('private', {
            status: 403,
            method: 'POST',
            url: path,
          }),
        );
      }
      return refused
        ? Promise.reject(
            new ApiClientError('private', {
              status: 403,
              method: 'GET',
              url: path,
            }),
          )
        : Promise.resolve({ data: current });
    },
  );
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/approve/task-1',
    true,
  );
  const input = await screen.findByLabelText('Comment or reason');
  fireEvent.change(input, { target: { value: 'Private original comment' } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() =>
    expect(screen.queryByLabelText('Comment or reason')).toBeNull(),
  );
  expect(screen.queryByDisplayValue('Private original comment')).toBeNull();
  expect(
    Object.keys(sessionStorage).some((key) =>
      key.includes('oa:contracts:command:'),
    ),
  ).toBe(false);
  expect(
    screen.queryByRole('button', { name: 'Retry original operation' }),
  ).toBeNull();
});
it('explains inaccessible text without revealing the selected file or a download link', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('PRIVATE', {
      status: 403,
      method: 'GET',
      url: 'contractRequests/request-1/textVersions',
    }),
  );
  show(<SecureFiles requestId='request-1' text />);
  await screen.findByText('Contract text is not readable');
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.queryByText('file-1')).toBeNull();
  expect(api.request.mock.calls).toHaveLength(1);
});
it('restores an unknown create with its exact original envelope and prepares text in the same form using its acknowledged id', async () => {
  const input = {
      operation: 'new',
      contractId: null,
      baseVersion: 0,
      proposal: proposalOf(record),
    },
    command = {
      actorId: 'owner',
      path: 'contractRequests',
      body: { requestId: 'original-create-key', input },
    };
  sessionStorage.setItem(
    'oa:contracts:command:owner:/contractRequests/newContract:form',
    JSON.stringify(command),
  );
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) =>
      path === 'contractRequests' && method === 'POST'
        ? Promise.resolve({ data: { record } })
        : standard({ path, method }),
  );
  const router = show(
    <Form />,
    '/contractRequests/newContract?view=done&search=Exact',
  );
  await screen.findByRole('button', { name: 'Retry original operation' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry original operation' }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      '/contractRequests/newContract',
    ),
  );
  expect(await screen.findByLabelText('Contract text')).toBeEnabled();
  expect(
    sessionStorage.getItem(
      'oa:contracts:draft:owner:/contractRequests/newContract',
    ),
  ).toBe('request-1');
  expect(router.state.location.search).toContain('view=done');
  const writes = api.request.mock.calls
    .map(([v]) => v)
    .filter((v) => v.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0].json).toEqual(command.body);
});
it('does not repeat an acknowledged action when only its subsequent detail refresh fails', async () => {
  const current = approvalDetail(1);
  let success = false;
  api.request.mockImplementation(
    ({ method }: { path: string; method?: string }) => {
      if (method === 'POST') {
        success = true;
        return Promise.resolve({ data: {} });
      }
      return success
        ? Promise.reject(new Error('read unavailable'))
        : Promise.resolve({ data: current });
    },
  );
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/approve/task-1',
    true,
  );
  await screen.findByLabelText('Comment or reason');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await screen.findByText('Contract data could not be loaded. Retry.');
  expect(
    (screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.queryByRole('button', { name: 'Retry original operation' }),
  ).toBeNull();
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(1);
});
function showNested(
  element: React.ReactNode,
  path: string,
  leaf: string,
  context: unknown = { reload, apply, detail },
) {
  const router = createMemoryRouter(
    [
      {
        path: '/contractRequests',
        element: (
          <NavigationGuardProvider>
            <PageBreadcrumbProvider>
              <Outlet context={context} />
            </PageBreadcrumbProvider>
          </NavigationGuardProvider>
        ),
        children: [
          { index: true, element: <h1>Source list</h1> },
          { path: leaf, element },
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
it('reads the real authorized current baseline and rebases explicitly without replacing the proposal', async () => {
  const returned = {
    ...detail,
    record: {
      ...record,
      status: 'revision',
      operation: 'change' as const,
      baseVersion: 1,
    },
    view: { available: [{ name: 'rebase', allowed: true }] },
  };
  let rebased = false;
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (path.endsWith('/rebase') && method === 'POST') {
        rebased = true;
        return Promise.resolve({
          data: { record: { ...returned.record, baseVersion: 2 } },
        });
      }
      if (path === 'contracts/ledger-1')
        return Promise.resolve({
          data: {
            contract: { id: 'ledger-1', status: 'active', version: 2 },
            versions: [],
          },
        });
      return Promise.resolve({
        data: rebased
          ? { ...returned, record: { ...returned.record, baseVersion: 2 } }
          : returned,
      });
    },
  );
  showNested(
    <Rebase />,
    '/contractRequests/contract/request-1/rebase?view=done',
    'contract/:requestId/rebase',
    { reload, apply, detail: returned },
  );
  await screen.findByText(/Base version: 1/);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Rebase' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rebase' }));
  await screen.findByRole('alertdialog');
  fireEvent.click(screen.getAllByRole('button', { name: 'Rebase' }).at(-1)!);
  await waitFor(() => expect(apply).toHaveBeenCalled());
  const write = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'POST');
  expect(write.path).toBe('contractRequests/request-1/rebase');
  expect(write.json).toEqual({ version: 1, requestId: expect.any(String) });
  expect(write.json).not.toHaveProperty('input');
  expect(apply.mock.calls[0][0].record.counterparty).toEqual(
    record.counterparty,
  );
  expect(apply.mock.calls[0][0].record.baseVersion).toBe(2);
});
it('keeps immutable ledger quantities and separately guards each historical request text', async () => {
  const ledger = {
    contract: {
      id: 'ledger-1',
      number: 'CT-1',
      status: 'active',
      version: 2,
      amountCents: 10001,
      paidCents: 1000,
      heldCents: 2000,
      availableCents: 7001,
      facts: proposalOf(record),
    },
    versions: [
      {
        id: 'v1',
        version: 1,
        requestId: 'request-old',
        amountCents: 9000,
        at: '2026-10-10T17:00:00Z',
        actor: { id: 'legal', name: 'Legal reviewer' },
      },
      {
        id: 'v2',
        version: 2,
        requestId: 'request-1',
        amountCents: 10001,
        at: '2026-10-11T01:00:00Z',
        actor: { id: 'legal', name: 'Legal reviewer' },
      },
    ],
    timeZone: 'Asia/Shanghai',
  };
  api.request.mockImplementation(({ path }: { path: string }) =>
    path === 'contracts/ledger-1'
      ? Promise.resolve({ data: ledger })
      : Promise.reject(
          new ApiClientError('Denied', {
            status: 403,
            method: 'GET',
            url: path,
          }),
        ),
  );
  showNested(
    <LedgerDetail />,
    '/contractRequests/contractLedger/ledger-1?search=CT',
    'contractLedger/:contractId',
  );
  await screen.findByText('Available for payment');
  expect(screen.getByText('70.01')).toBeTruthy();
  expect(screen.getAllByText('100.01').length).toBeGreaterThan(0);
  await waitFor(() =>
    expect(screen.getAllByText('Contract text is not readable')).toHaveLength(
      2,
    ),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'contractRequests/request-old/textVersions',
    }),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'contractRequests/request-1/textVersions',
    }),
  );
  expect(
    api.request.mock.calls.filter(
      ([v]) => v.path === 'contractAttachments/findMany',
    ),
  ).toHaveLength(0);
});
it('returns a missing request to its precise source query, refreshes the list and offers no retry', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('Missing', {
      status: 404,
      method: 'GET',
      url: 'contractRequests/request-1',
    }),
  );
  const router = showNested(
    <Detail />,
    '/contractRequests/contract/request-1?view=done&search=Saved&page=3',
    'contract/:requestId',
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/contractRequests'),
  );
  expect(router.state.location.search).toBe('?view=done&search=Saved&page=3');
  expect(reload).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'error' }),
  );
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
it('paginates only public eligible recipients using the returned nextOffset and exact target', async () => {
  api.request.mockImplementation(
    ({ query }: { query: Record<string, string> }) =>
      Promise.resolve({
        data:
          query.offset === '67'
            ? {
                people: [{ id: 'person-2', name: 'Second candidate' }],
                nextOffset: null,
              }
            : {
                people: [{ id: 'person-1', name: 'First candidate' }],
                nextOffset: 67,
              },
      }),
  );
  show(
    <CandidatePicker
      path='contractRequests/request-1/candidates'
      query={{ action: 'appoint', runId: 'run-1' }}
      value=''
      onChange={() => {}}
      disabled={false}
      id='recipient'
    />,
  );
  await screen.findByRole('option', { name: 'First candidate' });
  fireEvent.click(screen.getByRole('button', { name: 'More candidates' }));
  await screen.findByRole('option', { name: 'Second candidate' });
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'contractRequests/request-1/candidates',
      query: expect.objectContaining({
        action: 'appoint',
        runId: 'run-1',
        offset: '67',
      }),
    }),
  );
  expect(api.request.mock.calls.every(([v]) => !v.path.includes('users'))).toBe(
    true,
  );
});
it('requires named explicit historical-entry confirmation and sends only its guarded version/key', async () => {
  permission.historicalEntry = true;
  const current = {
    ...detail,
    view: { available: [{ name: 'historicalEntry', allowed: true }] },
  };
  api.request.mockResolvedValue({ data: current });
  show(
    <Action />,
    '/contractRequests/contract/request-1/action/historicalEntry/request-1',
    true,
  );
  await screen.findByLabelText('Comment or reason');
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'Register historical contract',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Register historical contract' }),
  );
  await screen.findByRole('alertdialog');
  expect(
    screen.getByText(
      'Publishes an audited historical version. Check the text and proposal.',
    ),
  ).toBeTruthy();
  expect(
    api.request.mock.calls.filter(([v]) => v.method === 'POST'),
  ).toHaveLength(0);
  fireEvent.click(
    screen
      .getAllByRole('button', { name: 'Register historical contract' })
      .at(-1)!,
  );
  await waitFor(() => expect(apply).toHaveBeenCalled());
  const command = api.request.mock.calls
    .map(([v]) => v)
    .find((v) => v.method === 'POST');
  expect(command.path).toBe('contractRequests/request-1/historicalEntry');
  expect(command.json).toEqual({ version: 1, requestId: expect.any(String) });
});
