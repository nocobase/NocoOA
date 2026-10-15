// @vitest-environment node
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { grantToUser } from '../employees/helpers.js';
import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { measureRequestSql } from '../../../server/providers/request-performance/sql.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { json } from '../org/helpers.js';
import {
  leaveServiceToken,
  LEAVE_LIFECYCLE,
} from '../../../server/providers/leave/service.js';
import {
  withApprovalQueryReads,
  hasApprovalCandidate,
  hasApprovalTaskActor,
  hasApprovalAssignment,
} from '../../../server/providers/approval-runtime/query-service.js';
import {
  createEmployeesAppTest,
  createEmployee,
} from '../employees/helpers.js';

const test = createEmployeesAppTest();
test('profiles first workbench reads on PostgreSQL with a small synthetic roster', async ({
  testApp,
}) => {
  for (let i = 0; i < 8; i++)
    await createEmployee(testApp, `Performance employee ${i}`);
  const actor = await createEmployee(testApp, 'Performance viewer');
  const sets =
    testApp.application.container.resolve(authorizationToken).permissionSets;
  await grantToUser(
    testApp,
    'performance-broad-business-role',
    (await sets.list())
      .filter((set) => !sets.protection(set.key)?.unrestricted)
      .flatMap((set) => set.grants),
    actor.userId,
  );
  const session = await actor.session();
  // A small real document set exercises owner policies and lifecycle reads,
  // rather than profiling only empty business tables.
  for (let index = 0; index < 5; index++) {
    const response = await session.fetch(
      '/leaveRequests',
      json({
        leaveType: 'personal',
        startDate: `2026-11-${String(index + 2).padStart(2, '0')}`,
        endDate: `2026-11-${String(index + 2).padStart(2, '0')}`,
        startHalf: 'am',
        endHalf: 'pm',
        reason: `Performance draft ${index}`,
        attachments: [],
        handoverUserId: null,
        enableDelegation: false,
      }),
    );
    expect(response.status).toBe(200);
  }
  const applicant = await createEmployee(
    testApp,
    'Performance pending applicant',
    { managerId: actor.employeeId },
  );
  const organization = testApp.application.container.resolve(
    organizationServiceToken,
  );
  const department = await organization.createDepartment(
    { title: 'Performance department', managerId: actor.userId },
    { actorId: actor.userId },
  );
  await organization.addMember(
    { departmentId: department.id, userId: applicant.userId, primary: true },
    { actorId: actor.userId },
  );
  const applicantSession = await applicant.session();
  const draftResponse = await applicantSession.fetch(
    '/leaveRequests',
    json({
      leaveType: 'personal',
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      startHalf: 'am',
      endHalf: 'pm',
      reason: 'Performance real pending',
      attachments: [],
      handoverUserId: null,
      enableDelegation: false,
    }),
  );
  expect(draftResponse.status).toBe(200);
  const draft = (await draftResponse.json()).data.record;
  const submitted = await applicantSession.fetch(
    `/leaveRequests/${draft.id}/transition`,
    json({
      transition: 'submit',
      version: draft.lifecycleVersion,
      requestId: randomUUID(),
      input: {},
    }),
  );
  expect(submitted.status).toBe(200);
  const client = await testApp.database.connection().client();
  // Known statements on real PG verify transaction events and concurrent
  // attribution without treating unrelated scheduler SQL as request work.
  const sqlSamples = await Promise.all(
    [1, 3].map(async (size) => {
      let queries = 0;
      await measureRequestSql(
        testApp.database.connection(),
        async () => {
          await client.transaction(async (transaction) => {
            for (let i = 0; i < size; i++) await transaction.raw('select 1');
          });
        },
        (count) => {
          queries = count;
        },
      );
      return queries;
    }),
  );
  expect(sqlSamples).toEqual([3, 5]);
  const paths = [
    '/authorization/permissions',
    '/approvalCenter?view=pending&pageSize=6',
    '/approvalCenter?view=mine&pageSize=5&homeSummary=true',
    '/transferRequests/capabilities',
    '/recruitmentRequests/createOptions',
    '/vehicleBrowser/options',
    `/departureRequests/options?viewer=${actor.userId}`,
    `/probationRequests/options?viewer=${actor.userId}`,
    `/assetRequests/options?viewer=${actor.userId}`,
    `/contractRequests/options?viewer=${actor.userId}`,
    `/vendorQualifications/options?viewer=${actor.userId}`,
  ];
  for (const path of paths) {
    let queries = 0;

    const count = () => {
      queries++;
    };
    client.on('query', count);
    const start = performance.now();
    const cpu = process.cpuUsage();
    let status: number;
    let requestQueries: number;
    try {
      const response = await session.fetch(path);
      status = response.status;
      const reported = response.headers
        .get('Server-Timing')
        ?.match(/sql;desc="(\d+) statements"/);
      expect(reported).not.toBeNull();
      requestQueries = Number(reported?.[1]);
      // Process-wide events also include independently scheduled work.
      expect(requestQueries).toBeGreaterThan(0);
      expect(requestQueries).toBeLessThanOrEqual(queries);
      if (path.includes('view=pending'))
        expect((await response.json()).meta.total).toBe(1);
      if (path.includes('view=mine'))
        expect((await response.json()).meta.total).toBe(5);
    } finally {
      client.removeListener('query', count);
    }
    const used = process.cpuUsage(cpu);
    process.stdout.write(
      JSON.stringify({
        path,
        status,
        ms: Math.round(performance.now() - start),
        queries,
        requestQueries,
        cpuMs: Math.round((used.user + used.system) / 1000),
      }) + '\n',
    );
    expect(status).toBe(200);
    // Form eligibility must not rebuild the full approval directory. These
    // budgets cover the real route, including authentication and authorization.
    if (path.startsWith('/assetRequests/options'))
      expect(queries).toBeLessThanOrEqual(80);
    if (path.startsWith('/vendorQualifications/options'))
      expect(queries).toBeLessThanOrEqual(86);
    expect(queries).toBeLessThan(
      path === '/authorization/permissions' ? 600 : 400,
    );
  }
  const concurrent = await Promise.all(
    paths.slice(1).map(async (path) => {
      const start = performance.now();
      const response = await session.fetch(path);
      expect(response.status).toBe(200);
      return { path, ms: Math.round(performance.now() - start) };
    }),
  );
  process.stdout.write(JSON.stringify({ concurrent }) + '\n');
  const waveStart = performance.now();
  const wave = async (wavePaths: string[]) =>
    Promise.all(
      wavePaths.map(async (path) => {
        const start = performance.now();
        const response = await session.fetch(path);
        expect(response.status).toBe(200);
        return { path, ms: Math.round(performance.now() - start) };
      }),
    );
  const primaryWave = await wave(paths.slice(1, 3));
  const metadataWave = await wave(paths.slice(3));
  process.stdout.write(
    JSON.stringify({
      primaryWave,
      metadataWave,
      allWavesMs: Math.round(performance.now() - waveStart),
    }) + '\n',
  );
  // Compare the same public SDK relation checks with and without the request
  // batching context. Include real assigned work and many unrelated identities.
  const leave = testApp.application.container.resolve(leaveServiceToken);
  const ids = [
    draft.id,
    ...Array.from({ length: 24 }, (_, index) => `unrelated-${index}`),
  ];
  const sample = async (batched: boolean) => {
    let queries = 0;
    const count = () => {
      queries++;
    };
    client.on('query', count);
    try {
      const work = async () => {
        const result = [];
        for (const id of ids)
          result.push(
            await leave.approvals.involvementOf(
              LEAVE_LIFECYCLE,
              id,
              actor.userId,
            ),
          );
        return result;
      };
      const values = batched
        ? await withApprovalQueryReads(work)
        : await work();
      return { count: queries, values };
    } finally {
      client.removeListener('query', count);
    }
  };
  const original = await sample(false),
    batch = await sample(true);
  expect(batch.values).toEqual(original.values);
  expect(batch.count).toBeLessThan(original.count / 4);
  await withApprovalQueryReads(async () => {
    expect(
      await hasApprovalAssignment(
        leave.approvals,
        LEAVE_LIFECYCLE,
        draft.id,
        actor.userId,
      ),
    ).toBe(true);
    expect(
      await hasApprovalAssignment(
        leave.approvals,
        LEAVE_LIFECYCLE,
        draft.id,
        applicant.userId,
      ),
    ).toBe(false);
    expect(
      await hasApprovalCandidate(
        leave.approvals,
        LEAVE_LIFECYCLE,
        draft.id,
        actor.userId,
      ),
    ).toBe(true);
    expect(
      await hasApprovalCandidate(
        leave.approvals,
        LEAVE_LIFECYCLE,
        draft.id,
        applicant.userId,
      ),
    ).toBe(false);
    expect(
      await hasApprovalTaskActor(
        leave.approvals,
        LEAVE_LIFECYCLE,
        draft.id,
        actor.userId,
      ),
    ).toBe(false);
  });
  process.stdout.write(
    JSON.stringify({
      relationQueryBudget: {
        original: original.count,
        batched: batch.count,
        records: ids.length,
      },
    }) + '\n',
  );
}, 120000);
