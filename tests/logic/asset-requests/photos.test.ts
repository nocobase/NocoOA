// @vitest-environment node
import { expect, vi } from 'vitest';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { createAssetRequestsAppTest } from './helpers.js';
import { createEmployee, composite } from '../employees/helpers.js';
import { write } from '../platform/helpers.js';
import { OA_TEST_ORIGIN } from '../oa-test-origin.js';
import { auditServiceToken } from '../../../server/providers/audit/index.js';
const test = createAssetRequestsAppTest();
const png = () =>
  new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
    'evidence.png',
    { type: 'image/png' },
  );
test('secure photos enforce actual owner, bytes, edit linkage, audit rollback and field restrictions for content', async ({
  testApp,
  request,
}) => {
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    authz = c.resolve(authorizationToken),
    audit = c.resolve(auditServiceToken);
  const owner = await createEmployee(testApp, 'Photo owner'),
    other = await createEmployee(testApp, 'Photo outsider');
  for (const person of [owner, other]) {
    const key = `asset-photos-${person.userId}`;
    await authz.permissionSets.create({
      key,
      title: key,
      grants: [
        composite('oa.assetRequests', {
          view: { assetRequests: 'oa.assetRequestsReadable' },
          create: { assetRequests: 'oa.assetRequestsOwned' },
          edit: { assetRequests: 'oa.assetRequestsOwned' },
        }),
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: person.userId },
    });
  }
  const own = await owner.session(),
    stranger = await other.session();
  const proposal = {
    operation: 'scrap',
    category: null,
    assetIds: [],
    quantity: 1,
    purpose: 'Inspect',
    borrowDueDate: null,
    scrapReason: 'Worn',
    photos: [],
  };
  async function create(requestId: string) {
    const response = await own.fetch(
      '/assetRequests',
      write('POST', { ...proposal, requestId }),
    );
    expect(response.status).toBe(201);
    return (await response.json()).data;
  }
  const record = await create('photo-draft'),
    otherRecord = await create('other-photo-draft');
  async function upload(id: string, file = png(), session = own) {
    const body = new FormData();
    body.set('file', file);
    return session.fetch('/assetRequestPhotos/uploadOne', {
      method: 'POST',
      headers: { origin: OA_TEST_ORIGIN, 'x-asset-request-id': id },
      body,
    });
  }
  expect(
    (await request('/assetRequestPhotos/findMany', write('POST', {}))).status,
  ).toBe(401);
  expect((await upload(record.id, png(), stranger)).status).toBe(403);
  expect(
    (
      await upload(
        record.id,
        new File(['<script>'], 'fake.png', { type: 'image/png' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await upload(
        record.id,
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
          type: 'image/png',
        }),
      )
    ).status,
  ).toBe(400);
  const uploaded = await upload(record.id);
  expect(uploaded.status).toBe(201);
  const file = (await uploaded.json()).data.record;
  const mocked = vi.spyOn(audit, 'record').mockImplementationOnce(async () => {
    throw new Error('Photo audit unavailable');
  });
  expect((await upload(record.id)).status).toBe(500);
  mocked.mockRestore();
  expect(
    await db
      .repository('assetRequestPhotos')
      .count({ filter: { requestId: record.id } }),
  ).toBe(1);
  const badLink = await own.fetch(
    `/assetRequests/${otherRecord.id}`,
    write('PATCH', {
      ...proposal,
      photos: [file.id],
      requestId: 'foreign-photo-link',
      lifecycleVersion: otherRecord.lifecycleVersion,
    }),
  );
  expect(badLink.status).toBe(400);
  expect((await badLink.json()).error.reason).toBe('ASSET_PHOTO_INVALID');
  const linked = await own.fetch(
    `/assetRequests/${record.id}`,
    write('PATCH', {
      ...proposal,
      photos: [file.id],
      requestId: 'link-photo',
      lifecycleVersion: record.lifecycleVersion,
    }),
  );
  expect(linked.status).toBe(200);
  const url = new URL(file.contentUrl, OA_TEST_ORIGIN).href;
  expect((await testApp.fetch(new Request(url))).status).toBe(401);
  expect((await stranger.fetch(url)).status).toBe(403);
  const content = await own.fetch(url);
  expect(content.status).toBe(200);
  expect(new Uint8Array(await content.arrayBuffer())).toEqual(
    new Uint8Array(await png().arrayBuffer()),
  );
  expect(content.headers.get('cache-control')).toBe('private, no-store');
  // Simulate a submitted request that left a draft upload unselected.
  const unselectedUpload = await upload(otherRecord.id);
  expect(unselectedUpload.status).toBe(201);
  const unselected = (await unselectedUpload.json()).data.record;
  await db.repository('assetRequests').updateMany({
    filter: { id: otherRecord.id },
    values: { status: 'head' },
  });
  const photoListRequest = {
    ...write('POST', { limit: 10 }),
    headers: {
      ...write('POST', {}).headers,
      'x-asset-request-id': otherRecord.id,
    },
  };
  const emptyPhotos = await own.fetch(
    '/assetRequestPhotos/findMany',
    photoListRequest,
  );
  expect(emptyPhotos.status).toBe(200);
  expect((await emptyPhotos.json()).data).toEqual([]);
  expect(
    (await stranger.fetch('/assetRequestPhotos/findMany', photoListRequest))
      .status,
  ).toBe(403);
  expect(
    (await own.fetch(new URL(unselected.contentUrl, OA_TEST_ORIGIN).href))
      .status,
  ).toBe(403);
  const nativeFor = authz.for.bind(authz);
  const narrow = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = nativeFor(identity);
    return {
      ...context,
      authorize: async (check) => {
        const decision = await context.authorize(check);
        if (
          check.resource.id !== 'oa.assetRequests' ||
          check.action !== 'view' ||
          !decision.conditions?.database?.assetRequests
        )
          return decision;
        return {
          ...decision,
          conditions: {
            ...decision.conditions,
            database: {
              ...decision.conditions.database,
              assetRequests: {
                ...decision.conditions.database.assetRequests,
                read: {
                  scope: true,
                  fields: ['id', 'applicantId', 'status', 'lifecycleVersion'],
                },
              },
            },
          },
        };
      },
    };
  });
  expect((await own.fetch(url)).status).toBe(403);
  narrow.mockRestore();
});
