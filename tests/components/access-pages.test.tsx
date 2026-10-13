import { ApiClientError } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import RolesPage from '../../client/pages/access/roles.js';
import EditPage from '../../client/pages/access/edit.js';
import SubjectDetail from '../../client/pages/access/detail.js';
import PeoplePage from '../../client/pages/access/people.js';
import PersonDetail from '../../client/pages/access/person-detail.js';
import AssignPage from '../../client/pages/access/assign.js';
import { ErrorState } from '../../client/pages/access/ui.js';

const { api, client, can, toaster, reload } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  client: {
    loadOptions: vi.fn(),
    listSubjects: vi.fn(),
    resolveSubjects: vi.fn(),
    inspectConfigured: vi.fn(),
    inspectBatch: vi.fn(),
    getEffective: vi.fn(),
  },
  can: { value: true },
  toaster: { show: vi.fn() },
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: () => undefined,
  usePageBreadcrumb: () => undefined,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: can.value, isPending: false }),
}));
vi.mock(
  '../../client/pages/administration/authorization/use-authorization-client.js',
  () => ({ useAuthorizationClient: () => client }),
);
vi.mock(
  '../../client/pages/administration/authorization/components/use-resource-options.js',
  () => ({ useResourceOptions: (value: unknown) => value }),
);
const catalog = {
  sections: [
    {
      name: 'business',
      title: 'Business',
      order: 1,
      subsections: [
        {
          name: 'budget',
          title: 'Budget',
          resources: [
            {
              type: 'settings',
              id: 'budget',
              title: 'Budget administration',
              actions: [
                { name: 'read', title: 'Read budget' },
                { name: 'update', title: 'Adjust allocation' },
              ],
            },
          ],
        },
      ],
    },
  ],
  subjectTypes: [
    {
      type: 'org.dutyRole',
      title: 'Duty roles',
      selection: { type: 'collection' },
    },
    {
      type: 'authenticated',
      title: 'All signed-in',
      selection: { type: 'fixed', id: '*' },
    },
  ],
  recordAccess: [],
  collections: [],
};
const definition = {
  key: 'finance',
  title: 'Finance responsibilities',
  grants: [
    {
      resource: { type: 'settings', id: 'budget' },
      actions: [{ action: 'read' }],
    },
  ],
};
const assignment = {
  id: 'a',
  permissionSet: 'finance',
  subject: { type: 'org.dutyRole', id: 'hr' },
};
const snapshot = {
  revision: 'a'.repeat(64),
  sets: [definition],
  assignments: [assignment],
};
const setSnapshot = {
  revision: 'a'.repeat(64),
  definition,
  assignments: [assignment],
};
const runtimes = {
  en: await createTestI18nRuntime({
    application: { namespace: 'nb3-oa', resources: enUS },
  }),
  zh: await createTestI18nRuntime({
    locale: 'zh-CN',
    application: { namespace: 'nb3-oa', resources: zhCN },
  }),
};
function Parent() {
  return <Outlet context={{ name: 'HR specialist', reload }} />;
}
function mount(page: 'roles' | 'edit' | 'assign', locale: 'en' | 'zh' = 'en') {
  const path =
    page === 'roles'
      ? '/access/roles'
      : page === 'edit'
        ? '/access/roles/org.dutyRole/hr/permissions/finance/edit'
        : '/access/roles/org.dutyRole/hr/permissions/assign';
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Parent />,
        children: [
          { path: '/access/roles', element: <RolesPage /> },
          {
            path: '/access/roles/:type/:id/permissions/:permissionSetKey/edit',
            element: <EditPage />,
          },
          {
            path: '/access/roles/:type/:id/permissions/assign',
            element: <AssignPage />,
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <TestI18nProvider runtime={runtimes[locale]} namespace='nb3-oa'>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  can.value = true;
  client.loadOptions.mockResolvedValue(catalog);
  client.listSubjects.mockResolvedValue({
    items: [{ id: 'hr', title: 'HR specialist' }],
    total: 1,
  });
  client.resolveSubjects.mockResolvedValue([
    { id: 'hr', title: 'HR specialist' },
  ]);
  api.request.mockImplementation(
    async ({ path, method }: { path: string; method?: string }) => {
      if (method === 'PUT') return { data: snapshot };
      if (path === 'access/snapshot') return { data: snapshot };
      if (path === 'dutyRoles')
        return { data: [{ code: 'hr', memberCount: 0, active: true }] };
      if (path === 'access/permissionSets/finance')
        return { data: setSnapshot };
      throw new Error(`unexpected request ${path}`);
    },
  );
});
describe('OA access pages', () => {
  it('shows real role access, automatic baseline and an unconfigured duty pool', async () => {
    mount('roles');
    expect(
      await screen.findByRole('link', { name: 'HR specialist' }),
    ).toHaveAttribute('href', '/access/roles/org.dutyRole/hr/permissions');
    expect(screen.getByText('No members assigned')).toBeInTheDocument();
    expect(screen.getByText('Budget administration')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Signed-in baseline access' }),
    ).toBeInTheDocument();
  });
  it('renders Chinese and supports search without changing saved access', async () => {
    mount('roles', 'zh');
    await screen.findByText('HR specialist');
    expect(
      screen.getByRole('heading', { name: '权限管理' }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText('搜索角色、岗位或部门…'),
      'unknown',
    );
    await waitFor(() =>
      expect(screen.queryByText('HR specialist')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('没有匹配结果')).toBeInTheDocument();
    expect(
      api.request.mock.calls.some(([input]) => input.method === 'PUT'),
    ).toBe(false);
  });
  it('keeps member absence distinct from missing permission', async () => {
    can.value = false;
    mount('roles');
    await screen.findByText('HR specialist');
    expect(screen.getByText('Member access unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No members assigned')).not.toBeInTheDocument();
  });
  it('requires a change confirmation and submits only the selected business operation', async () => {
    mount('edit');
    const user = userEvent.setup();
    const toggle = await screen.findByRole('switch', {
      name: 'Adjust allocation',
    });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const dialog = screen.getByRole('alertdialog');
    expect(
      within(dialog).getByText(/Budget administration · Adjust allocation/),
    ).toBeInTheDocument();
    expect(
      api.request.mock.calls.some(([input]) => input.method === 'PUT'),
    ).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          json: {
            expectedRevision: setSnapshot.revision,
            changes: [
              {
                resource: { type: 'settings', id: 'budget' },
                action: 'update',
                enabled: true,
                scopes: {},
              },
            ],
          },
        }),
      ),
    );
    expect(reload).toHaveBeenCalled();
  });
  it('shows conflict feedback and preserves the unsaved choice', async () => {
    api.request.mockImplementation(async ({ method }: { method?: string }) => {
      if (method === 'PUT')
        throw new ApiClientError('private', {
          status: 409,
          method: 'PUT',
          url: '/api/access',
          reason: 'VERSION_CONFLICT',
        });
      return { data: setSnapshot };
    });
    mount('edit');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('switch', { name: 'Adjust allocation' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Save',
      }),
    );
    expect(
      await screen.findByText(
        'Access configuration changed. Reload and review before saving.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Adjust allocation' }),
    ).toBeChecked();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });
  it('keeps personal and inherited authorization distinct while replacing only its managed direct subset', async () => {
    mount('assign');
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('checkbox', { name: /Finance responsibilities/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Save',
      }),
    );
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          json: {
            expectedRevision: snapshot.revision,
            managedPermissionSets: ['finance'],
            permissionSets: [],
          },
        }),
      ),
    );
  });
  it('does not offer retry after a permission denial', () => {
    render(
      <TestI18nProvider runtime={runtimes.en} namespace='nb3-oa'>
        <ErrorState
          error={
            new ApiClientError('secret', {
              status: 403,
              method: 'GET',
              url: '/api/access',
            })
          }
          retry={reload}
        />
      </TestI18nProvider>,
    );
    expect(
      screen.getByText(
        'You do not have access to this operation. Contact an access administrator.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });
});

function mountPerson() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Parent />,
        children: [
          { path: 'access/people/:userId/sources', element: <PersonDetail /> },
        ],
      },
    ],
    { initialEntries: ['/access/people/employee/sources'] },
  );
  render(
    <TestI18nProvider runtime={runtimes.en} namespace='nb3-oa'>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
}
describe('Person permission sources', () => {
  it('groups user decisions by module without dropping source or conditional details', async () => {
    client.loadOptions.mockResolvedValue({
      ...catalog,
      sections: [
        {
          ...catalog.sections[0],
          subsections: [
            ...catalog.sections[0].subsections,
            {
              name: 'hr',
              title: 'HR',
              resources: [
                {
                  type: 'settings',
                  id: 'hr',
                  title: 'HR administration',
                  actions: [{ name: 'read', title: 'Read HR' }],
                },
              ],
            },
          ],
        },
      ],
    });
    client.inspectConfigured.mockResolvedValue({
      sets: [{ ...definition, sources: [{ type: 'org.dutyRole', id: 'hr' }] }],
    });
    client.getEffective.mockResolvedValue([definition]);
    client.inspectBatch.mockImplementation(async (_subject, checks) =>
      checks.map((check: { resource: { id: string } }) => ({
        ...check,
        decision: {
          effect: check.resource.id === 'budget' ? 'conditional' : 'deny',
        },
      })),
    );
    mountPerson();
    const hr = await screen.findByRole('tab', {
      name: 'HR: 0 configured / 1 resources',
    });
    expect(screen.queryByText('Read HR')).toBeNull();
    expect(screen.getByText('Read budget')).toBeVisible();
    expect(
      screen.getByText('Access sources: Finance responsibilities'),
    ).toBeVisible();
    await userEvent.click(hr);
    expect(screen.getByText('Read HR')).toBeVisible();
    expect(screen.getByText(enUS.access.deniedAction)).toBeVisible();
    expect(screen.queryByText('Read budget')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /All:/ }));
    expect(screen.getByText('Read HR')).toBeVisible();
    expect(screen.getByText('Read budget')).toBeVisible();
  });
  it('keeps unchecked results in their module rather than showing them as denied', async () => {
    client.loadOptions.mockResolvedValue({
      ...catalog,
      sections: [
        {
          ...catalog.sections[0],
          subsections: [
            ...catalog.sections[0].subsections,
            {
              name: 'hr',
              title: 'HR',
              resources: [
                {
                  type: 'settings',
                  id: 'hr',
                  title: 'HR administration',
                  actions: [{ name: 'read', title: 'Read HR' }],
                },
              ],
            },
          ],
        },
      ],
    });
    client.inspectConfigured.mockResolvedValue({ sets: [] });
    client.getEffective.mockResolvedValue([]);
    client.inspectBatch.mockRejectedValue(new Error('Network unavailable'));
    mountPerson();
    await userEvent.click(await screen.findByRole('tab', { name: /HR:/ }));
    expect(screen.getByText('Read HR')).toBeVisible();
    expect(screen.getByText(enUS.access.unchecked)).toBeVisible();
    expect(screen.queryByText('Read budget')).toBeNull();
    expect(screen.queryByText(enUS.access.deniedAction)).toBeNull();
    expect(screen.queryByText(enUS.access.none)).toBeNull();
  });

  it('shows inherited responsibilities as their actual source and conditional decisions', async () => {
    client.resolveSubjects.mockImplementation(async (_surface, type) => [
      {
        id: type === 'user' ? 'employee' : 'hr',
        title: type === 'user' ? 'Employee' : 'HR specialist',
      },
    ]);
    client.inspectConfigured.mockResolvedValue({
      sets: [{ ...definition, sources: [{ type: 'org.dutyRole', id: 'hr' }] }],
    });
    client.getEffective.mockResolvedValue([definition]);
    client.inspectBatch.mockImplementation(async (_subject, checks) =>
      checks.map((check: object) => ({
        ...check,
        decision: { effect: 'conditional' },
      })),
    );
    mountPerson();
    expect(
      await screen.findByRole('link', { name: 'HR specialist' }),
    ).toHaveAttribute('href', '/access/roles/org.dutyRole/hr/permissions');
    await waitFor(() =>
      expect(screen.getAllByText(enUS.access.conditional)).toHaveLength(2),
    );
    expect(screen.queryByText(enUS.access.none)).not.toBeInTheDocument();
  });
  it('retains inspection results when supplementary source names are denied', async () => {
    client.inspectConfigured.mockResolvedValue({
      sets: [{ ...definition, sources: [{ type: 'org.dutyRole', id: 'hr' }] }],
    });
    client.getEffective.mockResolvedValue([definition]);
    client.resolveSubjects.mockRejectedValue(
      new ApiClientError('Denied', {
        status: 403,
        method: 'GET',
        url: 'subjects',
      }),
    );
    client.inspectBatch.mockImplementation(async (_subject, checks) =>
      checks.map((check: object) => ({
        ...check,
        decision: { effect: 'conditional' },
      })),
    );
    mountPerson();
    await waitFor(() =>
      expect(screen.getAllByText(enUS.access.conditional)).toHaveLength(2),
    );
    expect(screen.getByText(enUS.access.personUnknown)).toBeInTheDocument();
    expect(screen.getByText(enUS.access.inherited)).toBeInTheDocument();
  });
  it('splits inspections at 100 and never presents failed checks as no access', async () => {
    client.loadOptions.mockResolvedValue({
      ...catalog,
      sections: [
        {
          ...catalog.sections[0],
          subsections: [
            {
              ...catalog.sections[0].subsections[0],
              resources: [
                {
                  ...catalog.sections[0].subsections[0].resources[0],
                  actions: Array.from({ length: 101 }, (_, index) => ({
                    name: `action${index}`,
                    title: `Action ${index}`,
                  })),
                },
              ],
            },
          ],
        },
      ],
    });
    client.resolveSubjects.mockResolvedValue([
      { id: 'employee', title: 'Employee' },
    ]);
    client.inspectConfigured.mockResolvedValue({ sets: [] });
    client.getEffective.mockResolvedValue([]);
    client.inspectBatch.mockRejectedValue(new Error('Network unavailable'));
    mountPerson();
    await waitFor(() => expect(client.inspectBatch).toHaveBeenCalledTimes(2));
    expect(
      client.inspectBatch.mock.calls.map((call) => call[1].length),
    ).toEqual([100, 1]);
    expect(
      await screen.findByRole('button', { name: enUS.access.retry }),
    ).toBeInTheDocument();
    expect(screen.queryByText(enUS.access.none)).not.toBeInTheDocument();
  });
});

