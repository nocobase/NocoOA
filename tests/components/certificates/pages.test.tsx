import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, Outlet } from 'react-router';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import locale from '../../../client/locales/modules/certificates.en-US.js';
import List from '../../../client/pages/certificates/index.js';
import Form from '../../../client/pages/certificates/form.js';
import DetailPage from '../../../client/pages/certificates/detail.js';
import Issue from '../../../client/pages/certificates/issue.js';
const { api, reload, identity } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  identity: { id: 'hr', revision: 0, listeners: new Set<() => void>() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', async (original) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await original<
      typeof import('@nocobase/app-plugin-authorization/client')
    >()),
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
    useCan: ({
      resource,
      action,
    }: {
      resource: { id: string };
      action: string;
    }) => ({
      can:
        resource.id !== 'oa.certificateRequest' &&
        !(resource.id === 'oa.certificateRequests' && action === 'submit'),
      isPending: false,
    }),
  };
});
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...locale } },
});
const record = {
  id: 'certificate-1',
  applicant: { id: 'owner', name: 'Alice' },
  certificateType: 'income',
  purpose: 'Mortgage',
  copies: 1,
  deliveryMethod: 'digital',
  status: 'issuing',
  lifecycleVersion: 4,
  createdAt: '2026-10-11T00:00:00Z',
  preparationId: 'prep-1',
  issueId: null,
  exceptionReason: null,
};
const preparation = {
  id: 'prep-1',
  number: 'CERT-1',
  issueDate: '2026-10-11',
  status: 'prepared',
  templateId: 'template-1',
  revisionId: 'revision-1',
};
const detail = () => ({
  record,
  tasks: [],
  actions: [],
  capabilities: {
    transitions: [],
    canIssue: true,
    canDownload: false,
    preparation: { ...preparation },
    issue: null,
    taskActions: [
      {
        taskId: 'task-1',
        runId: 'run-1',
        contentHash: 'content-1',
        actions: [{ name: 'complete', primary: true, tone: 'primary' }],
      },
    ],
  },
});
function Shell() {
  return <Outlet context={{ reload }} />;
}
function mount(
  element: React.ReactNode,
  path = '/certificates/certificate-1/issue',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/certificates',
        element: <Shell />,
        children: [
          { path: 'new', element: <Form /> },

          { path: ':certificateId/issue', element: <Issue /> },
          {
            path: ':certificateId',
            element: <DetailPage />,
            children: [{ path: 'edit', element: <Form /> }],
          },
          { index: true, element },
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
  identity.id = 'hr';
  identity.revision = 0;
  preparation.status = 'prepared';
});
afterEach(() => vi.unstubAllGlobals());

