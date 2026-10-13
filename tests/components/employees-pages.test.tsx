// Component tests of the employee archive pages and the directory. The setup follows
// tests/components/page-harness.test.tsx: the real strict i18n runtime with the application's locales, and mocks only
// for what the pages reach outside themselves for (the API client, the toaster, useCan, the session).
import { ApiClientError } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import packageMetadata from '../../package.json' with { type: 'json' };
import enUS from '../../client/locales/en-US.js';
import DirectoryPage from '../../client/pages/directory.js';
import EmployeeBasicTab from '../../client/pages/employees/detail/basic.js';
import CorrectStatusDialog from '../../client/pages/employees/detail/correct-status.js';
import EmployeeHistoryTab from '../../client/pages/employees/detail/history.js';
import EmployeePage from '../../client/pages/employees/detail/index.js';
import EmployeeProfileTab from '../../client/pages/employees/detail/profile.js';
import EmployeesPage from '../../client/pages/employees/index.js';
import { EmployeeForm } from '../../client/pages/employees/employee-form.js';
import type { Employee } from '../../client/pages/employees/types.js';

const { api, toaster, granted, refresh } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn(), close: vi.fn() },
  /** `<composite id>:<action>` the user holds. */
  granted: new Set<string>(),
  refresh: vi.fn(),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({
    resource,
    action,
  }: {
    resource: { id: string };
    action: string;
  }) => ({
    can: granted.has(`${resource.id}:${action}`),
    isPending: false,
    error: undefined,
    retry: vi.fn(),
  }),
}));

const copy = enUS.employees;

const runtime = await createTestI18nRuntime({
  application: { namespace: packageMetadata.name, resources: enUS },
});

function I18n({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <TestI18nProvider runtime={runtime} namespace={packageMetadata.name}>
      {children}
    </TestI18nProvider>
  );
}

type Request = {
  path: string;
  method?: string;
  json?: unknown;
  query?: Record<string, unknown>;
};

function answer(routes: Record<string, unknown>): void {
  api.request.mockImplementation(async (options: Request) => {
    const key = `${options.method ?? 'GET'} ${options.path}`;
    if (!(key in routes)) throw new Error(`Unexpected request ${key}`);
    const route = routes[key];
    return typeof route === 'function'
      ? (route as (options: Request) => unknown)(options)
      : route instanceof Error
        ? Promise.reject(route)
        : route;
  });
}

function apiError(status: number, reason?: string): ApiClientError {
  return new ApiClientError('Request failed', {
    status,
    method: 'GET',
    url: '/api/x',
    ...(reason ? { reason } : {}),
    payload: { error: { reason } },
  });
}

function renderRoutes(
  routes: Parameters<typeof createMemoryRouter>[0],
  url: string,
) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />, { wrapper: I18n });
  return router;
}

const EMPLOYEE = {
  id: 'e1',
  userId: 'u1',
  code: 'E001',
  name: 'Alice Wang',
  managerId: 'e0',
  positionId: 'p1',
  gradeId: null,
  hireDate: '2025-03-01',
  careerStartDate: '2010-07-01',
  probationEndDate: null,
  status: 'probation',
  lastWorkingDay: null,
  phone: '13800000000',
  email: 'alice@example.test',
  workLocation: null,
  emergencyContact: null,
  active: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  user: { id: 'u1', name: 'Alice Wang', email: 'alice@example.test' },
  manager: { id: 'e0', name: 'Bob Li', userId: 'u0' },
  primaryDepartment: { id: 'd1', title: 'Sales' },
  position: { id: 'p1', title: 'Buyer' },
  grade: null,
};

const DEPARTMENT_OPTIONS = { data: [], meta: { total: 0 } };

beforeEach(() => {
  api.request.mockReset();
  toaster.show.mockReset();
  refresh.mockReset();
  granted.clear();
});

function renderList(url = '/employees') {
  return renderRoutes(
    [{ path: '/employees', element: <EmployeesPage />, children: [] }],
    url,
  );
}

