import { Failure } from '../../../client/pages/attendance-management/states.js';
import { ApiClientError, NavigationGuardProvider } from '@nocobase/app-client';
import userEvent from '@testing-library/user-event';
import ShiftForm from '../../../client/pages/attendance-management/shift-form.js';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { default as Page } from '../../../client/pages/attendance-management/index.js';
const state = vi.hoisted(() => ({
  request: vi.fn(),
  actor: 'hr',
  revision: 0,
  manage: true,
  view: true,
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
  useCan: ({ action }: { action: 'view' | 'manage' }) => ({
    can: state[action],
    isPending: false,
  }),
}));

vi.mock('#components/department-picker', () => ({
  DepartmentPicker: ({ value }: { value: string }) => <span>{value}</span>,
}));
import {
  createMemoryRouter,
  RouterProvider,
  MemoryRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router';
import { useEffect } from 'react';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../../client/locales/en-US.js';
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
function show(path = '/attendance-management') {
  const router = createMemoryRouter(
    [
      {
        path: '/attendance-management',
        element: (
          <NavigationGuardProvider>
            <Page />
          </NavigationGuardProvider>
        ),
        children: [{ path: ':shiftId/edit', element: <ShiftForm /> }],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return { router, ...view };
}
function guardedShow(path: string) {
  const router = { state: { location: { pathname: '', search: '' } } };
  const observe = (location: { pathname: string; search: string }) => {
    router.state.location = location;
  };
  render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationGuardProvider>
          <LocationProbe observe={observe} />
          <Routes>
            <Route path='/attendance-management' element={<Page />}>
              <Route path=':shiftId/edit' element={<ShiftForm />} />
            </Route>
          </Routes>
        </NavigationGuardProvider>
      </MemoryRouter>
    </TestI18nProvider>,
  );
  return { router };
}
function LocationProbe({
  observe,
}: {
  observe: (location: { pathname: string; search: string }) => void;
}) {
  const location = useLocation();
  useEffect(() => observe(location), [location, observe]);
  return null;
}
afterEach(() => {
  cleanup();
  state.request.mockReset();
  state.manage = true;
  state.view = true;
});
describe('attendance configuration page', () => {
  it('keeps initiation and table headers in the loaded empty state and sends URL filters', async () => {
    state.request.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve(
        path.endsWith('/context')
          ? { data: { timeZone: 'Asia/Shanghai' } }
          : { data: [], meta: { total: 0, page: 2, pageSize: 10 } },
      ),
    );
    show(
      '/attendance-management?search=night&page=2&pageSize=10&enabled=false&sort=name&direction=desc',
    );
    await screen.findByText('No shifts match the filters.');
    expect(
      screen.getByRole('button', { name: 'Add shift' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Shift code' }),
    ).toBeInTheDocument();
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'attendanceManagement/shifts',
        query: {
          page: '2',
          pageSize: '10',
          search: 'night',
          enabled: 'false',
          sort: 'name',
          direction: 'desc',
        },
      }),
    );
  });
  it('hides initiation without manage permission and does not fetch any data without view', async () => {
    state.manage = false;
    state.view = false;
    show();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Add shift' }),
      ).not.toBeInTheDocument(),
    );
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'distinguishes an unconfigured day from explicit rest (%s)',
    async (rest) => {
      state.request.mockImplementation(({ path }: { path: string }) =>
        Promise.resolve(
          path.endsWith('/context')
            ? { data: { timeZone: 'Asia/Shanghai' } }
            : path.endsWith('/schedule')
              ? {
                  data: rest
                    ? {
                        id: 's1',
                        departmentId: 'd1',
                        date: '2026-10-11',
                        version: 1,
                        revision: {
                          id: 'sr1',
                          revision: 1,
                          shiftRevisionId: null,
                          restDay: true,
                          reason: 'Sunday',
                          createdBy: { id: 'hr', name: 'HR' },
                          createdAt: '2026-10-10T00:00:00Z',
                        },
                      }
                    : null,
                }
              : { data: [], meta: { total: 0, page: 1, pageSize: 20 } },
        ),
      );
      show(
        '/attendance-management?tab=schedule&departmentId=d1&date=2026-10-11',
      );
      if (rest) {
        await screen.findByText('Explicit rest day');
        expect(
          screen.queryByText(/Attendance evaluation remains blocked/),
        ).not.toBeInTheDocument();
      } else {
        await screen.findByText(
          'No schedule is configured for this department and date. Attendance evaluation remains blocked.',
        );
        expect(screen.queryByText('Explicit rest day')).not.toBeInTheDocument();
      }
    },
  );
  it('returns to the exact list URL after successful save instead of blocking navigation as busy', async () => {
    const shift = {
      id: 's1',
      code: 'DAY',
      name: 'Day shift',
      enabled: true,
      currentRevision: 1,
      version: 1,
    };
    const revision = {
      id: 'r1',
      shiftId: 's1',
      revision: 1,
      code: 'DAY',
      name: 'Day shift',
      timeZone: 'Asia/Shanghai',
      intervals: [
        { start: '09:00', startDayOffset: 0, end: '18:00', endDayOffset: 0 },
      ],
      lateToleranceMinutes: 5,
      earlyToleranceMinutes: 5,
      absenceThresholdMinutes: 60,
      reason: 'Initial',
      createdBy: { id: 'hr', name: 'HR' },
      createdAt: '2026-10-10T00:00:00Z',
    };
    state.request.mockImplementation(
      ({ path, method }: { path: string; method?: string }) =>
        Promise.resolve(
          method === 'POST'
            ? { data: { ...shift, version: 2, currentRevision: 2 } }
            : path.endsWith('/context')
              ? { data: { timeZone: 'Asia/Shanghai' } }
              : path.endsWith('/s1')
                ? { data: { shift, revision } }
                : { data: [shift], meta: { total: 1, page: 1, pageSize: 20 } },
        ),
    );
    const { router } = guardedShow(
      '/attendance-management/s1/edit?search=DAY&enabled=true',
    );
    const reason = await screen.findByLabelText(/Reason for change/);
    await userEvent.clear(reason);
    await userEvent.type(reason, 'Changed rules');
    const back = screen.getByRole('link', { name: 'Back' });
    expect(back).toHaveAttribute(
      'href',
      '/attendance-management?search=DAY&enabled=true',
    );
    await userEvent.click(back);
    expect(router.state.location.pathname).toBe(
      '/attendance-management/s1/edit',
    );
    await screen.findByText('Discard unsaved changes?');
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue editing' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save', exact: true }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/attendance-management'),
    );
    expect(router.state.location.search).toBe('?search=DAY&enabled=true');
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        json: expect.objectContaining({ expectedVersion: 1 }),
      }),
    );
  });
  it('does not offer retry for explicit denied state even when a callback exists', () => {
    render(
      <TestI18nProvider runtime={runtime}>
        <Failure error={undefined} denied retry={vi.fn()} />
      </TestI18nProvider>,
    );
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });
  it('shows one terminal context refusal and hides creation even when coarse manage permission is granted', async () => {
    state.view = true;
    state.manage = true;
    state.request.mockRejectedValue(
      new ApiClientError('Denied', {
        status: 403,
        method: 'GET',
        url: 'attendanceManagement/context',
      }),
    );
    show();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
    expect(
      screen.queryByRole('button', { name: 'Add shift' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });
});
