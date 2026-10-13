import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import en from '../../client/locales/en-US.js';
import { ActionForm } from '../../client/pages/process-management/action.js';
const { api, resource, close } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  close: vi.fn(),
  resource: {
    data: {
      data: { record: { kind: 'oa.reimbursement', id: 'r1', number: 'R-1' } },
    },
    update: vi.fn(),
    reload: vi.fn(),
  },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => ({ show: vi.fn() }),
}));
vi.mock('../../client/pages/process-management/execution-context.js', () => ({
  useExecution: () => resource,
}));
vi.mock('../../client/components/use-route-overlay.js', () => ({
  useRouteOverlay: () => ({ close }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: en },
});
beforeEach(() => {
  api.request.mockReset();
  close.mockReset();
});
it('execution reassignment uses the shared typed-search control and preserves management metadata on submission', async () => {
  api.request.mockImplementation(async ({ path }) =>
    path.endsWith('/managementOptions')
      ? {
          data: {
            version: 3,
            taskId: 't1',
            runId: 'run1',
            contentHash: 'hash',
            people: [{ id: 'reviewer', name: 'Reviewer' }],
            nextOffset: 50,
          },
        }
      : { data: { detail: resource.data.data } },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <ActionForm
        action='reassign'
        taskId='t1'
        busy={false}
        onBusy={vi.fn()}
        onBlocked={vi.fn()}
        formId='management-form'
        label='R-1'
      />
      <button type='submit' form='management-form'>
        Apply
      </button>
    </TestI18nProvider>,
  );
  expect(api.request).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: /Load more/ }),
  ).not.toBeInTheDocument();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Opinion or reason *' }),
    'Cover absence',
  );
  await userEvent.type(screen.getByRole('combobox'), 'R');
  await userEvent.click(
    await screen.findByRole('option', { name: 'Reviewer' }),
  );
  expect(screen.getByRole('combobox')).toHaveValue('Reviewer');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'processManagement/executions/oa.reimbursement/r1/managementOptions',
      json: {
        action: 'reassign',
        taskId: 't1',
        search: 'R',
        offset: 0,
        limit: 50,
      },
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'processManagement/executions/oa.reimbursement/r1/managementActions',
      json: expect.objectContaining({
        taskId: 't1',
        runId: 'run1',
        contentHash: 'hash',
        expectedVersion: 3,
        to: 'reviewer',
        reason: 'Cover absence',
      }),
    }),
  );
});
