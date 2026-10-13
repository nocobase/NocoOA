// @vitest-environment node
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { describe, expect } from 'vitest';
import {
  approvalDirectoryServiceToken,
  type DelegationInput,
} from '../../../server/providers/approval-directory/index.ts';
import { organizationServiceToken } from '../../../server/providers/org/index.ts';
import {
  createEmployee,
  createEmployeesAppTest,
} from '../employees/helpers.ts';

const test = createEmployeesAppTest();
const interval = {
  from: '2026-10-10T00:00:00Z',
  to: '2026-10-12T00:00:00Z',
  scope: ['oa.leave'],
};
const actor = { actorId: 'test-actor' };

describe('approval directory and proxy delegations', () => {
  test('resolves employees, inactive manager fallback, department ancestor leaders and unique roles', async ({
    testApp,
  }) => {
    const container = testApp.application.container;
    const service = container.resolve(approvalDirectoryServiceToken);
    const org = container.resolve(organizationServiceToken);
    const boss = await createEmployee(testApp, 'Directory Boss');
    const inactive = await createEmployee(testApp, 'Directory Inactive', {
      managerId: boss.employeeId,
    });
    const person = await createEmployee(testApp, 'Directory Person', {
      managerId: inactive.employeeId,
    });
    await testApp.database.repository('employees').updateOne({
      filter: { id: inactive.employeeId },
      values: { active: false },
    });
    const root = await org.createDepartment(
      {
        title: 'Directory Root',
        managerId: boss.userId,
        executiveId: boss.userId,
      },
      actor,
    );
    const leaf = await org.createDepartment(
      { title: 'Directory Leaf', parentId: root.id },
      actor,
    );
    await org.addMember(
      { departmentId: leaf.id, userId: person.userId, primary: true },
      actor,
    );
    await org.addDutyRoleMember('gm', boss.userId, actor);
    const directory = await service.snapshot();
    const eligibility = await service.eligibility(
      [boss.userId, person.userId, inactive.userId, 'missing-user'],
      ['gm', 'hr', 'approval.admin'],
    );
    for (const id of [
      boss.userId,
      person.userId,
      inactive.userId,
      'missing-user',
    ]) {
      expect(eligibility.isActive(id)).toBe(directory.isActive(id));
      for (const role of ['gm', 'hr'])
        expect(eligibility.hasRole(id, role)).toBe(directory.hasRole(id, role));
      expect(eligibility.hasRole(id, 'approval.admin')).toBe(false);
    }
    await container
      .resolve(userAdministrationServiceToken)
      .disable(boss.userId);
    const disabled = await service.eligibility([boss.userId], ['gm']);
    expect(disabled.isActive(boss.userId)).toBe(false);
    expect(disabled.hasRole(boss.userId, 'gm')).toBe(false);
    await container.resolve(userAdministrationServiceToken).enable(boss.userId);
    const shared = await service.withReadSnapshot(() =>
      Promise.all([service.snapshot(), service.snapshot()]),
    );
    expect(shared[0]).toBe(shared[1]);
    expect(shared[0]).not.toBe(directory);
    await service.withReadSnapshot(async () => {
      const read = await service.snapshot();
      const bounded = await service.eligibility([boss.userId], ['gm']);
      expect(bounded.isActive(boss.userId)).toBe(read.isActive(boss.userId));
      expect(bounded.hasRole(boss.userId, 'gm')).toBe(true);
      expect(bounded.isActive(person.userId)).toBe(false);
      expect(bounded.hasRole(boss.userId, 'approval.admin')).toBe(false);
      const explicit = await service.snapshot(testApp.database.connection());
      expect(explicit).not.toBe(read);
    });
    const isolated = await Promise.all([
      service.withReadSnapshot(() => service.snapshot()),
      service.withReadSnapshot(() => service.snapshot()),
    ]);
    expect(isolated[0]).not.toBe(isolated[1]);

    expect(directory.managerOf(person.userId)).toBe(boss.userId);
    expect(directory.headOf(person.userId)).toBe(boss.userId);
    expect(directory.executiveOf(person.userId)).toBe(boss.userId);
    expect(directory.isActive(inactive.userId)).toBe(false);
    expect(directory.uniqueRoleMember('gm')).toBe(boss.userId);
    expect(directory.hasRole(boss.userId, 'gm')).toBe(true);
    expect(
      await directory.searchPeople?.({
        search: 'Directory Person',
        offset: 0,
        limit: 10,
      }),
    ).toEqual([person.userId]);
    await container
      .resolve(userAdministrationServiceToken)
      .disable(boss.userId);
    const after = await service.snapshot();
    expect(after.managerOf(person.userId)).toBeUndefined();
    expect(after.headOf(person.userId)).toBeUndefined();
    expect(after.uniqueRoleMember('gm')).toBeUndefined();
    // A corrupted self-reporting edge must terminate rather than selecting the applicant.
    await testApp.database.repository('employees').updateOne({
      filter: { id: person.employeeId },
      values: { managerId: person.employeeId },
    });
    expect((await service.snapshot()).managerOf(person.userId)).toBeUndefined();
  });

  test('limits proxies by time and scope, supports existing tasks, never passes a delegation onward', async ({
    testApp,
  }) => {
    const service = testApp.application.container.resolve(
      approvalDirectoryServiceToken,
    );
    const a = await createEmployee(testApp, 'Proxy A');
    const b = await createEmployee(testApp, 'Proxy B');
    const c = await createEmployee(testApp, 'Proxy C');
    const input: DelegationInput = {
      ...interval,
      principalId: a.userId,
      delegateId: b.userId,
    };
    const first = await service.createManualDelegation(input, actor);
    await service.createManualDelegation(
      { ...interval, principalId: b.userId, delegateId: c.userId },
      actor,
    );
    const directory = await service.snapshot();
    expect(
      directory.delegateOf?.(
        a.userId,
        'oa.leave',
        interval.from,
        '2026-10-01T00:00:00Z',
      ),
    ).toEqual({ to: b.userId, mode: 'proxy' });
    expect(
      directory.delegateOf?.(
        a.userId,
        'oa.leave',
        '2026-10-09T23:59:59Z',
        interval.from,
      ),
    ).toBeUndefined();
    expect(
      directory.delegateOf?.(a.userId, 'oa.leave', interval.to, interval.from),
    ).toBeUndefined();
    expect(
      directory.delegateOf?.(
        a.userId,
        'oa.expense',
        interval.from,
        interval.from,
      ),
    ).toBeUndefined();
    await expect(
      service.createManualDelegation(input, actor),
    ).rejects.toMatchObject({ code: 'DELEGATION_OVERLAP' });
    await expect(
      service.createManualDelegation({ ...input, delegateId: a.userId }, actor),
    ).rejects.toMatchObject({ code: 'INVALID_DELEGATION' });
    await service.disableManualDelegation(first.id, actor);
    expect(
      (await service.snapshot()).delegateOf?.(
        a.userId,
        'oa.leave',
        interval.from,
        interval.from,
      ),
    ).toBeUndefined();
    expect(
      (await service.list()).find((entry) => entry.id === first.id)?.active,
    ).toBe(false);
  });

  test('keeps leave delegation and audit in the caller transaction, protects its source and disables on cancellation', async ({
    testApp,
  }) => {
    const service = testApp.application.container.resolve(
      approvalDirectoryServiceToken,
    );
    const a = await createEmployee(testApp, 'Leave Proxy A');
    const b = await createEmployee(testApp, 'Leave Proxy B');
    const input = {
      ...interval,
      principalId: a.userId,
      delegateId: b.userId,
      sourceApplication: 'LV-TRANSACTION',
    };
    await expect(
      testApp.database.transaction(async (connection) => {
        await service.createLeaveDelegation(input, { ...actor, connection });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(
      (await service.list()).some(
        (entry) => entry.sourceApplication === input.sourceApplication,
      ),
    ).toBe(false);
    const created = await testApp.database.transaction((connection) =>
      service.createLeaveDelegation(input, { ...actor, connection }),
    );
    await expect(
      service.disableManualDelegation(created.id, actor),
    ).rejects.toMatchObject({ code: 'DELEGATION_SOURCE_PROTECTED' });
    await testApp.database.transaction(async (connection) => {
      expect(
        (await service.createLeaveDelegation(input, { ...actor, connection }))
          .id,
      ).toBe(created.id);
      await service.disableLeaveDelegations(input.sourceApplication, {
        ...actor,
        connection,
      });
    });
    const audits = await testApp.database
      .repository('auditLogs')
      .findMany({ filter: { targetId: created.id } });
    expect(audits.map((entry) => entry.action)).toEqual([
      'approvalDelegation.create',
      'approvalDelegation.disable',
    ]);
  });
  test('serializes competing delegations and permits adjacent intervals', async ({
    testApp,
  }) => {
    const service = testApp.application.container.resolve(
      approvalDirectoryServiceToken,
    );
    const principal = await createEmployee(testApp, 'Concurrent Principal');
    const delegate = await createEmployee(testApp, 'Concurrent Delegate');
    const input = {
      ...interval,
      principalId: principal.userId,
      delegateId: delegate.userId,
    };
    const results = await Promise.allSettled([
      service.createManualDelegation(input, actor),
      service.createManualDelegation(input, actor),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const refusal = results.find((result) => result.status === 'rejected');
    expect(refusal?.status === 'rejected' && refusal.reason).toMatchObject({
      code: 'DELEGATION_OVERLAP',
    });
    const adjacent = await service.createManualDelegation(
      { ...input, from: interval.to, to: '2026-10-14T00:00:00Z' },
      actor,
    );
    expect(adjacent.active).toBe(true);
  });
});
