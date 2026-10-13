import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  defineLifecycle,
  LifecycleRuntime,
  type LifecycleStore,
  type JsonObject,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import type { EmployeeService } from '../employees/contract.js';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { DictionaryService } from '../platform/dictionaries.js';
import type {
  ProbationDepartureAdapter,
  ProbationRecord,
} from '../probation/contract.js';
import {
  DEPARTURE_LIFECYCLE,
  type DepartureCreateInput,
  type DepartureRecord,
} from './contract.js';
import { departureCreateSchema, departureEditSchema } from './validation.js';

import {
  ApprovalService,
  type Approval,
  type PerformInput,
} from '@nocobase/app-plugin-approval/server';
import {
  departureApproval,
  type DepartureTypes,
  type DepartureServices,
} from './approval.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import { departureWorkLifecycle } from './work-items.js';
import {
  DEPARTURE_WORK_LIFECYCLE,
  DEPARTURE_WORK_KINDS,
  type DepartureWorkRecord,
  type DepartureAssetClearance,
  type DepartureFinancialClearance,
} from './contract.js';
import type { LoanLedgerService } from '../loan-ledger/contract.js';
import { departureExecution } from './execution.js';
import {
  DEPARTURE_EXECUTION_LIFECYCLE,
  type DepartureExecutionRecord,
  type DepartureApprovalReassignment,
} from './contract.js';
import type { HeadcountService } from '../headcounts/contract.js';
import type { DepartureCustodyClearance } from './contract.js';
import type { OrganizationService } from '../org/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { DepartureError } from './errors.js';
export { DepartureError } from './errors.js';
function fail(
  code: string,
  message: string,
  kind: 'permission' | 'precondition' | 'notFound' = 'precondition',
): never {
  throw new DepartureError(code, message, kind);
}
type Types = DepartureTypes;
export interface DepartureDependencies {
  db: DatabaseManager;
  headcounts?: HeadcountService;
  custody?: DepartureCustodyClearance;
  dispatcher?: import('@nocobase/lifecycle').EffectDispatcher;
  organization?: OrganizationService;
  reassignment?: () => DepartureApprovalReassignment | undefined;
  /** Called with the user's administration lock held, before disabling their account. */
  ordinaryWork?: {
    assertCleared(
      userId: string,
      connection: DatabaseConnection,
    ): Promise<void>;
  };
  notifications?: ApprovalNotificationService;
  administrators?: readonly string[];
  clock?: () => Date;
  loans?: LoanLedgerService;
  assets?: () => DepartureAssetClearance | undefined;
  finances?: () => DepartureFinancialClearance | undefined;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  employees: EmployeeService;
  org: OrgService;
  dictionaries: DictionaryService;
  audit: AuditService;
  users: UserAdministrationService;
}
export const departurePublicFields = [
  'id',
  'employeeId',
  'applicantId',
  'createdById',
  'departureType',
  'reason',
  'expectedLastWorkingDay',
  'handoverUserId',
  'sourceProbationId',
  'sourceKey',
  'status',
  'lifecycleVersion',
  'createdAt',
  'number',
  'lastWorkingDay',
  'settlementDate',
  'settlementNote',
  'departmentId',
  'managerApproverId',
  'headApproverId',
  'gmApproverId',
  'gradeRank',
  'ruleSnapshot',
  'headMerged',
  'hrInterviewCompleted',
  'originalEmployeeStatus',
  'cancellationRequestedById',
  'cancellationFromStatus',
  'cancellationReason',
] as const;
function assertSafeInput(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSafeInput);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (
      [
        'baseSalary',
        'salaryProposalId',
        'compensationProposalId',
        'sourceKey',
        'sourceProbationId',
        'hrInterviewCompleted',
        'originalEmployeeStatus',
        'cancellationRequestedById',
        'cancellationFromStatus',
        'cancellationReason',
        'gradeRank',
        'ruleSnapshot',
      ].includes(key)
    )
      fail(
        'DEPARTURE_PROTECTED_INPUT',
        'Protected business fields cannot be supplied in public input.',
      );
    assertSafeInput(item);
  }
}
export function createDepartureService(d: DepartureDependencies) {
  const linkedCreate = new AsyncLocalStorage<boolean>();
  const mutationPolicy = new AsyncLocalStorage<RepositoryPolicy>();
  const workMutationPolicy = new AsyncLocalStorage<RepositoryPolicy>();
  const snapshots = new WeakMap<object, DepartureServices>();
  let outside: DepartureServices;
  const readDirectory = new AsyncLocalStorage<DepartureServices['directory']>();
  const base = createAppLifecycleStore(d.db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  function wrap(store: LifecycleStore): LifecycleStore {
    return new Proxy(store, {
      get(target, key) {
        if (key === 'transaction')
          return async <R>(
            fn: (tx: LifecycleStore) => Promise<R>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) => {
            const join = (within?: unknown) =>
              target.transaction(
                async (child) => {
                  const connection =
                    child.transactionHandle as DatabaseConnection;
                  snapshots.set(connection, {
                    connection,
                    directory:
                      readDirectory.getStore() ??
                      (await d.directory.snapshot(connection)),
                    merge: new Map(),
                  });
                  return fn(wrap(child));
                },
                { ...options, ...(within ? { within } : {}) },
              );
            if (options?.within || !d.headcounts || readDirectory.getStore())
              return join(options?.within);
            return d.headcounts.within(d.db.connection(), (locked) =>
              join(locked),
            );
          };
        if (key === 'createRecord' && mutationPolicy.getStore())
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'departureRequests')
              return target.createRecord(collection, values);
            const row = await (target.transactionHandle as DatabaseConnection)
              .repository(collection)
              .withPolicy(mutationPolicy.getStore()!)
              .createOne({
                values: values as import('@nocobase/db').RepositoryRecord,
              });
            if (row.record.id === undefined)
              fail(
                'DEPARTURE_FIELDS_RESTRICTED',
                'The created departure record must be visible.',
                'permission',
              );
            return row.record as import('@nocobase/lifecycle').LifecycleRecord;
          };
        if (key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            const policy =
              collection === 'departureRequests'
                ? mutationPolicy.getStore()
                : collection === 'departureWorkItems'
                  ? workMutationPolicy.getStore()
                  : undefined;
            if (!policy)
              return target.updateRecordIf(collection, id, condition, values);
            const result = await (
              target.transactionHandle as DatabaseConnection
            )
              .repository(collection)
              .withPolicy(policy)
              .updateMany({
                filter: {
                  id,
                  [condition.stateField]: condition.state,
                  [condition.versionField]: condition.version,
                },
                values: values as import('@nocobase/db').RepositoryRecord,
              });
            return result.updatedCount > 0;
          };
        if (key === 'findRecord')
          return async (collection: string, id: string | number) => {
            const row = await target.findRecord(collection, id);
            if (row && collection === 'departureRequests')
              return {
                ...row,
                createdAt: new Date(String(row.createdAt)).toISOString(),
              };
            return row;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }
  const runtime = new LifecycleRuntime({
    store: wrap(base),
    clock: d.clock,
    dispatcher: d.dispatcher,
  });
  const definition = defineLifecycle<Types>({
    name: DEPARTURE_LIFECYCLE,
    collection: 'departureRequests',
    initial: 'draft',
    states: ['draft', { name: 'withdrawn', final: true }],
    create: {
      guard: async ({ values, actor, services }) => {
        const connection = services.connection;
        await lockUserForAdministration(connection, String(values.applicantId));
        const employee = await d.employees.getById(
          String(values.employeeId),
          connection,
        );
        if (
          !employee?.active ||
          !['probation', 'regular'].includes(employee.status) ||
          employee.userId !== values.applicantId
        )
          fail(
            'DEPARTURE_EMPLOYEE_INVALID',
            'An active employee and exact applicant are required.',
          );
        const hr = await d.org.hasDutyRole(actor.id, 'hr', connection);
        if (
          !linkedCreate.getStore() &&
          actor.id !== employee.userId &&
          !['dismissal', 'contractExpiry'].includes(
            String(values.departureType),
          )
        )
          fail(
            'DEPARTURE_DELEGATE_TYPE_FORBIDDEN',
            'HR may delegate only dismissal or contract expiry.',
            'permission',
          );
        if (actor.id !== employee.userId && !hr)
          fail(
            'DEPARTURE_HR_REQUIRED',
            'Only the employee or an active HR delegate may create this draft.',
            'permission',
          );
        if (!linkedCreate.getStore() && values.sourceProbationId)
          fail(
            'DEPARTURE_SOURCE_FORBIDDEN',
            'Only the probation adapter may attach a probation source.',
            'permission',
          );
        if (
          values.departureType === 'declinedProbation' &&
          !linkedCreate.getStore()
        )
          fail(
            'DEPARTURE_SOURCE_REQUIRED',
            'Declined probation must be linked through its public adapter.',
          );
        const type = await d.dictionaries.get(
          'departureType',
          String(values.departureType),
          connection,
        );
        if (!type?.active)
          fail('DEPARTURE_TYPE_INVALID', 'Choose an active departure type.');
        if (values.departureType !== 'resignation' && !hr)
          fail(
            'DEPARTURE_HR_REQUIRED',
            'Only HR may initiate dismissal or contract expiry.',
            'permission',
          );
        const existing = await connection
          .repository<DepartureRecord>('departureRequests')
          .findMany({ filter: { employeeId: employee.id } });
        if (
          existing.some(
            (row) =>
              !['withdrawn', 'rejected', 'terminated', 'cancelled'].includes(
                String(row.status),
              ),
          )
        )
          fail(
            'DEPARTURE_ALREADY_ACTIVE',
            'An active departure request already exists.',
          );
        if (typeof values.handoverUserId === 'string') {
          const recipient = await d.employees.getByUserId(
            values.handoverUserId,
            connection,
          );
          if (
            !recipient?.active ||
            !['probation', 'regular'].includes(recipient.status) ||
            recipient.userId === employee.userId
          )
            fail(
              'DEPARTURE_HANDOVER_INVALID',
              'Choose another active employee as recipient.',
            );
        }
        return true;
      },
    },
    onEnterState: {
      draft: async ({ record, actor, tx }) =>
        d.audit.record(
          {
            actorId: actor.id,
            action: 'departure.draft',
            targetType: 'departureRequests',
            targetId: record.id,
            after: {
              employeeId: record.employeeId,
              applicantId: record.applicantId,
              status: record.status,
            },
          },
          tx.handle as DatabaseConnection,
        ),
      withdrawn: async ({ record, actor, tx }) =>
        d.audit.record(
          {
            actorId: actor.id,
            action: 'departure.withdraw',
            targetType: 'departureRequests',
            targetId: record.id,
          },
          tx.handle as DatabaseConnection,
        ),
    },
    transitions: {
      edit: {
        from: 'draft',
        to: 'draft',
        accept: [
          'departureType',
          'reason',
          'expectedLastWorkingDay',
          'handoverUserId',
        ],
        guard: async ({ record, actor, services, input }) => {
          if (
            actor.id !== record.applicantId &&
            !(
              actor.id === record.createdById &&
              (await d.org.hasDutyRole(actor.id, 'hr', services.connection))
            )
          )
            return false;
          if (Object.keys(input).length === 0) return true;
          const edit = departureEditSchema.parse(input);
          if (
            record.sourceProbationId &&
            edit.departureType !== 'declinedProbation'
          )
            fail(
              'DEPARTURE_SOURCE_TYPE_FROZEN',
              'A linked probation draft must retain its departure type.',
            );
          if (
            edit.departureType === 'declinedProbation' &&
            !record.sourceProbationId
          )
            fail(
              'DEPARTURE_SOURCE_REQUIRED',
              'Declined probation must be linked through its public adapter.',
            );
          if (
            !record.sourceProbationId &&
            record.createdById !== record.applicantId &&
            !['dismissal', 'contractExpiry'].includes(edit.departureType)
          )
            fail(
              'DEPARTURE_DELEGATE_TYPE_FORBIDDEN',
              'Delegated departure must remain dismissal or contract expiry.',
              'permission',
            );
          const type = await d.dictionaries.get(
            'departureType',
            edit.departureType,
            services.connection,
          );
          if (!type?.active)
            fail('DEPARTURE_TYPE_INVALID', 'Choose an active departure type.');
          if (
            edit.departureType !== 'resignation' &&
            !record.sourceProbationId &&
            !(await d.org.hasDutyRole(actor.id, 'hr', services.connection))
          )
            fail(
              'DEPARTURE_HR_REQUIRED',
              'Only HR may initiate dismissal or contract expiry.',
              'permission',
            );
          if (edit.handoverUserId) {
            const recipient = await d.employees.getByUserId(
              edit.handoverUserId,
              services.connection,
            );
            if (
              !recipient?.active ||
              !['probation', 'regular'].includes(recipient.status) ||
              recipient.userId === record.applicantId
            )
              fail(
                'DEPARTURE_HANDOVER_INVALID',
                'Choose another active employee as recipient.',
              );
          }
          return true;
        },
      },
      withdraw: {
        from: 'draft',
        to: 'withdrawn',
        guard: async ({ record, actor, services }) =>
          actor.id === record.applicantId ||
          (actor.id === record.createdById &&
            (await d.org.hasDutyRole(actor.id, 'hr', services.connection))),
      },
    },
  });
  const approval = departureApproval(
    d,
    definition.create,
    {
      ...Object.fromEntries(definition.onEnterState),
      handover: async ({
        record,
        actor,
        tx,
        now,
      }: import('@nocobase/lifecycle').StateHookContext<DepartureTypes>) => {
        if (
          await (tx.handle as DatabaseConnection)
            .repository('departureExecutions')
            .exists({ filter: { departureId: record.id } })
        )
          return;
        await tx.create(
          DEPARTURE_EXECUTION_LIFECYCLE,
          {
            id: randomUUID(),
            departureId: record.id,
            employeeId: record.employeeId,
            applicantId: record.applicantId,
            managerId: record.managerApproverId,
            lastWorkingDay: record.lastWorkingDay,
            failureCode: null,
            createdAt: now.toISOString(),
          },
          { actor },
        );
        for (const kind of DEPARTURE_WORK_KINDS)
          await tx.create(
            DEPARTURE_WORK_LIFECYCLE,
            {
              id: randomUUID(),
              departureId: record.id,
              employeeId: record.employeeId,
              applicantId: record.applicantId,
              kind,
              managerId: record.managerApproverId,
              receiverId: record.handoverUserId,
              claimedById: null,
              checklistConfirmed: false,
              receiverAcknowledged: false,
              forcedById: null,
              forceReason: null,
              createdAt: now.toISOString(),
            },
            { actor },
          );
      },
    },
    definition.transitions.get('edit')!.definition,
  );
  const source = (handle: unknown): DepartureServices =>
    handle ? snapshots.get(handle)! : outside;
  runtime.register(approval, { services: source });
  runtime.register(departureWorkLifecycle(d), { services: source });
  const execution = departureExecution(d, runtime);
  runtime.register(execution.definition, { services: source });
  const approvals = new ApprovalService(
    runtime,
    [approval.approval as unknown as Approval<never>],
    source,
  );
  async function refresh() {
    outside = {
      connection: d.db.connection(),
      directory: await d.directory.snapshot(),
      merge: new Map(),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    const repo = d.db.repository<DepartureRecord>('departureRequests');
    const row = await (policy ? repo.withPolicy(policy) : repo).findOne({
      filter: { id },
    });
    if (!row)
      fail(
        'DEPARTURE_NOT_FOUND',
        'The departure request is unavailable.',
        policy ? 'permission' : 'notFound',
      );
    if (departurePublicFields.some((field) => !(field in row)))
      fail(
        'DEPARTURE_FIELDS_RESTRICTED',
        'Complete public departure fields are required.',
        'permission',
      );
    if (
      row.applicantId !== actorId &&
      row.createdById !== actorId &&
      row.handoverUserId !== actorId &&
      row.managerApproverId !== actorId &&
      row.headApproverId !== actorId &&
      row.gmApproverId !== actorId &&
      !(await d.db
        .repository<DepartureWorkRecord>('departureWorkItems')
        .exists({ filter: { departureId: id, claimedById: actorId } })) &&
      !(await d.db
        .repository<DepartureWorkRecord>('departureWorkItems')
        .exists({ filter: { departureId: id, forcedById: actorId } })) &&
      !(await d.org.hasDutyRole(actorId, 'hr')) &&
      !outside.directory.hasRole(actorId, 'approval.admin') &&
      !(await approvals.involvementOf(DEPARTURE_LIFECYCLE, id, actorId))
        .length &&
      !(
        row.status === 'handover' &&
        (
          await Promise.all(
            ['it', 'admin', 'finance'].map((role) =>
              d.org.hasDutyRole(actorId, role),
            ),
          )
        ).some(Boolean)
      )
    )
      fail(
        'DEPARTURE_READ_FORBIDDEN',
        'The departure request is unavailable.',
        'permission',
      );
    return row;
  }
  async function decorate(record: DepartureRecord) {
    const keys = [
      'applicantId',
      'createdById',
      'handoverUserId',
      'managerApproverId',
      'headApproverId',
      'gmApproverId',
    ] as const;
    const users = await Promise.all(
      keys.map((key) =>
        record[key] ? d.users.get(record[key]) : Promise.resolve(undefined),
      ),
    );
    const personAt = (index: number) => {
      const user = users[index];
      return user ? { id: user.id, name: user.name } : null;
    };
    return {
      ...record,
      applicant: personAt(0),
      createdBy: personAt(1),
      handoverUser: personAt(2),
      managerApprover: personAt(3),
      headApprover: personAt(4),
      gmApprover: personAt(5),
      departureTypeLabel:
        (await d.dictionaries.get('departureType', record.departureType))
          ?.label ?? null,
    };
  }
  async function resolveUsers(ids: readonly (string | null | undefined)[]) {
    return (
      await Promise.all(
        [...new Set(ids.filter((id): id is string => !!id))].map((id) =>
          d.users.get(id),
        ),
      )
    )
      .filter((user) => !!user)
      .map((user) => ({ id: user.id, name: user.name }));
  }
  async function create(
    input: DepartureCreateInput,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const parsed = departureCreateSchema.parse(input);
    if (parsed.employeeId && !(await d.org.hasDutyRole(actorId, 'hr')))
      fail(
        'DEPARTURE_DELEGATE_FORBIDDEN',
        'Only HR may select an employee.',
        'permission',
      );
    if (
      parsed.employeeId &&
      !['dismissal', 'contractExpiry'].includes(parsed.departureType)
    )
      fail(
        'DEPARTURE_DELEGATE_TYPE_FORBIDDEN',
        'HR may delegate only dismissal or contract expiry.',
        'permission',
      );
    if (!parsed.employeeId && parsed.departureType !== 'resignation')
      fail(
        'DEPARTURE_SELF_TYPE_FORBIDDEN',
        'Self applications are resignations.',
        'permission',
      );
    const employee = parsed.employeeId
      ? await d.employees.getById(parsed.employeeId)
      : await d.employees.getByUserId(actorId);
    if (!employee)
      fail('DEPARTURE_EMPLOYEE_INVALID', 'An employee is required.');
    const execute = () =>
      runtime.create(
        DEPARTURE_LIFECYCLE,
        {
          id: randomUUID(),
          employeeId: employee.id,
          applicantId: employee.userId,
          createdById: actorId,
          departureType: parsed.departureType,
          reason: parsed.reason,
          expectedLastWorkingDay: parsed.expectedLastWorkingDay ?? null,
          handoverUserId: parsed.handoverUserId ?? null,
          number: null,
          lastWorkingDay: null,
          settlementDate: null,
          settlementNote: null,
          departmentId: null,
          managerApproverId: null,
          headApproverId: null,
          gmApproverId: null,
          gradeRank: null,
          ruleSnapshot: null,
          headMerged: null,
          hrInterviewCompleted: false,
          sourceProbationId: null,
          sourceKey: null,
          createdAt: new Date().toISOString(),
        },
        { actor: { id: actorId } },
      );
    const result = await (policy
      ? mutationPolicy.run(policy, execute)
      : execute());
    return {
      ...result,
      record: await decorate(result.record as DepartureRecord),
    };
  }
  async function submissionBlockers(record: DepartureRecord) {
    const blockers: string[] = [];
    if (!['draft', 'revision'].includes(record.status))
      return ['DEPARTURE_NOT_EDITABLE'];
    const employee = await d.employees.getById(record.employeeId);
    if (
      !employee?.active ||
      employee.userId !== record.applicantId ||
      !['probation', 'regular'].includes(employee.status)
    )
      blockers.push('DEPARTURE_EMPLOYEE_BASELINE_CHANGED');
    if (!record.expectedLastWorkingDay || !record.handoverUserId)
      blockers.push('DEPARTURE_APPLICATION_INCOMPLETE');
    if (
      record.expectedLastWorkingDay &&
      record.expectedLastWorkingDay <
        d.calendar.localDate(d.clock?.() ?? new Date())
    )
      blockers.push('DEPARTURE_DATE_PAST');
    const recipient = record.handoverUserId
      ? await d.employees.getByUserId(record.handoverUserId)
      : undefined;
    if (
      !recipient?.active ||
      !['probation', 'regular'].includes(recipient.status) ||
      recipient.userId === record.applicantId
    )
      blockers.push('DEPARTURE_HANDOVER_INVALID');
    if (
      !(await d.dictionaries.get('departureType', record.departureType))?.active
    )
      blockers.push('DEPARTURE_TYPE_INVALID');
    const department = await d.org.primaryDepartmentOf(record.applicantId);
    if (!department || !(await d.org.activeChain(department.id)))
      blockers.push('DEPARTURE_DEPARTMENT_REQUIRED');
    if (
      !(await d.org.listGrades()).some(
        (g) => g.id === employee?.gradeId && g.active,
      )
    )
      blockers.push('DEPARTURE_GRADE_REQUIRED');
    const rules = await d.rules.snapshot(
      [
        'grade.managerRank',
        'sla.remindHours',
        'sla.escalateHours',
        'sla.urgeCooldownHours',
      ],
      d.clock?.() ?? new Date(),
    );
    if (rules['sla.remindHours'] !== 24 || rules['sla.escalateHours'] !== 48)
      blockers.push('DEPARTURE_SLA_UNSUPPORTED');
    if (
      !Number.isSafeInteger(rules['grade.managerRank']) ||
      Number(rules['grade.managerRank']) < 0
    )
      blockers.push('DEPARTURE_RANK_RULE_INVALID');
    return blockers;
  }
  async function workOffers(item: DepartureWorkRecord, actorId: string) {
    const inputs = {
      claim: {},
      confirmChecklist: { confirmed: true },
      acknowledgeReceipt: { received: true },
      complete: {},
      forceComplete: { reason: 'Eligibility preview' },
    };
    return Promise.all(
      Object.entries(inputs).map(async ([name, input]) => {
        try {
          const offer = await runtime.can(
            DEPARTURE_WORK_LIFECYCLE,
            item.id,
            name,
            { id: actorId },
            { input },
          );
          return { name, ...offer };
        } catch (error) {
          if (
            error instanceof DepartureError ||
            (error instanceof Error && 'code' in error)
          )
            return {
              name,
              allowed: false,
              blockers: [
                {
                  code: String((error as { code: unknown }).code),
                  message: error.message,
                },
              ],
            };
          throw error;
        }
      }),
    );
  }
  const adapter: ProbationDepartureAdapter = {
    async createDeclinedProbationDraft(input, connection) {
      const {
        employeeId,
        applicantId,
        delegatedById,
        sourceProbationId,
        requestKey,
      } = input;
      if (requestKey !== `probation:${sourceProbationId}:departure`)
        fail(
          'DEPARTURE_SOURCE_INVALID',
          'The stable source request key is required.',
        );
      await lockUserForAdministration(connection, applicantId);
      const source = await connection
        .repository<ProbationRecord>('probationRequests')
        .findOne({ filter: { id: sourceProbationId } });
      if (
        !source ||
        source.employeeId !== employeeId ||
        source.applicantId !== applicantId ||
        source.hrActorId !== delegatedById ||
        source.conclusion !== 'declined' ||
        !['gm', 'approved'].includes(source.status)
      )
        fail(
          'DEPARTURE_SOURCE_INVALID',
          'An exact declined probation source is required.',
          'permission',
        );
      if (!(await d.org.hasDutyRole(delegatedById, 'hr', connection)))
        fail(
          'DEPARTURE_HR_REQUIRED',
          'The source HR delegate must remain active.',
          'permission',
        );
      const prior = await connection
        .repository<DepartureRecord>('departureRequests')
        .findOne({ filter: { sourceKey: requestKey } });
      if (prior) {
        if (
          prior.sourceProbationId !== sourceProbationId ||
          prior.employeeId !== employeeId ||
          prior.applicantId !== applicantId ||
          prior.createdById !== delegatedById
        )
          fail(
            'DEPARTURE_SOURCE_CONFLICT',
            'The source key is already bound to another identity.',
          );
        return { id: prior.id };
      }
      const digest = createHash('sha256').update(requestKey).digest('hex');
      const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const result = await linkedCreate.run(true, () =>
        runtime.create(
          DEPARTURE_LIFECYCLE,
          {
            id,
            employeeId,
            applicantId,
            createdById: delegatedById,
            departureType: 'declinedProbation',
            reason:
              'Declined probation; HR must complete the departure application before submission.',
            expectedLastWorkingDay: null,
            handoverUserId: null,
            number: null,
            lastWorkingDay: null,
            settlementDate: null,
            settlementNote: null,
            departmentId: null,
            managerApproverId: null,
            headApproverId: null,
            gmApproverId: null,
            gradeRank: null,
            ruleSnapshot: null,
            headMerged: null,
            hrInterviewCompleted: false,
            sourceProbationId,
            sourceKey: requestKey,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: delegatedById }, transaction: connection },
        ),
      );
      await d.audit.record(
        {
          actorId: delegatedById,
          action: 'departure.createFromProbation',
          targetType: 'departureRequests',
          targetId: id,
          after: {
            employeeId,
            applicantId,
            number: null,
            lastWorkingDay: null,
            settlementDate: null,
            settlementNote: null,
            departmentId: null,
            managerApproverId: null,
            headApproverId: null,
            gmApproverId: null,
            gradeRank: null,
            ruleSnapshot: null,
            headMerged: null,
            hrInterviewCompleted: false,
            sourceProbationId,
            sourceKey: requestKey,
            status: 'draft',
          },
        },
        connection,
      );
      return { id: String(result.record.id) };
    },
  };
  return {
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    initialize: refresh,
    async maintenance() {
      await refresh();
      await approvals.sweep();
      await runtime.reclaim();
      await runtime.recover();
      await runtime.prune({
        olderThan: new Date(Date.now() - 30 * 24 * 60 * 60_000),
      });
    },
    async reconcile(now = new Date()) {
      await refresh();
      return execution.reconcile(now);
    },
    adapter,
    create,
    async options(
      actorId: string,
      grants: { self: boolean; manual: boolean } = { self: true, manual: true },
    ) {
      const employee = await d.employees.getByUserId(actorId);
      const actor = (await resolveUsers([actorId]))[0];
      const departureTypes = await d.dictionaries.list('departureType');
      return {
        timeZone: d.calendar.timeZone(),
        actor,
        canCreateSelfDraft:
          grants.self &&
          !!employee?.active &&
          ['probation', 'regular'].includes(employee.status),
        canCreateManualDraft:
          grants.manual && (await d.org.hasDutyRole(actorId, 'hr')),
        selfDepartureTypes: departureTypes
          .filter((type) => type.code === 'resignation')
          .map((type) => ({ code: type.code, label: type.label })),
        manualDepartureTypes: departureTypes
          .filter((type) => ['dismissal', 'contractExpiry'].includes(type.code))
          .map((type) => ({ code: type.code, label: type.label })),
        departureTypes: departureTypes.map((type) => ({
          code: type.code,
          label: type.label,
        })),
      };
    },
    async handoverCandidates(
      actorId: string,
      query: {
        employeeId?: string;
        search?: string;
        offset?: number;
        limit?: number;
      } = {},
    ) {
      await refresh();
      if (query.employeeId && !(await d.org.hasDutyRole(actorId, 'hr')))
        fail(
          'DEPARTURE_DELEGATE_FORBIDDEN',
          'Only HR may select an employee.',
          'permission',
        );
      const employee = query.employeeId
        ? await d.employees.getById(query.employeeId)
        : await d.employees.getByUserId(actorId);
      if (
        !employee?.active ||
        !['probation', 'regular'].includes(employee.status)
      )
        fail('DEPARTURE_EMPLOYEE_INVALID', 'An active employee is required.');
      const search = outside.directory.searchPeople?.bind(outside.directory);
      if (!search)
        fail(
          'DEPARTURE_DIRECTORY_UNAVAILABLE',
          'The employee directory is unavailable.',
        );
      const eligible: string[] = [];
      for (let offset = 0; ; offset += 100) {
        const ids = await search({ search: query.search, offset, limit: 100 });
        const employees = await d.employees.getByUserIds(ids);
        eligible.push(
          ...[...employees.values()]
            .filter(
              (e) =>
                e.active &&
                ['probation', 'regular'].includes(e.status) &&
                e.userId !== employee.userId &&
                outside.directory.isActive(e.userId),
            )
            .map((e) => e.userId),
        );
        if (ids.length < 100) break;
      }
      const offset = query.offset ?? 0;
      return {
        items: await resolveUsers(
          eligible.slice(offset, offset + (query.limit ?? 50)),
        ),
        total: eligible.length,
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const rows = await d.db
          .repository<DepartureRecord>('departureRequests')
          .findMany();
        const ids: string[] = [];
        for (const row of rows) {
          try {
            await canRead(row.id, actorId);
            ids.push(row.id);
          } catch (error) {
            if (
              !(error instanceof DepartureError) ||
              error.kind !== 'permission'
            )
              throw error;
          }
        }
        return ids;
      });
    },
    async list(actorId: string, policy?: RepositoryPolicy, view = 'all') {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repo = d.db.repository<DepartureRecord>('departureRequests');
        const rows = await (policy ? repo.withPolicy(policy) : repo).findMany({
          sort: (s) => s.field('createdAt').desc(),
        });
        const result = [];
        for (const row of rows) {
          if (departurePublicFields.some((field) => !(field in row)))
            fail(
              'DEPARTURE_FIELDS_RESTRICTED',
              'Complete public departure fields are required.',
              'permission',
            );
          try {
            await canRead(String(row.id), actorId, policy);
            const runs =
              view !== 'done' && view !== 'copied'
                ? []
                : await runTaskViewsFor(
                    approvals,
                    DEPARTURE_LIFECYCLE,
                    String(row.id),
                  );
            const tasks = runs.flatMap((run) => run.tasks);
            const items =
              view === 'pending' || view === 'done'
                ? await d.db
                    .repository<DepartureWorkRecord>('departureWorkItems')
                    .findMany({ filter: { departureId: row.id } })
                : [];
            const match =
              view === 'all' ||
              (view === 'mine' &&
                (row.applicantId === actorId || row.createdById === actorId)) ||
              (view === 'copied' &&
                tasks.some(
                  (task) => task.kind === 'copy' && task.assigneeId === actorId,
                )) ||
              (view === 'done' &&
                (tasks.some(
                  (task) =>
                    task.actorId === actorId &&
                    ['completed', 'transferred'].includes(task.status),
                ) ||
                  items.some(
                    (item) =>
                      item.status === 'completed' &&
                      (item.claimedById === actorId ||
                        item.forcedById === actorId),
                  ))) ||
              (view === 'pending' &&
                ((
                  await approvals.actionsFor(
                    DEPARTURE_LIFECYCLE,
                    String(row.id),
                    { id: actorId },
                  )
                ).some(
                  (task) =>
                    task.task.role !== 'info' &&
                    task.actions.some((action) =>
                      ['approve', 'reject', 'return'].includes(action.name),
                    ),
                ) ||
                  (
                    await Promise.all(
                      items.map((item) => workOffers(item, actorId)),
                    )
                  ).some((offers) => offers.some((offer) => offer.allowed))));
            if (match) result.push(await decorate(row as DepartureRecord));
          } catch (error) {
            if (
              !(error instanceof DepartureError) ||
              error.kind !== 'permission'
            )
              throw error;
          }
        }
        return result;
      });
    },
    async detail(
      id: string,
      actorId: string,
      policy?: RepositoryPolicy,
      itemPolicy?: RepositoryPolicy,
    ) {
      await refresh();
      const record = (await canRead(id, actorId, policy)) as DepartureRecord;
      const runs = await approvals.runViewsFor(DEPARTURE_LIFECYCLE, id);
      const lifecycleView = await runtime.view(DEPARTURE_LIFECYCLE, id, {
        id: actorId,
      });
      // Input-requiring business transitions need a valid preview input. This grants
      // no write: fire() still validates the actual date/note/reason in its transaction.
      const available = await Promise.all(
        lifecycleView.available.map(async (offer) => {
          if (
            !['settle', 'terminate', 'requestCancellation'].includes(offer.name)
          )
            return offer;
          try {
            const input: JsonObject =
              offer.name === 'settle'
                ? {
                    settlementDate: d.calendar.localDate(
                      d.clock?.() ?? new Date(),
                    ),
                    settlementNote: 'Eligibility preview',
                  }
                : { reason: 'Eligibility preview' };
            return {
              ...offer,
              ...(await runtime.can(
                DEPARTURE_LIFECYCLE,
                id,
                offer.name,
                { id: actorId },
                { input },
              )),
            };
          } catch (error) {
            if (error instanceof DepartureError)
              return {
                ...offer,
                allowed: false,
                blockers: [
                  {
                    code: error.code,
                    message: error.message,
                    source: 'guard' as const,
                    kind: 'precondition' as const,
                  },
                ],
              };
            throw error;
          }
        }),
      );
      const taskActions = await approvals.actionsFor(DEPARTURE_LIFECYCLE, id, {
        id: actorId,
      });
      const workRepo =
        d.db.repository<DepartureWorkRecord>('departureWorkItems');
      const workItems = await (
        itemPolicy ? workRepo.withPolicy(itemPolicy) : workRepo
      ).findMany({ filter: { departureId: id } });
      const total = await workRepo.count({ filter: { departureId: id } });
      if (
        itemPolicy &&
        (workItems.length !== total ||
          workItems.some((item) =>
            [
              'id',
              'departureId',
              'employeeId',
              'applicantId',
              'kind',
              'managerId',
              'receiverId',
              'claimedById',
              'checklistConfirmed',
              'receiverAcknowledged',
              'forcedById',
              'forceReason',
              'status',
              'lifecycleVersion',
              'createdAt',
            ].some((field) => !(field in item)),
          ))
      )
        fail(
          'DEPARTURE_WORK_FIELDS_RESTRICTED',
          'All work item fields and rows must be granted.',
          'permission',
        );
      const userIds = [
        ...new Set(
          [
            record.applicantId,
            record.createdById,
            record.handoverUserId,
            record.managerApproverId,
            record.headApproverId,
            record.gmApproverId,
            ...workItems.flatMap((item) => [item.claimedById, item.forcedById]),
            ...runs.flatMap((run) =>
              run.tasks.flatMap((task) => [task.assigneeId, task.actorId]),
            ),
          ].filter((id): id is string => typeof id === 'string' && !!id),
        ),
      ];
      const users = (await Promise.all(userIds.map((id) => d.users.get(id))))
        .filter((user) => !!user)
        .map((user) => ({ id: user.id, name: user.name }));
      const blockedBy = await submissionBlockers(record);
      const submitOffer = lifecycleView.available.find(
        (offer) => offer.name === 'submit',
      );
      if (
        ['draft', 'revision'].includes(record.status) &&
        !submitOffer?.allowed
      )
        blockedBy.push(
          ...(submitOffer?.blockers.map((blocker) => blocker.code) ?? [
            'DEPARTURE_SUBMIT_FORBIDDEN',
          ]),
        );
      const enrichedItems = await Promise.all(
        workItems.map(async (item) => ({
          ...item,
          offers: await workOffers(item as DepartureWorkRecord, actorId),
          manager: users.find((user) => user.id === item.managerId) ?? null,
          receiver: users.find((user) => user.id === item.receiverId) ?? null,
          claimedBy: users.find((user) => user.id === item.claimedById) ?? null,
          forcedBy: users.find((user) => user.id === item.forcedById) ?? null,
        })),
      );
      return {
        record: await decorate(record),
        runs,
        taskActions,
        runActions: await approvals.runActionsFor(DEPARTURE_LIFECYCLE, id, {
          id: actorId,
        }),
        upcoming: await approvals.upcomingStagesFor(DEPARTURE_LIFECYCLE, id, {
          id: actorId,
        }),
        timeline: await approvals.timelineFor(DEPARTURE_LIFECYCLE, id),
        view: { ...lifecycleView, available },
        readyForSubmission: blockedBy.length === 0,
        blockedBy,
        execution: await d.db
          .repository<DepartureExecutionRecord>('departureExecutions')
          .findOne({ filter: { departureId: id } }),
        workItems: enrichedItems,
        users,
        timeZone: d.calendar.timeZone(),
      };
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      policy?: RepositoryPolicy,
      writePolicy?: RepositoryPolicy,
    ) {
      assertSafeInput(input);
      await refresh();
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(DEPARTURE_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        fail(
          'DEPARTURE_TARGET_MISMATCH',
          'The approval target belongs to another request.',
          'permission',
        );
      const perform = () =>
        approvals.perform({ ...input, actor: { id: actorId } });
      const result = await (writePolicy
        ? mutationPolicy.run(writePolicy, perform)
        : perform());
      return {
        ...result,
        users: await resolveUsers([
          actorId,
          ...views.flatMap((view) =>
            view.tasks.flatMap((task) => [task.assigneeId, task.actorId]),
          ),
        ]),
      };
    },
    async candidates(
      id: string,
      target: { taskId: string } | { runId: string },
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(DEPARTURE_LIFECYCLE, id);
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        fail(
          'DEPARTURE_TARGET_MISMATCH',
          'The candidate target belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
        action,
        actor: { id: actorId },
        query,
      });
      return {
        people: await resolveUsers(page.people),
        nextOffset: page.nextOffset,
      };
    },
    async workAction(
      id: string,
      workId: string,
      action: string,
      actorId: string,
      version: number,
      requestId: string,
      input: JsonObject = {},
      policy?: RepositoryPolicy,
      itemPolicy?: RepositoryPolicy,
    ) {
      assertSafeInput(input);
      await refresh();
      await canRead(id, actorId, policy);
      const repo = d.db.repository('departureWorkItems');
      const item = await (
        itemPolicy ? repo.withPolicy(itemPolicy) : repo
      ).findOne({ filter: { id: workId, departureId: id } });
      if (!item)
        fail(
          'DEPARTURE_WORK_TARGET_MISMATCH',
          'The work item belongs to another request.',
          'permission',
        );
      if (
        ![
          'claim',
          'confirmChecklist',
          'acknowledgeReceipt',
          'complete',
          'forceComplete',
        ].includes(action)
      )
        fail(
          'DEPARTURE_WORK_ACTION_INVALID',
          'The work action is unavailable.',
        );
      const fire = () =>
        runtime.fire(DEPARTURE_WORK_LIFECYCLE, workId, action, {
          actor: { id: actorId },
          expect: { version },
          requestId,
          input,
        });
      const result = await (itemPolicy
        ? workMutationPolicy.run(itemPolicy, fire)
        : fire());
      const record = result.record;
      return {
        ...result,
        users: await resolveUsers([
          String(record.applicantId),
          typeof record.managerId === 'string' ? record.managerId : null,
          typeof record.receiverId === 'string' ? record.receiverId : null,
          typeof record.claimedById === 'string' ? record.claimedById : null,
          typeof record.forcedById === 'string' ? record.forcedById : null,
        ]),
      };
    },
    async transition(
      id: string,
      transition: string,
      actorId: string,
      version: number,
      requestId: string,
      input: JsonObject = {},
      policy?: RepositoryPolicy,
      writePolicy?: RepositoryPolicy,
    ) {
      await refresh();
      await canRead(id, actorId, policy);
      if (
        ![
          'edit',
          'withdraw',
          'submit',
          'terminate',
          'settle',
          'requestCancellation',
        ].includes(transition)
      )
        fail(
          'DEPARTURE_APPROVAL_NOT_IMPLEMENTED',
          'This departure transition is unavailable.',
        );
      assertSafeInput(input);
      const parsed =
        transition === 'edit' ? departureEditSchema.parse(input) : input;
      const fire = () =>
        runtime.fire(DEPARTURE_LIFECYCLE, id, transition, {
          actor: { id: actorId },
          expect: { version },
          requestId,
          input: parsed,
        });
      const result = await (writePolicy
        ? mutationPolicy.run(writePolicy, fire)
        : fire());
      return {
        ...result,
        record: await decorate(result.record as DepartureRecord),
      };
    },
  };
}
