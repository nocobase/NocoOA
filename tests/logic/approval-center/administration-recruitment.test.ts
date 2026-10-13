// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { test } from '../seals/helpers.js';
import { createEmployee } from '../employees/helpers.js';
import { write } from '../platform/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import {
  sealRequestServiceToken,
  SEAL_KIND,
} from '../../../server/providers/seals/contract.js';
import { vehicleRequestServiceToken } from '../../../server/providers/vehicles/index.js';
import {
  dictionaryServiceToken,
  calendarServiceToken,
} from '../../../server/providers/platform/index.js';
import { headcountServiceToken } from '../../../server/providers/headcounts/contract.js';
import { salaryGradeServiceToken } from '../../../server/providers/job-grades/contract.js';
import { apiDocsToken } from '@nocobase/app-server/router';

const full = { read: true, create: true, update: true, delete: false };
const access = { requests: full, view: full, contracts: full };

test('main center shows real seal approvals and keeper handling, applies current scopes and fields before totals', async ({
  testApp,
  request,
}) => {
  const c = testApp.application.container,
    org = c.resolve(organizationServiceToken),
    service = c.resolve(sealRequestServiceToken);
  const owner = await createEmployee(testApp, 'Seal center owner'),
    head = await createEmployee(testApp, 'Seal center head'),
    keeper = await createEmployee(testApp, 'Seal center keeper'),
    outsider = await createEmployee(testApp, 'Seal center outsider');
  const ctx = { actorId: head.userId };
  const department = await org.createDepartment(
    { title: 'Seal center department', managerId: head.userId },
    ctx,
  );
  await org.addMember(
    { departmentId: department.id, userId: owner.userId, primary: true },
    ctx,
  );
  await org.addDutyRoleMember('sealKeeper', keeper.userId, ctx);
  const os = await owner.session(),
    hs = await head.session(),
    ks = await keeper.session(),
    xs = await outsider.session();
  const created = await os.fetch(
    '/sealRequests',
    write('POST', {
      contractId: null,
      fileIds: [],
      sealType: 'official',
      copies: 1,
      external: false,
      returnDueAt: null,
      purpose: 'Private center purpose',
      contact: 'Private center contact',
      requestKey: randomUUID(),
    }),
  );
  expect(created.status).toBe(200);
  const record = (await created.json()).data;
  const url = '/approvalCenter?kind=oa.sealRequest';
  expect((await request(url)).status).toBe(401);
  const mine = await (await os.fetch(url + '&view=mine&pageSize=1')).json();
  expect(mine.meta).toMatchObject({
    total: 1,
    counts: { drafts: 1, inProgress: 0 },
  });
  expect(mine.data[0]).toMatchObject({
    id: record.id,
    kind: 'oa.sealRequest',
    applicant: { id: owner.userId, name: 'Seal center owner' },
    amount: null,
    unit: null,
  });
  expect(mine.data[0]).not.toHaveProperty('purpose');
  expect(mine.data[0]).not.toHaveProperty('contact');
  expect((await (await xs.fetch(url + '&view=mine')).json()).meta.total).toBe(
    0,
  );
  const uploaded = await service.upload(
    owner.userId,
    record.id,
    new File(['%PDF-1.4\ncenter fixture'], 'source.pdf', {
      type: 'application/pdf',
    }),
    randomUUID(),
    full,
  );
  const edited = await service.change(
    record.id,
    owner.userId,
    'edit',
    {
      contractId: null,
      fileIds: [uploaded.id],
      sealType: 'official',
      copies: 1,
      external: false,
      returnDueAt: null,
      purpose: 'Private center purpose',
      contact: 'Private center contact',
    },
    randomUUID(),
    record.lifecycleVersion,
    access,
  );
  await service.change(
    record.id,
    owner.userId,
    'submit',
    {},
    randomUUID(),
    edited.lifecycleVersion,
    access,
  );
  expect(
    (await (await hs.fetch(url + '&view=pending')).json()).meta.total,
  ).toBe(1);
  expect(
    (await (await os.fetch(url + '&view=pending')).json()).meta.total,
  ).toBe(0);
  expect(
    (await (await os.fetch(url + '&view=mine')).json()).meta.counts.inProgress,
  ).toBe(1);
  const offer = (
    await service.approvals.actionsFor(SEAL_KIND, record.id, {
      id: head.userId,
    })
  ).find((offer) => offer.actions.some((action) => action.name === 'approve'))!;
  const run = (await service.approvals.runViewsFor(SEAL_KIND, record.id)).find(
    (run) => run.tasks.some((task) => task.id === offer.task.id),
  )!;
  await service.perform(
    record.id,
    head.userId,
    {
      action: 'approve',
      target: { taskId: offer.task.id },
      contentHash: run.run.contentHash,
      requestId: randomUUID(),
    },
    access,
  );
  expect((await (await hs.fetch(url + '&view=done')).json()).meta.total).toBe(
    1,
  );
  const pending = await (await ks.fetch(url + '&view=pending')).json();
  expect(pending.meta.total).toBe(1);
  expect(pending.data[0].status).toBe('stamping');
  expect((await (await ks.fetch(url + '&view=copied')).json()).meta.total).toBe(
    0,
  );
  const authz = c.resolve(authorizationToken),
    original = authz.for.bind(authz);
  const spy = vi.spyOn(authz, 'for').mockImplementation((actor) => {
    const actorAuthz = original(actor),
      authorize = actorAuthz.authorize.bind(actorAuthz);
    return {
      ...actorAuthz,
      authorize: async (input) => {
        const decision = await authorize(input);
        if (
          input.resource.type === 'composite' &&
          input.resource.id === 'oa.sealRequests' &&
          input.action === 'view'
        )
          return {
            ...decision,
            conditions: {
              ...decision.conditions,
              database: {
                sealRequests: {
                  read: { scope: true, fields: ['id'] },
                  create: false,
                  update: false,
                  delete: false,
                },
              },
            },
          };
        return decision;
      },
    };
  });
  try {
    const denied = await os.fetch(url + '&view=mine');
    expect({ status: denied.status, body: await denied.json() }).toMatchObject({
      status: 403,
    });
  } finally {
    spy.mockRestore();
  }
  const document = await c.resolve(apiDocsToken).getDocument();
  expect(JSON.stringify(document.paths?.['/api/approvalCenter'])).toContain(
    'oa.sealRequest',
  );
});

