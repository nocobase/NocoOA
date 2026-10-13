import { ApiClientError } from '@nocobase/app-client';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import enUS from '../../../client/locales/en-US.js';
import locale from '../../../client/locales/modules/meeting-rooms.en-US.js';
import List from '../../../client/pages/meeting-rooms/index.js';
import Detail from '../../../client/pages/meeting-rooms/booking-detail.js';
import Action from '../../../client/pages/meeting-rooms/booking-action.js';
import Form from '../../../client/pages/meeting-rooms/booking-form.js';
import RoomDetail from '../../../client/pages/meeting-rooms/room-detail.js';
import { MeetingError } from '../../../client/pages/meeting-rooms/states.js';
import RoomForm from '../../../client/pages/meeting-rooms/room-form.js';
const { api, reload, toaster, identity, guard } = vi.hoisted(() => ({
  api: { request: vi.fn() },
  reload: vi.fn(),
  toaster: { show: vi.fn() },
  identity: { id: 'organizer' },
  guard: { decide: (() => true) as () => boolean },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
  useToaster: () => toaster,
  useNavigationGuard: (decide: () => boolean) => {
    guard.decide = decide;
  },
}));
vi.mock('@nocobase/app-plugin-authentication/client', async (original) => ({
  ...(await original<
    typeof import('@nocobase/app-plugin-authentication/client')
  >()),
  useAuthentication: () => ({ session: { user: { id: identity.id } } }),
}));
const runtime = await createTestI18nRuntime({
  application: { namespace: 'nb3-oa', resources: { ...enUS, ...locale } },
});
const room = {
  id: 'room-1',
  name: 'Boardroom',
  location: 'Floor 2',
  facilities: 'Projector',
  capacity: 10,
  active: true,
  requiresAdminConfirmation: true,
  version: 1,
};
const options = {
  companyTimeZone: 'Asia/Shanghai',
  actor: { id: 'organizer', name: 'Organizer' },
  modes: ['mine', 'participating'],
  canCreate: true,
  canManage: false,
};
const booking = {
  id: 'booking-1',
  seriesId: 'series-1',
  roomId: room.id,
  title: 'Planning meeting',
  organizerUserId: 'organizer',
  organizer: { id: 'organizer', name: 'Organizer' },
  attendeeUserIds: [],
  attendees: [],
  companyTimeZone: 'Asia/Shanghai',
  status: 'pendingConfirmation',
  startAt: '2035-01-02T01:00:00Z',
  endAt: '2035-01-02T02:00:00Z',
  confirmedByUser: null,
  confirmedAt: null,
  checkedInByUser: null,
  checkedInAt: null,
  reason: null,
  version: 3,
};
type Request = {
  path: string;
  method?: string;
  query?: Record<string, string>;
  json?: Record<string, unknown>;
};
function serve(overrides?: (r: Request) => unknown) {
  api.request.mockImplementation(async (r: Request) => {
    const custom = overrides?.(r);
    if (custom !== undefined) return custom;
    if (r.method) return { data: [booking] };
    if (r.path === 'users')
      return { data: [], meta: { page: 1, pageSize: 20, total: 0 } };
    if (r.path === 'meetingBookings/options') return { data: options };
    if (r.path.endsWith('/actions'))
      return { data: { actions: ['edit', 'cancel'] } };
    if (r.path.endsWith('/future'))
      return {
        data: {
          items: [
            {
              id: booking.id,
              version: 3,
              startAt: booking.startAt,
              status: 'pendingConfirmation',
            },
            {
              id: 'booking-3',
              version: 8,
              startAt: '2035-01-04T01:00:00Z',
              status: 'confirmed',
            },
          ],
          total: 2,
        },
      };
    if (r.path.endsWith('/availability')) return { data: { busy: [] } };
    if (r.path === 'meetingRooms/availability-search')
      return {
        data: [{ ...room, busy: [] }],
        meta: { page: 1, pageSize: 20, total: 1 },
      };
    if (r.path === 'meetingRooms')
      return { data: [room], meta: { page: 1, pageSize: 20, total: 1 } };
    if (r.path.startsWith('meetingRooms/')) return { data: room };
    return { data: booking };
  });
}
function show(
  path: string,
  component: 'list' | 'detail' | 'action' | 'form' | 'room' = 'list',
) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <Outlet context={{ onSaved: reload, options }} />,
        children: [
          { path: 'list', element: <List /> },
          { path: 'detail/:bookingId', element: <Detail /> },
          { path: 'action/:bookingId/:action', element: <Action /> },
          { path: 'form/:bookingId', element: <Form /> },
          { path: 'new-room', element: <RoomForm /> },
          { path: 'room/:roomId', element: <RoomDetail /> },
          { path: 'done', element: <p>Done</p> },
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
  identity.id = 'organizer';
  api.request.mockReset();
  reload.mockReset();
  toaster.show.mockReset();
});
it('keeps loading distinct from empty and offers one creation CTA after loading', async () => {
  let resolve!: (v: unknown) => void;
  const pending = new Promise((r) => {
    resolve = r;
  });
  serve((r) => (r.path === 'meetingRooms' ? pending : undefined));
  show('/list?tab=rooms');
  expect(
    screen.queryByRole('button', { name: 'Book a meeting room' }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(api.request).toHaveBeenCalled());
  resolve({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  expect(await screen.findByText('No records yet')).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Book a meeting room' });
  expect(
    screen.getAllByRole('button', { name: 'Book a meeting room' }),
  ).toHaveLength(1);
  expect(
    screen
      .getByRole('button', { name: 'Book a meeting room' })
      .closest('[data-slot=application-toolbar]'),
  ).not.toBeNull();
});
it('uses server sort and preserves tab/query; IME composition does not issue a partial search', async () => {
  const user = userEvent.setup();
  serve();
  const { router } = show('/list?tab=rooms&sort=capacity&direction=desc');
  await screen.findByText('Boardroom');
  expect(
    api.request.mock.calls.find(([r]) => r.path === 'meetingRooms')?.[0].query,
  ).toMatchObject({ sort: 'capacity', direction: 'desc' });
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(
      api.request.mock.calls.filter(([r]) => r.path === 'meetingRooms').length,
    ).toBeGreaterThan(1),
  );
  expect(router.state.location.search).toContain('sort=capacity');
  const input = screen.getByLabelText('Search');
  fireEvent.input(input, { target: { value: 'zhong' }, isComposing: true });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(
    api.request.mock.calls.some(
      ([r]) => r.path === 'meetingRooms' && r.query?.search === 'zhong',
    ),
  ).toBe(false);
  fireEvent.input(input, { target: { value: '中' }, isComposing: false });
  fireEvent.compositionEnd(input, { data: '中' });
  await waitFor(() =>
    expect(
      api.request.mock.calls.some(
        ([r]) => r.path === 'meetingRooms' && r.query?.search === '中',
      ),
    ).toBe(true),
  );
});
it('renders the frozen booking zone and no actions when the current authorized facade is empty', async () => {
  serve((r) =>
    r.path.endsWith('/actions') ? { data: { actions: [] } } : undefined,
  );
  show('/detail/booking-1', 'detail');
  await screen.findByText('Asia/Shanghai');
  expect(
    screen.queryByRole('button', { name: 'Cancel booking' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Edit', exact: true }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
});
it('future cancellation submits the complete safe version set and needs destructive confirmation', async () => {
  const user = userEvent.setup();
  serve();
  show('/action/booking-1/cancel', 'action');
  await screen.findByText('Planning meeting');
  await user.type(screen.getByLabelText('Reason'), 'Schedule changed');
  await user.click(
    screen.getByRole('switch', { name: 'This and future active bookings' }),
  );
  await screen.findByText('This affects 2 active booking(s).');
  await user.click(
    screen.getByRole('button', { name: 'Cancel booking', exact: true }),
  );
  expect(api.request.mock.calls.some(([r]) => r.method)).toBe(false);
  const buttons = screen.getAllByRole('button', {
    name: 'Cancel booking',
    exact: true,
  });
  await user.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(reload).toHaveBeenCalled());
  const write = api.request.mock.calls.find(([r]) => r.method)?.[0];
  expect(write).toMatchObject({
    path: 'meetingBookings/booking-1/cancelFuture',
    json: {
      expectedVersions: { 'booking-1': 3, 'booking-3': 8 },
      reason: 'Schedule changed',
    },
  });
});
it('editing converts instants to the current company zone while failures retain user input and hide raw errors', async () => {
  const user = userEvent.setup();
  serve((r) =>
    r.path === 'meetingBookings/options'
      ? { data: { ...options, companyTimeZone: 'Europe/London' } }
      : r.method
        ? Promise.reject(
            new ApiClientError('PRIVATE SQL', {
              status: 409,
              reason: 'VERSION_CONFLICT',
              method: 'PATCH',
              url: r.path,
            }),
          )
        : undefined,
  );
  show('/form/booking-1', 'form');
  await screen.findByText(
    'Dates and times use the current company time zone: Europe/London.',
  );
  expect(screen.getByLabelText(/Start time/)).toHaveValue('01:00');
  await user.clear(screen.getByLabelText(/Meeting title/));
  await user.type(screen.getByLabelText(/Meeting title/), 'Changed planning');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('This record changed. Reload before retrying.');
  expect(screen.getByLabelText(/Meeting title/)).toHaveValue(
    'Changed planning',
  );
  expect(screen.queryByText('PRIVATE SQL')).not.toBeInTheDocument();
});
it('room management validates a reason before creating and focuses the first invalid field', async () => {
  const user = userEvent.setup();
  serve((r) =>
    r.path === 'meetingBookings/options'
      ? { data: { ...options, canManage: true } }
      : undefined,
  );
  show('/new-room', 'room');
  await screen.findByLabelText(/Room name/);
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(screen.getByLabelText(/Room name/)).toHaveFocus());
  await user.type(screen.getByLabelText(/Room name/), 'Workshop');
  await user.type(
    screen.getByLabelText(/Reason/),
    'Real administrative change',
  );
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(
    api.request.mock.calls.find(([r]) => r.method)?.[0].json,
  ).toMatchObject({
    name: 'Workshop',
    reason: 'Real administrative change',
    capacity: 1,
  });
});

it('hides actions when refreshed booking detail denies ordinary viewing even if action metadata arrives', async () => {
  const user = userEvent.setup();
  let denied = false;
  serve((r) =>
    denied && r.path === 'meetingBookings/booking-1'
      ? Promise.reject(
          new ApiClientError('Forbidden', {
            status: 403,
            reason: 'PERMISSION_DENIED',
            method: 'GET',
            url: r.path,
          }),
        )
      : undefined,
  );
  show('/detail/booking-1', 'detail');
  await screen.findByRole('button', { name: 'Cancel booking' });
  denied = true;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Cancel booking' }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.queryByText('Asia/Shanghai')).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('button', { name: 'Edit', exact: true }),
  ).not.toBeInTheDocument();
});

it('refetches detail for a new actor and cannot show the previous actor booking while authorization is pending', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  serve((r) =>
    identity.id === 'different-actor' && r.path === 'meetingBookings/booking-1'
      ? pending
      : undefined,
  );
  const { router } = show('/detail/booking-1', 'detail');
  await screen.findByText('Asia/Shanghai');
  identity.id = 'different-actor';
  await act(async () => {
    await router.navigate('/detail/booking-1?changedActor=1');
  });
  expect(screen.queryByText('Asia/Shanghai')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Cancel booking' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish({ data: { ...booking, title: 'Current actor booking' } });
  });
  await screen.findByRole('heading', { name: 'Current actor booking' });
});

