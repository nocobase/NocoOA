import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../../../client/locales/en-US.js';
import copy from '../../../client/locales/modules/reimbursement-forms.en-US.js';
import { ReimbursementForm } from '../../../client/pages/reimbursement-requests/form-page.js';
import type {
  ReimbursementDetail,
  ReimbursementRecord,
} from '../../../client/pages/reimbursement-requests/types.js';
const { api, guard, navigate } = vi.hoisted(() => ({
  api: { request: vi.fn() },
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
  useCan: () => ({ can: true }),
}));
vi.mock('react-router', async (original) => ({
  ...(await original<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../client/components/user-picker.js', () => ({
  UserPicker: ({
    onChange,
  }: {
    onChange: (id: string, user: { id: string; name: string }) => void;
  }) => (
    <button
      type='button'
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
      reimbursementRequests: { ...en.reimbursementRequests, ...copy },
    },
  },
});
const record = {
  id: 'r1',
  number: null,
  applicantId: 'alice',
  reason: 'Original',
  authorizationId: null,
  loanId: null,
  offsetCents: 0,
  overrunReason: '',
  lines: [],
  status: 'draft',
  lifecycleVersion: 0,
  bindingCaptured: false,
  financeCorrectionLines: [],
  financeLineFacts: {},
} as unknown as ReimbursementRecord;
const options = {
  actorId: 'alice',
  applicantId: 'alice',
  timeZone: 'Asia/Shanghai',
  paymentAccountComplete: true,
  categories: [],
  authorizations: [],
  loans: [],
};
function show(
  detail?: ReimbursementDetail,
  path = '/reimbursementRequests/new',
) {
  return render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <ReimbursementForm detail={detail} allowed reload={vi.fn()} />
      </MemoryRouter>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({ data: path.endsWith('/options') ? options : { record } }),
  );
});
it('creates only an empty draft before upload and retains local row and input without navigating', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({
      data: path.endsWith('/options')
        ? options
        : path.endsWith('/findMany')
          ? [
              {
                id: 'f1',
                filename: 'Proof',
                ext: 'pdf',
                contentUrl: '/base/uploads/reimbursement/f1.pdf',
              },
            ]
          : path.endsWith('/uploadOne')
            ? {
                record: {
                  id: 'f1',
                  filename: 'Proof',
                  ext: 'pdf',
                  contentUrl: '/base/uploads/reimbursement/f1.pdf',
                },
              }
            : { record },
    }),
  );
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Typed reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add expense line' }));
  fireEvent.change(screen.getByLabelText('Invoice number *'), {
    target: { value: 'INV-LOCAL' },
  });
  fireEvent.change(screen.getByLabelText('Evidence files *'), {
    target: {
      files: [
        new File(['%PDF-proof'], 'proof.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reimbursementAttachments/uploadOne',
        headers: { 'x-reimbursement-request-id': 'r1' },
      }),
    ),
  );
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reimbursementRequests',
      json: expect.objectContaining({
        lines: [],
        offsetCents: 0,
        requestId: expect.any(String),
      }),
    }),
  );
  expect(screen.getByLabelText('Invoice number *')).toHaveValue('INV-LOCAL');
  expect(screen.getByLabelText('Reason *')).toHaveValue('Typed reason');
  expect(navigate).not.toHaveBeenCalled();
});
it('retries uncertain creation with identical key and payload and preserves edited text', async () => {
  let first = true;
  api.request.mockImplementation(({ path }: { path: string }) => {
    if (path.endsWith('/options')) return Promise.resolve({ data: options });
    if (path === 'reimbursementRequests' && first) {
      first = false;
      return Promise.reject(new TypeError('network'));
    }
    return Promise.resolve({ data: { record } });
  });
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Keep me' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await screen.findByRole('button', { name: 'Retry draft creation' });
  expect(screen.getByLabelText('Reason *')).toHaveValue('Keep me');
  fireEvent.click(screen.getByRole('button', { name: 'Retry draft creation' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Retry draft creation' }),
    ).toBeNull(),
  );
  const calls = api.request.mock.calls.filter(
    ([arg]) => arg.path === 'reimbursementRequests',
  );
  expect(calls).toHaveLength(2);
  expect(calls[1][0].json).toEqual(calls[0][0].json);
  expect(navigate).not.toHaveBeenCalled();
});
it('reads a conflicting latest version without replacing typed input, then writes its version', async () => {
  let writes = 0;
  api.request.mockImplementation(({ path }: { path: string }) => {
    if (path.endsWith('/options')) return Promise.resolve({ data: options });
    if (path.endsWith('/transition') && ++writes === 1)
      return Promise.reject(
        new ApiClientError('raw', { status: 409, method: 'POST', url: path }),
      );
    if (path === 'reimbursementRequests/r1')
      return Promise.resolve({
        data: { record: { ...record, lifecycleVersion: 7 } },
      });
    return Promise.resolve({ data: { record } });
  });
  show({
    record,
    users: [],
    view: { available: [] },
  } as unknown as ReimbursementDetail);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Retained' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Read latest version' }),
  );
  await screen.findByText(/Latest version read/);
  expect(screen.getByLabelText('Reason *')).toHaveValue('Retained');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          version: 7,
          input: expect.objectContaining({ reason: 'Retained' }),
        }),
      }),
    ),
  );
});
it('maps server field violations and focuses the field without clearing input', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('/options')
      ? Promise.resolve({ data: options })
      : Promise.reject(
          new ApiClientError('raw-secret', {
            status: 400,
            method: 'POST',
            url: path,
            payload: { error: { fieldViolations: [{ field: 'reason' }] } },
          }),
        ),
  );
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Keep' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await screen.findByText('Check this field and try again.');
  expect(screen.getByLabelText('Reason *')).toHaveFocus();
  expect(screen.getByLabelText('Reason *')).toHaveValue('Keep');
  expect(screen.queryByText('raw-secret')).toBeNull();
});
it('blocks navigation and repeated saves while a write is pending, then retains input on failure', async () => {
  let rejectWrite: (reason: unknown) => void = () => {};
  api.request.mockImplementation(({ path }: { path: string }) =>
    path.endsWith('/options')
      ? Promise.resolve({ data: options })
      : new Promise((_resolve, reject) => {
          rejectWrite = reject;
        }),
  );
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Pending text' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeDisabled(),
  );
  expect(guard()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  expect(
    api.request.mock.calls.filter(([a]) => a.path === 'reimbursementRequests'),
  ).toHaveLength(1);
  rejectWrite(
    new ApiClientError('invalid', {
      status: 400,
      method: 'POST',
      url: 'reimbursementRequests',
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Reason *')).toHaveValue('Pending text');
});
it('locks approved and pending finance lines, permits only returned deletion, and prevents adding rows', async () => {
  const base = {
    category: 'travel',
    date: '2026-10-10',
    amountCents: 100,
    invoiceNumber: 'INV',
    attachmentIds: ['f1'],
    standardExceptionReason: '',
  };
  const correction = {
    ...record,
    status: 'revision',
    bindingCaptured: true,
    authorizationId: 'bound-a',
    loanId: 'bound-l',
    lines: [
      { ...base, id: 'approved' },
      { ...base, id: 'pending' },
      { ...base, id: 'returned' },
    ],
    financeCorrectionLines: [
      { ...base, id: 'approved' },
      { ...base, id: 'pending' },
      { ...base, id: 'returned' },
    ],
    financeLineFacts: {
      approved: { outcome: 'approved', contentHash: 'a' },
      pending: { outcome: 'pending', contentHash: 'p' },
      returned: { outcome: 'returned', contentHash: 'r' },
    },
  } as ReimbursementRecord;
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({ data: path.endsWith('/options') ? options : [] }),
  );
  show({
    record: correction,
    users: [],
    view: { available: [] },
  } as unknown as ReimbursementDetail);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled(),
  );
  expect(screen.getByLabelText('Expense authorization')).toBeDisabled();
  expect(screen.getByLabelText('Issued loan')).toBeDisabled();
  const amounts = screen.getAllByLabelText('Amount *');
  expect(amounts[0]).toBeDisabled();
  expect(amounts[1]).toBeDisabled();
  expect(amounts[2]).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Add expense line' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Remove line' })).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove line' }));
  expect(screen.getAllByLabelText('Amount *')).toHaveLength(2);
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reimbursementRequests/options',
      query: expect.objectContaining({ applicantId: 'alice', recordId: 'r1' }),
    }),
  );
});

