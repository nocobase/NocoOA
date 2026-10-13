// @vitest-environment node
import { expect } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { createAssetRequestsAppTest } from './helpers.js';
import { createEmployee } from '../employees/helpers.js';
import { write } from '../platform/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { assetServiceToken } from '../../../server/providers/assets/contract.js';
import { dictionaryServiceToken } from '../../../server/providers/platform/index.js';
const test = createAssetRequestsAppTest();
test('main registered default-role HTTP uses real scope, frozen hidden value, SDK targets and full physical issue and return', async ({
  testApp,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    org = c.resolve(organizationServiceToken);
  const owner = await createEmployee(testApp, 'HTTP asset owner'),
    head = await createEmployee(testApp, 'HTTP asset head'),
    handler = await createEmployee(testApp, 'HTTP asset handler'),
    outsider = await createEmployee(testApp, 'HTTP asset outsider');
  const department = await org.createDepartment(
    { title: 'HTTP asset team', managerId: head.userId },
    { actorId: head.userId },
  );
  await org.addMember(
    { departmentId: department.id, userId: owner.userId, primary: true },
    { actorId: head.userId },
  );
  await org.addDutyRoleMember('admin', handler.userId, {
    actorId: head.userId,
  });
  const assets = c.resolve(assetServiceToken),
    category = (
      await c.resolve(dictionaryServiceToken).list('assetCategory')
    )[0]!.code;
  const asset = await db.transaction((tx) =>
    assets.create(
      {
        code: 'HTTP-UNIT',
        category,
        name: 'HTTP laptop',
        serialNumber: 'HTTP-REAL-SERIAL',
        originalValueCents: 876543,
        actorId: handler.userId,
        reason: 'Received',
      },
      tx,
    ),
  );
  const ownerSession = await owner.session(),
    headSession = await head.session(),
    handlerSession = await handler.session(),
    outsiderSession = await outsider.session();
  const proposal = {
    operation: 'use',
    category,
    assetIds: [],
    quantity: 1,
    purpose: 'Actual work',
    borrowDueDate: null,
    scrapReason: '',
    photos: [],
    requestId: 'http-create',
  };
  const bad = await ownerSession.fetch(
    '/assetRequests',
    write('POST', { ...proposal, originalValueCents: 1 }),
  );
  expect(bad.status).toBe(400);
  const response = await ownerSession.fetch(
    '/assetRequests',
    write('POST', proposal),
  );
  expect(response.status).toBe(201);
  const record = (await response.json()).data,
    id = record.id;
  expect(
    (
      await (
        await ownerSession.fetch('/assetRequests', write('POST', proposal))
      ).json()
    ).data.id,
  ).toBe(id);
  expect((await outsiderSession.fetch(`/assetRequests/${id}`)).status).toBe(
    404,
  );
  expect((await ownerSession.fetch(`/assetRequests/${id}/value`)).status).toBe(
    403,
  );
  const { assetRequestServiceToken } =
    await import('../../../server/providers/asset-requests/contract.js');
  expect(
    await c.resolve(assetRequestServiceToken).readableIds(owner.userId),
  ).toContain(id);
  const submitted = await ownerSession.fetch(
    `/assetRequests/${id}/lifecycle`,
    write('POST', {
      action: 'submit',
      lifecycleVersion: record.lifecycleVersion,
      requestId: 'http-submit',
    }),
  );
  expect(submitted.status).toBe(200);
  const detail = (await submitted.json()).data;
  const emptyPhotos = await ownerSession.fetch('/assetRequestPhotos/findMany', {
    ...write('POST', { limit: 10 }),
    headers: {
      ...write('POST', {}).headers,
      'x-asset-request-id': id,
    },
  });
  expect(emptyPhotos.status).toBe(200);
  expect((await emptyPhotos.json()).data).toEqual([]);
  expect(
    detail.record.allocation.map((unit: { id: string }) => unit.id),
  ).toEqual([asset.id]);
  expect(detail.record).not.toHaveProperty('originalValueCents');
  expect(JSON.stringify(detail)).not.toContain('"originalValueCents":');
  expect(
    (await (await handlerSession.fetch(`/assetRequests/${id}/value`)).json())
      .data.originalValueCents,
  ).toBe(876543);
  async function action(
    session: typeof ownerSession,
    name: string,
    requestId: string,
    input?: unknown,
  ) {
    const current = (await (await session.fetch(`/assetRequests/${id}`)).json())
      .data;
    const group = current.taskActions.find(
      (item: { actions: { name: string }[] }) =>
        item.actions.some((offer) => offer.name === name),
    );
    expect(group).toBeTruthy();
    const result = await session.fetch(
      `/assetRequests/${id}/action`,
      write('POST', {
        target: { taskId: group.task.id },
        action: name,
        contentHash: current.runs.at(-1).run.contentHash,
        requestId,
        ...(input ? { input } : {}),
      }),
    );
    expect(result.status).toBe(200);
    return (await result.json()).data;
  }
  expect(
    (await action(headSession, 'approve', 'http-head')).record.status,
  ).toBe('issuing');
  await action(handlerSession, 'claim', 'http-claim');
  const units = [{ assetId: asset.id, serialNumber: 'HTTP-REAL-SERIAL' }];
  expect(
    (await action(handlerSession, 'complete', 'http-issue', { units })).record
      .status,
  ).toBe('issued');
  await expect(
    db.transaction((tx) => assets.assertAllReturned(owner.employeeId, tx)),
  ).rejects.toMatchObject({ code: 'ASSET_DEPARTURE_NOT_CLEARED' });
  expect(
    (
      await ownerSession.fetch(
        `/assetRequests/${id}/return`,
        write('POST', {
          units,
          reason: 'Received',
          requestId: 'denied-return',
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handlerSession.fetch(
        `/assetRequests/${id}/return`,
        write('POST', {
          units,
          reason: 'Physical return checked',
          requestId: 'http-return',
        }),
      )
    ).status,
  ).toBe(200);
  await expect(
    db.transaction((tx) => assets.assertAllReturned(owner.employeeId, tx)),
  ).resolves.toBeUndefined();
});
