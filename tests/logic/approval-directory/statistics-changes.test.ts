// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { expect, vi } from 'vitest';
import { approvalDirectoryServiceToken } from '../../../server/providers/approval-directory/contract.js';
import {
  approvalQueryToken,
  approvalStatisticsChangesToken,
} from '../../../server/providers/approval-runtime/statistics-contract.js';
import { ApprovalStatisticsChangeService } from '../../../server/providers/approval-runtime/statistics-changes.js';
import { approvalQuerySources } from '../../../server/providers/approval-runtime/query-service.js';
import {
  leaveServiceToken,
  LEAVE_LIFECYCLE,
} from '../../../server/providers/leave/service.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import {
  createEmployee,
  createEmployeesAppTest,
} from '../employees/helpers.js';
import { json } from '../org/helpers.js';

const test = createEmployeesAppTest();
const BOUNDARIES = 'oaApprovalStatisticsBoundaries';

test('unifies immediate, future and expired delegation changes against real pending facts', async ({
  testApp,
}) => {
  const container = testApp.application.container;
  const directory = container.resolve(approvalDirectoryServiceToken);
  const changes = container.resolve(approvalStatisticsChangesToken);
  const query = container.resolve(approvalQueryToken);
  const manager = await createEmployee(testApp, 'Statistics manager');
  const delegate = await createEmployee(testApp, 'Statistics delegate');
  const replacement = await createEmployee(testApp, 'Statistics replacement');
  const applicant = await createEmployee(testApp, 'Statistics applicant', {
    managerId: manager.employeeId,
  });
  const org = container.resolve(organizationServiceToken);
  const department = await org.createDepartment(
    { title: 'Statistics department', managerId: manager.userId },
    { actorId: manager.userId },
  );
  await org.addMember(
    { departmentId: department.id, userId: applicant.userId, primary: true },
    { actorId: manager.userId },
  );
  const session = await applicant.session();
  const response = await session.fetch(
    '/leaveRequests',
    json({
      leaveType: 'personal',
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      startHalf: 'am',
      endHalf: 'pm',
      reason: 'Statistics pending fact',
      attachments: [],
      handoverUserId: null,
      enableDelegation: false,
    }),
  );
  expect(response.status).toBe(200);
  const record = (await response.json()).data.record;
  expect(
    (
      await session.fetch(
        `/leaveRequests/${record.id}/transition`,
        json({
          transition: 'submit',
          version: record.lifecycleVersion,
          requestId: randomUUID(),
          input: {},
        }),
      )
    ).status,
  ).toBe(200);

  const pending = async (userId: string) =>
    (await query.statistics([userId], [LEAVE_LIFECYCLE]))[0];
  const now = Date.now();
  const from = new Date(now + 60_000).toISOString();
  const to = new Date(now + 120_000).toISOString();
  const delegation = await directory.createManualDelegation(
    {
      principalId: manager.userId,
      delegateId: delegate.userId,
      scope: ['oa.leave'],
      from,
      to,
    },
    { actorId: manager.userId },
  );
  expect((await pending(manager.userId)).counts?.pendingRecords).toBe(1);
  expect((await pending(delegate.userId)).counts?.pendingRecords).toBe(0);
  // Dependency tracking/contributions are a separate migration, not implied by this trigger.
  expect((await pending(delegate.userId)).exact).toBe(false);
  expect(
    await testApp.database
      .repository(BOUNDARIES)
      .count({ filter: { dependencyKey: `delegation/${delegation.id}` } }),
  ).toBe(2);

  await container
    .resolve(jobExecutorServiceToken)
    .getScheduleExecutor('oa-approval-statistics-time')
    .shutdown();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(from));
    const fail = vi
      .spyOn(query, 'recomputeInTransaction')
      .mockRejectedValueOnce(new Error('time recompute failed'));
    try {
      await expect(changes.processDue()).rejects.toThrow(
        'time recompute failed',
      );
    } finally {
      fail.mockRestore();
    }
    expect(
      await testApp.database.repository(BOUNDARIES).count({
        filter: { dependencyKey: `delegation/${delegation.id}` },
      }),
    ).toBe(2);
    const attempts = await Promise.all([
      changes.processDue(),
      changes.processDue(),
    ]);
    expect(attempts.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await pending(delegate.userId)).counts?.pendingRecords).toBe(1);
    await directory.updateManualDelegation(
      delegation.id,
      {
        principalId: manager.userId,
        delegateId: replacement.userId,
        scope: ['oa.leave'],
        from,
        to,
      },
      { actorId: manager.userId },
    );
    expect((await pending(delegate.userId)).counts?.pendingRecords).toBe(0);
    expect((await pending(replacement.userId)).counts?.pendingRecords).toBe(1);
    expect(
      await testApp.database
        .repository(BOUNDARIES)
        .count({ filter: { dependencyKey: `delegation/${delegation.id}` } }),
    ).toBe(1);

    // A new dispatcher instance recovers pending boundaries from PostgreSQL.
    const restarted = new ApprovalStatisticsChangeService(
      testApp.database,
      query,
    );
    for (const source of approvalQuerySources(
      container.resolve(leaveServiceToken).approvals,
    ))
      restarted.register(source);
    restarted.activate();
    vi.setSystemTime(new Date(to));
    expect(await restarted.processDue()).toBe(1);
    expect((await pending(replacement.userId)).counts?.pendingRecords).toBe(0);
    expect(await restarted.processDue()).toBe(0);
    expect(
      await testApp.database
        .repository(BOUNDARIES)
        .count({ filter: { dependencyKey: `delegation/${delegation.id}` } }),
    ).toBe(0);
    restarted.deactivate();
  } finally {
    vi.useRealTimers();
  }
});

