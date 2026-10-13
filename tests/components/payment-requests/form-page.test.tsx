import { ApiClientError } from '@nocobase/app-client';
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
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../../../client/locales/en-US.js';
import copy from '../../../client/locales/modules/payment-requests-form.en-US.js';
import PaymentFormPage, {
  PaymentForm,
} from '../../../client/pages/payment-requests/form-page.js';
import type {
  PaymentDetail,
  PaymentRecord,
} from '../../../client/pages/payment-requests/types.js';
const { api, guard, navigate, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true, isPending: false },
  guard: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
  useNavigationGuard: (fn: () => boolean) => guard.mockImplementation(fn),
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({
    session: { user: { id: 'alice', name: 'Alice' } },
  }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => 0,
  useCan: () => permission,
}));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../client/components/route-child-page.js', () => ({
  RouteChildPage: ({ children }: { children: import('react').ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../../../client/components/user-picker.js', () => ({
  UserPicker: ({
    onChange,
    disabled,
  }: {
    disabled?: boolean;
    onChange: (id: string, user: { id: string; name: string }) => void;
  }) => (
    <button
      type='button'
      disabled={disabled}
      onClick={() => onChange('bob', { id: 'bob', name: 'Bob Delegate' })}
    >
      Choose Bob
    </button>
  ),
}));
const runtime = await createTestI18nRuntime({
  application: {
    namespace: 'nb3-oa',
    resources: {
      ...en,
      ...copy,
    },
  },
});
const record = {
  id: 'r1',
  number: null,
  applicantId: 'alice',
  createdById: 'alice',
  reason: 'Original',
  sourceMode: 'purchase',
  purchaseOrderId: null,
  contractId: null,
  noPriorApprovalReason: '',
  vendorId: null,
  amountCents: 0,
  invoiceNumber: '',
  attachments: [],
  paymentMethod: '',
  status: 'draft',
  lifecycleVersion: 0,
} as unknown as PaymentRecord;
const options = {
  actorId: 'alice',
  applicantId: 'alice',
  applicant: { id: 'alice', name: 'Alice' },
  timeZone: 'Asia/Shanghai',
  vendors: [],
  orders: [],
  paymentMethods: [],
};
function show(detail?: PaymentDetail, path = '/paymentRequests/new') {
  return render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <PaymentForm detail={detail} allowed reload={vi.fn()} />
      </MemoryRouter>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  permission.can = true;
  permission.isPending = false;
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({ data: path.endsWith('/options') ? options : { record } }),
  );
});

