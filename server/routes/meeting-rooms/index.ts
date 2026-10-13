import { Hono, type Context } from 'hono';
import {
  authenticationToken,
  userAdministrationServiceToken,
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
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
} from '@nocobase/app-server/router';
import {
  databaseManagerToken,
  RepositoryError,
  type RepositoryPolicy,
  type DatabaseConnection,
} from '@nocobase/db';
import { i18nToken } from '@nocobase/app-server/i18n';
import { getRequestLocale } from '@nocobase/i18n/server';
import { orgServiceToken } from '../../providers/org/contract.js';
import {
  MeetingRoomError,
  meetingRoomServiceToken,
  ROOM_FIELDS,
  BOOKING_FIELDS,
  type MeetingBooking,
  type MeetingRoom,
} from '../../providers/meeting-rooms/index.js';
import { calendarServiceToken } from '../../providers/platform/index.js';
import { employeeServiceToken } from '../../providers/employees/contract.js';
import { LocalDateTimeError } from '../../providers/platform/time-zone.js';
import * as S from './schemas.js';
type Env = AuthEnv & AuthorizationEnv;
export default [
  defineApiRoutes<Application>((app) => {
    const c = app.container,
      db = c.resolve(databaseManagerToken),
      service = c.resolve(meetingRoomServiceToken),
      auth = c.resolve(authenticationToken),
      authz = c.resolve(authorizationToken),
      i18n = c.resolve(i18nToken);
    const rooms = new Hono<Env>(),
      bookings = new Hono<Env>();
    for (const r of [rooms, bookings]) {
      r.use('*', auth.required(), authz.middleware());
      r.onError(async (error, ctx) => {
        if (
          !(error instanceof MeetingRoomError) &&
          !(error instanceof LocalDateTimeError) &&
          !(
            error instanceof RepositoryError &&
            (error.status === 'PERMISSION_DENIED' ||
              error.code === 'RECORD_NOT_FOUND')
          )
        )
          return apiErrorHandler(error, ctx);
        const code =
          error instanceof MeetingRoomError
            ? error.code
            : error instanceof LocalDateTimeError
              ? error.code
              : error.status === 'PERMISSION_DENIED'
                ? 'ACCESS_DENIED'
                : 'BOOKING_NOT_FOUND';
        const locale = getRequestLocale(ctx) ?? i18n.getDefaultLocale();
        await i18n.ensureLocaleLoaded(locale);
        const message = i18n.getFixedT(
          'nb3-oa',
          locale,
        )(`meetingRooms.errors.${code}`);
        return apiErrorHandler(
          new ApiError({
            domain: 'meetingRooms',
            reason: code,
            status:
              code === 'ACCESS_DENIED'
                ? 'PERMISSION_DENIED'
                : code.includes('NOT_FOUND')
                  ? 'NOT_FOUND'
                  : code.includes('CONFLICT')
                    ? 'ABORTED'
                    : code.startsWith('INVALID')
                      ? 'INVALID_ARGUMENT'
                      : 'FAILED_PRECONDITION',
            message: code,
            localizedMessage: { locale, message },
            metadata: {
              ns: 'nb3-oa',
              key: `meetingRooms.errors.${code}`,
              ...(error instanceof MeetingRoomError && error.dates
                ? { dates: error.dates }
                : {}),
            },
            cause: error,
          }),
          ctx,
        );
      });
    }
    const actor = (ctx: Context<Env>) => ctx.get('auth')!.user.id;
    function fail(code: string): never {
      throw new MeetingRoomError(code);
    }
    async function policy(
      ctx: Context<Env>,
      resource: 'oa.meetingRooms' | 'oa.meetingBookings',
      action: string,
    ) {
      const decision = await ctx
        .get('authz')
        .authorize({ resource: { type: 'composite', id: resource }, action });
      const p =
        decision.effect === 'deny' ? undefined : decision.conditions?.database;
      const collection =
        resource === 'oa.meetingRooms' ? 'meetingRooms' : 'meetingBookings';
      const value = p?.[collection];
      if (!value) fail('ACCESS_DENIED');
      return value;
    }
    const doc = (
      id: string,
      summary: string,
      schema: typeof S.Room | typeof S.Booking | typeof S.Availability,
      list = false,
    ) =>
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: id,
        summary,
        responses: {
          '200': list ? listResponse(schema, S.Meta) : dataResponse(schema),
          ...apiErrorResponses,
        },
      });
    async function complete(
      tx: DatabaseConnection,
      collection: 'meetingRooms' | 'meetingBookings',
      id: string,
      p: RepositoryPolicy,
    ) {
      const booking =
        collection === 'meetingBookings'
          ? await service.getBooking(id, tx, p)
          : undefined;
      const row =
        collection === 'meetingBookings'
          ? booking
            ? { ...booking }
            : undefined
          : await tx
              .repository(collection)
              .withPolicy(p)
              .findOne({ filter: { id } });
      if (!row) fail('BOOKING_NOT_FOUND');
      const fields =
        collection === 'meetingRooms' ? ROOM_FIELDS : BOOKING_FIELDS;
      if (fields.some((field) => !(field in row))) fail('ACCESS_DENIED');
      return row;
    }
    async function dto(row: MeetingBooking) {
      const ids = [
        ...new Set(
          [
            row.organizerUserId,
            ...row.attendeeUserIds,
            row.confirmedBy,
            row.checkedInBy,
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      const names = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 100) {
        for (const u of (
          await c.resolve(userAdministrationServiceToken).list({
            userIds: ids.slice(i, i + 100),
            pageSize: 100,
            kind: 'all',
          })
        ).items)
          names.set(u.id, u.name);
      }
      const user = (id: string | null) =>
        id ? { id, name: names.get(id) ?? id } : null;
      const iso = (value: Date | string | null) =>
        value ? new Date(value).toISOString() : null;
      return S.Booking.parse({
        ...row,
        organizer: user(row.organizerUserId),
        attendees: row.attendeeUserIds.map((id) => user(id)),
        confirmedByUser: user(row.confirmedBy),
        checkedInByUser: user(row.checkedInBy),
        startAt: iso(row.startAt),
        endAt: iso(row.endAt),
        confirmedAt: iso(row.confirmedAt),
        checkedInAt: iso(row.checkedInAt),
      });
    }
    async function visibleResult(
      rows: MeetingBooking[],
      p: RepositoryPolicy,
      tx: DatabaseConnection,
    ) {
      const values = [];
      for (const row of rows) {
        const readable = await service.getBooking(row.id, tx, p);
        if (!readable) fail('BOOKING_NOT_FOUND');
        values.push(readable);
      }
      return values;
    }
    async function enrich(value: MeetingBooking | MeetingBooking[]) {
      return Array.isArray(value) ? Promise.all(value.map(dto)) : dto(value);
    }
    async function currentActor(ctx: Context<Env>, tx: DatabaseConnection) {
      const id = actor(ctx),
        employee = await c.resolve(employeeServiceToken).getByUserId(id, tx),
        user = await c
          .resolve(userAdministrationServiceToken)
          .withConnection(tx)
          .get(id);
      if (
        !employee?.active ||
        employee.status === 'left' ||
        !user ||
        user.kind !== 'person' ||
        user.disabledAt
      )
        fail('ACCESS_DENIED');
      return { employee, user };
    }
    function readableFields(p: RepositoryPolicy, fields: readonly string[]) {
      if (p.read === true) return true;
      if (p.read === false || p.read.fields === false) return false;
      return (
        p.read.fields === undefined ||
        fields.every(
          (field) =>
            p.read !== true &&
            p.read !== false &&
            Array.isArray(p.read.fields) &&
            p.read.fields.includes(field),
        )
      );
    }
    async function optionalPolicy(
      ctx: Context<Env>,
      resource: 'oa.meetingRooms' | 'oa.meetingBookings',
      action: string,
    ) {
      try {
        return await policy(ctx, resource, action);
      } catch (error) {
        if (error instanceof MeetingRoomError) return undefined;
        throw error;
      }
    }
    async function permitted(
      p: RepositoryPolicy | undefined,
      row: MeetingBooking,
      tx: DatabaseConnection,
    ) {
      try {
        if (!p) return false;
        const visible = await service.getBooking(row.id, tx, p);
        if (!visible) return false;
        return (
          await tx
            .repository('meetingBookings')
            .withPolicy(p)
            .validateMutation({
              operation: 'updateOne',
              filter: { id: row.id },
              values: {
                ...row,
                version: row.version + 1,
                statusChangedAt: new Date(),
              },
            })
        ).valid;
      } catch (error) {
        if (
          error instanceof MeetingRoomError ||
          error instanceof RepositoryError
        )
          return false;
        throw error;
      }
    }
    bookings.get(
      '/options',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'meetingBookingOptions',
        responses: { '200': dataResponse(S.Options), ...apiErrorResponses },
      }),
      async (ctx) => {
        const roomPolicy = await policy(ctx, 'oa.meetingRooms', 'view');
        const createPolicy = await optionalPolicy(
          ctx,
          'oa.meetingBookings',
          'create',
        );
        const managePolicy = await optionalPolicy(
          ctx,
          'oa.meetingRooms',
          'manage',
        );
        const viewPolicy = await optionalPolicy(
          ctx,
          'oa.meetingBookings',
          'view',
        );
        const result = await db.transaction(async (tx) => {
          const { employee, user } = await currentActor(ctx, tx),
            calendar = c.resolve(calendarServiceToken);

          const isAdmin = await c
            .resolve(orgServiceToken)
            .hasDutyRole(user.id, 'admin', tx);
          let canCreate = false,
            canManage = false;
          try {
            const p = createPolicy;
            if (!p || !readableFields(p, BOOKING_FIELDS)) fail('ACCESS_DENIED');
            const room = await tx
              .repository('meetingRooms')
              .withPolicy(roomPolicy)
              .findOne({ filter: { active: true } });
            if (room && ROOM_FIELDS.every((field) => field in room))
              canCreate = (
                await tx
                  .repository('meetingBookings')
                  .withPolicy(p)
                  .validateMutation({
                    operation: 'createOne',
                    values: {
                      id: 'capability-check',
                      seriesId: null,
                      roomId: room.id,
                      organizerEmployeeId: employee.id,
                      organizerUserId: user.id,
                      title: '',
                      companyTimeZone: calendar.timeZone(),
                      attendeeUserIds: [],
                      status: room.requiresAdminConfirmation
                        ? 'pendingConfirmation'
                        : 'confirmed',
                      startAt: new Date(),
                      endAt: new Date(),
                      confirmedBy: null,
                      confirmedAt: null,
                      checkedInBy: null,
                      checkedInAt: null,
                      reason: null,
                      version: 1,
                      statusChangedAt: new Date(),
                    },
                  })
              ).valid;
          } catch (error) {
            if (!(
              error instanceof MeetingRoomError ||
              error instanceof RepositoryError
            ))
              throw error;
          }
          if (isAdmin)
            try {
              const p = managePolicy;
              if (!p || !readableFields(p, ROOM_FIELDS)) fail('ACCESS_DENIED');
              canManage = (
                await tx
                  .repository('meetingRooms')
                  .withPolicy(p)
                  .validateMutation({
                    operation: 'createOne',
                    values: {
                      id: 'capability-check',
                      name: '',
                      location: null,
                      facilities: null,
                      capacity: 1,
                      active: true,
                      requiresAdminConfirmation: false,
                      version: 1,
                    },
                  })
              ).valid;
            } catch (error) {
              if (!(
                error instanceof MeetingRoomError ||
                error instanceof RepositoryError
              ))
                throw error;
            }
          const modes: ('mine' | 'participating' | 'administration')[] = [];
          try {
            if (!viewPolicy || !readableFields(viewPolicy, BOOKING_FIELDS))
              fail('ACCESS_DENIED');
            modes.push('mine', 'participating');
            if (isAdmin) modes.push('administration');
          } catch (error) {
            if (!(error instanceof MeetingRoomError)) throw error;
          }
          return {
            companyTimeZone: calendar.timeZone(),
            actor: { id: user.id, name: user.name },
            modes,
            canCreate,
            canManage,
          };
        });
        return ctx.json({ data: S.Options.parse(result) });
      },
    );
    bookings.get(
      '/:id/actions',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'meetingBookingActions',
        responses: { '200': dataResponse(S.Actions), ...apiErrorResponses },
      }),
      apiValidator('param', S.Params),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingBookings', 'view');
        const actionPolicies = new Map<string, RepositoryPolicy | undefined>();
        for (const action of ['edit', 'cancel', 'confirm', 'reject', 'checkIn'])
          actionPolicies.set(
            action,
            await optionalPolicy(ctx, 'oa.meetingBookings', action),
          );
        const result = await db.transaction(async (tx) => {
          await currentActor(ctx, tx);
          const row = await service.getBooking(
            ctx.req.valid('param').id,
            tx,
            p,
          );
          if (!row) fail('BOOKING_NOT_FOUND');
          const actions = [];
          for (const action of await service.businessActions(
            row,
            actor(ctx),
            tx,
          ))
            if (await permitted(actionPolicies.get(action), row, tx))
              actions.push(action);
          return { actions };
        });
        return ctx.json({ data: S.Actions.parse(result) });
      },
    );
    bookings.get(
      '/:id/future',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'meetingBookingFuture',
        responses: { '200': dataResponse(S.Future), ...apiErrorResponses },
      }),
      apiValidator('param', S.Params),
      apiValidator('query', S.FutureQuery),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingBookings', 'view'),
          action = ctx.req.valid('query').action;
        const actionPolicy = await policy(ctx, 'oa.meetingBookings', action);
        const result = await db.transaction(async (tx) => {
          await currentActor(ctx, tx);
          const id = ctx.req.valid('param').id;
          const anchor = await service.getBooking(id, tx, p);
          if (!anchor) fail('BOOKING_NOT_FOUND');
          if (
            !(await service.businessActions(anchor, actor(ctx), tx)).includes(
              action,
            )
          )
            fail('INVALID_STATE');
          const rows = await service.futureCandidates(id, tx),
            items = [];
          for (const row of rows) {
            if (
              !(await service.getBooking(row.id, tx, p)) ||
              !(await permitted(actionPolicy, row, tx))
            )
              fail('ACCESS_DENIED');
            if (
              !(await service.businessActions(row, actor(ctx), tx)).includes(
                action,
              )
            )
              fail('INVALID_STATE');
            items.push({
              id: row.id,
              version: row.version,
              startAt: new Date(row.startAt).toISOString(),
              status: row.status,
            });
          }
          return { items, total: items.length };
        });
        return ctx.json({ data: S.Future.parse(result) });
      },
    );
    rooms.get(
      '/availability-search',
      doc(
        'searchMeetingRoomAvailability',
        'List capacity-matched authorized rooms with busy intervals only',
        S.AvailabilityRoom,
        true,
      ),
      apiValidator('query', S.AvailabilitySearchQuery),
      async (ctx) => {
        const q = ctx.req.valid('query');
        const p = await policy(ctx, 'oa.meetingRooms', 'view');
        if (!readableFields(p, ROOM_FIELDS)) fail('ACCESS_DENIED');
        const repo = db.repository<MeetingRoom>('meetingRooms').withPolicy(p);
        const filter = (f: import('@nocobase/db').FilterBuilder) =>
          f.and([
            f.boolean('active').isTrue(),
            f.number('capacity').gte(q.capacity),
          ]);
        const total = await repo.count({ filter });
        const matched = await repo.findMany({
          filter,
          offset: (q.page - 1) * q.pageSize,
          limit: q.pageSize,
          sort: (s) => [s.field('capacity').asc(), s.field('id').asc()],
        });
        if (
          matched.some((room) => ROOM_FIELDS.some((field) => !(field in room)))
        )
          fail('ACCESS_DENIED');
        // Same privacy boundary as single-room availability: only intervals, never booking identities or titles.
        const busy = matched.length
          ? await db.repository<MeetingBooking>('meetingBookings').findMany({
              filter: (f) =>
                f.and([
                  f.or(
                    matched.map((room) =>
                      f.string('roomId').eq(S.Room.parse(room).id),
                    ),
                  ),
                  f.or([
                    f.string('status').eq('confirmed'),
                    f.string('status').eq('pendingConfirmation'),
                  ]),
                  f.date('startAt').before(new Date(q.endAt)),
                  f.date('endAt').after(new Date(q.startAt)),
                ]),
              select: (s) => s.fields('roomId', 'startAt', 'endAt'),
              sort: (s) => s.field('startAt').asc(),
            })
          : [];
        ctx.header('Cache-Control', 'no-store');
        return ctx.json({
          data: matched.map((room) =>
            S.AvailabilityRoom.parse({
              ...room,
              busy: busy
                .filter((item) => item.roomId === room.id)
                .map((item) => ({
                  startAt: new Date(item.startAt).toISOString(),
                  endAt: new Date(item.endAt).toISOString(),
                })),
            }),
          ),
          meta: { page: q.page, pageSize: q.pageSize, total },
        });
      },
    );
    rooms.get(
      '/:id/actions',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'meetingRoomActions',
        responses: { '200': dataResponse(S.RoomActions), ...apiErrorResponses },
      }),
      apiValidator('param', S.Params),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingRooms', 'view'),
          manage = await optionalPolicy(ctx, 'oa.meetingRooms', 'manage');
        const data = await db.transaction(async (tx) => {
          await currentActor(ctx, tx);
          const id = ctx.req.valid('param').id,
            row = await tx
              .repository('meetingRooms')
              .withPolicy(p)
              .findOne({ filter: { id } });
          if (!row) fail('ROOM_NOT_FOUND');
          if (ROOM_FIELDS.some((field) => !(field in row)))
            fail('ACCESS_DENIED');
          const actions: 'edit'[] = [];
          if (
            manage &&
            (await c
              .resolve(orgServiceToken)
              .hasDutyRole(actor(ctx), 'admin', tx))
          ) {
            const scoped = await tx
              .repository('meetingRooms')
              .withPolicy(manage)
              .findOne({ filter: { id } });
            if (
              scoped &&
              ROOM_FIELDS.every((field) => field in scoped) &&
              (
                await tx
                  .repository('meetingRooms')
                  .withPolicy(manage)
                  .validateMutation({
                    operation: 'updateOne',
                    filter: { id },
                    values: { ...row, version: Number(row.version) + 1 },
                  })
              ).valid
            )
              actions.push('edit');
          }
          return { actions };
        });
        return ctx.json({ data: S.RoomActions.parse(data) });
      },
    );
    rooms.get(
      '/',
      doc('listMeetingRooms', 'List accessible meeting rooms', S.Room, true),
      apiValidator('query', S.ListQuery),
      async (ctx) => {
        const q = ctx.req.valid('query'),
          p = await policy(ctx, 'oa.meetingRooms', 'view'),
          repo = db.repository<MeetingRoom>('meetingRooms').withPolicy(p),
          filter = (f: import('@nocobase/db').FilterBuilder) =>
            f.and([
              ...(q.search ? [f.string('name').includes(q.search)] : []),
              ...(q.active
                ? [
                    q.active === 'true'
                      ? f.boolean('active').isTrue()
                      : f.boolean('active').isFalse(),
                  ]
                : []),
            ]);
        const sort = q.sort ?? 'name';
        if (!['name', 'capacity', 'version'].includes(sort))
          fail('INVALID_INPUT');
        const total = await repo.count({ filter });
        if (sort === 'name' && total > 5000) fail('SORT_LIMIT_EXCEEDED');
        const matched = await repo.findMany({
          filter,
          ...(sort === 'name'
            ? {}
            : { offset: (q.page - 1) * q.pageSize, limit: q.pageSize }),
          sort: (s) => [
            q.direction === 'desc' ? s.field(sort).desc() : s.field(sort).asc(),
            s.field('id').asc(),
          ],
        });
        if (matched.some((row) => ROOM_FIELDS.some((field) => !(field in row))))
          fail('ACCESS_DENIED');
        const data =
          sort === 'name'
            ? matched
                .sort(
                  (a, b) =>
                    String(a.name).localeCompare(String(b.name), q.locale) *
                      (q.direction === 'desc' ? -1 : 1) ||
                    String(a.id).localeCompare(String(b.id)),
                )
                .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
            : matched;
        return ctx.json({
          data: data.map((v) => {
            if (ROOM_FIELDS.some((field) => !(field in v)))
              fail('ACCESS_DENIED');
            return S.Room.parse(v);
          }),
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total: await repo.count({ filter }),
          },
        });
      },
    );
    rooms.get(
      '/:id',
      doc('getMeetingRoom', 'Read an accessible room', S.Room),
      apiValidator('param', S.Params),
      async (ctx) =>
        ctx.json({
          data: S.Room.parse(
            await complete(
              db.connection(),
              'meetingRooms',
              ctx.req.valid('param').id,
              await policy(ctx, 'oa.meetingRooms', 'view'),
            ),
          ),
        }),
    );
    rooms.get(
      '/:id/availability',
      doc(
        'getMeetingRoomAvailability',
        'Read busy intervals without meeting details',
        S.Availability,
      ),
      apiValidator('param', S.Params),
      apiValidator('query', S.Range),
      async (ctx) => {
        const id = ctx.req.valid('param').id,
          q = ctx.req.valid('query'),
          room = await complete(
            db.connection(),
            'meetingRooms',
            id,
            await policy(ctx, 'oa.meetingRooms', 'view'),
          );
        const busy = await db
          .repository<MeetingBooking>('meetingBookings')
          .findMany({
            filter: (f) =>
              f.and([
                f.string('roomId').eq(id),
                f.or([
                  f.string('status').eq('confirmed'),
                  f.string('status').eq('pendingConfirmation'),
                ]),
                f.date('startAt').before(new Date(q.endAt)),
                f.date('endAt').after(new Date(q.startAt)),
              ]),
            select: (s) => s.fields('startAt', 'endAt'),
            sort: (s) => s.field('startAt').asc(),
          });
        return ctx.json({
          data: {
            room: { id, name: S.Room.parse(room).name },
            busy: busy.map((b) => ({
              startAt: new Date(b.startAt).toISOString(),
              endAt: new Date(b.endAt).toISOString(),
            })),
          },
        });
      },
    );
    rooms.post(
      '/',
      doc('createMeetingRoom', 'Create an audited room', S.Room),
      apiValidator('json', S.RoomInput),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingRooms', 'manage');
        return ctx.json({
          data: S.Room.parse(
            await db.transaction((tx) =>
              service.saveRoom(
                { ...ctx.req.valid('json'), actorId: actor(ctx) },
                tx,
                p,
              ),
            ),
          ),
        });
      },
    );
    rooms.patch(
      '/:id',
      doc(
        'updateMeetingRoom',
        'Update room metadata with expected version',
        S.Room,
      ),
      apiValidator('param', S.Params),
      apiValidator('json', S.RoomInput),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingRooms', 'manage'),
          id = ctx.req.valid('param').id;
        return ctx.json({
          data: S.Room.parse(
            await db.transaction(async (tx) => {
              await complete(tx, 'meetingRooms', id, p);
              return service.saveRoom(
                { ...ctx.req.valid('json'), id, actorId: actor(ctx) },
                tx,
                p,
              );
            }),
          ),
        });
      },
    );
    bookings.get(
      '/',
      doc('listMeetingBookings', 'List authorized bookings', S.Booking, true),
      apiValidator('query', S.ListQuery),
      async (ctx) => {
        const q = ctx.req.valid('query'),
          p = await policy(ctx, 'oa.meetingBookings', 'view');
        if (
          q.mode === 'administration' &&
          !(await c.resolve(orgServiceToken).hasDutyRole(actor(ctx), 'admin'))
        )
          fail('ACCESS_DENIED');
        const repo = db
          .repository<MeetingBooking>('meetingBookings')
          .withPolicy(p);
        const filter = (
          f: import('@nocobase/db').FilterBuilder<MeetingBooking>,
        ) =>
          f.and([
            ...(q.mode === 'mine'
              ? [f.string('organizerUserId').eq(actor(ctx))]
              : []),
            ...(q.search ? [f.string('title').includes(q.search)] : []),
          ]);
        // Participating scope is applied before pagination, via the action policy plus a server-side id predicate.
        const participating =
          q.mode === 'participating'
            ? (
                await repo.findMany({
                  filter,
                  select: (s) => s.fields('id', 'attendeeUserIds'),
                })
              )
                .filter((b) => b.attendeeUserIds?.includes(actor(ctx)))
                .flatMap((b) => (b.id ? [b.id] : []))
            : null;
        const effective = (
          f: import('@nocobase/db').FilterBuilder<MeetingBooking>,
        ) =>
          participating
            ? f.and([
                filter(f),
                f.or(participating.map((id) => f.string('id').eq(id))),
              ])
            : filter(f);
        const sort = q.sort ?? 'startAt',
          direction = q.sort ? q.direction : 'desc';
        if (!['title', 'startAt', 'endAt', 'version'].includes(sort))
          fail('INVALID_INPUT');
        const total = await repo.count({ filter: effective });
        if (sort === 'title' && total > 5000) fail('SORT_LIMIT_EXCEEDED');
        const matched = await repo.findMany({
          filter: effective,
          ...(sort === 'title'
            ? {}
            : { offset: (q.page - 1) * q.pageSize, limit: q.pageSize }),
          sort: (s) => [
            direction === 'desc'
              ? s
                  .field(sort as 'title' | 'startAt' | 'endAt' | 'version')
                  .desc()
              : s
                  .field(sort as 'title' | 'startAt' | 'endAt' | 'version')
                  .asc(),
            s.field('id').asc(),
          ],
        });
        if (
          matched.some((row) => BOOKING_FIELDS.some((field) => !(field in row)))
        )
          fail('ACCESS_DENIED');
        const rows =
          sort === 'title'
            ? matched
                .sort(
                  (a, b) =>
                    String(a.title).localeCompare(String(b.title), q.locale) *
                      (direction === 'desc' ? -1 : 1) ||
                    String(a.id).localeCompare(String(b.id)),
                )
                .slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
            : matched;
        return ctx.json({
          data: await enrich(
            await visibleResult(rows as MeetingBooking[], p, db.connection()),
          ),
          meta: {
            page: q.page,
            pageSize: q.pageSize,
            total: await repo.count({ filter: effective }),
          },
        });
      },
    );
    bookings.get(
      '/:id',
      doc('getMeetingBooking', 'Read authorized booking details', S.Booking),
      apiValidator('param', S.Params),
      async (ctx) => {
        const row = await complete(
          db.connection(),
          'meetingBookings',
          ctx.req.valid('param').id,
          await policy(ctx, 'oa.meetingBookings', 'view'),
        );
        return ctx.json({ data: await dto(row as unknown as MeetingBooking) });
      },
    );
    bookings.post(
      '/',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'createMeetingBookings',
        summary: 'Create a finite atomic booking batch',
        responses: {
          '200': dataResponse(S.Booking.array()),
          ...apiErrorResponses,
        },
      }),
      apiValidator('json', S.BookingInput),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingBookings', 'create');
        await complete(
          db.connection(),
          'meetingRooms',
          ctx.req.valid('json').roomId,
          await policy(ctx, 'oa.meetingRooms', 'view'),
        );
        const result = await db.transaction(async (tx) =>
          visibleResult(
            await service.create(
              { ...ctx.req.valid('json'), actorId: actor(ctx) },
              tx,
              p,
            ),
            p,
            tx,
          ),
        );
        return ctx.json({ data: await enrich(result) });
      },
    );
    bookings.patch(
      '/:id',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'editMeetingBookings',
        summary: 'Edit this occurrence or future occurrences atomically',
        responses: {
          '200': dataResponse(S.Booking.array()),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', S.Params),
      apiValidator('json', S.EditInput),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingBookings', 'edit'),
          id = ctx.req.valid('param').id;
        await complete(
          db.connection(),
          'meetingRooms',
          ctx.req.valid('json').roomId,
          await policy(ctx, 'oa.meetingRooms', 'view'),
        );
        return ctx.json({
          data: await db
            .transaction(async (tx) => {
              await complete(tx, 'meetingBookings', id, p);
              return visibleResult(
                await service.edit(
                  { ...ctx.req.valid('json'), id, actorId: actor(ctx) },
                  tx,
                  p,
                ),
                p,
                tx,
              );
            })
            .then(enrich),
        });
      },
    );
    for (const action of ['confirm', 'reject', 'cancel', 'checkIn'] as const)
      bookings.post(
        `/:id/${action}`,
        doc(
          `meetingBooking${action}`,
          'Perform an authorized booking action',
          S.Booking,
        ),
        apiValidator('param', S.Params),
        apiValidator('json', S.ActionInput),
        async (ctx) => {
          const p = await policy(ctx, 'oa.meetingBookings', action),
            id = ctx.req.valid('param').id;
          return ctx.json({
            data: await db
              .transaction(async (tx) => {
                await complete(tx, 'meetingBookings', id, p);
                const row = await service.act(
                  { ...ctx.req.valid('json'), id, action, actorId: actor(ctx) },
                  tx,
                  p,
                );
                return (await visibleResult([row], p, tx))[0];
              })
              .then(enrich),
          });
        },
      );
    bookings.post(
      '/:id/cancelFuture',
      describeRoute({
        tags: ['Meeting rooms'],
        operationId: 'cancelFutureMeetingBookings',
        summary: 'Cancel future series instances with every expected version',
        responses: {
          '200': dataResponse(S.Booking.array()),
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', S.Params),
      apiValidator('json', S.CancelFutureInput),
      async (ctx) => {
        const p = await policy(ctx, 'oa.meetingBookings', 'cancel'),
          id = ctx.req.valid('param').id;
        return ctx.json({
          data: await db
            .transaction(async (tx) => {
              await complete(tx, 'meetingBookings', id, p);
              return visibleResult(
                await service.cancelFuture(
                  { ...ctx.req.valid('json'), id, actorId: actor(ctx) },
                  tx,
                  p,
                ),
                p,
                tx,
              );
            })
            .then(enrich),
        });
      },
    );
    const mount = new Hono();
    mount.route('/meetingRooms', rooms);
    mount.route('/meetingBookings', bookings);
    return mount;
  }),
];
