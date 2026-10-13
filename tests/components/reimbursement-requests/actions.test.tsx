import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Routes, Route } from 'react-router';
import en from '../../../client/locales/en-US.js';
import copy from '../../../client/locales/modules/reimbursement-actions.en-US.js';
import { ActionForm } from '../../../client/pages/reimbursement-requests/action-dialog.js';
import type { ReimbursementDetail } from '../../../client/pages/reimbursement-requests/types.js';
import type { OfferedAction } from '@nocobase/app-plugin-approval/client';
const { api, close, picker } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  close: vi.fn(),
  picker: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('../../../client/components/use-route-overlay.js', () => ({
  useRouteOverlay: () => ({ close }),
}));
vi.mock('../../../client/components/approval-recipient-picker.js', () => ({
  ApprovalRecipientPicker: (props: {
    id: string;
    onChange: (v: string) => void;
    target: unknown;
  }) => {
    picker(props);
    return (
      <input id={props.id} onChange={(e) => props.onChange(e.target.value)} />
    );
  },
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
const detail = {
  record: {
    id: 'r1',
    number: 'R-1',
    reason: 'Business expense',
    totalCents: 10000,
    offsetCents: 2500,
    lifecycleVersion: 3,
    lines: [
      {
        id: 'line-1',
        date: '2026-10-10',
        category: 'office',
        invoiceNumber: 'INV',
        amountCents: 10000,
        attachmentIds: ['evidence-1'],
      },
    ],
  },
  users: [],
  view: { available: [] },
  runs: [],
  taskActions: [],
  runActions: [],
} as unknown as ReimbursementDetail;
function offered(
  name: string,
  target: { taskId: string } | { runId: string } = { taskId: 't1' },
): OfferedAction {
  return {
    name,
    target,
    task: { id: 't1', subject: 'line-1', stage: 'finance' },
    run: null,
    options: {},
    contentHash: 'full-submitted-run-hash',
    reasonRequired: false,
    key: name,
    primary: true,
    tone: 'normal',
    onBehalfOf: null,
  } as unknown as OfferedAction;
}
function show(
  name: string,
  action?: OfferedAction,
  current = detail,
  path = '/action',
  parentContext = { reload: vi.fn(), reloadDetail: vi.fn() } as {
    reload?: () => void;
    reloadDetail?: () => void;
  },
) {
  const parentPath = path.split('/action')[0] || '/';
  render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={parentPath} element={<Outlet context={parentContext} />}>
            <Route
              path={
                parentPath === '/' ? 'action' : 'action/:actionName/:targetId'
              }
              element={
                <>
                  <ActionForm
                    detail={current}
                    name={name}
                    targetId={
                      action
                        ? 'taskId' in action.target
                          ? action.target.taskId
                          : action.target.runId
                        : 'r1'
                    }
                    action={action}
                    allowed
                    onBusy={vi.fn()}
                    onDirty={vi.fn()}
                    onComplete={vi.fn()}
                    reload={vi.fn()}
                  />
                  <button type='submit' form='reimbursement-action'>
                    Apply
                  </button>
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </TestI18nProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockResolvedValue({ data: {} });
  close.mockResolvedValue(undefined);
});
it('submits from the action form without a second confirmation and prevents duplicate writes', async () => {
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve)),
  );
  show('submit', undefined, {
    ...detail,
    view: { available: [{ name: 'submit', allowed: true }] },
  } as unknown as ReimbursementDetail);
  expect(screen.getByText(copy.actionForm.submitConsequence)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledOnce());
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(api.request).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      path: 'reimbursementRequests/r1/transition',
      json: {
        transition: 'submit',
        version: 3,
        input: {},
        requestId: expect.any(String),
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(screen.queryByLabelText('Opinion or reason')).toBeNull();
  finish({ data: {} });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(api.request).toHaveBeenCalledOnce();
});
it('sends an ordinary finance decision with empty input and the full offered run hash', async () => {
  show('approve', offered('approve'));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reimbursementRequests/r1/action',
        json: expect.objectContaining({
          target: { taskId: 't1' },
          action: 'approve',
          input: {},
          contentHash: 'full-submitted-run-hash',
        }),
      }),
    ),
  );
  expect(close).toHaveBeenCalledOnce();
});
it('requires a voucher and records the exact cashier complete contract after confirmation', async () => {
  const action = {
    ...offered('complete'),
    task: { ...offered('complete').task, stage: 'cashier' },
  } as OfferedAction;
  show('complete', action);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText('Complete this field.');
  expect(api.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Payment voucher number *'), {
    target: { value: 'VOUCHER-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm payment' }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          input: { voucherNumber: 'VOUCHER-1' },
          target: { taskId: 't1' },
        }),
      }),
    ),
  );
});
it('forces a run only after exact gross/offset/net amounts and a reason, without fabricating a voucher', async () => {
  const action = {
    ...offered('forceComplete', { runId: 'run1' }),
    task: null,
    reasonRequired: true,
  };
  show('forceComplete', action);
  fireEvent.change(screen.getByLabelText('Opinion or reason *'), {
    target: { value: 'Verified settlement' },
  });
  for (const [label, value] of [
    ['Confirm gross reimbursement *', '100.00'],
    ['Confirm loan offset *', '25.00'],
    ['Confirm net cash *', '74.99'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByText('Enter the exact amount shown above.');
  expect(api.request).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm net cash *'), {
    target: { value: '75.00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Administrative settlement' }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          target: { runId: 'run1' },
          comment: 'Verified settlement',
          input: {
            voucherNumber: null,
            confirmedGrossCents: 10000,
            confirmedOffsetCents: 2500,
            confirmedNetCents: 7500,
          },
        }),
      }),
    ),
  );
});
it('keeps the run target for cc recipient lookup and sends only the selected offered run', async () => {
  const action = { ...offered('cc', { runId: 'run1' }), task: null };
  show('cc', action);
  expect(picker).toHaveBeenCalledWith(
    expect.objectContaining({ target: { runId: 'run1' }, action: 'cc' }),
  );
  fireEvent.change(screen.getByLabelText('Recipient *'), {
    target: { value: 'eligible-person' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          target: { runId: 'run1' },
          input: { to: 'eligible-person' },
        }),
      }),
    ),
  );
});
it('keeps a return-line reason after conflict and requires a latest read before retry', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('secret', {
      status: 409,
      method: 'POST',
      url: 'action',
    }),
  );
  show('returnItem', { ...offered('returnItem'), reasonRequired: true });
  fireEvent.change(screen.getByLabelText('Opinion or reason *'), {
    target: { value: 'Evidence unclear' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Return expense line' }),
  );
  await screen.findByRole('button', { name: 'Read latest version' });
  expect(screen.getByLabelText('Opinion or reason *')).toHaveValue(
    'Evidence unclear',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(api.request).toHaveBeenCalledOnce();
  expect(screen.queryByText('secret')).toBeNull();
});
it('uses a reasoned business transition for a closed-run forced exception, never an approval action', async () => {
  const current = {
    ...detail,
    view: { available: [{ name: 'forcePayException', allowed: true }] },
  } as unknown as ReimbursementDetail;
  show('forcePayException', undefined, current);
  fireEvent.change(screen.getByLabelText('Opinion or reason *'), {
    target: { value: 'Confirmed outside banking' },
  });
  for (const [label, value] of [
    ['Confirm gross reimbursement *', '100.00'],
    ['Confirm loan offset *', '25.00'],
    ['Confirm net cash *', '75.00'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'Record exceptional settlement',
    }),
  );
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'reimbursementRequests/r1/transition',
        json: expect.objectContaining({
          transition: 'forcePayException',
          version: 3,
          input: {
            reason: 'Confirmed outside banking',
            voucherNumber: null,
            confirmedGrossCents: 10000,
            confirmedOffsetCents: 2500,
            confirmedNetCents: 7500,
          },
        }),
      }),
    ),
  );
});
it('freezes uncertain writes and replays exactly the original body and idempotency key', async () => {
  api.request
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce({ data: {} });
  show('comment', offered('comment'));
  fireEvent.change(screen.getByLabelText('Opinion or reason'), {
    target: { value: 'Do not duplicate this comment' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await screen.findByRole('button', { name: 'Retry identical operation' });
  expect(screen.getByLabelText('Opinion or reason')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(api.request).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry identical operation' }),
  );
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  expect(api.request.mock.calls[1][0].json).toEqual(
    api.request.mock.calls[0][0].json,
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it.each(['reason', 'lines', 'evidence', 'duplicate'])(
  'blocks submit and explains missing draft facts: %s',
  async (missing) => {
    const record = {
      ...detail.record,
      reason: missing === 'reason' ? '' : detail.record.reason,
      lines:
        missing === 'lines'
          ? []
          : missing === 'evidence'
            ? detail.record.lines.map((row) => ({ ...row, attachmentIds: [] }))
            : missing === 'duplicate'
              ? [...detail.record.lines, ...detail.record.lines]
              : detail.record.lines,
    };
    show('submit', undefined, {
      ...detail,
      record,
      view: {
        available: [
          { name: 'submit', allowed: true },
          { name: 'edit', allowed: true },
        ],
      },
    } as unknown as ReimbursementDetail);
    expect(screen.getByText(copy.actionForm.submitRequirements)).toBeVisible();
    expect(
      screen.getByText(
        missing === 'reason'
          ? copy.actionForm.reasonRequired
          : missing === 'lines'
            ? copy.actionForm.linesRequired
            : missing === 'duplicate'
              ? copy.actionForm.duplicateLines
              : copy.actionForm.lineIncomplete.replace('{{number}}', '1'),
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText('Opinion or reason')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Edit reimbursement' }),
    ).toHaveAttribute('href', '/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.request).not.toHaveBeenCalled());
  },
);

it.each([
  '/reimbursementRequests/r1',
  '/approvals/mine/reimbursement/r1',
  '/reimbursement/r1',
])(
  'opens the saved draft from its current detail route and keeps filters: %s',
  async (parentPath) => {
    show(
      'submit',
      undefined,
      {
        ...detail,
        record: { ...detail.record, lines: [] },
        view: {
          available: [
            { name: 'submit', allowed: true },
            { name: 'edit', allowed: true },
          ],
        },
      } as unknown as ReimbursementDetail,
      `${parentPath}/action/submit/r1?status=draft`,
    );
    expect(
      screen.getByRole('button', { name: 'Edit reimbursement' }),
    ).toHaveAttribute('href', `${parentPath}/edit?status=draft`);
  },
);

it('process-management reimbursement reassignment requires a reason and exposes recipient field validation', async () => {
  api.request.mockResolvedValue({ data: detail });
  show(
    'reassign',
    offered('reassign'),
    detail,
    '/processManagement/executions/oa.reimbursement/r1/action/reassign/t1',
  );
  expect(
    screen.getByRole('textbox', { name: /Opinion or reason/ }),
  ).toHaveAccessibleName(/\*/);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(api.request).not.toHaveBeenCalled());
  expect(picker.mock.lastCall?.[0]).toMatchObject({ invalid: true });
});

it('a close failure after a confirmed write cannot become an uncertain operation or permit replay', async () => {
  api.request.mockResolvedValue({ data: {} });
  close.mockRejectedValueOnce(new Error('Navigation failed'));
  show('comment', offered('comment'));
  fireEvent.change(screen.getByLabelText('Opinion or reason'), {
    target: { value: 'Confirmed operation' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(
    screen.queryByRole('button', { name: 'Retry identical operation' }),
  ).not.toBeInTheDocument();
  expect(api.request).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(api.request).toHaveBeenCalledOnce();
});

it('confirmed writes close successfully when the hosting outlet has no business refresh callbacks', async () => {
  api.request.mockResolvedValue({ data: {} });
  show('comment', offered('comment'), detail, '/action', {});
  fireEvent.change(screen.getByLabelText('Opinion or reason'), {
    target: { value: 'Confirmed operation' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(
    screen.queryByRole('button', { name: 'Retry identical operation' }),
  ).not.toBeInTheDocument();
  expect(api.request).toHaveBeenCalledOnce();
});