describe('employee archive list', () => {
  it('lists archives with names resolved and sends the URL filters', async () => {
    granted.add('oa.employees.archive:manage');
    answer({
      'GET employees': {
        data: [EMPLOYEE],
        meta: { page: 1, pageSize: 10, total: 1 },
      },
      'GET departments/options': DEPARTMENT_OPTIONS,
    });
    renderList('/employees?status=probation&q=ali');

    const link = await screen.findByRole('link', { name: 'Alice Wang' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('/employees/e1'),
    );
    const row = link.closest('tr')!;
    expect(within(row).getByText('Sales')).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: copy.fields.manager }),
    ).not.toBeInTheDocument();
    expect(within(row).queryByText('Bob Li')).not.toBeInTheDocument();
    expect(within(row).getByText(copy.status.probation)).toBeInTheDocument();
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'employees',
        query: expect.objectContaining({
          q: 'ali',
          status: 'probation',
          orderBy: 'updatedAt desc',
          page: 1,
        }),
      }),
    );
    // Rows exist, so the primary action sits in the header.
    expect(
      screen.getByRole('button', { name: copy.create.action }),
    ).toBeInTheDocument();
  });

  it('keeps an empty table and one toolbar creation action for authorized users', async () => {
    granted.add('oa.employees.archive:manage');
    answer({
      'GET employees': { data: [], meta: { page: 1, pageSize: 10, total: 0 } },
      'GET departments/options': DEPARTMENT_OPTIONS,
    });
    renderList();
    expect(await screen.findByText(copy.empty.title)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen
        .getByRole('button', { name: copy.create.action })
        .closest('[data-slot=application-actions]'),
    ).not.toBeNull();
    expect(
      within(screen.getByRole('table')).queryByRole('button', {
        name: copy.create.action,
      }),
    ).toBeNull();
    expect(
      screen.getAllByRole('button', { name: copy.create.action }),
    ).toHaveLength(1);
  });

  it('hides creation without the manage action', async () => {
    answer({
      'GET employees': { data: [], meta: { page: 1, pageSize: 10, total: 0 } },
      'GET departments/options': DEPARTMENT_OPTIONS,
    });
    renderList();
    expect(
      await screen.findByText(copy.empty.descriptionReadOnly),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: copy.create.action }),
    ).toBeNull();
  });

  it('explains a 403 without offering Retry', async () => {
    answer({
      'GET employees': apiError(403),
      'GET departments/options': DEPARTMENT_OPTIONS,
    });
    renderList();
    expect(await screen.findByText(copy.error.forbidden)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: enUS['status.retry'] }),
    ).toBeNull();
  });
});

function renderEmployee(url: string) {
  return renderRoutes(
    [
      {
        path: '/employees',
        element: <OutletOwner />,
        children: [
          {
            path: ':employeeId',
            element: <EmployeePage />,
            children: [
              {
                path: 'basic',
                element: <EmployeeBasicTab />,
                children: [
                  { path: 'correctStatus', element: <CorrectStatusDialog /> },
                ],
              },
              { path: 'profile', element: <EmployeeProfileTab /> },
              { path: 'history', element: <EmployeeHistoryTab /> },
            ],
          },
        ],
      },
    ],
    url,
  );
}

const reloadOwner = vi.fn();

function OutletOwner(): ReactElement {
  return <Outlet context={{ reload: reloadOwner }} />;
}

