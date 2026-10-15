import {
  hasApprovalCandidate,
  createAppApprovalService,
  hasApprovalTaskActor,
} from '../approval-runtime/query-service.js';
import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import {
  appointAction,
  reassignAction,
} from '../process-management/actions.js';
import { processDirectorySnapshot } from '../process-management/context.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import {
  expenseCategoryStandardKinds,
  validateReimbursementTravelStandards,
  ReimbursementTravelStandardError,
  type ReimbursementTravelStandardSnapshot,
} from './travel-standards.js';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  isOpenRun,
  APPROVAL_COLLECTIONS,
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  readAction,
  ccAction,
  defineApprovalAction,
  configureAction,
  allActivePeople,
  type ActionContext,
  type EligibilityQuery,
  claimAction,
  releaseAction,
  assignAction,
  transferAction,
  peopleWithRole,
  hashOf,
  type Approval,
  type PerformInput,
  type TaskRow,
  type RunRow,
} from '@nocobase/app-plugin-approval/server';
import {
  LifecycleRuntime,
  type LifecycleStore,
  type LifecycleRecord,
  type JsonObject,
  type EffectDispatcher,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import type { OrgService } from '../org/contract.js';
import type { AuditService } from '../audit/index.js';
import type { EmployeeService } from '../employees/contract.js';
import type {
  ApprovalDirectoryService,
  OaApprovalDirectory,
} from '../approval-directory/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
  DictionaryService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type { FinanceAssignmentService } from '../finance-assignments/contract.js';
import type { ExpenseAuthorizationService } from '../expense-authorizations/contract.js';
import type { InvoiceService } from '../invoices/contract.js';
import type { LoanLedgerService } from '../loan-ledger/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import { isLocalDate } from '../platform/time-zone.js';
import {
  REIMBURSEMENT_LIFECYCLE,
  type ReimbursementRecord,
  type ReimbursementInput,
  type ReimbursementPayee,
  type FinanceLineFact,
} from './contract.js';
import { ReimbursementError } from './errors.js';
import { totalClaimCents, paymentAmounts } from './amounts.js';
import { createReimbursementFunding } from './funding.js';
import { createReimbursementSettlement } from './settlement.js';
import { reviewBasis } from './review-basis.js';
import { checkReturnedLineRevision } from './line-revision.js';
import { reimbursementFinancePolicy, returnItem } from './finance-policy.js';
import {
  reimbursementCashierActions,
  reimbursementPaymentOutputs,
} from './handling.js';
export { REIMBURSEMENT_LIFECYCLE } from './contract.js';
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: ReimbursementRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'head'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'cashier'
    | 'exception'
    | 'paid'
    | 'forcedPaid'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface ReimbursementDependencies {
  db: DatabaseManager;
  org: OrgService;
  audit: AuditService;
  users: UserAdministrationService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  dictionaries: DictionaryService;
  notifications: ApprovalNotificationService;
  accountants: FinanceAssignmentService;
  invoices: InvoiceService;
  authorizations: ExpenseAuthorizationService;
  loans: LoanLedgerService;
  /** Mandatory secure file adapter. It checks every selected file against this record and caller transaction. */
  validateAttachments(
    record: ReimbursementRecord,
    connection: DatabaseConnection,
  ): Promise<void>;
  dispatcher?: EffectDispatcher;
}
function refuse(code: string, message: string): never {
  throw new ReimbursementError(code, message);
}
function normalizeRecord(record: LifecycleRecord): ReimbursementRecord {
  const values: Record<string, number | null> = {};
  for (const field of [
    'totalCents',
    'offsetCents',
    'debtHeldCents',
    'lastSubmittedTotalCents',
  ]) {
    const value = record[field];
    if (field === 'lastSubmittedTotalCents' && value === null) {
      values[field] = null;
      continue;
    }
    if (!(
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      (typeof value === 'string' && /^\d+$/.test(value))
    ))
      refuse(
        'REIMBURSEMENT_INVALID_STORED_AMOUNT',
        'Stored cents must be exact integers.',
      );
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0)
      refuse(
        'REIMBURSEMENT_INVALID_STORED_AMOUNT',
        'Stored cents must be exact nonnegative safe integers.',
      );
    values[field] = amount;
  }
  return { ...record, ...values } as ReimbursementRecord;
}
export const reimbursementInputSchema = z.strictObject({
  reason: z.string().max(10000),
  authorizationId: z.string().min(1).max(64).nullable(),
  loanId: z.string().min(1).max(64).nullable(),
  offsetCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  overrunReason: z.string().max(10000),
  lines: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(64),
        category: z.string().min(1).max(64),
        date: z.string().refine(isLocalDate),
        amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        invoiceNumber: z.string().trim().min(1).max(128),
        attachmentIds: z.array(z.string().min(1).max(64)).min(1),
        standardExceptionReason: z.string().max(10000),
      }),
    )
    .max(200),
});
const accountSchema = z.strictObject({
  bankName: z.string().trim().min(1).max(128),
  bankAccount: z.string().trim().min(1).max(64),
  bankAccountName: z.string().trim().min(1).max(128),
});
export function createReimbursementService(d: ReimbursementDependencies) {
  const funding = createReimbursementFunding(d),
    settle = createReimbursementSettlement(d);
  let outside: Services;
  const readDirectory = new AsyncLocalStorage<OaApprovalDirectory>();
  const writePolicy = new AsyncLocalStorage<RepositoryPolicy>();
  const intervention = new AsyncLocalStorage<{
    actorId: string;
    recordId: string;
    action: string;
    reason: string | null;
    depth: number;
  }>();
  const snapshots = new WeakMap<object, Services>();
  const base = createAppLifecycleStore(d.db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  // Directory callbacks are synchronous. The public store transaction is the boundary at which we load it,
  // before lifecycle and approval callbacks run; nested stores retain their own transaction snapshots.
  function wrap(store: LifecycleStore): LifecycleStore {
    return new Proxy(store, {
      get(target, key) {
        const policy = writePolicy.getStore();
        if (key === 'findRecord')
          return async (collection: string, id: string | number) => {
            const record = await target.findRecord(collection, id);
            return collection === 'reimbursementRequests' && record
              ? normalizeRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'reimbursementRequests'
              ? normalizeRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'reimbursementRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new ReimbursementError(
                'REIMBURSEMENT_FIELDS_RESTRICTED',
                'The grant must expose the created training record.',
                'permission',
              );
            return normalizeRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'reimbursementRequests')
              return target.updateRecordIf(collection, id, condition, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const result = await connection
              .repository(collection)
              .withPolicy(policy)
              .updateMany({
                filter: {
                  id,
                  [condition.stateField]: condition.state,
                  [condition.versionField]: condition.version,
                },
                values: values as RepositoryRecord,
              });
            return result.updatedCount > 0;
          };

        if (key === 'transaction')
          return async <R>(
            work: (s: LifecycleStore) => Promise<R>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) =>
            target.transaction(async (tx) => {
              const connection = tx.transactionHandle as DatabaseConnection;
              snapshots.set(connection, {
                directory:
                  readDirectory.getStore() ??
                  (await processDirectorySnapshot(
                    d.directory,
                    'oa.reimbursement',
                    connection,
                  )),
                connection,
                merges: new Map(),
              });
              const change = intervention.getStore();
              if (change) change.depth++;
              try {
                const result = await work(wrap(tx));
                if (change?.depth === 1)
                  await d.audit.record(
                    {
                      actorId: change.actorId,
                      action: `reimbursement.${change.action}`,
                      targetType: 'reimbursementRequests',
                      targetId: change.recordId,
                      reason: change.reason,
                    },
                    connection,
                  );
                return result;
              } finally {
                if (change) change.depth--;
              }
            }, options);
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }
  const source = (handle: unknown): Services =>
    handle ? snapshots.get(handle)! : outside;
  const runtime = new LifecycleRuntime({
    store: wrap(base),
    dispatcher: d.dispatcher,
  });
  const owner = ({
    record,
    actor,
  }: {
    record: ReimbursementRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = [
    'reason',
    'authorizationId',
    'loanId',
    'offsetCents',
    'overrunReason',
    'lines',
  ];
  const stage = stagesFor<Types>();
  // Native administrator operations have no people provider. Publish only active,
  // SDK-eligible recipients, and apply the same restriction to posted inputs.
  const administrativePeople = async (
    context: ActionContext,
    query: { search?: string; offset?: number; limit?: number },
    appointing: boolean,
  ) => {
    const page = await allActivePeople().search(context, query);
    const queries: EligibilityQuery[] =
      appointing && context.unassigned.length
        ? context.unassigned.map((place) => ({
            replacing: false,
            kind: 'decide',
            role: 'member',
            via: 'assign',
            order: place.order,
            subject: place.subject,
            data: place.data,
            status: place.status,
          }))
        : [
            {
              replacing: !appointing,
              ...(appointing
                ? {
                    kind: 'decide' as const,
                    role: 'member' as const,
                    via: 'assign' as const,
                  }
                : {}),
            },
          ];
    return {
      ...page,
      people: page.people.filter(
        (person) =>
          context.directory.isActive(person) &&
          queries.some((spec) => context.eligible(person, spec).ok),
      ),
    };
  };
  const adminAppoint = defineApprovalAction({
    ...appointAction,
    people: (context, query) => administrativePeople(context, query, true),
    validate: async (input, context) => {
      const basic = await appointAction.validate?.(input, context);
      if (basic) return basic;
      if (typeof input.to !== 'string' || !context.directory.isActive(input.to))
        return 'Choose an active eligible recipient.';
      const place =
        context.unassigned.find((p) => p.placeKey === input.place) ??
        (context.unassigned.length === 1 ? context.unassigned[0] : undefined);
      const query: EligibilityQuery = {
        replacing: false,
        kind: 'decide',
        role: 'member',
        via: 'assign',
        ...(place
          ? {
              order: place.order,
              subject: place.subject,
              data: place.data,
              status: place.status,
            }
          : {}),
      };
      return context.eligible(input.to, query).ok
        ? null
        : 'Choose an eligible recipient for this place.';
    },
  });
  const adminReassign = defineApprovalAction({
    ...reassignAction,
    people: (context, query) => administrativePeople(context, query, false),
    validate: async (input, context) => {
      const basic = await reassignAction.validate?.(input, context);
      if (basic) return basic;
      return input.override === true ||
        typeof input.to !== 'string' ||
        !context.directory.isActive(input.to) ||
        !context.eligible(input.to, { replacing: true }).ok
        ? 'Choose an active eligible recipient without overriding qualification.'
        : null;
    },
  });
  const actions = [
    ...createOaApprovalOperations(d),
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    adminAppoint,
    adminReassign,
    readAction,
    configureAction(
      defineApprovalAction({
        ...ccAction,
        people: (context, query) => allActivePeople().search(context, query),
        validate: ({ to }, context) =>
          typeof to === 'string' && context.directory.isActive(to)
            ? null
            : 'Choose an active recipient.',
      }),
      { by: ['assignee', 'delegate', 'applicant', 'admin'] },
    ),
  ];
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  const needsHead = (r: ReimbursementRecord) =>
    exceedsMoneyThreshold(r.totalCents, r.ruleSnapshot?.['expense.head']);
  const needsExecutive = (r: ReimbursementRecord) =>
    exceedsMoneyThreshold(r.totalCents, r.ruleSnapshot?.['spend.vp']);
  const needsGm = (r: ReimbursementRecord) =>
    exceedsMoneyThreshold(r.totalCents, r.ruleSnapshot?.['spend.gm']);
  const command = (
    r: ReimbursementRecord,
    actorId: string,
    requestKey: string,
    now: Date,
  ) => ({ actorId, reason: r.reason, requestKey, now });
  async function validate(record: ReimbursementRecord, tx: DatabaseConnection) {
    const parsed = reimbursementInputSchema.safeParse(
      Object.fromEntries(fields.map((f) => [f, record[f]])),
    );
    if (!parsed.success)
      refuse(
        'REIMBURSEMENT_INVALID_INPUT',
        parsed.error.issues[0]?.message ?? 'Invalid reimbursement.',
      );
    if (
      !record.reason.trim() ||
      !record.lines.length ||
      new Set(record.lines.map((l) => l.id)).size !== record.lines.length
    )
      refuse(
        'REIMBURSEMENT_INVALID_INPUT',
        'A reason and unique expense lines are required.',
      );
    const totalCents = totalClaimCents(record.lines);
    paymentAmounts(totalCents, record.offsetCents);
    const employee = await d.employees.getByUserId(record.applicantId, tx);
    if (!employee?.active || employee.status === 'left')
      refuse(
        'REIMBURSEMENT_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    const department = await d.org.primaryDepartmentOf(record.applicantId, tx);
    if (!department)
      return refuse(
        'REIMBURSEMENT_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    const categories = await d.dictionaries.list('expenseCategory', {}, tx);
    for (const line of record.lines)
      if (!categories.some((c) => c.code === line.category))
        refuse(
          'REIMBURSEMENT_CATEGORY_INVALID',
          'Choose an active expense category.',
        );
    await d.validateAttachments(record, tx);
    let standardSource: ReimbursementTravelStandardSnapshot | null = null;
    let linkedKind: string | null = null;
    if (record.authorizationId) {
      const a = await d.authorizations.get(record.authorizationId, tx);
      if (!a || a.applicantId !== record.applicantId || a.state !== 'open')
        return refuse(
          'REIMBURSEMENT_SOURCE_INVALID',
          'Choose an open approved allowance belonging to this applicant.',
        );
      linkedKind = a.sourceKind;
      const collection =
        a.sourceKind === 'oa.travel'
          ? 'travelRequests'
          : a.sourceKind === 'oa.training'
            ? 'trainingRequests'
            : a.sourceKind === 'oa.expensePlan'
              ? 'expensePlans'
              : null;
      if (!collection)
        return refuse(
          'REIMBURSEMENT_SOURCE_INVALID',
          'The allowance source is not supported.',
        );
      // Lookup the exact persisted current allowance. A generation-id prefix is never proof of source ownership.
      const original = await tx.repository(collection).findOne({
        filter: { authorizationId: a.id, applicantId: record.applicantId },
      });
      if (
        !original ||
        !(
          a.sourceKind === 'oa.travel'
            ? ['booking', 'exception', 'completed']
            : ['approved']
        ).includes(typeof original.status === 'string' ? original.status : '')
      )
        refuse(
          'REIMBURSEMENT_SOURCE_INVALID',
          'The original business approval and current allowance must still be effective.',
        );
      if (a.sourceKind === 'oa.travel' && original?.standardSnapshot)
        standardSource =
          original.standardSnapshot as unknown as ReimbursementTravelStandardSnapshot;
    }
    const standardSnapshot = record.standardSnapshot ?? {
      authorizationId: record.authorizationId,
      linkedKind,
      standard: standardSource,
      categories: expenseCategoryStandardKinds(categories),
    };
    try {
      validateReimbursementTravelStandards({
        linkedKind:
          typeof standardSnapshot.linkedKind === 'string'
            ? standardSnapshot.linkedKind
            : null,
        standard:
          standardSnapshot.standard as unknown as ReimbursementTravelStandardSnapshot | null,
        categories: standardSnapshot.categories as unknown as ReturnType<
          typeof expenseCategoryStandardKinds
        >,
        lines: record.lines,
      });
    } catch (error) {
      if (error instanceof ReimbursementTravelStandardError)
        refuse(error.code, error.message);
      throw error;
    }
    return { department, totalCents, standardSnapshot };
  }
  async function originalOpinion(
    record: ReimbursementRecord,
    name: 'manager' | 'head',
    personId: string | null,
    tx: DatabaseConnection,
  ) {
    const basis =
      name === 'manager' ? record.managerReviewBasis : record.headReviewBasis;
    if (!basis || !personId) return false;
    const runs = await tx
      .repository<RunRow>(APPROVAL_COLLECTIONS.runs)
      .findMany({
        filter: { lifecycle: REIMBURSEMENT_LIFECYCLE, recordId: record.id },
      });
    for (const run of runs) {
      if (
        !['approved', 'returned'].includes(run.status) ||
        run.plan[0]?.stage !== name ||
        hashOf({ basis: run.content[name + 'ReviewBasis'] }) !==
          hashOf({ basis: { ...basis } })
      )
        continue;
      const task = await tx
        .repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
        .findOne({
          filter: {
            runId: run.id,
            stage: name,
            kind: 'decide',
            role: 'member',
            status: 'completed',
            answer: 'approve',
            assigneeId: personId,
            actorId: personId,
            depth: 0,
            mode: null,
          },
        });
      if (task) return true;
    }
    return false;
  }
  async function mergeEvidence(
    record: ReimbursementRecord,
    services: Services,
    input: JsonObject,
    name: 'manager' | 'executive',
    personId: string | null,
  ) {
    if (!personId || typeof input.runId !== 'string') return null;
    // Public read-only task contract is required to see the current answer inside this same transaction.
    const task = await services
      .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
      .findOne({
        filter: {
          runId: input.runId,
          stage: name,
          enteredVersion: record.lifecycleVersion,
          kind: 'decide',
          role: 'member',
          status: 'completed',
          answer: 'approve',
          assigneeId: personId,
          actorId: personId,
          depth: 0,
          mode: null,
        },
      });
    return task ? { runId: input.runId, taskId: task.id, personId } : null;
  }
  async function capturePayee(
    record: ReimbursementRecord,
    tx: DatabaseConnection,
    account?: unknown,
  ) {
    const raw =
      account ?? (await d.employees.paymentAccountOf(record.applicantId, tx));
    const parsed = accountSchema.safeParse(raw);
    if (!parsed.success)
      refuse(
        'REIMBURSEMENT_PAYMENT_ACCOUNT_REQUIRED',
        'A complete employee payment account is required.',
      );
    const repo = tx.repository<ReimbursementPayee>('reimbursementPayees');
    const prior = await repo.findOne({ filter: { requestId: record.id } });
    const values = {
      requestId: record.id,
      ...parsed.data,
      version: (prior?.version ?? 0) + 1,
    };
    if (prior)
      await repo.updateMany({
        filter: { requestId: record.id, version: prior.version },
        values,
      });
    else await repo.createOne({ values });
  }
  function decisions(input: JsonObject): Record<string, FinanceLineFact> {
    const payload = input.result;
    const raw =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.decisions
        : undefined;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result: Record<string, FinanceLineFact> = {};
    for (const [id, value] of Object.entries(raw))
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.contentHash === 'string' &&
        ['approved', 'returned', 'pending'].includes(
          typeof value.outcome === 'string' ? value.outcome : '',
        )
      )
        result[id] = {
          outcome: value.outcome as FinanceLineFact['outcome'],
          contentHash: value.contentHash,
        };
    return result;
  }
  const approval = defineApproval<Types>({
    name: REIMBURSEMENT_LIFECYCLE,
    collection: 'reimbursementRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [
      ...fields,
      'totalCents',
      'standardSnapshot',
      'departmentId',
      'managerReviewBasis',
      'headReviewBasis',
    ],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: () => [] },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<ReimbursementRecord>('reimbursementRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: REIMBURSEMENT_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    create: {
      guard: ({ values, actor, services }) =>
        values.applicantId === actor.id ||
        services.directory.hasRole(actor.id, 'hr'),
    },
    states: [
      'draft',
      'revision',
      'exception',
      approvalState(
        'manager',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.managerId ?? undefined,
          covers: ['managerReviewBasis'],
        }),
      ),
      approvalState(
        'head',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.headId ?? undefined,
          covers: ['headReviewBasis'],
        }),
      ),
      approvalState(
        'finance',
        stage.custom(
          reimbursementFinancePolicy,
          {},
          {
            ...settings,
            subjects: ({ record }) =>
              record.lines.map((line) => ({
                subject: line.id,
                assignee: record.accountantId,
                data: { ...line },
              })),
            actions: [
              ...actions.filter(
                (a) => ('action' in a ? a.action.name : a.name) !== 'transfer',
              ),
              configureAction(
                defineApprovalAction({
                  ...transferAction,
                  actors: ['assignee', 'delegate'],
                }),
                {
                  recipients: peopleWithRole(allActivePeople(), 'finance'),
                  reason: true,
                },
              ),
              returnItem,
            ],
          },
        ),
      ),
      approvalState(
        'executive',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.executiveId ?? undefined,
          covers: [
            'totalCents',
            'reason',
            'authorizationId',
            'loanId',
            'departmentId',
          ],
        }),
      ),
      approvalState(
        'gm',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.gmId ?? undefined,
          covers: [
            'totalCents',
            'reason',
            'authorizationId',
            'loanId',
            'departmentId',
          ],
        }),
      ),
      approvalState(
        'cashier',
        stage.first({
          onEmpty: 'hold',
          qualification: 'cashier',
          remindAfterHours: 24,
          pools: [
            {
              key: 'cashier',
              candidates: ({ services }) =>
                services.directory.roleMembers('cashier'),
              claimable: true,
            },
          ],
          outputs: reimbursementPaymentOutputs,
          actions: [
            claimAction,
            releaseAction,
            assignAction,
            commentAction,
            readAction,
            adminAppoint,
            adminReassign,
            ...Object.values(reimbursementCashierActions),
            configureAction(transferAction, {
              recipients: peopleWithRole(allActivePeople(), 'cashier'),
              reason: true,
            }),
            createOaApprovalOperations(d)[2],
          ],
        }),
      ),
      ...(
        ['paid', 'forcedPaid', 'rejected', 'withdrawn', 'terminated'] as const
      ).map((name) => ({ name, final: true })),
    ],
    transitions: {
      edit: {
        from: ['draft', 'revision'],
        to: ['draft', 'revision'],
        guard: owner,
        route: ({ record }) => record.status as 'draft' | 'revision',
        accept: fields,
        set: ({ record }) => ({ totalCents: totalClaimCents(record.lines) }),
        onTransition: async ({ record, previous, actor, tx, now }) => {
          const connection = tx.handle as DatabaseConnection;
          await lockUserForAdministration(connection, record.applicantId);
          if (
            record.bindingCaptured &&
            (record.authorizationId !== record.boundAuthorizationId ||
              record.loanId !== record.boundLoanId)
          )
            refuse(
              'REIMBURSEMENT_SOURCE_REBIND_FORBIDDEN',
              'Submitted sources cannot change.',
            );
          if (
            Object.values(previous.financeLineFacts).some(
              (f) => f.outcome === 'returned',
            )
          )
            checkReturnedLineRevision(
              previous.financeCorrectionLines,
              record.lines,
              previous.financeLineFacts,
            );
          if (record.bindingCaptured) {
            await validate(record, connection);
            await funding.prepareSubmission(
              record,
              command(
                record,
                actor.id,
                `edit:${record.id}:${record.lifecycleVersion}`,
                now,
              ),
              connection,
            );
          }
        },
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'manager',
        guard: owner,
        set: async ({ record, services, actor, now }) => {
          const connection = services.connection!;
          await lockUserForAdministration(connection, record.applicantId);
          const { department, totalCents, standardSnapshot } = await validate(
            record,
            connection,
          );
          const snapshot =
            record.ruleSnapshot ??
            (await d.rules.snapshot(
              [
                'expense.head',
                'spend.vp',
                'spend.gm',
                'sla.remindHours',
                'sla.escalateHours',
                'sla.urgeCooldownHours',
              ],
              now,
              connection,
            ));
          if (
            snapshot['sla.remindHours'] !== 24 ||
            snapshot['sla.escalateHours'] !== 48
          )
            refuse(
              'REIMBURSEMENT_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports default 24/48 working-hour clocks only.',
            );
          for (const key of ['expense.head', 'spend.vp', 'spend.gm'])
            exceedsMoneyThreshold(totalCents, snapshot[key]);
          const managerId =
              services.directory.managerOf(record.applicantId) ?? null,
            headId = (await d.org.headOf(department.id, connection)) ?? null;
          const identity = {
            applicantId: record.applicantId,
            departmentId: department.id,
            authorizationId: record.authorizationId,
            loanId: record.loanId,
            reason: record.reason,
            ruleSnapshot: snapshot,
          };
          const held = await funding.prepareSubmission(
            record,
            command(
              record,
              actor.id,
              `submit:${record.id}:${record.lifecycleVersion}`,
              now,
            ),
            connection,
          );
          return {
            ...held,
            standardSnapshot: standardSnapshot as unknown as JsonObject,
            departmentId: department.id,
            managerId,
            headId,
            accountantId:
              (await d.accountants.resolve(
                department.id,
                record.applicantId,
                connection,
              )) ?? null,
            executiveId:
              (await d.org.executiveOf(department.id, connection)) ?? null,
            gmId: services.directory.uniqueRoleMember('gm') ?? null,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('REIMBURSEMENT', connection, now)),
            lastSubmittedTotalCents: totalCents,
            managerReviewBasis: reviewBasis(
              (await originalOpinion(record, 'manager', managerId, connection))
                ? record.managerReviewBasis
                : null,
              identity,
              totalCents,
              record.lastSubmittedTotalCents,
            ),
            headReviewBasis: reviewBasis(
              (await originalOpinion(record, 'head', headId, connection))
                ? record.headReviewBasis
                : null,
              identity,
              totalCents,
              record.lastSubmittedTotalCents,
            ),
          };
        },
        onTransition: ({ record, tx }) =>
          capturePayee(record, tx.handle as DatabaseConnection),
      },
      managerApproved: {
        from: 'manager',
        to: ['head', 'finance'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            needsHead(record) && record.managerId === record.headId
              ? await mergeEvidence(
                  record,
                  services,
                  input,
                  'manager',
                  record.managerId,
                )
              : null,
          );
          return true;
        },
        route: ({ record, services, input }) =>
          needsHead(record) &&
          !services.merges!.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'head'
            : 'finance',
        onTransition: async ({ record, actor, services, input, tx }) => {
          const evidence = services.merges!.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          if (evidence)
            await d.audit.record(
              {
                actorId: actor.id,
                action: 'reimbursement.samePersonMerged',
                targetType: 'reimbursementRequests',
                targetId: record.id,
                after: { ...evidence, stages: ['manager', 'head'] },
              },
              tx.handle as DatabaseConnection,
            );
        },
      },
      headApproved: {
        from: 'head',
        to: 'finance',
        approvalOutcome: 'approved',
      },
      financeApproved: {
        from: 'finance',
        to: ['executive', 'gm', 'cashier'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          needsExecutive(record)
            ? 'executive'
            : needsGm(record)
              ? 'gm'
              : 'cashier',
        set: async ({ record, services, actor, input, now }) => ({
          ...(!needsExecutive(record) && !needsGm(record)
            ? await funding.freezeDebt(
                record,
                command(
                  record,
                  actor.id,
                  `cashier:${record.id}:${record.lifecycleVersion}`,
                  now,
                ),
                services.connection!,
              )
            : {}),
          financeLineFacts: decisions(input),
        }),
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'cashier'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            needsGm(record) && record.executiveId === record.gmId
              ? await mergeEvidence(
                  record,
                  services,
                  input,
                  'executive',
                  record.executiveId,
                )
              : null,
          );
          return true;
        },
        route: ({ record, services, input }) =>
          needsGm(record) &&
          !services.merges!.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'gm'
            : 'cashier',
        set: async ({ record, services, actor, input, now }) =>
          needsGm(record) &&
          !services.merges!.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? {}
            : funding.freezeDebt(
                record,
                command(
                  record,
                  actor.id,
                  `cashier:${record.id}:${record.lifecycleVersion}`,
                  now,
                ),
                services.connection!,
              ),
        onTransition: async ({ record, actor, services, input, tx }) => {
          const evidence = services.merges!.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          if (evidence)
            await d.audit.record(
              {
                actorId: actor.id,
                action: 'reimbursement.samePersonMerged',
                targetType: 'reimbursementRequests',
                targetId: record.id,
                after: { ...evidence, stages: ['executive', 'gm'] },
              },
              tx.handle as DatabaseConnection,
            );
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'cashier',
        approvalOutcome: 'approved',
        set: ({ record, services, actor, now }) =>
          funding.freezeDebt(
            record,
            command(
              record,
              actor.id,
              `cashier:${record.id}:${record.lifecycleVersion}`,
              now,
            ),
            services.connection!,
          ),
      },
      paid: {
        from: 'cashier',
        to: 'paid',
        approvalOutcome: 'approved',
        set: () => ({ paymentId: randomUUID() }),
        onTransition: ({ record, actor, tx, now }) =>
          settle(
            record,
            {
              actorId: actor.id,
              requestKey: `paid:${record.id}:${record.lifecycleVersion}`,
              voucherNumber: record.voucherNumber,
              forced: false,
              now,
            },
            tx.handle as DatabaseConnection,
          ).then(() => undefined),
      },
      forcedPaid: {
        from: 'cashier',
        to: 'forcedPaid',
        approvalOutcome: 'forcedPaid',
        set: ({ input }) => ({
          paymentId: randomUUID(),
          forcedReason: typeof input.reason === 'string' ? input.reason : null,
          voucherNumber:
            typeof input.voucherNumber === 'string'
              ? input.voucherNumber
              : null,
        }),
        onTransition: ({ record, actor, input, tx, now }) =>
          settle(
            record,
            {
              actorId: actor.id,
              requestKey: `forced:${record.id}:${record.lifecycleVersion}`,
              voucherNumber: record.voucherNumber,
              forced: true,
              reason: record.forcedReason!,
              confirmedGrossCents: Number(input.confirmedGrossCents),
              confirmedOffsetCents: Number(input.confirmedOffsetCents),
              confirmedNetCents: Number(input.confirmedNetCents),
              now,
            },
            tx.handle as DatabaseConnection,
          ).then(() => undefined),
      },
      unable: {
        from: 'cashier',
        to: 'exception',
        approvalOutcome: 'rejected',
        set: async ({ record, input, actor, services }) => {
          const task =
            typeof input.runId === 'string'
              ? await services
                  .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
                  .findOne({
                    filter: {
                      runId: input.runId,
                      stage: 'cashier',
                      status: 'completed',
                      answer: 'reject',
                      actorId: actor.id,
                    },
                  })
              : undefined;
          if (!task?.comment?.trim())
            refuse(
              'REIMBURSEMENT_HANDLING_REASON_REQUIRED',
              'Unable-to-pay requires its persisted cashier reason.',
            );
          return {
            exceptionContentHash: hashOf(
              Object.fromEntries(
                [...fields, 'totalCents', 'departmentId'].map((f) => [
                  f,
                  record[f],
                ]),
              ) as JsonObject,
            ),
            handlingFailureReason: task.comment,
          };
        },
      },
      retryCash: {
        from: 'exception',
        to: 'cashier',
        guard: owner,
        onTransition: async ({ record, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          const account = await connection
            .repository<ReimbursementPayee>('reimbursementPayees')
            .findOne({ filter: { requestId: record.id } });
          if (
            !accountSchema.safeParse(
              account && {
                bankName: account.bankName,
                bankAccount: account.bankAccount,
                bankAccountName: account.bankAccountName,
              },
            ).success
          )
            refuse(
              'REIMBURSEMENT_PAYMENT_ACCOUNT_REQUIRED',
              'Correct the payment account before retrying.',
            );
        },
      },
      // The native cashier run is already rejected after unable. Administrative recovery
      // therefore uses a guarded business transition, never edits or reopens SDK tables.
      forcePayException: {
        from: 'exception',
        to: 'forcedPaid',
        guard: ({ actor, services, record, input }) => {
          if (!services.directory.hasRole(actor.id, 'approval.admin'))
            return false;
          const parsed = z
            .strictObject({
              reason: z.string().trim().min(1).max(10000),
              voucherNumber: z.string().trim().min(1).max(128).nullable(),
              confirmedGrossCents: z.number().int().safe().nonnegative(),
              confirmedOffsetCents: z.number().int().safe().nonnegative(),
              confirmedNetCents: z.number().int().safe().nonnegative(),
            })
            .safeParse(input);
          if (!parsed.success) return false;
          const amounts = paymentAmounts(record.totalCents, record.offsetCents);
          return (
            parsed.data.confirmedGrossCents === amounts.grossCents &&
            parsed.data.confirmedOffsetCents === amounts.offsetCents &&
            parsed.data.confirmedNetCents === amounts.netCents
          );
        },
        set: ({ input }) => ({
          paymentId: randomUUID(),
          forcedReason:
            typeof input.reason === 'string' ? input.reason.trim() : '',
          voucherNumber:
            typeof input.voucherNumber === 'string'
              ? input.voucherNumber.trim()
              : null,
        }),
        onTransition: ({ record, actor, input, tx, now }) =>
          settle(
            record,
            {
              actorId: actor.id,
              requestKey: `forced-exception:${record.id}:${record.lifecycleVersion}`,
              voucherNumber: record.voucherNumber,
              forced: true,
              reason: record.forcedReason!,
              confirmedGrossCents: Number(input.confirmedGrossCents),
              confirmedOffsetCents: Number(input.confirmedOffsetCents),
              confirmedNetCents: Number(input.confirmedNetCents),
              now,
            },
            tx.handle as DatabaseConnection,
          ).then(() => undefined),
      },
      retryCashAsAdmin: {
        from: 'exception',
        to: 'cashier',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          Boolean(input.reason.trim()),
        onTransition: async ({ record, actor, input, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          const account = await connection
            .repository<ReimbursementPayee>('reimbursementPayees')
            .findOne({ filter: { requestId: record.id } });
          if (
            !accountSchema.safeParse(
              account && {
                bankName: account.bankName,
                bankAccount: account.bankAccount,
                bankAccountName: account.bankAccountName,
              },
            ).success
          )
            refuse(
              'REIMBURSEMENT_PAYMENT_ACCOUNT_REQUIRED',
              'Correct the payment account before retrying.',
            );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'reimbursement.administrativeRetry',
              targetType: 'reimbursementRequests',
              targetId: record.id,
              after: {
                reason:
                  typeof input.reason === 'string' ? input.reason.trim() : '',
              },
            },
            connection,
          );
        },
      },
      reviseBusiness: {
        from: 'exception',
        to: 'revision',
        guard: owner,
        set: () => ({ financeLineFacts: {}, financeCorrectionLines: [] }),
      },
      returned: {
        from: ['manager', 'head', 'finance', 'executive', 'gm'],
        to: 'revision',
        approvalOutcome: 'returned',
        set: ({ record, input, from }) => ({
          financeLineFacts:
            from === 'finance' ? decisions(input) : record.financeLineFacts,
          financeCorrectionLines:
            from === 'finance' ? record.lines : record.financeCorrectionLines,
        }),
      },
      rejected: {
        from: ['manager', 'head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
        set: ({ record, actor, services, now }) =>
          funding.release(
            record,
            command(
              record,
              actor.id,
              `rejected:${record.id}:${record.lifecycleVersion}`,
              now,
            ),
            services.connection!,
          ),
      },
      withdraw: {
        from: [
          'draft',
          'revision',
          'manager',
          'head',
          'finance',
          'executive',
          'gm',
          'exception',
        ],
        to: 'withdrawn',
        guard: owner,
        set: ({ record, actor, services, now }) =>
          funding.release(
            record,
            command(
              record,
              actor.id,
              `withdraw:${record.id}:${record.lifecycleVersion}`,
              now,
            ),
            services.connection!,
          ),
      },
      terminate: {
        from: [
          'draft',
          'revision',
          'manager',
          'head',
          'finance',
          'executive',
          'gm',
          'cashier',
          'exception',
        ],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          Boolean(input.reason.trim()),
        set: ({ record, actor, services, now }) =>
          funding.release(
            record,
            command(
              record,
              actor.id,
              `terminate:${record.id}:${record.lifecycleVersion}`,
              now,
            ),
            services.connection!,
          ),
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'reimbursement.terminate',
              targetType: 'reimbursementRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : '',
            },
            tx.handle as DatabaseConnection,
          ),
      },
    },
    onEnter: Object.fromEntries(
      ['paid', 'forcedPaid', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `reimbursement.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: ReimbursementRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: REIMBURSEMENT_LIFECYCLE,
              }),
          },
        ],
      ]),
    ),
  });
  runtime.register(approval, { services: source });
  const approvals = createAppApprovalService(
    runtime,
    [approval.approval as unknown as Approval<never>],
    source,
  );
  function fullRows(
    rows: Partial<ReimbursementRecord>[],
  ): ReimbursementRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'reason',
      'authorizationId',
      'loanId',
      'bindingCaptured',
      'boundAuthorizationId',
      'boundLoanId',
      'debtHeldCents',
      'debtHoldRecorded',
      'offsetCents',
      'overrunReason',
      'lines',
      'totalCents',
      'lastSubmittedTotalCents',
      'departmentId',
      'managerId',
      'headId',
      'accountantId',
      'executiveId',
      'gmId',
      'ruleSnapshot',
      'standardSnapshot',
      'managerReviewBasis',
      'headReviewBasis',
      'financeLineFacts',
      'financeCorrectionLines',
      'exceptionContentHash',
      'handlingFailureReason',
      'voucherNumber',
      'paymentId',
      'forcedReason',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new ReimbursementError(
        'REIMBURSEMENT_FIELDS_RESTRICTED',
        'This release requires all training business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizeRecord(row as ReimbursementRecord));
  }
  async function enrich(records: ReimbursementRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.headId,
            r.executiveId,
          ])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = new Map(
      (await Promise.all(ids.map((id) => d.users.get(id))))
        .filter((u) => u !== undefined)
        .map((u) => [u.id, { id: u.id, name: u.name }]),
    );
    return records.map((r) => ({
      ...r,
      applicant: users.get(r.applicantId) ?? null,
      createdBy: users.get(r.createdById) ?? null,
      headApprover: r.headId ? (users.get(r.headId) ?? null) : null,
      executiveApprover: r.executiveId
        ? (users.get(r.executiveId) ?? null)
        : null,
    }));
  }
  function rejectPrivateInput(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(rejectPrivateInput);
      return;
    }
    if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        if (
          [
            'paymentAccount',
            'bankName',
            'bankAccount',
            'bankAccountName',
          ].includes(key)
        )
          refuse(
            'REIMBURSEMENT_PRIVATE_INPUT_FORBIDDEN',
            'Payment details must use the private payment account command.',
          );
        rejectPrivateInput(child);
      }
  }
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(
        d.directory,
        'oa.reimbursement',
      ),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<ReimbursementRecord>('reimbursementRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new ReimbursementError(
        'REIMBURSEMENT_NOT_FOUND',
        'Reimbursement not found.',
        'notFound',
      );
    const scopedRead = policy
      ? await d.db
          .repository('reimbursementRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })
      : undefined;
    if (policy && !scopedRead)
      throw new ReimbursementError(
        'REIMBURSEMENT_ACCESS_DENIED',
        'This reimbursement is outside the granted record scope.',
        'permission',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.applicantId === actorId ||
      r.createdById === actorId ||
      (await approvals.involvementOf(REIMBURSEMENT_LIFECYCLE, id, actorId))
        .length ||
      Boolean(scopedRead)
    )
      return normalizeRecord(r);
    throw new ReimbursementError(
      'REIMBURSEMENT_ACCESS_DENIED',
      'This reimbursement is not accessible.',
      'permission',
    );
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(REIMBURSEMENT_LIFECYCLE, id);
    for (const view of views) {
      if (isOpenRun(view.run)) {
        for (const task of view.tasks) {
          if (
            task.status !== 'pending' ||
            !task.dueAt ||
            Date.parse(task.dueAt) > Date.now() ||
            !task.assigneeId ||
            outside.directory.managerOf(task.assigneeId)
          )
            continue;
          await d.notifications.alarm({
            recordId: id,
            recipients: outside.directory.roleMembers('approval.admin'),
            eventId: `chain-top:${task.id}:${task.dueAt}`,
            reason: 'chainTop',
            kind: REIMBURSEMENT_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: REIMBURSEMENT_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    /** Internal clearance facade: use the departure lifecycle's transaction, without exposing claim amounts. */
    async assertDepartureCleared(
      applicantId: string,
      connection: DatabaseConnection,
    ): Promise<void> {
      const rows = await connection
        .repository<ReimbursementRecord>('reimbursementRequests')
        .findMany({
          filter: { applicantId },
          select: (s) => s.fields('id', 'status'),
        });
      const terminal = new Set([
        'paid',
        'forcedPaid',
        'rejected',
        'withdrawn',
        'terminated',
      ]);
      if (rows.some((row) => !terminal.has(row.status)))
        throw new ReimbursementError(
          'REIMBURSEMENT_DEPARTURE_NOT_CLEARED',
          'Outstanding reimbursement requests must be resolved before departure clearance.',
        );
    },
    async options(
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
      recordId?: string,
    ) {
      await refresh();
      if (recordId) {
        const record = await canRead(recordId, actorId, policy);
        if (record.applicantId !== applicantId)
          throw new ReimbursementError(
            'REIMBURSEMENT_OPTIONS_TARGET_DENIED',
            'Options must match the existing request applicant.',
            'permission',
          );
      } else if (applicantId !== actorId) {
        const create = policy?.create;
        if (
          !outside.directory.hasRole(actorId, 'hr') ||
          !create ||
          (create !== true &&
            (create.scope !== true ||
              create.fields === false ||
              (Array.isArray(create.fields) &&
                !create.fields.includes('applicantId'))))
        )
          refuse(
            'REIMBURSEMENT_ACCESS_DENIED',
            'Delegated options require HR and an unrestricted target create grant.',
          );
      }
      const tx = d.db.connection();
      const authorizations = [];
      for (const a of await d.authorizations.listFor(applicantId, tx)) {
        if (a.state !== 'open') continue;
        const collection =
          a.sourceKind === 'oa.travel'
            ? 'travelRequests'
            : a.sourceKind === 'oa.training'
              ? 'trainingRequests'
              : 'expensePlans';
        const original = await tx
          .repository(collection)
          .findOne({ filter: { authorizationId: a.id, applicantId } });
        if (
          !original ||
          !(
            a.sourceKind === 'oa.travel'
              ? ['booking', 'exception', 'completed']
              : ['approved']
          ).includes(typeof original.status === 'string' ? original.status : '')
        )
          continue;
        const claims = await d.authorizations.claims(a.id, tx);
        const committed = claims
          .filter((claim) => claim.state !== 'cancelled')
          .reduce((sum, claim) => sum + BigInt(claim.cents), 0n);
        authorizations.push({
          id: a.id,
          sourceKind: a.sourceKind,
          sourceReference: a.sourceReference,
          grantedCents: a.grantedCents,
          availableCents: Number(
            BigInt(a.grantedCents) > committed
              ? BigInt(a.grantedCents) - committed
              : 0n,
          ),
        });
      }
      return {
        actorId,
        applicantId,
        timeZone: d.calendar.timeZone(),
        // Only submission readiness is public; no private bank fields leave this facade.
        paymentAccountComplete: accountSchema.safeParse(
          await d.employees.paymentAccountOf(applicantId, tx),
        ).success,
        categories: await d.dictionaries.list('expenseCategory'),
        authorizations,
        loans: (await d.loans.listFor(applicantId, tx))
          .filter((loan) => loan.outstandingCents > 0)
          .map((loan) => ({
            id: loan.id,
            sourceId: loan.sourceId,
            outstandingCents: loan.outstandingCents,
            availableCents: loan.availableCents,
            dueDate: loan.dueDate,
          })),
      };
    },
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<ReimbursementRecord>('reimbursementRequests')
          .findMany();
        const ids: string[] = [];
        for (const record of records) {
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            record.executiveId === actorId ||
            ['finance', 'financeManager', 'cfo', 'gm', 'approval.admin'].some(
              (role) => outside.directory.hasRole(actorId, role),
            )
          ) {
            ids.push(record.id);
            continue;
          }
          const involvement = await approvals.involvementOf(
            REIMBURSEMENT_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            REIMBURSEMENT_LIFECYCLE,
            record.id,
            actorId,
          );
          const head = Boolean(
            (record.departmentId
              ? await d.org.activeChain(record.departmentId)
              : undefined
            )?.some((department) => department.managerId === actorId),
          );
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            involvement.length ||
            acted ||
            outside.directory.hasRole(actorId, 'finance') ||
            outside.directory.hasRole(actorId, 'financeManager') ||
            outside.directory.hasRole(actorId, 'cfo') ||
            record.executiveId === actorId ||
            outside.directory.hasRole(actorId, 'gm') ||
            outside.directory.hasRole(actorId, 'approval.admin') ||
            head ||
            (await d.employees.isAboveInReportingLine(
              actorId,
              record.applicantId,
            ))
          )
            ids.push(record.id);
        }
        return ids;
      });
    },
    async create(
      input: ReimbursementInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
      requestKey?: string,
    ) {
      const parsed = reimbursementInputSchema.safeParse(input);
      if (!parsed.success)
        refuse(
          'REIMBURSEMENT_INVALID_INPUT',
          parsed.error.issues[0]?.message ?? 'Invalid reimbursement.',
        );
      await refresh();
      if (applicantId !== actorId && !outside.directory.hasRole(actorId, 'hr'))
        throw new ReimbursementError(
          'REIMBURSEMENT_ACCESS_DENIED',
          'Only HR may create or replay a delegated draft.',
          'permission',
        );
      const create = (transaction?: DatabaseConnection) =>
        runtime.create(
          REIMBURSEMENT_LIFECYCLE,
          {
            id: randomUUID(),
            ...parsed.data,
            applicantId,
            createdById: actorId,
            number: null,
            totalCents: totalClaimCents(parsed.data.lines),
            lastSubmittedTotalCents: null,
            departmentId: null,
            managerId: null,
            headId: null,
            accountantId: null,
            executiveId: null,
            gmId: null,
            ruleSnapshot: null,
            standardSnapshot: null,
            managerReviewBasis: null,
            headReviewBasis: null,
            financeLineFacts: {},
            financeCorrectionLines: [],
            exceptionContentHash: null,
            handlingFailureReason: null,
            voucherNumber: null,
            paymentId: null,
            forcedReason: null,
            bindingCaptured: false,
            boundAuthorizationId: null,
            boundLoanId: null,
            debtHeldCents: 0,
            debtHoldRecorded: false,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: actorId }, transaction },
        );
      const perform = async () => {
        if (!requestKey) return create();
        if (requestKey.length > 128)
          refuse(
            'REIMBURSEMENT_INVALID_INPUT',
            'Draft request key is too long.',
          );
        return d.db.connection().transaction(async (tx) => {
          for (const id of [...new Set([actorId, applicantId])].sort())
            await lockUserForAdministration(tx, id);
          const commands = tx.repository('reimbursementCreationCommands');
          const fingerprint = JSON.stringify({
            applicantId,
            input: parsed.data,
          });
          const old = await commands.findOne({
            filter: { actorId, requestKey },
          });
          if (old) {
            if (old.fingerprint !== fingerprint)
              throw new ReimbursementError(
                'REIMBURSEMENT_IDEMPOTENCY_CONFLICT',
                'This draft request key identifies different input.',
                'conflict',
              );
            const record = await tx
              .repository<ReimbursementRecord>('reimbursementRequests')
              .findOne({
                filter: {
                  id: typeof old.recordId === 'string' ? old.recordId : '',
                },
              });
            if (!record)
              refuse(
                'REIMBURSEMENT_NOT_FOUND',
                'The original draft no longer exists.',
              );
            return {
              record: normalizeRecord(record),
              entry: null,
              effectRuns: [],
              replayed: true,
            };
          }
          const result = await create(tx);
          await commands.createOne({
            values: {
              id: randomUUID(),
              actorId,
              requestKey,
              fingerprint,
              recordId: result.record.id,
            },
          });
          return result;
        });
      };
      return policy ? writePolicy.run(policy, perform) : perform();
    },
    async transition(
      id: string,
      transition: string,
      actorId: string,
      version: number,
      requestId: string,
      input: JsonObject = {},
      policy?: RepositoryPolicy,
      mutationPolicy?: RepositoryPolicy,
    ) {
      rejectPrivateInput(input);
      await canRead(id, actorId, policy);
      const fire = () =>
        runtime.fire(REIMBURSEMENT_LIFECYCLE, id, transition, {
          manual: true,
          actor: { id: actorId },
          input,
          expect: { version },
          requestId,
        });
      return mutationPolicy ? writePolicy.run(mutationPolicy, fire) : fire();
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      rejectPrivateInput(input.input);
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(REIMBURSEMENT_LIFECYCLE, id),
        target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new ReimbursementError(
          'REIMBURSEMENT_TARGET_MISMATCH',
          'The action belongs to another reimbursement.',
          'permission',
        );
      const perform = () =>
        approvals.perform({ ...input, actor: { id: actorId } });
      return ['appoint', 'reassign'].includes(input.action)
        ? intervention.run(
            {
              actorId,
              recordId: id,
              action: input.action,
              reason: input.comment ?? null,
              depth: 0,
            },
            perform,
          )
        : perform();
    },
    async correctPaymentAccount(
      id: string,
      actorId: string,
      version: number,
      payeeVersion: number,
      account: unknown,
      policy?: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, policy);
      if (!owner({ record, actor: { id: actorId } }))
        throw new ReimbursementError(
          'REIMBURSEMENT_PAYMENT_ACCOUNT_DENIED',
          'Only the applicant or creator may correct their account.',
          'permission',
        );
      const parsed = accountSchema.safeParse(account);
      if (!parsed.success)
        refuse(
          'REIMBURSEMENT_PAYMENT_ACCOUNT_REQUIRED',
          'A complete payment account is required.',
        );
      return d.db.transaction(async (tx) => {
        const lock = await tx.repository('reimbursementRequests').updateMany({
          filter: { id, status: 'exception', lifecycleVersion: version },
          values: { status: 'exception' },
        });
        if (!lock.updatedCount)
          throw new ReimbursementError(
            'REIMBURSEMENT_PAYMENT_ACCOUNT_STALE',
            'Account correction requires the current exception state.',
            'conflict',
          );
        const repo = tx.repository<ReimbursementPayee>('reimbursementPayees');
        const updated = await repo.updateMany({
          filter: { requestId: id, version: payeeVersion },
          values: { ...parsed.data, version: payeeVersion + 1 },
        });
        if (!updated.updatedCount)
          throw new ReimbursementError(
            'REIMBURSEMENT_PAYMENT_ACCOUNT_STALE',
            'The payment account changed. Reload before correcting it.',
            'conflict',
          );
        // Audit versions only: full bank details stay in the private payee table, not public audit/lifecycle logs.
        await d.audit.record(
          {
            actorId,
            action: 'reimbursement.paymentAccountCorrection',
            targetType: 'reimbursementRequests',
            targetId: id,
            before: { version: payeeVersion },
            after: { version: payeeVersion + 1 },
          },
          tx,
        );
        return { version: payeeVersion + 1 };
      });
    },
    async paymentAccount(
      id: string,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, policy);
      if (
        !owner({ record, actor: { id: actorId } }) &&
        !['finance', 'cashier', 'cfo', 'approval.admin'].some((role) =>
          outside.directory.hasRole(actorId, role),
        )
      )
        throw new ReimbursementError(
          'REIMBURSEMENT_PAYMENT_ACCOUNT_DENIED',
          'The payment account is restricted.',
          'permission',
        );
      return d.db
        .repository<ReimbursementPayee>('reimbursementPayees')
        .findOne({ filter: { requestId: id } });
    },
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy);
      return readDirectory.run(outside.directory, async () => {
        const actor = { id: actorId },
          runs = await approvals.runViewsFor(REIMBURSEMENT_LIFECYCLE, id);
        const ids = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.managerId,
              record.headId,
              record.accountantId,
              record.executiveId,
              record.gmId,
              ...runs.flatMap((v) =>
                v.tasks.flatMap((t) => [t.assigneeId, t.actorId]),
              ),
            ].filter((id): id is string => Boolean(id)),
          ),
        ];
        const users = (await Promise.all(ids.map((id) => d.users.get(id))))
          .filter((u) => u !== undefined)
          .map((u) => ({ id: u.id, name: u.name }));
        return {
          record,
          users,
          timeZone: d.calendar.timeZone(),
          runs,
          view: await runtime.view(REIMBURSEMENT_LIFECYCLE, id, actor),
          taskActions: await approvals.actionsFor(
            REIMBURSEMENT_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            REIMBURSEMENT_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            REIMBURSEMENT_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(REIMBURSEMENT_LIFECYCLE, id),
        };
      });
    },
    async candidates(
      id: string,
      target:
        { runId: string; taskId?: never } | { taskId: string; runId?: never },
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(REIMBURSEMENT_LIFECYCLE, id);
      if (
        !views.some((v) =>
          ['cc', 'appoint'].includes(action)
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new ReimbursementError(
          'REIMBURSEMENT_TARGET_MISMATCH',
          'The candidate request belongs to another reimbursement.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
        action,
        actor: { id: actorId },
        query,
      });
      return {
        people: await Promise.all(
          page.people.map(async (id) => ({
            id,
            name: (await d.users.get(id))?.name ?? id,
          })),
        ),
        nextOffset: page.nextOffset,
      };
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<ReimbursementRecord>(
          'reimbursementRequests',
        );
        const scoped = policy ? repository.withPolicy(policy) : repository;
        if (view === 'mine')
          return enrich(
            fullRows(
              await scoped.findMany({
                filter: (f) =>
                  f.or([
                    f.string('applicantId').eq(actorId),
                    f.string('createdById').eq(actorId),
                  ]),
                sort: (s) => [s.field('createdAt').desc()],
              }),
            ),
          );
        // Query-only tasksOf does not include proxies or previously acting delegates. The host checks actual
        // offered operations and persisted actor identities over each request before exposing it in the center.
        const records = fullRows(
          await scoped.findMany({
            sort: (s) => [s.field('createdAt').desc()],
          }),
        );
        const selected: ReimbursementRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              REIMBURSEMENT_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(
                  approvals,
                  REIMBURSEMENT_LIFECYCLE,
                  record.id,
                )
              : [];
          const tasks = runs.flatMap((r) => r.tasks);
          const match =
            view === 'copied'
              ? tasks.some((t) => t.kind === 'copy' && t.assigneeId === actorId)
              : view === 'done'
                ? tasks.some(
                    (t) =>
                      t.actorId === actorId &&
                      ['completed', 'transferred'].includes(t.status),
                  )
                : (
                    await approvals.actionsFor(
                      REIMBURSEMENT_LIFECYCLE,
                      record.id,
                      {
                        id: actorId,
                      },
                    )
                  ).some(
                    (a) =>
                      // Administrative reassignment is available without being the reviewer.
                      // Personal approval work requires an offered decision; actionsFor also resolves delegates.
                      a.task.role !== 'info' &&
                      a.actions.some((action) =>
                        [
                          'approve',
                          'reject',
                          'return',
                          'returnItem',
                          'claim',
                          'complete',
                          'unable',
                        ].includes(action.name),
                      ),
                  );
          if (match) selected.push(record);
        }
        return enrich(selected);
      });
    },
    async maintenance() {
      await refresh();
      const report = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const held = await d.db
        .repository<ReimbursementRecord>('reimbursementRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['manager', 'head', 'finance', 'executive', 'gm', 'cashier'].map(
                (status) => f.string('status').eq(status),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return report;
    },
  };
}
export type ReimbursementService = ReturnType<
  typeof createReimbursementService
>;
export const reimbursementServiceToken =
  createServiceToken<ReimbursementService>('oa/reimbursement-service');
