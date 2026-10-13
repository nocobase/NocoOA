// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  LifecycleRuntime,
  MemoryLifecycleStore,
  type MemoryTransaction,
} from '@nocobase/lifecycle';
import {
  ApprovalService,
  type Approval,
  type ApprovalDirectory,
} from '@nocobase/app-plugin-approval/server';
import type { DatabaseConnection } from '@nocobase/db';
import {
  createRecruitmentApproval,
  RECRUITMENT_LIFECYCLE,
  type RecruitmentRecord,
} from '../../../server/providers/recruitment/approval.js';
import type { RecruitmentSubmissionSnapshot } from '../../../server/providers/recruitment/submission.js';
import { createLegacyRecruitmentApproval } from '../../fixtures/recruitment/legacy-approval.js';
function setup(
  extra: Partial<RecruitmentSubmissionSnapshot> = {},
  declaration = createRecruitmentApproval,
) {
  const store = new MemoryLifecycleStore();
  const snapshot: RecruitmentSubmissionSnapshot = {
    departmentId: 'd1',
    positionId: 'p1',
    gradeId: 'g1',
    rank: 5,
    quantity: 1,
    kind: 'additional',
    replacementEmployeeIds: [],
    accountId: 'a1',
    year: 2026,
    gradeTableVersion: 1,
    gradeRevisionId: 'rev1',
    directorRank: 7,
    headId: 'head',
    headRequired: false,
    executiveId: 'vp',
    executiveRequired: true,
    gmId: 'gm',
    gmRequired: true,
    hrDirectorId: 'hrDirector',
    hrbpIds: ['bp1', 'bp2'],
    ...extra,
  };
  const directory: ApprovalDirectory = {
    isActive: () => true,
    managerOf: () => undefined,
    hasRole: (id, role) => id === 'admin' && role === 'approval.admin',
  };
  const hooks = {
    calendar: () => ({
      addWorkingHours: (from: Date, hours: number) =>
        new Date(from.getTime() + hours * 3600000),
    }),
    prepare: vi.fn(async () => snapshot),
    authorizeCreate: vi.fn(async () => true),
    authorizeEdit: vi.fn(async () => true),
    validateHrBp: vi.fn(async () => {}),
    publish: vi.fn(
      async (
        record: RecruitmentRecord,
        _actor: string,
        tx: DatabaseConnection,
      ) => {
        (tx as unknown as MemoryTransaction).insertRecord('requisitions', {
          id: record.id,
          status: 'recruiting',
        });
      },
    ),
    release: vi.fn(async () => {}),
  };
  const approval = declaration(hooks);
  const runtime = new LifecycleRuntime({ store });
  const services = (handle: unknown) => ({
    directory,
    connection: handle as DatabaseConnection,
  });
  runtime.register(approval, { services });
  const sdk = new ApprovalService(
    runtime,
    [approval.approval as unknown as Approval<never>],
    services,
  );
  store.insertRecord('recruitmentRequests', {
    id: 'r1',
    applicantId: 'applicant',
    departmentId: 'd1',
    positionId: 'p1',
    gradeId: 'g1',
    quantity: 1,
    kind: 'additional',
    replacementEmployeeIds: [],
    accountId: 'a1',
    year: 2026,
    expectedStartDate: '2026-11-01',
    jobDescription: 'Engineer',
    reason: 'Growth',
    privateSalaryRevisionId: 'salary1',
    snapshot: null,
    status: 'draft',
    lifecycleVersion: 0,
  });
  const fire = (transition: string, actor = 'applicant') =>
    runtime.fire(RECRUITMENT_LIFECYCLE, 'r1', transition, {
      actor: { id: actor },
    });
  const act = async (actor: string, action = 'approve') => {
    const tasks = await sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1');
    const task = tasks.find(
      (t) =>
        t.recordId === 'r1' && t.status === 'pending' && t.assigneeId === actor,
    )!;
    expect(task).toBeDefined();
    const views = await sdk.runViewsFor(RECRUITMENT_LIFECYCLE, 'r1');
    const run = views.find((v) => v.run.id === task.runId)!;
    return sdk.perform({
      target: { taskId: task.id },
      action,
      actor: { id: actor },
      contentHash: run.run.contentHash,
      ...(action === 'return'
        ? { input: { to: 'revision' }, comment: 'Correct proposal' }
        : action === 'reject'
          ? { comment: 'Refused' }
          : {}),
    });
  };
  const current = () => store.record('recruitmentRequests', 'r1');
  return {
    store,
    snapshot,
    hooks,
    runtime,
    sdk,
    fire,
    act,
    current,
    services,
    approval,
    directory,
  };
}
it('proxy answers and changed assignees receive new decisions instead of reused evidence', async () => {
  for (const change of ['proxy', 'assignee']) {
    const f = setup();
    if (change === 'proxy')
      f.directory.delegateOf = (id) =>
        id === 'bp1' ? { to: 'delegate', mode: 'proxy' } : undefined;
    await f.fire('submit');
    const task = (await f.sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).find(
      (task) => task.assigneeId === 'bp1',
    )!;
    const run = (await f.sdk.runViewsFor(RECRUITMENT_LIFECYCLE, 'r1'))[0]!;
    await f.sdk.perform({
      target: { taskId: task.id },
      action: 'approve',
      actor: { id: change === 'proxy' ? 'delegate' : 'bp1' },
      contentHash: run.run.contentHash,
    });
    await f.act('hrDirector', 'return');
    if (change === 'assignee') f.snapshot.hrbpIds = ['new-bp'];
    await f.fire('submit');
    expect(f.current()?.status).toBe('hrbp');
    expect(
      (await f.sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).filter(
        (task) => task.data?.reusedFromTaskId,
      ),
    ).toHaveLength(0);
    await expect(
      f.sdk.perform({
        target: { taskId: task.id },
        action: 'approve',
        actor: { id: 'bp1' },
        contentHash: run.run.contentHash,
      }),
    ).rejects.toThrow();
  }
});
it('existing version-1 runs can continue through the current public SDK without migration or return', async () => {
  const f = setup({}, createLegacyRecruitmentApproval);
  await f.fire('submit');
  const originalTask = (await f.sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).find(
    (task) => task.assigneeId === 'bp1',
  )!;
  const originalRun = (
    await f.sdk.runViewsFor(RECRUITMENT_LIFECYCLE, 'r1')
  )[0]!;
  const currentDeclaration = createRecruitmentApproval(f.hooks);
  expect(currentDeclaration.approval.application.signature).not.toBe(
    f.approval.approval.application.signature,
  );
  const runtime = new LifecycleRuntime({ store: f.store });
  runtime.register(currentDeclaration, { services: f.services });
  const sdk = new ApprovalService(
    runtime,
    [currentDeclaration.approval as unknown as Approval<never>],
    f.services,
  );
  await sdk.perform({
    target: { taskId: originalTask.id },
    action: 'approve',
    actor: { id: 'bp1' },
    contentHash: originalRun.run.contentHash,
  });
  expect(f.current()?.status).toBe('hrDirector');
  expect(
    (await sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).find(
      (task) => task.id === originalTask.id,
    ),
  ).toMatchObject({ status: 'completed', answer: 'approve' });
  const directorTask = (await sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).find(
    (task) => task.status === 'pending' && task.assigneeId === 'hrDirector',
  )!;
  const directorRun = (await sdk.runViewsFor(RECRUITMENT_LIFECYCLE, 'r1')).find(
    (view) => view.run.id === directorTask.runId,
  )!;
  await sdk.perform({
    target: { taskId: directorTask.id },
    action: 'return',
    actor: { id: 'hrDirector' },
    contentHash: directorRun.run.contentHash,
    input: { to: 'revision' },
    comment: 'Revise under the current declaration',
  });
  await runtime.fire(RECRUITMENT_LIFECYCLE, 'r1', 'submit', {
    actor: { id: 'applicant' },
  });
  expect(f.current()?.status).toBe('hrbp');
  expect(
    (await sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).filter(
      (task) => task.data?.reusedFromTaskId,
    ),
  ).toHaveLength(0);
});
it('native additional-capacity circulation publishes once only after actual final SDK approval', async () => {
  const f = setup();
  await f.fire('submit');
  expect(f.current()?.status).toBe('hrbp');
  await expect(f.fire('gmApproved', 'gm')).rejects.toThrow();
  await f.act('bp1');
  expect(f.current()?.status).toBe('hrDirector');
  expect(f.hooks.validateHrBp).toHaveBeenCalledOnce();
  await f.act('hrDirector');
  expect(f.current()?.status).toBe('executive');
  await f.act('vp');
  expect(f.current()?.status).toBe('gm');
  expect(f.hooks.publish).not.toHaveBeenCalled();
  await f.act('gm');
  expect(f.current()?.status).toBe('approved');
  expect(f.hooks.publish).toHaveBeenCalledOnce();
  expect(f.store.record('requisitions', 'r1')).toMatchObject({
    status: 'recruiting',
  });
});
it('authorized employee goes through head; low-rank replacement has no executive or GM', async () => {
  const f = setup({
    headRequired: true,
    kind: 'replacement',
    executiveRequired: false,
    gmRequired: false,
  });
  await f.fire('submit');
  expect(f.current()?.status).toBe('head');
  await f.act('head');
  await f.act('bp2');
  await f.act('hrDirector');
  expect(f.current()?.status).toBe('approved');
  expect(f.hooks.publish).toHaveBeenCalledOnce();
});
it('HRBP checkpoint failure rolls back the actual SDK decision and preserves open work', async () => {
  const f = setup();
  await f.fire('submit');
  f.hooks.validateHrBp.mockRejectedValueOnce(new Error('blocked replacement'));
  await expect(f.act('bp1')).rejects.toThrow('blocked replacement');
  expect(f.current()?.status).toBe('hrbp');
  await f.act('bp1');
  expect(f.current()?.status).toBe('hrDirector');
});
it('return retains reservation and resubmission invokes preparation again', async () => {
  const f = setup();
  await f.fire('submit');
  await f.act('bp1', 'return');
  expect(f.current()?.status).toBe('revision');
  expect(f.hooks.release).not.toHaveBeenCalled();
  await f.fire('submit');
  expect(f.current()?.status).toBe('hrbp');
  expect(f.hooks.prepare).toHaveBeenCalledTimes(2);
});
it.each(['rejected', 'withdrawn', 'terminated'])(
  'terminal %s releases the source through the host callback',
  async (state) => {
    const f = setup();
    await f.fire('submit');
    if (state === 'rejected') {
      await f.act('bp1', 'reject');
      await f.act('bp2', 'reject');
    }
    if (state === 'withdrawn') await f.fire('withdraw');
    if (state === 'terminated')
      await f.runtime.fire(RECRUITMENT_LIFECYCLE, 'r1', 'terminate', {
        actor: { id: 'admin' },
        input: { reason: 'Stop recruitment' },
      });
    expect(f.current()?.status).toBe(state);
    expect(f.hooks.release).toHaveBeenCalledOnce();
    expect(f.hooks.publish).not.toHaveBeenCalled();
  },
);
it('public SDK histories contain private revision references without amounts', async () => {
  const f = setup();
  await f.fire('submit');
  const history = await f.runtime.history(RECRUITMENT_LIFECYCLE, 'r1');
  expect(JSON.stringify(history)).not.toContain('Cents');
  expect(
    JSON.stringify(await f.sdk.runViewsFor(RECRUITMENT_LIFECYCLE, 'r1')),
  ).not.toContain('Cents');
});

it('administrators can search eligible reassignment recipients and hand over a task', async () => {
  const f = setup();
  f.directory.searchPeople = ({ search }) =>
    ['replacement', 'applicant'].filter((id) => !search || id.includes(search));
  await f.fire('submit');
  const task = (await f.sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1'))[0]!;
  const target = { taskId: task.id };
  const page = await f.sdk.candidatesFor({
    target,
    action: 'reassign',
    actor: { id: 'admin' },
    query: { search: '', offset: 0, limit: 20 },
  });
  expect(page.people).toContain('replacement');
  expect(page.people).not.toContain('applicant');
  await expect(
    f.sdk.candidatesFor({
      target,
      action: 'reassign',
      actor: { id: 'applicant' },
    }),
  ).rejects.toThrow();
  await f.sdk.perform({
    target,
    action: 'reassign',
    actor: { id: 'admin' },
    input: { to: 'replacement', override: false },
    comment: 'Cover absence',
  });
  expect(
    (await f.sdk.tasksFor(RECRUITMENT_LIFECYCLE, 'r1')).some(
      (row) => row.assigneeId === 'replacement',
    ),
  ).toBe(true);
});
