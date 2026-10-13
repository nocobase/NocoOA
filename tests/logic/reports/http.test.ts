// @vitest-environment node
import { randomUUID } from 'node:crypto';

import ExcelJS from 'exceljs';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { PermissionGrant } from '@nocobase/authorization/core';
import { databaseManagerToken } from '@nocobase/db';
import { expect } from 'vitest';

import { contractHttpServiceToken } from '../../../server/providers/contracts/service.js';
import { calendarServiceToken } from '../../../server/providers/platform/index.js';
import { budgetServiceToken } from '../../../server/providers/budgets/index.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { createPlatformAppTest, createUser } from '../platform/helpers.js';
import { grantToUser } from '../employees/helpers.js';

const test = createPlatformAppTest();

async function workbook(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  const value = await response.arrayBuffer();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(value);
  return book;
}

function headers(book: ExcelJS.Workbook) {
  return book.worksheets[0].getRow(1).values.slice(1);
}

test('A5 reports recheck source grants, retain policy scope and export only whitelisted columns', async ({
  app,
  testApp,
  request,
}) => {
  const c = app.container,
    db = c.resolve(databaseManagerToken),
    authz = c.resolve(authorizationToken),
    reader = await createUser(testApp, 'A5 report reader'),
    outsider = await createUser(testApp, 'A5 report outsider'),
    department = await c
      .resolve(organizationServiceToken)
      .createDepartment({ title: 'A5 Finance' }, { actorId: reader.user.id });

  await db.transaction((tx) =>
    c.resolve(budgetServiceToken).allocate(
      {
        departmentId: department.id,
        subject: 'travel',
        year: 2026,
        deltaCents: 12345,
        actorId: reader.user.id,
        reason: 'A5 report fixture',
        reference: 'report-test',
        requestKey: randomUUID(),
      },
      tx,
    ),
  );
  const accountId = randomUUID();
  await db.repository('headcountAccounts').createOne({
    values: {
      id: accountId,
      departmentId: department.id,
      positionId: randomUUID(),
      year: 2026,
      limit: 4,
      initialized: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const contractId = randomUUID(),
    now = new Date();
  await db.repository('contracts').createOne({
    values: {
      id: contractId,
      number: 'A5-OTHER-001',
      requestId: contractId,
      applicantId: outsider.user.id,
      departmentId: department.id,
      status: 'active',
      version: 1,
      lockVersion: 0,
      amountCents: 50000,
      facts: {
        contractType: 'purchase',
        counterparty: { kind: 'customer', name: 'A5 customer' },
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        paymentTerms: 'Net 30',
        standardTemplate: true,
        textVersionId: randomUUID(),
        attachments: [],
      },
      createdAt: now,
      updatedAt: now,
    },
  });

  await db.repository('contractVersions').createOne({
    values: {
      id: randomUUID(),
      contractId,
      version: 1,
      requestId: contractId,
      facts: {
        contractType: 'purchase',
        counterparty: { kind: 'customer', name: 'A5 customer' },
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        paymentTerms: 'Net 30',
        standardTemplate: true,
        textVersionId: randomUUID(),
        attachments: [],
      },
      amountCents: 50000,
      status: 'active',
      actorId: outsider.user.id,
      reason: 'Synthetic report version',
      at: now,
    },
  });
  await db.repository('contractRequests').createOne({
    values: {
      id: contractId,
      creatorId: outsider.user.id,
      applicantId: outsider.user.id,
      departmentId: department.id,
      number: null,
      operation: 'new',
      contractId,
      baseVersion: 0,
      contractType: 'purchase',
      counterparty: { kind: 'customer', name: 'A5 customer' },
      amountCents: 50000,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      paymentTerms: 'Net 30',
      standardTemplate: true,
      textVersionId: null,
      attachments: [],
      reason: 'Synthetic report fixture',
      ruleSnapshot: {},
      nonStandard: null,
      status: 'approved',
      lifecycleVersion: 0,
      statusChangedAt: now,
      createdAt: now,
      submittedAt: now,
    },
  });
  for (const path of [
    '/reports/budget-balances',
    '/reports/contract-ledger',
    '/reports/headcount-balances',
  ])
    expect((await request(path)).status).toBe(401);
  expect((await outsider.fetch('/reports/budget-balances')).status).toBe(403);
  expect(
    (await (await outsider.fetch('/reports/datasets')).json()).data,
  ).not.toContain('budget-balances');
  expect((await outsider.fetch('/reports/headcount-balances')).status).toBe(
    403,
  );
  const owned = await (await outsider.fetch('/reports/contract-ledger')).json();
  expect(owned.data.map((row: { id: string }) => row.id)).toEqual([contractId]);

  const key = `a5-report-${randomUUID()}`;
  const grants: PermissionGrant[] = [
    authz.settings.grant('oa.budgets', ['read']),
    {
      resource: { type: 'composite', id: 'oa.contract' },
      actions: [
        {
          action: 'view',
          policy: {
            type: 'composite',
            scopes: { contractRequests: 'allRecords' },
          },
        },
        {
          action: 'ledger',
          policy: {
            type: 'composite',
            scopes: {
              contracts: 'allRecords',
              contractVersions: 'allRecords',
            },
          },
        },
      ],
    },
    {
      resource: { type: 'composite', id: 'oa.headcounts' },
      actions: [
        {
          action: 'view',
          policy: {
            type: 'composite',
            scopes: { headcountAccounts: 'allRecords' },
          },
        },
      ],
    },
  ];
  await grantToUser(testApp, key, grants, reader.user.id);

  const capabilities = await reader.fetch('/reports/datasets');
  expect(capabilities.headers.get('cache-control')).toBe('no-store');
  expect((await capabilities.json()).data).toEqual(
    expect.arrayContaining([
      'budget-balances',
      'headcount-balances',
      'contract-ledger',
    ]),
  );
  expect((await reader.fetch('/reports/budget-balances')).status).toBe(200);
  expect((await reader.fetch('/reports/budget-balances.xlsx')).status).toBe(
    200,
  );

  const budgetResponse = await reader.fetch(
    `/reports/budget-balances?departmentId=${department.id}&year=2026`,
  );
  expect(budgetResponse.status).toBe(200);
  const budget = await budgetResponse.json();
  expect(budget.data).toEqual([
    {
      id: expect.any(String),
      departmentId: department.id,
      year: 2026,
      subject: 'travel',
      departmentName: 'A5 Finance',
      subjectLabel: expect.objectContaining({
        'en-US': expect.any(String),
        'zh-CN': expect.any(String),
      }),
      allocatedCents: 12345,
      heldCents: 0,
      usedCents: 0,
      availableCents: 12345,
    },
  ]);
  expect(budget.meta).toMatchObject({
    page: 1,
    pageSize: 20,
    total: 1,
    filters: { departmentId: department.id, year: 2026 },
  });
  expect(Date.parse(budget.meta.generatedAt)).not.toBeNaN();

  const headcountResponse = await reader.fetch(
    `/reports/headcount-balances?departmentId=${department.id}&year=2026`,
  );
  expect(headcountResponse.status).toBe(200);
  const headcount = await headcountResponse.json();
  expect(headcount.data).toEqual([
    expect.objectContaining({
      id: accountId,
      departmentId: department.id,
      year: 2026,
      limit: 4,
      initialized: true,
      used: 0,
      pending: 0,
      allocated: 0,
      replacementPending: 0,
      replacementAllocated: 0,
      replacementBlocked: 0,
      available: 4,
    }),
  ]);
  const contracts = await (
    await reader.fetch('/reports/contract-ledger?status=active')
  ).json();
  expect(contracts).toMatchObject({
    data: [
      {
        id: contractId,
        number: 'A5-OTHER-001',
        departmentId: department.id,
        status: 'active',
        amountCents: 50000,
        heldCents: 0,
        paidCents: 0,
        availableCents: 50000,
      },
    ],
    meta: { total: 1, filters: { status: 'active' } },
  });

  expect(
    headers(
      await workbook(
        await reader.fetch(
          `/reports/budget-balances.xlsx?departmentId=${department.id}&year=2026`,
        ),
      ),
    ),
  ).toEqual([
    'Department',
    'Year',
    'Subject',
    'Allocated cents',
    'Held cents',
    'Used cents',
    'Available cents',
  ]);
  expect(
    headers(
      await workbook(await reader.fetch('/reports/headcount-balances.xlsx')),
    ),
  ).toEqual([
    'Department',
    'Position',
    'Year',
    'Limit',
    'Initialized',
    'Used',
    'Pending',
    'Allocated',
    'Replacement pending',
    'Replacement allocated',
    'Replacement blocked',
    'Available',
    'Capacity state',
  ]);
  expect(
    headers(
      await workbook(await reader.fetch('/reports/contract-ledger.xlsx')),
    ),
  ).toEqual([
    'Number',
    'Department',
    'Status',
    'Amount cents',
    'Held cents',
    'Paid cents',
    'Available cents',
    'Starts on',
    'Ends on',
    'As of',
    'Expiry state',
    'Payment state',
    'Paid basis points',
  ]);

  const reports = c.resolve(contractHttpServiceToken);
  const unrestricted = {
    read: true,
    create: false,
    update: false,
    delete: false,
  };
  const q = { page: 1, pageSize: 1 };
  const projection = await reports.reportList(
    q,
    unrestricted,
    unrestricted,
    unrestricted,
  );
  expect(projection.data[0]).toMatchObject({
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    asOf: c.resolve(calendarServiceToken).localDate(new Date()),
    paymentState: 'unpaid',
    paidBasisPoints: 0,
  });
  expect(JSON.stringify(projection)).not.toMatch(
    /facts|textVersionId|applicantId|counterparty|bank|salary/,
  );
  expect(
    await reports.reportList(q, unrestricted, unrestricted, {
      ...unrestricted,
      read: {
        scope: { id: 'missing-request' },
        fields: ['id', 'startsOn', 'endsOn', 'amountCents'],
      },
    }),
  ).toMatchObject({ data: [], meta: { total: 0 } });
  const hiddenId = randomUUID();
  const currentSource = await db
    .repository('contracts')
    .findOne({ filter: { id: contractId } });
  await db.repository('contracts').createOne({
    values: {
      ...currentSource,
      id: hiddenId,
      requestId: randomUUID(),
      number: 'HIDDEN-NEWER',
      updatedAt: new Date(now.getTime() + 1000),
    },
  });
  const intersected = await reports.reportList(
    q,
    unrestricted,
    unrestricted,
    unrestricted,
  );
  expect(intersected).toMatchObject({
    data: [{ id: contractId }],
    meta: { total: 1, page: 1, pageSize: 1 },
  });
  await db.repository('contracts').deleteOne({ filter: { id: hiddenId } });
  for (const restricted of [
    { ...unrestricted, read: false },
    { ...unrestricted, read: { scope: true, fields: ['id'] } },
  ]) {
    await expect(
      reports.reportList(
        q,
        unrestricted,
        restricted.read === false
          ? restricted
          : {
              ...restricted,
              read: { scope: true, fields: ['id', 'contractId', 'version'] },
            },
        unrestricted,
      ),
    ).rejects.toThrow(
      /outside the read policy|denied|not permitted|forbidden by Policy/i,
    );
    if (restricted.read !== false)
      await expect(
        reports.reportList(q, unrestricted, unrestricted, restricted),
      ).rejects.toThrow(/outside the ordinary view policy/);
    else
      await expect(
        reports.reportList(q, unrestricted, unrestricted, restricted),
      ).rejects.toThrow('Reading from this Repository is forbidden by Policy.');
  }
  await expect(
    reports.reportList(q, unrestricted, unrestricted, {
      ...unrestricted,
      read: {
        scope: true,
        fields: ['id', 'startsOn', 'endsOn', 'amountCents'],
      },
    }),
  ).rejects.toThrow(/outside the ordinary view policy/);
  const ledgerId = randomUUID();
  await db.repository('contractMoneyLedger').createOne({
    values: {
      id: ledgerId,
      contractId,
      reference: 'synthetic-report-settlement',
      kind: 'settle',
      heldDelta: 5000,
      paidDelta: 10000,
      actorId: outsider.user.id,
      reason: 'Synthetic paid facts',
      at: now,
    },
  });
  expect(
    (await (await reader.fetch('/reports/contract-ledger')).json()).data[0],
  ).toMatchObject({
    paidCents: 10000,
    heldCents: 5000,
    paymentState: 'partial',
    paidBasisPoints: 2000,
  });
  await db
    .repository('contractMoneyLedger')
    .updateOne({ filter: { id: ledgerId }, values: { paidDelta: 60000 } });
  expect(
    (await (await reader.fetch('/reports/contract-ledger')).json()).data[0],
  ).toMatchObject({ paymentState: 'overpaid', paidBasisPoints: 12000 });
  await db
    .repository('contractMoneyLedger')
    .deleteOne({ filter: { id: ledgerId } });
  await db
    .repository('contracts')
    .updateOne({ filter: { id: contractId }, values: { amountCents: 0 } });
  await db
    .repository('contractVersions')
    .updateOne({ filter: { contractId }, values: { amountCents: 0 } });
  expect(
    (await (await reader.fetch('/reports/contract-ledger')).json()).data[0],
  ).toMatchObject({ amountCents: 0, paidBasisPoints: null });
  await db
    .repository('contracts')
    .updateOne({ filter: { id: contractId }, values: { amountCents: 50000 } });
  await db
    .repository('contractVersions')
    .updateOne({ filter: { contractId }, values: { amountCents: 50000 } });
  expect(
    (await reader.fetch('/reports/contract-ledger?endsBefore=2026-12-30'))
      .status,
  ).toBe(200);
  expect(
    (
      await (
        await reader.fetch('/reports/contract-ledger?endsBefore=2026-12-30')
      ).json()
    ).data,
  ).toEqual([]);
  expect(
    (await reader.fetch('/reports/contract-ledger?endsBefore=bad-date')).status,
  ).toBe(400);
  const selectedPosition = headcount.data[0].positionId;
  const positionQuery = `/reports/headcount-balances?positionId=${selectedPosition}`;
  expect((await (await reader.fetch(positionQuery)).json()).data).toHaveLength(
    1,
  );
  expect(
    (
      await (
        await reader.fetch('/reports/headcount-balances?positionId=missing')
      ).json()
    ).data,
  ).toEqual([]);
  expect(
    (
      await workbook(
        await reader.fetch(
          '/reports/headcount-balances.xlsx?positionId=missing',
        ),
      )
    ).worksheets[0].rowCount,
  ).toBe(1);
  await db
    .repository('headcountAccounts')
    .updateOne({ filter: { id: accountId }, values: { initialized: false } });
  expect(
    (await (await reader.fetch(positionQuery)).json()).data[0],
  ).toMatchObject({
    initialized: false,
    available: 4,
    capacityState: 'uninitialized',
  });
  const uninitializedExcel = await workbook(
    await reader.fetch(
      `${positionQuery.replace('headcount-balances?', 'headcount-balances.xlsx?')}`,
    ),
  );
  expect(uninitializedExcel.worksheets[0].getCell('M2').value).toBe(
    'uninitialized',
  );
  await db
    .repository('headcountAccounts')
    .updateOne({ filter: { id: accountId }, values: { initialized: true } });

  const set = await authz.permissionSets.get(key);
  if (!set) throw new Error('A5 report permission fixture was not created.');
  await authz.permissionSets.update(key, { ...set, grants: [] });
  expect(
    (await (await reader.fetch('/reports/datasets')).json()).data,
  ).not.toContain('budget-balances');
  for (const path of [
    '/reports/budget-balances',
    '/reports/headcount-balances',
  ])
    expect((await reader.fetch(path)).status).toBe(403);
  const afterRevocation = await (
    await reader.fetch('/reports/contract-ledger')
  ).json();
  expect(afterRevocation).toMatchObject({ data: [], meta: { total: 0 } });
  const revokedExport = await workbook(
    await reader.fetch('/reports/contract-ledger.xlsx'),
  );
  expect(revokedExport.worksheets[0].rowCount).toBe(1);
});
