// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { databaseManagerToken } from '@nocobase/db';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
import { expect } from 'vitest';
import { auditServiceToken } from '../../../server/providers/audit/index.ts';
import {
  leaveBalanceServiceToken,
  LEAVE_BALANCE_SETTINGS,
} from '../../../server/providers/leave-balances/index.ts';
import {
  createPlatformAppTest,
  createUser,
  grantSettings,
  write,
} from '../platform/helpers.ts';
const test = createPlatformAppTest();
test('own balances are private; HR adjustments require explicit grants and audit exactly once', async ({
  testApp,
  app,
  request,
}) => {
  const user = await createUser(testApp, 'Balance owner');
  const other = await createUser(testApp, 'Other employee');
  const db = app.container.resolve(databaseManagerToken);
  const now = new Date();
  const employeeId = randomUUID();
  await db.repository('employees').createOne({
    values: {
      id: employeeId,
      userId: user.user.id,
      name: 'Balance owner',
      code: employeeId,
      status: 'regular',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.transaction((tx) =>
    app.container.resolve(leaveBalanceServiceToken).grant(
      {
        employeeId,
        leaveType: 'annual',
        reference: 'initial',
        requestKey: 'initial',
        units: 4,
      },
      tx,
    ),
  );
  for (const path of [
    '/leaveBalances/me',
    '/leaveBalances/me/ledger?leaveType=annual',
    `/leaveBalances/${employeeId}`,
    `/leaveBalances/${employeeId}/ledger?leaveType=annual`,
  ])
    expect((await request(path)).status).toBe(401);
  const own = await user.fetch('/leaveBalances/me');
  expect(own.status).toBe(200);
  expect(await own.json()).toEqual({
    data: [
      { employeeId, leaveType: 'annual', availableUnits: 4, heldUnits: 0 },
    ],
  });
  const unbound = await other.fetch('/leaveBalances/me');
  expect(unbound.status).toBe(200);
  expect(await unbound.json()).toEqual({ data: [] });
  expect(
    (await other.fetch('/leaveBalances/me/ledger?leaveType=annual')).status,
  ).toBe(404);
  expect((await other.fetch(`/leaveBalances/${employeeId}`)).status).toBe(403);
  expect((await user.fetch(`/leaveBalances/${employeeId}`)).status).toBe(403);
  await grantSettings(testApp, other.user.id, LEAVE_BALANCE_SETTINGS, ['read']);
  expect((await other.fetch(`/leaveBalances/${employeeId}`)).status).toBe(200);
  const adjustment = {
    leaveType: 'annual',
    units: 3,
    requestKey: 'hr-adjust',
    reference: 'correction-2026',
    reason: 'Correct annual entitlement',
  };
  expect(
    (
      await other.fetch(
        `/leaveBalances/${employeeId}/adjust`,
        write('POST', adjustment),
      )
    ).status,
  ).toBe(403);
  await grantSettings(testApp, other.user.id, LEAVE_BALANCE_SETTINGS, [
    'update',
  ]);
  for (let i = 0; i < 2; i += 1)
    expect(
      (
        await other.fetch(
          `/leaveBalances/${employeeId}/adjust`,
          write('POST', adjustment),
        )
      ).status,
    ).toBe(200);
  expect(
    (
      await app.container.resolve(auditServiceToken).list({
        targetType: 'leaveLedger',
        targetId: employeeId,
        page: 1,
        pageSize: 20,
      })
    ).total,
  ).toBe(1);
  const ledger = await user.fetch('/leaveBalances/me/ledger?leaveType=annual');
  expect(ledger.status).toBe(200);
  const body = (await ledger.json()) as {
    data: {
      actorId: string | null;
      actor: { id: string; name: string } | null;
    }[];
  };
  expect(body.data.find((row) => row.actorId === other.user.id)?.actor).toEqual(
    { id: other.user.id, name: 'Other employee' },
  );
  const sorted = await user.fetch(
    '/leaveBalances/me/ledger?leaveType=annual&pageSize=1&sortBy=availableDelta&sortDirection=asc',
  );
  expect(sorted.status).toBe(200);
  expect(await sorted.json()).toMatchObject({
    data: [expect.objectContaining({ availableDelta: 3 })],
    meta: { page: 1, pageSize: 1, total: 2 },
  });
  expect(
    (
      await user.fetch(
        '/leaveBalances/me/ledger?leaveType=annual&sortBy=actorId',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await other.fetch(
        `/leaveBalances/${employeeId}/adjust`,
        write('POST', { ...adjustment, requestKey: 'fractions', units: 0.5 }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await other.fetch(
        `/leaveBalances/${employeeId}/adjust`,
        write('POST', {
          ...adjustment,
          requestKey: 'reason-empty',
          reason: '',
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await other.fetch(
        `/leaveBalances/${employeeId}/adjust`,
        write('POST', {
          ...adjustment,
          requestKey: 'personal',
          leaveType: 'personal',
        }),
      )
    ).status,
  ).toBe(400);
});
test('API document describes every leave balance endpoint and installed HR defaults are duty-role grants', async ({
  app,
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const balances = await admin.fetch('/leaveBalances/me');
  expect(balances.status).toBe(200);
  expect(await balances.json()).toEqual({ data: [] });
  const document = await app.container.resolve(apiDocsToken).getDocument();
  expect(findUndeclaredApiRoutes(app)).toEqual([]);
  expect(findApiDocumentSchemaProblems(document)).toEqual([]);
  expect(
    document.paths?.['/api/leaveBalances/{employeeId}/adjust']?.post
      ?.operationId,
  ).toBe('adjustEmployeeLeaveBalance');
  const db = app.container.resolve(databaseManagerToken);
  const assignments = await db
    .query()
    .selectFrom('authorizationPermissionSetAssignments')
    .select(['subjectType', 'subjectId'])
    .where('permissionSetKey', '=', 'oa-leave-balances-hr')
    .execute();
  expect(assignments).toEqual(
    expect.arrayContaining(
      ['hr', 'hrbp', 'hrDirector'].map((subjectId) => ({
        subjectId,
        subjectType: 'org.dutyRole',
      })),
    ),
  );
});
