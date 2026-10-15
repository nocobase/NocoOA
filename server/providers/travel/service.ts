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
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
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
  peopleWithRole,
  transferAction,
  claimAction,
  releaseAction,
  assignAction,
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
export { travelServiceToken } from './contract.js';
import { assertTravelAttachments } from './attachments.js';
import { bookingPolicy, bookingActions } from './handling.js';
import type { DictionaryService } from '../platform/dictionaries.js';
import type { LoanRequestService } from '../loan-requests/contract.js';
import { TravelError } from './errors.js';
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
  TRAVEL_LIFECYCLE,
  type TravelRecord,
  type TravelInput,
} from './contract.js';
export {
  TRAVEL_LIFECYCLE,
  type TravelRecord,
  type TravelInput,
} from './contract.js';
import type { ExpenseAuthorizationService } from '../expense-authorizations/contract.js';
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
}
interface Types {
  record: TravelRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'head'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'booking'
    | 'exception'
    | 'cancelled'
    | 'completed'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface TravelDependencies {
  db: DatabaseManager;
  attendance: AttendanceService;
  authorizations: ExpenseAuthorizationService;
  dictionaries: DictionaryService;
  loans: () => LoanRequestService;
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
  throw new TravelError(reason, message);
}
function normalizeTravelRecord(record: LifecycleRecord): TravelRecord {
  const cents = Object.fromEntries(
    ['transportCents', 'lodgingCents', 'allowanceCents', 'amountCents'].map(
      (k) => [k, Number(record[k])],
    ),
  );
  if (Object.values(cents).some((v) => !Number.isSafeInteger(v) || v < 0))
    refuse(
      'TRAVEL_INVALID_AMOUNT',
      'Stored amounts must be safe integer cents.',
    );
  return { ...record, ...cents } as TravelRecord;
}
export function createTravelService(d: TravelDependencies) {
  let outside: Services;
  const cancellationProof = new AsyncLocalStorage<boolean>();
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
            return collection === 'travelRequests' && record
              ? normalizeTravelRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'travelRequests'
              ? normalizeTravelRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'travelRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new TravelError(
                'TRAVEL_FIELDS_RESTRICTED',
                'The grant must expose the created travel record.',
                'permission',
              );
            return normalizeTravelRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'travelRequests')
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
                    'oa.travel',
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
                      action: `travel.${change.action}`,
                      targetType: 'travelRequests',
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
    record: TravelRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = [
    'destination',
    'international',
    'startAt',
    'endAt',
    'companionIds',
    'attachments',
    'transportCents',
    'lodgingCents',
    'allowanceCents',
    'needsLoan',
    'needsBooking',
    'reason',
  ];
  const total = (record: TravelInput) =>
    record.transportCents + record.lodgingCents + record.allowanceCents;
  const travellers = (record: TravelRecord) =>
    [...new Set([record.applicantId, ...record.companionIds])].sort();
  const activityId = (id: string, user: string, approvedAt: string | null) =>
    createHash('sha256')
      .update(JSON.stringify([id, user, approvedAt]))
      .digest('hex');
  async function lockTravellers(
    record: TravelRecord,
    connection: DatabaseConnection,
  ) {
    for (const user of travellers(record))
      await lockUserForAdministration(connection, user);
  }
  async function checkOverlap(
    record: TravelRecord,
    connection: DatabaseConnection,
  ) {
    const repo = connection.repository<TravelRecord>('travelRequests');
    const records = (
      await Promise.all(
        ['booking', 'exception', 'completed'].map((status) =>
          repo.findMany({ filter: { status } }),
        ),
      )
    ).flat();
    for (const r of records)
      if (
        r.id !== record.id &&
        !r.cancelledAt &&
        r.approvalGrantedAt &&
        travellers(r).some((v) => travellers(record).includes(v)) &&
        Date.parse(r.startAt) < Date.parse(record.endAt) &&
        Date.parse(r.endAt) > Date.parse(record.startAt)
      )
        refuse('TRAVEL_OVERLAP', 'An approved trip overlaps this interval.');
  }
  async function standardFor(
    applicantId: string,
    connection?: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(applicantId, connection);
    const grade = (await d.org.listGrades(connection)).find(
      (g) => g.id === employee?.gradeId && g.active,
    );
    if (!grade) return null;
    const entries = (
      await d.dictionaries.list(
        'travelStandard',
        { includeInactive: false },
        connection,
      )
    )
      .filter(
        (e) =>
          typeof e.extra?.minRank === 'number' && e.extra.minRank <= grade.rank,
      )
      .sort((a, b) => Number(b.extra?.minRank) - Number(a.extra?.minRank));
    const chosen = entries[0];
    if (!chosen || entries[1]?.extra?.minRank === chosen.extra?.minRank)
      return null;
    return {
      code: chosen.code,
      gradeRank: grade.rank,
      lodgingPerNight: chosen.extra?.lodgingPerNight ?? null,
      allowancePerDay: chosen.extra?.allowancePerDay ?? null,
    };
  }
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
    record: TravelRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'TRAVEL_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !Number.isSafeInteger(total(record)) ||
      total(record) < 0 ||
      [record.transportCents, record.lodgingCents, record.allowanceCents].some(
        (v) => !Number.isSafeInteger(v) || v < 0,
      ) ||
      !record.destination.trim() ||
      !record.reason.trim()
    )
      refuse(
        'TRAVEL_INVALID_INPUT',
        'Destination, reason and nonnegative safe cents are required.',
      );
    if (
      !Number.isFinite(Date.parse(record.startAt)) ||
      !Number.isFinite(Date.parse(record.endAt)) ||
      Date.parse(record.startAt) >= Date.parse(record.endAt)
    )
      refuse('TRAVEL_INVALID_DATE', 'Choose a valid trip interval.');
    if (record.international && !record.attachments.length)
      refuse(
        'TRAVEL_ITINERARY_REQUIRED',
        'International travel requires an itinerary.',
      );
    if (
      new Set(record.companionIds).size !== record.companionIds.length ||
      record.companionIds.includes(record.applicantId)
    )
      refuse(
        'TRAVEL_COMPANIONS_INVALID',
        'Companions must be distinct employees other than the applicant.',
      );
    await assertTravelAttachments(connection, record.id, record.attachments);
    for (const user of travellers(record)) {
      const e = await d.employees.getByUserId(user, connection);
      if (!e?.active || e.status === 'left')
        refuse(
          'TRAVEL_COMPANION_INACTIVE',
          'Every traveller must be an active employee.',
        );
    }
    await lockTravellers(record, connection);
    await checkOverlap(record, connection);
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'TRAVEL_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    return department;
  }
  const needsExecutive = (record: TravelRecord) =>
    record.international ||
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.vp'],
    );
  const needsGm = (record: TravelRecord) =>
    record.international ||
    exceedsMoneyThreshold(
      record.amountCents,
      record.ruleSnapshot?.['spend.gm'],
    );
  const approvedFacts = (record: TravelRecord) => ({
    approvalGeneration: record.approvalGeneration + 1,
    authorizationSourceId:
      record.amountCents > 0
        ? record.approvalGeneration === 0
          ? record.id
          : `${record.id}:revision:${record.lifecycleVersion}`
        : null,
  });
  async function issueAuthorization(
    record: TravelRecord,
    actorId: string,
    connection: DatabaseConnection,
  ) {
    if (record.amountCents > 0) {
      if (!record.authorizationId)
        refuse(
          'TRAVEL_INVALID_AUTHORIZATION',
          'Approved paid travel requires an authorization id.',
        );
      await d.authorizations.issue(
        {
          budgetMode: 'none',
          id: record.authorizationId,
          sourceKind: TRAVEL_LIFECYCLE,
          sourceId: record.authorizationSourceId ?? record.id,
          applicantId: record.applicantId,
          grantedCents: record.amountCents,
          actorId,
          reason: record.reason,
          requestKey: `travel:${record.id}:authorization:${record.approvalGeneration}`,
        },
        connection,
      );
    }
    await d.audit.record(
      {
        actorId,
        action: 'travel.authorizationGranted',
        targetType: 'travelRequests',
        targetId: record.id,
        after: {
          businessId: record.id,
          generation: record.approvalGeneration,
          authorizationId: record.authorizationId,
          authorizationSourceId: record.authorizationSourceId,
          approvalGrantedAt: record.approvalGrantedAt,
        },
      },
      connection,
    );
    await lockTravellers(record, connection);
    await checkOverlap(record, connection);
    for (const userId of travellers(record))
      await d.attendance.recordActivity(
        {
          kind: TRAVEL_LIFECYCLE,
          applicationId: activityId(
            record.id,
            userId,
            record.approvalGrantedAt,
          ),
          userId,
          startAt: record.startAt,
          endAt: record.endAt,
          actorId,
          now: new Date(),
        },
        connection,
      );
  }
  async function endApprovedResources(
    record: TravelRecord,
    actorId: string,
    reason: string,
    key: string,
    now: Date,
    connection: DatabaseConnection,
    status: 'withdrawn' | 'terminated' = 'withdrawn',
  ) {
    if (!record.approvalGrantedAt) return;
    await lockTravellers(record, connection);
    if (record.authorizationId)
      await d.authorizations.close(
        {
          authorizationId: record.authorizationId,
          actorId,
          reason,
          requestKey: key,
          now,
        },
        connection,
      );
    for (const userId of travellers(record))
      await d.attendance.endActivity(
        {
          kind: TRAVEL_LIFECYCLE,
          applicationId: activityId(
            record.id,
            userId,
            record.approvalGrantedAt,
          ),
          userId,
          actorId,
          now,
          status,
        },
        connection,
      );
  }
  async function mergeEvidence(
    record: TravelRecord,
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
    record: TravelRecord,
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
    name: TRAVEL_LIFECYCLE,
    collection: 'travelRequests',
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
        .repository<TravelRecord>('travelRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: TRAVEL_LIFECYCLE,
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
          covers: [
            'transportCents',
            'lodgingCents',
            'allowanceCents',
            'startAt',
            'endAt',
            'destination',
            'international',
          ],
        }),
      ),
      approvalState(
        'gm',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.gmApproverId ?? undefined,
          covers: [
            'transportCents',
            'lodgingCents',
            'allowanceCents',
            'startAt',
            'endAt',
            'destination',
            'international',
          ],
        }),
      ),
      'exception',
      approvalState(
        'booking',
        stage.custom(
          bookingPolicy,
          {},
          {
            onEmpty: 'hold',
            qualification: 'admin',
            pools: [
              {
                key: 'administration',
                candidates: ({ services }) =>
                  services.directory.roleMembers('admin'),
                claimable: true,
              },
            ],
            outputs: {
              fields: {
                bookingInformation: z.string().trim().min(1).max(10000),
              },
              required: ['bookingInformation'],
              merge: 'last',
              writes: { bookingInformation: 'bookingInformation' },
            },
            actions: [
              claimAction,
              releaseAction,
              assignAction,
              commentAction,
              appointAction,
              reassignAction,
              bookingActions.complete,
              bookingActions.unable,
              bookingActions.forceComplete,
              configureAction(transferAction, {
                recipients: peopleWithRole(allActivePeople(), 'admin'),
                reason: true,
              }),
              createOaApprovalOperations(d)[2],
            ],
          },
        ),
      ),
      ...(['cancelled', 'rejected', 'withdrawn', 'terminated'] as const).map(
        (name) => ({ name, final: true }),
      ),
      // A completed trip remains cancellable through the separate approved
      // cancellation document; only cancellation closes this lifecycle.
      { name: 'completed' },
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
          await assertTravelAttachments(
            connection,
            record.id,
            record.attachments,
          );
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
              'TRAVEL_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          try {
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.vp']);
            exceedsMoneyThreshold(record.amountCents, snapshot['spend.gm']);
          } catch {
            refuse(
              'TRAVEL_INVALID_RULE',
              'Spending thresholds must be valid nonnegative amounts.',
            );
          }
          return {
            departmentId: department.id,
            amountCents: total(record),
            standardSnapshot:
              record.standardSnapshot ??
              (await standardFor(record.applicantId, connection)),
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
            headMerged: null,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('TRAVEL', connection, now)),
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
        to: ['head', 'finance'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          const merged =
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
        route: ({ services, input }) =>
          services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'finance'
            : 'head',
        set: ({ services, input, now }) => ({
          authorizationId: null,
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
          if (to === 'completed' || to === 'booking')
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
          if (record.headMerged)
            await d.audit.record(
              {
                actorId: actor.id,
                action: 'travel.samePersonMerged',
                targetType: 'travelRequests',
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
        to: ['executive', 'gm', 'booking', 'completed'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          needsExecutive(record)
            ? 'executive'
            : needsGm(record)
              ? 'gm'
              : record.needsBooking
                ? 'booking'
                : 'completed',
        set: ({ record }) =>
          needsExecutive(record) || needsGm(record)
            ? {}
            : {
                authorizationId:
                  record.amountCents > 0
                    ? (record.authorizationId ?? randomUUID())
                    : null,
                approvalGrantedAt: new Date().toISOString(),
                ...approvedFacts(record),
                originalHeadApproverId: record.headApproverId,
              },
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'completed' || to === 'booking')
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
        },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'booking', 'completed'],
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
            : record.needsBooking
              ? 'booking'
              : 'completed',
        set: ({ record, services, input, now }) => {
          const merged = services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          return needsGm(record) && !merged
            ? {}
            : {
                authorizationId:
                  record.amountCents > 0
                    ? (record.authorizationId ?? randomUUID())
                    : null,
                approvalGrantedAt: new Date().toISOString(),
                ...approvedFacts(record),
                originalHeadApproverId: record.headApproverId,
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
          if (to === 'completed' || to === 'booking') {
            await issueAuthorization(
              record,
              actor.id,
              tx.handle as DatabaseConnection,
            );
            if (record.gmMerged)
              await d.audit.record(
                {
                  actorId: actor.id,
                  action: 'travel.samePersonMerged',
                  targetType: 'travelRequests',
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
        to: ['booking', 'completed'],
        route: ({ record }) => (record.needsBooking ? 'booking' : 'completed'),
        approvalOutcome: 'approved',
        set: ({ record }) => ({
          authorizationId:
            record.amountCents > 0
              ? (record.authorizationId ?? randomUUID())
              : null,
          approvalGrantedAt: new Date().toISOString(),
          ...approvedFacts(record),
          originalHeadApproverId: record.headApproverId,
        }),
        onTransition: ({ record, actor, tx }) =>
          issueAuthorization(record, actor.id, tx.handle as DatabaseConnection),
      },
      booked: { from: 'booking', to: 'completed', approvalOutcome: 'booked' },
      bookingFailed: {
        from: 'booking',
        to: 'exception',
        approvalOutcome: 'unavailable',
        set: ({ input }) => ({
          exceptionReason:
            input.result &&
            typeof input.result === 'object' &&
            !Array.isArray(input.result) &&
            typeof input.result.reason === 'string'
              ? input.result.reason
              : 'Unable to book',
        }),
      },
      bookingForced: {
        from: 'booking',
        to: 'completed',
        approvalOutcome: 'forcedClosed',
        onTransition: async ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'travel.forceComplete',
              targetType: 'travelRequests',
              targetId: record.id,
              reason:
                typeof input.reason === 'string'
                  ? input.reason
                  : 'Administrative intervention',
            },
            tx.handle as DatabaseConnection,
          ),
      },
      retryBooking: { from: 'exception', to: 'booking', guard: owner },
      reviseTrip: {
        from: 'exception',
        to: 'revision',
        guard: owner,
        set: () => ({
          approvalGrantedAt: null,
          authorizationId: null,
          authorizationSourceId: null,
          originalHeadApproverId: null,
          bookingInformation: null,
        }),
        onTransition: async ({ previous, actor, tx, now }) =>
          endApprovedResources(
            previous,
            actor.id,
            'Trip revision',
            `travel:${previous.id}:revise:${previous.lifecycleVersion}`,
            now,
            tx.handle as DatabaseConnection,
          ),
      },
      cancelApproved: {
        from: ['booking', 'exception', 'completed'],
        to: 'cancelled',
        guard: () => cancellationProof.getStore() === true,
        accept: ['cancellationId'],
        set: ({ now }) => ({ cancelledAt: now.toISOString() }),
        onTransition: async ({ record, actor, tx, now, input }) => {
          const connection = tx.handle as DatabaseConnection;
          await lockTravellers(record, connection);
          if (record.authorizationId)
            await d.authorizations.close(
              {
                authorizationId: record.authorizationId,
                actorId: actor.id,
                reason:
                  typeof input.reason === 'string'
                    ? input.reason
                    : 'Trip cancellation',
                requestKey: `travel:${record.id}:cancel-quota`,
                now,
              },
              connection,
            );
          for (const userId of travellers(record))
            await d.attendance.endActivity(
              {
                kind: TRAVEL_LIFECYCLE,
                applicationId: activityId(
                  record.id,
                  userId,
                  record.approvalGrantedAt,
                ),
                userId,
                actorId: actor.id,
                now,
                status: 'withdrawn',
              },
              connection,
            );
          await d.loans().markReturnDue(
            {
              travelId: record.id,
              actorId: actor.id,
              reason:
                typeof input.reason === 'string'
                  ? input.reason
                  : 'Trip cancellation',
              requestKey: `travel:${record.id}:cancel-loans`,
              now,
            },
            connection,
          );
        },
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
        onTransition: async ({ record, previous, actor, input, tx, now }) => {
          const connection = tx.handle as DatabaseConnection;
          await endApprovedResources(
            previous,
            actor.id,
            typeof input.reason === 'string'
              ? input.reason
              : 'Administrative termination',
            `travel:${record.id}:terminate:${previous.lifecycleVersion}`,
            now,
            connection,
            'terminated',
          );
          if (previous.approvalGrantedAt)
            await d.loans().markReturnDue(
              {
                travelId: record.id,
                actorId: actor.id,
                reason:
                  typeof input.reason === 'string'
                    ? input.reason
                    : 'Administrative termination',
                requestKey: `travel:${record.id}:terminate-loans:${previous.lifecycleVersion}`,
                now,
              },
              connection,
            );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'travel.terminate',
              targetType: 'travelRequests',
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
          'booking',
          'exception',
        ],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          input.reason.trim().length > 0,
      },
    },
    onEnter: Object.fromEntries(
      ['completed', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `travel.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: TravelRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: TRAVEL_LIFECYCLE,
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
      directory: await processDirectorySnapshot(d.directory, 'oa.travel'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<TravelRecord>('travelRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new TravelError(
        'TRAVEL_NOT_FOUND',
        'Travel request not found.',
        'notFound',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(TRAVEL_LIFECYCLE, id, actorId)).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<TravelRecord>('travelRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return normalizeTravelRecord(r);
    throw new TravelError(
      'TRAVEL_ACCESS_DENIED',
      'This travel is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<TravelRecord>[]): TravelRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'departmentId',
      'destination',
      'international',
      'startAt',
      'endAt',
      'companionIds',
      'attachments',
      'transportCents',
      'lodgingCents',
      'allowanceCents',
      'amountCents',
      'needsLoan',
      'needsBooking',
      'approvalGrantedAt',
      'originalHeadApproverId',
      'bookingInformation',
      'exceptionReason',
      'cancelledAt',
      'cancellationId',
      'standardSnapshot',
      'managerApproverId',
      'headMerged',
      'ruleSnapshot',
      'headApproverId',
      'executiveApproverId',
      'gmApproverId',
      'gmMerged',
      'authorizationId',
      'authorizationSourceId',
      'approvalGeneration',
      'reason',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new TravelError(
        'TRAVEL_FIELDS_RESTRICTED',
        'This release requires all travel business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizeTravelRecord(row as TravelRecord));
  }
  async function enrich(records: TravelRecord[]) {
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
    const views = await approvals.runViewsFor(TRAVEL_LIFECYCLE, id);
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
            kind: TRAVEL_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: TRAVEL_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async options(
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      if (applicantId !== actorId) {
        await refresh();
        // There is no public hypothetical-record scope evaluator. Refuse scoped delegation rather than interpreting a Travel scope as an Employee scope.
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
          throw new TravelError(
            'TRAVEL_STANDARD_TARGET_DENIED',
            'The delegated applicant travel standard requires an unrestricted target create grant. Scoped delegation is not supported for standard lookup.',
            'permission',
          );
        const employee = await d.employees.getByUserId(applicantId);
        const department = await d.org.primaryDepartmentOf(applicantId);
        if (!employee?.active || employee.status === 'left' || !department)
          throw new TravelError(
            'TRAVEL_STANDARD_TARGET_INVALID',
            'Choose an active applicant with a primary department.',
            'precondition',
          );
      }
      return {
        applicantId,
        timeZone: d.calendar.timeZone(),
        standard: await standardFor(applicantId),
      };
    },
    async sourceForLoan(
      id: string,
      applicantId: string,
      connection: DatabaseConnection,
    ) {
      const repo = connection.repository<TravelRecord>('travelRequests');
      const first = await repo.findOne({ filter: { id } });
      if (!first) return null;
      await repo.updateMany({
        filter: { id, lifecycleVersion: first.lifecycleVersion },
        values: { lifecycleVersion: first.lifecycleVersion },
      });
      const row = await repo.findOne({
        filter: { id, applicantId },
      });
      return row?.approvalGrantedAt &&
        !row.cancelledAt &&
        ['booking', 'exception', 'completed'].includes(row.status)
        ? {
            id: row.id,
            applicantId: row.applicantId,
            number: row.number,
            amountCents: Number(row.amountCents),
            approvedAt: row.approvalGrantedAt,
          }
        : null;
    },
    async approvedLoanSources(
      applicantId: string,
      connection?: DatabaseConnection,
    ) {
      return (
        await (connection ?? d.db)
          .repository<TravelRecord>('travelRequests')
          .findMany({ filter: { applicantId } })
      )
        .filter(
          (r) =>
            !r.cancelledAt &&
            r.approvalGrantedAt &&
            ['booking', 'exception', 'completed'].includes(r.status),
        )
        .map((r) => ({
          id: r.id,
          applicantId: r.applicantId,
          number: r.number,
          amountCents: Number(r.amountCents),
          approvedAt: r.approvalGrantedAt!,
        }));
    },
    async cancelApproved(
      id: string,
      cancellationId: string,
      actorId: string,
      reason: string,
      connection: DatabaseConnection,
    ) {
      const row = await connection
        .repository<TravelRecord>('travelRequests')
        .findOne({ filter: { id } });
      if (!row) refuse('TRAVEL_NOT_FOUND', 'Trip not found.');
      return cancellationProof.run(true, () =>
        runtime.fire(TRAVEL_LIFECYCLE, id, 'cancelApproved', {
          actor: { id: actorId },
          input: { cancellationId, reason },
          requestId: `cancel:${cancellationId}`,
          expect: { version: row.lifecycleVersion },
          transaction: connection,
        }),
      );
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<TravelRecord>('travelRequests')
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
            TRAVEL_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            TRAVEL_LIFECYCLE,
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
            ['finance', 'financeManager', 'cfo'].some((role) =>
              outside.directory.hasRole(actorId, role),
            ) ||
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
      input: TravelInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          TRAVEL_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            amountCents: total(input),
            standardSnapshot: null,
            approvalGrantedAt: null,
            approvalGeneration: 0,
            authorizationSourceId: null,
            originalHeadApproverId: null,
            bookingInformation: null,
            exceptionReason: null,
            cancelledAt: null,
            cancellationId: null,
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
        runtime.fire(TRAVEL_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(TRAVEL_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new TravelError(
          'TRAVEL_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(TRAVEL_LIFECYCLE, id);
      if (
        !views.some((view) =>
          action === 'cc'
            ? view.run.id === taskId
            : view.tasks.some((task) => task.id === taskId),
        )
      )
        throw new TravelError(
          'TRAVEL_TARGET_MISMATCH',
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
        const runs = await approvals.runViewsFor(TRAVEL_LIFECYCLE, id);
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
          view: await runtime.view(TRAVEL_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(TRAVEL_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(TRAVEL_LIFECYCLE, id, actor),
          runActions: await approvals.runActionsFor(
            TRAVEL_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            TRAVEL_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(TRAVEL_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<TravelRecord>('travelRequests');
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
        const selected: TravelRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              TRAVEL_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, TRAVEL_LIFECYCLE, record.id)
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
                    await approvals.actionsFor(TRAVEL_LIFECYCLE, record.id, {
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
        .repository<TravelRecord>('travelRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['manager', 'head', 'finance', 'executive', 'gm', 'booking'].map(
                (s) => f.string('status').eq(s),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type TravelService = ReturnType<typeof createTravelService>;
