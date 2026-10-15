import { calendarServiceToken } from '../../../server/providers/platform/index.js';
// @vitest-environment node
import type { AuthorizationCheckRequest } from '@nocobase/authorization/core';
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { contractLedgerServiceToken } from '../../../server/providers/contracts/contract.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import {
  createPlatformAppTest,
  createUser,
  write,
  ORIGIN,
} from '../platform/helpers.js';
import { composite, grantToUser } from '../employees/helpers.js';
const test = createPlatformAppTest();
test('registered HTTP durable creation and secure text enforce owner scope and independent field grants', async ({
  app,
  testApp,
  request,
}) => {
  const db = app.container.resolve(databaseManagerToken),
    org = app.container.resolve(organizationServiceToken);
  const owner = await createUser(testApp, 'Contract owner'),
    outsider = await createUser(testApp, 'Contract outsider');
  await db.repository('employees').createOne({
    values: {
      id: randomUUID(),
      code: randomUUID(),
      userId: owner.user.id,
      name: 'Contract owner',
      status: 'regular',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const department = await org.createDepartment(
    { title: 'Contract HTTP' },
    { actorId: owner.user.id },
  );
  await org.addMember(
    { departmentId: department.id, userId: owner.user.id, primary: true },
    { actorId: owner.user.id },
  );
  for (const session of [owner, outsider])
    await grantToUser(
      testApp,
      randomUUID(),
      [
        composite('oa.contract', {
          view: { contractRequests: 'oa.contractOwned' },
          submit: { contractRequests: 'oa.contractOwned' },
        }),
      ],
      session.user.id,
    );
  const ownerOptions = await owner.fetch('/contractRequests/options');
  expect(ownerOptions.status).toBe(200);
  expect((await ownerOptions.json()).data.eligible).toBe(true);
  const outsiderOptions = await outsider.fetch('/contractRequests/options');
  expect(outsiderOptions.status).toBe(200);
  expect((await outsiderOptions.json()).data.eligible).toBe(false);
  const requestId = randomUUID(),
    input = {
      operation: 'new',
      contractId: null,
      baseVersion: 0,
      proposal: {
        contractType: 'purchase',
        counterparty: { kind: 'customer', name: 'Customer' },
        amountCents: 12345,
        startsOn: '2026-10-01',
        endsOn: '2027-10-01',
        paymentTerms: 'Net 30',
        standardTemplate: true,
        textVersionId: null,
        attachments: [],
        reason: 'HTTP draft proof',
      },
    };
  const results = await Promise.all(
    [1, 2].map(() =>
      owner.fetch('/contractRequests', write('POST', { requestId, input })),
    ),
  );
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  const records = await Promise.all(
    results.map(
      (r) =>
        r.json() as Promise<{
          data: { record: { id: string; lifecycleVersion: number } };
        }>,
    ),
  );
  const record = records[0].data.record;
  const list = await owner.fetch('/contractRequests?view=mine');
  expect(list.status).toBe(200);
  expect((await list.json()).meta.timeZone).toBe(
    app.container.resolve(calendarServiceToken).timeZone(),
  );
  expect(records[1].data.record.id).toBe(record.id);
  const centerUrl = '/approvalCenter?kind=oa.contract&view=mine';
  expect((await request(centerUrl)).status).toBe(401);
  const centerResponse = await owner.fetch(centerUrl);
  expect(centerResponse.status).toBe(200);
  const center = await centerResponse.json();
  expect(center.meta.total).toBe(1);
  expect(center.data).toEqual([
    expect.objectContaining({
      id: record.id,
      kind: 'oa.contract',
      amount: 12345,
      unit: 'cents',
      applicant: { id: owner.user.id, name: 'Contract owner' },
    }),
  ]);
  expect(Object.keys(center.data[0]).sort()).toEqual(
    [
      'id',
      'kind',
      'title',
      'number',
      'applicant',
      'applicantId',
      'status',
      'createdAt',
      'startDate',
      'endDate',
      'amount',
      'unit',
    ].sort(),
  );
  const outsiderCenter = await outsider.fetch(centerUrl);
  expect(outsiderCenter.status).toBe(200);
  expect((await outsiderCenter.json()).meta.total).toBe(0);

  expect(
    (
      await owner.fetch(
        '/contractRequests',
        write('POST', {
          requestId,
          input: {
            ...input,
            proposal: { ...input.proposal, amountCents: 12346 },
          },
        }),
      )
    ).status,
  ).toBe(409);
  expect((await outsider.fetch(`/contractRequests/${record.id}`)).status).toBe(
    403,
  );
  const ledger = app.container.resolve(contractLedgerServiceToken),
    foreignSource = randomUUID(),
    sourceRequest = randomUUID();
  const facts = {
    contractType: 'purchase',
    counterparty: { kind: 'customer' as const, name: 'Foreign contract' },
    startsOn: '2026-10-01',
    endsOn: '2027-10-01',
    paymentTerms: 'Net 30',
    standardTemplate: true,
    textVersionId: randomUUID(),
    attachments: [],
  };
  await db.transaction(async (tx) => {
    await ledger.createCandidate(
      {
        actorId: owner.user.id,
        reason: 'Existing approved source fixture',
        requestKey: randomUUID(),
        id: foreignSource,
        requestId: sourceRequest,
        applicantId: outsider.user.id,
        departmentId: department.id,
        amountCents: 50000,
        facts,
      },
      tx,
    );
    await ledger.publish(
      {
        actorId: owner.user.id,
        reason: 'Existing approved source fixture',
        requestKey: randomUUID(),
        contractId: foreignSource,
        requestId: sourceRequest,
        baseVersion: 0,
        number: 'FOREIGNSOURCE',
        amountCents: 50000,
        facts,
      },
      tx,
    );
  });
  expect(
    (
      await owner.fetch(
        '/contractRequests',
        write('POST', {
          requestId: randomUUID(),
          input: {
            ...input,
            operation: 'change',
            contractId: foreignSource,
            baseVersion: 1,
          },
        }),
      )
    ).status,
  ).toBe(403);
  const chineseError = await owner.fetch('/contractRequests', {
    ...write('POST', {
      requestId,
      input: { ...input, proposal: { ...input.proposal, amountCents: 12346 } },
    }),
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'accept-language': 'zh-CN',
    },
  });
  expect(chineseError.status).toBe(409);
  const chineseBody = (await chineseError.json()) as {
    error: { localizedMessage: { locale: string; message: string } };
  };
  expect(chineseBody.error.localizedMessage).toMatchObject({
    locale: 'zh-CN',
    message: expect.stringContaining('请求'),
  });
  async function upload(purpose = 'text') {
    const body = new FormData();
    body.append(
      'file',
      new File(['%PDF-1.7\nsecure-text\n%%EOF'], 'contract.pdf', {
        type: 'application/pdf',
      }),
    );
    return owner.fetch('/contractAttachments/uploadOne', {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'x-contract-request-id': record.id,
        'x-contract-file-purpose': purpose,
      },
      body,
    });
  }
  expect((await upload('unexpected')).status).toBe(400);
  const response = await upload();
  expect(response.status).toBe(201);
  const file = (
    (await response.json()) as {
      data: { record: { id: string; contentUrl: string } };
    }
  ).data.record;
  const url = new URL(file.contentUrl, ORIGIN).href;
  expect((await owner.fetch(url)).status).toBe(200);
  expect((await outsider.fetch(url)).status).toBe(403);
  expect((await testApp.fetch(new Request(url))).status).toBe(401);
  const versionKey = randomUUID();
  const version = await owner.fetch(
    `/contractRequests/${record.id}/textVersions`,
    write('POST', { fileId: file.id, requestId: versionKey }),
  );
  expect(version.status).toBe(200);
  const appended = (await version.json()).data.textVersion;
  const mappingPath = `/contractRequests/${record.id}/textVersions`;
  expect((await (await owner.fetch(mappingPath)).json()).data).toEqual({
    textVersion: null,
  });
  expect((await outsider.fetch(mappingPath)).status).toBe(403);
  expect((await request(mappingPath)).status).toBe(401);
  const latest = (
    await (await owner.fetch(`/contractRequests/${record.id}`)).json()
  ).data.record;
  const proposalFields = [
    'contractType',
    'counterparty',
    'amountCents',
    'startsOn',
    'endsOn',
    'paymentTerms',
    'standardTemplate',
    'textVersionId',
    'attachments',
    'reason',
  ];
  const edited = await owner.fetch(
    `/contractRequests/${record.id}/transition`,
    write('POST', {
      name: 'edit',
      version: latest.lifecycleVersion,
      requestId: randomUUID(),
      input: {
        ...Object.fromEntries(
          proposalFields.map((field) => [field, latest[field]]),
        ),
        textVersionId: appended.id,
      },
    }),
  );
  expect(edited.status).toBe(200);
  expect(
    (await (await owner.fetch(mappingPath)).json()).data.textVersion,
  ).toEqual({
    id: appended.id,
    requestId: record.id,
    fileId: file.id,
    version: 1,
  });

  const authz = app.container.resolve(authorizationToken),
    original = authz.for.bind(authz);
  const spy = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = original(identity);
    return {
      ...context,
      authorize: (async (check: AuthorizationCheckRequest) => {
        if (check.resource.type !== 'composite')
          return context.authorize(check);
        const decision = await context.authorize({
          action: check.action,
          resource: { type: 'composite', id: check.resource.id },
        });
        if (
          check.resource.type !== 'composite' ||
          check.resource.id !== 'oa.contract' ||
          check.action !== 'view' ||
          !decision.conditions?.database?.contractRequests
        )
          return decision;
        return {
          ...decision,
          conditions: {
            ...decision.conditions,
            database: {
              ...decision.conditions.database,
              contractRequests: {
                ...decision.conditions.database.contractRequests,
                read: {
                  scope: true as const,
                  fields: ['id', 'attachments'],
                },
              },
            },
          },
        };
      }) as typeof context.authorize,
    };
  });
  try {
    expect((await owner.fetch(mappingPath)).status).toBe(403);
    const hidden = await owner.fetch(url);
    expect(hidden.status).toBe(403);
    expect((await upload()).status).toBe(403);
    expect(
      (
        await owner.fetch(`/contractAttachments/findMany`, {
          headers: {
            'x-contract-request-id': record.id,
            'x-contract-file-purpose': 'text',
          },
        })
      ).status,
    ).toBe(403);
  } finally {
    spy.mockRestore();
  }
}, 120000);
