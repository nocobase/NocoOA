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
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  readAction,
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
import { OutingError } from './errors.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';

import type { AttendanceService } from '../attendance/contract.js';
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
  DictionaryService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';

export const OUTING_LIFECYCLE = 'oa.outing';
export interface OutingRecord extends LifecycleRecord {
  id: string;
  applicantId: string;
  createdById: string;
  number: string | null;
  startAt: string;
  endAt: string;
  location: string;
  reason: string;
  ruleSnapshot: JsonObject | null;
  hrRecipients: string[];
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
  record: OutingRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface OutingDependencies {
  db: DatabaseManager;
  attendance: AttendanceService;
  org: OrgService;

  audit: AuditService;
  users: UserAdministrationService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  dictionaries: DictionaryService;
  rules: RuleService;
  sequences: SequenceService;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
}
export function refuse(reason: string, message: string): never {
  throw new OutingError(reason, message);
}
export type OutingInput = Pick<
  OutingRecord,
  'startAt' | 'endAt' | 'location' | 'reason'
>;
export function createOutingService(d: OutingDependencies) {
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
            if (collection !== 'outingRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new OutingError(
                'OUTING_FIELDS_RESTRICTED',
                'The grant must expose the created outing record.',
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
            if (collection !== 'outingRequests')
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
                    'oa.outing',
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
                      action: `outing.${change.action}`,
                      targetType: 'outingRequests',
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
    record: OutingRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = ['startAt', 'endAt', 'location', 'reason'];
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
  async function validate(
    record: OutingRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'OUTING_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    const start = Date.parse(record.startAt),
      end = Date.parse(record.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      refuse(
        'OUTING_INVALID_PERIOD',
        'A valid nonempty outing period is required.',
      );
    if (!record.location.trim() || !record.reason.trim())
      refuse('OUTING_REQUIRED_FIELDS', 'A location and reason are required.');
  }
  // One-stage approvals deliberately use the plugin for shared inbox, delegation and OA maintenance clocks.
  const approval = defineApproval<Types>({
    name: OUTING_LIFECYCLE,
    collection: 'outingRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: fields,
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: (r) => r.hrRecipients },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<OutingRecord>('outingRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: OUTING_LIFECYCLE,
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
          assignee: ({ record, directory }) =>
            directory.managerOf(record.applicantId),
        }),
      ),
      // Approved outings remain active business records so pre-start withdrawal and supervisor termination are legal.
      'approved',
      ...(['rejected', 'withdrawn', 'terminated'] as const).map((name) => ({
        name,
        final: true,
      })),
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
          const snapshot =
            record.ruleSnapshot ??
            (await d.rules.snapshot(
              ['sla.remindHours', 'sla.escalateHours', 'sla.urgeCooldownHours'],
              now,
              connection,
            ));
          if (
            snapshot['sla.remindHours'] !== 24 ||
            snapshot['sla.escalateHours'] !== 48
          )
            refuse(
              'OUTING_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          await validate(record, connection);
          return {
            ruleSnapshot: snapshot,
            number:
              record.number ?? (await d.sequences.next('OUT', connection, now)),
            hrRecipients: [...services.directory.roleMembers('hr')],
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
          };
        },
      },
      managerApproved: {
        from: 'manager',
        to: 'approved',
        approvalOutcome: 'approved',
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
        from: ['draft', 'revision', 'manager', 'approved'],
        to: 'withdrawn',
        guard: (context) =>
          owner(context) &&
          context.now.getTime() < Date.parse(context.record.startAt),
        onTransition: ({ record, tx, now, actor }) =>
          d.attendance.endActivity(
            {
              kind: OUTING_LIFECYCLE,
              applicationId: record.id,
              userId: record.applicantId,
              actorId: actor.id,
              now,
              status: 'withdrawn',
            },
            tx.handle as DatabaseConnection,
          ),
      },
      terminate: {
        from: ['revision', 'manager', 'approved'],
        to: 'terminated',
        guard: ({ actor, services, record, input }) =>
          (services.directory.managerOf(record.applicantId) === actor.id ||
            record.managerApproverId === actor.id) &&
          typeof input.reason === 'string' &&
          !!input.reason.trim(),
        onTransition: async ({ record, actor, input, tx, now }) => {
          const connection = tx.handle as DatabaseConnection;
          await d.attendance.endActivity(
            {
              kind: OUTING_LIFECYCLE,
              applicationId: record.id,
              userId: record.applicantId,
              actorId: actor.id,
              now,
              status: 'terminated',
            },
            connection,
          );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'outing.terminate',
              targetType: 'outingRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            connection,
          );
        },
      },
    },
    onEnterState: {
      approved: async ({ record, tx, actor, now }) => {
        await validate(record, tx.handle as DatabaseConnection);
        await d.attendance.recordActivity(
          {
            kind: OUTING_LIFECYCLE,
            applicationId: record.id,
            userId: record.applicantId,
            startAt: record.startAt,
            endAt: record.endAt,
            actorId: actor.id,
            now,
          },
          tx.handle as DatabaseConnection,
        );
      },
    },
    onEnter: Object.fromEntries(
      ['approved', 'rejected', 'revision', 'withdrawn', 'terminated'].map(
        (state) => [
          state,
          [
            {
              name: `outing.notify.${state}`,
              retry: { attempts: 5, backoffMs: 1000 },
              run: ({
                record,
                idempotencyKey,
              }: {
                record: OutingRecord;
                idempotencyKey: string;
              }) =>
                d.notifications.result({
                  recordId: record.id,
                  applicantId: record.applicantId,
                  state,
                  transitionId: idempotencyKey,
                  kind: OUTING_LIFECYCLE,
                }),
            },
          ],
        ],
      ),
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
      directory: await processDirectorySnapshot(d.directory, 'oa.outing'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<OutingRecord>('outingRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new OutingError(
        'OUTING_NOT_FOUND',
        'Outing request not found.',
        'notFound',
      );
    if (
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(OUTING_LIFECYCLE, id, actorId)).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<OutingRecord>('outingRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return r;
    throw new OutingError(
      'OUTING_ACCESS_DENIED',
      'This outing request is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<OutingRecord>[]): OutingRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'startAt',
      'endAt',
      'location',
      'reason',
      'ruleSnapshot',
      'hrRecipients',
      'managerApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new OutingError(
        'OUTING_FIELDS_RESTRICTED',
        'This release requires all outing business fields for reading.',
        'permission',
      );
    return rows as OutingRecord[];
  }
  async function enrich(records: OutingRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.managerApproverId,
            ...r.hrRecipients,
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
      managerApprover: r.managerApproverId
        ? (users.get(r.managerApproverId) ?? null)
        : null,
      hrUsers: r.hrRecipients
        .map((id) => users.get(id))
        .filter((u) => u !== undefined),
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(OUTING_LIFECYCLE, id);
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
            kind: OUTING_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: OUTING_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    options: () => ({ timeZone: d.calendar.timeZone() }),
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<OutingRecord>('outingRequests')
          .findMany();
        const ids: string[] = [];
        for (const record of records) {
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            ['hr', 'gm', 'approval.admin'].some((role) =>
              outside.directory.hasRole(actorId, role),
            )
          ) {
            ids.push(record.id);
            continue;
          }
          const involvement = await approvals.involvementOf(
            OUTING_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            OUTING_LIFECYCLE,
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
            outside.directory.hasRole(actorId, 'hr') ||
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
      input: OutingInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          OUTING_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            ruleSnapshot: null,
            hrRecipients: [],
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
        runtime.fire(OUTING_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(OUTING_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new OutingError(
          'OUTING_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(OUTING_LIFECYCLE, id);
      if (!views.some((view) => view.tasks.some((task) => task.id === taskId)))
        throw new OutingError(
          'OUTING_TARGET_MISMATCH',
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
        const runs = await approvals.runViewsFor(OUTING_LIFECYCLE, id);
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.managerApproverId,
              ...record.hrRecipients,
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
          timeZone: d.calendar.timeZone(),
          view: await runtime.view(OUTING_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(OUTING_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(OUTING_LIFECYCLE, id, actor),
          runActions: await approvals.runActionsFor(
            OUTING_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            OUTING_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(OUTING_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<OutingRecord>('outingRequests');
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
        const selected: OutingRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              OUTING_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, OUTING_LIFECYCLE, record.id)
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
                    await approvals.actionsFor(OUTING_LIFECYCLE, record.id, {
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
        .repository<OutingRecord>('outingRequests')
        .findMany({
          filter: (f) => f.or(['manager'].map((s) => f.string('status').eq(s))),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type OutingService = ReturnType<typeof createOutingService>;
export const outingServiceToken =
  createServiceToken<OutingService>('oa/outing-service');
