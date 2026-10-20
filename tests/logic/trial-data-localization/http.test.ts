// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { startOrgTestApp, type OrgTestApp, json } from '../org/helpers.ts';
import { trialContentLocalizationToken } from '../../../server/providers/trial-data-localization/index.ts';

let fixture: OrgTestApp;
beforeAll(async () => {
  fixture = await startOrgTestApp();
}, 120000);
afterAll(async () => {
  await fixture?.close();
});

it('persists translations idempotently and displays the same authorized record in both languages', async () => {
  const app = fixture.testApp.application;
  const service = app.container.resolve(trialContentLocalizationToken);
  const session = await fixture.admin();
  const added = await service.initialize(session.user.id);
  expect(added).toBeGreaterThan(150);
  expect(await service.initialize(session.user.id)).toBe(0);
  const department = await fixture.organization.createDepartment(
    { title: '示例·研发部', code: 'oa-trial-v1-engineering' },
    { actorId: session.user.id },
  );
  const response = await session.fetch('/departments/options', {
    headers: { 'x-oa-trial-content-locale': 'en-US' },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-language')).toBe('en-US');
  expect(response.headers.get('vary')).toContain('x-oa-trial-content-locale');
  const localized = (await response.json()).data.find(
    (row: { id: string }) => row.id === department.id,
  );
  expect(localized).toMatchObject({
    id: department.id,
    title: 'Demo · Engineering',
  });
  const raw = await session.fetch('/departments/options');
  expect(
    (await raw.json()).data.find(
      (row: { id: string }) => row.id === department.id,
    ).title,
  ).toBe('示例·研发部');
  const saved = await session.fetch(`/departments/${department.id}`, {
    ...json({ title: localized.title }, 'PATCH'),
    headers: { ...json({}).headers, 'x-oa-trial-content-locale': 'en-US' },
  });
  expect(saved.status).toBe(200);
  expect(
    (
      await app.container
        .resolve(databaseManagerToken)
        .repository('departments')
        .findOne({ filter: { id: department.id } })
    )?.title,
  ).toBe('示例·研发部');
}, 120000);

it('keeps authorization and invalid request validation intact', async () => {
  const anonymous = await fixture.testApp.application.fetch(
    new Request('http://localhost/api/departments/options', {
      headers: { 'x-oa-trial-content-locale': 'en-US' },
    }),
  );
  expect(anonymous.status).toBe(401);
  const employee = await fixture.createUser('BilingualRestricted');
  const denied = await employee.fetch('/departments', {
    ...json({ title: 'Demo · Engineering' }),
    headers: { ...json({}).headers, 'x-oa-trial-content-locale': 'en-US' },
  });
  expect(denied.status).toBe(403);
}, 120000);

it('returns Chinese on request and leaves user-edited content intact', async () => {
  const session = await fixture.admin();
  const departments = await fixture.organization.listTree();
  const department = departments.find(
    (row) => row.code === 'oa-trial-v1-engineering',
  )!;
  const localized = await session.fetch('/departments/options', {
    headers: { 'x-oa-trial-content-locale': 'zh-CN' },
  });
  expect(localized.headers.get('content-language')).toBe('zh-CN');
  expect(
    (await localized.json()).data.find(
      (row: { id: string }) => row.id === department.id,
    ).title,
  ).toBe('示例·研发部');
  const updated = await session.fetch(`/departments/${department.id}`, {
    ...json({ title: 'Demo · Engineering edited by reviewer' }, 'PATCH'),
    headers: { ...json({}).headers, 'x-oa-trial-content-locale': 'en-US' },
  });
  expect(updated.status).toBe(200);
  expect((await fixture.organization.getDepartment(department.id))?.title).toBe(
    'Demo · Engineering edited by reviewer',
  );
  const invalid = await session.fetch(`/departments/${department.id}`, {
    method: 'PATCH',
    body: '{bad-json',
    headers: { ...json({}).headers, 'x-oa-trial-content-locale': 'en-US' },
  });
  expect(invalid.status).toBe(400);
}, 120000);
