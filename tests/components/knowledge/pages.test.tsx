import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
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
import { beforeEach, it, expect, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import locale from '../../../client/locales/modules/knowledge.en-US.js';
import List from '../../../client/pages/knowledge/index.js';
import Form from '../../../client/pages/knowledge/form.js';
import DetailPage from '../../../client/pages/knowledge/detail.js';
import Preview from '../../../client/pages/knowledge/preview.js';
import FolderForm from '../../../client/pages/knowledge/folder-form.js';
const { api, reload, identity, toast } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  toast: vi.fn(),
  identity: { id: 'hr', revision: 0, listeners: new Set<() => void>() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: toast }),
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
    useCan: () => ({ can: true, isPending: false }),
  };
});
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...locale } },
});
const options = {
  canCreate: true,
  canEdit: true,
  folders: [],
  audience: { kind: 'department', items: [], total: 0, page: 1, pageSize: 20 },
  selected: { departments: [], dutyRoles: [] },
  restrictedSelected: 0,
};
const detail = {
  document: {
    id: 'doc-1',
    title: 'Safety guide',
    owner: { id: 'owner', name: 'Alice' },
    ownerId: 'owner',
    folderId: null,
    latestVersionId: 'v1',
    version: 1,
    active: true,
    departmentIds: [],
    dutyRoleCodes: [],
    updatedAt: '2026-10-11T00:00:00Z',
  },
  versions: [
    {
      id: 'v1',
      documentId: 'doc-1',
      version: 1,
      kind: 'markdown',
      markdown: '<script>private draft</script>',
      fileId: null,
      authorId: 'owner',
      author: { id: 'owner', name: 'Alice' },
      createdAt: '2026-10-11T00:00:00Z',
    },
  ],
};
function Shell() {
  return (
    <NavigationGuardProvider>
      <Outlet context={{ reload }} />
    </NavigationGuardProvider>
  );
}
function mount(path = '/knowledge/new') {
  const router = createMemoryRouter(
    [
      {
        path: '/knowledge',
        element: <Shell />,
        children: [
          { index: true, element: <List /> },
          { path: 'new', element: <Form /> },
          { path: 'folders/:folderId/edit', element: <FolderForm /> },
          {
            path: ':documentId',
            element: <DetailPage />,
            children: [
              { path: 'edit', element: <Form /> },
              { path: 'versions/:versionId/preview', element: <Preview /> },
            ],
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
const failure = (status: number) =>
  new ApiClientError('fixture', { status, code: 'TEST', details: {} });
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  api.request.mockReset();
  reload.mockReset();
  toast.mockReset();
  identity.id = 'hr';
  identity.revision = 0;
});
it('keeps the new action and table headers on an empty list, translates filters and preserves IME search', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) =>
    path === 'knowledge/folders'
      ? { data: [] }
      : { data: [], meta: { total: 0 } },
  );
  mount('/knowledge');
  expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
  expect(
    screen.getByRole('columnheader', { name: 'Title' }),
  ).toBeInTheDocument();
  expect(
    screen
      .getByRole('button', { name: 'New document' })
      .closest('[data-slot="application-actions"]'),
  ).not.toBeNull();
  expect(screen.getByRole('combobox', { name: 'Folder' })).toHaveTextContent(
    'All folders',
  );
  const input = screen.getByRole('textbox', { name: 'Search document titles' });
  fireEvent.compositionStart(input);
  fireEvent.change(input, {
    target: { value: 'zhishi' },
    nativeEvent: { isComposing: true },
  });
  fireEvent.compositionEnd(input, { target: { value: '知识' }, data: '知识' });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'knowledge/documents',
        query: expect.objectContaining({ q: '知识' }),
      }),
    ),
  );
});
it('renders Markdown safely and hides stale edit and preview actions during a failed refresh', async () => {
  let fail = false;
  api.request.mockImplementation(async () => {
    if (fail) throw failure(500);
    return {
      data: {
        ...detail,
        versions: [
          {
            ...detail.versions[0],
            markdown:
              '## Safety instructions\n\n- Check exits\n- Read the guide\n\n[Guide](https://example.com/guide)\n\n[Unsafe](javascript:alert%281%29)\n\n<script>private draft</script>',
          },
        ],
      },
    };
  });
  mount('/knowledge/doc-1');
  expect(
    await screen.findByText('<script>private draft</script>'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('<script>private draft</script>').querySelector('script'),
  ).toBeNull();
  expect(
    screen.getByRole('heading', { name: 'Safety instructions', level: 2 }),
  ).toBeInTheDocument();
  expect(screen.getByText('Check exits').closest('li')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute(
    'href',
    'https://example.com/guide',
  );
  expect(screen.getByText('Unsafe').closest('a')).toHaveAttribute('href', '');
  expect(
    document.querySelector('[data-slot="markdown-view"] script'),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Publish a new version' }),
  ).toBeInTheDocument();
  fail = true;
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(
    await screen.findByText(
      'Unable to load or save. Your current draft is retained.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Publish a new version' }),
  ).not.toBeInTheDocument();
});
it('retains uploaded bytes and the command key after publish fails, then retries without uploading again', async () => {
  const bodies: Record<string, unknown>[] = [];
  let writes = 0;
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
      if (path === 'knowledge/formOptions') return { data: options };
      if (path === 'knowledge/files')
        return {
          data: {
            id: 'upload-1',
            filename: 'manual.txt',
            ext: 'txt',
            mimeType: 'text/plain',
            size: 5,
          },
        };
      if (method === 'POST') {
        bodies.push(json!);
        if (++writes === 1) throw failure(500);
        return { data: detail };
      }
      return { data: [], meta: { total: 0 } };
    },
  );
  const router = mount();
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Title *' }),
    'New guide',
  );
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Content type *' }),
  );
  await userEvent.click(await screen.findByRole('option', { name: 'File' }));
  await userEvent.upload(
    screen.getByLabelText('Source file *'),
    new File(['hello'], 'manual.txt', { type: 'text/plain' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Upload file' }));
  expect(
    await screen.findByText(
      'manual.txt uploaded. Publish the version to make it available.',
    ),
  ).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  await screen.findByText(
    'Unable to load or save. Your current draft is retained.',
  );
  expect(router.state.location.pathname).toBe('/knowledge/new');
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe('/knowledge'),
  );
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]?.fileId).toBe('upload-1');
  expect(
    api.request.mock.calls.filter(([arg]) => arg.path === 'knowledge/files'),
  ).toHaveLength(1);
});
it('clears pending draft on same actor permission revision and ignores a late successful write', async () => {
  let finish: ((v: unknown) => void) | undefined;
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (identity.revision > 0) throw failure(403);
      if (method === 'POST')
        return await new Promise((resolve) => {
          finish = resolve;
        });
      if (path === 'knowledge/formOptions') return { data: options };
      return { data: detail };
    },
  );
  const router = mount('/knowledge/doc-1/edit');
  const title = await screen.findByRole('textbox', { name: 'Title *' });
  await userEvent.clear(title);
  await userEvent.type(title, 'Private unsaved title');
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    identity.revision++;
    for (const notify of identity.listeners) notify();
  });
  expect(
    await screen.findAllByText(
      'This document or operation is unavailable under your current permissions.',
    ),
  ).not.toHaveLength(0);
  expect(
    screen.queryByDisplayValue('Private unsaved title'),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish?.({ data: detail });
  });
  expect(toast).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe('/knowledge/doc-1/edit');
});
it('shows a denied current-document preview request as unavailable with a route back instead of an endless skeleton', async () => {
  api.request.mockImplementation(async ({ path }: { path: string }) => {
    if (path.endsWith('/file'))
      return {
        data: {
          id: 'v1',
          filename: 'manual.txt',
          ext: 'txt',
          mimeType: 'text/plain',
          size: 5,
          contentUrl: '/api/knowledge/documents/doc-1/versions/v1/content',
        },
      };
    throw failure(403);
  });
  mount('/knowledge/doc-1/versions/v1/preview');
  expect(
    await screen.findAllByText(
      'This document or operation is unavailable under your current permissions.',
    ),
  ).not.toHaveLength(0);
  expect(
    screen.getAllByRole('button', { name: 'Return to documents' }).length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole('status', { name: 'Loading documents' }),
  ).not.toBeInTheDocument();
});
it('blocks publishing the old file when a replacement is selected but not uploaded', async () => {
  const fileDetail = {
    ...detail,
    versions: [
      {
        ...detail.versions[0],
        kind: 'file',
        markdown: null,
        fileId: 'old-file',
      },
    ],
  };
  api.request.mockImplementation(async ({ path }: { path: string }) =>
    path === 'knowledge/formOptions' ? { data: options } : { data: fileDetail },
  );
  mount('/knowledge/doc-1/edit');
  await screen.findByRole('textbox', { name: 'Title *' });
  expect(screen.getByRole('button', { name: 'Publish version' })).toBeEnabled();
  await userEvent.upload(
    screen.getByLabelText('Source file *'),
    new File(['replacement'], 'replacement.txt', { type: 'text/plain' }),
  );
  expect(
    screen.getByRole('button', { name: 'Publish version' }),
  ).toBeDisabled();
  expect(
    api.request.mock.calls.filter(([arg]) => arg.method === 'POST'),
  ).toHaveLength(0);
});
it('clears a draft and disables further submission when a write returns permission denied without a revision event', async () => {
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') throw failure(403);
      return path === 'knowledge/formOptions'
        ? { data: options }
        : { data: detail };
    },
  );
  mount();
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Title *' }),
    'Private draft',
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Markdown content' }),
    'Secret content',
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  expect(
    await screen.findByText(
      'This document or operation is unavailable under your current permissions.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Secret content')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Private draft')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Publish version' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Return to documents' }),
  ).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
});
it('aborts a pending folder write when the route switches records and never closes the new record on a late result', async () => {
  let finish: ((v: unknown) => void) | undefined;
  api.request.mockImplementation(async ({ method }: { method?: string }) => {
    if (method === 'POST')
      return await new Promise((resolve) => {
        finish = resolve;
      });
    return {
      data: [
        { id: 'one', title: 'One', parentId: null, version: 1 },
        { id: 'two', title: 'Two', parentId: null, version: 1 },
      ],
    };
  });
  const router = mount('/knowledge/folders/one/edit');
  await screen.findByDisplayValue('One');
  await userEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  await waitFor(() => expect(finish).toBeDefined());
  const pending = api.request.mock.calls.find(
    ([arg]) => arg.method === 'POST',
  )?.[0];
  await act(async () => {
    await router.navigate('/knowledge/folders/two/edit');
  });
  expect(await screen.findByDisplayValue('Two')).toBeInTheDocument();
  expect(pending?.signal.aborted).toBe(true);
  await act(async () => {
    finish?.({ data: { id: 'one', title: 'One', parentId: null, version: 2 } });
  });
  expect(router.state.location.pathname).toBe('/knowledge/folders/two/edit');
  expect(toast).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
it('clears upload and folder drafts when their current writes are denied', async () => {
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST') throw failure(403);
      return path === 'knowledge/formOptions'
        ? { data: options }
        : {
            data: [
              {
                id: 'one',
                title: 'Current folder',
                parentId: null,
                version: 1,
              },
            ],
          };
    },
  );
  const router = mount();
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Title *' }),
    'Private upload draft',
  );
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Content type *' }),
  );
  await userEvent.click(await screen.findByRole('option', { name: 'File' }));
  await userEvent.upload(
    screen.getByLabelText('Source file *'),
    new File(['hello'], 'secret.txt', { type: 'text/plain' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Upload file' }));
  await screen.findByText(
    'This document or operation is unavailable under your current permissions.',
  );
  expect(
    screen.queryByDisplayValue('Private upload draft'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Upload file' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await router.navigate('/knowledge/folders/one/edit');
  });
  const title = await screen.findByRole('textbox', { name: 'Title *' });
  await userEvent.clear(title);
  await userEvent.type(title, 'Private folder draft');
  await userEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  await screen.findByText(
    'This document or operation is unavailable under your current permissions.',
  );
  expect(
    screen.queryByDisplayValue('Private folder draft'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save folder' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(router.state.location.pathname).not.toBe(
      '/knowledge/folders/one/edit',
    ),
  );
});
it('maps server folder field errors to the real first control and names dirty confirmation', async () => {
  api.request.mockImplementation(async ({ method }: { method?: string }) => {
    if (method === 'POST')
      throw new ApiClientError('unsafe raw detail', {
        status: 400,
        method: 'POST',
        url: '/api/knowledge/folders',
        payload: { error: { fieldViolations: [{ field: 'parentId' }] } },
      });
    return {
      data: [
        { id: 'one', title: 'Policy manuals', parentId: null, version: 1 },
      ],
    };
  });
  mount('/knowledge/folders/one/edit');
  await screen.findByDisplayValue('Policy manuals');
  await userEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  expect(
    await screen.findByText('Check this field and try again.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Parent folder' })).toHaveFocus();
  expect(
    screen.getByRole('combobox', { name: 'Parent folder' }),
  ).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('unsafe raw detail')).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Title *' }),
    ' revised',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(
    await screen.findByRole('heading', {
      name: 'Discard draft — Policy manuals',
    }),
  ).toBeInTheDocument();
});
it('focuses file and audience controls for whitelisted server errors without showing raw payload', async () => {
  const fileDetail = {
    ...detail,
    versions: [
      {
        ...detail.versions[0],
        kind: 'file',
        markdown: null,
        fileId: 'old-file',
      },
    ],
  };
  let field = 'fileId';
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'POST')
        throw new ApiClientError('private raw', {
          status: 400,
          method: 'POST',
          url: '/api/knowledge/documents',
          payload: { error: { fieldViolations: [{ field }] } },
        });
      return path === 'knowledge/formOptions'
        ? { data: options }
        : { data: fileDetail };
    },
  );
  mount('/knowledge/doc-1/edit');
  await screen.findByRole('textbox', { name: 'Title *' });
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  await screen.findByText('Check this field and try again.');
  expect(screen.getByLabelText('Source file *')).toHaveFocus();
  expect(screen.getByLabelText('Source file *')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  field = 'departmentIds';
  await userEvent.click(
    screen.getByRole('button', { name: 'Publish version' }),
  );
  await waitFor(() =>
    expect(
      document.getElementById('knowledge-audience-departmentIds'),
    ).toHaveFocus(),
  );
  expect(
    document.getElementById('knowledge-audience-departmentIds'),
  ).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('private raw')).not.toBeInTheDocument();
});
