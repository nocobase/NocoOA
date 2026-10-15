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
import { lockUserForAdministration } from '@nocobase/app-plugin-authentication';
import { randomUUID } from 'node:crypto';
import {
  isOpenRun,
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
  ccAction,
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
import { createServiceToken } from '@nocobase/service-provider';
import { ExpensePlanError } from './errors.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import type { BudgetService } from '../budgets/contract.js';
import type { DictionaryService } from '../platform/dictionaries.js';
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
  EXPENSE_PLAN_LIFECYCLE,
  type ExpensePlanRecord,
  type ExpensePlanInput,
} from './contract.js';
export {
  EXPENSE_PLAN_LIFECYCLE,
  type ExpensePlanRecord,
  type ExpensePlanInput,
} from './contract.js';
import type { ExpenseAuthorizationService } from '../expense-authorizations/contract.js';
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: ExpensePlanRecord;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface ExpensePlanDependencies {
  db: DatabaseManager;
  budgets: BudgetService;
  authorizations: ExpenseAuthorizationService;
  dictionaries: DictionaryService;
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
export function refuse(reason: string, message: string): never {
  throw new ExpensePlanError(reason, message);
}
function normalizeExpenseRecord(record: LifecycleRecord): ExpensePlanRecord {
  const amountCents = Number(record.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0)
    refuse(
      'EXPENSE_PLAN_INVALID_AMOUNT',
      'Stored budget amounts must be safe integer cents.',
    );
  const heldCents = Number(record.heldCents);
  if (!Number.isSafeInteger(heldCents) || heldCents < 0)
    refuse(
      'EXPENSE_PLAN_INVALID_AMOUNT',
      'Stored reservations must be safe integer cents.',
    );
  return { ...record, amountCents, heldCents } as ExpensePlanRecord;
}
export function createExpensePlanService(d: ExpensePlanDependencies) {
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
            return collection === 'expensePlans' && record
              ? normalizeExpenseRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'expensePlans'
              ? normalizeExpenseRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'expensePlans')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new ExpensePlanError(
                'EXPENSE_PLAN_FIELDS_RESTRICTED',
                'The grant must expose the created expense plan record.',
                'permission',
              );
            return normalizeExpenseRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'expensePlans')
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
                    'oa.expensePlan',
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
                      action: `expensePlan.${change.action}`,
                      targetType: 'expensePlans',
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
    record: ExpensePlanRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = [
    'matterType',
    'reason',
    'amountCents',
    'subject',
    'participants',
    'eventDate',
  ];
  const stage = stagesFor<Types>();
  const actions = [
    ...createOaApprovalOperations(d),
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    appointAction,
    reassignAction,
    ccAction,
    readAction,
  ];
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  async function validate(
    record: ExpensePlanRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'EXPENSE_PLAN_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !Number.isSafeInteger(record.amountCents) ||
      record.amountCents <= 0 ||
      !Number.isSafeInteger(record.participants) ||
      record.participants <= 0 ||
      record.participants > 100000 ||
      !record.reason.trim() ||
      record.reason.length > 10000
    )
      refuse(
        'EXPENSE_PLAN_INVALID_INPUT',
        'A positive integer amount, participants and reason are required.',
      );
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(record.eventDate) ||
      !Number.isFinite(Date.parse(`${record.eventDate}T12:00:00Z`)) ||
      new Date(`${record.eventDate}T12:00:00Z`).toISOString().slice(0, 10) !==
        record.eventDate
    )
      refuse('EXPENSE_PLAN_INVALID_DATE', 'Choose a valid calendar date.');
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'EXPENSE_PLAN_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    for (const [type, code] of [
      ['budgetSubject', record.subject],
      ['expensePlanType', record.matterType],
    ]) {
      const entry = await d.dictionaries.get(type, code, connection);
      if (!entry?.active)
        refuse(
          'EXPENSE_PLAN_INVALID_DICTIONARY',
          'Choose an active matter type and budget subject.',
        );
    }
    return department;
  }
  const budgetCommand = (
    record: ExpensePlanRecord,
    actorId: string,
    requestKey: string,
  ) => ({
    ...record.heldAccount!,
    actorId,
    reason: record.reason,
    reference: `${EXPENSE_PLAN_LIFECYCLE}:${record.id}`,
    requestKey,
  });
  const releaseReservation = async (
    record: ExpensePlanRecord,
    connection: DatabaseConnection,
    actorId: string,
    key: string,
  ) => {
    if (record.heldAccount && record.heldCents > 0)
      await d.budgets.release(budgetCommand(record, actorId, key), connection);
  };
  const needsExecutive = (record: ExpensePlanRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.vp'],
    );
  const needsGm = (record: ExpensePlanRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.gm'],
    );
  async function issueAuthorization(
    record: ExpensePlanRecord,
    actorId: string,
    connection: DatabaseConnection,
  ) {
    if (!record.authorizationId || !record.heldAccount)
      refuse(
        'EXPENSE_PLAN_INVALID_AUTHORIZATION',
        'The approved source must retain its budget account and authorization id.',
      );
    await d.authorizations.issue(
      {
        ...record.heldAccount,
        id: record.authorizationId,
        sourceKind: EXPENSE_PLAN_LIFECYCLE,
        sourceId: record.id,
        applicantId: record.applicantId,
        grantedCents: record.amountCents,
        actorId,
        reason: record.reason,
        requestKey: `expense-plan:${record.id}:authorization`,
      },
      connection,
    );
  }
  async function mergeEvidence(
    record: ExpensePlanRecord,
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
  const approval = defineApproval<Types>({
    name: EXPENSE_PLAN_LIFECYCLE,
    collection: 'expensePlans',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [...fields, 'departmentId', 'year'],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: () => [] },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<ExpensePlanRecord>('expensePlans')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: EXPENSE_PLAN_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    states: [
      'draft',
      'revision',
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
      ...(['approved', 'rejected', 'withdrawn', 'terminated'] as const).map(
        (name) => ({ name, final: true }),
      ),
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
        onTransition: async ({ record, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          await lockUserForAdministration(connection, record.applicantId);
        },
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'head',
        guard: owner,
        set: async ({ record, services, now }) => {
          const connection = services.connection!;
          await lockUserForAdministration(connection, record.applicantId);
          const department = await validate(record, connection);
          const snapshot =
            record.ruleSnapshot ??
            (await d.rules.snapshot(
              [
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
              'EXPENSE_PLAN_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          try {
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.vp']);
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.gm']);
          } catch {
            refuse(
              'EXPENSE_PLAN_INVALID_RULE',
              'Spending thresholds must be valid nonnegative amounts.',
            );
          }
          const nextAccount = {
            departmentId: department.id,
            year: Number(record.eventDate.slice(0, 4)),
            subject: record.subject,
          };
          return {
            departmentId: department.id,
            year: nextAccount.year,
            heldAccount: nextAccount,
            heldCents: record.amountCents,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('EXPENSE', connection, now)),
            headApproverId:
              (await d.org.headOf(department.id, connection)) ?? null,
            executiveApproverId:
              (await d.org.executiveOf(department.id, connection)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            gmMerged: null,
          };
        },
        onTransition: async ({ record, previous, actor, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          if (
            previous.heldAccount &&
            (previous.heldAccount.departmentId !==
              record.heldAccount?.departmentId ||
              previous.heldAccount.year !== record.heldAccount?.year ||
              previous.heldAccount.subject !== record.heldAccount?.subject)
          )
            await releaseReservation(
              previous,
              connection,
              actor.id,
              `expense-plan:${record.id}:${previous.lifecycleVersion}:release-old`,
            );
          if (record.heldAccount)
            await d.budgets.adjustHold(
              {
                ...budgetCommand(
                  record,
                  actor.id,
                  `expense-plan:${record.id}:${previous.lifecycleVersion}:hold`,
                ),
                cents: record.amountCents,
              },
              connection,
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
        to: ['executive', 'gm', 'approved'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          needsExecutive(record)
            ? 'executive'
            : needsGm(record)
              ? 'gm'
              : 'approved',
        set: ({ record }) =>
          needsExecutive(record) || needsGm(record)
            ? {}
            : { authorizationId: record.authorizationId ?? randomUUID() },
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved')
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
        },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'approved'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          const merged = await mergeEvidence(record, services, input);
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            merged,
          );
          return true;
        },
        route: ({ record, services, input }) =>
          needsGm(record) &&
          !services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'gm'
            : 'approved',
        set: ({ record, services, input, now }) => {
          const merged = services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          return needsGm(record) && !merged
            ? {}
            : {
                authorizationId: record.authorizationId ?? randomUUID(),
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
          if (to === 'approved') {
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
            if (record.gmMerged)
              await d.audit.record(
                {
                  actorId: actor.id,
                  action: 'expensePlan.samePersonMerged',
                  targetType: 'expensePlans',
                  targetId: record.id,
                  after: record.gmMerged,
                },
                tx.handle as DatabaseConnection,
              );
          }
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'approved',
        approvalOutcome: 'approved',
        set: ({ record }) => ({
          authorizationId: record.authorizationId ?? randomUUID(),
        }),
        onTransition: ({ record, actor, tx }) =>
          issueAuthorization(record, actor.id, tx.handle as DatabaseConnection),
      },
      rejected: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: ({ previous, actor, tx }) =>
          releaseReservation(
            previous,
            tx.handle as DatabaseConnection,
            actor.id,
            `expense-plan:${previous.id}:${previous.lifecycleVersion}:reject`,
          ),
      },
      returned: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'revision',
        approvalOutcome: 'returned',
      },
      withdraw: {
        from: ['draft', 'revision', 'head', 'finance', 'executive', 'gm'],
        to: 'withdrawn',
        guard: owner,
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: ({ previous, actor, tx }) =>
          releaseReservation(
            previous,
            tx.handle as DatabaseConnection,
            actor.id,
            `expense-plan:${previous.id}:${previous.lifecycleVersion}:withdraw`,
          ),
      },
      terminate: {
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: async ({ record, previous, actor, input, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          await releaseReservation(
            previous,
            connection,
            actor.id,
            `expense-plan:${previous.id}:${previous.lifecycleVersion}:terminate`,
          );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'expensePlan.terminate',
              targetType: 'expensePlans',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            connection,
          );
        },
        from: ['draft', 'revision', 'head', 'finance', 'executive', 'gm'],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          input.reason.trim().length > 0,
      },
    },
    onEnter: Object.fromEntries(
      ['approved', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `expensePlan.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: ExpensePlanRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: EXPENSE_PLAN_LIFECYCLE,
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
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(d.directory, 'oa.expensePlan'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<ExpensePlanRecord>('expensePlans')
      .findOne({ filter: { id } });
    if (!r)
      throw new ExpensePlanError(
        'EXPENSE_PLAN_NOT_FOUND',
        'ExpensePlan request not found.',
        'notFound',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(EXPENSE_PLAN_LIFECYCLE, id, actorId))
        .length ||
      Boolean(
        policy &&
        (await d.db
          .repository<ExpensePlanRecord>('expensePlans')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return normalizeExpenseRecord(r);
    throw new ExpensePlanError(
      'EXPENSE_PLAN_ACCESS_DENIED',
      'This expense plan is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<ExpensePlanRecord>[]): ExpensePlanRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'departmentId',
      'year',
      'subject',
      'matterType',
      'participants',
      'eventDate',
      'authorizationId',
      'executiveApproverId',
      'gmApproverId',
      'gmMerged',
      'amountCents',
      'reason',
      'heldAccount',
      'heldCents',
      'ruleSnapshot',
      'headApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new ExpensePlanError(
        'EXPENSE_PLAN_FIELDS_RESTRICTED',
        'This release requires all expense plan business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizeExpenseRecord(row as ExpensePlanRecord));
  }
  async function enrich(records: ExpensePlanRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
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
    const views = await approvals.runViewsFor(EXPENSE_PLAN_LIFECYCLE, id);
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
            kind: EXPENSE_PLAN_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: EXPENSE_PLAN_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async options(actorId: string) {
      const [matterTypes, subjects, department] = await Promise.all([
        d.dictionaries.list('expensePlanType', { includeInactive: true }),
        d.dictionaries.list('budgetSubject', { includeInactive: true }),
        d.org.primaryDepartmentOf(actorId),
      ]);
      return {
        timeZone: d.calendar.timeZone(),
        matterTypes,
        subjects,
        department: department
          ? { id: department.id, title: department.title }
          : null,
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<ExpensePlanRecord>('expensePlans')
          .findMany();
        const ids: string[] = [];
        for (const record of records) {
          if (
            record.applicantId === actorId ||
            record.createdById === actorId
          ) {
            ids.push(record.id);
            continue;
          }
          const involvement = await approvals.involvementOf(
            EXPENSE_PLAN_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            EXPENSE_PLAN_LIFECYCLE,
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
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    async create(
      input: ExpensePlanInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          EXPENSE_PLAN_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            heldAccount: null,
            heldCents: 0,
            ruleSnapshot: null,
            headApproverId: null,
            executiveApproverId: null,
            gmApproverId: null,
            gmMerged: null,
            authorizationId: null,
            departmentId: null,
            year: null,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: actorId } },
        );
      return policy ? writePolicy.run(policy, create) : create();
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
        runtime.fire(EXPENSE_PLAN_LIFECYCLE, id, transition, {
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
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(EXPENSE_PLAN_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new ExpensePlanError(
          'EXPENSE_PLAN_TARGET_MISMATCH',
          'The action target belongs to another request.',
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
    async candidates(
      id: string,
      taskId: string,
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(EXPENSE_PLAN_LIFECYCLE, id);
      if (!views.some((view) => view.tasks.some((task) => task.id === taskId)))
        throw new ExpensePlanError(
          'EXPENSE_PLAN_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target: { taskId },
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
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, policy);
      return readDirectory.run(outside.directory, async () => {
        const actor = { id: actorId };
        const runs = await approvals.runViewsFor(EXPENSE_PLAN_LIFECYCLE, id);
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.headApproverId,
              record.executiveApproverId,
              record.gmApproverId,

              ...runs.flatMap((v) =>
                v.tasks.flatMap((t) => [t.assigneeId, t.actorId]),
              ),
            ].filter((v): v is string => Boolean(v)),
          ),
        ];
        const users = (await Promise.all(userIds.map((id) => d.users.get(id))))
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
          authorization: record.authorizationId
            ? await d.authorizations.get(record.authorizationId)
            : null,
          record,
          users,
          view: await runtime.view(EXPENSE_PLAN_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(EXPENSE_PLAN_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(
            EXPENSE_PLAN_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            EXPENSE_PLAN_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            EXPENSE_PLAN_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(EXPENSE_PLAN_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<ExpensePlanRecord>('expensePlans');
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
        const selected: ExpensePlanRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              EXPENSE_PLAN_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(
                  approvals,
                  EXPENSE_PLAN_LIFECYCLE,
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
                      EXPENSE_PLAN_LIFECYCLE,
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
                        ['approve', 'reject', 'return'].includes(action.name),
                      ),
                  );
          if (match) selected.push(record);
        }
        return enrich(selected);
      });
    },
    async maintenance() {
      await refresh();
      const sweep = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const held = await d.db
        .repository<ExpensePlanRecord>('expensePlans')
        .findMany({
          filter: (f) =>
            f.or(
              ['head', 'finance', 'executive', 'gm'].map((s) =>
                f.string('status').eq(s),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type ExpensePlanService = ReturnType<typeof createExpensePlanService>;
export const expensePlanServiceToken = createServiceToken<ExpensePlanService>(
  'oa/expense-plan-service',
);
