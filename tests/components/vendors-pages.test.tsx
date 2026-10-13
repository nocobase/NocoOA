import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, it, expect, vi } from 'vitest';
import enUS from '../../client/locales/en-US.js';
import vendors from '../../client/locales/modules/vendors.en-US.js';
import Form from '../../client/pages/vendors/form-dialog.js';
import Detail from '../../client/pages/vendors/detail.js';
import Vendors from '../../client/pages/vendors/index.js';
const { api, reload, permission } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  permission: { manage: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({ action }: { action: string }) => ({
    can: action !== 'manage' || permission.manage,
    isPending: false,
  }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...vendors } },
});
const row = {
  id: 'v1',
  code: 'V-1',
  name: 'Vendor',
  category: 'Services',
  contactName: 'Sales',
  contactPhone: '12345',
  contactEmail: 'sales@example.test',
  bankName: 'Bank',
  bankAccount: '00001234',
  bankAccountName: 'Vendor',
  active: true,
  status: 'manual',
  version: 1,
  createdById: 'alice',
  createdAt: '2026-10-11T00:00:00Z',
  updatedAt: '2026-10-11T00:00:00Z',
};
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
};
function serve(
  write?: (r: Request) => unknown,
  data: Partial<typeof row> = row,
) {
  api.request.mockImplementation(async (r: Request) =>
    r.method ? write?.(r) : { data: structuredClone(data) },
  );
}
function show(path: string, component: 'form' | 'detail' = 'form') {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ onSaved: reload }} />,
        children: [
          { path: 'new', element: <Form /> },
          { path: 'edit/:vendorId', element: <Form /> },
          { path: 'view/:vendorId', element: <Detail /> },
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
  return { router, component };
}
beforeEach(() => {
  api.request.mockReset();
  reload.mockReset();
  permission.manage = true;
});
it('requires specific fields and sends bank account as text with audited reason', async () => {
  const user = userEvent.setup();
  serve(() => ({ data: row }));
  show('/new');
  expect(screen.getByLabelText('Code *')).toBeRequired();
  expect(screen.getByLabelText('Name *')).toBeRequired();
  expect(screen.getByLabelText('Category *')).toBeRequired();
  expect(screen.getByLabelText('Reason for this change *')).toBeRequired();
  expect(screen.getByLabelText('Bank account')).not.toBeRequired();
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Code *')).toHaveFocus());
  for (const [label, value] of [
    ['Code *', 'NEW'],
    ['Name *', 'New vendor'],
    ['Category *', 'Parts'],
    ['Bank account', '00001234'],
    ['Reason for this change *', 'New procurement vendor'],
  ])
    await user.type(screen.getByLabelText(label!), value!);
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(api.request.mock.calls.find((c) => c[0].method)?.[0]).toMatchObject({
    method: 'POST',
    json: { bankAccount: '00001234', reason: 'New procurement vendor' },
  });
});
it('locks uncertain creation and prevents a second vendor write', async () => {
  const user = userEvent.setup();
  serve(() => {
    throw new Error('Network');
  });
  show('/new');
  for (const [label, value] of [
    ['Code *', 'NEW'],
    ['Name *', 'New vendor'],
    ['Category *', 'Parts'],
    ['Reason for this change *', 'Setup'],
  ])
    await user.type(screen.getByLabelText(label!), value!);
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText(/creation result is unknown/i);
  expect(
    screen.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Name *')).toBeDisabled();
  expect(api.request.mock.calls.filter((c) => c[0].method)).toHaveLength(1);
});
it('keeps uncommitted edits when latest unchanged version resolves unknown write and only sends patch fields', async () => {
  const user = userEvent.setup();
  let attempts = 0;
  serve(() => {
    if (++attempts === 1) throw new Error('Network');
    return { data: { ...row, version: 2 } };
  });
  show('/edit/v1');
  await waitFor(() =>
    expect(screen.getByLabelText('Name *')).toHaveValue('Vendor'),
  );
  await user.clear(screen.getByLabelText('Name *'));
  await user.type(screen.getByLabelText('Name *'), 'Edited vendor');
  await user.type(screen.getByLabelText('Reason for this change *'), 'Rename');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText(/result is unknown/i);
  await user.click(screen.getByRole('button', { name: 'Load latest vendor' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save', exact: true }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText('Name *')).toHaveValue('Edited vendor');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(
    api.request.mock.calls.filter((c) => c[0].method).map((c) => c[0].json),
  ).toEqual([
    { name: 'Edited vendor', reason: 'Rename', version: 1 },
    { name: 'Edited vendor', reason: 'Rename', version: 1 },
  ]);
});
it('never renders bank fields that the server read policy omitted', async () => {
  const data = { ...row };
  delete (data as Partial<typeof row>).bankAccount;
  delete (data as Partial<typeof row>).bankName;
  delete (data as Partial<typeof row>).bankAccountName;
  serve(undefined, data);
  show('/view/v1', 'detail');
  await screen.findByText('Services');
  expect(
    screen.queryByText('Bank account', { exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('00001234')).not.toBeInTheDocument();
});

function showList(search = '') {
  api.request.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/vendors',
        element: <Vendors />,
        children: [{ path: 'new', element: <Form /> }],
      },
    ],
    { initialEntries: [`/vendors${search}`] },
  );
  render(
    <TestI18nProvider runtime={runtime}>
      <RouterProvider router={router} />
    </TestI18nProvider>,
  );
  return router;
}
it('keeps empty vendor table headers and creation in the shared toolbar, opening the existing form with filters', async () => {
  const router = showList('?search=missing');
  await screen.findByRole('columnheader', { name: 'Name' });
  expect(
    screen.getByRole('columnheader', { name: 'Code' }),
  ).toBeInTheDocument();
  await screen.findByText('No matching vendors');
  const create = screen.getByRole('button', { name: 'Add vendor' });
  expect(
    within(
      create.closest('[data-slot=application-actions]') as HTMLElement,
    ).getByRole('button', { name: 'Add vendor' }),
  ).toBe(create);
  await userEvent.setup().click(create);
  await screen.findByRole('dialog', { name: 'Add vendor' });
  expect(router.state.location.pathname).toBe('/vendors/new');
  expect(router.state.location.search).toBe('?search=missing');
});
it('shows the empty vendor table and explains how to add vendors without granting management access', async () => {
  permission.manage = false;
  showList();
  await screen.findByRole('columnheader', { name: 'Name' });
  expect(
    screen.queryByRole('button', { name: 'Add vendor' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Ask purchasing to add a vendor/),
  ).toBeInTheDocument();
});
it('offers creation even before an empty vendor list finishes loading', async () => {
  showList();
  const create = screen.getByRole('button', { name: 'Add vendor' });
  expect(create).toBeInTheDocument();
  await screen.findByText('No vendors');
  expect(screen.getByRole('button', { name: 'Add vendor' })).toBe(create);
});
