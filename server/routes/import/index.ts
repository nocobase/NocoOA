import { getRequestLocale } from '@nocobase/i18n/server';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponse,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  defineRootRoutes,
  describeRoute,
  listResponse,
  type AppApiRouteContribution,
  type AppRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import {
  IMPORT_DOMAIN,
  IMPORT_FILES_COLLECTION,
  IMPORT_FILES_DISK,
  IMPORT_FILES_PATH,
  IMPORT_KINDS,
  IMPORT_SETTINGS,
  importServiceToken,
  MAX_FILE_BYTES,
  type ImportKind,
} from '../../providers/import/index.js';
import {
  ImportReportSchema,
  ImportRunDetailSchema,
  ImportRunParams,
  ImportRunSchema,
  ImportUploadBody,
  ListImportRunsQuery,
  PageMeta,
  TemplateParams,
} from './schemas.js';

type ImportEnv = AuthorizationEnv & AuthEnv;

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Template file names, in Chinese like the workbooks. */
const TEMPLATE_NAMES: Readonly<Record<ImportKind, string>> = {
  departments: '部门导入模板.xlsx',
  positions: '岗位导入模板.xlsx',
  grades: '职级导入模板.xlsx',
  employees: '员工档案导入模板.xlsx',
  dutyRoleMembers: '角色池成员导入模板.xlsx',
};

/** Multipart overhead allowed on top of the workbook itself. */
const BODY_LIMIT = MAX_FILE_BYTES + 64 * 1024;

function importError(
  reason: string,
  message: string,
  httpStatus?: 413 | 415,
  field?: string,
): ApiError {
  return new ApiError({
    status: 'INVALID_ARGUMENT',
    reason,
    domain: IMPORT_DOMAIN,
    message,
    ...(httpStatus ? { httpStatus } : {}),
    ...(field ? { fieldViolations: [{ field, description: message }] } : {}),
  });
}

/** Checked before the body is read, so a caller without the action learns nothing about its input. */
function requireImport(
  action: 'read' | 'update',
): MiddlewareHandler<ImportEnv> {
  return async (c, next) => {
    await c.get('authz').require({
      resource: { type: 'settings', id: IMPORT_SETTINGS },
      action,
    });
    await next();
  };
}

/** The workbook and kind of a multipart upload, validated in code: a multipart body has no JSON schema. */
async function readUpload(
  c: Context<ImportEnv>,
): Promise<{ kind: ImportKind; file: File }> {
  if (!c.req.header('content-type')?.startsWith('multipart/form-data'))
    throw importError(
      'UNSUPPORTED_MEDIA_TYPE',
      'The body must be multipart/form-data.',
      415,
    );
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch (cause) {
    throw new ApiError({
      status: 'INVALID_ARGUMENT',
      reason: 'INVALID_MULTIPART',
      domain: IMPORT_DOMAIN,
      message: 'The multipart body cannot be read.',
      cause,
    });
  }
  const kind = body.kind;
  if (typeof kind !== 'string' || !IMPORT_KINDS.includes(kind as ImportKind))
    throw importError(
      'INVALID_KIND',
      `\`kind\` is one of ${IMPORT_KINDS.join(', ')}.`,
      undefined,
      'kind',
    );
  const file = body.file;
  if (!(file instanceof File) || !/\.xlsx$/iu.test(file.name))
    throw importError(
      'INVALID_FILE',
      '`file` is one `.xlsx` workbook.',
      undefined,
      'file',
    );
  if (file.size > MAX_FILE_BYTES)
    throw importError(
      'BODY_TOO_LARGE',
      `The workbook exceeds ${MAX_FILE_BYTES} bytes.`,
      413,
    );
  return { kind: kind as ImportKind, file };
}

const uploadErrors = {
  ...apiErrorResponses,
  400: apiErrorResponse(
    400,
    'The body is not readable multipart (`INVALID_MULTIPART`), `kind` is not a known kind (`INVALID_KIND`) or `file` is not one `.xlsx` workbook (`INVALID_FILE`). Problems inside the workbook are not errors: they are the report.',
  ),
  413: apiErrorResponse(413, 'The workbook exceeds 5 MiB (`BODY_TOO_LARGE`).'),
  415: apiErrorResponse(
    415,
    'The body is not `multipart/form-data` (`UNSUPPORTED_MEDIA_TYPE`).',
  ),
};

const uploadBody = {
  required: true,
  content: { 'multipart/form-data': { schema: ImportUploadBody } },
};

function limitBody(): MiddlewareHandler<ImportEnv> {
  return bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) =>
      apiErrorHandler(
        importError(
          'BODY_TOO_LARGE',
          `The workbook exceeds ${MAX_FILE_BYTES} bytes.`,
          413,
        ),
        c,
      ),
  });
}