afterEach(cleanup);

it.each([
  ['/reimbursementRequests/new', '../edit/r1'],
  ['/approvals/mine/newReimbursement', '../editReimbursement/r1'],
  ['/newReimbursement', '../editReimbursement/r1'],
])(
  'saves a new draft within its originating route: %s',
  async (path, destination) => {
    show(undefined, path);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Reason *'), {
      target: { value: 'Keep this source' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        { pathname: destination, search: '' },
        { relative: 'route', replace: true },
      ),
    );
  },
);

it('keeps the delegated applicant name after first upload persists the draft', async () => {
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({
      data: path.endsWith('/options')
        ? options
        : path.endsWith('/uploadOne')
          ? { record: { id: 'f1', filename: 'Proof', ext: 'pdf' } }
          : path.endsWith('/findMany')
            ? []
            : { record: { ...record, applicantId: 'bob' } },
    }),
  );
  show();
  await screen.findByRole('button', { name: 'Choose Bob' });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Bob' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Delegated reason' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add expense line' }));
  fireEvent.change(screen.getByLabelText('Evidence files *'), {
    target: {
      files: [new File(['proof'], 'proof.pdf', { type: 'application/pdf' })],
    },
  });
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'reimbursementAttachments/uploadOne' }),
    ),
  );
  expect(screen.getByText('Bob Delegate')).toBeInTheDocument();
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reimbursementRequests',
      json: expect.objectContaining({ applicantId: 'bob', lines: [] }),
    }),
  );
  expect(screen.queryByText('Applicant: Alice')).toBeNull();
});
it('uses a synchronous guard and allows only the next navigation after discard confirmation', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Keep input' },
  });
  let decision: boolean;
  act(() => {
    decision = guard();
  });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(decision!).toBe(false);
  expect(screen.getByLabelText('Reason *')).toHaveValue('Keep input');
  act(() => {
    decision = guard();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(decision!).toBe(false);
  expect(
    screen.getByText(/Click your intended destination again/),
  ).toBeInTheDocument();
  expect(guard()).toBe(true);
  act(() => {
    decision = guard();
  });
  expect(decision!).toBe(false);
});

