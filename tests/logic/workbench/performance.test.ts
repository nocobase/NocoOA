// @vitest-environment node
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { grantToUser } from '../employees/helpers.js';
import { expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { json } from '../org/helpers.js';
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
    try {
      const response = await session.fetch(path);
      status = response.status;
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
}, 120000);