/** `/api/imports`: templates, preview, import and history. Every route authenticates and checks `settings:oa.import`. */
export const importApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const imports = app.container.resolve(importServiceToken);
    const routes = new Hono<ImportEnv>();
    routes.use('*', auth.required(), authz.middleware());
    const tags = ['Imports'];
    const READ = `Requires \`settings:${IMPORT_SETTINGS}\` \`read\`.`;
    const UPDATE = `Requires \`settings:${IMPORT_SETTINGS}\` \`update\`.`;

    routes.get(
      '/templates/:kind',
      requireImport('read'),
      describeRoute({
        tags,
        summary: 'Download an import template',
        operationId: 'downloadImportTemplate',
        description: `An \`.xlsx\` workbook with the kind's header row (in the request language) and an instructions sheet. ${READ}`,
        responses: {
          200: {
            description: 'The template workbook.',
            content: {
              [XLSX_TYPE]: { schema: { type: 'string', format: 'binary' } },
            },
          },
          ...apiErrorResponses,
        },
      }),
      apiValidator('param', TemplateParams),
      async (c) => {
        const { kind } = c.req.valid('param');
        const locale = getRequestLocale(c) ?? 'en-US';
        const bytes = await imports.template(kind, locale);
        return c.body(bytes, 200, {
          'Content-Type': XLSX_TYPE,
          'Content-Disposition': `attachment; filename="${kind}-template.xlsx"; filename*=UTF-8''${encodeURIComponent(locale === 'en-US' ? `${kind}-template.xlsx` : TEMPLATE_NAMES[kind])}`,
          'Cache-Control': 'no-store',
        });
      },
    );

    routes.post(
      '/preview',
      requireImport('update'),
      limitBody(),
      describeRoute({
        tags,
        summary: 'Check an import file',
        operationId: 'previewImport',
        description: `Validates the whole workbook and, when it has no errors, applies it inside a transaction that is then rolled back, so the counts are exactly what an import would write. Writes nothing and records nothing; a report with \`result: "invalid"\` lists the first 200 row errors. ${UPDATE}`,
        requestBody: uploadBody,
        responses: {
          200: dataResponse(ImportReportSchema, 'What the file would do.'),
          ...uploadErrors,
        },
      }),
      async (c) => {
        const { kind, file } = await readUpload(c);
        const report = await imports.preview(
          kind,
          file,
          c.get('auth')?.user.id ?? null,
        );
        return c.json({ data: report });
      },
    );

    routes.post(
      '/',
      requireImport('update'),
      limitBody(),
      describeRoute({
        tags,
        summary: 'Import a file',
        operationId: 'runImport',
        description: `Keeps the workbook, then validates and applies it in one transaction: either every row is written (\`status: "succeeded"\`) or none is (\`status: "failed"\`, with the row errors). Either way the attempt is recorded in the history with one audit entry; each record the import changes is also audited by its own service with the reason \`import:<run id>\`. Accounts are never created: rows name existing users. ${UPDATE}`,
        requestBody: uploadBody,
        responses: {
          201: dataResponse(ImportRunDetailSchema, 'The recorded attempt.'),
          ...uploadErrors,
        },
      }),
      async (c) => {
        const { kind, file } = await readUpload(c);
        const run = await imports.run(
          kind,
          file,
          c.get('auth')?.user.id ?? null,
        );
        return c.json({ data: run }, 201);
      },
    );

    routes.get(
      '/',
      requireImport('read'),
      describeRoute({
        tags,
        summary: 'List imports',
        operationId: 'listImports',
        description: `Import attempts, newest first, without their row errors. ${READ}`,
        responses: {
          200: listResponse(ImportRunSchema, PageMeta),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', ListImportRunsQuery),
      async (c) => {
        const query = c.req.valid('query');
        const { items, total } = await imports.listRuns(query);
        return c.json({
          data: items,
          meta: { total, page: query.page, pageSize: query.pageSize },
        });
      },
    );

    routes.get(
      '/:runId',
      requireImport('read'),
      describeRoute({
        tags,
        summary: 'Get an import',
        operationId: 'getImport',
        description: `One import attempt with the row errors of a failed one. ${READ}`,
        responses: {
          200: dataResponse(ImportRunDetailSchema),
          ...apiErrorResponses,
          404: apiErrorResponse(
            404,
            'The import does not exist (`IMPORT_NOT_FOUND`).',
          ),
        },
      }),
      apiValidator('param', ImportRunParams),
      async (c) => {
        const run = await imports.getRun(c.req.valid('param').runId);
        if (!run)
          throw new ApiError({
            status: 'NOT_FOUND',
            reason: 'IMPORT_NOT_FOUND',
            domain: IMPORT_DOMAIN,
            message: 'The import does not exist.',
          });
        return c.json({ data: run });
      },
    );

    const router = new Hono();
    router.route('/imports', routes);
    return router;
  });

/**
 * Guards the retained workbooks. The file plugin serves `IMPORT_FILES_PATH/<uuid>.xlsx` publicly; this contribution is
 * registered before it and requires a signed-in user holding `settings:oa.import` `read` on exactly that path.
 */
const importFilesGuard: AppRouteContribution<Application> = defineRootRoutes(
  (app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const guard = new Hono<ImportEnv>();
    guard.use(
      `${IMPORT_FILES_PATH}/*`,
      auth.required(),
      authz.middleware(),
      requireImport('read'),
    );
    guard.onError((error, c) => apiErrorHandler(error, c));
    const router = new Hono();
    router.route('/', guard);
    return router;
  },
);

/**
 * The file plugin's routes for `importFiles`: only the content route, since uploads happen on the server inside the
 * import. No API action is exposed.
 */
const importFileRoutes = defineFileRepositoryApiRoutes({
  repositories: [
    {
      name: IMPORT_FILES_COLLECTION,
      disk: IMPORT_FILES_DISK,
      accessPath: IMPORT_FILES_PATH,
      accessMode: 'stream',
      policy: { read: false, create: false, update: false, delete: false },
      actions: {},
    },
  ],
});

/** HTTP routes of the `import` OA module, registered through `server/routes/index.ts`. */
const importRoutes: readonly AppRouteContribution<Application>[] = [
  importApiRoutes,
  importFilesGuard,
  ...(importFileRoutes as readonly AppRouteContribution<Application>[]),
];

export default importRoutes;
