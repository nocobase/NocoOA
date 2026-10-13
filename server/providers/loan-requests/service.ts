import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import {
  appointAction,
  reassignAction,
} from '../process-management/actions.js';
import { processDirectorySnapshot } from '../process-management/context.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import { z } from 'zod';
import { loanCashActions } from './handling.js';

import { randomUUID } from 'node:crypto';
import {
  ApprovalService,
  APPROVAL_COLLECTIONS,
  type TaskRow,
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  readAction,
  claimAction,
  releaseAction,
  assignAction,
  ccAction,
  defineApprovalAction,
  allActivePeople,
  isOpenRun,
  type Approval,
  type PerformInput,
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

export { loanRequestServiceToken } from './contract.js';
import { lockLoanApplicant, checkLoanQuota } from './quota.js';
import { LoanRequestError } from './errors.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import type { LoanLedgerService } from '../loan-ledger/contract.js';

import { createOaApprovalOperations } from '../approval-directory/operations.js';

import type { OrgService } from '../org/contract.js';
import type { AuditService } from '../audit/index.js';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { EmployeeService } from '../employees/contract.js';
import type {
  ApprovalDirectoryService,
  OaApprovalDirectory,
} from '../approval-directory/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';

import {
  LOAN_REQUEST_LIFECYCLE,
  type LoanRequestRecord,
  type LoanRequestInput,
} from './contract.js';
export {
  LOAN_REQUEST_LIFECYCLE,
  type LoanRequestRecord,
  type LoanRequestInput,
} from './contract.js';

interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: LoanRequestRecord;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'manager'
    | 'cashier'
    | 'exception'
    | 'paid'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface LoanRequestDependencies {
  db: DatabaseManager;
  ledger: LoanLedgerService;
  travelSource?: (
    id: string,
    applicantId: string,
    tx: DatabaseConnection,
  ) => Promise<{
    id: string;
    applicantId: string;
    number: string | null;
    amountCents: number;
    approvedAt: string;
  } | null>;
  travelOptions?: (
    applicantId: string,
    tx: DatabaseConnection,
  ) => Promise<
    readonly { id: string; number: string | null; amountCents: number }[]
  >;
  org: OrgService;

  audit: AuditService;
  users: UserAdministrationService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
}
/** Every ordinary public response, including mutation/history payloads, excludes bank snapshots. */
export function redactLoanPayment<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Date)
    return value;
  if (Array.isArray(value)) return value.map(redactLoanPayment) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      ['paymentAccount', 'bankName', 'bankAccountName', 'bankAccount'].includes(
        key,
      )
        ? null
        : redactLoanPayment(child),
    ]),
  ) as T;
}
export function refuse(reason: string, message: string): never {
  throw new LoanRequestError(reason, message);
}
function normalizeLoanRecord(record: LifecycleRecord): LoanRequestRecord {
  const amountCents = Number(record.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0)
    refuse(
      'LOAN_REQUEST_INVALID_AMOUNT',
      'Stored budget amounts must be safe integer cents.',
    );
  const heldCents = Number(record.heldCents);
  if (!Number.isSafeInteger(heldCents) || heldCents < 0)
    refuse(
      'LOAN_REQUEST_INVALID_AMOUNT',
      'Stored reservations must be safe integer cents.',
    );
  return { ...record, amountCents, heldCents } as LoanRequestRecord;
}
export function createLoanRequestService(d: LoanRequestDependencies) {
  let outside: Services;
  const mutationRecord = new AsyncLocalStorage<string>();
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
            return collection === 'loanRequests' && record
              ? normalizeLoanRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'loanRequests'
              ? normalizeLoanRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'loanRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new LoanRequestError(
                'LOAN_REQUEST_FIELDS_RESTRICTED',
                'The grant must expose the created loan request record.',
                'permission',
              );
            return normalizeLoanRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'loanRequests')
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
              const mutationId = mutationRecord.getStore();
              if (mutationId) {
                const record = await connection
                  .repository<LoanRequestRecord>('loanRequests')
                  .findOne({ filter: { id: mutationId } });
                if (record) {
                  if (record.travelId && d.travelSource)
                    await d.travelSource(
                      record.travelId,
                      record.applicantId,
                      connection,
                    );
                  await lockLoanApplicant(record.applicantId, connection);
                }
              }
              snapshots.set(connection, {
                directory:
                  readDirectory.getStore() ??
                  (await processDirectorySnapshot(
                    d.directory,
                    'oa.loan',
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
                      action: `loanRequest.${change.action}`,
                      targetType: 'loanRequests',
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
    record: LoanRequestRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields: (keyof LoanRequestInput)[] = [
    'reason',
    'amountCents',
    'dueDate',
    'travelId',
  ];
  const stage = stagesFor<Types>();
  const loanAppointmentAction = defineApprovalAction({
    ...appointAction,
    people: async (context, query) => {
      const page = await allActivePeople().search(context, query);
      return {
        ...page,
        people: page.people.filter(
          (person) =>
            context.eligible(person, {
              replacing: false,
              kind: 'decide',
              role: 'member',
              via: 'assign',
            }).ok,
        ),
      };
    },
  });
  const loanReassignAction = defineApprovalAction({
    ...reassignAction,
    people: async (context, query) => {
      const page = await allActivePeople().search(context, query);
      return {
        ...page,
        people: page.people.filter(
          (person) =>
            context.eligible(person, { replacing: true, via: 'reassign' }).ok,
        ),
      };
    },
  });
  const actions = [
    ...createOaApprovalOperations(d),
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    defineApprovalAction({
      ...ccAction,
      people: (context, query) => allActivePeople().search(context, query),
      validate: ({ to }, context) =>
        typeof to === 'string' && context.directory.isActive(to)
          ? null
          : 'Choose an active recipient.',
    }),
    readAction,
    claimAction,
    releaseAction,
    assignAction,
    loanAppointmentAction,
    loanReassignAction,
  ];
  const auditInflight = async ({
    record,
    previous,
    actor,
    tx,
  }: {
    record: LoanRequestRecord;
    previous: LoanRequestRecord;
    actor: { id: string };
    tx: { handle: unknown };
  }) => {
    if (record.heldCents === previous.heldCents) return;
    await d.audit.record(
      {
        actorId: actor.id,
        action: 'loanRequest.inflightChanged',
        targetType: 'loanRequests',
        targetId: record.id,
        before: { heldCents: previous.heldCents },
        after: {
          heldCents: record.heldCents,
          quotaSnapshot: record.quotaSnapshot,
        },
      },
      tx.handle as DatabaseConnection,
    );
  };
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  async function validate(
    record: LoanRequestRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'LOAN_REQUEST_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !Number.isSafeInteger(record.amountCents) ||
      record.amountCents <= 0 ||
      !record.reason.trim() ||
      record.reason.length > 10000
    )
      refuse(
        'LOAN_REQUEST_INVALID_INPUT',
        'A positive integer amount and reason are required.',
      );
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate) ||
      !Number.isFinite(Date.parse(`${record.dueDate}T12:00:00Z`)) ||
      new Date(`${record.dueDate}T12:00:00Z`).toISOString().slice(0, 10) !==
        record.dueDate ||
      record.dueDate < d.calendar.localDate(new Date())
    )
      refuse(
        'LOAN_REQUEST_INVALID_DATE',
        'Choose a valid current or future company calendar date.',
      );
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'LOAN_REQUEST_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    return department;
  }
  const needsExecutive = (record: LoanRequestRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.vp'],
    );
  const needsGm = (record: LoanRequestRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.gm'],
    );
  async function mergeEvidence(
    record: LoanRequestRecord,
    services: Services,
    input: JsonObject,
  ) {
    if (
      !needsGm(record) ||
      !record.executiveApproverId ||
      record.executiveApproverId !== record.gmApproverId ||
      typeof input.runId !== 'string'
    )
      return null;
    // Read-only adapter: the public service's runViewsFor opens independent transactions, so it cannot
    // observe this answer before commit. Read the plugin's public TaskRow/collection contract in the
    // caller transaction; only ApprovalService writes approval state.
    const tasks = await services
      .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
      .findMany({
        filter: {
          runId: input.runId,
          stage: 'executive',
          enteredVersion: record.lifecycleVersion,
          status: 'completed',
          depth: 0,
          mode: null,
          answer: 'approve',
          role: 'member',
          assigneeId: record.executiveApproverId,
          actorId: record.executiveApproverId,
        },
      });
    const task = tasks.find((t) => t.kind === 'decide');
    return task
      ? {
          runId: input.runId,
          taskId: task.id,
          personId: record.executiveApproverId,
        }
      : null;
  }
  async function paymentAccount(
    record: LoanRequestRecord,
    tx: DatabaseConnection,
  ): Promise<JsonObject | null> {
    const account = await d.employees.paymentAccountOf(record.applicantId, tx);
    return account &&
      account.bankName?.trim() &&
      account.bankAccount?.trim() &&
      account.bankAccountName?.trim()
      ? {
          bankName: account.bankName,
          bankAccountName: account.bankAccountName,
          bankAccount: account.bankAccount,
        }
      : null;
  }
  const approval = defineApproval<Types>({
    name: LOAN_REQUEST_LIFECYCLE,
    collection: 'loanRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [...fields, 'departmentId'],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: () => [] },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<LoanRequestRecord>('loanRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: LOAN_REQUEST_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    states: [
      'draft',
      'revision',
      approvalState(
        'manager',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.managerApproverId ?? undefined,
        }),
      ),
      'exception',
      approvalState(
        'cashier',
        stage.first({
          qualification: 'cashier',
          onEmpty: 'hold',
          remindAfterHours: 24,
          pools: [
            {
              key: 'cashier',
              candidates: ({ services }) =>
                services.directory.roleMembers('cashier'),
              claimable: true,
            },
          ],
          actions: [
            claimAction,
            releaseAction,
            assignAction,
            commentAction,
            readAction,
            loanAppointmentAction,
            loanReassignAction,
            loanCashActions.complete,
            loanCashActions.unable,
            createOaApprovalOperations(d)[0],
            createOaApprovalOperations(d)[2],
          ],
          outputs: {
            fields: { paymentVoucher: z.string().trim().min(1).max(255) },
            required: ['paymentVoucher'],
            writes: { paymentVoucher: 'paymentVoucher' },
          },
        }),
      ),
      approvalState(
        'head',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.headApproverId ?? undefined,
        }),
      ),
      approvalState(
        'finance',
        stage.any({
          ...settings,
          assignees: ({ services }) =>
            services.directory.roleMembers('finance'),
        }),
      ),
      approvalState(
        'executive',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.executiveApproverId ?? undefined,
        }),
      ),
      approvalState(
        'gm',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.gmApproverId ?? undefined,
        }),
      ),
      { name: 'paid' },
      ...(['rejected', 'withdrawn', 'terminated'] as const).map((name) => ({
        name,
        final: true,
      })),
    ],
    create: {
      guard: async ({ values, actor, services }) => {
        if (
          typeof values.applicantId !== 'string' ||
          (values.applicantId !== actor.id &&
            !services.directory.hasRole(actor.id, 'hr'))
        )
          return false;
        const employee = await d.employees.getByUserId(
          values.applicantId,
          services.connection,
        );
        return Boolean(employee?.active && employee.status !== 'left');
      },
    },
    transitions: {
      edit: {
        from: ['draft', 'revision'],
        to: ['draft', 'revision'],
        guard: owner,
        route: ({ record }) => record.status as 'draft' | 'revision',
        accept: fields,
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'manager',
        guard: owner,
        set: async ({ record, services, now }) => {
          const tx = services.connection!;
          if (record.travelId) {
            if (
              !d.travelSource ||
              !(await d.travelSource(record.travelId, record.applicantId, tx))
            )
              refuse(
                'LOAN_REQUEST_INVALID_TRAVEL',
                'Choose your own approved active travel request.',
              );
          }
          await lockLoanApplicant(record.applicantId, tx);
          const department = await validate(record, tx),
            snapshot =
              record.ruleSnapshot ??
              (await d.rules.snapshot(
                [
                  'loan.personalMax',
                  'spend.vp',
                  'spend.gm',
                  'sla.remindHours',
                  'sla.escalateHours',
                  'sla.urgeCooldownHours',
                ],
                now,
                tx,
              ));
          if (
            snapshot['sla.remindHours'] !== 24 ||
            snapshot['sla.escalateHours'] !== 48
          )
            refuse(
              'LOAN_REQUEST_SLA_CONFIGURATION_UNSUPPORTED',
              'Only default approval working-hour clocks are supported.',
            );
          const quotaSnapshot = await checkLoanQuota(
            {
              recordId: record.id,
              applicantId: record.applicantId,
              amountCents: record.amountCents,
              maxRule: snapshot['loan.personalMax'],
              localDate: d.calendar.localDate(now),
            },
            d.ledger,
            tx,
          );
          return {
            number: record.number ?? (await d.sequences.next('LN', tx, now)),
            departmentId: department.id,
            heldCents: record.amountCents,
            ruleSnapshot: snapshot,
            quotaSnapshot,
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
            headApproverId: (await d.org.headOf(department.id, tx)) ?? null,
            executiveApproverId:
              (await d.org.executiveOf(department.id, tx)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            gmMerged: null,
          };
        },
        onTransition: auditInflight,
      },
      managerApproved: {
        from: 'manager',
        to: 'head',
        approvalOutcome: 'approved',
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
        set: async ({ record, now, services }) =>
          needsExecutive(record) || needsGm(record)
            ? {}
            : {
                approvalGrantedAt: now.toISOString(),
                paymentAccount: await paymentAccount(
                  record,
                  services.connection!,
                ),
              },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'cashier'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            await mergeEvidence(record, services, input),
          );
          return true;
        },
        route: ({ record, services, input }) =>
          needsGm(record) &&
          !services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'gm'
            : 'cashier',
        set: async ({ record, services, input, now }) => {
          const merged = services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          return needsGm(record) && !merged
            ? {}
            : {
                approvalGrantedAt: now.toISOString(),
                paymentAccount: await paymentAccount(
                  record,
                  services.connection!,
                ),
                gmMerged: merged
                  ? {
                      ...merged,
                      at: now.toISOString(),
                      stages: ['executive', 'gm'],
                    }
                  : null,
              };
        },
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'cashier' && record.gmMerged)
            await d.audit.record(
              {
                actorId: actor.id,
                action: 'loanRequest.samePersonMerged',
                targetType: 'loanRequests',
                targetId: record.id,
                after: record.gmMerged,
              },
              tx.handle as DatabaseConnection,
            );
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'cashier',
        approvalOutcome: 'approved',
        set: async ({ record, now, services }) => ({
          approvalGrantedAt: now.toISOString(),
          paymentAccount: await paymentAccount(record, services.connection!),
        }),
      },
      cashCompleted: {
        from: 'cashier',
        to: 'paid',
        approvalOutcome: 'approved',
        guard: ({ record, input }) =>
          Boolean(record.paymentAccount) &&
          typeof (input.outputs as JsonObject | undefined)?.paymentVoucher ===
            'string',
        set: ({ now }) => ({ heldCents: 0, paidAt: now.toISOString() }),
        onTransition: async ({ record, actor, tx, previous }) => {
          const connection = tx.handle as DatabaseConnection;
          await lockLoanApplicant(record.applicantId, connection);
          await d.ledger.issue(
            {
              sourceId: record.id,
              applicantId: record.applicantId,
              principalCents: record.amountCents,
              dueDate: record.dueDate,
              actorId: actor.id,
              reason: `Cash voucher ${record.paymentVoucher}`,
              requestKey: `loan:${record.id}:issue:${previous.lifecycleVersion}`,
            },
            connection,
          );
        },
      },
      cashUnable: {
        from: 'cashier',
        to: 'exception',
        approvalOutcome: 'rejected',
      },
      retryCash: {
        from: 'exception',
        to: 'cashier',
        guard: owner,
        set: async ({ record, services }) => ({
          paymentAccount: await paymentAccount(record, services.connection!),
        }),
      },
      rejected: {
        from: ['manager', 'head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
        set: () => ({ heldCents: 0 }),
        onTransition: auditInflight,
      },
      returned: {
        from: ['manager', 'head', 'finance', 'executive', 'gm'],
        to: 'revision',
        approvalOutcome: 'returned',
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
        ],
        to: 'withdrawn',
        guard: owner,
        set: () => ({ heldCents: 0 }),
        onTransition: auditInflight,
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
          input.reason.trim().length > 0,
        set: () => ({ heldCents: 0 }),
        onTransition: async ({ record, actor, input, tx }) => {
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'loanRequest.terminate',
              targetType: 'loanRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
        },
      },
      cancelTravel: {
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
        manual: false,
        guard: ({ input }) => input.travelCancellation === true,
        set: () => ({ heldCents: 0 }),
      },
      returnDue: {
        from: 'paid',
        to: 'paid',
        manual: false,
        guard: ({ input }) => input.travelCancellation === true,
        set: ({ record, now, input }) => ({
          returnDueDate:
            record.returnDueDate &&
            record.returnDueDate <
              (typeof input.returnDate === 'string'
                ? input.returnDate
                : d.calendar.localDate(now))
              ? record.returnDueDate
              : typeof input.returnDate === 'string'
                ? input.returnDate
                : d.calendar.localDate(now),
        }),
        onTransition: async ({ record, previous, actor, input, tx }) => {
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'loanRequest.returnDue',
              targetType: 'loanRequests',
              targetId: record.id,
              before: {
                dueDate: previous.dueDate,
                returnDueDate: previous.returnDueDate,
              },
              after: {
                dueDate: record.dueDate,
                returnDueDate: record.returnDueDate,
              },
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
        },
      },
    },
    onEnter: Object.fromEntries(
      ['paid', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `loanRequest.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: LoanRequestRecord;
              idempotencyKey: string;
            }) =>
              state === 'paid' && record.returnDueDate
                ? Promise.resolve()
                : d.notifications.result({
                    recordId: record.id,
                    applicantId: record.applicantId,
                    state,
                    transitionId: idempotencyKey,
                    kind: LOAN_REQUEST_LIFECYCLE,
                  }),
          },
        ],
      ]),
    ),
  });
  runtime.register(approval, { services: source });
  const approvals = new ApprovalService(
    runtime,
    [approval.approval as unknown as Approval<never>],
    source,
  );
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(d.directory, 'oa.loan'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<LoanRequestRecord>('loanRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new LoanRequestError(
        'LOAN_REQUEST_NOT_FOUND',
        'LoanRequest request not found.',
        'notFound',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(LOAN_REQUEST_LIFECYCLE, id, actorId))
        .length ||
      Boolean(
        policy &&
        (await d.db
          .repository<LoanRequestRecord>('loanRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return normalizeLoanRecord(r);
    throw new LoanRequestError(
      'LOAN_REQUEST_ACCESS_DENIED',
      'This loan request is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<LoanRequestRecord>[]): LoanRequestRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'departmentId',
      'amountCents',
      'reason',
      'dueDate',
      'travelId',
      'heldCents',
      'ruleSnapshot',
      'headApproverId',
      'managerApproverId',
      'executiveApproverId',
      'gmApproverId',
      'gmMerged',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new LoanRequestError(
        'LOAN_REQUEST_FIELDS_RESTRICTED',
        'This release requires all loan request business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizeLoanRecord(row as LoanRequestRecord));
  }
  function canReadPayment(record: LoanRequestRecord, actorId: string) {
    return (
      record.applicantId === actorId ||
      ['finance', 'cashier', 'approval.admin', 'cfo'].some((role) =>
        outside.directory.hasRole(actorId, role),
      )
    );
  }
  async function enrich(records: LoanRequestRecord[], _actorId: string) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.managerApproverId,
            r.headApproverId,
            r.executiveApproverId,
            r.gmApproverId,
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
      paymentAccount: null,
      managerApprover: r.managerApproverId
        ? (users.get(r.managerApproverId) ?? null)
        : null,
      applicant: users.get(r.applicantId) ?? null,
      createdBy: users.get(r.createdById) ?? null,
      headApprover: r.headApproverId
        ? (users.get(r.headApproverId) ?? null)
        : null,
      gmApprover: r.gmApproverId ? (users.get(r.gmApproverId) ?? null) : null,
      executiveApprover: r.executiveApproverId
        ? (users.get(r.executiveApproverId) ?? null)
        : null,
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(LOAN_REQUEST_LIFECYCLE, id);
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
            kind: LOAN_REQUEST_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: LOAN_REQUEST_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async options(actorId: string) {
      return {
        timeZone: d.calendar.timeZone(),
        travelSources: d.travelOptions
          ? await d.travelOptions(actorId, d.db.connection())
          : [],
        paymentAccountReady: Boolean(
          await paymentAccount(
            { applicantId: actorId } as LoanRequestRecord,
            d.db.connection(),
          ),
        ),
        rules: await d.rules.snapshot(
          ['loan.personalMax', 'spend.vp', 'spend.gm'],
          new Date(),
        ),
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<LoanRequestRecord>('loanRequests')
          .findMany();
        const ids: string[] = [];
        for (const record of records) {
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            record.executiveApproverId === actorId ||
            ['finance', 'cashier', 'cfo', 'gm', 'approval.admin'].some((role) =>
              outside.directory.hasRole(actorId, role),
            )
          ) {
            ids.push(record.id);
            continue;
          }
          const head = Boolean(
            (record.departmentId
              ? await d.org.activeChain(record.departmentId)
              : undefined
            )?.some((department) => department.managerId === actorId),
          );
          if (
            head ||
            (await d.employees.isAboveInReportingLine(
              actorId,
              record.applicantId,
            ))
          ) {
            ids.push(record.id);
            continue;
          }
          const involvement = await approvals.involvementOf(
            LOAN_REQUEST_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const runs = await runTaskViewsFor(
            approvals,
            LOAN_REQUEST_LIFECYCLE,
            record.id,
          );
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            involvement.length ||
            runs.some((r) => r.tasks.some((t) => t.actorId === actorId)) ||
            outside.directory.hasRole(actorId, 'finance') ||
            outside.directory.hasRole(actorId, 'cashier') ||
            outside.directory.hasRole(actorId, 'cfo') ||
            record.executiveApproverId === actorId ||
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
    async repayments(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy);
      const loan = (await d.ledger.listFor(record.applicantId)).find(
        (l) => l.sourceId === id,
      );
      if (!loan) return { loan: null, reservations: [] };
      const reservations = await d.db
        .repository('loanReservations')
        .findMany({ filter: { loanId: loan.id } });
      return {
        loan: {
          ...loan,
          effectiveDueDate:
            record.returnDueDate && record.returnDueDate < loan.dueDate
              ? record.returnDueDate
              : loan.dueDate,
        },
        // PostgreSQL bigint values may be strings. Keep the public DTO in safe
        // integer cents, and fail rather than round an invalid stored amount.
        reservations: reservations.map((reservation) => {
          const raw = reservation.cents;
          const cents =
            typeof raw === 'number' ||
            (typeof raw === 'string' && /^\d+$/.test(raw))
              ? Number(raw)
              : NaN;
          if (!Number.isSafeInteger(cents) || cents <= 0)
            throw new Error('Invalid stored repayment amount');
          return { ...reservation, cents };
        }),
      };
    },
    async cashRepayment(
      id: string,
      input: {
        receiptId: string;
        cents?: number;
        reason: string;
        requestKey: string;
        operation: 'record' | 'confirm' | 'cancel';
      },
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, policy);
      const directory = await processDirectorySnapshot(d.directory, 'oa.loan');
      if (
        input.operation === 'confirm'
          ? actorId !== record.applicantId
          : !directory.hasRole(actorId, 'cashier')
      )
        refuse(
          'LOAN_REQUEST_REPAYMENT_ACCESS_DENIED',
          'Only the cashier records or cancels repayments; the borrower confirms them.',
        );
      if (
        !input.receiptId.trim() ||
        !input.reason.trim() ||
        !input.requestKey.trim()
      )
        refuse(
          'LOAN_REQUEST_REPAYMENT_INPUT_INVALID',
          'Receipt, reason and request key are required.',
        );
      return d.db.connection().transaction(async (tx) => {
        await lockLoanApplicant(record.applicantId, tx);
        const loan = (await d.ledger.listFor(record.applicantId, tx)).find(
          (l) => l.sourceId === id,
        );
        if (!loan)
          refuse(
            'LOAN_REQUEST_NOT_PAID',
            'No paid loan exists for this request.',
          );
        const command = {
          loanId: loan.id,
          receiptId: input.receiptId.trim(),
          actorId,
          reason: input.reason.trim(),
          requestKey: input.requestKey,
        };
        if (input.operation === 'record')
          return d.ledger.recordCashRepayment(
            { ...command, cents: input.cents ?? 0 },
            tx,
          );
        if (input.operation === 'confirm')
          return d.ledger.confirmCashRepayment(command, tx);
        return d.ledger.cancelCashRepayment(command, tx);
      });
    },
    async markReturnDue(
      input: {
        travelId: string;
        actorId: string;
        reason: string;
        requestKey: string;
        now?: Date;
      },
      connection: DatabaseConnection,
    ) {
      if (
        !input.travelId ||
        input.travelId.length > 64 ||
        !input.actorId ||
        !input.reason.trim() ||
        input.reason.length > 4000 ||
        !input.requestKey ||
        input.requestKey.length > 255 ||
        (input.now && !Number.isFinite(input.now.getTime()))
      )
        refuse(
          'LOAN_REQUEST_INVALID_COMMAND',
          'Travel, actor, reason and request key are required.',
        );
      return connection.transaction(async (tx) => {
        const repo = tx.repository('loanReturnCommands'),
          fingerprint = JSON.stringify({
            actorId: input.actorId,
            reason: input.reason,
            travelId: input.travelId,
          });
        const prior = await repo.findOne({
          filter: { travelId: input.travelId, requestKey: input.requestKey },
        });
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            refuse(
              'LOAN_REQUEST_IDEMPOTENCY_CONFLICT',
              'This cancellation key already identifies another command.',
            );
          return prior.result as { terminated: string[]; returnDue: string[] };
        }
        const records = await tx
          .repository<LoanRequestRecord>('loanRequests')
          .findMany({
            filter: { travelId: input.travelId },
            sort: (s) => s.field('applicantId').asc(),
          });
        for (const applicantId of [
          ...new Set(records.map((r) => r.applicantId)),
        ].sort())
          await lockLoanApplicant(applicantId, tx);
        const result: { terminated: string[]; returnDue: string[] } = {
          terminated: [],
          returnDue: [],
        };
        for (const record of records) {
          if (['withdrawn', 'rejected', 'terminated'].includes(record.status))
            continue;
          if (record.status === 'paid') {
            const loan = (await d.ledger.listFor(record.applicantId, tx)).find(
              (l) => l.sourceId === record.id,
            );
            if (!loan || loan.outstandingCents === 0) continue;
          }
          const transition =
            record.status === 'paid' ? 'returnDue' : 'cancelTravel';
          await mutationRecord.run(record.id, () =>
            runtime.fire(LOAN_REQUEST_LIFECYCLE, record.id, transition, {
              actor: { id: input.actorId },
              input: {
                travelCancellation: true,
                reason: input.reason,
                returnDate: d.calendar.localDate(input.now ?? new Date()),
              },
              requestId: `travel-cancel:${input.requestKey}`,
              transaction: tx,
            }),
          );
          result[record.status === 'paid' ? 'returnDue' : 'terminated'].push(
            record.id,
          );
        }
        await repo.createOne({
          values: {
            id: randomUUID(),
            travelId: input.travelId,
            requestKey: input.requestKey,
            fingerprint,
            result,
          },
        });
        await d.audit.record(
          {
            actorId: input.actorId,
            action: 'loanRequest.travelCancelled',
            targetType: 'travelRequests',
            targetId: input.travelId,
            reason: input.reason,
            after: result,
          },
          tx,
        );
        return result;
      });
    },
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    async create(
      input: LoanRequestInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
      requestKey?: string,
    ) {
      await refresh();
      const create = (connection?: DatabaseConnection) =>
        runtime.create(
          LOAN_REQUEST_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,

            heldCents: 0,
            ruleSnapshot: null,
            quotaSnapshot: null,
            headApproverId: null,
            executiveApproverId: null,
            gmApproverId: null,
            gmMerged: null,
            managerApproverId: null,
            paymentAccount: null,
            paymentVoucher: null,
            approvalGrantedAt: null,
            paidAt: null,
            returnDueDate: null,
            departmentId: null,

            createdAt: new Date().toISOString(),
          },
          {
            actor: { id: actorId },
            ...(connection ? { transaction: connection } : {}),
          },
        );
      const perform = async () => {
        if (!requestKey) return create();
        return d.db.connection().transaction(async (tx) => {
          await lockLoanApplicant(applicantId, tx);
          const commands = tx.repository('loanCreationCommands');
          const fingerprint = JSON.stringify({ input, applicantId });
          const old = await commands.findOne({
            filter: { actorId, requestKey },
          });
          if (old) {
            if (old.fingerprint !== fingerprint)
              refuse(
                'LOAN_REQUEST_IDEMPOTENCY_CONFLICT',
                'This draft key already identifies different input.',
              );
            const record = await tx
              .repository<LoanRequestRecord>('loanRequests')
              .findOne({ filter: { id: old.recordId as string } });
            if (!record)
              refuse(
                'LOAN_REQUEST_NOT_FOUND',
                'The original draft no longer exists.',
              );
            return {
              record,
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
      return redactLoanPayment(
        await (policy ? writePolicy.run(policy, perform) : perform()),
      );
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
      await canRead(id, actorId, policy);
      const fire = () =>
        runtime.fire(LOAN_REQUEST_LIFECYCLE, id, transition, {
          manual: true,
          actor: { id: actorId },
          input,
          expect: { version },
          requestId,
        });
      return redactLoanPayment(
        await mutationRecord.run(id, () =>
          mutationPolicy ? writePolicy.run(mutationPolicy, fire) : fire(),
        ),
      );
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(LOAN_REQUEST_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new LoanRequestError(
          'LOAN_REQUEST_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const perform = () =>
        mutationRecord.run(id, () =>
          approvals.perform({ ...input, actor: { id: actorId } }),
        );
      return redactLoanPayment(
        await (['appoint', 'reassign'].includes(input.action)
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
          : perform()),
      );
    },
    async candidates(
      id: string,
      targetId: string,
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(LOAN_REQUEST_LIFECYCLE, id);
      const runScoped = ['cc', 'appoint'].includes(action);
      if (
        !views.some((view) =>
          runScoped
            ? view.run.id === targetId
            : view.tasks.some((task) => task.id === targetId),
        )
      )
        throw new LoanRequestError(
          'LOAN_REQUEST_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target: runScoped ? { runId: targetId } : { taskId: targetId },
        action,
        actor: { id: actorId },
        query,
      });
      const people = await Promise.all(
        page.people.map(async (id) => {
          const user = await d.users.get(id);
          return { id, name: user?.name ?? id };
        }),
      );
      return { people, nextOffset: page.nextOffset };
    },
    async paymentInfo(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy);
      if (!canReadPayment(record, actorId))
        refuse(
          'LOAN_REQUEST_PAYMENT_ACCESS_DENIED',
          'Only the borrower and authorized financial roles may read payment details.',
        );
      return record.paymentAccount;
    },
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy);
      return redactLoanPayment(
        await readDirectory.run(outside.directory, async () => {
          const actor = { id: actorId };
          const runs = await approvals.runViewsFor(LOAN_REQUEST_LIFECYCLE, id);
          const userIds = [
            ...new Set(
              [
                record.applicantId,
                record.createdById,
                record.managerApproverId,
                record.headApproverId,
                record.executiveApproverId,
                record.gmApproverId,

                ...runs.flatMap((v) =>
                  v.tasks.flatMap((t) => [t.assigneeId, t.actorId]),
                ),
              ].filter((v): v is string => Boolean(v)),
            ),
          ];
          const users = (
            await Promise.all(userIds.map((id) => d.users.get(id)))
          )
            .filter((v) => v !== undefined)
            .map((v) => ({ id: v.id, name: v.name }));
          return {
            timeZone: d.calendar.timeZone(),
            department: record.departmentId
              ? ((await d.org.activeChain(record.departmentId))?.map((d) => ({
                  id: d.id,
                  title: d.title,
                }))[0] ?? null)
              : null,
            loan:
              (await d.ledger.listFor(record.applicantId)).find(
                (loan) => loan.sourceId === record.id,
              ) ?? null,
            record: {
              ...record,
              paymentAccount: null,
            },
            users,
            view: await runtime
              .view(LOAN_REQUEST_LIFECYCLE, id, actor)
              .then((view) => ({
                ...view,
                record: {
                  ...view.record,
                  paymentAccount: null,
                },
              })),
            runs: await approvals.runViewsFor(LOAN_REQUEST_LIFECYCLE, id),
            taskActions: await approvals.actionsFor(
              LOAN_REQUEST_LIFECYCLE,
              id,
              actor,
            ),
            runActions: await approvals.runActionsFor(
              LOAN_REQUEST_LIFECYCLE,
              id,
              actor,
            ),
            upcoming: await approvals.upcomingStagesFor(
              LOAN_REQUEST_LIFECYCLE,
              id,
              actor,
            ),
            timeline: await approvals.timelineFor(LOAN_REQUEST_LIFECYCLE, id),
          };
        }),
      );
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<LoanRequestRecord>('loanRequests');
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
            actorId,
          );
        // Query-only tasksOf does not include proxies or previously acting delegates. The host checks actual
        // offered operations and persisted actor identities over each request before exposing it in the center.
        const records = fullRows(
          await scoped.findMany({
            sort: (s) => [s.field('createdAt').desc()],
          }),
        );
        const selected: LoanRequestRecord[] = [];
        for (const record of records) {
          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(
                  approvals,
                  LOAN_REQUEST_LIFECYCLE,
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
                      LOAN_REQUEST_LIFECYCLE,
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
                          'complete',
                          'unable',
                          'claim',
                        ].includes(action.name),
                      ),
                  );
          if (match) selected.push(record);
        }
        return enrich(selected, actorId);
      });
    },
    async maintenance() {
      await refresh();
      const sweep = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const held = await d.db
        .repository<LoanRequestRecord>('loanRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['manager', 'head', 'finance', 'executive', 'gm', 'cashier'].map(
                (s) => f.string('status').eq(s),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type LoanRequestService = ReturnType<typeof createLoanRequestService>;
