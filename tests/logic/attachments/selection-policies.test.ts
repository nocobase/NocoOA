// @vitest-environment node
import { createTestDatabase } from '@nocobase/app-testing/server';
import type { RepositoryPolicy } from '@nocobase/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const { repositories } = vi.hoisted(() => ({
  repositories: new Map<
    string,
    { policy: (principal: Record<string, unknown>) => RepositoryPolicy }
  >(),
}));
// Capture the actual application route policies, then execute them against PG.
// The rest of the File plugin stays real; no business authorization is bypassed
// in the HTTP regression suites, which run separately.
vi.mock('@nocobase/app-plugin-file/server', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@nocobase/app-plugin-file/server')>();
  return {
    ...original,
    defineFileRepositoryApiRoutes: (options: {
      repositories: {
        name: string;
        policy: (principal: Record<string, unknown>) => RepositoryPolicy;
      }[];
    }) => {
      for (const repository of options.repositories)
        repositories.set(repository.name, repository);
      return [];
    },
  };
});

const cases = [
  [
    'leaveAttachments',
    () => import('../../../server/routes/leave-attachments/index.js'),
    'leaveId',
  ],
  [
    'attendanceChangeAttachments',
    () =>
      import('../../../server/routes/attendance-change-attachments/index.js'),
    'attendanceChangeId',
  ],
  [
    'assetRequestPhotos',
    () => import('../../../server/routes/asset-requests/attachments.js'),
    'requestId',
  ],
  [
    'generalAttachments',
    () => import('../../../server/routes/general-requests/attachments.js'),
    'generalId',
  ],
  [
    'travelAttachments',
    () => import('../../../server/routes/travel/attachments.js'),
    'travelId',
  ],
  [
    'reimbursementAttachments',
    () => import('../../../server/routes/reimbursement/attachments.js'),
    'reimbursementId',
  ],
  [
    'paymentAttachments',
    () => import('../../../server/routes/payment-requests/attachments.js'),
    'paymentRequestId',
  ],
  [
    'purchaseAttachments',
    () => import('../../../server/routes/purchases/attachments.js'),
    'purchaseId',
  ],
  [
    'contractAttachments',
    () => import('../../../server/routes/contracts/attachments.js'),
    'requestId',
  ],
  [
    'vendorQualificationAttachments',
    () => import('../../../server/routes/vendor-qualification/attachments.js'),
    'qualificationId',
  ],
  [
    'announcementAttachments',
    () => import('../../../server/routes/announcements/attachments.js'),
    'announcementId',
  ],
  [
    'workItemAttachments',
    () => import('../../../server/routes/work-items/attachments.js'),
    'workItemId',
  ],
  [
    'onboardingAttachments',
    () => import('../../../server/routes/onboarding/attachments.js'),
    'onboardingId',
  ],
] as const;
let database: Awaited<ReturnType<typeof createTestDatabase>>;
const collection = 'attachmentScopeFixture';
const idTypes = ['string', 'uuid'] as const;
const fileIds = new Map(
  ['selected', 'unselected', 'foreign', 'wrong-purpose', 'wrong-task'].map(
    (name, i) => [
      name,
      `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    ],
  ),
);
const fileId = (name: string) => fileIds.get(name)!;
const ownerFields = [...new Set(cases.map((item) => item[2]))];

beforeAll(async () => {
  for (const [, load] of cases) await load();
  database = await createTestDatabase();
  const fields = new Set<string>(['id', 'purpose', 'taskId', ...ownerFields]);
  for (const repository of repositories.values()) {
    const read = repository.policy({ upload: false, ids: [] }).read;
    if (read && read !== true)
      for (const field of read.fields || []) fields.add(field);
  }
  for (const idType of idTypes) {
    await database.connection.builder.createCollection(
      `${collection}${idType}`,
      (builder) => {
        for (const field of fields) if (field !== 'id') builder.string(field);
        builder[idType]('id');
        builder.primary('id');
      },
    );
    const repo = database.database.repository(`${collection}${idType}`);
    for (const [id, owner, purpose, taskId] of [
      [fileId('selected'), 'owner', 'evidence', 'task'],
      [fileId('unselected'), 'owner', 'evidence', 'task'],
      [fileId('foreign'), 'other', 'evidence', 'task'],
      [fileId('wrong-purpose'), 'owner', 'text', 'task'],
      [fileId('wrong-task'), 'owner', 'evidence', 'other-task'],
    ])
      await repo.createOne({
        values: {
          ...Object.fromEntries(ownerFields.map((field) => [field, owner])),
          id,
          purpose,
          taskId,
        },
      });
  }
}, 60_000);
afterAll(async () => {
  await database?.destroy();
});

it.each(
  cases.flatMap(([name]) => idTypes.map((idType) => [name, idType] as const)),
)(
  '%s (%s) treats empty selections as empty results and preserves ownership and sub-scopes',
  async (name, idType) => {
    expect(repositories.size).toBe(cases.length);
    const policy = repositories.get(name)!.policy;
    const principal = {
      ...Object.fromEntries(ownerFields.map((field) => [field, 'owner'])),
      id: 'owner',
      actorId: 'actor',
      upload: false,
      version: 1,
      purpose: 'evidence',
      taskId: 'task',
    };
    const repo = database.database.repository(`${collection}${idType}`);
    const empty = repo.withPolicy(policy({ ...principal, ids: [] }));
    expect(await empty.findMany()).toEqual([]);
    expect(
      await empty.findOne({ filter: { id: fileId('unselected') } }),
    ).toBeUndefined();
    expect(await empty.count()).toBe(0);

    // Even a selected ID cannot escape its business record, purpose or task.
    const selected = repo.withPolicy(
      policy({
        ...principal,
        ids: [
          fileId('selected'),
          fileId('foreign'),
          fileId('wrong-purpose'),
          fileId('wrong-task'),
        ],
      }),
    );
    const ids = (await selected.findMany()).map((row) => row.id).sort();
    const expected = [fileId('selected')];
    if (!['contractAttachments', 'paymentAttachments'].includes(name))
      expected.push(fileId('wrong-purpose'));
    if (name !== 'onboardingAttachments') expected.push(fileId('wrong-task'));
    expect(ids).toEqual(expected.sort());
    expect(
      await selected.findOne({ filter: { id: fileId('unselected') } }),
    ).toBeUndefined();

    const draft = repo.withPolicy(policy({ ...principal, ids: undefined }));
    const draftIds = (await draft.findMany()).map((row) => row.id);
    expect(draftIds).toContain(fileId('unselected'));
    expect(draftIds).not.toContain(fileId('foreign'));
  },
);
