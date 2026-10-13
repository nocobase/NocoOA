import { orgServiceToken } from '../../providers/org/contract.js';
import { dictionaryServiceToken } from '../../providers/platform/dictionaries.js';
import ExcelJS from 'exceljs';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorResponses,
  apiValidator,
  defineApiRoutes,
  describeRoute,
  listResponse,
  dataResponse,
  type AppRouteContribution,
} from '@nocobase/app-server/router';
import { databaseManagerToken, type RepositoryPolicy } from '@nocobase/db';
import {
  budgetServiceToken,
  BUDGET_SETTINGS,
} from '../../providers/budgets/index.js';
import { contractHttpServiceToken } from '../../providers/contracts/service.js';
import { headcountServiceToken } from '../../providers/headcounts/index.js';
import { ContractError } from '../../providers/contracts/errors.js';
import { leaveServiceToken } from '../../providers/leave/index.js';
import { LeaveError } from '../../providers/leave/errors.js';
import { allRows } from './export.js';
import * as S from './schemas.js';

type Env = AuthEnv & AuthorizationEnv;
const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function reportMeta(
  page: number,
  pageSize: number,
  total: number,
  query: Record<string, string | number | undefined>,
) {
  return {
    page,
    pageSize,
    total,
    generatedAt: new Date().toISOString(),
    filters: Object.fromEntries(
      Object.entries(query).filter(
        ([key, value]) =>
          key !== 'page' && key !== 'pageSize' && value !== undefined,
      ),
    ) as Record<string, string | number>,
  };
}

function exportDoc(operationId: string, summary: string) {
  return describeRoute({
    tags: ['Reports'],
    operationId,
    summary,
    description:
      'Exports at most 10,000 rows under the current originating resource and field policies. Authorization is rechecked for every page.',
    responses: {
      200: {
        description: 'The authorized report workbook.',
        content: {
          [XLSX_TYPE]: { schema: { type: 'string', format: 'binary' } },
        },
      },
      ...apiErrorResponses,
    },
  });
}

async function policy(
  ctx: Context<Env>,
  resource: string,
  action: string,
  collection: string,
): Promise<RepositoryPolicy> {
  const decision = await ctx.get('authz').authorize({
    resource: { type: 'composite', id: resource },
    action,
  });
  const policies = decision.conditions?.database as
    Record<string, RepositoryPolicy | false | undefined> | undefined;
  if (
    decision.effect === 'deny' ||
    !policies?.[collection] ||
    policies[collection].read === false
  )
    throw new ApiError({
      status: 'PERMISSION_DENIED',
      domain: 'reports',
      reason: 'SOURCE_ACCESS_DENIED',
      message: 'This report source is outside the current granted scope.',
    });
  return policies[collection];
}

