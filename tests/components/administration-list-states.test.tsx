import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import enUS from '../../client/locales/en-US.js';
import notification from '../../client/locales/administration/notification/en-US.js';
import scheduler from '../../client/locales/administration/scheduler/en-US.js';
import Notifications from '../../client/pages/administration/notification/pages/notification-logs-page.js';
import Schedules from '../../client/pages/administration/scheduler/pages/schedules-page.js';
const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  notification: {
    listLogs: vi.fn(),
  },
  refreshSession: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useService: () => state.api,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh: state.refreshSession }),
}));
vi.mock('../../client/pages/administration/notification/runtime.js', () => ({
  getNotificationClient: () => state.notification,
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
  namespaces: {
    '@nocobase/app-plugin-notification': notification,
    '@nocobase/app-plugin-scheduler': scheduler,
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  state.notification.listLogs.mockResolvedValue([]);
  state.api.request.mockResolvedValue({ data: [], meta: { total: 0 } });
});
function mount(module: 'notification' | 'scheduler') {
  render(
    <TestI18nProvider
      runtime={runtime}
      namespace={`@nocobase/app-plugin-${module}`}
    >
      <MemoryRouter>
        {module === 'notification' ? <Notifications /> : <Schedules />}
      </MemoryRouter>
    </TestI18nProvider>,
  );
}
for (const module of ['notification', 'scheduler'] as const) {
  it.each([401, 403, 404, 500])(
    `${module} handles HTTP %s without displaying private details or a false empty state`,
    async (status) => {
      const error = new ApiClientError('private endpoint detail', {
        status,
        method: 'GET',
        url: '/api/private',
      });
      if (module === 'notification')
        state.notification.listLogs.mockRejectedValue(error);
      else state.api.request.mockRejectedValue(error);
      mount(module);
      const alert = await screen.findByRole('alert');
      expect(alert).not.toHaveTextContent('private endpoint detail');
      expect(
        within(alert).queryByRole('button', { name: 'Retry' }) !== null,
      ).toBe(status === 500);
      expect(
        screen.queryByText(
          module === 'notification'
            ? notification.logs.emptyTitle
            : scheduler.page.empty,
        ),
      ).toBeNull();
      if (status === 401)
        expect(
          within(alert).getByRole('button', { name: enUS.actions.signInAgain }),
        ).toBeInTheDocument();
    },
  );
}
it('keeps notification rows during refresh and clears old rows after access is removed', async () => {
  state.notification.listLogs.mockResolvedValueOnce([
    {
      log: {
        id: 'old',
        sourceType: 'Old source',
        status: 'completed',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      deliveries: [],
    },
  ]);
  mount('notification');
  await screen.findByText('Old source');
  let reject!: (error: unknown) => void;
  state.notification.listLogs.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: notification.logs.refresh }),
  );
  expect(screen.getByText('Old source')).toBeInTheDocument();
  await waitFor(() =>
    expect(state.notification.listLogs).toHaveBeenCalledTimes(2),
  );
  await act(async () =>
    reject(
      new ApiClientError('private denied', {
        status: 403,
        method: 'GET',
        url: '/api/private',
      }),
    ),
  );
  expect(screen.queryByText('Old source')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(
    notification.errors.forbidden,
  );
});

it('sorts notification creation dates and delivery counts on the retained capped page', async () => {
  const delivery = {
    delivery: {
      id: 'd1',
      channelName: 'In-app',
      channelType: 'in-app',
      providerType: 'in-app',
      attemptCount: 0,
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    attempts: [],
    retryAudits: [],
  };
  state.notification.listLogs.mockResolvedValue([
    {
      log: {
        id: 'old',
        sourceType: 'Old source',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      deliveries: [delivery],
    },
    {
      log: {
        id: 'new',
        sourceType: 'New source',
        status: 'completed',
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      deliveries: [],
    },
  ]);
  mount('notification');
  await screen.findByText('Old source');
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('New source');
  await userEvent.click(
    within(table).getByRole('button', {
      name: notification.logs.columns.deliveries,
    }),
  );
  expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Old source');
});