function mountAt(element: React.ReactElement, path: string, initial: string) {
  const router = createMemoryRouter(
    [{ path: '/', element: <Parent />, children: [{ path, element }] }],
    { initialEntries: [initial] },
  );
  render(
    <TestI18nProvider runtime={runtimes.en} namespace='nb3-oa'>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
}
describe('Independent loading blocks', () => {
  it('shows a retryable catalog error in the subject detail', async () => {
    client.loadOptions.mockRejectedValue(new Error('Options unavailable'));
    api.request.mockResolvedValue({ data: snapshot });
    mountAt(
      <SubjectDetail />,
      'access/roles/:type/:id/permissions',
      '/access/roles/org.position/hr/permissions',
    );
    expect(
      await screen.findByRole('button', { name: enUS.access.retry }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(enUS.access.loading),
    ).not.toBeInTheDocument();
  });
  it('keeps the existing people table visible while a new search is pending', async () => {
    let finish: (value: {
      data: { id: string; name: string; email: string }[];
      meta: { total: number };
    }) => void = () => {};
    api.request.mockImplementation(({ query }) =>
      query.q
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({
            data: [
              {
                id: 'employee',
                name: 'Employee',
                email: 'employee@example.test',
              },
            ],
            meta: { total: 1 },
          }),
    );
    mountAt(<PeoplePage />, 'access/people', '/access/people');
    await screen.findByRole('link', { name: 'Employee' });
    await userEvent.type(
      screen.getByPlaceholderText(enUS.access.searchPeople),
      'new',
    );
    await waitFor(() =>
      expect(
        api.request.mock.calls.some((call) => call[0].query.q === 'new'),
      ).toBe(true),
    );
    expect(screen.getByRole('link', { name: 'Employee' })).toBeInTheDocument();
    finish({
      data: [{ id: 'new', name: 'New colleague', email: 'new@example.test' }],
      meta: { total: 1 },
    });
    expect(
      await screen.findByRole('link', { name: 'New colleague' }),
    ).toBeInTheDocument();
  });
});

describe('Role permission module grouping', () => {
  it('shows one module at a time in role details', async () => {
    client.loadOptions.mockResolvedValue({
      ...catalog,
      sections: [
        {
          ...catalog.sections[0],
          subsections: [
            ...catalog.sections[0].subsections,
            {
              name: 'hr',
              title: 'HR',
              resources: [
                {
                  type: 'settings',
                  id: 'hr',
                  title: 'HR administration',
                  actions: [{ name: 'read', title: 'Read HR' }],
                },
              ],
            },
          ],
        },
      ],
    });
    const groupedDefinition = {
      ...definition,
      grants: [
        ...definition.grants,
        {
          resource: { type: 'settings', id: 'hr' },
          actions: [{ action: 'read' }],
        },
      ],
    };
    api.request.mockImplementation(async ({ path }: { path: string }) => ({
      data: path.includes('/members')
        ? []
        : { ...snapshot, sets: [groupedDefinition] },
    }));
    mountAt(
      <SubjectDetail />,
      'access/roles/:type/:id/permissions',
      '/access/roles/org.dutyRole/hr/permissions',
    );
    const hr = await screen.findByRole('tab', {
      name: 'HR: 1 configured / 1 resources',
    });
    expect(screen.getByText('Read budget')).toBeVisible();
    expect(screen.queryByText('Read HR')).toBeNull();
    await userEvent.click(hr);
    expect(screen.getByText('Read HR')).toBeVisible();
    expect(screen.queryByText('Read budget')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /All:/ }));
    expect(screen.getByText('Read budget')).toBeVisible();
    expect(screen.getByText('Read HR')).toBeVisible();
  });
});
