import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  dataResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  BOOKING_READ_FIELDS,
  meetingRoomServiceToken,
  type MeetingBooking,
} from '../../providers/meeting-rooms/contract.js';
import { MeetingRoomError } from '../../providers/meeting-rooms/index.js';
import { employeeServiceToken } from '../../providers/employees/contract.js';
import { calendarServiceToken } from '../../providers/platform/index.js';

const Summary = z.object({
  date: z.string(),
  timeZone: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      startAt: z.iso.datetime(),
      endAt: z.iso.datetime(),
      status: z.enum(['pendingConfirmation', 'confirmed']),
    }),
  ),
});
export default [
  defineApiRoutes<Application>((app) => {
    const c = app.container,
      db = c.resolve(databaseManagerToken),
      calendar = c.resolve(calendarServiceToken),
      bookings = c.resolve(meetingRoomServiceToken);
    const r = new Hono<AuthEnv & AuthorizationEnv>();
    r.use(
      '/workbench/meetings',
      c.resolve(authenticationToken).required(),
      c.resolve(authorizationToken).middleware(),
    );
    r.onError((error, ctx) =>
      apiErrorHandler(
        error instanceof MeetingRoomError && error.code === 'ACCESS_DENIED'
          ? new ApiError({
              status: 'PERMISSION_DENIED',
              reason: 'ACCESS_DENIED',
              domain: 'workbench',
              message: 'Meeting booking access is unavailable.',
            })
          : error,
        ctx,
      ),
    );
    r.get(
      '/workbench/meetings',
      describeRoute({
        tags: ['Workbench'],
        operationId: 'workbenchTodayMeetings',
        summary:
          'Current actor today bookings, intersected with booking view policy',
        responses: { 200: dataResponse(Summary), ...apiErrorResponses },
      }),
      async (ctx) => {
        const actorId = ctx.get('auth')!.user.id;
        const result = await ctx.get('authz').authorize({
          resource: { type: 'composite', id: 'oa.meetingBookings' },
          action: 'view',
        });
        const policy =
          result.effect === 'deny'
            ? undefined
            : result.conditions?.database?.meetingBookings;
        const readable =
          policy &&
          (policy.read === true ||
            (policy.read !== false &&
              (policy.read.fields === undefined ||
                (Array.isArray(policy.read.fields) &&
                  BOOKING_READ_FIELDS.every(
                    (field) =>
                      policy.read !== true &&
                      policy.read !== false &&
                      Array.isArray(policy.read.fields) &&
                      policy.read.fields.includes(field),
                  )))));
        if (!policy || !readable)
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            reason: 'ACCESS_DENIED',
            domain: 'workbench',
            message: 'Meeting booking access is unavailable.',
          });
        const date = calendar.localDate(new Date()),
          start = calendar.resolveLocalDateTime(date, '00:00'),
          end = calendar.resolveLocalDateTime(
            calendar.addCalendarDays(date, 1),
            '00:00',
          );
        const data = await db.transaction(async (tx) => {
          const employee = await c
            .resolve(employeeServiceToken)
            .getByUserId(actorId, tx);
          // A standalone administrator has no employee meetings to summarize.
          // Authorization above still applies even when there is no archive.
          if (!employee)
            return { date, timeZone: calendar.timeZone(), total: 0, items: [] };
          if (!employee.active || employee.status === 'left')
            throw new ApiError({
              status: 'PERMISSION_DENIED',
              reason: 'ACCESS_DENIED',
              domain: 'workbench',
              message: 'An active employee is required.',
            });
          // Filter before pagination. Public getBooking verifies the complete current field policy;
          // room availability and its busy intervals never authorize a meeting title.
          const rows = await tx
            .repository<MeetingBooking>('meetingBookings')
            .withPolicy(policy)
            .findMany({
              filter: (f) =>
                f.and([
                  f.date('startAt').before(end),
                  f.date('endAt').after(start),
                  f.or([
                    f.string('status').eq('confirmed'),
                    f.string('status').eq('pendingConfirmation'),
                  ]),
                ]),
              sort: (s) => [s.field('startAt').asc(), s.field('id').asc()],
            });
          const visible = [];
          for (const row of rows) {
            const booking = row.id
              ? await bookings.getBooking(row.id, tx, policy)
              : undefined;
            if (
              booking &&
              (booking.organizerUserId === actorId ||
                booking.attendeeUserIds.includes(actorId))
            )
              visible.push(booking);
          }
          return {
            date,
            timeZone: calendar.timeZone(),
            total: visible.length,
            items: visible.slice(0, 5).map((row) => ({
              id: row.id,
              title: row.title,
              startAt: new Date(row.startAt).toISOString(),
              endAt: new Date(row.endAt).toISOString(),
              status: row.status,
            })),
          };
        });
        return ctx.json({ data: Summary.parse(data) });
      },
    );
    const root = new Hono();
    root.route('/', r);
    return root;
  }),
];