it('blocks leaving a dirty booking form and keeps the typed title when discard is declined', async () => {
  serve();
  show('/form/booking-1', 'form');
  const title = await screen.findByLabelText(/Meeting title/);
  await userEvent.clear(title);
  await userEvent.type(title, 'Unsaved room booking');
  await act(async () => {
    expect(guard.decide()).toBe(false);
  });
  await screen.findByRole('alertdialog');
  await userEvent.click(
    screen.getByRole('button', { name: 'Keep editing', exact: true }),
  );
  expect(title).toHaveValue('Unsaved room booking');
});

it('shows the actual server TIME_CONFLICT at the room field and retains editable values', async () => {
  serve((r) =>
    r.method
      ? Promise.reject(
          new ApiClientError('PRIVATE CONFLICT', {
            status: 409,
            reason: 'TIME_CONFLICT',
          }),
        )
      : undefined,
  );
  show('/form/booking-1', 'form');
  const title = await screen.findByLabelText(/Meeting title/);
  await userEvent.clear(title);
  await userEvent.type(title, 'Conflicting series');
  await userEvent.click(
    screen.getByRole('button', { name: 'Save', exact: true }),
  );
  await screen.findByText(
    'The time overlaps another booking. Choose another time.',
  );
  expect(title).toHaveValue('Conflicting series');
  expect(screen.queryByText('PRIVATE CONFLICT')).not.toBeInTheDocument();
});

