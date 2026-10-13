import { matchesCategory, readableSummary } from './summary.js';
import { approvalDirectoryServiceToken } from '../../providers/approval-directory/index.js';
import { mapConcurrent } from '../../providers/map-concurrent.js';
import { batchRoutes } from './batch.js';
import {
  workItemServiceToken,
  WORK_ITEM_ACTIONS,
  WorkItemError,
} from '../../providers/work-items/index.js';
import {
  announcementServiceToken,
  AnnouncementError,
} from '../../providers/announcements/index.js';
import { databaseManagerToken } from '@nocobase/db';
import { recruitmentServiceToken } from '../../providers/recruitment/service.js';
import { sealRequestServiceToken } from '../../providers/seals/contract.js';
import { RecruitmentSubmissionError } from '../../providers/recruitment/submission.js';
import { SealError } from '../../providers/seals/errors.js';
import { vehicleRequestServiceToken } from '../../providers/vehicles/index.js';
import { VehicleError } from '../../providers/vehicles/errors.js';
import { transferServiceToken } from '../../providers/transfer/service.js';
import { TransferError } from '../../providers/transfer/submission.js';
import { certificateRequestServiceToken } from '../../providers/certificates/contract.js';
import { CertificateError } from '../../providers/certificates/service.js';
import { contractHttpServiceToken } from '../../providers/contracts/service.js';
import { assetRequestServiceToken } from '../../providers/asset-requests/contract.js';
import { vendorQualificationServiceToken } from '../../providers/vendor-qualification/contract.js';
import { departureServiceToken } from '../../providers/departure/contract.js';
import { probationServiceToken } from '../../providers/probation/contract.js';
import { paymentRequestServiceToken } from '../../providers/payment-requests/contract.js';
import { loanRequestServiceToken } from '../../providers/loan-requests/contract.js';
import { purchaseServiceToken } from '../../providers/purchases/service.js';
import { reimbursementServiceToken } from '../../providers/reimbursement/service.js';
import { travelServiceToken } from '../../providers/travel/index.js';
import { travelCancellationServiceToken } from '../../providers/travel/cancellation-service.js';
import { expensePlanServiceToken } from '../../providers/expense-plan/index.js';
import { trainingServiceToken } from '../../providers/training/index.js';
import { calendarServiceToken } from '../../providers/platform/index.js';
import { budgetAdjustmentServiceToken } from '../../providers/budget-adjustments/index.js';
import { supplyServiceToken } from '../../providers/supplies/index.js';
import { attendanceChangeServiceToken } from '../../providers/attendance-change/index.js';
import { outingServiceToken } from '../../providers/outings/index.js';
import { generalServiceToken } from '../../providers/general-requests/index.js';
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
  apiErrorResponses,
  apiValidator,
  defineApiRoutes,
  describeRoute,
  listResponse,
} from '@nocobase/app-server/router';
import { RepositoryError, type RepositoryPolicy } from '@nocobase/db';
import { Hono } from 'hono';
import { cancellationServiceToken } from '../../providers/leave-cancellations/index.js';
import { leaveServiceToken } from '../../providers/leave/index.js';
import { overtimeServiceToken } from '../../providers/overtime/index.js';
import {
  CenterItem,
  CenterMeta,
  CenterQuery,
  type CenterRecord,
} from './schemas.js';

