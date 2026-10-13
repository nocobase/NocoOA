import { MemoryRouter } from 'react-router';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import { ApiClientError } from '@nocobase/app-client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LeaveApprovalEfficiencyReport } from '../../client/pages/reports/leave-approval-efficiency.js';
import en from '../../client/locales/modules/reports-efficiency.en-US.js';
import zh from '../../client/locales/modules/reports-efficiency.zh-CN.js';
const { api, identity } = vi.hoisted(() => ({
  identity: { actor: 'reader', revision: 0 },
  api: { request: vi.fn(), stream: vi.fn() },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ session: { user: { id: identity.actor } } }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useAuthorizationRevision: () => identity.revision,
}));
afterEach(() => {
  identity.actor = 'reader';
  identity.revision = 0;
  cleanup();
  vi.resetAllMocks();
});
async function show(locale = 'en-US') {
  const runtime = await createTestI18nRuntime({
    application: {
      namespace: 'nb3-oa',
      resources: {
        status: { loading: locale === 'en-US' ? 'Loading' : '加载中' },
        reportsEfficiency: locale === 'en-US' ? en : zh,
      },
    },
    locale,
  });
  const view = render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>
        <LeaveApprovalEfficiencyReport />
      </MemoryRouter>
    </TestI18nProvider>,
  );
  return { ...view, runtime };
}
const data = {
  data: [
    {
      id: 'manager',
      stage: 'manager',
      completedTaskCount: 2,
      totalElapsedMs: 12000,
      averageElapsedMs: 6000,
    },
  ],
  meta: {
    page: 1,
    pageSize: 20,
    total: 1,
    generatedAt: '2026-10-12T00:00:00Z',
  },
};
it.each(['en-US', 'zh-CN'])(
  'validates required year, localized fixed columns and resets filters (%s)',
  async (locale) => {
    api.request.mockResolvedValue(data);
    await show(locale);
    expect(api.request).not.toHaveBeenCalled();
    const year = screen.getByLabelText(
      locale === 'en-US' ? 'Start year' : '开始年份',
    );
    fireEvent.change(year, { target: { value: '9999' } });
    expect(api.request).not.toHaveBeenCalled();
    fireEvent.change(year, { target: { value: '2026' } });
    await screen.findByText(locale === 'en-US' ? 'Manager' : '直属上级');
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: { year: '2026', locale, page: '1', pageSize: '20' },
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: locale === 'en-US' ? 'Clear filters' : '清除筛选',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(locale === 'en-US' ? 'Manager' : '直属上级'),
      ).not.toBeInTheDocument(),
    );
  },
);
it('export uses identical filters, disables duplicate actions and clears rows on revoked access', async () => {
  api.request.mockResolvedValue(data);
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  fireEvent.change(screen.getByLabelText('Start month (optional)'), {
    target: { value: '10' },
  });
  await screen.findByText('Manager');
  api.stream.mockRejectedValue(
    new ApiClientError('denied', {
      status: 403,
      method: 'GET',
      url: '/reports/export',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  await screen.findByText(en.forbidden);
  expect(api.stream).toHaveBeenCalledWith({
    path: 'reports/leave-approval-efficiency/export',
    query: { year: '2026', month: '10', locale: 'en-US' },
  });
  expect(screen.queryByText('Manager')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Export Excel' }),
  ).not.toBeInTheDocument();
});
it('precondition offers narrowing instead of blind retry and recovery rereads authorization', async () => {
  api.request.mockRejectedValue(
    new ApiClientError('bad source', {
      status: 412,
      method: 'GET',
      url: '/reports/report',
    }),
  );
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  await screen.findByText(en.precondition);
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
  api.request.mockResolvedValue(data);
  fireEvent.change(screen.getByLabelText('Start month (optional)'), {
    target: { value: '10' },
  });
  await screen.findByText('Manager');
});
it('retains same-query rows during refresh, clears on failure and paginates through owner metadata', async () => {
  api.request.mockResolvedValue({ ...data, meta: { ...data.meta, total: 21 } });
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  await screen.findByText('Manager');
  let rejectRefresh!: (error: unknown) => void;
  api.request.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectRefresh = reject;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled(),
  );
  expect(screen.getByText('Manager')).toBeInTheDocument();
  rejectRefresh(new Error('private error'));
  await screen.findByText(en.failed);
  expect(screen.queryByText('Manager')).not.toBeInTheDocument();
  api.request.mockResolvedValue({ ...data, meta: { ...data.meta, total: 21 } });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Manager');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ page: '2' }),
      }),
    ),
  );
});
it('pins export query and blocks duplicate export/filter changes while downloading', async () => {
  api.request.mockResolvedValue(data);
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  await screen.findByText('Manager');
  let finish!: (stream: ReadableStream<Uint8Array>) => void;
  api.stream.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const create = vi
    .spyOn(URL, 'createObjectURL')
    .mockReturnValue('blob:fixture');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  expect(screen.getByLabelText('Start year')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
  finish(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    }),
  );
  await screen.findByText(en.exported);
  expect(api.stream).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledOnce();
  create.mockRestore();
  revoke.mockRestore();
  click.mockRestore();
});
it('distinguishes empty source from filtered no results and provides clearing', async () => {
  api.request.mockResolvedValue({ data: [], meta: { ...data.meta, total: 0 } });
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  await screen.findByText(en.empty);
  fireEvent.change(screen.getByLabelText('Start month (optional)'), {
    target: { value: '10' },
  });
  await screen.findByText(en.noResults);
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
  await screen.findByText(en.selectYear);
});
it.each(['revision', 'actor'] as const)(
  'drops rows and pinned download, preserving URL filters on actual hook %s changes',
  async (kind) => {
    api.request.mockResolvedValue(data);
    const view = await show();
    fireEvent.change(screen.getByLabelText('Start year'), {
      target: { value: '2026' },
    });
    await screen.findByText('Manager');
    let finish!: (stream: ReadableStream<Uint8Array>) => void;
    api.stream.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    if (kind === 'revision') identity.revision += 1;
    else identity.actor = 'other';
    view.rerender(
      <TestI18nProvider runtime={view.runtime}>
        <MemoryRouter>
          <LeaveApprovalEfficiencyReport />
        </MemoryRouter>
      </TestI18nProvider>,
    );
    expect(screen.queryByText('Manager')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Start year')).toHaveValue('2026');
    finish(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByText('Manager')).toBeInTheDocument(),
    );
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  },
);
it('handles a stream read failure without downloading partial bytes', async () => {
  api.request.mockResolvedValue(data);
  await show();
  fireEvent.change(screen.getByLabelText('Start year'), {
    target: { value: '2026' },
  });
  await screen.findByText('Manager');
  api.stream.mockResolvedValue(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error('private stream fault'));
      },
    }),
  );
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
  await screen.findByText(en.exportFailed);
  expect(click).not.toHaveBeenCalled();
  expect(screen.queryByText('private stream fault')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Export Excel' }),
  ).not.toBeDisabled();
  click.mockRestore();
});