async function xlsx(
  rows: readonly Record<string, unknown>[],
  columns: readonly { header: string; key: string }[],
  filename: string,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NocoBase OA';
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = columns.map((column) => ({ ...column, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows)
    sheet.addRow({
      ...row,
      subject:
        (row.subjectLabel as Record<string, string> | null)?.['en-US'] ??
        row.subject,
      available: row.initialized === false ? null : row.available,
    });
  const body = Buffer.from(await workbook.xlsx.writeBuffer());
  return new Response(body, {
    headers: {
      'content-type': XLSX_TYPE,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

/** Read-only report projections always authorize against the originating source. */
const routes: readonly AppRouteContribution<Application>[] = [
  defineApiRoutes((app) => {
    const c = app.container;
    const budgets = c.resolve(budgetServiceToken);
    const headcounts = c.resolve(headcountServiceToken);
    const contracts = c.resolve(contractHttpServiceToken);
    const leave = c.resolve(leaveServiceToken);
    const db = c.resolve(databaseManagerToken);
    const org = c.resolve(orgServiceToken);
    const dictionaries = c.resolve(dictionaryServiceToken);
    const departmentName = async (id: string) =>
      (await org.activeChain(id))?.[0]?.title ?? null;

    const router = new Hono<Env>();
    router.use(
      '*',
      c.resolve(authenticationToken).required(),
      c.resolve(authorizationToken).middleware(),
    );

    // Capability metadata contains no records or counts. Every dataset request still rechecks its source policy.
    router.get(
      '/datasets',
      describeRoute({
        tags: ['Reports'],
        operationId: 'listAvailableReportDatasets',
        summary:
          'Report datasets permitted by current source actions and fields',
        responses: {
          200: dataResponse(z.array(z.string())),
          ...apiErrorResponses,
        },
      }),
      async (ctx) => {
        const available: string[] = [];
        const canRead = async (
          resource: string,
          action: string,
          collection: string,
          fields: readonly string[],
        ) => {
          const decision = await ctx.get('authz').authorize({
            resource: { type: 'composite', id: resource },
            action,
          });
          const p = (
            decision.conditions?.database as
              Record<string, RepositoryPolicy | false | undefined> | undefined
          )?.[collection];
          if (decision.effect === 'deny' || !p || !p.read) return false;
          const permitted =
            typeof p.read === 'object' ? p.read.fields : undefined;
          return (
            permitted !== false &&
            (!Array.isArray(permitted) ||
              permitted.includes('*') ||
              fields.every((f) => permitted.includes(f)))
          );
        };
        const budget = await ctx.get('authz').authorize({
          resource: { type: 'settings', id: BUDGET_SETTINGS },
          action: 'read',
        });
        if (budget.effect !== 'deny') available.push('budget-balances');
        if (
          (await canRead('oa.contract', 'ledger', 'contracts', [
            'id',
            'requestId',
            'status',
            'number',
            'version',
            'amountCents',
            'facts',
            'applicantId',
            'departmentId',
          ])) &&
          (await canRead('oa.contract', 'ledger', 'contractVersions', [
            'id',
            'facts',
            'amountCents',
            'status',
          ])) &&
          (await canRead('oa.contract', 'view', 'contractRequests', [
            'id',
            'startsOn',
            'endsOn',
            'amountCents',
            'departmentId',
            'number',
            'status',
          ]))
        )
          available.push('contract-ledger');
        if (
          await canRead('oa.headcounts', 'view', 'headcountAccounts', [
            'id',
            'departmentId',
            'positionId',
            'year',
            'limit',
            'initialized',
            'version',
            'createdAt',
            'updatedAt',
          ])
        )
          available.push('headcount-balances');
        if (
          await canRead('oa.leave', 'view', 'leaveRequests', [
            'id',
            'status',
            'startDate',
            'leaveType',
            'days',
          ])
        )
          available.push('leave-monthly');
        if (
          await canRead('oa.leave', 'view', 'leaveRequests', [
            'id',
            'applicantId',
            'createdById',
            'number',
            'leaveType',
            'startDate',
            'endDate',
            'startHalf',
            'endHalf',
            'days',
            'reason',
            'attachments',
            'handoverUserId',
            'enableDelegation',
            'ruleSnapshot',
            'hrRecipients',
            'requiresHr',
            'managerApproverId',
            'status',
            'lifecycleVersion',
            'createdAt',
          ])
        )
          available.push('leave-approval-efficiency');
        if (
          await canRead('oa.reimbursement', 'view', 'reimbursementRequests', [
            'id',
            'status',
            'lines',
            'totalCents',
            'offsetCents',
            'paymentId',
          ])
        )
          available.push('expense-summary');
        ctx.header('Cache-Control', 'no-store');
        return ctx.json({ data: available });
      },
    );

    const budgetRows = async (
      ctx: Context<Env>,
      q: z.infer<typeof S.ListQuery>,
    ) => {
      await ctx.get('authz').require({
        resource: { type: 'settings', id: BUDGET_SETTINGS },
        action: 'read',
      });
      const result = await budgets.list({
        ...q,
        sort: 'year',
        direction: 'desc',
      });
      return {
        data: await Promise.all(
          result.items.map(async (row) =>
            S.BudgetRow.parse({
              ...row,
              departmentName: await departmentName(row.departmentId),
              subjectLabel:
                (await dictionaries.get('budgetSubject', row.subject))?.label ??
                null,
            }),
          ),
        ),
        meta: reportMeta(result.page, q.pageSize, result.total, q),
      };
    };
    const headcountRows = async (
      ctx: Context<Env>,
      q: z.infer<typeof S.HeadcountListQuery>,
    ) => {
      const result = await headcounts.list(
        q,
        db.connection(),
        await policy(ctx, 'oa.headcounts', 'view', 'headcountAccounts'),
      );
      return {
        data: await Promise.all(
          result.items.map(async (row) =>
            S.HeadcountRow.parse({
              departmentName: await departmentName(row.departmentId),
              positionName:
                (await org.listPositions()).find((p) => p.id === row.positionId)
                  ?.title ?? null,
              ...row,
              capacityState: !row.initialized
                ? 'uninitialized'
                : row.replacementBlocked > 0
                  ? 'blocked'
                  : 'ready',
            }),
          ),
        ),
        meta: reportMeta(q.page, q.pageSize, result.total, q),
      };
    };
    const contractRows = async (
      ctx: Context<Env>,
      q: z.infer<typeof S.ContractListQuery>,
    ) => {
      const result = await contracts
        .reportList(
          q,
          await policy(ctx, 'oa.contract', 'ledger', 'contracts'),
          await policy(ctx, 'oa.contract', 'ledger', 'contractVersions'),
          await policy(ctx, 'oa.contract', 'view', 'contractRequests'),
        )
        .catch((error: unknown) => {
          if (
            error instanceof ContractError &&
            /FIELDS_RESTRICTED|ACCESS_DENIED/.test(error.code)
          )
            throw new ApiError({
              status: 'PERMISSION_DENIED',
              domain: 'reports',
              reason: 'SOURCE_FIELDS_DENIED',
              message:
                'The report fields are outside the current source policy.',
            });
          throw error;
        });
      return {
        data: await Promise.all(
          result.data.map(async (row) =>
            S.ContractRow.parse({
              ...row,
              departmentName: await departmentName(row.departmentId),
            }),
          ),
        ),
        meta: {
          ...reportMeta(
            result.meta.page,
            result.meta.pageSize,
            result.meta.total,
            q,
          ),
        },
      };
    };
    const doc = (operationId: string, summary: string, schema: z.ZodType) =>
      describeRoute({
        tags: ['Reports'],
        operationId,
        summary,
        responses: { 200: listResponse(schema, S.Meta), ...apiErrorResponses },
      });

    const leaveRows = async (
      ctx: Context<Env>,
      q: z.infer<typeof S.LeaveMonthlyQuery>,
    ) => {
      const result = await leave
        .monthlyReport(
          q,
          await policy(ctx, 'oa.leave', 'view', 'leaveRequests'),
        )
        .catch((error: unknown) => {
          if (error instanceof LeaveError)
            throw new ApiError({
              status:
                error.kind === 'permission'
                  ? 'PERMISSION_DENIED'
                  : 'FAILED_PRECONDITION',
              domain: 'reports',
              reason: error.code,
              message: error.message,
            });
          throw error;
        });
      return {
        data: result.data.map((row) => S.LeaveMonthlyRow.parse(row)),
        meta: reportMeta(q.page, q.pageSize, result.total, {
          ...q,
          year: result.year,
        }),
      };
    };
    router.get(
      '/leave-monthly',
      doc(
        'listLeaveMonthlyReport',
        'List authorized approved leave requests by original start month',
        S.LeaveMonthlyRow,
      ),
      apiValidator('query', S.LeaveMonthlyQuery),
      async (ctx) => ctx.json(await leaveRows(ctx, ctx.req.valid('query'))),
    );
    router.get(
      '/leave-monthly.xlsx',
      exportDoc(
        'exportLeaveMonthlyReport',
        'Export approved request volume by original start month',
      ),
      apiValidator('query', S.LeaveMonthlyQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        // The owner bounds source records before grouping; load once to avoid repeated full aggregation.
        const { data: rows } = await leaveRows(ctx, {
          ...query,
          page: 1,
          pageSize: 10_000,
        });
        return xlsx(
          rows,
          [
            { header: 'Year', key: 'year' },
            { header: 'Start month', key: 'month' },
            { header: 'Leave type', key: 'leaveType' },
            { header: 'Approved request count', key: 'approvedRequestCount' },
            {
              header: 'Approved requested days (before cancellation)',
              key: 'approvedRequestedDays',
            },
          ],
          'leave-monthly.xlsx',
        );
      },
    );

    router.get(
      '/budget-balances',
      doc(
        'listBudgetBalanceReport',
        'List authorized budget balance report rows',
        S.BudgetRow,
      ),
      apiValidator('query', S.ListQuery),
      async (ctx) => ctx.json(await budgetRows(ctx, ctx.req.valid('query'))),
    );
    router.get(
      '/headcount-balances',
      doc(
        'listHeadcountBalanceReport',
        'List authorized headcount balance report rows',
        S.HeadcountRow,
      ),
      apiValidator('query', S.HeadcountListQuery),
      async (ctx) => ctx.json(await headcountRows(ctx, ctx.req.valid('query'))),
    );
    router.get(
      '/contract-ledger',
      doc(
        'listContractLedgerReport',
        'List authorized contract ledger report rows',
        S.ContractRow,
      ),
      apiValidator('query', S.ContractListQuery),
      async (ctx) => ctx.json(await contractRows(ctx, ctx.req.valid('query'))),
    );
    router.get(
      '/budget-balances.xlsx',
      exportDoc('exportBudgetBalances', 'Export authorized budget balances'),
      apiValidator('query', S.ListQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        const rows = await allRows((page) =>
          budgetRows(ctx, { ...query, page, pageSize: 100 }),
        );
        return xlsx(
          rows,
          [
            { header: 'Department', key: 'departmentName' },
            { header: 'Year', key: 'year' },
            { header: 'Subject', key: 'subject' },
            { header: 'Allocated cents', key: 'allocatedCents' },
            { header: 'Held cents', key: 'heldCents' },
            { header: 'Used cents', key: 'usedCents' },
            { header: 'Available cents', key: 'availableCents' },
          ],
          'budget-balances.xlsx',
        );
      },
    );
    router.get(
      '/headcount-balances.xlsx',
      exportDoc(
        'exportHeadcountBalances',
        'Export authorized headcount balances',
      ),
      apiValidator('query', S.HeadcountListQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        const rows = await allRows((page) =>
          headcountRows(ctx, { ...query, page, pageSize: 100 }),
        );
        return xlsx(
          rows,
          [
            { header: 'Department', key: 'departmentName' },
            { header: 'Position', key: 'positionName' },
            { header: 'Year', key: 'year' },
            { header: 'Limit', key: 'limit' },
            { header: 'Initialized', key: 'initialized' },
            { header: 'Used', key: 'used' },
            { header: 'Pending', key: 'pending' },
            { header: 'Allocated', key: 'allocated' },
            { header: 'Replacement pending', key: 'replacementPending' },
            { header: 'Replacement allocated', key: 'replacementAllocated' },
            { header: 'Replacement blocked', key: 'replacementBlocked' },
            { header: 'Available', key: 'available' },
            { header: 'Capacity state', key: 'capacityState' },
          ],
          'headcount-balances.xlsx',
        );
      },
    );
    router.get(
      '/contract-ledger.xlsx',
      exportDoc(
        'exportContractLedger',
        'Export the authorized contract ledger',
      ),
      apiValidator('query', S.ContractListQuery),
      async (ctx) => {
        const query = ctx.req.valid('query');
        const rows = await allRows((page) =>
          contractRows(ctx, { ...query, page, pageSize: 100 }),
        );
        return xlsx(
          rows,
          [
            { header: 'Number', key: 'number' },
            { header: 'Department', key: 'departmentName' },
            { header: 'Status', key: 'status' },
            { header: 'Amount cents', key: 'amountCents' },
            { header: 'Held cents', key: 'heldCents' },
            { header: 'Paid cents', key: 'paidCents' },
            { header: 'Available cents', key: 'availableCents' },
            { header: 'Starts on', key: 'startsOn' },
            { header: 'Ends on', key: 'endsOn' },
            { header: 'As of', key: 'asOf' },
            { header: 'Expiry state', key: 'expiryState' },
            { header: 'Payment state', key: 'paymentState' },
            { header: 'Paid basis points', key: 'paidBasisPoints' },
          ],
          'contract-ledger.xlsx',
        );
      },
    );
    const root = new Hono();
    root.route('/reports', router);
    return root;
  }),
];
export default routes;
