import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { describe, expect, it } from 'vitest';
import enUS from '../../client/locales/administration/authorization/en-US.js';
import zhCN from '../../client/locales/administration/authorization/zh-CN.js';
import { AUTHORIZATION_NAMESPACE } from '../../client/pages/administration/authorization/shared.js';
import { PermissionSetEditor } from '../../client/pages/administration/authorization/pages/permission-sets/editor.js';
import type { Draft } from '../../client/pages/administration/authorization/pages/permission-sets/types.js';
import type { AuthorizationOptions } from '../../client/pages/administration/authorization/authorization-client.js';

const options: AuthorizationOptions = {
  sections: [
    {
      value: 'business',
      label: 'Business',
      order: 1,
      subsections: [
        {
          value: 'operations',
          label: 'Operations',
          recordType: 'composite',
          actions: [{ value: 'read', label: 'Read' }],
          groups: [
            {
              value: 'hr',
              label: 'HR',
              children: [{ value: 'employee', label: 'Employees' }],
            },
            { value: 'finance', label: 'Finance' },
          ],
          resources: [
            {
              type: 'composite',
              value: 'employee',
              label: 'Employee records',
              group: 'employee',
            },
            {
              type: 'composite',
              value: 'budget',
              label: 'Budget records',
              group: 'finance',
            },
            {
              type: 'composite',
              value: 'unknown',
              label: 'Unknown records',
              group: 'missing',
            },
            {
              type: 'composite',
              value: 'ungrouped',
              label: 'Ungrouped records',
            },
          ],
        },
      ],
    },
  ],
  subjectTypes: [],
  collections: [],
  recordAccess: [],
};
const initial: Draft = {
  originalKey: 'role',
  key: 'role',
  title: 'Role',
  grants: [
    { id: 1, resource: { type: 'composite', id: 'budget' }, actions: ['read'] },
    {
      id: 2,
      resource: { type: 'composite', id: 'historical' },
      actions: ['read'],
    },
  ],
};

async function setup(search = '', readOnly = false, locale = 'en-US') {
  const runtime = new I18nRuntime({
    defaultLocale: 'en-US',
    locales: ['en-US', 'zh-CN'],
    applicationNamespace: AUTHORIZATION_NAMESPACE,
  });
  runtime.registerApplicationNamespace(AUTHORIZATION_NAMESPACE, {
    'en-US': async () => enUS,
    'zh-CN': async () => zhCN,
  });
  await runtime.init(locale);
  let saved: Draft | undefined;
  function Host() {
    const [draft, setDraft] = useState(initial);
    return (
      <PermissionSetEditor
        options={options}
        draft={draft}
        busy={false}
        dirty={draft !== initial}
        readOnly={readOnly}
        onChange={setDraft}
        onSave={async (event) => {
          event.preventDefault();
          saved = draft;
        }}
        onClose={() => setDraft(initial)}
      />
    );
  }
  render(
    <I18nProvider runtime={runtime}>
      <MemoryRouter initialEntries={[`/role${search}`]}>
        <Host />
      </MemoryRouter>
    </I18nProvider>,
  );
  return { saved: () => saved };
}

describe('permission module tabs', () => {
  it('keeps hidden grants and unsaved edits when switching and saving; bulk targets only the module', async () => {
    const host = await setup();
    expect(
      screen.getByRole('tab', { name: 'HR: 0 configured / 1 resources' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('group', { name: 'Budget records' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Select matching resources' }),
    );
    expect(
      screen.getByRole('tab', { name: 'HR: 1 configured / 1 resources' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: /Finance:/ }));
    expect(
      screen.getByRole('button', { name: 'Budget records: Read' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /HR:/ }));
    expect(
      screen.getByRole('button', { name: 'Employee records: Read' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'Save permission set' }),
    );
    expect(
      host
        .saved()
        ?.grants.map((grant) => grant.resource.id)
        .sort(),
    ).toEqual(['budget', 'employee', 'historical']);
    fireEvent.click(screen.getByRole('tab', { name: /Other:/ }));
    for (const label of ['Unknown records', 'Ungrouped records', 'historical'])
      expect(screen.getByRole('group', { name: label })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: /All:/ }));
    expect(
      screen.getByRole('group', { name: 'Employee records' }),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: 'Budget records' })).toBeVisible();
  });

  it('restores a module from URL and keeps tabs/counts available with no search results', async () => {
    await setup('?permissionGroup=group%3Afinance');
    expect(screen.getByRole('group', { name: 'Budget records' })).toBeVisible();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search resources' }),
      { target: { value: 'missing query' } },
    );
    expect(
      screen.getByText('No permissions match in this module'),
    ).toBeVisible();
    expect(
      screen.getByRole('tab', { name: 'Finance: 1 configured / 1 resources' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('group', { name: 'Budget records' })).toBeVisible();
  });

  it('falls back from invalid module and permits read-only navigation in Chinese', async () => {
    await setup('?permissionGroup=invalid', true, 'zh-CN');
    expect(
      screen.getByRole('tab', { name: 'HR：已配置 0 / 共 1 项' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('button', { name: 'Employee records: Read' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: /Finance：/ }));
    expect(
      screen.getByRole('button', { name: 'Budget records: Read' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });
});
