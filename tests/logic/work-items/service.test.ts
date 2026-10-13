import {
  lockUserForAdministration,
  userAdministrationServiceToken,
} from '@nocobase/app-plugin-authentication';
// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { createWorkItemAppTest } from './helpers.js';
import { createEmployee, ALL } from '../employees/helpers.js';
import { createWorkItemService } from '../../../server/providers/work-items/service.js';
import { auditServiceToken } from '../../../server/providers/audit/index.js';
import { orgServiceToken } from '../../../server/providers/org/contract.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { employeeServiceToken } from '../../../server/providers/employees/contract.js';
const test = createWorkItemAppTest();
async function fixture(testApp: Parameters<typeof createEmployee>[0]) {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    creator = await createEmployee(testApp, 'Task creator'),
    one = await createEmployee(testApp, 'Task assignee one'),
    two = await createEmployee(testApp, 'Task assignee two'),
    org = c.resolve(organizationServiceToken);
  await org.addDutyRoleMember('admin', one.userId, { actorId: creator.userId });
  await org.addDutyRoleMember('admin', two.userId, { actorId: creator.userId });
  const queued: string[] = [],
    notices: string[][] = [],
    deps = {
      db,
      audit: c.resolve(auditServiceToken),
      org: c.resolve(orgServiceToken),
      employees: c.resolve(employeeServiceToken),
      users: c.resolve(userAdministrationServiceToken),
      now: () => new Date('2030-01-01T00:00:00Z'),
      dispatcher: {
        dispatch: async (id: string) => {
          queued.push(id);
        },
      },
      notify: async (users: string[]) => {
        notices.push(users);
      },
    };
  const service = createWorkItemService(deps),
    cmd = (actorId = creator.userId) => ({ actorId, requestId: randomUUID() }),
    input = () => ({
      ...cmd(),
      title: 'Ordinary task',
      description: 'Perform a real action',
      targetUserId: one.userId,
      dutyRoleCode: null,
      dueAt: '2030-01-03T00:00:00Z',
      requiresConfirmation: true,
      attachments: [],
    });
  const save = (i = input()) => db.transaction((tx) => service.save(i, tx));
  const act = (
    id: string,
    expectedVersion: number,
    action: Parameters<typeof service.act>[0]['action'],
    actorId = creator.userId,
    extra = {},
  ) =>
    db.transaction((tx) =>
      service.act(
        { ...cmd(actorId), id, expectedVersion, action, ...extra },
        tx,
      ),
    );
  return {
    db,
    creator,
    one,
    two,
    org,
    deps,
    service,
    queued,
    notices,
    cmd,
    input,
    save,
    act,
  };
}
test('personal task completes only through assignee then creator confirmation; command and current policy guard replay', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    draft = await f.save(),
    assigned = await f.act(draft.id, draft.version, 'dispatch');
  expect(assigned.status).toBe('assigned');
  await expect(
    f.act(assigned.id, assigned.version, 'complete', f.creator.userId, {
      result: 'No',
    }),
  ).rejects.toThrow('ACCESS_DENIED');
  const i = {
    ...f.cmd(f.one.userId),
    id: assigned.id,
    expectedVersion: assigned.version,
    action: 'complete' as const,
    result: 'Done',
  };
  const done = await f.db.transaction((tx) => f.service.act(i, tx, ALL));
  expect(done.status).toBe('awaitingConfirmation');
  expect((await f.db.transaction((tx) => f.service.act(i, tx, ALL))).id).toBe(
    done.id,
  );
  await expect(
    f.db.transaction((tx) => f.service.act({ ...i, result: 'Other' }, tx, ALL)),
  ).rejects.toThrow('COMMAND_CONFLICT');
  await expect(
    f.db.transaction((tx) => f.service.act(i, tx, { ...ALL, update: false })),
  ).rejects.toThrow('ACCESS_DENIED');
  const returned = await f.act(
    done.id,
    done.version,
    'return',
    f.creator.userId,
    { reason: 'Incomplete evidence' },
  );
  expect(returned.status).toBe('assigned');
  const again = await f.act(
    returned.id,
    returned.version,
    'complete',
    f.one.userId,
    { result: 'Actual evidence' },
  );
  await expect(
    f.act(again.id, again.version, 'confirm', f.one.userId),
  ).rejects.toThrow('ACCESS_DENIED');
  expect((await f.act(again.id, again.version, 'confirm')).status).toBe(
    'completed',
  );
  expect(
    (await f.service.pending(f.one.userId, f.db.connection())).items.some(
      (i) => i.sourceId === done.id,
    ),
  ).toBe(false);
});
test('pool claim is serialized, release and completion require actual current membership, reassignment preserves history', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    draft = await f.save({
      ...f.input(),
      targetUserId: null,
      dutyRoleCode: 'admin',
    }),
    open = await f.act(draft.id, draft.version, 'dispatch');
  expect(open.status).toBe('open');
  const claims = await Promise.allSettled([
    f.act(open.id, open.version, 'claim', f.one.userId),
    f.act(open.id, open.version, 'claim', f.two.userId),
  ]);
  expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = claims.find((r) => r.status === 'fulfilled')!;
  if (winner.status !== 'fulfilled') throw new Error('No winner');
  const claimed = winner.value;
  await f.org.removeDutyRoleMember('admin', claimed.assigneeUserId!, {
    actorId: f.creator.userId,
  });
  await expect(
    f.act(claimed.id, claimed.version, 'release', claimed.assigneeUserId!),
  ).rejects.toThrow('ACCESS_DENIED');
  await expect(
    f.act(claimed.id, claimed.version, 'complete', claimed.assigneeUserId!, {
      result: 'No longer qualified',
    }),
  ).rejects.toThrow('ACCESS_DENIED');
  const changed = await f.act(
    claimed.id,
    claimed.version,
    'reassign',
    f.creator.userId,
    {
      targetUserId: f.creator.userId,
      dutyRoleCode: null,
      reason: 'Role member removed',
    },
  );
  expect(changed.status).toBe('assigned');
  expect(changed.dutyRoleCode).toBeNull();
  expect(changed.assigneeUserId).toBe(f.creator.userId);
  const cancelled = await f.act(
    changed.id,
    changed.version,
    'cancel',
    f.creator.userId,
    { reason: 'No longer needed' },
  );
  expect(cancelled.status).toBe('cancelled');
  expect(
    await f.db
      .repository('oaLifecycleTransitions')
      .count({ filter: { lifecycle: 'oa.workItem', recordId: open.id } }),
  ).toBe(5);
});
test('force complete requires real administrator and reason; audit failures rollback all journal facts; notifications dispatch only once', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    draft = await f.save(),
    assigned = await f.act(draft.id, draft.version, 'dispatch');
  await expect(
    f.act(assigned.id, assigned.version, 'forceComplete', f.creator.userId, {
      reason: 'Cannot bypass management',
    }),
  ).rejects.toThrow('ACCESS_DENIED');
  await expect(
    f.act(assigned.id, assigned.version, 'forceComplete', f.two.userId),
  ).rejects.toThrow('REASON_REQUIRED');
  const broken = createWorkItemService({
    ...f.deps,
    audit: {
      ...f.deps.audit,
      record: async () => {
        throw new Error('Audit fails');
      },
    },
  });
  await expect(
    f.db.transaction((tx) =>
      broken.act(
        {
          ...f.cmd(f.two.userId),
          id: assigned.id,
          expectedVersion: assigned.version,
          action: 'forceComplete',
          reason: 'Authorized correction',
        },
        tx,
      ),
    ),
  ).rejects.toThrow('Audit fails');
  expect(
    (await f.service.get(assigned.id, f.creator.userId, f.db.connection()))
      ?.status,
  ).toBe('assigned');
  const done = await f.act(
    assigned.id,
    assigned.version,
    'forceComplete',
    f.two.userId,
    { reason: 'Account handover verified' },
  );
  expect(done.forced).toBe(true);
  expect(done.result).toBeNull();
  expect(done.status).toBe('completed');
  const runs = await f.service.runtime.listEffectRuns({ recordId: done.id });
  for (const r of runs) {
    await f.service.runtime.runEffect(r.id);
    await f.service.runtime.runEffect(r.id);
  }
  expect(f.notices).toEqual([[f.creator.userId]]);
});
test('outer transaction rollback removes records, journals, command dedupe and queued notifications; blocked work returns only after real qualification', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  let rolledId = '';
  await expect(
    f.db.transaction(async (tx) => {
      const w = await f.service.save(f.input(), tx);
      rolledId = w.id;
      await f.service.act(
        {
          ...f.cmd(),
          id: w.id,
          expectedVersion: w.version,
          action: 'dispatch',
        },
        tx,
      );
      expect(f.queued).toHaveLength(0);
      throw new Error('Outer rollback');
    }),
  ).rejects.toThrow('Outer rollback');
  expect(
    await f.db.repository('workItems').count({ filter: { id: rolledId } }),
  ).toBe(0);
  expect(
    await f.db
      .repository('oaLifecycleTransitions')
      .count({ filter: { lifecycle: 'oa.workItem', recordId: rolledId } }),
  ).toBe(0);
  expect(f.queued).toHaveLength(0);
  const draft = await f.save(),
    assigned = await f.act(draft.id, draft.version, 'dispatch'),
    blocked = await f.act(
      assigned.id,
      assigned.version,
      'block',
      f.one.userId,
      { reason: 'Missing external evidence' },
    );
  expect(blocked.status).toBe('blocked');
  expect(
    (await f.service.pending(f.creator.userId, f.db.connection())).items.find(
      (i) => i.sourceId === blocked.id,
    )?.actions,
  ).toContain('resume');
  await f.db
    .repository('employees')
    .updateOne({ filter: { id: f.one.employeeId }, values: { active: false } });
  expect(
    await f.service.actions(blocked, f.creator.userId, f.db.connection()),
  ).not.toContain('resume');
  await expect(
    f.act(blocked.id, blocked.version, 'resume', f.creator.userId, {
      reason: 'Cannot resume departed assignee',
    }),
  ).rejects.toThrow('ACCESS_DENIED');
  const corrected = await f.act(
    blocked.id,
    blocked.version,
    'reassign',
    f.creator.userId,
    {
      targetUserId: f.two.userId,
      dutyRoleCode: null,
      reason: 'Real assignee replaced',
    },
  );
  expect(corrected.status).toBe('assigned');
  expect(corrected.assigneeUserId).toBe(f.two.userId);
});
test('departure owner scan counts actual assignee and future confirmation obligations even after disabling, without Approval task fabrication', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    draft = await f.save(),
    assigned = await f.act(draft.id, draft.version, 'dispatch');
  expect(
    await f.service.departureBlockers(f.creator.userId, f.db.connection()),
  ).toEqual({
    items: [
      { id: assigned.id, status: 'assigned', reasons: ['confirmationOwner'] },
    ],
    remaining: 1,
  });
  expect(
    (
      await f.service.departureBlockers(f.one.userId, f.db.connection())
    ).items.some((i) => i.id === assigned.id && i.reasons.includes('assignee')),
  ).toBe(true);
  await f.db
    .repository('employees')
    .updateOne({ filter: { id: f.one.employeeId }, values: { active: false } });
  expect(
    (await f.service.departureBlockers(f.one.userId, f.db.connection()))
      .remaining,
  ).toBe(1);
  const changed = await f.act(
    assigned.id,
    assigned.version,
    'reassign',
    f.creator.userId,
    {
      targetUserId: f.two.userId,
      dutyRoleCode: null,
      reason: 'Actual handover',
    },
  );
  expect(
    (await f.service.departureBlockers(f.one.userId, f.db.connection()))
      .remaining,
  ).toBe(0);
  expect(
    (await f.service.departureBlockers(f.creator.userId, f.db.connection()))
      .remaining,
  ).toBe(1);
  await f.act(changed.id, changed.version, 'cancel', f.creator.userId, {
    reason: 'Cancelled explicitly',
  });
  expect(
    (await f.service.departureBlockers(f.creator.userId, f.db.connection()))
      .remaining,
  ).toBe(0);
});

