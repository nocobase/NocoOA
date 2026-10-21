import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { expect, it, vi } from 'vitest';
import NotificationLogsPage from '../../client/pages/administration/notification/pages/notification-logs-page.js';
import enUS from '../../client/locales/en-US.js';
import notification from '../../client/locales/administration/notification/en-US.js';

const { client } = vi.hoisted(() => ({ client: { listLogs: vi.fn() } }));
vi.mock('../../client/pages/administration/notification/runtime.js', () => ({
  getNotificationClient: () => client,
}));
const namespace = '@nocobase/app-plugin-notification';
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
  namespaces: { [namespace]: notification },
});

it('shows historical delivery and attempt providers using only the log response', async () => {
  const createdAt = '2026-10-01T00:00:00Z';
  client.listLogs.mockResolvedValue([
    {
      log: {
        id: 'historical-test',
        sourceType: 'notification-test',
        status: 'completed',
        createdAt,
        updatedAt: createdAt,
      },
      deliveries: [
        {
          delivery: {
            id: 'delivery-1',
            channelName: 'retired-email',
            channelType: 'email',
            providerType: 'custom-smtp',
            attemptCount: 1,
            status: 'accepted',
            createdAt,
            updatedAt: createdAt,
          },
          attempts: [
            {
              id: 'attempt-1',
              sequence: 1,
              providerType: 'custom-smtp',
              status: 'accepted',
              startedAt: createdAt,
            },
          ],
          retryAudits: [],
        },
      ],
    },
  ]);
  render(
    <TestI18nProvider runtime={runtime} namespace={namespace}>
      <NotificationLogsPage />
    </TestI18nProvider>,
  );
  await screen.findByText('historical-test');
  expect(
    screen.queryByRole('button', { name: 'Send test notification' }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Expand notification' }),
  );
  expect(screen.getByText('retired-email')).toBeInTheDocument();
  expect(screen.getAllByText('custom-smtp')).toHaveLength(2);
  expect(screen.getByText('#1')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(client.listLogs).toHaveBeenCalledTimes(2);
});