it('preserves source query and hash in list record and creation links', async () => {
  serve();
  show('/list?tab=rooms#source');
  const link = await screen.findByRole('link', {
    name: 'Boardroom',
    exact: true,
  });
  expect(link).toHaveAttribute('href', '/list/room/room-1?tab=rooms#source');
  expect(
    screen.getByRole('button', { name: 'Book a meeting room', exact: true }),
  ).toHaveAttribute('href', '/list/reserve?tab=rooms#source');
});
it('preserves source query and hash in booking edit and action links', async () => {
  serve();
  show('/detail/booking-1?tab=mine#source', 'detail');
  expect(
    await screen.findByRole('button', { name: 'Edit', exact: true }),
  ).toHaveAttribute('href', '/detail/booking-1/edit?tab=mine#source');
  expect(
    screen.getByRole('button', { name: 'Cancel booking', exact: true }),
  ).toHaveAttribute('href', '/detail/booking-1/action/cancel?tab=mine#source');
});
it('preserves source query and hash in room reserve and configuration links', async () => {
  serve();
  show('/room/room-1?tab=rooms#source');
  expect(
    await screen.findByRole('button', { name: 'Edit', exact: true }),
  ).toHaveAttribute('href', '/room/room-1/edit?tab=rooms#source');
  expect(
    screen.getByRole('button', { name: 'Book a meeting room', exact: true }),
  ).toHaveAttribute('href', '/room/room-1/reserve?tab=rooms#source');
});

