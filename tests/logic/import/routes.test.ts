// @vitest-environment node
import { OA_TEST_ORIGIN } from '../oa-test-origin.ts';
import type { TestSession } from '@nocobase/app-plugin-authentication/testing';
import {
  apiDocsToken,
  findApiDocumentSchemaProblems,
  findUndeclaredApiRoutes,
  inspectApiRoutes,
} from '@nocobase/app-server/router';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  kindFile,
  startImportTestApp,
  upload,
  type ImportTestApp,
} from './helpers.ts';

interface Probe {
  readonly name: string;
  readonly path: string;
  readonly init?: () => Promise<RequestInit> | RequestInit;
  readonly action: 'read' | 'update';
}

describe('import routes', () => {
  let test: ImportTestApp;
  let nobody: TestSession;
  let reader: TestSession;
  let editor: TestSession;
  let runId: string;
  let contentUrl: string;

  beforeAll(async () => {
    test = await startImportTestApp();
    nobody = await test.createUser('Nobody');
    reader = await test.createUser('Reader');
    await test.grantImport(reader.user.id, ['read']);
    editor = await test.createUser('Editor');
    await test.grantImport(editor.user.id, ['read', 'update']);
    const run = await test.imports.run(
      'positions',
      await kindFile('positions', [{ code: 'RT', title: 'Route' }]),
      editor.user.id,
    );
    runId = run.id;
    contentUrl = run.file!.contentUrl;
  }, 120_000);

  afterAll(async () => {
    await test?.close();
  });

  const positionsFile = () =>
    kindFile('positions', [{ code: 'RT2', title: 'Route 2' }]);

  function probes(): Probe[] {
    return [
      {
        name: 'template',
        path: '/imports/templates/employees',
        action: 'read',
      },
      { name: 'list', path: '/imports', action: 'read' },
      { name: 'get', path: `/imports/${runId}`, action: 'read' },
      {
        name: 'preview',
        path: '/imports/preview',
        init: async () => upload('positions', await positionsFile()),
        action: 'update',
      },
      {
        name: 'run',
        path: '/imports',
        init: async () => upload('positions', await positionsFile()),
        action: 'update',
      },
    ];
  }

  it('answers 401 without a session, also for the retained file', async () => {
    for (const probe of probes()) {
      const response = await test.testApp.request(
        probe.path,
        await probe.init?.(),
      );
      expect({ probe: probe.name, status: response.status }).toEqual({
        probe: probe.name,
        status: 401,
      });
    }
    const file = await test.testApp.fetch(
      new Request(`http://localhost${contentUrl}`),
    );
    expect(file.status).toBe(401);
  });

  it('answers 403 without the settings item, and to a reader on writes, before reading the body', async () => {
    for (const probe of probes()) {
      const denied = await nobody.fetch(probe.path, await probe.init?.());
      expect({ probe: probe.name, status: denied.status }).toEqual({
        probe: probe.name,
        status: 403,
      });
      if (probe.action === 'update') {
        const response = await reader.fetch(probe.path, await probe.init?.());
        expect({ probe: probe.name, status: response.status }).toEqual({
          probe: probe.name,
          status: 403,
        });
      }
    }
    // An invalid body is still 403 for a caller without the action.
    expect(
      (await reader.fetch('/imports', upload('nope', 'not a file'))).status,
    ).toBe(403);
    const file = await test.testApp.fetch(
      new Request(`http://localhost${contentUrl}`, {
        headers: { cookie: nobody.cookie },
      }),
    );
    expect(file.status).toBe(403);
  });

  it('serves readers and editors', async () => {
    const template = await reader.fetch('/imports/templates/employees', {
      headers: { 'accept-language': 'zh-CN' },
    });
    expect(template.status).toBe(200);
    expect(template.headers.get('content-type')).toContain('spreadsheetml');
    expect(template.headers.get('content-disposition')).toContain(
      encodeURIComponent('员工档案导入模板.xlsx'),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await template.arrayBuffer());
    expect(workbook.getWorksheet('员工档案')?.getRow(1).getCell(1).value).toBe(
      '工号',
    );

    const list = await reader.fetch('/imports?pageSize=5');
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      data: { id: string }[];
      meta: { total: number; page: number; pageSize: number };
    };
    expect(listed.meta).toMatchObject({ page: 1, pageSize: 5 });
    expect(listed.data.map((run) => run.id)).toContain(runId);

    const detail = await reader.fetch(`/imports/${runId}`);
    expect(detail.status).toBe(200);
    expect(
      ((await detail.json()) as { data: { status: string } }).data,
    ).toMatchObject({ status: 'succeeded', errors: [] });
    expect((await reader.fetch('/imports/missing')).status).toBe(404);

    const file = await test.testApp.fetch(
      new Request(`http://localhost${contentUrl}`, {
        headers: { cookie: reader.cookie },
      }),
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('positions.xlsx');

    const preview = await editor.fetch(
      '/imports/preview',
      upload('positions', await positionsFile()),
    );
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as { data: unknown }).data).toMatchObject({
      result: 'ok',
      createdCount: 1,
    });

    const run = await editor.fetch(
      '/imports',
      upload('positions', await positionsFile()),
    );
    expect(run.status).toBe(201);
    expect(((await run.json()) as { data: unknown }).data).toMatchObject({
      status: 'succeeded',
      createdCount: 1,
      actor: { id: editor.user.id },
    });
  });

  it('rejects malformed uploads', async () => {
    const wrongKind = await editor.fetch(
      '/imports/preview',
      upload('nope', await positionsFile()),
    );
    expect(wrongKind.status).toBe(400);
    expect(await wrongKind.json()).toMatchObject({
      error: { reason: 'INVALID_KIND' },
    });
    const notXlsx = await editor.fetch(
      '/imports/preview',
      upload('positions', new File(['a,b'], 'data.csv')),
    );
    expect(notXlsx.status).toBe(400);
    const json = await editor.fetch('/imports/preview', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: OA_TEST_ORIGIN,
      },
      body: '{}',
    });
    expect(json.status).toBe(415);
    const big = await editor.fetch(
      '/imports/preview',
      upload(
        'positions',
        new File([new Uint8Array(6 * 1024 * 1024)], 'big.xlsx'),
      ),
    );
    expect(big.status).toBe(413);
    // A file that is named .xlsx but is not a workbook is a report, not an error.
    const garbage = await editor.fetch(
      '/imports/preview',
      upload('positions', new File(['nope'], 'fake.xlsx')),
    );
    expect(garbage.status).toBe(200);
    expect(await garbage.json()).toMatchObject({
      data: { result: 'invalid', errors: [{ code: 'FILE_UNREADABLE' }] },
    });
  });

  it('declares every route for the API document', async () => {
    const application = test.testApp.application;
    expect(findUndeclaredApiRoutes(application)).toEqual([]);
    const document = await application.container
      .resolve(apiDocsToken)
      .getDocument();
    expect(findApiDocumentSchemaProblems(document)).toEqual([]);
    const ids = inspectApiRoutes(application)
      .filter(({ path }) => /^\/api\/(imports|importFiles)(\/|$)/u.test(path))
      .map(({ operationId }) => operationId)
      .sort();
    expect(ids).toEqual([
      'downloadImportTemplate',
      'getImport',
      'listImports',
      'previewImport',
      'runImport',
    ]);
  });
});