it('creates an empty evidence-owned draft without dropping local inputs or navigating', async () => {
  api.request.mockImplementation(({ path }) =>
    Promise.resolve({
      data: path.endsWith('/options')
        ? options
        : path.endsWith('/findMany')
          ? []
          : path.endsWith('/uploadOne')
            ? {
                record: {
                  id: 'f1',
                  filename: 'proof',
                  ext: 'pdf',
                  contentUrl: '/base/uploads/payment/proof.pdf',
                },
              }
            : { record },
    }),
  );
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Payment reason *'), {
    target: { value: 'Unsaved reason' },
  });
  fireEvent.change(screen.getByLabelText('Invoice number *'), {
    target: { value: 'Unsaved invoice' },
  });
  fireEvent.change(screen.getByLabelText('Invoice evidence *'), {
    target: {
      files: [
        new File(['%PDF-proof'], 'proof.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'paymentAttachments/uploadOne',
        headers: {
          'x-payment-request-id': 'r1',
          'x-payment-file-purpose': 'invoice',
        },
      }),
    ),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'paymentRequests',
      json: expect.objectContaining({
        reason: '',
        amountCents: 0,
        attachments: [],
        requestId: expect.any(String),
      }),
    }),
  );
  expect(screen.getByLabelText('Payment reason *')).toHaveValue(
    'Unsaved reason',
  );
  expect(screen.getByLabelText('Invoice number *')).toHaveValue(
    'Unsaved invoice',
  );
  expect(navigate).not.toHaveBeenCalled();
});
it('locks uncertain creation and replays exactly the same payload and key', async () => {
  let first = true;
  api.request.mockImplementation(({ path }) => {
    if (path.endsWith('/options')) return Promise.resolve({ data: options });
    if (path === 'paymentRequests' && first) {
      first = false;
      return Promise.reject(new TypeError('Network'));
    }
    return Promise.resolve({ data: { record } });
  });
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Payment reason *'), {
    target: { value: 'Keep exact' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByRole('button', { name: 'Reconcile the original request' });
  expect(screen.getByLabelText('Payment reason *')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Choose Bob' })).toBeDisabled();
  const original = api.request.mock.calls.find(
    ([v]) => v.path === 'paymentRequests',
  )![0];
  fireEvent.click(
    screen.getByRole('button', { name: 'Reconcile the original request' }),
  );
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  const commands = api.request.mock.calls.filter(
    ([v]) => v.path === 'paymentRequests',
  );
  expect(commands).toHaveLength(2);
  expect(commands[1][0].json).toEqual(original.json);
});
it('focuses an invalid amount and never sends rounded cents', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Amount (yuan) *'), {
    target: { value: '1.001' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Amount (yuan) *')).toHaveFocus(),
  );
  expect(api.request.mock.calls.some(([v]) => v.method === 'POST')).toBe(false);
});
afterEach(cleanup);
it('reacts to delayed permission resolution and revokes editing when that permission disappears', async () => {
  const content = (allowed: boolean) => (
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>
        <PaymentForm allowed={allowed} reload={vi.fn()} />
      </MemoryRouter>
    </TestI18nProvider>
  );
  const view = render(content(false));
  await waitFor(() => expect(api.request).toHaveBeenCalled());
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  view.rerender(content(true));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  view.rerender(content(false));
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.getByLabelText('Payment reason *')).toBeDisabled();
});
it('keeps a freshly revoked business offer closed even if the parent retains its former allowed value', async () => {
  let save = true;
  api.request.mockImplementation(({ path, method }) => {
    if (path.endsWith('/options')) return Promise.resolve({ data: options });
    if (method === 'POST' && save) {
      save = false;
      return Promise.reject(
        new ApiClientError('Conflict', {
          status: 409,
          method: 'POST',
          url: '/paymentRequests/r1/transition',
        } as ConstructorParameters<typeof ApiClientError>[1]),
      );
    }
    return Promise.resolve({
      data: {
        record: { ...record, lifecycleVersion: 1 },
        view: { available: [] },
      },
    });
  });
  const detail = {
    record,
    users: [],
    view: { available: [{ name: 'edit', allowed: true }] },
  } as unknown as PaymentDetail;
  show(detail);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Payment reason *'), {
    target: { value: 'Keep edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByRole('button', { name: 'Load latest' });
  fireEvent.click(screen.getByRole('button', { name: 'Load latest' }));
  await screen.findByText(/Latest version loaded/);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.getByLabelText('Payment reason *')).toHaveValue('Keep edit');
});

it('opens a direct new URL after asynchronous useCan resolves and disables it again on permission revocation', async () => {
  permission.can = false;
  permission.isPending = true;
  const content = () => (
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={['/paymentRequests/new']}>
        <PaymentFormPage />
      </MemoryRouter>
    </TestI18nProvider>
  );
  const view = render(content());
  expect(
    screen.queryByRole('button', { name: 'Save draft' }),
  ).not.toBeInTheDocument();
  permission.can = true;
  permission.isPending = false;
  view.rerender(content());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled(),
  );
  permission.can = false;
  view.rerender(content());
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

it('shows the selected purchase order actual status alongside its monetary facts', async () => {
  api.request.mockResolvedValue({
    data: {
      ...options,
      orders: [
        {
          id: 'order-1',
          number: 'PO-1',
          applicantId: 'alice',
          applicant: { id: 'alice', name: 'Alice' },
          vendor: { id: 'vendor-1', name: 'Vendor' },
          status: 'accepted',
          actualCents: 10000,
          paidCents: 2000,
          pendingCents: 1000,
        },
      ],
    },
  });
  show({
    record: { ...record, purchaseOrderId: 'order-1' },
    users: [{ id: 'alice', name: 'Alice' }],
    view: { available: [{ name: 'edit', allowed: true }] },
  } as unknown as PaymentDetail);
  expect(await screen.findByText('Received')).toHaveAttribute(
    'data-slot',
    'badge',
  );
  expect(screen.getByText('Order status')).toBeInTheDocument();
});

it('explains missing submission facts on their fields without writing, while preserving incomplete drafts', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findAllByText('This field is required.');
  expect(screen.getByLabelText('Payment reason *')).toHaveFocus();
  expect(screen.getByLabelText('Invoice number *')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(([call]) => call.method === 'POST'),
    ).toBe(true),
  );
});