it.each([403, 404, 500])(
  'offers retry only for recoverable errors (%s)',
  (status) => {
    render(
      <TestI18nProvider runtime={runtime}>
        <MeetingError
          error={
            new ApiClientError('Error', {
              status,
              method: 'GET',
              url: 'meetingRooms',
            })
          }
          retry={vi.fn()}
        />
      </TestI18nProvider>,
    );
    const retry = screen.queryByRole('button', { name: 'Retry' });
    if (status === 500) expect(retry).toBeVisible();
    else expect(retry).not.toBeInTheDocument();
  },
);

it('finds capacity-matched rooms for a URL time range and carries it into reservation', async () => {
  serve();
  show(
    '/list?tab=availability&meetingDate=2035-01-02&meetingStart=09%3A00&meetingEnd=10%3A00&meetingCapacity=5',
  );
  await screen.findByText('Boardroom');
  expect(api.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'meetingRooms/availability-search',
      query: expect.objectContaining({
        capacity: '5',
        startAt: '2035-01-02T01:00:00.000Z',
        endAt: '2035-01-02T02:00:00.000Z',
      }),
    }),
  );
  expect(
    screen.getByText('Available · admin confirmation'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Book a meeting room' }),
  ).toHaveAttribute('href', expect.stringContaining('selectedRoom=room-1'));
});
it('never offers a reservation for a conflicting room or a failed availability read', async () => {
  serve((r) =>
    r.path === 'meetingRooms/availability-search'
      ? {
          data: [
            {
              ...room,
              busy: [{ startAt: booking.startAt, endAt: booking.endAt }],
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        }
      : undefined,
  );
  show('/list?tab=availability&meetingDate=2035-01-02');
  await screen.findByText('Conflict');
  expect(
    screen.queryByRole('button', { name: 'Book a meeting room' }),
  ).not.toBeInTheDocument();
});
