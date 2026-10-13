// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { installMeetingRoomPermissions } from '../../../database/main/seeds/202610103711_meeting_rooms_permissions.js';
import { expect, vi } from 'vitest';
import type { AuthorizationCheckRequest } from '@nocobase/authorization/core';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { test } from './helpers.js';
import { createUser, write } from '../platform/helpers.js';
import { createEmployee } from '../employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import {
  meetingRoomServiceToken,
  ROOM_FIELDS,
} from '../../../server/providers/meeting-rooms/index.js';
import { findUndeclaredApiRoutes } from '@nocobase/app-server/router';
async function actor(
  testApp: Parameters<typeof createEmployee>[0],
  name: string,
) {
  const e = await createEmployee(testApp, name);
  return { session: await e.session(), userId: e.userId };
}
async function grant(
  testApp: Parameters<typeof createEmployee>[0],
  userId: string,
  actions: string[],
  scope = 'oa.meetingBookingsOwned',
) {
  const authz = testApp.application.container.resolve(authorizationToken),
    key = randomUUID();
  await authz.permissionSets.create({
    key,
    title: 'Meeting test',
    grants: [
      {
        resource: { type: 'composite', id: 'oa.meetingRooms' },
        actions: [
          {
            action: 'view',
            policy: {
              type: 'composite',
              scopes: { meetingRooms: 'allRecords' },
            },
          },
        ],
      },
      {
        resource: { type: 'composite', id: 'oa.meetingBookings' },
        actions: actions.map((action) => ({
          action,
          policy: { type: 'composite', scopes: { meetingBookings: scope } },
        })),
      },
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: userId },
  });
}
test('real API denies anonymous/ungranted/foreign users; availability hides detail; declares Swagger', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    service = c.resolve(meetingRoomServiceToken),
    a = await actor(testApp, 'Room admin'),
    owner = await actor(testApp, 'Booking owner'),
    other = await actor(testApp, 'Other employee');
  await c
    .resolve(organizationServiceToken)
    .addDutyRoleMember('admin', a.userId, { actorId: a.userId });
  const room = await db.transaction((tx) =>
    service.saveRoom(
      {
        actorId: a.userId,
        requestId: randomUUID(),
        name: 'Real room',
        location: null,
        facilities: null,
        capacity: 5,
        active: true,
        requiresAdminConfirmation: true,
        reason: 'HTTP proof',
      },
      tx,
    ),
  );
  const ungranted = await createUser(testApp, 'Ungrant');
  expect((await testApp.request('/meetingRooms')).status).toBe(401);
  expect(
    (
      await ungranted.fetch(
        '/meetingRooms',
        write('POST', {
          requestId: randomUUID(),
          name: 'Unauthorized room',
          location: null,
          facilities: null,
          capacity: 4,
          active: true,
          requiresAdminConfirmation: false,
          reason: 'No grant',
        }),
      )
    ).status,
  ).toBe(403);
  await grant(testApp, owner.userId, [
    'view',
    'create',
    'edit',
    'cancel',
    'checkIn',
  ]);
  await grant(testApp, other.userId, [
    'view',
    'create',
    'edit',
    'cancel',
    'checkIn',
  ]);
  const body = {
    requestId: randomUUID(),
    roomId: room.id,
    title: 'Confidential meeting title',
    attendeeUserIds: [],
    date: '2030-05-02',
    startTime: '09:00',
    endTime: '10:00',
  };
  const response = await owner.session.fetch(
    '/meetingBookings',
    write('POST', body),
  );
  expect(response.status).toBe(200);
  const booking = (await response.json()).data[0];
  expect(booking.organizer.name).toBe('Booking owner');
  expect(
    (await other.session.fetch(`/meetingBookings/${booking.id}`)).status,
  ).toBe(404);
  const busy = await other.session.fetch(
    `/meetingRooms/${room.id}/availability?startAt=2030-05-01T00:00:00Z&endAt=2030-05-03T00:00:00Z`,
  );
  expect(busy.status).toBe(200);
  const text = await busy.text();
  expect(text).not.toContain(body.title);
  expect(text).not.toContain(owner.userId);
  expect(JSON.parse(text).data.busy).toHaveLength(1);
  const availabilityQuery =
    '/meetingRooms/availability-search?capacity=5&startAt=2030-05-02T01:00:00Z&endAt=2030-05-02T02:00:00Z';
  expect((await testApp.request(availabilityQuery)).status).toBe(401);
  expect((await ungranted.fetch(availabilityQuery)).status).toBe(200); // ordinary default room viewing, no booking authority
  const aggregated = await other.session.fetch(availabilityQuery);
  expect(aggregated.status).toBe(200);
  const available = await aggregated.json();
  expect(available.meta.total).toBe(1);
  expect(available.data[0].busy).toHaveLength(1); // pendingConfirmation occupies the interval
  expect(JSON.stringify(available)).not.toContain(body.title);
  expect(JSON.stringify(available)).not.toContain(owner.userId);
  const adjacent = await other.session.fetch(
    availabilityQuery
      .replace('01:00:00Z', '02:00:00Z')
      .replace('endAt=2030-05-02T02:00:00Z', 'endAt=2030-05-02T03:00:00Z'),
  );
  expect((await adjacent.json()).data[0].busy).toHaveLength(0);
  const tooSmall = await other.session.fetch(
    availabilityQuery.replace('capacity=5', 'capacity=6'),
  );
  expect((await tooSmall.json()).meta.total).toBe(0);
  const authz = c.resolve(authorizationToken),
    original = authz.for.bind(authz);
  let denyFields = false;
  const scopeSpy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = original(identity);
    return {
      ...context,
      authorize: (async (check: AuthorizationCheckRequest) => {
        const decision = await context.authorize(check);
        if (
          check.resource.type !== 'composite' ||
          check.resource.id !== 'oa.meetingRooms' ||
          check.action !== 'view'
        )
          return decision;
        return {
          ...decision,
          conditions: {
            ...decision.conditions,
            database: {
              ...decision.conditions?.database,
              meetingRooms: {
                ...decision.conditions?.database?.meetingRooms,
                read: denyFields
                  ? { scope: true, fields: ['id'] }
                  : {
                      scope: { id: 'outside-room-scope' },
                      fields: [...ROOM_FIELDS],
                    },
              },
            },
          },
        };
      }) as typeof context.authorize,
    };
  });
  try {
    const scoped = await other.session.fetch(availabilityQuery);
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).meta.total).toBe(0);
    denyFields = true;
    expect((await other.session.fetch(availabilityQuery)).status).toBe(403);
  } finally {
    scopeSpy.mockRestore();
  }

  const illegal = await owner.session.fetch(
    '/meetingBookings',
    write('POST', { ...body, confirmedBy: a.userId }),
  );
  expect(illegal.status).toBe(400);
  expect(findUndeclaredApiRoutes(testApp.application)).toHaveLength(0);
});
test('installed ordinary defaults include participant detail and seed reruns preserve administrator configuration', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    authz = c.resolve(authorizationToken),
    owner = await actor(testApp, 'Participant organizer'),
    participant = await actor(testApp, 'Actual participant'),
    admin = await actor(testApp, 'Second admin');
  await c
    .resolve(organizationServiceToken)
    .addDutyRoleMember('admin', admin.userId, { actorId: admin.userId });
  const service = c.resolve(meetingRoomServiceToken),
    room = await db.transaction((tx) =>
      service.saveRoom(
        {
          actorId: admin.userId,
          requestId: randomUUID(),
          name: 'Participant room',
          location: null,
          facilities: null,
          capacity: 3,
          active: true,
          requiresAdminConfirmation: false,
          reason: 'Participant scope',
        },
        tx,
      ),
    );
  const response = await owner.session.fetch(
    '/meetingBookings',
    write('POST', {
      requestId: randomUUID(),
      roomId: room.id,
      title: 'Participant-visible detail',
      attendeeUserIds: [participant.userId],
      date: '2030-05-03',
      startTime: '09:00',
      endTime: '10:00',
    }),
  );
  expect(response.status).toBe(200);
  const booking = (await response.json()).data[0];
  const detail = await participant.session.fetch(
    `/meetingBookings/${booking.id}`,
  );
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.attendees).toEqual([
    { id: participant.userId, name: 'Actual participant' },
  ]);
  const list = await participant.session.fetch(
    '/meetingBookings?mode=participating&pageSize=1',
  );
  expect(list.status).toBe(200);
  expect((await list.json()).meta.total).toBeGreaterThanOrEqual(1);
  const canceled = await participant.session.fetch(
    `/meetingBookings/${booking.id}/cancel`,
    write('POST', {
      requestId: randomUUID(),
      expectedVersion: booking.version,
    }),
  );
  expect(canceled.status).toBe(404);
  const adminOnly = await owner.session.fetch(
    '/meetingBookings?mode=administration',
  );
  expect(adminOnly.status).toBe(403);
  const defaultSet = await authz.permissionSets.get(
    'oa-meeting-rooms-employee',
  );
  expect(defaultSet).toBeTruthy();
  await authz.permissionSets.update('oa-meeting-rooms-employee', {
    ...defaultSet!,
    title: 'Administrator edited meeting defaults',
  });
  await db.transaction((tx) => installMeetingRoomPermissions(tx.query));
  expect(
    (await authz.permissionSets.get('oa-meeting-rooms-employee'))?.title,
  ).toBe('Administrator edited meeting defaults');
  const range = await participant.session.fetch(
    `/meetingRooms/${room.id}/availability?startAt=2030-01-01T00:00:00Z&endAt=2032-01-01T00:00:00Z`,
  );
  expect(range.status).toBe(400);
});

