import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { describe, expect, it, vi } from 'vitest';
import NotificationLogsPage from '../../client/pages/administration/notification/pages/notification-logs-page.js';
import enUS from '../../client/locales/en-US.js';
import notification from '../../client/locales/administration/notification/en-US.js';
const { client } = vi.hoisted(() => ({
  client: {
    listLogs: vi.fn().mockResolvedValue([]),
    listTestTargets: vi
      .fn()
      .mockResolvedValue([
        {
          channel: { name: 'Test delivery' },
          fields: [
            {
              name: 'recipient',
              label: 'Recipient',
              type: 'text',
              required: true,
            },
          ],
        },
      ]),
    sendTest: vi.fn(),
  },
}));
vi.mock('../../client/pages/administration/notification/runtime.js', () => ({
  getNotificationClient: () => client,
}));
const namespace = '@nocobase/app-plugin-notification';
const runtime = await createTestI18nRuntime({
  strict: false,
  application: { namespace: 'nb3-oa', resources: enUS },
  namespaces: { [namespace]: notification },
});
describe('notification test dialog', () => {
  it('uses keyboard dismissal, requires recipient input and never sends while inspecting', async () => {
    const user = userEvent.setup();
    render(
      <TestI18nProvider runtime={runtime} namespace={namespace}>
        <NotificationLogsPage />
      </TestI18nProvider>,
    );
    const trigger = screen.getByRole('button', {
      name: 'Send test notification',
    });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', {
      name: 'Send test notification',
    });
    expect(
      within(dialog).getByRole('button', { name: 'Send', exact: true }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole('combobox', { name: 'Delivery method' }),
    );
    await user.click(
      await screen.findByRole('option', { name: 'Test delivery' }),
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Recipient' }),
      'test',
    );
    expect(
      within(dialog).getByRole('button', { name: 'Send', exact: true }),
    ).toBeEnabled();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(client.sendTest).not.toHaveBeenCalled();
  });
});
