import { NavigationGuardProvider } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import LoansPage from '../../../client/pages/loan-requests/index.js';
import { LoanFinancialSections } from '../../../client/pages/loan-requests/repayments.js';
import type { LoanRequestRecord } from '../../../client/pages/loan-requests/types.js';
import LoanForm from '../../../client/pages/loan-requests/form-dialog.js';
const { api, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => ({ can: permission.can, isPending: false }),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: 'u1' } } }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const record = {
  id: 'l1',
  applicantId: 'u1',
  createdById: 'u1',
  applicant: { id: 'u1', name: 'Borrower' },
  number: null,
  reason: 'Advance',
  amountCents: 100,
  dueDate: '2026-12-31',
  travelId: null,
  status: 'draft',
  lifecycleVersion: 3,
};
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
};
function reads(request: Request) {
  if (request.path === 'loanRequests/options')
    return Promise.resolve({
      data: {
        timeZone: 'Asia/Shanghai',
        paymentAccountReady: true,
        travelSources: [],
        rules: {},
      },
    });
  if (request.path === 'loanRequests/l1')
    return Promise.resolve({
      data: { record, view: { available: [{ name: 'edit', allowed: true }] } },
    });
  return Promise.resolve({
    data: [record],
    meta: { page: 1, pageSize: 20, total: 1 },
  });
}
function show(path = '/loanRequests') {
  const router = createMemoryRouter(
    [
      {
        path: '/loanRequests',
        element: (
          <NavigationGuardProvider>
            <LoansPage />
          </NavigationGuardProvider>
        ),
        children: [
          { path: 'new', element: <LoanForm /> },
          { path: 'edit/:requestId', element: <LoanForm /> },
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
  vi.clearAllMocks();
  permission.can = true;
  api.request.mockImplementation(reads);
});
describe('loan request browser components', () => {
  it('keeps the table headers and creation action visible when no requests exist', async () => {
    api.request.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    show();
    await screen.findByText('No loan requests');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Reference' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Loan purpose' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'New loan request' }),
    ).toHaveLength(1);
    expect(
      screen
        .getByRole('button', { name: 'New loan request' })
        .closest('[data-slot=application-actions]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Work list' }),
    ).toHaveTextContent('My requests');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent(
      'All statuses',
    );
  });
  it('keeps an empty filtered table and clears filters without losing the selected work list', async () => {
    api.request.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });
    const router = show('/loanRequests?search=missing&status=paid&view=done');
    await screen.findByText('No matching loan requests');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByText('No loan requests');
    expect(router.state.location.search).toBe('?view=done');
    expect(
      screen.getByRole('textbox', { name: 'Number, purpose or applicant' }),
    ).toHaveFocus();
  });
  it('clamps pagination from server facts and hides creation from read-only users', async () => {
    permission.can = false;
    const router = show('/loanRequests?page=999');
    await screen.findByText('Borrower');
    await waitFor(() => expect(router.state.location.search).toBe('?page=1'));
    expect(
      screen.queryByRole('button', { name: 'New loan request' }),
    ).toBeNull();
  });
  it('shows the first invalid field and focuses it before sending a mutation', async () => {
    api.request.mockImplementation((r: Request) =>
      r.path === 'loanRequests/l1'
        ? Promise.resolve({
            data: {
              record: { ...record, reason: '' },
              view: { available: [{ name: 'edit', allowed: true }] },
            },
          })
        : reads(r),
    );
    show('/loanRequests/edit/l1');
    const user = userEvent.setup();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(document.getElementById('loan-reason')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(document.activeElement).toBe(document.getElementById('loan-reason'));
    expect(api.request.mock.calls.some(([r]) => r.method === 'POST')).toBe(
      false,
    );
  });
  it('keeps exact cents and the same retry key, and blocks changed content while the result is unknown', async () => {
    const writes: Record<string, unknown>[] = [];
    api.request.mockImplementation((r: Request) => {
      if (r.method === 'POST') {
        writes.push(r.json!);
        return Promise.reject(new Error('Connection interrupted'));
      }
      return reads(r);
    });
    show('/loanRequests/edit/l1');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('Amount *');
    await user.clear(input);
    await user.type(input, '0.10');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0].requestId).toBe(writes[1].requestId);
    expect(writes[0].input).toMatchObject({ amountCents: 10 });
    await user.clear(input);
    await user.type(input, '0.20');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
    );
    expect(writes).toHaveLength(2);
    expect(input).toHaveValue('0.20');
  });
  it('preserves edits on a conflict and uses fresh version only after explicit acceptance', async () => {
    const { ApiClientError } = await import('@nocobase/app-client');
    let readCount = 0;
    const writes: Record<string, unknown>[] = [];
    api.request.mockImplementation((r: Request) => {
      if (r.method === 'POST') {
        writes.push(r.json!);
        return writes.length === 1
          ? Promise.reject(
              new ApiClientError('Version changed', {
                status: 409,
                method: 'POST',
                url: '/api/loanRequests/l1/transition',
                reason: 'STALE_VERSION',
              } as ConstructorParameters<typeof ApiClientError>[1]),
            )
          : Promise.resolve({ data: { record } });
      }
      if (r.path === 'loanRequests/l1') {
        readCount++;
        return Promise.resolve({
          data: {
            record: {
              ...record,
              lifecycleVersion: readCount === 1 ? 3 : 4,
              reason: readCount === 1 ? 'Advance' : 'Concurrent change',
            },
            view: { available: [{ name: 'edit', allowed: true }] },
          },
        });
      }
      return reads(r);
    });
    show('/loanRequests/edit/l1');
    const user = userEvent.setup();
    const reason = await screen.findByLabelText('Loan purpose *');
    await user.clear(reason);
    await user.type(reason, 'My retained reason');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('button', { name: 'Load latest facts' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Load latest facts' }));
    await screen.findByText(/Concurrent change/);
    expect(reason).toHaveValue('My retained reason');
    await user.click(
      screen.getByRole('button', {
        name: 'Keep my input and use this version',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({
      version: 4,
      input: { reason: 'My retained reason' },
    });
    expect(writes[1].requestId).not.toBe(writes[0].requestId);
  });
});

it.each([4000, '4000', Number.MAX_SAFE_INTEGER + 1])(
  'contains invalid repayment amounts locally (%s)',
  async (cents) => {
    api.request.mockResolvedValue({
      data: {
        reservations: [
          {
            id: 'r1',
            reference: 'CASH-1',
            kind: 'cash',
            state: 'pending',
            cents,
          },
        ],
      },
    });
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <LoanFinancialSections
            record={{ ...record, status: 'paid' } as LoanRequestRecord}
            reload={vi.fn()}
          />
        ),
      },
    ]);
    render(
      <TestI18nProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TestI18nProvider>,
    );
    if (typeof cents === 'number' && Number.isSafeInteger(cents)) {
      expect(await screen.findByText('40.00')).toBeVisible();
    } else {
      expect(
        await screen.findByText(
          'Repayment amounts could not be read. Contact finance to check this record.',
        ),
      ).toBeVisible();
      expect(screen.queryByText('CASH-1')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'More actions' }),
      ).not.toBeInTheDocument();
    }
  },
);