describe('employee first employment date form', () => {
  it('displays the optional field and submits its value while supporting legacy null hire dates', async () => {
    const record = {
      ...EMPLOYEE,
      hireDate: null,
      managerId: null,
      positionId: null,
    } as Employee;
    const saved = vi.fn();
    answer({
      'GET positions/options': { data: [] },
      'GET grades/options': { data: [] },
      'PATCH employees/e1': { data: record },
    });
    render(
      <>
        <EmployeeForm
          employee={record}
          formId='career-form'
          onSubmitted={saved}
        />
        <button type='submit' form='career-form'>
          Save fixture
        </button>
      </>,
      { wrapper: I18n },
    );
    expect(
      screen.getByLabelText(copy.fields.careerStartDate),
    ).toHaveTextContent(/2010/u);
    await userEvent.click(screen.getByRole('button', { name: 'Save fixture' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'employees/e1',
        method: 'PATCH',
        json: expect.objectContaining({
          careerStartDate: '2010-07-01',
          hireDate: null,
        }),
      }),
    );
  });
  it('translates server date refusal below the first employment date field', async () => {
    answer({
      'GET positions/options': { data: [] },
      'GET grades/options': { data: [] },
      'PATCH employees/e1': apiError(400, 'EMPLOYEE_CAREER_START_FUTURE'),
    });
    render(
      <>
        <EmployeeForm
          employee={EMPLOYEE as Employee}
          formId='career-form-error'
          onSubmitted={vi.fn()}
        />
        <button type='submit' form='career-form-error'>
          Save fixture
        </button>
      </>,
      { wrapper: I18n },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save fixture' }));
    expect(
      await screen.findByText(copy.form.careerStartFuture),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(copy.fields.careerStartDate)).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });
});

describe('employee page', () => {
  it('shows the basic information and hides sections the user may not read', async () => {
    answer({ 'GET employees/e1': { data: EMPLOYEE } });
    renderEmployee('/employees/e1/basic');
    expect(
      await screen.findByRole('heading', { name: /Alice Wang/u }),
    ).toBeInTheDocument();
    expect(screen.getByText('Bob Li')).toBeInTheDocument();
    expect(screen.getByText(copy.fields.careerStartDate)).toBeInTheDocument();
    expect(screen.getByText(/2010/u)).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: copy.page.tabsLabel });
    expect(
      within(tabs).getByRole('link', { name: copy.tabs.basic }),
    ).toBeInTheDocument();
    expect(
      within(tabs).queryByRole('link', { name: copy.tabs.profile }),
    ).toBeNull();
    expect(
      within(tabs).queryByRole('link', { name: copy.tabs.compensation }),
    ).toBeNull();
    // Without the archive actions the header offers none.
    expect(
      screen.queryByRole('button', { name: copy.actions.edit }),
    ).toBeNull();
  });

  it('shows only the bank account to a viewBank holder', async () => {
    granted.add('oa.employees.profile:viewBank');
    answer({
      'GET employees/e1': { data: EMPLOYEE },
      'GET employees/e1/profile': {
        data: {
          employeeId: 'e1',
          access: 'bank',
          bankName: 'ICBC',
          bankAccount: '6222',
          bankAccountName: 'Alice',
        },
      },
    });
    renderEmployee('/employees/e1/profile');
    expect(await screen.findByText('ICBC')).toBeInTheDocument();
    expect(screen.getByText(copy.profile.bankOnly)).toBeInTheDocument();
    expect(screen.queryByText(copy.fields.idNumber)).toBeNull();
    expect(
      screen.queryByRole('button', { name: copy.actions.editProfile }),
    ).toBeNull();
  });

  it('explains a section the server refuses', async () => {
    answer({
      'GET employees/e1': { data: EMPLOYEE },
      'GET employees/e1/profile': apiError(403),
    });
    renderEmployee('/employees/e1/profile');
    expect(
      await screen.findByText(copy.error.tabForbidden),
    ).toBeInTheDocument();
  });

  it('corrects a status only with a reason, then shows the result', async () => {
    granted.add('oa.employees.archive:correctStatus');
    const corrected = { ...EMPLOYEE, status: 'regular' };
    answer({
      'GET employees/e1': { data: EMPLOYEE },
      'POST employees/e1/correctStatus': { data: corrected },
    });
    const router = renderEmployee('/employees/e1/basic/correctStatus');
    const dialog = await screen.findByRole('dialog', {
      name: copy.correction.title,
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.correction.submit }),
    );
    expect(
      await within(dialog).findByText(copy.correction.reasonRequired),
    ).toBeInTheDocument();
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' }),
    );

    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(copy.correction.reason, 'u')),
      'Approved on paper',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.correction.submit }),
    );
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'employees/e1/correctStatus',
          method: 'POST',
          json: expect.objectContaining({
            status: 'probation',
            reason: 'Approved on paper',
          }),
        }),
      ),
    );
    expect(toaster.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/employees/e1/basic'),
    );
    expect(reloadOwner).toHaveBeenCalled();
  });

  it('lists history with translated kinds and changes', async () => {
    answer({
      'GET employees/e1': { data: EMPLOYEE },
      'GET employees/e1/history': {
        data: [
          {
            id: 'h1',
            employeeId: 'e1',
            kind: 'correction',
            before: { status: 'probation' },
            after: { status: 'regular' },
            effectiveAt: '2026-10-05',
            sourceApplication: null,
            note: 'fix',
            createdById: 'u9',
            createdAt: '2026-10-05T00:00:00.000Z',
          },
        ],
        meta: { total: 1 },
      },
    });
    renderEmployee('/employees/e1/history');
    expect(
      await screen.findByText(copy.historyKind.correction),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${copy.status.probation} → ${copy.status.regular}`, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});

describe('directory', () => {
  it('shows contacts where returned and "not visible" where withheld', async () => {
    answer({
      'GET directory': {
        data: [
          {
            id: 'e1',
            userId: 'u1',
            code: 'E001',
            name: 'Alice Wang',
            manager: { id: 'e0', name: 'Bob Li' },
            primaryDepartment: { id: 'd1', title: 'Sales' },
            position: null,
            workLocation: null,
            phone: '13800000000',
            email: null,
          },
          {
            id: 'e2',
            userId: 'u2',
            code: 'E002',
            name: 'Carol Zhao',
            manager: null,
            primaryDepartment: null,
            position: null,
            workLocation: null,
          },
        ],
        meta: { page: 1, pageSize: 20, total: 2 },
      },
      'GET departments/options': DEPARTMENT_OPTIONS,
    });
    renderRoutes(
      [{ path: '/directory', element: <DirectoryPage /> }],
      '/directory?departmentId=d1',
    );
    const phone = await screen.findByRole('link', { name: '13800000000' });
    expect(phone).toHaveAttribute('href', 'tel:13800000000');
    const carol = screen.getByText('Carol Zhao').closest('tr')!;
    expect(
      within(carol).getAllByText(copy.directory.contactHidden),
    ).toHaveLength(2);
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'directory',
        query: expect.objectContaining({ departmentId: 'd1' }),
      }),
    );
  });
});