test('main center uses vehicle approval and dispatch offers and never projects private usage cost', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    org = c.resolve(organizationServiceToken),
    service = c.resolve(vehicleRequestServiceToken);
  const owner = await createEmployee(testApp, 'Vehicle center owner'),
    head = await createEmployee(testApp, 'Vehicle center head'),
    admin = await createEmployee(testApp, 'Vehicle center dispatcher');
  const ctx = { actorId: head.userId },
    department = await org.createDepartment(
      { title: 'Vehicle center department', managerId: head.userId },
      ctx,
    );
  await org.addMember(
    { departmentId: department.id, userId: owner.userId, primary: true },
    ctx,
  );
  await org.addDutyRoleMember('admin', admin.userId, ctx);
  const vehicleType = (
    await c.resolve(dictionaryServiceToken).list('vehicleType')
  )[0]!.code;
  const vehicle = await db.transaction((tx) =>
    service.vehicles.create(
      {
        plateNumber: randomUUID(),
        name: 'Center vehicle',
        vehicleType,
        capacity: 4,
        status: 'active',
        actorId: admin.userId,
        reason: 'Center dispatch fixture',
      },
      tx,
    ),
  );
  const draft = await service.create(
    {
      purpose: 'Private vehicle purpose',
      destination: 'Private destination',
      startAt: '2027-01-06T01:00:00Z',
      endAt: '2027-01-06T02:00:00Z',
      passengers: 1,
      needsDriver: false,
    },
    owner.userId,
  );
  const id = String(draft.record.id),
    os = await owner.session(),
    hs = await head.session(),
    ads = await admin.session();
  const url = '/approvalCenter?kind=oa.vehicleRequest';
  const mine = await (await os.fetch(url + '&view=mine')).json();
  expect(mine.meta).toMatchObject({ total: 1, counts: { drafts: 1 } });
  expect(mine.data[0]).toMatchObject({
    id,
    applicant: { id: owner.userId, name: 'Vehicle center owner' },
    title: 'Private vehicle purpose',
    startDate: '2027-01-06T01:00:00.000Z',
    amount: null,
    unit: null,
  });
  expect(mine.data[0]).not.toHaveProperty('fuelCents');
  expect(mine.data[0]).not.toHaveProperty('ruleSnapshot');
  await service.transition(
    id,
    'submit',
    owner.userId,
    Number(draft.record.lifecycleVersion),
    randomUUID(),
  );
  expect(
    (await (await hs.fetch(url + '&view=pending')).json()).meta.total,
  ).toBe(1);
  const detail = await service.detail(id, head.userId),
    offer = detail.taskActions.find((offer) =>
      offer.actions.some((action) => action.name === 'approve'),
    )!,
    run = detail.runs.find((run) =>
      run.tasks.some((task) => task.id === offer.task.id),
    )!;
  await service.action(
    id,
    {
      action: 'approve',
      target: { taskId: offer.task.id },
      contentHash: run.run.contentHash,
      requestId: randomUUID(),
    },
    head.userId,
  );
  expect((await (await hs.fetch(url + '&view=done')).json()).meta.total).toBe(
    1,
  );
  const dispatch = await (await ads.fetch(url + '&view=pending')).json();
  expect(dispatch.meta.total).toBe(1);
  expect(dispatch.data[0].status).toBe('dispatch');
  for (const name of ['claim', 'complete']) {
    const current = await service.detail(id, admin.userId),
      offered = current.taskActions.find((offer) =>
        offer.actions.some((action) => action.name === name),
      )!,
      run = current.runs.find((run) =>
        run.tasks.some((task) => task.id === offered.task.id),
      )!;
    await service.action(
      id,
      {
        action: name,
        target: { taskId: offered.task.id },
        contentHash: run.run.contentHash,
        requestId: randomUUID(),
      },
      admin.userId,
      name === 'complete' ? { vehicleId: vehicle.id, driverId: null } : {},
    );
  }
  const usage = await (await os.fetch(url + '&view=pending')).json();
  expect(usage.meta.total).toBe(1);
  expect(usage.data[0]).toMatchObject({
    status: 'usage',
    amount: null,
    unit: null,
  });

  expect(
    (await (await os.fetch(url + '&view=mine')).json()).meta.counts.inProgress,
  ).toBe(1);
  const authz = c.resolve(authorizationToken),
    original = authz.for.bind(authz);
  const spy = vi.spyOn(authz, 'for').mockImplementation((actor) => {
    const current = original(actor),
      authorize = current.authorize.bind(current);
    return {
      ...current,
      authorize: async (input) => {
        const decision = await authorize(input);
        if (
          input.resource.type === 'composite' &&
          input.resource.id === 'oa.vehicleRequests' &&
          input.action === 'view'
        )
          return {
            ...decision,
            conditions: {
              ...decision.conditions,
              database: {
                vehicleRequests: {
                  read: { scope: true, fields: ['id'] },
                  create: false,
                  update: false,
                  delete: false,
                },
              },
            },
          };
        return decision;
      },
    };
  });
  try {
    const denied = await os.fetch(url + '&view=mine');
    expect({ status: denied.status, body: await denied.json() }).toMatchObject({
      status: 403,
    });
  } finally {
    spy.mockRestore();
  }
});