test('rolls back dependency writes, audit and time events when synchronous recompute fails', async ({
  testApp,
}) => {
  const container = testApp.application.container;
  const directory = container.resolve(approvalDirectoryServiceToken);
  const query = container.resolve(approvalQueryToken);
  const principal = await createEmployee(
    testApp,
    'Statistics rollback principal',
  );
  const delegate = await createEmployee(
    testApp,
    'Statistics rollback delegate',
  );
  const before = await testApp.database.repository(BOUNDARIES).count();
  const fail = vi
    .spyOn(query, 'recomputeInTransaction')
    .mockRejectedValueOnce(new Error('recompute failed'));
  try {
    await expect(
      directory.createManualDelegation(
        {
          principalId: principal.userId,
          delegateId: delegate.userId,
          scope: ['oa.leave'],
          from: new Date(Date.now() + 60_000).toISOString(),
          to: new Date(Date.now() + 120_000).toISOString(),
        },
        { actorId: principal.userId },
      ),
    ).rejects.toThrow('recompute failed');
  } finally {
    fail.mockRestore();
  }
  expect(
    (await directory.list()).filter(
      (entry) => entry.principalId === principal.userId,
    ),
  ).toEqual([]);
  expect(await testApp.database.repository(BOUNDARIES).count()).toBe(before);
  expect(
    (await query.statistics([delegate.userId], [LEAVE_LIFECYCLE]))[0].counts,
  ).toBeNull();
});

test('cancels future boundaries on disable and preserves outer transaction rollback', async ({
  testApp,
}) => {
  const directory = testApp.application.container.resolve(
    approvalDirectoryServiceToken,
  );
  const principal = await createEmployee(
    testApp,
    'Statistics disable principal',
  );
  const delegate = await createEmployee(testApp, 'Statistics disable delegate');
  const sdk = testApp.application.container.resolve(leaveServiceToken);
  const draftId = randomUUID();
  await expect(
    testApp.database.transaction(async (connection) => {
      await sdk.runtime.create(
        LEAVE_LIFECYCLE,
        {
          id: draftId,
          applicantId: principal.userId,
          createdById: principal.userId,
          leaveType: 'personal',
          startDate: '2026-11-20',
          endDate: '2026-11-20',
          startHalf: 'am',
          endHalf: 'pm',
          reason: 'Joined SDK rollback',
          attachments: [],
          handoverUserId: null,
          enableDelegation: false,
          number: null,
          days: 0,
          ruleSnapshot: null,
          hrRecipients: [],
          requiresHr: false,
          managerApproverId: null,
          createdAt: new Date().toISOString(),
        },
        { actor: { id: principal.userId }, transaction: connection },
      );
      throw new Error('SDK outer rollback');
    }),
  ).rejects.toThrow('SDK outer rollback');
  expect(
    await testApp.database.repository('leaveRequests').findOne({
      filter: { id: draftId },
    }),
  ).toBeUndefined();
  const input = {
    principalId: principal.userId,
    delegateId: delegate.userId,
    scope: ['oa.leave'],
    from: new Date(Date.now() + 60_000).toISOString(),
    to: new Date(Date.now() + 120_000).toISOString(),
  };
  await expect(
    testApp.database.transaction(async (connection) => {
      await directory.createLeaveDelegation(
        { ...input, sourceApplication: 'statistics-rollback-leave' },
        { actorId: principal.userId, connection },
      );
      throw new Error('outer rollback');
    }),
  ).rejects.toThrow('outer rollback');
  expect(
    (await directory.list()).some(
      (entry) => entry.sourceApplication === 'statistics-rollback-leave',
    ),
  ).toBe(false);
  const entry = await directory.createManualDelegation(input, {
    actorId: principal.userId,
  });
  await directory.disableManualDelegation(entry.id, {
    actorId: principal.userId,
  });
  expect(
    await testApp.database
      .repository(BOUNDARIES)
      .count({ filter: { dependencyKey: `delegation/${entry.id}` } }),
  ).toBe(0);
});