test('safe booking context exposes only current authorized actions and complete mutable future versions', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    service = c.resolve(meetingRoomServiceToken);
  const administrator = await actor(testApp, 'Context admin'),
    owner = await actor(testApp, 'Context organizer'),
    foreign = await actor(testApp, 'Context foreign');
  await c
    .resolve(organizationServiceToken)
    .addDutyRoleMember('admin', administrator.userId, {
      actorId: administrator.userId,
    });
  const room = await db.transaction((tx) =>
    service.saveRoom(
      {
        actorId: administrator.userId,
        requestId: randomUUID(),
        name: 'Context room',
        location: null,
        facilities: null,
        capacity: 4,
        active: true,
        requiresAdminConfirmation: true,
        reason: 'Safe context fixture',
      },
      tx,
    ),
  );
  for (const [name, capacity] of [
    ['阿办公室', 9],
    ['北京办公室', 3],
    ['中办公室', 6],
  ] as const)
    await db.transaction((tx) =>
      service.saveRoom(
        {
          actorId: administrator.userId,
          requestId: randomUUID(),
          name,
          location: null,
          facilities: null,
          capacity,
          active: true,
          requiresAdminConfirmation: false,
          reason: 'Real sorting room',
        },
        tx,
      ),
    );
  const sorted = await owner.session.fetch(
    '/meetingRooms?search=办公室&sort=name&locale=zh-CN&direction=asc&pageSize=2',
  );
  expect(sorted.status).toBe(200);
  const sortedBody = await sorted.json();
  expect(sortedBody.data.map((row: { name: string }) => row.name)).toEqual([
    '阿办公室',
    '北京办公室',
  ]);
  expect(sortedBody.meta.total).toBe(3);
  const numeric = await owner.session.fetch(
    '/meetingRooms?search=办公室&sort=capacity&direction=desc&pageSize=2',
  );
  expect(
    (await numeric.json()).data.map(
      (row: { capacity: number }) => row.capacity,
    ),
  ).toEqual([9, 6]);
  const rows = await db.transaction((tx) =>
    service.create(
      {
        actorId: owner.userId,
        requestId: randomUUID(),
        roomId: room.id,
        title: 'Private context meeting',
        attendeeUserIds: [],
        date: '2035-01-02',
        startTime: '09:00',
        endTime: '10:00',
        recurrence: { frequency: 'weekly', count: 3 },
      },
      tx,
    ),
  );
  const options = await owner.session.fetch('/meetingBookings/options');
  expect(options.status).toBe(200);
  expect((await options.json()).data).toMatchObject({
    actor: { id: owner.userId },
    canCreate: true,
    canManage: false,
    modes: ['mine', 'participating'],
  });
  const ownActions = await owner.session.fetch(
    `/meetingBookings/${rows[0].id}/actions`,
  );
  expect((await ownActions.json()).data.actions.sort()).toEqual([
    'cancel',
    'edit',
  ]);
  const adminActions = await administrator.session.fetch(
    `/meetingBookings/${rows[0].id}/actions`,
  );
  expect((await adminActions.json()).data.actions.sort()).toEqual([
    'cancel',
    'confirm',
    'reject',
  ]);
  expect(
    (await foreign.session.fetch(`/meetingBookings/${rows[0].id}/actions`))
      .status,
  ).toBe(404);
  await db.transaction((tx) =>
    service.act(
      {
        actorId: owner.userId,
        requestId: randomUUID(),
        id: rows[1].id,
        expectedVersion: rows[1].version,
        action: 'cancel',
      },
      tx,
    ),
  );
  const future = await owner.session.fetch(
    `/meetingBookings/${rows[0].id}/future?action=cancel`,
  );
  expect(future.status).toBe(200);
  const body = (await future.json()).data;
  expect(body.total).toBe(2);
  expect(body.items.map((i: { id: string }) => i.id).sort()).toEqual(
    [rows[0].id, rows[2].id].sort(),
  );
  expect(JSON.stringify(body)).not.toContain('Private context meeting');
  // Narrowing the public decision exercises the exact scoped Repository policy
  // the HTTP facade receives without fabricating business facts.
  const authz = c.resolve(authorizationToken),
    original = authz.for.bind(authz);
  let narrowRead = false,
    narrowCreate = false;
  const spy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = original(identity);
    return {
      ...context,
      authorize: (async (check: AuthorizationCheckRequest) => {
        const decision = await context.authorize(check);
        const p = decision.conditions?.database?.meetingBookings;
        if (
          check.resource.type !== 'composite' ||
          check.resource.id !== 'oa.meetingBookings' ||
          !p
        )
          return decision;
        const changed =
          check.action === 'cancel'
            ? { ...p, update: { scope: { id: rows[0].id }, fields: undefined } }
            : narrowRead && check.action === 'view'
              ? { ...p, read: { scope: true as const, fields: ['id'] } }
              : narrowCreate && check.action === 'create'
                ? { ...p, read: { scope: true as const, fields: ['id'] } }
                : p;
        return {
          ...decision,
          conditions: {
            ...decision.conditions,
            database: {
              ...decision.conditions.database,
              meetingBookings: changed,
            },
          },
        };
      }) as typeof context.authorize,
    };
  });
  try {
    const deniedFuture = await owner.session.fetch(
      `/meetingBookings/${rows[0].id}/future?action=cancel`,
    );
    expect(deniedFuture.status).toBe(403);
    expect(JSON.stringify(await deniedFuture.json())).not.toContain(rows[2].id);
    narrowCreate = true;
    expect(
      (await (await owner.session.fetch('/meetingBookings/options')).json())
        .data.canCreate,
    ).toBe(false);
    narrowRead = true;
    expect(
      (await owner.session.fetch(`/meetingBookings/${rows[0].id}/actions`))
        .status,
    ).toBe(403);
  } finally {
    spy.mockRestore();
  }
  await grant(
    testApp,
    administrator.userId,
    ['view', 'confirm', 'reject', 'cancel'],
    'allRecords',
  );
  await c
    .resolve(organizationServiceToken)
    .removeDutyRoleMember('admin', administrator.userId, {
      actorId: owner.userId,
    });
  expect(
    (
      await (
        await administrator.session.fetch(
          `/meetingBookings/${rows[0].id}/actions`,
        )
      ).json()
    ).data.actions,
  ).toEqual([]);
  expect(
    (
      await administrator.session.fetch(
        `/meetingBookings/${rows[0].id}/confirm`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: rows[0].version,
        }),
      )
    ).status,
  ).toBe(403);
  expect(findUndeclaredApiRoutes(testApp.application)).toHaveLength(0);
});
