// Component tests of the platform module's settings pages: the requests they send, their states, permission-gated
// controls, and their child-route overlays. Only what the pages reach outside themselves is mocked.
import { ApiClientError } from '@nocobase/app-client';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import enUS from '../../client/locales/en-US.js';
import ApprovalRulesPage from '../../client/pages/platform/approval-rules/index.js';
import RuleChangeDialog from '../../client/pages/platform/approval-rules/change-dialog.js';
import AuditLogDetail from '../../client/pages/platform/audit-logs/detail.js';
import AuditLogsPage from '../../client/pages/platform/audit-logs/index.js';
import DictionaryEntryDialog from '../../client/pages/platform/dictionaries/entry-dialog.js';
import DictionariesPage from '../../client/pages/platform/dictionaries/index.js';
import CalendarImportDialog from '../../client/pages/platform/work-calendar/import-dialog.js';
import WorkCalendarPage from '../../client/pages/platform/work-calendar/index.js';
import { parseDays } from '../../client/pages/platform/work-calendar/parse-days.js';

const { api, toaster, permission, refresh } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toaster: { show: vi.fn(), close: vi.fn() },
  permission: { can: true, isPending: false, error: undefined as unknown },
  refresh: vi.fn(),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
}));
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthentication: () => ({ refresh }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({
    can: permission.can,
    isPending: permission.isPending,
    error: permission.error,
    retry: vi.fn(),
  }),
}));

const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: enUS },
});
const copy = enUS.platform;

function I18n({ children }: { readonly children: ReactNode }): ReactElement {
  return <TestI18nProvider runtime={runtime}>{children}</TestI18nProvider>;
}

type Handler = (options: {
  path: string;
  method?: string;
  query?: Record<string, unknown>;
  json?: unknown;
}) => unknown;

/** Answers requests by path; a handler may return a value or throw an error. */
function serve(handlers: Record<string, Handler>): void {
  api.request.mockImplementation(
    (options: { path: string; method?: string }) => {
      const key = `${options.method ?? 'GET'} ${options.path}`;
      const handler = handlers[key];
      if (!handler) return Promise.reject(new Error(`Unexpected ${key}`));
      try {
        return Promise.resolve(handler(options));
      } catch (error) {
        return Promise.reject(error);
      }
    },
  );
}

function apiError(status: number, reason?: string, fields: string[] = []) {
  return new ApiClientError('failed', {
    status,
    method: 'GET',
    url: '/api/x',
    ...(reason ? { reason } : {}),
    payload: {
      error: { reason, fieldViolations: fields.map((field) => ({ field })) },
    },
  } as ConstructorParameters<typeof ApiClientError>[1]);
}

function renderRoutes(
  routes: Parameters<typeof createMemoryRouter>[0],
  url: string,
) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(<RouterProvider router={router} />, { wrapper: I18n });
  return router;
}

const version = (
  key: string,
  value: unknown,
  effectiveFrom = '1970-01-01T00:00:00.000Z',
) => ({
  id: `${key}-${effectiveFrom}`,
  key,
  value,
  effectiveFrom,
  updatedBy: null,
  updatedByName: null,
  note: null,
  createdAt: effectiveFrom,
});

beforeEach(() => {
  api.request.mockReset();
  toaster.show.mockReset();
  permission.can = true;
  permission.isPending = false;
  permission.error = undefined;
});

