// @vitest-environment node
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { employeeServiceToken } from '../../../server/providers/employees/contract.js';
import { salaryGradeServiceToken } from '../../../server/providers/job-grades/contract.js';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';
import { expect } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createPerson, createEmployee } from '../employees/helpers.js';
import { OA_TEST_ORIGIN } from '../oa-test-origin.js';
import { test } from './helpers.js';
test('candidate HTTP authenticates and declares every transfer route', async ({
  testApp,
  request,
}) => {
  const db = testApp.application.container.resolve(databaseManagerToken);
  if (!(await db.connection().collections.get('transferCommands')))
    await db
      .createMigrator({
        sources: [
          {
            packageName: 'transfer-candidate',
            directory: path.resolve(
              import.meta.dirname,
              '../../fixtures/transfer/migrations',
            ),
          },
        ],
        tableName: 'transferCandidateMigrations',
      })
      .latest();
  expect((await request('/transferRequests')).status).toBe(401);
  const person = await createPerson(testApp, 'No personnel grant'),
    session = await person.session();
  const hasDefaults = !!(await testApp.application.container
    .resolve(authorizationToken)
    .permissionSets.get('oa-transfer-employee'));
  const ordinaryList = await session.fetch('/transferRequests');
  expect(ordinaryList.status).toBe(hasDefaults ? 200 : 403);
  if (hasDefaults)
    expect(await ordinaryList.json()).toMatchObject({ data: [] });
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  expect((await admin.fetch('/transferRequests')).status).toBe(200);
  const install = (tableName: string) =>
    db
      .createSeeder({
        sources: [
          {
            packageName: 'transfer-candidate-permissions',
            directory: path.resolve(
              import.meta.dirname,
              '../../fixtures/transfer/seeds',
            ),
          },
        ],
        tableName,
      })
      .run();
  await install('transferSeedProof');
  const sets =
    testApp.application.container.resolve(authorizationToken).permissionSets;
  const set = await sets.get('oa-transfer-hr');
  expect(set).toBeDefined();
  await db
    .query()
    .updateTable('authorizationPermissionSets')
    .set({
      title: encodeAuthorizationTitle('Customized HR transfer permissions'),
    })
    .where('key', '=', 'oa-transfer-hr')
    .execute();
  await install('transferSeedProofRepeat');
  expect((await sets.get('oa-transfer-hr'))?.title).toBe(
    'Customized HR transfer permissions',
  );
  expect(findUndeclaredApiRoutes(testApp.application)).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(
    doc.paths?.['/api/transferRequests/{id}/salary']?.get?.operationId,
  ).toBe('getTransferSalary');
  expect(
    (
      await admin.fetch('/transferRequests', {
        method: 'POST',
        headers: { origin: OA_TEST_ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).status,
  ).toBe(400);
});

test('default candidate grants permit real HR creation and refuse unrelated actors or revoked replay', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    org = c.resolve(organizationServiceToken),
    employees = c.resolve(employeeServiceToken),
    grades = c.resolve(salaryGradeServiceToken);
  await db
    .createSeeder({
      sources: [
        {
          packageName: 'transfer-candidate-permissions',
          directory: path.resolve(
            import.meta.dirname,
            '../../fixtures/transfer/seeds',
          ),
        },
      ],
      tableName: 'transferSeedHttpProof',
    })
    .run();
  const hr = await createEmployee(testApp, 'Default HR transfer'),
    manager = await createEmployee(testApp, 'Current subject manager'),
    context = { actorId: hr.userId };
  await org.addDutyRoleMember('hr', hr.userId, context);
  const position = await org.createPosition(
      { code: randomUUID(), title: 'Default transfer position' },
      context,
    ),
    grade = await org.createGrade(
      { code: randomUUID(), title: 'Default transfer grade', rank: 1 },
      context,
    ),
    department = await org.createDepartment(
      { title: 'Default transfer department', managerId: manager.userId },
      context,
    );
  const subject = await createEmployee(testApp, 'Default transfer subject', {
    positionId: position.id,
    gradeId: grade.id,
    managerId: manager.employeeId,
  });
  await org.addMember(
    { departmentId: department.id, userId: subject.userId, primary: true },
    context,
  );
  await db.transaction((tx) =>
    employees.appendCompensation(
      {
        employeeId: subject.employeeId,
        gradeId: grade.id,
        baseSalary: '1000.00',
        effectiveFrom: '2026-01-01',
      },
      context,
      tx,
    ),
  );
  const pointer = await grades.current(db.connection());
  await grades.publish(
    {
      expectedVersion: pointer.version,
      bands: [{ gradeId: grade.id, minimumCents: 0, maximumCents: 150000 }],
      actorId: hr.userId,
      reason: 'Default transfer grade',
    },
    db.connection(),
  );
  const body = {
    requestKey: randomUUID(),
    reason: 'Default permission proof',
    proposal: {
      employeeId: subject.employeeId,
      kinds: ['salaryChange'],
      targetDepartmentId: department.id,
      targetPositionId: position.id,
      targetGradeId: grade.id,
      targetManagerId: manager.employeeId,
      effectiveDate: testApp.application.container
        .resolve(calendarServiceToken)
        .localDate(new Date()),
      targetSalary: '1100.00',
      sourceAccountId: null,
      targetAccountId: null,
      reason: 'Default permission proof',
    },
  };
  const hrSession = await hr.session(),
    headers = { origin: OA_TEST_ORIGIN, 'content-type': 'application/json' };
  const options = await hrSession.fetch('/transferRequests/formOptions');
  expect(options.status).toBe(200);
  const choices = (await options.json()).data;
  expect(choices.canCreateAsHR).toBe(true);
  expect(choices.editableFields).toContain('effectiveDate');
  expect(choices.managers).toContainEqual({
    id: manager.employeeId,
    name: 'Current subject manager',
  });
  expect(JSON.stringify(choices)).not.toMatch(
    /baseSalary|bankAccount|currentCents|maximumCents/,
  );
  expect(
    (await (await hrSession.fetch('/transferRequests/capabilities')).json())
      .data.canCreateAsHR,
  ).toBe(true);
  const outside = await hrSession.fetch('/transferRequests', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...body,
      requestKey: randomUUID(),
      proposal: { ...body.proposal, targetSalary: '1500.01' },
    }),
  });
  expect(outside.status).toBe(400);
  const outsideBody = await outside.json();
  expect(outsideBody.error.reason).toBe('OUTSIDE_RANGE');
  const response = await hrSession.fetch('/transferRequests', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result.data.record.status).toBe('draft');
  expect(JSON.stringify(result)).not.toMatch(
    /targetSalary|currentCents|targetCents/,
  );
  expect(
    (
      await hrSession.fetch(
        '/transferRequests/' + result.data.record.id + '/salary',
      )
    ).status,
  ).toBe(200);
  const unrelated = await createEmployee(testApp, 'Unrelated default actor'),
    otherSession = await unrelated.session();
  expect(
    (
      await otherSession.fetch('/transferRequests', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, requestKey: randomUUID() }),
      })
    ).status,
  ).toBe(403);
  expect(
    (await (await otherSession.fetch('/transferRequests/capabilities')).json())
      .data.canCreateAsHR,
  ).toBe(false);
  expect(
    (await otherSession.fetch('/transferRequests/formOptions')).status,
  ).toBe(403);
  expect(
    (
      await otherSession.fetch(
        '/transferRequests/formOptions?mode=edit&requestId=' +
          result.data.record.id,
      )
    ).status,
  ).toBe(403);
  expect((await hrSession.fetch('/employees?page=1&pageSize=20')).status).toBe(
    200,
  );
  const accountQuery = new URLSearchParams({
    mode: 'edit',
    requestId: result.data.record.id,
    employeeId: subject.employeeId,
    targetDepartmentId: department.id,
    targetPositionId: position.id,
    effectiveDate: body.proposal.effectiveDate,
  });
  const actualAccounts = await hrSession.fetch(
    '/transferRequests/capacityOptions?' + accountQuery,
  );
  expect(actualAccounts.status).toBe(200);
  expect((await actualAccounts.json()).data).toEqual({
    sourceAccountId: null,
    targetAccountId: null,
  });
  expect(
    (
      await otherSession.fetch(
        '/transferRequests/capacityOptions?' + accountQuery,
      )
    ).status,
  ).toBe(403);
  const draftOptions = await hrSession.fetch(
    '/transferRequests/formOptions?mode=edit&requestId=' +
      result.data.record.id,
  );
  expect(draftOptions.status).toBe(200);
  expect((await draftOptions.json()).data.employee).toEqual({
    id: subject.employeeId,
    name: 'Default transfer subject',
  });
  expect(
    (await hrSession.fetch('/transferRequests?orderBy=effectiveDate:asc'))
      .status,
  ).toBe(200);
  expect(
    (await hrSession.fetch('/transferRequests?orderBy=pay:asc')).status,
  ).toBe(400);
  await org.removeDutyRoleMember('hr', hr.userId, context);
  expect(
    (
      await hrSession.fetch('/transferRequests', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await hrSession.fetch(
        '/transferRequests/' + result.data.record.id + '/salary',
      )
    ).status,
  ).toBe(403);
});