test('administration lock serializes disable before dispatch and disabled accounts cannot claim', async ({
  testApp,
}) => {
  const f = await fixture(testApp),
    draft = await f.save();
  let locked!: () => void, release!: () => void;
  const acquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const continueDisable = new Promise<void>((resolve) => {
    release = resolve;
  });
  const disabling = f.db.transaction(async (tx) => {
    await lockUserForAdministration(tx, f.one.userId);
    locked();
    await continueDisable;
    await f.deps.users.withConnection(tx).disable(f.one.userId);
  });
  await acquired;
  const dispatching = f.act(draft.id, draft.version, 'dispatch');
  const outcome = dispatching.then(
    () => 'unexpected success',
    (error: Error) => error.message,
  );
  release();
  await disabling;
  expect(await outcome).toBe('INVALID_TARGET');
  expect(
    (await f.service.get(draft.id, f.creator.userId, f.db.connection()))
      ?.status,
  ).toBe('draft');
  const pool = await f.save({
    ...f.input(),
    targetUserId: null,
    dutyRoleCode: 'admin',
  });
  const open = await f.act(pool.id, pool.version, 'dispatch');
  await expect(
    f.act(open.id, open.version, 'claim', f.one.userId),
  ).rejects.toThrow('ACCESS_DENIED');
});

test('rejects past and current draft deadlines with a dueAt field violation', async ({
  testApp,
}) => {
  const f = await fixture(testApp);
  for (const dueAt of ['2029-12-31T23:59:59Z', '2030-01-01T00:00:00Z']) {
    await expect(f.save({ ...f.input(), dueAt })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      field: 'dueAt',
    });
  }
  expect((await f.save()).status).toBe('draft');
});