describe('dictionaries page', () => {
  const types = {
    data: [
      {
        type: 'leaveType',
        extraFields: [
          { name: 'deductsBalance', type: 'boolean', nullable: false },
          { name: 'maxDays', type: 'number', nullable: true, min: 0 },
        ],
      },
      { type: 'sealType', extraFields: [] },
    ],
    meta: { total: 2 },
  };
  const entries = {
    data: [
      {
        id: '1',
        type: 'leaveType',
        code: 'annual',
        label: { 'en-US': 'Annual leave', 'zh-CN': '年假' },
        sortOrder: 10,
        active: true,
        extra: { deductsBalance: true, maxDays: null },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    meta: { total: 1 },
  };
  const routes = [
    {
      path: '/dictionaries',
      element: <DictionariesPage />,
      children: [
        { path: 'new', element: <DictionaryEntryDialog /> },
        { path: 'edit/:entryId', element: <DictionaryEntryDialog /> },
      ],
    },
  ];

  it('lists the type with attributes and the create action', async () => {
    serve({
      'GET dictionaryTypes': () => types,
      'GET dictionaryTypes/leaveType/entries': () => entries,
    });
    renderRoutes(routes, '/dictionaries');
    expect(await screen.findByText('Annual leave')).toBeInTheDocument();
    expect(
      screen.getByText(/Deducts balance · Maximum days: no limit/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: copy.dictionaries.create.action }),
    ).toHaveAttribute('href', '/dictionaries/new');
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'dictionaryTypes/leaveType/entries',
        query: { includeInactive: 'true' },
      }),
    );
  });

  it('hides the create action and row menus with read only', async () => {
    permission.can = false;
    serve({
      'GET dictionaryTypes': () => types,
      'GET dictionaryTypes/leaveType/entries': () => entries,
    });
    renderRoutes(routes, '/dictionaries');
    expect(await screen.findByText('Annual leave')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: copy.dictionaries.create.action }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('explains a 403 without a retry', async () => {
    serve({
      'GET dictionaryTypes': () => types,
      'GET dictionaryTypes/leaveType/entries': () => {
        throw apiError(403);
      },
    });
    renderRoutes(routes, '/dictionaries');
    expect(await screen.findByText(copy.common.forbidden)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: enUS['status.retry'] }),
    ).toBeNull();
  });

  it('creates an entry and shows a duplicate code under the field', async () => {
    let attempts = 0;
    serve({
      'GET dictionaryTypes': () => types,
      'GET dictionaryTypes/sealType/entries': () => ({
        data: [],
        meta: { total: 0 },
      }),
      'POST dictionaryTypes/sealType/entries': ({ json }) => {
        attempts += 1;
        if (attempts === 1) throw apiError(409, 'DICTIONARY_CODE_EXISTS');
        return {
          data: {
            ...entries.data[0],
            ...(json as object),
            type: 'sealType',
            id: '9',
          },
        };
      },
    });
    const router = renderRoutes(routes, '/dictionaries/new?type=sealType');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Code/), 'official');
    await userEvent.type(
      within(dialog).getByLabelText('Name (English)'),
      'Company seal',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: enUS.actions.create }),
    );
    expect(
      await within(dialog).findByText(copy.dictionaries.form.codeTaken),
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole('button', { name: enUS.actions.create }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/dictionaries'),
    );
    expect(router.state.location.search).toBe('?type=sealType');
    expect(toaster.show).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        json: {
          code: 'official',
          label: { 'en-US': 'Company seal' },
          sortOrder: 0,
          extra: null,
        },
      }),
    );
  });
});

describe('approval rules page', () => {
  const rules = {
    data: [
      {
        key: 'spend.vp',
        domain: 'spend',
        type: 'money',
        area: 'rules',
        min: undefined,
        allowFuture: true,
        defaultValue: 50000,
        current: version('spend.vp', 50000),
        scheduled: [version('spend.vp', 60000, '2099-01-01T00:00:00.000Z')],
      },
      {
        key: 'leave.head',
        domain: 'leave',
        type: 'days',
        area: 'rules',
        allowFuture: true,
        defaultValue: 3,
        current: version('leave.head', 3),
        scheduled: [],
      },
    ],
    meta: { total: 2 },
  };
  const routes = [
    {
      path: '/rules',
      element: <ApprovalRulesPage />,
      children: [{ path: 'edit/:key', element: <RuleChangeDialog /> }],
    },
  ];

  it('groups rules by domain with their values and schedules', async () => {
    serve({ 'GET approvalRules': () => rules });
    renderRoutes(routes, '/rules');
    expect(
      await screen.findByText(copy.rules.domains.spend.title),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(copy.rules.domains.leave.title)[0],
    ).toBeInTheDocument();
    expect(
      screen.getByText(copy.rules.keys.spend_vp.label),
    ).toBeInTheDocument();
    expect(screen.getByText('¥50,000')).toBeInTheDocument();
    expect(screen.getByText(/¥60,000/)).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: enUS.processManagement.kinds.leave }),
    ).toHaveAttribute(
      'href',
      '/processManagement/definitions/oa.leave/nodes/manager/settings?rule=leave.head',
    );
    expect(screen.queryByRole('link', { name: copy.rules.change })).toBeNull();
    expect(screen.getAllByText(copy.rules.relatedFlows)[0]).toBeInTheDocument();
  });

  it('validates half days and posts a new version', async () => {
    serve({
      'GET approvalRules': () => rules,
      'POST approvalRules/leave.head/versions': () => ({
        data: version('leave.head', 2.5),
      }),
    });
    const router = renderRoutes(routes, '/rules/edit/leave.head');
    const dialog = await screen.findByRole('dialog');
    const input = await within(dialog).findByLabelText(/New value/);
    await userEvent.clear(input);
    await userEvent.type(input, '2.3');
    await userEvent.click(
      within(dialog).getByRole('button', { name: enUS.actions.save }),
    );
    expect(
      await within(dialog).findByText(copy.rules.errors.halfDays),
    ).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    await userEvent.click(
      within(dialog).getByRole('button', { name: enUS.actions.save }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/rules'));
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'approvalRules/leave.head/versions',
        method: 'POST',
        json: { value: 2.5, effectiveFrom: undefined, note: null },
      }),
    );
  });

  it('shows an ordering violation from the server in the dialog', async () => {
    serve({
      'GET approvalRules': () => rules,
      'POST approvalRules/spend.vp/versions': () => {
        throw apiError(400, 'RULE_ORDER_VIOLATED', ['value']);
      },
    });
    renderRoutes(routes, '/rules/edit/spend.vp');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(/New value/);
    await userEvent.click(
      within(dialog).getByRole('button', { name: enUS.actions.save }),
    );
    expect(
      await within(dialog).findByText(copy.rules.errors.orderViolated),
    ).toBeInTheDocument();
  });
});

