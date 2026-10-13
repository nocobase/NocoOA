// @vitest-environment node
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { AuthorizationCheckRequest } from '@nocobase/authorization/core';
import { findUndeclaredApiRoutes } from '@nocobase/app-server/router';
import { test } from '../meeting-rooms/helpers.js';
import { createEmployee, createPerson } from '../employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { meetingRoomServiceToken } from '../../../server/providers/meeting-rooms/index.js';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';

test('today meetings use company calendar, actual participant and scope, complete total, and fail closed for narrow fields', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    service = c.resolve(meetingRoomServiceToken),
    calendar = c.resolve(calendarServiceToken),
    authz = c.resolve(authorizationToken);
  const owner = await createEmployee(testApp, 'Workbench owner'),
    participant = await createEmployee(testApp, 'Workbench participant'),
    admin = await createEmployee(testApp, 'Workbench administrator'),
    outsider = await createPerson(testApp, 'Workbench no archive');
  const ownerSession = await owner.session(),
    participantSession = await participant.session(),
    outsiderSession = await outsider.session();
  await c
    .resolve(organizationServiceToken)
    .addDutyRoleMember('admin', admin.userId, { actorId: admin.userId });
  const room = await db.transaction((tx) =>
    service.saveRoom(
      {
        actorId: admin.userId,
        requestId: randomUUID(),
        name: 'Workbench room',
        capacity: 10,
        active: true,
        requiresAdminConfirmation: true,
        facilities: null,
        location: null,
        reason: 'Synthetic workbench proof',
      },
      tx,
    ),
  );
  const date = calendar.addCalendarDays(calendar.localDate(new Date()), 1);
  for (let i = 0; i < 7; i++)
    await db.transaction((tx) =>
      service.create(
        {
          actorId: owner.userId,
          requestId: randomUUID(),
          roomId: room.id,
          title: `Owned ${i}`,
          attendeeUserIds: [participant.userId],
          date,
          startTime: `${String(i + 1).padStart(2, '0')}:00`,
          endTime: `${String(i + 1).padStart(2, '0')}:30`,
        },
        tx,
      ),
    );
  await db.transaction((tx) =>
    service.create(
      {
        actorId: admin.userId,
        requestId: randomUUID(),
        roomId: room.id,
        title: 'Foreign private title',
        attendeeUserIds: [],
        date,
        startTime: '12:00',
        endTime: '13:00',
      },
      tx,
    ),
  );
  await db.transaction((tx) =>
    service.create(
      {
        actorId: owner.userId,
        requestId: randomUUID(),
        roomId: room.id,
        title: 'Tomorrow excluded',
        attendeeUserIds: [participant.userId],
        date: calendar.addCalendarDays(date, 1),
        startTime: '01:00',
        endTime: '02:00',
      },
      tx,
    ),
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(calendar.resolveLocalDateTime(date, '12:00'));
  expect((await testApp.request('/workbench/meetings')).status).toBe(401);
  for (const session of [ownerSession, participantSession]) {
    const response = await session.fetch('/workbench/meetings');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.date).toBe(date);
    expect(body.data.timeZone).toBe(calendar.timeZone());
    expect(body.data.total).toBe(7);
    expect(body.data.items).toHaveLength(5);
    expect(JSON.stringify(body)).not.toContain('Foreign private');
    expect(JSON.stringify(body)).not.toContain('Tomorrow');
    expect(body.data.items[0].status).toBe('pendingConfirmation');
  }
  const unboundSummary = await outsiderSession.fetch('/workbench/meetings');
  expect(unboundSummary.status).toBe(200);
  expect(await unboundSummary.json()).toEqual({
    data: { date, timeZone: calendar.timeZone(), total: 0, items: [] },
  });
  const rootSession = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const rootSummary = await rootSession.fetch('/workbench/meetings');
  expect(rootSummary.status).toBe(200);
  expect(await rootSummary.json()).toEqual({
    data: { date, timeZone: calendar.timeZone(), total: 0, items: [] },
  });
  const original = authz.for.bind(authz);
  const spy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = original(identity);
    return {
      ...context,
      authorize: (async (check: AuthorizationCheckRequest) => {
        const result = await context.authorize(check),
          p = result.conditions?.database?.meetingBookings;
        if (!p || check.resource.id !== 'oa.meetingBookings') return result;
        return {
          ...result,
          conditions: {
            ...result.conditions,
            database: {
              ...result.conditions?.database,
              meetingBookings: {
                ...p,
                read: {
                  scope: true as const,
                  fields: ['id', 'startAt', 'endAt', 'status'],
                },
              },
            },
          },
        };
      }) as typeof context.authorize,
    };
  });
  try {
    const response = await ownerSession.fetch('/workbench/meetings');
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('Owned');
    // An empty personal summary must not bypass restricted field grants.
    expect((await outsiderSession.fetch('/workbench/meetings')).status).toBe(
      403,
    );
  } finally {
    spy.mockRestore();
  }
  vi.useRealTimers();
  expect(findUndeclaredApiRoutes(testApp.application)).toHaveLength(0);
});
