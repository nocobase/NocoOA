// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  createEmployee,
  createEmployeesAppTest,
} from '../employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { approvalDirectoryServiceToken } from '../../../server/providers/approval-directory/contract.js';
import {
  approvalQueryToken,
  approvalStatisticsChangesToken,
} from '../../../server/providers/approval-runtime/statistics-contract.js';
import { withAppLifecycleTransaction } from '../../../server/providers/approval-runtime/repository-store.js';
import {
  leaveServiceToken,
  LEAVE_LIFECYCLE,
} from '../../../server/providers/leave/service.js';
import { loanRequestServiceToken } from '../../../server/providers/loan-requests/index.js';

const test = createEmployeesAppTest();
test('exhausts pending candidates before business-time paging, preserves delegates, and skips empty owners', async ({
  testApp,
}) => {
  const container = testApp.application.container;
  const reviewer = await createEmployee(testApp, 'Indexed reviewer');
  const delegate = await createEmployee(testApp, 'Indexed delegate');
  const applicant = await createEmployee(testApp, 'Indexed applicant', {
    managerId: reviewer.employeeId,
  });
  const permissions = container.resolve(authorizationToken).permissionSets;
  const root = (await permissions.list()).find(
    (set) => permissions.protection(set.key)?.unrestricted,
  )!;
  for (const userId of [reviewer.userId, delegate.userId])
    await permissions.assign({
      permissionSet: root.key,
      subject: { type: 'user', id: userId },
    });
  const org = container.resolve(organizationServiceToken);
  const department = await org.createDepartment(
    { title: 'Indexed department', managerId: reviewer.userId },
    { actorId: reviewer.userId },
  );
  await org.addMember(
    { departmentId: department.id, userId: applicant.userId, primary: true },
    { actorId: reviewer.userId },
  );
  const leave = container.resolve(leaveServiceToken);
  const changes = container.resolve(approvalStatisticsChangesToken);
  const ids: string[] = [];
  await changes.change(
    { kinds: 'all', userIds: [], reason: 'candidateFixture' },
    (connection) =>
      withAppLifecycleTransaction(connection, () =>
        leave.runtime.transaction(async (tx) => {
          // Task arrival order is deliberately the reverse of business createdAt.
          for (const [index, day] of [2, 3, 4, 5, 6, 9, 10].entries()) {
            const id = randomUUID();
            const result = await tx.create(
              LEAVE_LIFECYCLE,
              {
                id,
                applicantId: applicant.userId,
                createdById: applicant.userId,
                leaveType: 'personal',
                startDate: `2026-11-${String(day).padStart(2, '0')}`,
                endDate: `2026-11-${String(day).padStart(2, '0')}`,
                startHalf: 'am',
                endHalf: 'pm',
                reason: 'Indexed approval',
                attachments: [],
                handoverUserId: null,
                enableDelegation: false,
                number: null,
                days: 0,
                ruleSnapshot: null,
                hrRecipients: [],
                requiresHr: false,
                managerApproverId: null,
                createdAt: `2026-01-01T00:0${6 - index}:00Z`,
              },
              { actor: { id: applicant.userId } },
            );
            await tx.fire(LEAVE_LIFECYCLE, id, 'submit', {
              actor: { id: applicant.userId },
              input: {},
              expect: { version: Number(result.record.lifecycleVersion) },
              requestId: randomUUID(),
            });
            ids.push(id);
          }
        }),
      ),
  );
  const queryRead = vi.spyOn(
    container.resolve(approvalQueryToken),
    'taskCandidates',
  );
  const loanRead = vi.spyOn(container.resolve(loanRequestServiceToken), 'list');
  const client = await testApp.database.connection().client();
  let headcountWrites = 0;
  const observe = (query: { sql: string }) => {
    if (/^update\s+"?public"?\."?headcount_guards"?/i.test(query.sql))
      headcountWrites++;
  };
  try {
    const session = await reviewer.session();
    client.on('query', observe);
    const response = await session.fetch(
      '/approvalCenter?view=pending&pageSize=6',
    );
    client.removeListener('query', observe);
    expect(headcountWrites).toBe(0);
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first.meta.total).toBe(7);
    expect(first.data.map((row: { id: string }) => row.id)).toEqual(
      ids.slice(0, 6),
    );
    const second = await (
      await session.fetch('/approvalCenter?view=pending&pageSize=6&page=2')
    ).json();
    expect(second.meta.total).toBe(7);
    expect(second.data.map((row: { id: string }) => row.id)).toEqual(
      ids.slice(6),
    );
    const searched = await (
      await session.fetch(
        `/approvalCenter?view=pending&pageSize=6&search=${encodeURIComponent(first.data[0].number)}`,
      )
    ).json();
    expect(searched.meta.total).toBe(1);
    expect(searched.data[0].id).toBe(ids[0]);
    expect(queryRead).toHaveBeenCalled();
    expect(loanRead).not.toHaveBeenCalled();

    const directory = container.resolve(approvalDirectoryServiceToken);
    const delegation = await directory.createManualDelegation(
      {
        principalId: reviewer.userId,
        delegateId: delegate.userId,
        scope: ['oa.leave'],
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 3600_000).toISOString(),
      },
      { actorId: reviewer.userId },
    );
    const delegateSession = await delegate.session();
    const delegated = await (
      await delegateSession.fetch(
        '/approvalCenter?view=pending&kind=oa.leave&pageSize=6',
      )
    ).json();
    expect(delegated.meta.total).toBe(7);
    expect(delegated.data.map((row: { id: string }) => row.id)).toEqual(
      ids.slice(0, 6),
    );
    await directory.disableManualDelegation(delegation.id, {
      actorId: reviewer.userId,
    });
    const expired = await (
      await delegateSession.fetch(
        '/approvalCenter?view=pending&kind=oa.leave&pageSize=6',
      )
    ).json();
    expect(expired.meta.total).toBe(0);
  } finally {
    client.removeListener('query', observe);
    queryRead.mockRestore();
    loanRead.mockRestore();
  }
});