describe('work calendar page', () => {
  const calendarRules = {
    data: [
      {
        key: 'calendar.workHours',
        domain: 'calendar',
        type: 'workHours',
        area: 'calendar',
        allowFuture: true,
        defaultValue: null,
        current: version('calendar.workHours', {
          start: '09:00',
          end: '18:00',
        }),
        scheduled: [],
      },
      {
        key: 'calendar.timeZone',
        domain: 'calendar',
        type: 'timeZone',
        area: 'calendar',
        allowFuture: false,
        defaultValue: 'Asia/Shanghai',
        current: version('calendar.timeZone', 'Asia/Shanghai'),
        scheduled: [],
      },
    ],
    meta: { total: 2 },
  };
  const routes = [
    {
      path: '/calendar',
      element: <WorkCalendarPage />,
      children: [{ path: 'import', element: <CalendarImportDialog /> }],
    },
  ];

  it('shows the empty year with the import action and keeps the year in the URL', async () => {
    serve({
      'GET approvalRules': () => calendarRules,
      'GET calendarDays': () => ({ data: [], meta: { total: 0 } }),
    });
    renderRoutes(routes, '/calendar?year=2027');
    expect(
      await screen.findByText(
        copy.calendar.days.emptyTitle.replace('{{year}}', '2027'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: copy.calendar.days.import }),
    ).toHaveAttribute('href', '/calendar/import?year=2027');
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'calendarDays', query: { year: 2027 } }),
    );
  });

  it('refuses a working day that ends before it starts', async () => {
    serve({
      'GET approvalRules': () => calendarRules,
      'GET calendarDays': () => ({ data: [], meta: { total: 0 } }),
    });
    renderRoutes(routes, '/calendar');
    const end = await screen.findByLabelText(/Ends at/);
    await userEvent.clear(end);
    await userEvent.type(end, '08:00');
    const card = end.closest('[data-slot=card]') as HTMLElement;
    await userEvent.click(
      within(card).getByRole('button', { name: enUS.actions.save }),
    );
    expect(
      await screen.findByText(copy.calendar.workHours.endBeforeStart),
    ).toBeInTheDocument();
    expect(api.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('imports pasted days and reports invalid lines first', async () => {
    serve({
      'GET approvalRules': () => calendarRules,
      'GET calendarDays': () => ({ data: [], meta: { total: 0 } }),
      'POST calendarDays/import': () => ({
        data: { created: 2, updated: 0, unchanged: 0, removed: 0 },
      }),
    });
    const router = renderRoutes(routes, '/calendar/import?year=2026');
    const dialog = await screen.findByRole('dialog');
    const text = within(dialog).getByLabelText(/Days/);
    await userEvent.type(
      text,
      '2026-10-01,休,National Day{enter}2026-13-01,班',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.calendar.import.submit }),
    );
    expect(
      await within(dialog).findByText(/Line 2 has an invalid date/),
    ).toBeInTheDocument();

    await userEvent.clear(text);
    await userEvent.type(
      text,
      '2026-10-01,休,National Day{enter}2026-10-10,班',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.calendar.import.submit }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/calendar'),
    );
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'calendarDays/import',
        json: {
          year: 2026,
          replace: false,
          entries: [
            { date: '2026-10-01', kind: 'holiday', note: 'National Day' },
            { date: '2026-10-10', kind: 'adjustedWorkday', note: null },
          ],
        },
      }),
    );
  });
});

