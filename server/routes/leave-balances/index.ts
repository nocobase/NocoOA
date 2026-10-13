import {
  authenticationToken,
  userAdministrationServiceToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiValidator,
  dataResponse,
  defineApiRoutes,
  describeRoute,
  listResponse,
  type AppApiRouteContribution,
  type AppRouteContribution,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { employeeServiceToken } from '../../providers/employees/contract.js';
import { dictionaryServiceToken } from '../../providers/platform/dictionaries.js';
import {
  leaveBalanceServiceToken,
  LEAVE_BALANCE_SETTINGS,
  LeaveBalanceError,
} from '../../providers/leave-balances/index.js';
import {
  AdjustmentInput,
  BalanceSchema,
  EmployeeParams,
  LedgerQuery,
  LedgerSchema,
} from './schemas.js';
type Env = AuthEnv & AuthorizationEnv;
const meta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export const leaveBalanceApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const c = app.container;
    const balances = c.resolve(leaveBalanceServiceToken);
    const employees = c.resolve(employeeServiceToken);
    const db = c.resolve(databaseManagerToken);
    const router = new Hono<Env>();
    router.use(
      '/leaveBalances/*',
      c.resolve(authenticationToken).required(),
      c.resolve(authorizationToken).middleware(),
    );
    router.onError((error, context) =>
      apiErrorHandler(
        error instanceof LeaveBalanceError
          ? new ApiError({
              status:
                error.code.includes('INVALID') || error.code.includes('REASON')
                  ? 'INVALID_ARGUMENT'
                  : 'FAILED_PRECONDITION',
              reason: error.code,
              domain: 'nb3-oa',
              message: error.message,
              cause: error,
            })
          : error,
        context,
      ),
    );
    const description = (
      operationId: string,
      summary: string,
      schema: z.ZodType,
      list = false,
    ) =>
      describeRoute({
        tags: ['LeaveBalances'],
        operationId,
        summary,
        responses: {
          '200': list ? listResponse(schema, meta) : dataResponse(schema),
          ...apiErrorResponses,
        },
      });
    async function ownEmployee(userId: string) {
      const employee = await employees.getByUserId(userId);
      if (!employee)
        throw new ApiError({
          status: 'NOT_FOUND',
          reason: 'EMPLOYEE_NOT_FOUND',
          domain: 'nb3-oa',
          message: 'No employee archive is bound to this user.',
        });
      return employee;
    }
    async function ledgerView(
      employeeId: string,
      query: z.infer<typeof LedgerQuery>,
    ) {
      const result = await balances.ledger(
        { employeeId, leaveType: query.leaveType },
        query.page,
        query.pageSize,
        { field: query.sortBy, direction: query.sortDirection },
      );
      const ids = [
        ...new Set(
          result.items
            .map((i) => i.actorId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const users = ids.length
        ? (
            await c
              .resolve(userAdministrationServiceToken)
              .list({ userIds: ids, pageSize: 100, kind: 'all' })
          ).items
        : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      return {
        data: result.items.map((i) => ({
          ...i,
          at: i.at.toISOString(),
          expiresAt: i.expiresAt?.toISOString() ?? null,
          actor: i.actorId
            ? { id: i.actorId, name: names.get(i.actorId) ?? i.actorId }
            : null,
        })),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
        },
      };
    }
    router.get(
      '/leaveBalances/me',
      description(
        'listMyLeaveBalances',
        'List the current employee leave balances',
        z.array(BalanceSchema),
      ),
      async (ctx) => {
        // Account administrators need not have a personal employee archive.
        const employee = await employees.getByUserId(ctx.get('auth')!.user.id);
        return ctx.json({
          data: employee ? await balances.list(employee.id) : [],
        });
      },
    );
    router.get(
      '/leaveBalances/me/ledger',
      description(
        'listMyLeaveLedger',
        'List the current employee leave ledger',
        LedgerSchema,
        true,
      ),
      apiValidator('query', LedgerQuery),
      async (ctx) =>
        ctx.json(
          await ledgerView(
            (await ownEmployee(ctx.get('auth')!.user.id)).id,
            ctx.req.valid('query'),
          ),
        ),
    );
    const hr = new Hono<Env>();
    hr.use('*', async (ctx, next) => {
      await ctx.get('authz').require({
        resource: { type: 'settings', id: LEAVE_BALANCE_SETTINGS },
        action: ctx.req.method === 'GET' ? 'read' : 'update',
      });
      await next();
    });
    hr.get(
      '/:employeeId',
      description(
        'listEmployeeLeaveBalances',
        'List an employee leave balances',
        z.array(BalanceSchema),
      ),
      apiValidator('param', EmployeeParams),
      async (ctx) =>
        ctx.json({
          data: await balances.list(ctx.req.valid('param').employeeId),
        }),
    );
    hr.get(
      '/:employeeId/ledger',
      description(
        'listEmployeeLeaveLedger',
        'List an employee leave ledger',
        LedgerSchema,
        true,
      ),
      apiValidator('param', EmployeeParams),
      apiValidator('query', LedgerQuery),
      async (ctx) =>
        ctx.json(
          await ledgerView(
            ctx.req.valid('param').employeeId,
            ctx.req.valid('query'),
          ),
        ),
    );
    hr.post(
      '/:employeeId/adjust',
      description(
        'adjustEmployeeLeaveBalance',
        'Adjust an employee leave balance with an audit reason',
        BalanceSchema,
      ),
      apiValidator('param', EmployeeParams),
      apiValidator('json', AdjustmentInput),
      async (ctx) => {
        const employeeId = ctx.req.valid('param').employeeId;
        const input = ctx.req.valid('json');
        return ctx.json({
          data: await db.transaction(async (tx) => {
            if (!(await employees.getById(employeeId, tx)))
              throw new ApiError({
                status: 'NOT_FOUND',
                reason: 'EMPLOYEE_NOT_FOUND',
                domain: 'nb3-oa',
                message: 'The employee archive does not exist.',
              });
            const type = await c
              .resolve(dictionaryServiceToken)
              .get('leaveType', input.leaveType, tx);
            if (!type?.extra?.deductsBalance)
              throw new ApiError({
                status: 'INVALID_ARGUMENT',
                reason: 'LEAVE_TYPE_WITHOUT_BALANCE',
                domain: 'nb3-oa',
                message: 'This leave type does not use a balance ledger.',
              });
            return balances.adjust(
              {
                ...input,
                employeeId,
                actorId: ctx.get('auth')!.user.id,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              },
              tx,
            );
          }),
        });
      },
    );
    router.route('/leaveBalances', hr);
    const root = new Hono();
    root.route('/', router);
    return root;
  });
export const leaveBalanceRoutes: AppRouteContribution<Application>[] = [
  leaveBalanceApiRoutes,
];
export default leaveBalanceRoutes;
