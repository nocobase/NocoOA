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
import { z } from 'zod';
import { bookingPolicy, bookingActions } from './handling.js';
import { randomUUID } from 'node:crypto';
import {
  isOpenRun,
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
  configureAction,
  transferAction,
  allActivePeople,
  peopleWithRole,
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
import { TravelCancellationError } from './errors.js';
import type { TravelService } from './service.js';
import { createHash } from 'node:crypto';
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

export const TRAVEL_CANCELLATION_LIFECYCLE = 'oa.travelCancellation';
export interface TravelCancellationRecord extends LifecycleRecord {
  id: string;
  applicantId: string;
  createdById: string;
  number: string | null;
  sourceId: string;
  needsUnbooking: boolean;
  unbookingInformation: string | null;
  exceptionReason: string | null;
  baseline: string | null;
  reason: string;
  ruleSnapshot: JsonObject | null;
  managerApproverId: string | null;
  status: string;
  lifecycleVersion: number;
  createdAt: string;
}
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
}
interface Types {
  record: TravelCancellationRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'unbooking'
    | 'exception'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface TravelCancellationDependencies {
  db: DatabaseManager;
  travel: () => TravelService;
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
  throw new TravelCancellationError(reason, message);
}
export type TravelCancellationInput = Pick<
  TravelCancellationRecord,
  'sourceId' | 'reason'
>;
export function createTravelCancellationService(
  d: TravelCancellationDependencies,
) {
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
        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'travelCancellations')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new TravelCancellationError(
                'TRAVEL_CANCELLATION_FIELDS_RESTRICTED',
                'The grant must expose the created travelCancellation record.',
                'permission',
              );
            return row.record as LifecycleRecord;
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'travelCancellations')
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
                    'oa.travelCancellation',
                    connection,
                  )),
                connection,
              });
              const change = intervention.getStore();
              if (change) change.depth++;
              try {
                const result = await work(wrap(tx));
                if (change?.depth === 1)
                  await d.audit.record(
                    {
                      actorId: change.actorId,
                      action: `travelCancellation.${change.action}`,
                      targetType: 'travelCancellations',
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
    record: TravelCancellationRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = ['sourceId', 'reason'];
  const stage = stagesFor<Types>();
  const actions = [
    ...createOaApprovalOperations(d),
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    appointAction,
    reassignAction,
  ];
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  const baseline = (record: Record<string, unknown>) =>
    createHash('sha256')
      .update(
        JSON.stringify(
          [
            'destination',
            'international',
            'startAt',
            'endAt',
            'transportCents',
            'lodgingCents',
            'allowanceCents',
            'companionIds',
            'attachments',
            'needsBooking',
          ].map((k) => record[k]),
        ),
      )
      .digest('hex');
  async function validate(
    record: TravelCancellationRecord,
    connection: DatabaseConnection,
  ) {
    const source = await d
      .travel()
      .sourceForLoan(record.sourceId, record.applicantId, connection);
    if (!source)
      refuse(
        'TRAVEL_CANCELLATION_INVALID_SOURCE',
        'Only an approved active trip belonging to the applicant can be cancelled.',
      );
    const original = await connection
      .repository('travelRequests')
      .findOne({ filter: { id: record.sourceId } });
    if (!original)
      refuse('TRAVEL_CANCELLATION_INVALID_SOURCE', 'Source trip disappeared.');
    if (!record.reason.trim() || record.reason.length > 10000)
      refuse(
        'TRAVEL_CANCELLATION_REASON_REQUIRED',
        'Cancellation reason is required.',
      );
    const others = await connection
      .repository<TravelCancellationRecord>('travelCancellations')
      .findMany({ filter: { sourceId: record.sourceId } });
    if (
      others.some(
        (r) => r.id !== record.id && ['manager', 'revision'].includes(r.status),
      )
    )
      refuse(
        'TRAVEL_CANCELLATION_ALREADY_PENDING',
        'Another cancellation is already pending.',
      );
    return { original, baseline: baseline(original) };
  }
  const approval = defineApproval<Types>({
    name: TRAVEL_CANCELLATION_LIFECYCLE,
    collection: 'travelCancellations',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: fields,
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<TravelCancellationRecord>('travelCancellations')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: TRAVEL_CANCELLATION_LIFECYCLE,
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
        'unbooking',
        stage.custom(
          bookingPolicy,
          {},
          {
            qualification: 'admin',
            pools: [
              {
                key: 'administration',
                candidates: ({ services }) =>
                  services.directory.roleMembers('admin'),
                claimable: true,
              },
            ],
            onEmpty: 'hold',
            remindAfterHours: 24,
            dueAfterHours: 48,
            onDue: 'escalate',
            outputs: {
              fields: {
                bookingInformation: z.string().trim().min(1).max(10000),
              },
              required: ['bookingInformation'],
              merge: 'last',
              writes: { bookingInformation: 'unbookingInformation' },
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
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'manager',
        guard: owner,
        set: async ({ record, services, now }) => {
          const checked = await validate(record, services.connection!);
          return {
            baseline: checked.baseline,
            needsUnbooking: !!checked.original.needsBooking,
            managerApproverId:
              typeof checked.original.originalHeadApproverId === 'string'
                ? checked.original.originalHeadApproverId
                : null,
            number:
              record.number ??
              (await d.sequences.next(
                'TRAVELCANCEL',
                services.connection!,
                now,
              )),
            ruleSnapshot:
              record.ruleSnapshot ??
              (await d.rules.snapshot(
                [
                  'sla.remindHours',
                  'sla.escalateHours',
                  'sla.urgeCooldownHours',
                ],
                now,
                services.connection,
              )),
          };
        },
      },
      managerApproved: {
        from: 'manager',
        to: ['unbooking', 'approved'],
        route: ({ record }) =>
          record.needsUnbooking ? 'unbooking' : 'approved',
        approvalOutcome: 'approved',
        onTransition: async ({ record, actor, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          const checked = await validate(record, connection);
          if (record.baseline !== checked.baseline)
            refuse(
              'TRAVEL_CANCELLATION_BASELINE_CHANGED',
              'The approved trip changed. Return and resubmit the cancellation.',
            );
          await d
            .travel()
            .cancelApproved(
              record.sourceId,
              record.id,
              actor.id,
              record.reason,
              connection,
            );
        },
      },
      unbooked: {
        from: 'unbooking',
        to: 'approved',
        approvalOutcome: 'booked',
      },
      unbookingFailed: {
        from: 'unbooking',
        to: 'exception',
        approvalOutcome: 'unavailable',
        set: ({ input }) => ({
          exceptionReason:
            input.result &&
            typeof input.result === 'object' &&
            !Array.isArray(input.result) &&
            typeof input.result.reason === 'string'
              ? input.result.reason
              : 'Unable to cancel booking',
        }),
      },
      retryUnbooking: { from: 'exception', to: 'unbooking', guard: owner },
      unbookingForced: {
        from: 'unbooking',
        to: 'approved',
        approvalOutcome: 'forcedClosed',
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'travelCancellation.forceComplete',
              targetType: 'travelCancellations',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          ),
      },
      rejected: {
        from: ['manager'],
        to: 'rejected',
        approvalOutcome: 'rejected',
      },
      returned: {
        from: ['manager'],
        to: 'revision',
        approvalOutcome: 'returned',
      },
      withdraw: {
        from: ['draft', 'revision', 'manager'],
        to: 'withdrawn',
        guard: owner,
      },
      terminate: {
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'travelCancellation.terminate',
              targetType: 'travelCancellations',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          ),
        from: ['revision', 'manager'],
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
            name: `travelCancellation.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: TravelCancellationRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: TRAVEL_CANCELLATION_LIFECYCLE,
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
      directory: await processDirectorySnapshot(
        d.directory,
        'oa.travelCancellation',
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
      .repository<TravelCancellationRecord>('travelCancellations')
      .findOne({ filter: { id } });
    if (!r)
      throw new TravelCancellationError(
        'TRAVEL_CANCELLATION_NOT_FOUND',
        'TravelCancellation request not found.',
        'notFound',
      );
    if (
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (
        await approvals.involvementOf(
          TRAVEL_CANCELLATION_LIFECYCLE,
          id,
          actorId,
        )
      ).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<TravelCancellationRecord>('travelCancellations')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return r;
    throw new TravelCancellationError(
      'TRAVEL_CANCELLATION_ACCESS_DENIED',
      'This travelCancellation request is not accessible.',
      'permission',
    );
  }
  function fullRows(
    rows: Partial<TravelCancellationRecord>[],
  ): TravelCancellationRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'sourceId',
      'needsUnbooking',
      'unbookingInformation',
      'exceptionReason',
      'reason',
      'baseline',
      'ruleSnapshot',
      'managerApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new TravelCancellationError(
        'TRAVEL_CANCELLATION_FIELDS_RESTRICTED',
        'This release requires all travelCancellation business fields for reading.',
        'permission',
      );
    return rows as TravelCancellationRecord[];
  }
  async function enrich(records: TravelCancellationRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [r.applicantId, r.createdById, r.managerApproverId])
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
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(
      TRAVEL_CANCELLATION_LIFECYCLE,
      id,
    );
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
            kind: TRAVEL_CANCELLATION_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: TRAVEL_CANCELLATION_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<TravelCancellationRecord>('travelCancellations')
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
            TRAVEL_CANCELLATION_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            TRAVEL_CANCELLATION_LIFECYCLE,
            record.id,
            actorId,
          );
          let head = false;
          const dept = await d.org.primaryDepartmentOf(record.applicantId);
          if (dept)
            head = Boolean(
              (await d.org.activeChain(dept.id))?.some(
                (d) => d.managerId === actorId,
              ),
            );
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            involvement.length ||
            acted ||
            ['finance', 'financeManager', 'cfo', 'gm'].some((role) =>
              outside.directory.hasRole(actorId, role),
            ) ||
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
      input: TravelCancellationInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          TRAVEL_CANCELLATION_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            baseline: null,
            needsUnbooking: false,
            unbookingInformation: null,
            exceptionReason: null,
            ruleSnapshot: null,
            managerApproverId: null,
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
        runtime.fire(TRAVEL_CANCELLATION_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(
        TRAVEL_CANCELLATION_LIFECYCLE,
        id,
      );
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new TravelCancellationError(
          'TRAVEL_CANCELLATION_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(
        TRAVEL_CANCELLATION_LIFECYCLE,
        id,
      );
      if (!views.some((view) => view.tasks.some((task) => task.id === taskId)))
        throw new TravelCancellationError(
          'TRAVEL_CANCELLATION_TARGET_MISMATCH',
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
        const runs = await approvals.runViewsFor(
          TRAVEL_CANCELLATION_LIFECYCLE,
          id,
        );
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.managerApproverId,
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
          record,
          users,
          view: await runtime.view(TRAVEL_CANCELLATION_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(TRAVEL_CANCELLATION_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(
            TRAVEL_CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            TRAVEL_CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            TRAVEL_CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(
            TRAVEL_CANCELLATION_LIFECYCLE,
            id,
          ),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<TravelCancellationRecord>(
          'travelCancellations',
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
        const selected: TravelCancellationRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              TRAVEL_CANCELLATION_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(
                  approvals,
                  TRAVEL_CANCELLATION_LIFECYCLE,
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
                      TRAVEL_CANCELLATION_LIFECYCLE,
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
        .repository<TravelCancellationRecord>('travelCancellations')
        .findMany({
          filter: (f) =>
            f.or(['manager', 'unbooking'].map((s) => f.string('status').eq(s))),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type TravelCancellationService = ReturnType<
  typeof createTravelCancellationService
>;
export const travelCancellationServiceToken =
  createServiceToken<TravelCancellationService>(
    'oa/travel-cancellation-service',
  );
