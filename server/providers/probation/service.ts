import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import {
  hasApprovalCandidate,
  createAppApprovalService,
} from '../approval-runtime/query-service.js';
import {
  appointAction,
  reassignAction,
} from '../process-management/actions.js';
import { processDirectorySnapshot } from '../process-management/context.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  APPROVAL_COLLECTIONS,
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  readAction,
  outputsOf,
  type TaskRow,
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
import { z } from 'zod';
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
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import {
  PROBATION_LIFECYCLE,
  type ProbationRecord,
  type ProbationDepartureAdapter,
  type ProbationCompensationInput,
} from './contract.js';
import {
  probationManagerOutputsSchema,
  probationCompensationInputSchema,
  validateProbationManagerOutputs,
  isProbationReminderDue,
} from './validation.js';
export { PROBATION_LIFECYCLE, type ProbationRecord } from './contract.js';
export class ProbationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly kind:
      'precondition' | 'permission' | 'notFound' = 'precondition',
  ) {
    super(message);
    this.name = 'ProbationError';
  }
}
export function refuse(reason: string, message: string): never {
  throw new ProbationError(reason, message);
}
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: ProbationRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'head'
    | 'hr'
    | 'gm'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface ProbationDependencies {
  db: DatabaseManager;
  org: OrgService;
  audit: AuditService;
  users: UserAdministrationService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  notifications: ApprovalNotificationService;
  departure: () => ProbationDepartureAdapter | undefined;
  dispatcher?: EffectDispatcher;
}
function textValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
}
const publicFields = [
  'id',
  'employeeId',
  'applicantId',
  'createdById',
  'number',
  'probationEndDate',
  'selfEvaluation',
  'evaluation',
  'conclusion',
  'deferredTo',
  'gradeId',
  'compensationProposalId',
  'hrActorId',
  'departmentId',
  'managerApproverId',
  'headApproverId',
  'headMerged',
  'gmApproverId',
  'ruleSnapshot',
  'status',
  'lifecycleVersion',
  'createdAt',
];
function fullRecord(row: Partial<ProbationRecord>): ProbationRecord {
  if (publicFields.some((field) => !(field in row)))
    throw new ProbationError(
      'PROBATION_FIELDS_RESTRICTED',
      'Complete public probation fields are required.',
      'permission',
    );
  return row as ProbationRecord;
}
function assertPublicInput(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertPublicInput(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/salary|compensationProposal/i.test(key))
      refuse(
        'PROBATION_PRIVATE_INPUT_REQUIRED',
        'Compensation must be supplied through the private HR adapter.',
      );
    assertPublicInput(item);
  }
}
function normalizeProbationRecord(record: LifecycleRecord): ProbationRecord {
  return record as ProbationRecord;
}
export function createProbationService(d: ProbationDependencies) {
  let outside: Services;
  const privateWrite = new AsyncLocalStorage<{
    id: string;
    recordId: string;
    gradeId: string;
    baseSalary: string;
    actorId: string;
    depth: number;
    policy?: RepositoryPolicy;
  }>();
  const scheduledCreate = new AsyncLocalStorage<boolean>();
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
            return collection === 'probationRequests' && record
              ? normalizeProbationRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'probationRequests'
              ? normalizeProbationRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'probationRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new ProbationError(
                'TRAINING_FIELDS_RESTRICTED',
                'The grant must expose the created probation record.',
                'permission',
              );
            return normalizeProbationRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'probationRequests')
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
                    'oa.probation',
                    connection,
                  )),
                connection,
                merges: new Map(),
              });
              const proposal = privateWrite.getStore();
              if (proposal) {
                proposal.depth++;
                if (proposal.depth === 1) {
                  const directory = snapshots.get(connection)!.directory;
                  if (!directory.hasRole(proposal.actorId, 'hr'))
                    refuse(
                      'PROBATION_HR_REQUIRED',
                      'An active HR member must supply compensation.',
                    );
                  const grade = (await d.org.listGrades(connection)).find(
                    (g) => g.id === proposal.gradeId && g.active,
                  );
                  if (!grade)
                    refuse(
                      'PROBATION_INVALID_GRADE',
                      'Choose an active grade.',
                    );
                  const privateRepo = connection.repository(
                    'probationCompensationProposals',
                  );
                  const existing = await privateRepo.findOne({
                    filter: { id: proposal.id },
                  });
                  if (
                    existing &&
                    (existing.recordId !== proposal.recordId ||
                      existing.gradeId !== proposal.gradeId ||
                      existing.baseSalary !== proposal.baseSalary ||
                      existing.createdById !== proposal.actorId)
                  )
                    refuse(
                      'PROBATION_REQUEST_REUSED',
                      'The private request key was reused.',
                    );
                  if (!existing) {
                    await (
                      proposal.policy
                        ? privateRepo.withPolicy(proposal.policy)
                        : privateRepo
                    ).createOne({
                      values: {
                        id: proposal.id,
                        recordId: proposal.recordId,
                        gradeId: proposal.gradeId,
                        baseSalary: proposal.baseSalary,
                        createdById: proposal.actorId,
                        createdAt: new Date(),
                      },
                    });
                    await d.audit.record(
                      {
                        actorId: proposal.actorId,
                        action: 'probation.compensationProposed',
                        targetType: 'probationRequests',
                        targetId: proposal.recordId,
                        after: {
                          proposalId: proposal.id,
                          gradeId: proposal.gradeId,
                        },
                      },
                      connection,
                    );
                  }
                }
              }
              const change = intervention.getStore();
              if (change) change.depth++;
              try {
                const result = await work(wrap(tx));
                if (change?.depth === 1)
                  await d.audit.record(
                    {
                      actorId: change.actorId,
                      action: `probation.${change.action}`,
                      targetType: 'probationRequests',
                      targetId: change.recordId,
                      reason: change.reason,
                    },
                    connection,
                  );
                return result;
              } finally {
                if (change) change.depth--;
                if (proposal) proposal.depth--;
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
    services,
  }: {
    record: ProbationRecord;
    actor: { id: string };
    services: Services;
  }) =>
    actor.id === record.applicantId ||
    (actor.id === record.createdById &&
      services.directory.hasRole(actor.id, 'hr'));
  const reviewStates = ['manager', 'head', 'hr', 'gm'] as const;
  const stage = stagesFor<Types>();
  const settings = {
    actions: [
      ...createOaApprovalOperations(d),
      approve(),
      reject({ reason: 'required' }),
      returnTo({ targets: ['revision'], reason: 'required' }),
      commentAction,
      readAction,
      appointAction,
      reassignAction,
    ],
    onEmpty: 'hold' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  async function validate(
    record: ProbationRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getById(record.employeeId, connection);
    if (
      !employee?.active ||
      employee.status !== 'probation' ||
      employee.userId !== record.applicantId ||
      employee.probationEndDate !== record.probationEndDate
    )
      refuse(
        'PROBATION_STALE_EMPLOYEE',
        'The active probation archive must match the submitted baseline.',
      );
    if (!record.selfEvaluation.trim())
      refuse(
        'PROBATION_SELF_EVALUATION_REQUIRED',
        'Self evaluation is required.',
      );
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'PROBATION_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    return department;
  }
  async function samePersonEvidence(
    record: ProbationRecord,
    services: Services,
    input: JsonObject,
  ) {
    if (
      !record.managerApproverId ||
      record.managerApproverId !== record.headApproverId ||
      typeof input.runId !== 'string'
    )
      return null;
    const tasks = await services
      .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
      .findMany({
        filter: {
          runId: input.runId,
          stage: 'manager',
          enteredVersion: record.lifecycleVersion,
          status: 'completed',
          depth: 0,
          mode: null,
          answer: 'approve',
          role: 'member',
          assigneeId: record.managerApproverId,
          actorId: record.managerApproverId,
        },
      });
    const task = tasks.find((t) => t.kind === 'decide');
    return task
      ? {
          runId: input.runId,
          taskId: task.id,
          personId: record.managerApproverId,
          stages: ['manager', 'head'],
        }
      : null;
  }
  async function proposalFor(
    record: ProbationRecord,
    connection: DatabaseConnection,
  ) {
    if (!record.compensationProposalId)
      refuse(
        'PROBATION_COMPENSATION_REQUIRED',
        'An HR compensation proposal is required.',
      );
    const proposal = await connection
      .repository('probationCompensationProposals')
      .findOne({
        filter: {
          id: record.compensationProposalId,
          recordId: record.id,
          gradeId: record.gradeId,
        },
      });
    if (!proposal)
      refuse(
        'PROBATION_COMPENSATION_REQUIRED',
        'An HR compensation proposal is required.',
      );
    return proposal;
  }
  async function apply(
    record: ProbationRecord,
    actorId: string,
    connection: DatabaseConnection,
    now: Date,
  ) {
    await lockUserForAdministration(connection, record.applicantId);
    await validate(record, connection);
    const effectiveAt = d.calendar.localDate(now);
    const origin = {
      actorId,
      sourceApplication: `${PROBATION_LIFECYCLE}:${record.id}`,
    };
    if (record.conclusion === 'declined') {
      const departure = d.departure();
      if (!departure)
        refuse(
          'PROBATION_DEPARTURE_UNAVAILABLE',
          'The departure workflow is required before declining probation can complete.',
        );
      if (
        !record.hrActorId ||
        !(
          await processDirectorySnapshot(
            d.directory,
            'oa.probation',
            connection,
          )
        ).hasRole(record.hrActorId, 'hr')
      )
        refuse(
          'PROBATION_HR_PROXY_UNAVAILABLE',
          'The HR decision maker must remain eligible to create the departure draft.',
        );
      const linked = await departure.createDeclinedProbationDraft(
        {
          employeeId: record.employeeId,
          applicantId: record.applicantId,
          delegatedById: record.hrActorId,
          sourceProbationId: record.id,
          requestKey: `probation:${record.id}:departure`,
        },
        connection,
      );
      await d.employees.appendHistory(
        {
          employeeId: record.employeeId,
          kind: 'regularization',
          before: { status: 'probation' },
          after: {
            probationConclusion: 'declined',
            departureDraftId: linked.id,
          },
          effectiveAt,
        },
        origin,
        connection,
      );
      return;
    }
    if (record.conclusion === 'deferred') {
      validateProbationManagerOutputs(
        {
          evaluation: record.evaluation,
          conclusion: record.conclusion,
          deferredTo: record.deferredTo,
        },
        record.probationEndDate,
      );
      // EmployeeService owns status and history; extending the date must use its public flow contract.
      await d.employees.applyStatusChange(
        {
          employeeId: record.employeeId,
          status: 'probation',
          kind: 'regularization',
          effectiveAt,
          probationEndDate: record.deferredTo!,
        },
        origin,
        connection,
      );
      return;
    }
    if (record.conclusion !== 'regular')
      refuse(
        'PROBATION_CONCLUSION_REQUIRED',
        'A manager conclusion is required.',
      );
    const proposal = await proposalFor(record, connection);
    await d.employees.applyStatusChange(
      {
        employeeId: record.employeeId,
        status: 'regular',
        kind: 'regularization',
        effectiveAt,
        gradeId: record.gradeId,
      },
      origin,
      connection,
    );
    await d.employees.appendCompensation(
      {
        employeeId: record.employeeId,
        gradeId: record.gradeId,
        baseSalary: textValue(proposal.baseSalary),
        effectiveFrom: effectiveAt,
      },
      origin,
      connection,
    );
  }
  const approval = defineApproval<Types>({
    name: PROBATION_LIFECYCLE,
    collection: 'probationRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [
      'selfEvaluation',
      'probationEndDate',
      'evaluation',
      'conclusion',
      'deferredTo',
      'gradeId',
      'compensationProposalId',
      'departmentId',
    ],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<ProbationRecord>('probationRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: PROBATION_LIFECYCLE,
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
          outputs: {
            fields: probationManagerOutputsSchema.shape,
            required: ['evaluation', 'conclusion'],
            writes: {
              evaluation: 'evaluation',
              conclusion: 'conclusion',
              deferredTo: 'deferredTo',
            },
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
        'hr',
        stage.any({
          ...settings,
          assignees: ({ services }) => services.directory.roleMembers('hr'),
          outputs: {
            fields: {
              gradeId: z.string().min(1),
              salaryProposalId: z.string().uuid(),
            },
            required: ['gradeId', 'salaryProposalId'],
            writes: {
              gradeId: 'gradeId',
              salaryProposalId: 'compensationProposalId',
            },
          },
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
          !scheduledCreate.getStore() &&
          !services.directory.hasRole(actor.id, 'hr')
        )
          return false;
        const connection = services.connection!;
        await lockUserForAdministration(connection, String(values.applicantId));
        const employee = await d.employees.getById(
          String(values.employeeId),
          connection,
        );
        if (
          !employee?.active ||
          employee.status !== 'probation' ||
          employee.probationEndDate !== values.probationEndDate ||
          employee.userId !== values.applicantId
        )
          refuse('PROBATION_STALE_EMPLOYEE', 'The probation baseline changed.');
        const existing = await connection
          .repository('probationRequests')
          .findMany({ filter: { employeeId: employee.id } });
        if (
          existing.some(
            (r) =>
              !['approved', 'rejected', 'withdrawn', 'terminated'].includes(
                textValue(r.status),
              ),
          )
        )
          refuse(
            'PROBATION_ALREADY_ACTIVE',
            'An active probation request already exists.',
          );
        return true;
      },
    },
    transitions: {
      edit: {
        from: ['draft', 'revision'],
        to: ['draft', 'revision'],
        route: ({ record }) => record.status as 'draft' | 'revision',
        guard: owner,
        accept: ['selfEvaluation'],
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'manager',
        guard: owner,
        set: async ({ record, services, now }) => {
          const connection = services.connection!;
          await lockUserForAdministration(connection, record.applicantId);
          const department = await validate(record, connection);
          const ruleSnapshot = await d.rules.snapshot(
            [
              'grade.managerRank',
              'sla.remindHours',
              'sla.escalateHours',
              'sla.urgeCooldownHours',
            ],
            now,
            connection,
          );
          if (
            ruleSnapshot['sla.remindHours'] !== 24 ||
            ruleSnapshot['sla.escalateHours'] !== 48
          )
            refuse(
              'PROBATION_SLA_UNSUPPORTED',
              'Only default approval clocks are supported.',
            );
          return {
            departmentId: department.id,
            ruleSnapshot,
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
            headApproverId:
              (await d.org.headOf(department.id, connection)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            number:
              record.number ??
              (await d.sequences.next('PROBATION', connection, now)),
            evaluation: null,
            conclusion: null,
            deferredTo: null,
            gradeId: null,
            compensationProposalId: null,
            hrActorId: null,
            headMerged: null,
          };
        },
      },
      managerApproved: {
        from: 'manager',
        to: ['head', 'hr'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          validateProbationManagerOutputs(
            outputsOf({ input }),
            record.probationEndDate,
          );
          services.merges!.set(
            textValue(input.runId),
            await samePersonEvidence(record, services, input),
          );
          return true;
        },
        route: ({ services, input }) =>
          services.merges?.get(textValue(input.runId)) ? 'hr' : 'head',
        set: ({ services, input }) => ({
          headMerged: services.merges?.get(textValue(input.runId)) ?? null,
        }),
      },
      headApproved: { from: 'head', to: 'hr', approvalOutcome: 'approved' },
      hrApproved: {
        from: 'hr',
        to: ['gm', 'approved'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          const output = outputsOf({ input });
          const grade = (await d.org.listGrades(services.connection)).find(
            (g) => g.id === output.gradeId && g.active,
          );
          if (!grade)
            refuse('PROBATION_INVALID_GRADE', 'Choose an active grade.');
          const proposal = await services
            .connection!.repository('probationCompensationProposals')
            .findOne({
              filter: {
                id: textValue(output.salaryProposalId),
                recordId: record.id,
                gradeId: textValue(output.gradeId),
              },
            });
          if (!proposal)
            refuse(
              'PROBATION_COMPENSATION_REQUIRED',
              'Only the private HR action can supply compensation.',
            );
          const rank = Number(record.ruleSnapshot?.['grade.managerRank']);
          if (!Number.isSafeInteger(rank) || rank < 0)
            refuse(
              'PROBATION_INVALID_RULE',
              'Manager rank must be a nonnegative integer.',
            );
          services.merges!.set(textValue(input.runId), {
            needsGm: record.conclusion === 'declined' || grade.rank >= rank,
          });
          return true;
        },
        route: ({ services, input }) =>
          services.merges?.get(textValue(input.runId))?.needsGm
            ? 'gm'
            : 'approved',
        set: ({ actor }) => ({ hrActorId: actor.id }),
        onTransition: async ({ record, actor, to, tx, now }) => {
          if (to === 'approved')
            await apply(record, actor.id, tx.handle as DatabaseConnection, now);
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'approved',
        approvalOutcome: 'approved',
        onTransition: ({ record, actor, tx, now }) =>
          apply(record, actor.id, tx.handle as DatabaseConnection, now),
      },
      rejected: {
        from: reviewStates,
        to: 'rejected',
        approvalOutcome: 'rejected',
      },
      returned: {
        from: reviewStates,
        to: 'revision',
        approvalOutcome: 'returned',
      },
      withdraw: {
        from: ['draft', 'revision', ...reviewStates],
        to: 'withdrawn',
        guard: owner,
      },
      terminate: {
        from: ['draft', 'revision', ...reviewStates],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          input.reason.trim().length > 0,
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'probation.terminate',
              targetType: 'probationRequests',
              targetId: record.id,
              reason: textValue(input.reason),
            },
            tx.handle as DatabaseConnection,
          ),
      },
    },
    onEnter: Object.fromEntries(
      ['draft', 'approved', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `probation.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: ProbationRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: PROBATION_LIFECYCLE,
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
      directory: await processDirectorySnapshot(d.directory, 'oa.probation'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const repo = d.db.repository<ProbationRecord>('probationRequests');
    const record = await repo.findOne({ filter: { id } });
    if (!record)
      throw new ProbationError(
        'PROBATION_NOT_FOUND',
        'Probation request not found.',
        'notFound',
      );
    if (policy && !(await repo.withPolicy(policy).findOne({ filter: { id } })))
      throw new ProbationError(
        'PROBATION_ACCESS_DENIED',
        'This probation request is not accessible.',
        'permission',
      );
    if (policy) {
      const scoped = await repo.withPolicy(policy).findOne({ filter: { id } });
      if (scoped) fullRecord(scoped);
    }
    if (
      record.applicantId === actorId ||
      record.createdById === actorId ||
      outside.directory.hasRole(actorId, 'hr') ||
      outside.directory.hasRole(actorId, 'gm') ||
      outside.directory.hasRole(actorId, 'cfo') ||
      (await d.employees.isAboveInReportingLine(actorId, record.applicantId)) ||
      Boolean(
        (record.departmentId
          ? await d.org.activeChain(record.departmentId)
          : undefined
        )?.some((department) => department.managerId === actorId),
      ) ||
      outside.directory.hasRole(actorId, 'approval.admin') ||
      (await approvals.involvementOf(PROBATION_LIFECYCLE, id, actorId))
        .length ||
      (policy && (await repo.withPolicy(policy).findOne({ filter: { id } })))
    )
      return record;
    throw new ProbationError(
      'PROBATION_ACCESS_DENIED',
      'This probation request is not accessible.',
      'permission',
    );
  }
  async function enrich(records: ProbationRecord[]) {
    const keys = [
      'applicantId',
      'createdById',
      'managerApproverId',
      'headApproverId',
      'gmApproverId',
      'hrActorId',
    ] as const;
    const ids = [
      ...new Set(
        records
          .flatMap((r) => keys.map((key) => r[key]))
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
      managerApprover: r.managerApproverId
        ? (users.get(r.managerApproverId) ?? null)
        : null,
      headApprover: r.headApproverId
        ? (users.get(r.headApproverId) ?? null)
        : null,
      gmApprover: r.gmApproverId ? (users.get(r.gmApproverId) ?? null) : null,
      hrActor: r.hrActorId ? (users.get(r.hrActorId) ?? null) : null,
    }));
  }
  const service = {
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    initialize: refresh,
    async options(actorId: string) {
      const directory = await d.directory.eligibility([actorId], ['hr']);
      const user = await d.users.get(actorId);
      return {
        timeZone: d.calendar.timeZone(),
        canCreateManualDraft: directory.hasRole(actorId, 'hr'),
        actorId,
        actor: user ? { id: user.id, name: user.name } : null,
      };
    },
    async create(
      input: { employeeId: string; selfEvaluation: string },
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const employee = await d.employees.getById(input.employeeId);
      if (
        !employee?.active ||
        employee.status !== 'probation' ||
        !employee.probationEndDate ||
        employee.userId !== applicantId
      )
        refuse(
          'PROBATION_EMPLOYEE_REQUIRED',
          'An active probation employee with an end date is required.',
        );
      const create = () =>
        runtime.create(
          PROBATION_LIFECYCLE,
          {
            id: randomUUID(),
            employeeId: employee.id,
            applicantId,
            createdById: actorId,
            selfEvaluation: input.selfEvaluation,
            probationEndDate: employee.probationEndDate,
            number: null,
            evaluation: null,
            conclusion: null,
            deferredTo: null,
            gradeId: null,
            compensationProposalId: null,
            hrActorId: null,
            departmentId: null,
            managerApproverId: null,
            headApproverId: null,
            gmApproverId: null,
            headMerged: null,
            ruleSnapshot: null,
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
      assertPublicInput(input);
      await canRead(id, actorId, policy);
      const fire = () =>
        runtime.fire(PROBATION_LIFECYCLE, id, transition, {
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
      compensation?: ProbationCompensationInput,
      privatePolicy?: { record: RepositoryPolicy; proposal: RepositoryPolicy },
    ) {
      assertPublicInput(input.input);
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(PROBATION_LIFECYCLE, id);
      const target = input.target;
      const view = views.find((v) =>
        'runId' in target
          ? v.run.id === target.runId
          : v.tasks.some((t) => t.id === target.taskId),
      );
      if (!view)
        throw new ProbationError(
          'PROBATION_TARGET_MISMATCH',
          'The action belongs to another request.',
          'permission',
        );
      if (compensation) {
        if (
          input.action !== 'approve' ||
          !view.tasks.some((t) => t.stage === 'hr')
        )
          refuse(
            'PROBATION_PRIVATE_INPUT_UNEXPECTED',
            'Compensation can only be supplied to HR approval.',
          );
        if (
          privatePolicy &&
          !(await d.db
            .repository('probationRequests')
            .withPolicy(privatePolicy.record)
            .findOne({ filter: { id } }))
        )
          throw new ProbationError(
            'PROBATION_COMPENSATION_DENIED',
            'Compensation access is restricted.',
            'permission',
          );
        const value = probationCompensationInputSchema.parse(compensation);
        if (!input.requestId)
          refuse(
            'PROBATION_REQUEST_KEY_REQUIRED',
            'A private action requires an idempotency key.',
          );
        const hash = createHash('sha256')
          .update(JSON.stringify([id, actorId, input.target, input.requestId]))
          .digest('hex')
          .slice(0, 32);
        const proposalId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
        const proposal = {
          id: proposalId,
          recordId: id,
          ...value,
          actorId,
          depth: 0,
          policy: privatePolicy?.proposal,
        };
        return privateWrite.run(proposal, () =>
          approvals.perform({
            ...input,
            input: {
              data: { gradeId: value.gradeId, salaryProposalId: proposal.id },
            },
            actor: { id: actorId },
          }),
        );
      }
      if (
        input.action === 'approve' &&
        view.tasks.some((t) => t.stage === 'hr')
      )
        refuse(
          'PROBATION_PRIVATE_INPUT_REQUIRED',
          'HR approval requires the private compensation input.',
        );
      if (
        input.input &&
        ('baseSalary' in input.input || 'salaryProposalId' in input.input)
      )
        refuse(
          'PROBATION_PRIVATE_INPUT_REQUIRED',
          'Compensation must be supplied through the private HR adapter.',
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
      target: { taskId: string } | { runId: string },
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(PROBATION_LIFECYCLE, id);
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        throw new ProbationError(
          'PROBATION_TARGET_MISMATCH',
          'The action belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
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
      const actor = { id: actorId };
      const runs = await approvals.runViewsFor(PROBATION_LIFECYCLE, id);
      const userIds = [
        ...new Set(
          [
            record.applicantId,
            record.createdById,
            record.managerApproverId,
            record.headApproverId,
            record.gmApproverId,
            record.hrActorId,
            ...runs.flatMap((v) =>
              v.tasks.flatMap((t) => [t.assigneeId, t.actorId]),
            ),
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      const users = (await Promise.all(userIds.map((id) => d.users.get(id))))
        .filter((u) => u !== undefined)
        .map((u) => ({ id: u.id, name: u.name }));
      return {
        record: (await enrich([record]))[0],
        users,
        timeZone: d.calendar.timeZone(),
        view: await runtime.view(PROBATION_LIFECYCLE, id, actor),
        runs: await approvals.runViewsFor(PROBATION_LIFECYCLE, id),
        taskActions: await approvals.actionsFor(PROBATION_LIFECYCLE, id, actor),
        runActions: await approvals.runActionsFor(
          PROBATION_LIFECYCLE,
          id,
          actor,
        ),
        upcoming: await approvals.upcomingStagesFor(
          PROBATION_LIFECYCLE,
          id,
          actor,
        ),
        timeline: await approvals.timelineFor(PROBATION_LIFECYCLE, id),
      };
    },
    async compensation(
      id: string,
      actorId: string,
      viewPolicy: RepositoryPolicy,
      privatePolicy: { record: RepositoryPolicy; proposal: RepositoryPolicy },
    ) {
      const record = await canRead(id, actorId, viewPolicy);
      if (
        !['hr', 'cfo', 'gm'].some((role) =>
          outside.directory.hasRole(actorId, role),
        )
      )
        throw new ProbationError(
          'PROBATION_COMPENSATION_DENIED',
          'Compensation access is restricted.',
          'permission',
        );
      if (
        !(await d.db
          .repository('probationRequests')
          .withPolicy(privatePolicy.record)
          .findOne({ filter: { id } }))
      )
        throw new ProbationError(
          'PROBATION_COMPENSATION_DENIED',
          'Compensation access is restricted.',
          'permission',
        );
      if (!record.compensationProposalId) return null;
      const proposal = await d.db
        .repository('probationCompensationProposals')
        .withPolicy(privatePolicy.proposal)
        .findOne({
          filter: { id: record.compensationProposalId, recordId: id },
        });
      if (!proposal || !('baseSalary' in proposal) || !('gradeId' in proposal))
        throw new ProbationError(
          'PROBATION_COMPENSATION_DENIED',
          'Compensation access is restricted.',
          'permission',
        );
      return {
        gradeId: proposal.gradeId,
        baseSalary: textValue(proposal.baseSalary),
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      const rows = await d.db
        .repository<ProbationRecord>('probationRequests')
        .findMany();
      const ids: string[] = [];
      for (const r of rows) {
        try {
          await canRead(r.id, actorId);
          ids.push(r.id);
        } catch (error) {
          if (!(error instanceof ProbationError) || error.kind !== 'permission')
            throw error;
        }
      }
      return ids;
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      const repo = d.db.repository<ProbationRecord>('probationRequests');
      const partialRows = await (
        policy ? repo.withPolicy(policy) : repo
      ).findMany({
        sort: (s) => [s.field('createdAt').desc()],
      });
      const rows = partialRows.map(fullRecord);
      const selected: ProbationRecord[] = [];
      for (const record of rows) {
        if (
          view === 'pending' &&
          rows.length > 10 &&
          !(await hasApprovalCandidate(
            approvals,
            PROBATION_LIFECYCLE,
            record.id,
            actorId,
          ))
        )
          continue;

        if (view === 'mine') {
          if (record.applicantId === actorId || record.createdById === actorId)
            selected.push(record);
          continue;
        }
        const runs =
          view === 'done' || view === 'copied'
            ? await runTaskViewsFor(approvals, PROBATION_LIFECYCLE, record.id)
            : [];
        const tasks = runs.flatMap((v) => v.tasks);
        const match =
          view === 'copied'
            ? tasks.some((t) => t.kind === 'copy' && t.assigneeId === actorId)
            : view === 'done'
              ? tasks.some(
                  (t) =>
                    t.actorId === actorId &&
                    ['completed', 'transferred'].includes(t.status),
                )
              : view === 'all'
                ? true
                : (
                    await approvals.actionsFor(PROBATION_LIFECYCLE, record.id, {
                      id: actorId,
                    })
                  ).some(
                    (v) =>
                      v.task.role !== 'info' &&
                      v.actions.some((a) =>
                        ['approve', 'reject', 'return'].includes(a.name),
                      ),
                  );
        if (match) selected.push(record);
      }
      return enrich(selected);
    },
    async maintenance() {
      await refresh();
      const report = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const rows = await d.db
        .repository<ProbationRecord>('probationRequests')
        .findMany();
      for (const record of rows.filter((r) =>
        reviewStates.includes(r.status as (typeof reviewStates)[number]),
      )) {
        const runs = await approvals.runViewsFor(
          PROBATION_LIFECYCLE,
          record.id,
        );
        for (const view of runs) {
          if (!['open', 'held'].includes(view.run.status)) continue;
          if (view.tasks.length === 0)
            await d.notifications.alarm({
              recordId: record.id,
              recipients: outside.directory.roleMembers('approval.admin'),
              eventId: `hold:${view.run.id}`,
              reason: 'unassigned',
              kind: PROBATION_LIFECYCLE,
            });
          for (const task of view.tasks) {
            if (
              task.status === 'pending' &&
              task.dueAt &&
              Date.parse(task.dueAt) <= Date.now() &&
              task.assigneeId &&
              !outside.directory.managerOf(task.assigneeId)
            )
              await d.notifications.alarm({
                recordId: record.id,
                recipients: outside.directory.roleMembers('approval.admin'),
                eventId: `chain-top:${task.id}:${task.dueAt}`,
                reason: 'chainTop',
                kind: PROBATION_LIFECYCLE,
              });
          }
        }
      }
      return report;
    },
    async reconcile(now = new Date()) {
      const today = d.calendar.localDate(now);
      const employees = await d.db
        .repository('employees')
        .findMany({ filter: { active: true, status: 'probation' } });
      let created = 0;
      for (const row of employees) {
        const endDate = textValue(row.probationEndDate ?? '');
        if (!endDate || !isProbationReminderDue(today, endDate)) continue;
        await runtime.transaction(async (tx) => {
          const connection = tx.handle as DatabaseConnection;
          await lockUserForAdministration(connection, textValue(row.userId));
          const employee = await d.employees.getById(
            textValue(row.id),
            connection,
          );
          if (
            !employee?.active ||
            employee.status !== 'probation' ||
            employee.probationEndDate !== endDate
          )
            return;
          const existing = await connection
            .repository('probationRequests')
            .findOne({
              filter: { employeeId: employee.id, probationEndDate: endDate },
            });
          if (existing) return;
          const draft = await scheduledCreate.run(true, () =>
            tx.create(
              PROBATION_LIFECYCLE,
              {
                id: randomUUID(),
                employeeId: employee.id,
                applicantId: employee.userId,
                createdById: employee.userId,
                selfEvaluation: '',
                probationEndDate: endDate,
                number: null,
                evaluation: null,
                conclusion: null,
                deferredTo: null,
                gradeId: null,
                compensationProposalId: null,
                hrActorId: null,
                departmentId: null,
                managerApproverId: null,
                headApproverId: null,
                gmApproverId: null,
                headMerged: null,
                ruleSnapshot: null,
                createdAt: now.toISOString(),
              },
              { actor: { id: employee.userId } },
            ),
          );
          await connection.repository('probationDraftCycles').createOne({
            values: {
              id: randomUUID(),
              employeeId: employee.id,
              probationEndDate: endDate,
              recordId: String(draft.record.id),
              createdAt: now,
            },
          });
          await d.audit.record(
            {
              actorId: null,
              action: 'probation.scheduledDraft',
              targetType: 'probationRequests',
              targetId: String(draft.record.id),
              after: { probationEndDate: endDate },
            },
            connection,
          );
          created++;
        });
      }
      return { created };
    },
  };
  return service;
}
export { probationServiceToken, type ProbationService } from './contract.js';
