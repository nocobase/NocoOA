// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { vendorServiceToken } from '../../../server/providers/vendors/contract.js';
import {
  createPlatformAppTest,
  createUser,
  write,
  ORIGIN,
} from '../platform/helpers.js';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';
import { composite, grantToUser } from '../employees/helpers.js';
const test = createPlatformAppTest();
test('HTTP private banks and real File Repository evidence enforce owner, bank policy and ordinary view independently', async ({
  app,
  testApp,
}) => {
  const c = app.container,
    authz = c.resolve(authorizationToken),
    db = c.resolve(databaseManagerToken),
    owner = await createUser(testApp, 'Qualification owner'),
    outsider = await createUser(testApp, 'Qualification outsider');
  await db.repository('employees').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      userId: owner.user.id,
      name: 'Qualification owner',
      status: 'regular',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const org = c.resolve(organizationServiceToken),
    department = await org.createDepartment(
      { title: 'Owner department' },
      { actorId: owner.user.id },
    );
  await org.addMember(
    { departmentId: department.id, userId: owner.user.id, primary: true },
    { actorId: owner.user.id },
  );
  await grantToUser(
    testApp,
    randomUUID(),
    [
      composite('oa.vendorQualification', {
        submit: { vendorQualifications: 'allRecords' },
        view: { vendorQualifications: 'allRecords' },
        paymentAccount: { vendorQualifications: 'oa.vendorQualificationOwned' },
        updatePaymentAccount: {
          vendorQualifications: 'oa.vendorQualificationOwned',
        },
      }),
    ],
    owner.user.id,
  );
  await grantToUser(
    testApp,
    randomUUID(),
    [
      composite('oa.vendorQualification', {
        submit: { vendorQualifications: 'allRecords' },
        view: { vendorQualifications: 'allRecords' },
        paymentAccount: { vendorQualifications: 'allRecords' },
      }),
    ],
    outsider.user.id,
  );
  const vendors = c.resolve(vendorServiceToken),
    vendor = await db.transaction((tx) =>
      vendors.create(
        {
          code: randomUUID(),
          name: 'Supplier',
          category: 'service',
          contactName: '',
          contactPhone: '',
          contactEmail: '',
          bankName: 'Source secret bank',
          bankAccount: 'SOURCE-SECRET',
          bankAccountName: 'Source account',
          actorId: owner.user.id,
          reason: 'Source',
        },
        tx,
      ),
    );
  const input = {
      operation: 'qualify',
      vendorId: vendor.id,
      name: 'Supplier',
      category: 'service',
      reason: 'Qualification',
      quoteCents: 100,
      cases: '',
      contactName: '',
      contactPhone: '',
      contactEmail: '',
      attachments: [],
      qualificationExpiry: '2028-01-01',
    },
    requestId = randomUUID();
  const create = await owner.fetch(
    '/vendorQualifications',
    write('POST', { requestId, input }),
  );
  expect(create.status).toBe(200);
  const created = (await create.json()) as {
      data: { record: { id: string; lifecycleVersion: number } };
    },
    record = created.data.record;
  const centerPath = '/approvalCenter?view=mine&kind=oa.vendorQualification';
  const ownCenter = await owner.fetch(centerPath);
  expect(ownCenter.status).toBe(200);
  const center = (await ownCenter.json()) as {
    data: Record<string, unknown>[];
    meta: { total: number; kinds: string[] };
  };
  expect(center.meta.total).toBe(1);
  expect(center.meta.kinds).toEqual(['oa.vendorQualification']);
  expect(center.data[0]).toMatchObject({
    id: record.id,
    applicant: { id: owner.user.id, name: 'Qualification owner' },
    amount: null,
    unit: null,
    endDate: '2028-01-01',
  });
  expect(center.data[0]).not.toHaveProperty('quoteCents');
  expect(center.data[0]).not.toHaveProperty('reason');
  expect(JSON.stringify(center)).not.toContain('SOURCE-SECRET');
  const outsiderCenter = await outsider.fetch(centerPath);
  expect(outsiderCenter.status).toBe(200);
  expect(((await outsiderCenter.json()) as { data: unknown[] }).data).toEqual(
    [],
  );
  const pendingCenter = await owner.fetch(
    '/approvalCenter?view=pending&kind=oa.vendorQualification',
  );
  expect(((await pendingCenter.json()) as { data: unknown[] }).data).toEqual(
    [],
  );
  const replay = await owner.fetch(
    '/vendorQualifications',
    write('POST', { requestId, input }),
  );
  expect(replay.status).toBe(200);
  expect(((await replay.json()) as typeof created).data.record.id).toBe(
    record.id,
  );
  expect(
    (
      await owner.fetch(
        '/vendorQualifications',
        write('POST', { requestId, input: { ...input, reason: 'Changed' } }),
      )
    ).status,
  ).toBe(409);
  const concurrentKey = randomUUID();
  const parallel = await Promise.all(
    [1, 2].map(() =>
      owner.fetch(
        '/vendorQualifications',
        write('POST', { requestId: concurrentKey, input }),
      ),
    ),
  );
  expect(parallel.map((response) => response.status)).toEqual([200, 200]);
  const parallelRecords = await Promise.all(
    parallel.map((response) => response.json() as Promise<typeof created>),
  );
  expect(parallelRecords[0].data.record.id).toBe(
    parallelRecords[1].data.record.id,
  );
  expect(
    await db
      .repository('vendorQualificationCreationCommands')
      .count({ filter: { actorId: owner.user.id, requestKey: concurrentKey } }),
  ).toBe(1);
  const update = {
    lifecycleVersion: record.lifecycleVersion,
    bankVersion: 1,
    reason: 'Add protected account',
    account: {
      bankName: 'Private bank',
      bankAccount: 'HTTP-PRIVATE-SECRET',
      bankAccountName: 'Account owner',
    },
  };
  expect(
    (
      await owner.fetch(
        `/vendorQualifications/${record.id}/paymentAccount`,
        write('PATCH', update),
      )
    ).status,
  ).toBe(200);
  const publicDetail = await owner.fetch(`/vendorQualifications/${record.id}`);
  expect(publicDetail.status).toBe(200);
  const detailBody = (await publicDetail.json()) as {
    data: {
      timeline: { runs: unknown[] };
      upcoming: unknown[];
      timeZone: string;
    };
  };
  expect(JSON.stringify(detailBody)).not.toContain('HTTP-PRIVATE-SECRET');
  expect(detailBody.data.timeline.runs).toEqual(expect.any(Array));
  expect(detailBody.data.upcoming).toEqual(expect.any(Array));
  expect(detailBody.data.timeZone).toEqual(expect.any(String));
  // A user with broad view/submit grants but no employee archive can open the list.
  const viewerOptions = await outsider.fetch('/vendorQualifications/options');
  expect(viewerOptions.status).toBe(200);
  expect((await viewerOptions.json()).data).toMatchObject({
    applicant: { id: outsider.user.id },
    canCreateQualification: false,
    canCreateRemoval: false,
  });
  const viewerCreate = await outsider.fetch(
    '/vendorQualifications',
    write('POST', {
      requestId: randomUUID(),
      input,
    }),
  );
  expect(viewerCreate.status).toBe(400);
  expect(JSON.stringify(await viewerCreate.json())).toContain(
    'EMPLOYEE_REQUIRED',
  );
  const viewerList = await outsider.fetch('/vendorQualifications?view=mine');
  expect(viewerList.status).toBe(200);
  const optionResponse = await owner.fetch('/vendorQualifications/options');
  expect(optionResponse.status).toBe(200);
  const optionBody = (await optionResponse.json()) as {
    data: {
      canCreateQualification: boolean;
      canCreateRemoval: boolean;
      vendors: { id: string; eligibleOperations: string[] }[];
    };
  };
  expect(optionBody.data.canCreateQualification).toBe(true);
  expect(optionBody.data.canCreateRemoval).toBe(false);
  expect(
    optionBody.data.vendors.find((v) => v.id === vendor.id)?.eligibleOperations,
  ).toEqual(['qualify']);
  expect(
    (
      await owner.fetch(
        '/vendorQualifications/configuration/candidates?source=purchasing',
      )
    ).status,
  ).toBe(403);
  expect(
    (await outsider.fetch(`/vendorQualifications/${record.id}/paymentAccount`))
      .status,
  ).toBe(403);
  const account = await owner.fetch(
    `/vendorQualifications/${record.id}/paymentAccount`,
  );
  expect(account.status).toBe(200);
  expect(await account.text()).toContain('HTTP-PRIVATE-SECRET');
  const originalFor = authz.for.bind(authz),
    excluded = randomUUID();
  const spy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = originalFor(identity);
    return {
      ...context,
      authorize: async (check) => {
        const decision = await context.authorize(check);
        if (
          check.resource.type === 'composite' &&
          check.resource.id === 'oa.vendorQualification' &&
          check.action === 'view' &&
          decision.conditions?.database?.vendorQualifications
        ) {
          return {
            ...decision,
            conditions: {
              ...decision.conditions,
              database: {
                ...decision.conditions.database,
                vendorQualifications: {
                  ...decision.conditions.database.vendorQualifications,
                  read: {
                    scope: {
                      kind: 'filter',
                      version: 1,
                      root: {
                        kind: 'condition',
                        path: ['id'],
                        operator: '$eq',
                        value: excluded,
                      },
                    },
                  },
                },
              },
            },
          };
        }
        return decision;
      },
    };
  });
  try {
    expect(
      (await owner.fetch(`/vendorQualifications/${record.id}/paymentAccount`))
        .status,
    ).toBe(403);
    expect(
      (
        await owner.fetch(
          `/vendorQualifications/${record.id}/paymentAccount`,
          write('PATCH', { ...update, bankVersion: 2 }),
        )
      ).status,
    ).toBe(403);
  } finally {
    spy.mockRestore();
  }
  const publicList = await outsider.fetch('/vendorQualifications?view=mine');
  expect(publicList.status).toBe(200);
  expect((await publicList.json()).meta.timeZone).toBe(
    c.resolve(calendarServiceToken).timeZone(),
  );
  async function upload(file: File) {
    const body = new FormData();
    body.append('file', file);
    return owner.fetch('/vendorQualificationAttachments/uploadOne', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-vendor-qualification-id': record.id },
      body,
    });
  }
  expect(
    (
      await upload(
        new File(['fake'], 'invalid.pdf', { type: 'application/pdf' }),
      )
    ).status,
  ).toBe(400);
  const uploaded = await upload(
    new File(['%PDF-1.7\nreal-test-evidence\n%%EOF'], 'proof.pdf', {
      type: 'application/pdf',
    }),
  );
  expect(uploaded.status).toBe(201);
  const file = (
    (await uploaded.json()) as {
      data: { record: { id: string; contentUrl: string } };
    }
  ).data.record;
  // A broad record viewer is still not permitted to see unselected draft evidence.
  expect(
    (await outsider.fetch(new URL(file.contentUrl, ORIGIN).href)).status,
  ).toBe(403);
  expect(
    (await owner.fetch(new URL(file.contentUrl, ORIGIN).href)).status,
  ).toBe(200);
  expect(
    (await testApp.fetch(new Request(new URL(file.contentUrl, ORIGIN)))).status,
  ).toBe(401);
  const schedules = await c.resolve(schedulerServiceToken).list();
  const schedule = schedules.find(
    (row) => row.key === 'oa.vendor-qualification.expiry',
  );
  expect([
    'Supplier qualification expiry reminders',
    '供应商资质到期提醒',
  ]).toContain(schedule?.title);
  expect(schedule?.title).not.toBe('vendorQualifications.schedule.title');
});
