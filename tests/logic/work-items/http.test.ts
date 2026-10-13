// @vitest-environment node
import type { AuthorizationCheckRequest } from '@nocobase/authorization/core';
import { randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  apiDocsToken,
  findUndeclaredApiRoutes,
  findApiDocumentSchemaProblems,
} from '@nocobase/app-server/router';
import { write } from '../platform/helpers.js';
import { createWorkItemAppTest } from './helpers.js';
import { createEmployee } from '../employees/helpers.js';
import { organizationServiceToken } from '../../../server/providers/org/index.js';
import { auditServiceToken } from '../../../server/providers/audit/index.js';
import { OA_TEST_ORIGIN } from '../oa-test-origin.js';
const test = createWorkItemAppTest();
test('main default employee personal task actions enforce creator/assignee and current management role; declares Swagger', async ({
  testApp,
}) => {
  const creator = await createEmployee(testApp, 'Work HTTP creator'),
    worker = await createEmployee(testApp, 'Work HTTP assignee'),
    other = await createEmployee(testApp, 'Work HTTP foreign'),
    cs = await creator.session(),
    ws = await worker.session(),
    os = await other.session();
  expect((await testApp.request('/workItems')).status).toBe(401);
  const body = {
    requestId: randomUUID(),
    title: 'Ordinary follow up',
    description: 'Verify business facts',
    targetUserId: worker.userId,
    dutyRoleCode: null,
    dueAt: '2035-01-01T00:00:00Z',
    requiresConfirmation: true,
    attachments: [],
  };
  expect(
    (
      await cs.fetch(
        '/workItems',
        write('POST', { ...body, actorId: worker.userId }),
      )
    ).status,
  ).toBe(400);
  const invalidDeadline = await cs.fetch(
    '/workItems',
    write('POST', {
      ...body,
      requestId: randomUUID(),
      dueAt: '2000-01-01T00:00:00Z',
    }),
  );
  expect(invalidDeadline.status).toBe(400);
  expect((await invalidDeadline.json()).error.fieldViolations).toEqual([
    { field: 'dueAt', description: 'INVALID_INPUT' },
  ]);
  const created = await cs.fetch('/workItems', write('POST', body));
  expect(created.status).toBe(200);
  const draft = (await created.json()).data;
  expect(draft.creator).toEqual({
    id: creator.userId,
    name: 'Work HTTP creator',
  });
  expect((await ws.fetch(`/workItems/${draft.id}`)).status).toBe(404);
  expect(draft.canEdit).toBe(true);
  expect(
    (
      await (
        await cs.fetch(
          '/workItems?mode=created&q=follow&status=draft&sort=title&direction=asc',
        )
      ).json()
    ).meta.total,
  ).toBe(1);
  expect(
    (await (await cs.fetch('/workItems?mode=pending')).json()).meta.total,
  ).toBe(0);
  expect(
    (await (await cs.fetch('/workItems?mode=created&q=missing')).json()).meta
      .total,
  ).toBe(0);
  expect(
    (await (await ws.fetch('/workItems/context')).json()).data,
  ).toMatchObject({ timeZone: 'Asia/Shanghai', dutyRoles: null });
  const assigned = await cs.fetch(
    `/workItems/${draft.id}/dispatch`,
    write('POST', { requestId: randomUUID(), expectedVersion: draft.version }),
  );
  expect(assigned.status).toBe(200);
  const a = (await assigned.json()).data;
  expect((await os.fetch(`/workItems/${a.id}`)).status).toBe(404);
  expect(
    (
      await cs.fetch(
        `/workItems/${a.id}/forceComplete`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: a.version,
          reason: 'No manager bypass',
        }),
      )
    ).status,
  ).toBe(403);
  const detail = await ws.fetch(`/workItems/${a.id}`);
  expect(detail.status).toBe(200);
  expect((await detail.json()).data.actions).toContain('complete');
  const authz = testApp.application.container.resolve(authorizationToken),
    originalFor = authz.for.bind(authz);
  const narrow = vi.spyOn(authz, 'for').mockImplementation((identity) => {
    const context = originalFor(identity);
    return {
      ...context,
      authorize: (async (check: AuthorizationCheckRequest) => {
        const result = await context.authorize(check);
        if (
          check.resource.type !== 'composite' ||
          check.resource.id !== 'oa.workItems' ||
          check.action !== 'complete' ||
          !result.conditions?.database?.workItems
        )
          return result;
        return {
          ...result,
          conditions: {
            ...result.conditions,
            database: {
              ...result.conditions.database,
              workItems: {
                ...result.conditions.database.workItems,
                update: {
                  scope: true,
                  fields: ['status', 'version', 'statusChangedAt'],
                },
              },
            },
          },
        };
      }) as typeof context.authorize,
    };
  });
  expect(
    (await (await ws.fetch(`/workItems/${a.id}`)).json()).data.actions,
  ).not.toContain('complete');
  expect((await (await ws.fetch('/workItems/pending')).json()).data.count).toBe(
    0,
  );
  expect(
    (await (await ws.fetch('/workItems?mode=pending')).json()).meta.total,
  ).toBe(0);
  expect(
    (
      await ws.fetch(
        `/workItems/${a.id}/complete`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: a.version,
          result: 'Denied result',
        }),
      )
    ).status,
  ).toBe(403);
  narrow.mockRestore();

  const result = await ws.fetch(
    `/workItems/${a.id}/complete`,
    write('POST', {
      requestId: randomUUID(),
      expectedVersion: a.version,
      result: 'Evidence recorded',
    }),
  );
  expect(result.status).toBe(200);
  const waiting = (await result.json()).data;
  expect(waiting.status).toBe('awaitingConfirmation');
  expect(
    (
      await ws.fetch(
        `/workItems/${a.id}/confirm`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: waiting.version,
        }),
      )
    ).status,
  ).toBe(403);
  const pending = await cs.fetch('/workItems/pending');
  expect(
    (await pending.json()).data.items.some(
      (i: { sourceId: string }) => i.sourceId === a.id,
    ),
  ).toBe(true);
  expect(
    (
      await cs.fetch(
        `/workItems/${a.id}/confirm`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: waiting.version,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    findUndeclaredApiRoutes(testApp.application).filter((route) =>
      route.path.includes('workItem'),
    ),
  ).toEqual([]);
  const doc = await testApp.application.container
    .resolve(apiDocsToken)
    .getDocument();
  expect(findApiDocumentSchemaProblems(doc)).toEqual([]);
  expect(
    doc.paths?.['/api/workItems/{id}/forceComplete']?.post?.operationId,
  ).toBe('workItemforceComplete');
});
test('pool member loss denies old command replay, management revocation is immediate, and forward seed preserves edits', async ({
  testApp,
}) => {
  const creator = await createEmployee(testApp, 'Pool HTTP creator'),
    member = await createEmployee(testApp, 'Pool HTTP member'),
    cs = await creator.session(),
    ms = await member.session(),
    c = testApp.application.container,
    org = c.resolve(organizationServiceToken),
    db = c.resolve(databaseManagerToken),
    authz = c.resolve(authorizationToken);
  await org.addDutyRoleMember('admin', member.userId, {
    actorId: creator.userId,
  });
  const created = await cs.fetch(
    '/workItems',
    write('POST', {
      requestId: randomUUID(),
      title: 'Pool task',
      description: 'Role task',
      targetUserId: null,
      dutyRoleCode: 'admin',
      dueAt: '2035-01-01T00:00:00Z',
      requiresConfirmation: false,
      attachments: [],
    }),
  );
  expect(created.status).toBe(200);
  const draft = (await created.json()).data;
  expect(draft.dutyRole).toMatchObject({
    code: 'admin',
    title: { key: expect.any(String), ns: expect.any(String) },
  });
  const dispatched = await cs.fetch(
    `/workItems/${draft.id}/dispatch`,
    write('POST', { requestId: randomUUID(), expectedVersion: draft.version }),
  );
  const open = (await dispatched.json()).data,
    claim = { requestId: randomUUID(), expectedVersion: open.version };
  expect(
    (await ms.fetch(`/workItems/${open.id}/claim`, write('POST', claim)))
      .status,
  ).toBe(200);
  await org.removeDutyRoleMember('admin', member.userId, {
    actorId: creator.userId,
  });
  expect(
    (await ms.fetch(`/workItems/${open.id}/claim`, write('POST', claim)))
      .status,
  ).toBe(403);
  expect(
    (
      await ms.fetch(
        `/workItems/${open.id}/forceComplete`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: open.version + 1,
          reason: 'Removed role',
        }),
      )
    ).status,
  ).toBe(403);
  const { installWorkItemPermissions } =
    await import('../../../database/main/seeds/202610104511_work_items_permissions.js');
  const set = (await authz.permissionSets.get('oa-work-items-admin'))!;
  await authz.permissionSets.update(set.key, {
    ...set,
    title: 'Edited work item admin grants',
    grants: [],
  });
  await db.transaction((tx) => installWorkItemPermissions(tx.query));
  expect((await authz.permissionSets.get(set.key))?.grants).toEqual([]);
  expect((await authz.permissionSets.get(set.key))?.title).toBe(
    'Edited work item admin grants',
  );
});
test('safe input/output files follow parent scope, current uploader qualification, selected IDs and transaction audit', async ({
  testApp,
}) => {
  const creator = await createEmployee(testApp, 'File task creator'),
    worker = await createEmployee(testApp, 'File task worker'),
    cs = await creator.session(),
    ws = await worker.session();
  const body = {
    requestId: randomUUID(),
    title: 'File task',
    description: 'Evidence',
    targetUserId: worker.userId,
    dutyRoleCode: null,
    dueAt: '2035-01-01T00:00:00Z',
    requiresConfirmation: true,
    attachments: [],
  };
  const created = await cs.fetch('/workItems', write('POST', body));
  expect(created.status).toBe(200);
  const draft = (await created.json()).data;
  const upload = async (
    session: typeof cs,
    name = 'proof.pdf',
    bytes = '%PDF-1.7\nfile',
  ) => {
    const form = new FormData();
    form.append('file', new File([bytes], name, { type: 'application/pdf' }));
    return session.fetch('/workItemAttachments/uploadOne', {
      method: 'POST',
      headers: { origin: OA_TEST_ORIGIN, 'x-work-item-id': draft.id },
      body: form,
    });
  };
  expect((await upload(ws)).status).toBe(403);
  expect((await upload(cs, 'bad.pdf', '<script>')).status).toBe(400);
  const input = await upload(cs);
  expect(input.status).toBe(201);
  const file = (await input.json()).data.record,
    url = new URL(file.contentUrl, OA_TEST_ORIGIN).href;
  expect((await testApp.fetch(new Request(url))).status).toBe(401);
  const edited = await cs.fetch(
    `/workItems/${draft.id}`,
    write('PATCH', {
      ...body,
      requestId: randomUUID(),
      expectedVersion: draft.version,
      attachments: [file.id],
    }),
  );
  expect(edited.status).toBe(200);
  const e = (await edited.json()).data;
  const dispatched = await cs.fetch(
    `/workItems/${e.id}/dispatch`,
    write('POST', { requestId: randomUUID(), expectedVersion: e.version }),
  );
  expect(dispatched.status).toBe(200);
  const assigned = (await dispatched.json()).data;
  expect((await ws.fetch(url)).status).toBe(200);
  expect((await upload(cs)).status).toBe(403);
  const c = testApp.application.container,
    db = c.resolve(databaseManagerToken),
    audit = c.resolve(auditServiceToken),
    failed = vi
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('File audit rollback'));
  try {
    expect((await upload(ws)).status).toBe(500);
    expect(
      await db
        .repository('workItemFiles')
        .count({ filter: { workItemId: e.id } }),
    ).toBe(1);
  } finally {
    failed.mockRestore();
  }
  const output = await upload(ws);
  expect(output.status).toBe(201);
  const of = (await output.json()).data.record,
    unused = await upload(ws);
  const unusedFile = (await unused.json()).data.record;
  const complete = await ws.fetch(
    `/workItems/${e.id}/complete`,
    write('POST', {
      requestId: randomUUID(),
      expectedVersion: assigned.version,
      result: 'Evidence attached',
      resultAttachments: [of.id],
    }),
  );
  expect(complete.status).toBe(200);
  const done = (await complete.json()).data;
  expect(
    (await cs.fetch(new URL(of.contentUrl, OA_TEST_ORIGIN).href)).status,
  ).toBe(200);
  expect(
    (await cs.fetch(new URL(unusedFile.contentUrl, OA_TEST_ORIGIN).href))
      .status,
  ).toBe(403);
  expect(
    (
      await cs.fetch(
        `/workItems/${e.id}/confirm`,
        write('POST', {
          requestId: randomUUID(),
          expectedVersion: done.version,
        }),
      )
    ).status,
  ).toBe(200);
  expect(
    (await ws.fetch(new URL(unusedFile.contentUrl, OA_TEST_ORIGIN).href))
      .status,
  ).toBe(403);
});
