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
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import enUS from '../../client/locales/en-US.js';
import Form from '../../client/pages/attendance-change/form-dialog.js';
const { api, close } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  close: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'alice' } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: ({ action }: { action: string }) => ({
    can: action !== 'delegate',
    isPending: false,
  }),
}));
vi.mock('../../client/components/route-drawer.js', () => ({
  RouteDrawer: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock('../../client/components/use-route-overlay.js', () => ({
  useRouteOverlay: () => ({ close }),
}));
vi.mock('../../client/components/date-time-picker.js', () => ({
  DateTimePicker: ({
    id,
    value,
    onChange,
    disabled,
  }: {
    id: string;
    value?: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const record = {
  id: 'r1',
  applicantId: 'alice',
  createdById: 'alice',
  number: null,
  originalAttendanceId: 'punch-1',
  originalVersion: 1,
  date: '2026-10-13',
  correctionAt: '2026-10-13T01:00:00Z',
  reason: 'Forgot to punch',
  proof: '',
  attachments: [],
  status: 'draft',
  lifecycleVersion: 1,
};
function show() {
  const router = createMemoryRouter(
    [
      {
        path: '/requests',
        element: <Outlet context={{ reload: vi.fn() }} />,
        children: [{ path: ':requestId/edit', element: <Form /> }],
      },
    ],
    { initialEntries: ['/requests/r1/edit'] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockImplementation(
    ({ path, method }: { path: string; method?: string }) => {
      if (path.endsWith('/options'))
        return Promise.resolve({ data: { timeZone: 'Asia/Singapore' } });
      if (path.endsWith('/missingPunches'))
        return Promise.resolve({
          data: [
            { id: 'punch-1', date: record.date, punchKind: 'in', version: 1 },
          ],
        });
      if (method === 'POST') return Promise.resolve({ data: { record } });
      return Promise.resolve({
        data: {
          record,
          view: { available: [{ name: 'edit', allowed: true }] },
          timeZone: 'Asia/Singapore',
        },
      });
    },
  );
});
afterEach(cleanup);
it('requires a proof statement or evidence only when submitting, and focuses the proof field', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(
    await screen.findByText(
      enUS.attendanceChange.errors.ATTENDANCE_CHANGE_PROOF_REQUIRED,
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.getElementById('business-proof')).toHaveFocus(),
  );
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(
    api.request.mock.calls.filter(([call]) => call.method === 'POST'),
  ).toHaveLength(1);
});
it('accepts a proof statement without requiring an attachment', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled(),
  );
  fireEvent.change(document.getElementById('business-proof')!, {
    target: { value: 'Meeting arrival record' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(
    api.request.mock.calls.filter(([call]) => call.method === 'POST'),
  ).toHaveLength(2);
});