const routes = [
  defineApiRoutes<Application>((app) => {
    const router = new Hono<AuthEnv & AuthorizationEnv>();
    router.use(
      '/approvalCenter',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    router.use(
      '/approvalCenter/*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    // Only the read aggregation shares a directory. Owner mutations and explicit
    // transaction snapshots must observe their own current transactional facts.
    router.use('/approvalCenter', async (_c, next) =>
      app.container
        .resolve(approvalDirectoryServiceToken)
        .withReadSnapshot(next),
    );
    router.route('/', batchRoutes(app));
    router.get(
      '/approvalCenter',
      describeRoute({
        tags: ['ApprovalCenter'],
        summary: 'List authorized approval records across business types',
        operationId: 'listApprovalCenter',
        description:
          'Each business type uses its own view grant and record policy. Types without a grant are omitted; no readable type returns 403. Results are globally ordered before pagination.',
        responses: {
          200: listResponse(CenterItem, CenterMeta),
          ...apiErrorResponses,
        },
      }),
      apiValidator('query', CenterQuery),
      async (c) => {
        const query = c.req.valid('query');
        const actorId = c.get('auth')!.user.id;
        const db = app.container.resolve(databaseManagerToken);
        async function currentPolicy(
          resource: string,
          action: string,
          collection: string,
        ) {
          const decision = await c.get('authz').authorize({
            resource: { type: 'composite', id: resource },
            action,
          });
          return decision.effect === 'deny'
            ? undefined
            : (
                decision.conditions?.database as
                  | Record<string, RepositoryPolicy | false | undefined>
                  | undefined
              )?.[collection];
        }
        async function initiator(id: string) {
          const users = await app.container
            .resolve(userAdministrationServiceToken)
            .list({ userIds: [id], pageSize: 1, kind: 'all' });
          return { id, name: users.items[0]?.name ?? id };
        }
        const sources = [
          {
            kind: 'oa.workItem' as const,
            resource: 'oa.workItems',
            collection: 'workItems',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> => {
              if (query.view !== 'pending') return [];
              const actions: Partial<
                Record<(typeof WORK_ITEM_ACTIONS)[number], RepositoryPolicy>
              > = {};
              for (const action of [
                'claim',
                'complete',
                'confirm',
                'resume',
                'reassign',
              ] as const) {
                const p = await currentPolicy(
                  'oa.workItems',
                  action,
                  'workItems',
                );
                if (p) actions[action] = p;
              }
              return Promise.all(
                (
                  await app.container
                    .resolve(workItemServiceToken)
                    .listForCenter(actorId, db.connection(), {
                      view: policy,
                      actions,
                    })
                ).map(async ({ initiatorId, ...r }) => ({
                  ...r,
                  kind: 'oa.workItem',
                  number: null,
                  applicantId: initiatorId,
                  applicant: await initiator(initiatorId),
                  startDate: null,
                  endDate: r.dueAt,
                  amount: null,
                  unit: null,
                })),
              );
            },
          },
          {
            kind: 'oa.announcementReceipt' as const,
            resource: 'oa.announcements',
            collection: 'announcements',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> => {
              if (query.view !== 'pending') return [];
              const confirm = await currentPolicy(
                'oa.announcements',
                'confirm',
                'announcements',
              );
              if (!confirm) return [];
              return Promise.all(
                (
                  await app.container
                    .resolve(announcementServiceToken)
                    .listForCenter(actorId, db.connection(), {
                      view: policy,
                      confirm,
                    })
                ).map(async ({ initiatorId, ...r }) => ({
                  ...r,
                  kind: 'oa.announcementReceipt',
                  number: null,
                  applicantId: initiatorId,
                  applicant: await initiator(initiatorId),
                  startDate: null,
                  endDate: r.dueAt,
                  amount: null,
                  unit: null,
                })),
              );
            },
          },
          {
            kind: 'oa.recruitment' as const,
            resource: 'oa.recruitment',
            collection: 'recruitmentRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(recruitmentServiceToken)
                  .listForCenter(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id!,
                kind: 'oa.recruitment',
                ...readableSummary(r, 'reason'),
                number: r.number ?? null,
                applicant: r.applicant,
                applicantId: r.applicantId!,
                status: r.status!,
                createdAt: new Date(r.createdAt).toISOString(),
                startDate: r.expectedStartDate ?? null,
                endDate: r.expectedStartDate ?? null,
                // Private salary, fuel costs and SDK snapshots never enter center summaries.
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.sealRequest' as const,
            resource: 'oa.sealRequests',
            collection: 'sealRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(sealRequestServiceToken)
                  .listForCenter(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.sealRequest',
                ...readableSummary(r, 'purpose'),
                number: r.number ?? null,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: new Date(r.createdAt).toISOString(),
                startDate: null,
                endDate: r.returnDueAt,
                // Private salary, fuel costs and SDK snapshots never enter center summaries.
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.vehicleRequest' as const,
            resource: 'oa.vehicleRequests',
            collection: 'vehicleRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(vehicleRequestServiceToken)
                  .listForCenter(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id!,
                kind: 'oa.vehicleRequest',
                ...readableSummary(r, 'purpose'),
                number: r.number ?? null,
                applicant: r.applicant,
                applicantId: r.applicantId!,
                status: r.status!,
                createdAt: new Date(r.createdAt!).toISOString(),
                startDate: r.startAt ?? null,
                endDate: r.endAt ?? null,
                // Private salary, fuel costs and SDK snapshots never enter center summaries.
                amount: null,
                unit: null,
              })),
          },

          {
            kind: 'oa.transfer' as const,
            collection: 'transferRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              app.container
                .resolve(transferServiceToken)
                .listForCenter(actorId, query.view, policy),
          },
          {
            kind: 'oa.certificateRequest' as const,
            resource: 'oa.certificateRequests',
            collection: 'certificateRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              app.container
                .resolve(certificateRequestServiceToken)
                .listForCenter(actorId, query.view, policy),
          },
          {
            kind: 'oa.contract' as const,
            collection: 'contractRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(contractHttpServiceToken)
                  .listForCenter(
                    actorId,
                    query.view === 'mine' ? 'all' : query.view,
                    policy,
                  )
              )
                .filter(
                  (r) => query.view !== 'mine' || r.applicantId === actorId,
                )
                .map((r) => ({
                  id: r.id,
                  kind: 'oa.contract',
                  ...readableSummary(r, 'reason'),
                  number: r.number,
                  applicant: r.applicant,
                  applicantId: r.applicantId,
                  status: r.status,
                  createdAt: new Date(r.createdAt).toISOString(),
                  startDate: r.startsOn || null,
                  endDate: r.endsOn || null,
                  amount: r.amountCents,
                  unit: 'cents',
                })),
          },
          {
            kind: 'oa.assetRequest' as const,
            resource: 'oa.assetRequests',
            collection: 'assetRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(assetRequestServiceToken)
                  .list(actorId, query.view, policy)
              )
                .filter(
                  (r) =>
                    typeof r.id === 'string' &&
                    typeof r.applicantId === 'string' &&
                    typeof r.status === 'string' &&
                    r.createdAt != null,
                )
                .map((r) => ({
                  id: r.id!,
                  kind: 'oa.assetRequest',
                  ...readableSummary(r, 'purpose'),
                  number: r.number ?? null,
                  applicant: r.applicant ?? null,
                  applicantId: r.applicantId!,
                  status: r.status!,
                  createdAt: new Date(r.createdAt!).toISOString(),
                  startDate: null,
                  endDate: r.borrowDueDate ?? null,
                  amount: null,
                  unit: null,
                })),
          },
          {
            kind: 'oa.vendorQualification' as const,
            collection: 'vendorQualifications',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(vendorQualificationServiceToken)
                  .listForCenter(
                    actorId,
                    query.view === 'mine' ? 'all' : query.view,
                    policy,
                  )
              )
                .filter(
                  (r) => query.view !== 'mine' || r.applicantId === actorId,
                )
                .map((r) => ({
                  id: r.id,
                  kind: 'oa.vendorQualification',
                  ...readableSummary(r, 'name'),
                  number: r.number,
                  applicant: r.applicant,
                  applicantId: r.applicantId,
                  status: r.status,
                  createdAt: new Date(r.createdAt).toISOString(),
                  startDate: null,
                  endDate: r.qualificationExpiry,
                  amount: null,
                  unit: null,
                })),
          },
          {
            kind: 'oa.departure' as const,
            collection: 'departureRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(departureServiceToken)
                  .list(actorId, policy, query.view)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.departure',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.expectedLastWorkingDay,
                endDate: r.lastWorkingDay,
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.probation' as const,
            collection: 'probationRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(probationServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.probation',
                ...readableSummary(r, 'selfEvaluation'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.probationEndDate,
                endDate: r.deferredTo,
                // Compensation is private and never belongs to center DTOs.
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.payment' as const,
            collection: 'paymentRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(paymentRequestServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.payment',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                // Requested payment amount; no receipt or budget settlement is implied.
                amount: r.amountCents,
                unit: 'cents',
              })),
          },

          {
            kind: 'oa.loan' as const,
            collection: 'loanRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(loanRequestServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.loan',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                // Requested loan amount; completion alone does not report outstanding debt.
                amount: r.amountCents,
                unit: 'cents',
              })),
          },

          {
            kind: 'oa.purchase' as const,
            collection: 'purchaseRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(purchaseServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.purchase',
                ...readableSummary(r, 'purpose'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                // Proposal/quoted value only; approval creates an order and does not prove payment.
                amount: r.actualCents ?? r.estimatedCents,
                unit: 'cents',
              })),
          },

          {
            kind: 'oa.reimbursement' as const,
            collection: 'reimbursementRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(reimbursementServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.reimbursement',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                amount: r.totalCents,
                unit: 'cents',
              })),
          },
          {
            kind: 'oa.travel' as const,
            collection: 'travelRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(travelServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.travel',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: app.container
                  .resolve(calendarServiceToken)
                  .localDate(new Date(r.startAt)),
                endDate: app.container
                  .resolve(calendarServiceToken)
                  .localDate(new Date(r.endAt)),
                amount: r.amountCents,
                unit: 'cents',
              })),
          },
          {
            kind: 'oa.travelCancellation' as const,
            collection: 'travelCancellations',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(travelCancellationServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.travelCancellation',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                amount: null,
                unit: null,
              })),
          },

          {
            kind: 'oa.expensePlan' as const,
            collection: 'expensePlans',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(expensePlanServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.expensePlan',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.eventDate,
                endDate: r.eventDate,
                amount: r.amountCents,
                unit: 'cents',
              })),
          },
          {
            kind: 'oa.training' as const,
            collection: 'trainingRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(trainingServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.training',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: app.container
                  .resolve(calendarServiceToken)
                  .localDate(new Date(r.startAt)),
                endDate: app.container
                  .resolve(calendarServiceToken)
                  .localDate(new Date(r.endAt)),
                amount: r.amountCents,
                unit: 'cents',
              })),
          },
          {
            kind: 'oa.budgetAdjustment' as const,
            collection: 'budgetAdjustments',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(budgetAdjustmentServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.budgetAdjustment',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                amount: r.amountCents,
                unit: 'cents',
              })),
          },
          {
            kind: 'oa.supplies' as const,
            collection: 'supplyRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(supplyServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.supplies',
                ...readableSummary(r, 'purpose'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                amount: null,
                unit: null,
              })),
          },

          {
            kind: 'oa.attendanceChange' as const,
            collection: 'attendanceChangeRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(attendanceChangeServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.attendanceChange',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.date,
                endDate: r.date,
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.outing' as const,
            collection: 'outingRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(outingServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.outing',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.startAt ?? null,
                endDate: r.endAt ?? null,
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.general' as const,
            collection: 'generalRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(generalServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.general',
                ...readableSummary(r, 'title'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: null,
                endDate: null,
                amount: null,
                unit: null,
              })),
          },
          {
            kind: 'oa.leave' as const,
            collection: 'leaveRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(leaveServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.leave',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.startDate,
                endDate: r.endDate,
                amount: Number(r.days),
                unit: 'days',
              })),
          },
          {
            kind: 'oa.overtime' as const,
            collection: 'overtimeRequests',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(overtimeServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.overtime',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.date,
                endDate: r.date,
                amount: Number(r.minutes),
                unit: 'minutes',
              })),
          },
          {
            kind: 'oa.leaveCancellation' as const,
            collection: 'leaveCancellations',
            load: async (policy: RepositoryPolicy): Promise<CenterRecord[]> =>
              (
                await app.container
                  .resolve(cancellationServiceToken)
                  .list(actorId, query.view, policy)
              ).map((r) => ({
                id: r.id,
                kind: 'oa.leaveCancellation',
                ...readableSummary(r, 'reason'),
                number: r.number,
                applicant: r.applicant,
                applicantId: r.applicantId,
                status: r.status,
                createdAt: r.createdAt,
                startDate: r.startDate,
                endDate: r.endDate,
                amount: Number(r.days),
                unit: 'days',
              })),
          },
        ];
        let readable = false;
        const kinds: CenterRecord['kind'][] = [];
        const rows: CenterRecord[] = [];
        // Bound independent owner reads; collect in declaration order and fail the whole
        // response on any owner failure. Never return a partial authorized total.
        const results = await mapConcurrent(sources, 4, async (source) => {
          if (
            ['oa.workItem', 'oa.announcementReceipt'].includes(source.kind) &&
            query.view !== 'pending' &&
            !query.kind
          )
            return undefined;
          if (query.kind && source.kind !== query.kind) return undefined;
          const decision = await c.get('authz').authorize({
            resource: {
              type: 'composite',
              id: source.resource ?? source.kind,
            },
            action: 'view',
          });
          const policy =
            decision.effect === 'deny'
              ? undefined
              : (
                  decision.conditions?.database as
                    | Record<string, RepositoryPolicy | false | undefined>
                    | undefined
                )?.[source.collection];
          if (!policy) return undefined;
          try {
            return { kind: source.kind, rows: await source.load(policy) };
          } catch (error) {
            if (
              ((error instanceof WorkItemError ||
                error instanceof AnnouncementError) &&
                error.code === 'ACCESS_DENIED') ||
              (error instanceof RepositoryError &&
                error.code === 'FIELD_READ_FORBIDDEN') ||
              (error instanceof RecruitmentSubmissionError &&
                error.reason === 'RECRUITMENT_FORBIDDEN') ||
              (error instanceof SealError && error.code === 'ACCESS_DENIED') ||
              (error instanceof VehicleError &&
                ['VEHICLE_FIELDS_RESTRICTED', 'VEHICLE_ACCESS_DENIED'].includes(
                  error.code,
                )) ||
              (error instanceof TransferError &&
                error.reason === 'TRANSFER_FORBIDDEN') ||
              (error instanceof CertificateError &&
                error.code === 'CERTIFICATE_ACCESS_DENIED')
            )
              throw new ApiError({
                status: 'PERMISSION_DENIED',
                domain: 'approvalCenter',
                reason: 'APPROVAL_CENTER_ACCESS_DENIED',
                message:
                  'Current business record fields do not permit a center summary.',
              });
            throw error;
          }
        });
        for (const result of results) {
          if (!result) continue;
          readable = true;
          kinds.push(result.kind);
          rows.push(...result.rows);
        }
        if (!readable)
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            domain: 'approvalCenter',
            reason: 'APPROVAL_CENTER_ACCESS_DENIED',
            message: 'No approval business reading permission is granted.',
          });
        const needle = query.search.toLocaleLowerCase();
        const filtered = rows
          .filter(
            (r) =>
              (query.own !== 'true' || r.applicantId === actorId) &&
              (!query.category ||
                matchesCategory(r, query.category, actorId)) &&
              (!query.status || query.status.split(',').includes(r.status)) &&
              (!needle ||
                `${r.title ?? ''} ${r.number ?? ''} ${r.applicant?.name ?? ''}`
                  .toLocaleLowerCase()
                  .includes(needle)),
          )
          .sort(
            (a, b) =>
              (query.direction === 'asc' ? 1 : -1) *
                (a[query.orderBy] ?? '').localeCompare(
                  b[query.orderBy] ?? '',
                ) ||
              a.kind.localeCompare(b.kind) ||
              a.id.localeCompare(b.id),
          );
        const page = Math.min(
          query.page,
          Math.max(1, Math.ceil(filtered.length / query.pageSize)),
        );
        const offset = (page - 1) * query.pageSize;
        return c.json({
          data: filtered.slice(offset, offset + query.pageSize),
          meta: {
            page,
            pageSize: query.pageSize,
            total: filtered.length,
            kinds,
            ...(query.homeSummary === 'true' && query.view === 'mine'
              ? {
                  attention: {
                    drafts: filtered
                      .filter(
                        (r) =>
                          r.applicantId === actorId && r.status === 'draft',
                      )
                      .slice(0, 6),
                    submitted: filtered
                      .filter((r) => matchesCategory(r, 'submitted', actorId))
                      .slice(0, 5),
                    revisions: filtered
                      .filter(
                        (r) =>
                          r.applicantId === actorId &&
                          ['revision', 'exception'].includes(r.status),
                      )
                      .slice(0, 6),
                  },
                }
              : {}),
            counts: {
              drafts: filtered.filter((r) =>
                matchesCategory(r, 'drafts', actorId),
              ).length,
              revisions: filtered.filter((r) =>
                matchesCategory(r, 'revisions', actorId),
              ).length,
              inProgress: filtered.filter((r) =>
                matchesCategory(r, 'inProgress', actorId),
              ).length,
            },
          },
        });
      },
    );
    const root = new Hono();
    root.route('/', router);
    return root;
  }),
];
export default routes;
