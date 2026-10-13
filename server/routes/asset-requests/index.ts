import { assetSelectionServiceToken } from '../../providers/asset-requests/selection.js';
import { assetRequestPage } from '../../providers/asset-requests/list-query.js';
import { Hono, type Context } from 'hono';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { i18nToken } from '@nocobase/app-server/i18n';
import { getRequestLocale } from '@nocobase/i18n/server';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
  type AppRouteContribution,
} from '@nocobase/app-server/router';
import { RepositoryError } from '@nocobase/db';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { employeeServiceToken } from '../../providers/employees/contract.js';
import { orgServiceToken } from '../../providers/org/contract.js';
import { approvalDirectoryServiceToken } from '../../providers/approval-directory/contract.js';
import {
  calendarServiceToken,
  dictionaryServiceToken,
  localizeLabel,
} from '../../providers/platform/index.js';
import type { RepositoryPolicy } from '@nocobase/db';
import { LifecycleError, lifecycleErrorFields } from '@nocobase/lifecycle';
import { ApprovalError } from '@nocobase/app-plugin-approval/server';
import { AssetError } from '../../providers/assets/errors.js';
import { assetRequestServiceToken } from '../../providers/asset-requests/contract.js';
import { routes as photoRoutes } from './attachments.js';
import {
  Params,
  CreateInput,
  EditInput,
  LifecycleInput,
  ActionInput,
  ReturnInput,
  ListQuery,
  CandidatesQuery,
  RecordSchema,
  DetailSchema,
  CandidatesSchema,
  ValueSchema,
  ListMeta,
  OptionsSchema,
  EligibleAssetsQuery,
  EligibleAssetSchema,
} from './schemas.js';
type Env = AuthEnv & AuthorizationEnv;
export const routes: readonly AppRouteContribution<Application>[] = [
  defineApiRoutes<Application>((app) => {
    const c = app.container,
      service = c.resolve(assetRequestServiceToken),
      i18n = c.resolve(i18nToken),
      router = new Hono<Env>();
    router.use(
      '*',
      c.resolve(authenticationToken).required(),
      c.resolve(authorizationToken).middleware(),
    );
    router.onError(async (error, ctx) => {
      if (
        error instanceof AssetError ||
        (error instanceof RepositoryError &&
          error.status === 'PERMISSION_DENIED')
      ) {
        const denied = error instanceof RepositoryError,
          reason = denied ? 'ASSET_ACCESS_DENIED' : error.code,
          locale = getRequestLocale(ctx) ?? i18n.getDefaultLocale();
        await i18n.ensureLocaleLoaded(locale);
        const message = i18n.getFixedT('nb3-oa', locale)(
          `assetRequests.errors.${reason}`,
          { defaultValue: error.message },
        );
        return apiErrorHandler(
          new ApiError({
            status:
              denied ||
              (error instanceof AssetError && error.kind === 'permission')
                ? 'PERMISSION_DENIED'
                : error instanceof AssetError && error.kind === 'notFound'
                  ? 'NOT_FOUND'
                  : error instanceof AssetError && error.kind === 'conflict'
                    ? 'ABORTED'
                    : 'FAILED_PRECONDITION',
            domain: 'assetRequests',
            reason,
            message: error.message,
            localizedMessage: { locale, message },
            metadata: { ns: 'nb3-oa', key: `assetRequests.errors.${reason}` },
            cause: error,
          }),
          ctx,
        );
      }
      if (error instanceof LifecycleError) {
        const fields = lifecycleErrorFields(error);
        return apiErrorHandler(
          fields ? new ApiError({ ...fields, domain: 'assetRequests' }) : error,
          ctx,
        );
      }
      if (
        error instanceof ApprovalError &&
        !['INTERNAL', 'INVALID_EFFECT'].includes(error.code)
      )
        return apiErrorHandler(
          new ApiError({
            status:
              error.code === 'CONFLICT'
                ? 'ABORTED'
                : error.code === 'TASK_NOT_FOUND'
                  ? 'NOT_FOUND'
                  : [
                        'NOT_ASSIGNEE',
                        'INACTIVE',
                        'NOT_ALLOWED',
                        'NOT_IN_POOL',
                        'NOT_QUALIFIED',
                        'APPLICANT_NOT_ELIGIBLE',
                      ].includes(error.code)
                    ? 'PERMISSION_DENIED'
                    : 'FAILED_PRECONDITION',
            domain: 'assetRequests',
            reason: error.code,
            message: error.message,
          }),
          ctx,
        );
      return apiErrorHandler(error, ctx);
    });
    async function policy(
      ctx: Context<Env>,
      action: string,
    ): Promise<RepositoryPolicy> {
      const decision = await ctx.get('authz').authorize({
        resource: { type: 'composite', id: 'oa.assetRequests' },
        action,
      });
      const value =
        decision.effect === 'deny'
          ? undefined
          : (
              decision.conditions?.database as
                Record<string, RepositoryPolicy | false | undefined> | undefined
            )?.assetRequests;
      if (!value)
        throw new AssetError(
          'ASSET_ACCESS_DENIED',
          'No grant permits this asset request operation.',
          'permission',
        );
      return value;
    }
    const doc = (
      operationId: string,
      summary: string,
      schema: Parameters<typeof dataResponse>[0],
      status = '200',
    ) =>
      describeRoute({
        tags: ['Asset requests'],
        operationId,
        summary,
        responses: { [status]: dataResponse(schema), ...apiErrorResponses },
      });
    const actor = (ctx: Context<Env>) => ctx.get('auth')!.user.id;
    router.get(
      '/eligibleAssets',
      describeRoute({
        tags: ['Asset requests'],
        operationId: 'assetRequestEligibleAssets',
        summary: 'List safe assets for the authorized source operation',
        responses: {
          '200': listResponse(EligibleAssetSchema, ListMeta),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', EligibleAssetsQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        const action =
          query.purpose === 'scrap'
            ? query.requestId
              ? 'edit'
              : 'create'
            : query.mode === 'returnIssued'
              ? 'returnIssued'
              : 'operate';
        return ctx.json(
          await c
            .resolve(assetSelectionServiceToken)
            .list(
              actor(ctx),
              query,
              await policy(ctx, action),
              query.requestId ? await policy(ctx, 'view') : undefined,
            ),
        );
      },
    );
    router.get(
      '/options',
      doc(
        'assetRequestOptions',
        'Read current own employee, department and active asset categories',
        OptionsSchema,
      ),
      async (ctx) => {
        await policy(ctx, 'create');
        const id = actor(ctx),
          employee = await c.resolve(employeeServiceToken).getByUserId(id),
          department = await c.resolve(orgServiceToken).primaryDepartmentOf(id);
        const headId = department
          ? await c.resolve(orgServiceToken).headOf(department.id)
          : undefined;
        const head = headId
          ? await c.resolve(userAdministrationServiceToken).get(headId)
          : undefined;
        const directory = await c
          .resolve(approvalDirectoryServiceToken)
          .eligibility(headId ? [id, headId] : [id], ['admin']);
        const categories = (
          await c.resolve(dictionaryServiceToken).list('assetCategory')
        )
          .filter((entry) => entry.active)
          .map((entry) => ({
            code: entry.code,
            title: localizeLabel(
              entry.label,
              getRequestLocale(ctx) ?? i18n.getDefaultLocale(),
              entry.code,
            ),
          }));
        return ctx.json({
          data: {
            employee: employee
              ? {
                  id: employee.id,
                  name: employee.name,
                  status: employee.status,
                }
              : null,
            department: department
              ? { id: department.id, name: department.title }
              : null,
            head:
              head && directory.isActive(head.id)
                ? { id: head.id, name: head.name }
                : null,
            eligible:
              !!employee?.active &&
              ['probation', 'regular'].includes(employee.status),
            eligibleReason: !employee
              ? 'employeeMissing'
              : !employee.active
                ? 'inactive'
                : !['probation', 'regular'].includes(employee.status)
                  ? 'status'
                  : null,
            administrative:
              directory.isActive(id) && directory.hasRole(id, 'admin'),
            categories,
            timeZone: c.resolve(calendarServiceToken).timeZone(),
          },
        });
      },
    );
    router.get(
      '/',
      describeRoute({
        tags: ['Asset requests'],
        operationId: 'listAssetRequests',
        summary: 'List authorized asset applications',
        responses: {
          '200': listResponse(RecordSchema, ListMeta),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', ListQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        const readPolicy = await policy(ctx, 'view');
        const rows = await service.list(actor(ctx), query.view, readPolicy);
        return ctx.json(assetRequestPage(rows, query, readPolicy));
      },
    );
    router.get(
      '/:id',
      doc(
        'getAssetRequest',
        'Read authorized asset request and actual approval offers',
        DetailSchema,
      ),
      apiValidator('param', Params),
      async (ctx) =>
        ctx.json({
          data: await service.detail(
            ctx.req.valid('param').id,
            actor(ctx),
            await policy(ctx, 'view'),
          ),
        }),
    );
    router.get(
      '/:id/value',
      doc(
        'getAssetRequestValue',
        'Read independently authorized frozen asset original value',
        ValueSchema,
      ),
      apiValidator('param', Params),
      async (ctx) => {
        const id = ctx.req.valid('param').id;
        if (!(await service.get(id, undefined, await policy(ctx, 'view'))))
          throw new AssetError(
            'ASSET_REQUEST_NOT_FOUND',
            'Asset request not found.',
            'notFound',
          );
        const record = await service.get(
          id,
          undefined,
          await policy(ctx, 'viewValue'),
        );
        if (!record || !Object.hasOwn(record, 'originalValueCents'))
          throw new AssetError(
            'ASSET_ACCESS_DENIED',
            'The asset value field is not accessible.',
            'permission',
          );
        return ctx.json({
          data: { originalValueCents: record.originalValueCents },
        });
      },
    );
    router.get(
      '/:id/candidates',
      doc(
        'assetRequestCandidates',
        'Resolve eligible people for the real offered approval target',
        CandidatesSchema,
      ),
      apiValidator('param', Params),
      apiValidator('query', CandidatesQuery),
      async (ctx) => {
        const { targetId, action, ...query } = ctx.req.valid('query');
        const target = ['cc', 'appoint'].includes(action)
          ? { runId: targetId }
          : { taskId: targetId };
        return ctx.json({
          data: await service.candidates(
            ctx.req.valid('param').id,
            actor(ctx),
            target,
            action,
            query,
            await policy(ctx, 'view'),
          ),
        });
      },
    );
    router.post(
      '/',
      doc(
        'createAssetRequest',
        'Create a stable own asset application',
        RecordSchema,
        '201',
      ),
      apiValidator('json', CreateInput),
      async (ctx) => {
        const { requestId, ...values } = ctx.req.valid('json');
        const record = await service.create(
          actor(ctx),
          values,
          requestId,
          await policy(ctx, 'create'),
        );
        return ctx.json({ data: record }, 201);
      },
    );
    router.patch(
      '/:id',
      doc(
        'editAssetRequest',
        'Edit an own editable asset application using its actual version',
        RecordSchema,
      ),
      apiValidator('param', Params),
      apiValidator('json', EditInput),
      async (ctx) =>
        ctx.json({
          data: await service.edit(
            ctx.req.valid('param').id,
            actor(ctx),
            ctx.req.valid('json'),
            await policy(ctx, 'edit'),
          ),
        }),
    );
    router.post(
      '/:id/lifecycle',
      doc(
        'transitionAssetRequest',
        'Submit, withdraw or administratively terminate an eligible request',
        DetailSchema,
      ),
      apiValidator('param', Params),
      apiValidator('json', LifecycleInput),
      async (ctx) => {
        const id = ctx.req.valid('param').id,
          { action, ...input } = ctx.req.valid('json');
        await service.act(
          id,
          actor(ctx),
          action,
          input,
          await policy(ctx, 'operate'),
        );
        return ctx.json({
          data: await service.detail(id, actor(ctx), await policy(ctx, 'view')),
        });
      },
    );
    router.post(
      '/:id/action',
      doc(
        'performAssetRequestAction',
        'Perform an actual SDK approval or physical handling offer',
        DetailSchema,
      ),
      apiValidator('param', Params),
      apiValidator('json', ActionInput),
      async (ctx) => {
        const id = ctx.req.valid('param').id;
        await service.action(
          id,
          actor(ctx),
          { ...ctx.req.valid('json'), actor: { id: actor(ctx) } },
          await policy(ctx, 'operate'),
        );
        return ctx.json({
          data: await service.detail(id, actor(ctx), await policy(ctx, 'view')),
        });
      },
    );
    router.post(
      '/:id/return',
      doc(
        'returnIssuedAssetRequest',
        'Administratively receive all actually issued permanent-use units',
        DetailSchema,
      ),
      apiValidator('param', Params),
      apiValidator('json', ReturnInput),
      async (ctx) => {
        const id = ctx.req.valid('param').id;
        await service.returnIssued(
          id,
          actor(ctx),
          ctx.req.valid('json'),
          await policy(ctx, 'returnIssued'),
        );
        return ctx.json({
          data: await service.detail(id, actor(ctx), await policy(ctx, 'view')),
        });
      },
    );
    const root = new Hono();
    root.route('/assetRequests', router);
    return root;
  }),
  ...photoRoutes,
];
export default routes;