test('main center recruitment draft and real HRBP pending share safe totals and never expose salary revisions', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    org = c.resolve(organizationServiceToken);
  const owner = await createEmployee(testApp, 'Recruitment center head'),
    hrbp = await createEmployee(testApp, 'Recruitment center HRBP'),
    director = await createEmployee(testApp, 'Recruitment center director'),
    gm = await createEmployee(testApp, 'Recruitment center GM');
  const ctx = { actorId: owner.userId };
  for (const [role, actor] of [
    ['hrbp', hrbp],
    ['hrDirector', director],
    ['gm', gm],
  ] as const)
    await org.addDutyRoleMember(role, actor.userId, ctx);
  const department = await org.createDepartment(
      {
        title: 'Recruitment center department',
        managerId: owner.userId,
        executiveId: gm.userId,
      },
      ctx,
    ),
    position = await org.createPosition(
      { code: randomUUID(), title: 'Center engineer' },
      ctx,
    ),
    grade = await org.createGrade(
      { code: randomUUID(), title: 'Center grade', rank: 1 },
      ctx,
    );
  const year = Number(
      c.resolve(calendarServiceToken).localDate(new Date()).slice(0, 4),
    ),
    command = () => ({
      ...ctx,
      requestKey: randomUUID(),
      reason: 'Center setup',
    });
  const account = await db.transaction(async (tx) => {
    const service = c.resolve(headcountServiceToken),
      created = await service.create(
        {
          ...command(),
          departmentId: department.id,
          positionId: position.id,
          year,
          limit: 2,
        },
        tx,
      );
    return service.reconcile(
      {
        ...command(),
        accountId: created.id,
        expectedVersion: created.version,
        employeeIds: [],
      },
      tx,
    );
  });
  const salary = c.resolve(salaryGradeServiceToken),
    current = await db.transaction((tx) => salary.current(tx));
  await db.transaction((tx) =>
    salary.publish(
      {
        ...command(),
        expectedVersion: current.version,
        bands: [
          ...(current.revision?.bands ?? []),
          { gradeId: grade.id, minimumCents: 10000, maximumCents: 20000 },
        ],
      },
      tx,
    ),
  );
  const os = await owner.session(),
    hs = await hrbp.session();
  const created = await os.fetch(
    '/recruitmentRequests',
    write('POST', {
      proposal: {
        departmentId: department.id,
        positionId: position.id,
        gradeId: grade.id,
        accountId: account.id,
        year,
        quantity: 1,
        kind: 'additional',
        replacementEmployeeIds: [],
        minimumCents: 12000,
        maximumCents: 18000,
        expectedStartDate: '2027-02-01',
        jobDescription: 'Private job description',
        reason: 'Center demand',
      },
      requestKey: randomUUID(),
      reason: 'Center create',
    }),
  );
  expect(created.status).toBe(200);
  const record = (await created.json()).data.record;
  const url = '/approvalCenter?kind=oa.recruitment';
  const mine = await (await os.fetch(url + '&view=mine')).json();
  expect(mine.meta).toMatchObject({ total: 1, counts: { drafts: 1 } });
  expect(mine.data[0]).toMatchObject({
    id: record.id,
    amount: null,
    unit: null,
    endDate: '2027-02-01',
  });
  for (const key of [
    'minimumCents',
    'maximumCents',
    'privateSalaryRevisionId',
    'snapshot',
    'jobDescription',
  ])
    expect(mine.data[0]).not.toHaveProperty(key);
  const submitted = await os.fetch(
    `/recruitmentRequests/${record.id}/transitions`,
    write('POST', {
      version: record.lifecycleVersion,
      transition: 'submit',
      reason: 'Center submit',
      requestKey: randomUUID(),
    }),
  );
  expect(submitted.status).toBe(200);
  const pending = await (
    await hs.fetch(url + '&view=pending&pageSize=1')
  ).json();
  expect(pending.meta).toMatchObject({ total: 1, kinds: ['oa.recruitment'] });
  expect(pending.data[0]).toMatchObject({
    id: record.id,
    status: 'hrbp',
    amount: null,
  });
  expect(
    (await (await os.fetch(url + '&view=mine')).json()).meta.counts.inProgress,
  ).toBe(1);
  const authz = c.resolve(authorizationToken),
    originalFor = authz.for.bind(authz);
  const fields = ['id', 'applicantId', 'status', 'createdAt'];
  const fieldSpy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const current = originalFor(identity),
      authorize = current.authorize.bind(current);
    return {
      ...current,
      authorize: async (input) => {
        const decision = await authorize(input);
        if (
          input.resource.type === 'composite' &&
          input.resource.id === 'oa.recruitment' &&
          input.action === 'view'
        )
          return {
            ...decision,
            conditions: {
              ...decision.conditions,
              database: {
                recruitmentRequests: {
                  read: { scope: true, fields },
                  create: false,
                  update: false,
                  delete: false,
                },
              },
            },
          };
        return decision;
      },
    };
  });
  try {
    // Identity and sorting are readable, but the real summary date is missing.
    expect((await os.fetch(url + '&view=mine')).status).toBe(403);
    // Optional reason/updatedAt denial must omit summary fields, not hide an otherwise readable record.
    fields.push('expectedStartDate');
    const restrictedSummary = await os.fetch(url + '&view=mine');
    expect(restrictedSummary.status).toBe(200);
    const restrictedRows = (await restrictedSummary.json()).data;
    expect(restrictedRows).toHaveLength(1);
    expect(restrictedRows[0]).not.toHaveProperty('title');
    expect(restrictedRows[0]).not.toHaveProperty('updatedAt');
  } finally {
    fieldSpy.mockRestore();
  }
  const sets = c.resolve(authorizationToken).permissionSets,
    initial = (await sets.get('oa-recruitment-employee'))!;
  try {
    await sets.update(initial.key, {
      ...initial,
      grants: initial.grants.map((grant) =>
        grant.resource.type === 'composite' &&
        grant.resource.id === 'oa.recruitment'
          ? {
              ...grant,
              actions: grant.actions.filter(
                (action) => action.action !== 'view',
              ),
            }
          : grant,
      ),
    });
    const denied = await os.fetch(url + '&view=mine');
    expect({ status: denied.status, body: await denied.json() }).toMatchObject({
      status: 403,
    });
  } finally {
    await sets.update(initial.key, initial);
  }
});