it('revokes discard permission when the user continues editing after confirmation', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled(),
  );
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'First edit' },
  });
  act(() => {
    expect(guard()).toBe(false);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(
    screen.getByText(/Click your intended destination again/),
  ).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Reason *'), {
    target: { value: 'Further edit' },
  });
  expect(
    screen.queryByText(/Click your intended destination again/),
  ).toBeNull();
  act(() => {
    expect(guard()).toBe(false);
  });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  fireEvent.change(screen.getByLabelText('Reason *'), {
    target: { value: 'Another edit' },
  });
  act(() => {
    expect(guard()).toBe(false);
  });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Reason *')).toHaveValue('Another edit');
});

it('marks the submission reason and explains missing reason or expense lines before sending a write', async () => {
  show();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Submit/ })).toBeEnabled(),
  );
  const reason = screen.getByLabelText('Reason *');
  fireEvent.change(reason, { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: /^Submit/ }));
  expect(await screen.findByText('Complete this field.')).toBeVisible();
  expect(reason).toHaveFocus();
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  fireEvent.change(reason, { target: { value: 'Office supplies' } });
  fireEvent.click(screen.getByRole('button', { name: /^Submit/ }));
  expect(
    await screen.findByText(
      'Add at least one complete expense line before submitting for approval.',
    ),
  ).toBeVisible();
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
});

it('blocks the complete form before entry when the payment account is incomplete and rechecks without losing input', async () => {
  let complete = false;
  api.request.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve({
      data: path.endsWith('/options')
        ? { ...options, paymentAccountComplete: complete }
        : { record },
    }),
  );
  show();
  expect(screen.getByLabelText('Reason *')).toBeDisabled();
  const refresh = await screen.findByRole('button', {
    name: 'Check payment account again',
  });
  expect(
    screen.getByText(en.reimbursementRequests.errors.paymentAccountRequired),
  ).toBeVisible();
  expect(screen.getByLabelText('Reason *')).toBeDisabled();
  expect(screen.getByLabelText('Loan offset *')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Add expense line' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: /Save draft/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: /^Submit/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
  expect(api.request.mock.calls.some(([call]) => call.method === 'POST')).toBe(
    false,
  );
  complete = true;
  fireEvent.click(refresh);
  await waitFor(() => expect(screen.getByLabelText('Reason *')).toBeEnabled());
  expect(screen.getByRole('button', { name: /Save draft/ })).toBeEnabled();
  expect(
    screen.queryByText(en.reimbursementRequests.errors.paymentAccountRequired),
  ).toBeNull();
});

it('allows HR to switch away from an applicant with an incomplete account and checks the new applicant', async () => {
  api.request.mockImplementation(
    ({ path, query }: { path: string; query?: { applicantId?: string } }) =>
      Promise.resolve({
        data: path.endsWith('/options')
          ? {
              ...options,
              applicantId: query?.applicantId,
              paymentAccountComplete: query?.applicantId === 'bob',
            }
          : { record },
      }),
  );
  show();
  await screen.findByRole('button', { name: 'Check payment account again' });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Bob' }));
  await waitFor(() => expect(screen.getByLabelText('Reason *')).toBeEnabled());
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reimbursementRequests/options',
      query: { applicantId: 'bob' },
    }),
  );
});
