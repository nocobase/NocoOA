import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import en from '../../client/locales/en-US.js';
import { ApprovalRecipientPicker } from '../../client/components/approval-recipient-picker.js';
const { api, changed } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  changed: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: en },
});
function Picker() {
  const [value, setValue] = useState('');
  return (
    <ApprovalRecipientPicker
      id='recipient'
      requestPath='reimbursementRequests'
      recordId='r1'
      target={{ taskId: 't1' }}
      action='reassign'
      value={value}
      onChange={(id) => {
        setValue(id);
        changed(id);
      }}
      disabled={false}
    />
  );
}
function show() {
  render(
    <TestI18nProvider runtime={runtime}>
      <Picker />
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  api.request.mockReset();
  changed.mockReset();
});
it('uses one searchable control, keeps recipient names and sends the scoped reassignment query', async () => {
  api.request.mockResolvedValue({
    data: {
      people: [{ id: 'reviewer', name: 'Eligible reviewer' }],
      nextOffset: null,
    },
  });
  show();
  const input = screen.getByRole('combobox');
  expect(input).toHaveAttribute('placeholder', 'Search eligible recipients');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(api.request).not.toHaveBeenCalled();
  await userEvent.type(input, 'E');
  await userEvent.click(
    await screen.findByRole('option', { name: 'Eligible reviewer' }),
  );
  expect(changed).toHaveBeenCalledWith('reviewer');
  expect(input).toHaveValue('Eligible reviewer');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'reimbursementRequests/r1/candidates',
      query: {
        taskId: 't1',
        action: 'reassign',
        search: 'E',
        offset: 0,
        limit: 50,
      },
    }),
  );
  expect(
    screen.queryByRole('button', { name: 'Load more recipients' }),
  ).not.toBeInTheDocument();
});
it('searches only after typing, caps results at fifty and offers no pagination button', async () => {
  api.request.mockResolvedValue({
    data: {
      people: Array.from({ length: 60 }, (_, i) => ({
        id: `r${i}`,
        name: `Reviewer ${i}`,
      })),
      nextOffset: 50,
    },
  });
  show();
  await userEvent.click(screen.getByRole('combobox'));
  expect(api.request).not.toHaveBeenCalled();
  await userEvent.type(screen.getByRole('combobox'), 'Reviewer');
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          search: 'Reviewer',
          offset: 0,
          limit: 50,
        }),
      }),
    ),
  );
  await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(50));
  expect(
    screen.queryByRole('button', { name: 'Load more recipients' }),
  ).not.toBeInTheDocument();
});
it('reports query failures with retry and distinguishes empty results', async () => {
  api.request
    .mockRejectedValueOnce(
      new ApiClientError('Invalid query', {
        status: 400,
        method: 'GET',
        url: '/candidates',
      }),
    )
    .mockResolvedValue({ data: { people: [], nextOffset: null } });
  show();
  await userEvent.type(screen.getByRole('combobox'), 'E');
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
  );
  await userEvent.type(screen.getByRole('combobox'), 'E');
  expect(await screen.findByText(en.userPicker.empty)).toBeVisible();
});