it.each(['Save draft', 'Submit'])(
  'sends %s over local HTTP without randomUUID using the real edit submission grant',
  async (intent) => {
    vi.stubGlobal('crypto', {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    const draft = {
      ...record,
      certificateType: 'employment',
      status: 'draft',
      lifecycleVersion: 1,
    };
    api.request.mockImplementation(async ({ path }: { path: string }) => ({
      data: path.endsWith('/submit')
        ? { ...draft, status: 'head', lifecycleVersion: 2 }
        : draft,
    }));
    mount(<Form />, '/certificates/new');
    await userEvent.type(
      screen.getByRole('textbox', { name: /Purpose/ }),
      'Bank evidence',
    );
    await userEvent.click(screen.getByRole('button', { name: intent }));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(api.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: 'certificateRequests',
        method: 'POST',
        json: expect.objectContaining({
          purpose: 'Bank evidence',
          requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        }),
      }),
    );
    if (intent === 'Submit') {
      expect(api.request).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          path: 'certificateRequests/certificate-1/submit',
          method: 'POST',
          json: {
            expectedVersion: 1,
            requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
          },
        }),
      );
    } else expect(api.request).toHaveBeenCalledOnce();
    expect(
      screen.queryByText('Unable to complete this operation'),
    ).not.toBeInTheDocument();
  },
);
it('keeps initiation in the toolbar for an empty table and preserves composed search input', async () => {
  api.request.mockResolvedValue({ data: { items: [], total: 0 } });
  mount(<List />, '/certificates');
  expect(
    await screen.findByText('No certificate requests'),
  ).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent(
    'All statuses',
  );
  const initiation = screen.getByRole('button', {
    name: 'New certificate request',
  });
  expect(
    initiation.closest('[data-slot="application-actions"]'),
  ).not.toBeNull();
  expect(
    screen.getByRole('columnheader', { name: 'Purpose' }),
  ).toBeInTheDocument();
  const input = screen.getByRole('textbox', { name: 'Search purpose' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, {
    target: { value: 'zhengming' },
    nativeEvent: { isComposing: true },
  });
  fireEvent.compositionEnd(input, { data: '证明', target: { value: '证明' } });
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ q: '证明' }),
      }),
    ),
  );
});
it('retries unknown draft writes with the same key and blocks a changed payload until recovery', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('fixture failure', {
      status: 500,
      code: 'TEST',
      details: {},
    }),
  );
  mount(<Form />, '/certificates/new');
  await userEvent.type(
    screen.getByRole('textbox', { name: /Purpose/ }),
    'Bank evidence',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(
    await screen.findByText('Unable to complete this operation'),
  ).toBeInTheDocument();
  const first = api.request.mock.calls.find(
    (call) => call[0].method === 'POST',
  )![0];
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter((c) => c[0].method === 'POST'),
    ).toHaveLength(2),
  );
  expect(
    api.request.mock.calls.filter((c) => c[0].method === 'POST')[1][0].json
      .requestKey,
  ).toBe(first.json.requestKey);
  await userEvent.type(
    screen.getByRole('textbox', { name: /Purpose/ }),
    ' changed',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter((c) => c[0].method === 'POST'),
    ).toHaveLength(2),
  );
  expect(screen.getByRole('textbox', { name: /Purpose/ })).toHaveValue(
    'Bank evidence changed',
  );
});
it('generation failure retains the actual preparation and confirmation retries exact SDK target and key', async () => {
  let generationFailed = false,
    confirmationFailed = false;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (!method && path.startsWith('certificateRequests/'))
        return { data: detail() };
      if (path === 'printTemplates')
        return {
          data: [
            {
              id: 'template-1',
              name: 'Income proof',
              active: true,
              currentRevisionId: 'revision-1',
            },
          ],
          meta: { total: 1 },
        };
      if (!method && path === 'printTemplates/template-1')
        return {
          data: {
            record: {
              id: 'template-1',
              name: 'Income proof',
              active: true,
              currentRevisionId: 'revision-1',
            },
            sourceReady: true,
          },
        };
      if (path === 'certificatePreparations/prep-1/generate') {
        if (!generationFailed) {
          generationFailed = true;
          throw new ApiClientError('worker failed', {
            status: 500,
            code: 'TEST',
            details: {},
          });
        }
        preparation.status = 'generated';
        return { data: { preparationId: 'prep-1', generated: true } };
      }
      if (path === 'certificateRequests/certificate-1/actions') {
        if (!confirmationFailed) {
          confirmationFailed = true;
          throw new ApiClientError('audit failed', {
            status: 500,
            code: 'TEST',
            details: {},
          });
        }
        return { data: { accepted: true } };
      }
      throw new Error(path);
    },
  );
  mount(<Issue />);
  await userEvent.click(
    await screen.findByRole('button', { name: 'Generate document' }),
  );
  expect(
    await screen.findByText('Unable to complete this operation'),
  ).toBeInTheDocument();
  expect(screen.getByText('CERT-1 · 2026-10-11')).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Generate document' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Confirm issuance' }),
  );
  expect(
    await screen.findByText('Unable to complete this operation'),
  ).toBeInTheDocument();
  const first = api.request.mock.calls.find((c) =>
    c[0].path.endsWith('/actions'),
  )![0];
  expect(first.json).toMatchObject({
    action: 'complete',
    target: { taskId: 'task-1' },
    contentHash: 'content-1',
    input: { preparationId: 'prep-1' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm issuance' }),
  );
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter((c) => c[0].path.endsWith('/actions')),
    ).toHaveLength(2),
  );
  expect(
    api.request.mock.calls.filter((c) => c[0].path.endsWith('/actions'))[1][0]
      .json.requestId,
  ).toBe(first.json.requestId);
});

