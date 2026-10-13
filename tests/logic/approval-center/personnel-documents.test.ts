// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { databaseManagerToken, type RepositoryPolicy } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { employeeServiceToken } from '../../../server/providers/employees/contract.js';
import { salaryGradeServiceToken } from '../../../server/providers/job-grades/contract.js';
import { TRANSFER_FIELDS } from '../../../server/providers/transfer/service.js';
import { CERTIFICATE_VIEW_FIELDS } from '../../../server/providers/certificates/printing.js';
import {
  createEmployee,
  createEmployeesAppTest,
} from '../employees/helpers.js';
import { json } from '../org/helpers.js';

const test = createEmployeesAppTest();
test('center composes real transfer and certificate owners with current resource scopes and safe fields', async ({
  testApp,
}) => {
  const c = testApp.application.container;
  const db = c.resolve(databaseManagerToken);
  const org = c.resolve(organizationServiceToken);
  const employee = c.resolve(employeeServiceToken);
  const grades = c.resolve(salaryGradeServiceToken);
  const authz = c.resolve(authorizationToken);
  const owner = await createEmployee(testApp, 'Center personnel HR');
  const manager = await createEmployee(testApp, 'Center personnel manager');
  const stranger = await createEmployee(testApp, 'Center personnel stranger');
  const context = { actorId: owner.userId };
  await org.addDutyRoleMember('hr', owner.userId, context);
  const position = await org.createPosition(
    { code: randomUUID(), title: 'Center position' },
    context,
  );
  const grade = await org.createGrade(
    { code: randomUUID(), title: 'Center grade', rank: 1 },
    context,
  );
  const department = await org.createDepartment(
    { title: 'Center department', managerId: manager.userId },
    context,
  );
  await org.addMember(
    { departmentId: department.id, userId: owner.userId, primary: true },
    context,
  );
  const subject = await createEmployee(testApp, 'Center personnel subject', {
    positionId: position.id,
    gradeId: grade.id,
    managerId: manager.employeeId,
  });
  await org.addMember(
    { departmentId: department.id, userId: subject.userId, primary: true },
    context,
  );
  await db.transaction((tx) =>
    employee.appendCompensation(
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
      bands: [{ gradeId: grade.id, minimumCents: 0, maximumCents: 200000 }],
      actorId: owner.userId,
      reason: 'Center grade fixture',
    },
    db.connection(),
  );
  const session = await owner.session();
  const response = await session.fetch(
    '/transferRequests',
    json({
      requestKey: randomUUID(),
      reason: 'Private personnel reason',
      proposal: {
        employeeId: subject.employeeId,
        kinds: ['salaryChange'],
        targetDepartmentId: department.id,
        targetPositionId: position.id,
        targetGradeId: grade.id,
        targetManagerId: manager.employeeId,
        effectiveDate: '2026-12-01',
        targetSalary: '1300.01',
        sourceAccountId: null,
        targetAccountId: null,
        reason: 'Private personnel reason',
      },
    }),
  );
  expect(response.status).toBe(201);
  const transfer = (await response.json()).data.record;
  const certificateResponse = await session.fetch(
    '/certificateRequests',
    json({
      certificateType: 'employment',
      purpose: 'Private employment purpose',
      copies: 1,
      deliveryMethod: 'pickup',
      requestKey: randomUUID(),
    }),
  );
  expect(certificateResponse.status).toBe(200);
  const certificate = (await certificateResponse.json()).data;
  const resources = [
    {
      kind: 'oa.transfer',
      resource: 'oa.transfer',
      collection: 'transferRequests',
      id: transfer.id,
      fields: [...TRANSFER_FIELDS],
    },
    {
      kind: 'oa.certificateRequest',
      resource: 'oa.certificateRequests',
      collection: 'certificateRequests',
      id: certificate.id,
      fields: [...CERTIFICATE_VIEW_FIELDS],
    },
  ];
  for (const source of resources) {
    const route = `/approvalCenter?view=mine&kind=${source.kind}`;
    const initial = await session.fetch(route);
    expect(initial.status).toBe(200);
    const result = await initial.json();
    expect(result.data).toEqual([
      expect.objectContaining({
        id: source.id,
        kind: source.kind,
        applicantId: owner.userId,
        amount: null,
        unit: null,
      }),
    ]);
    expect(Object.keys(result.data[0]).sort()).toEqual(
      [
        'id',
        'kind',
        'title',
        'number',
        'applicantId',
        'applicant',
        'status',
        'createdAt',
        'startDate',
        'endDate',
        'amount',
        'unit',
      ].sort(),
    );
    expect(result.data[0].title).toBe(
      source.kind === 'oa.transfer'
        ? 'Private personnel reason'
        : 'Private employment purpose',
    );
    expect(JSON.stringify(result)).not.toMatch(
      /1300|1000|snapshot|privateSalary|monthlyCents|baseSalary/,
    );
    expect(result.data[0]).not.toHaveProperty('reason');
    expect(result.data[0]).not.toHaveProperty('purpose');
    const foreign = await (await stranger.session()).fetch(route);
    expect(foreign.status).toBe(200);
    expect((await foreign.json()).data).toEqual([]);
    let current: RepositoryPolicy['read'] | 'deny' = {
      scope: { id: 'no-longer-authorized' },
      fields: source.fields,
    };
    const original = authz.for.bind(authz);
    const spy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
      const authorization = original(identity);
      return {
        ...authorization,
        authorize: async (check) => {
          const decision = await authorization.authorize(check);
          if (
            check.resource.type !== 'composite' ||
            check.resource.id !== source.resource ||
            check.action !== 'view'
          )
            return decision;
          if (current === 'deny') return { effect: 'deny' as const };
          const policies = decision.conditions?.database as
            Record<string, RepositoryPolicy> | undefined;
          return {
            ...decision,
            conditions: {
              ...decision.conditions,
              database: {
                ...policies,
                [source.collection]: {
                  ...policies?.[source.collection],
                  create: false,
                  update: false,
                  delete: false,
                  read: current,
                },
              },
            },
          };
        },
      };
    });
    try {
      const removedScope = await session.fetch(route);
      expect(removedScope.status).toBe(200);
      expect((await removedScope.json()).data).toEqual([]);
      current = { scope: true, fields: ['id'] };
      const removedFields = await session.fetch(route);
      expect(removedFields.status).toBe(403);
      expect([
        'APPROVAL_CENTER_ACCESS_DENIED',
        'FIELD_READ_FORBIDDEN',
      ]).toContain((await removedFields.json()).error.reason);
      current = 'deny';
      expect((await session.fetch(route)).status).toBe(403);
    } finally {
      spy.mockRestore();
    }
    const setKeys =
      source.kind === 'oa.transfer'
        ? ['oa-transfer-employee', 'oa-transfer-hr']
        : [
            'oa-certificates-employee',
            'oa-certificates-hr',
            'oa-certificates-admin',
          ];
    const saved = await Promise.all(
      setKeys.map((key) => authz.permissionSets.get(key)),
    );
    try {
      for (const set of saved) {
        if (!set) continue;
        await authz.permissionSets.update(set.key, {
          ...set,
          grants: set.grants.filter(
            (grant) =>
              grant.resource.type !== 'composite' ||
              grant.resource.id !== source.resource,
          ),
        });
      }
      // Same live session must consume current persisted grants, without a login refresh.
      expect((await session.fetch(route)).status).toBe(403);
    } finally {
      for (const set of saved)
        if (set) await authz.permissionSets.update(set.key, set);
    }
  }
  const submit = await session.fetch(
    `/transferRequests/${transfer.id}/transitions`,
    json({
      requestKey: randomUUID(),
      reason: 'Submit center fixture',
      version: transfer.lifecycleVersion,
      transition: 'submit',
    }),
  );
  expect(submit.status).toBe(200);
  const underway = await session.fetch(
    '/approvalCenter?view=mine&kind=oa.transfer',
  );
  expect((await underway.json()).meta.counts.inProgress).toBe(1);
  const pending = await (
    await manager.session()
  ).fetch('/approvalCenter?view=pending&kind=oa.transfer');
  expect(pending.status).toBe(200);
  expect((await pending.json()).data).toEqual([
    expect.objectContaining({ id: transfer.id, amount: null, unit: null }),
  ]);
});
