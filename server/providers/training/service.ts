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
  defineApprovalAction,
  configureAction,
  allActivePeople,
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
import { TrainingError } from './errors.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import type { AttendanceService } from '../attendance/contract.js';
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
  TRAINING_LIFECYCLE,
  type TrainingRecord,
  type TrainingInput,
} from './contract.js';
export {
  TRAINING_LIFECYCLE,
  type TrainingRecord,
  type TrainingInput,
} from './contract.js';
import type { ExpenseAuthorizationService } from '../expense-authorizations/contract.js';
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: TrainingRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
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
export interface TrainingDependencies {
  db: DatabaseManager;
  attendance: AttendanceService;
  authorizations: ExpenseAuthorizationService;
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
  throw new TrainingError(reason, message);
}
function normalizeTrainingRecord(record: LifecycleRecord): TrainingRecord {
  const amountCents = Number(record.amountCents);
  if (!Number.isSafeInteger(amountCents) || amountCents < 0)
    refuse(
      'TRAINING_INVALID_AMOUNT',
      'Stored training amounts must be safe integer cents.',
    );
  return { ...record, amountCents } as TrainingRecord;
}
export function createTrainingService(d: TrainingDependencies) {
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
            return collection === 'trainingRequests' && record
              ? normalizeTrainingRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'trainingRequests'
              ? normalizeTrainingRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'trainingRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new TrainingError(
                'TRAINING_FIELDS_RESTRICTED',
                'The grant must expose the created training record.',
                'permission',
              );
            return normalizeTrainingRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'trainingRequests')
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
                    'oa.training',
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
                      action: `training.${change.action}`,
                      targetType: 'trainingRequests',
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
    record: TrainingRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = [
    'name',
    'institution',
    'startAt',
    'endAt',
    'amountCents',
    'usesWorkingTime',
    'reason',
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
    record: TrainingRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'TRAINING_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !Number.isSafeInteger(record.amountCents) ||
      record.amountCents < 0 ||
      !record.name.trim() ||
      record.name.length > 255 ||
      !record.institution.trim() ||
      record.institution.length > 255 ||
      !record.reason.trim() ||
      record.reason.length > 10000 ||
      typeof record.usesWorkingTime !== 'boolean'
    )
      refuse(
        'TRAINING_INVALID_INPUT',
        'Training name, institution, reason and nonnegative integer cents are required.',
      );
    if (
      !Number.isFinite(Date.parse(record.startAt)) ||
      !Number.isFinite(Date.parse(record.endAt)) ||
      Date.parse(record.startAt) >= Date.parse(record.endAt)
    )
      refuse('TRAINING_INVALID_DATE', 'Choose a valid training interval.');
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'TRAINING_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    return department;
  }
  const needsExecutive = (record: TrainingRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.vp'],
    );
  const needsGm = (record: TrainingRecord) =>
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.gm'],
    );
  async function issueAuthorization(
    record: TrainingRecord,
    actorId: string,
    connection: DatabaseConnection,
  ) {
    if (record.amountCents > 0) {
      if (!record.authorizationId)
        refuse(
          'TRAINING_INVALID_AUTHORIZATION',
          'Approved paid training requires an authorization id.',
        );
      await d.authorizations.issue(
        {
          budgetMode: 'none',
          id: record.authorizationId,
          sourceKind: TRAINING_LIFECYCLE,
          sourceId: record.id,
          applicantId: record.applicantId,
          grantedCents: record.amountCents,
          actorId,
          reason: record.reason,
          requestKey: `training:${record.id}:authorization`,
        },
        connection,
      );
    }
    if (record.usesWorkingTime)
      await d.attendance.recordActivity(
        {
          kind: TRAINING_LIFECYCLE,
          applicationId: record.id,
          userId: record.applicantId,
          startAt: record.startAt,
          endAt: record.endAt,
          actorId,
          now: new Date(),
        },
        connection,
      );
  }
  async function mergeEvidence(
    record: TrainingRecord,
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
    return samePersonEvidence(
      record,
      services,
      input,
      'executive',
      record.executiveApproverId,
    );
  }
  async function samePersonEvidence(
    record: TrainingRecord,
    services: Services,
    input: JsonObject,
    stageName: string,
    personId: string,
  ) {
    if (typeof input.runId !== 'string') return null;
    // Read-only adapter: the public service's runViewsFor opens independent transactions, so it cannot
    // observe this answer before commit. Read the plugin's public TaskRow/collection contract in the
    // caller transaction; only ApprovalService writes approval state.
    const tasks = await services
      .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
      .findMany({
        filter: {
          runId: input.runId,
          stage: stageName,
          enteredVersion: record.lifecycleVersion,
          status: 'completed',
          depth: 0,
          mode: null,
          answer: 'approve',
          role: 'member',
          assigneeId: personId,
          actorId: personId,
        },
      });
    const task = tasks.find((t) => t.kind === 'decide');
    return task
      ? {
          runId: input.runId,
          taskId: task.id,
          personId: personId,
        }
      : null;
  }
  const approval = defineApproval<Types>({
    name: TRAINING_LIFECYCLE,
    collection: 'trainingRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [...fields, 'departmentId'],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: {
      on: 'final',
      recipients: (record) =>
        record.status === 'approved' ? record.hrRecipients : [],
    },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<TrainingRecord>('trainingRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: TRAINING_LIFECYCLE,
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
      guard: ({ values, actor, services }) =>
        values.applicantId === actor.id ||
        services.directory.hasRole(actor.id, 'hr'),
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
        to: 'manager',
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
              'TRAINING_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          try {
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.vp']);
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.gm']);
          } catch {
            refuse(
              'TRAINING_INVALID_RULE',
              'Spending thresholds must be valid nonnegative amounts.',
            );
          }
          return {
            departmentId: department.id,
            hrRecipients: services.directory.roleMembers('hr'),
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
            headMerged: null,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('TRAINING', connection, now)),
            headApproverId:
              (await d.org.headOf(department.id, connection)) ?? null,
            executiveApproverId:
              (await d.org.executiveOf(department.id, connection)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            gmMerged: null,
          };
        },
      },
      managerApproved: {
        from: 'manager',
        to: ['head', 'finance', 'approved'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          const merged =
            record.amountCents > 0 &&
            record.managerApproverId &&
            record.managerApproverId === record.headApproverId
              ? await samePersonEvidence(
                  record,
                  services,
                  input,
                  'manager',
                  record.managerApproverId,
                )
              : null;
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            merged,
          );
          return true;
        },
        route: ({ record, services, input }) =>
          record.amountCents === 0
            ? 'approved'
            : services.merges?.get(
                  typeof input.runId === 'string' ? input.runId : '',
                )
              ? 'finance'
              : 'head',
        set: ({ record, services, input, now }) => ({
          authorizationId: null,
          attendanceRecorded:
            record.amountCents === 0 && record.usesWorkingTime,
          headMerged: services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? {
                ...services.merges?.get(
                  typeof input.runId === 'string' ? input.runId : '',
                ),
                at: now.toISOString(),
                stages: ['manager', 'head'],
              }
            : null,
        }),
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved')
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
          if (record.headMerged)
            await d.audit.record(
              {
                actorId: actor.id,
                action: 'training.samePersonMerged',
                targetType: 'trainingRequests',
                targetId: record.id,
                after: record.headMerged,
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
            : {
                authorizationId: record.authorizationId ?? randomUUID(),
                attendanceRecorded: record.usesWorkingTime,
              },
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
                attendanceRecorded: record.usesWorkingTime,
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
                  action: 'training.samePersonMerged',
                  targetType: 'trainingRequests',
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
          attendanceRecorded: record.usesWorkingTime,
        }),
        onTransition: ({ record, actor, tx }) =>
          issueAuthorization(record, actor.id, tx.handle as DatabaseConnection),
      },
      rejected: {
        from: ['manager', 'head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
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
      },
      terminate: {
        onTransition: async ({ record, actor, input, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'training.terminate',
              targetType: 'trainingRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            connection,
          );
        },
        from: [
          'draft',
          'revision',
          'manager',
          'head',
          'finance',
          'executive',
          'gm',
        ],
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
            name: `training.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: TrainingRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: TRAINING_LIFECYCLE,
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
      directory: await processDirectorySnapshot(d.directory, 'oa.training'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<TrainingRecord>('trainingRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new TrainingError(
        'TRAINING_NOT_FOUND',
        'Training request not found.',
        'notFound',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(TRAINING_LIFECYCLE, id, actorId)).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<TrainingRecord>('trainingRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return normalizeTrainingRecord(r);
    throw new TrainingError(
      'TRAINING_ACCESS_DENIED',
      'This training is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<TrainingRecord>[]): TrainingRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'departmentId',
      'authorizationId',
      'executiveApproverId',
      'gmApproverId',
      'gmMerged',
      'name',
      'institution',
      'startAt',
      'endAt',
      'usesWorkingTime',
      'attendanceRecorded',
      'managerApproverId',
      'headMerged',
      'hrRecipients',
      'amountCents',
      'reason',
      'ruleSnapshot',
      'headApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new TrainingError(
        'TRAINING_FIELDS_RESTRICTED',
        'This release requires all training business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizeTrainingRecord(row as TrainingRecord));
  }
  async function enrich(records: TrainingRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.headApproverId,
            r.executiveApproverId,
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
      executiveApprover: r.executiveApproverId
        ? (users.get(r.executiveApproverId) ?? null)
        : null,
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(TRAINING_LIFECYCLE, id);
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
            kind: TRAINING_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: TRAINING_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async options(actorId: string) {
      return { timeZone: d.calendar.timeZone(), actorId };
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<TrainingRecord>('trainingRequests')
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
            TRAINING_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            TRAINING_LIFECYCLE,
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
      input: TrainingInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          TRAINING_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            hrRecipients: [],
            attendanceRecorded: false,
            managerApproverId: null,
            headMerged: null,
            ruleSnapshot: null,
            headApproverId: null,
            executiveApproverId: null,
            gmApproverId: null,
            gmMerged: null,
            authorizationId: null,
            departmentId: null,
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
        runtime.fire(TRAINING_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(TRAINING_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new TrainingError(
          'TRAINING_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(TRAINING_LIFECYCLE, id);
      if (
        !views.some((view) =>
          action === 'cc'
            ? view.run.id === taskId
            : view.tasks.some((task) => task.id === taskId),
        )
      )
        throw new TrainingError(
          'TRAINING_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target: action === 'cc' ? { runId: taskId } : { taskId },
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
        const runs = await approvals.runViewsFor(TRAINING_LIFECYCLE, id);
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
          record,
          users,
          view: await runtime.view(TRAINING_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(TRAINING_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(
            TRAINING_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            TRAINING_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            TRAINING_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(TRAINING_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<TrainingRecord>('trainingRequests');
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
        const selected: TrainingRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              TRAINING_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, TRAINING_LIFECYCLE, record.id)
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
                    await approvals.actionsFor(TRAINING_LIFECYCLE, record.id, {
                      id: actorId,
                    })
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
        .repository<TrainingRecord>('trainingRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['manager', 'head', 'finance', 'executive', 'gm'].map((s) =>
                f.string('status').eq(s),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type TrainingService = ReturnType<typeof createTrainingService>;
export const trainingServiceToken = createServiceToken<TrainingService>(
  'oa/training-service',
);