it('clears income and preparation immediately on same-actor grant revision and ignores obsolete detail responses', async () => {
  let resolveOld: ((value: unknown) => void) | undefined;
  let reads = 0;
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path.startsWith('certificateRequests/')) {
      reads++;
      if (reads === 1) {
        const d = detail();
        d.capabilities.preparation =
          null as unknown as typeof d.capabilities.preparation;
        return { data: d };
      }
      if (reads === 2)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      throw new ApiClientError('revoked', {
        status: 403,
        code: 'TEST',
        details: {},
      });
    }
    if (path === 'printTemplates') return { data: [], meta: { total: 0 } };
    throw new Error(path);
  });
  mount(<Issue />);
  const income = await screen.findByRole('textbox', { name: /Monthly income/ });
  await userEvent.type(income, '98765.43');
  act(() => {
    identity.revision++;
    identity.listeners.forEach((fn) => fn());
  });
  expect(screen.queryByDisplayValue('98765.43')).not.toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(2));
  act(() => {
    identity.revision++;
    identity.listeners.forEach((fn) => fn());
  });
  await waitFor(() => expect(reads).toBe(3));
  await act(async () => {
    resolveOld?.({ data: detail() });
  });
  expect(screen.queryByDisplayValue('98765.43')).not.toBeInTheDocument();
  expect(screen.queryByText('CERT-1 · 2026-10-11')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Prepare issuance' }),
  ).toBeDisabled();
});

it('retains read-only detail during refresh failure while hiding obsolete operations and download', async () => {
  let failRefresh: ((reason: unknown) => void) | undefined;
  let reads = 0;
  api.request.mockImplementation(async () => {
    if (++reads > 1)
      return new Promise((_resolve, reject) => {
        failRefresh = reject;
      });
    const d = detail();
    d.capabilities.transitions = ['submit'];
    d.capabilities.canDownload = true;
    d.capabilities.issue = {
      id: 'issued-1',
      number: 'CERT-1',
      issueDate: '2026-10-11',
    } as unknown as typeof d.capabilities.issue;
    return { data: d };
  });
  mount(<DetailPage />, '/certificates/certificate-1');
  expect(
    await screen.findByRole('button', { name: 'Download DOCX' }),
  ).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(
    screen.queryByRole('button', { name: 'Download DOCX' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Submit' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Mortgage')).toBeInTheDocument();
  await act(async () =>
    failRefresh?.(
      new ApiClientError('offline', { status: 500, code: 'TEST', details: {} }),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'Download DOCX' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Submit' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
});

it('releases the close guard after a pending edit is aborted by authorization revision', async () => {
  api.request.mockImplementation(async ({ method }: { method?: string }) => {
    if (method) return new Promise(() => {});
    if (identity.revision)
      throw new ApiClientError('revoked', {
        status: 403,
        code: 'TEST',
        details: {},
      });
    const d = detail();
    d.capabilities.transitions = ['edit'];
    return { data: d };
  });
  const router = mount(<Form />, '/certificates/certificate-1/edit');
  const purpose = await screen.findByRole('textbox', { name: /Purpose/ });
  await userEvent.clear(purpose);
  await userEvent.type(purpose, 'Edited private purpose');
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(),
  );
  act(() => {
    identity.revision++;
    identity.listeners.forEach((fn) => fn());
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled(),
  );
  expect(
    screen.queryByDisplayValue('Edited private purpose'),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/certificates/certificate-1'),
  );
});

it('disables confirmation when generated preparation has no current complete offer', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path.startsWith('certificateRequests/')) {
      const d = detail();
      d.capabilities.preparation.status = 'generated';
      d.capabilities.taskActions = [];
      return { data: d };
    }
    if (path === 'printTemplates') return { data: [], meta: { total: 0 } };
    return {
      data: {
        record: {
          id: 'template-1',
          name: 'Income proof',
          active: true,
          currentRevisionId: 'revision-1',
        },
        sourceReady: true,
      },
    };
  });
  mount(<Issue />);
  const confirm = await screen.findByRole('button', {
    name: 'Confirm issuance',
  });
  expect(confirm).toBeDisabled();
  expect(
    screen.getByText('This record or action is no longer available'),
  ).toBeInTheDocument();
  expect(api.request.mock.calls.every((c) => !c[0].method)).toBe(true);
});