describe('parseDays', () => {
  it('accepts spreadsheet separators, aliases and short dates', () => {
    expect(
      parseDays('2026/1/1\tholiday\n\n2026-02-14，班，Spring', 2026),
    ).toEqual({
      days: [
        { date: '2026-01-01', kind: 'holiday', note: null },
        { date: '2026-02-14', kind: 'adjustedWorkday', note: 'Spring' },
      ],
      problems: [],
    });
  });

  it('reports each bad line', () => {
    expect(
      parseDays(
        '2025-01-01,休\n2026-01-01,x\n2026-01-02\n2026-01-03,休\n2026-01-03,休',
        2026,
      ).problems,
    ).toEqual([
      { line: 1, problem: 'year' },
      { line: 2, problem: 'kind' },
      { line: 3, problem: 'format' },
      { line: 5, problem: 'duplicate' },
    ]);
  });
});

describe('audit log page', () => {
  const log = {
    id: '7',
    actorId: 'u1',
    actorName: 'Alice',
    action: 'rule.set',
    targetType: 'approvalRules',
    targetId: 'spend.vp',
    before: { value: 50000 },
    after: { value: 60000, effectiveFrom: '2026-01-01T00:00:00.000Z' },
    reason: null,
    at: '2026-10-10T08:00:00.000Z',
  };
  const routes = [
    {
      path: '/audit',
      element: <AuditLogsPage />,
      children: [{ path: ':auditLogId', element: <AuditLogDetail /> }],
    },
  ];

  it('sends the filters from the URL and opens an entry over the filtered list', async () => {
    serve({
      'GET auditLogs/facets': () => ({
        data: { targetTypes: ['approvalRules'], actions: ['rule.set'] },
      }),
      'GET auditLogs': () => ({
        data: [log],
        meta: { page: 1, pageSize: 20, total: 1 },
      }),
      'GET auditLogs/7': () => ({ data: log }),
    });
    const router = renderRoutes(
      routes,
      '/audit?targetType=approvalRules&from=2026-10-01&to=2026-10-10',
    );
    const link = await screen.findByRole('link', { name: /2026/ });
    expect(api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'auditLogs',
        query: expect.objectContaining({
          targetType: 'approvalRules',
          orderBy: '-at',
          page: 1,
        }) as unknown,
      }),
    );
    await userEvent.click(link);
    const drawer = await screen.findByRole('dialog');
    expect(router.state.location.search).toBe(
      '?targetType=approvalRules&from=2026-10-01&to=2026-10-10',
    );
    expect(within(drawer).getByText('Alice')).toBeInTheDocument();
    // The changed fields are marked in text, not by color alone.
    expect(within(drawer).getAllByText(copy.auditLogs.changed)).toHaveLength(2);
  });

  it('shows the empty state without filters', async () => {
    serve({
      'GET auditLogs/facets': () => ({
        data: { targetTypes: [], actions: [] },
      }),
      'GET auditLogs': () => ({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0 },
      }),
    });
    renderRoutes(routes, '/audit');
    expect(
      await screen.findByText(copy.auditLogs.empty.title),
    ).toBeInTheDocument();
  });

  it('offers signing in again on 401', async () => {
    serve({
      'GET auditLogs/facets': () => ({
        data: { targetTypes: [], actions: [] },
      }),
      'GET auditLogs': () => {
        throw apiError(401);
      },
    });
    renderRoutes(routes, '/audit');
    await userEvent.click(
      await screen.findByRole('button', { name: enUS.actions.signInAgain }),
    );
    expect(refresh).toHaveBeenCalled();
  });
});
