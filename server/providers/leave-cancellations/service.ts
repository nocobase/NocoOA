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
import { LeaveError } from '../leave/errors.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';

import {
  LEAVE_LIFECYCLE,
  type LeaveRecord,
  type LeaveService,
} from '../leave/service.js';
import type { LeaveBalanceService } from '../leave-balances/contract.js';
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

export const CANCELLATION_LIFECYCLE = 'oa.leaveCancellation';
export interface CancellationRecord extends LifecycleRecord {
  originalLeaveId: string;
  cancelAll: boolean;
  baseline: JsonObject | null;
  id: string;
  applicantId: string;
  createdById: string;
  number: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  startHalf: 'am' | 'pm';
  endHalf: 'am' | 'pm';
  days: number | string;
  reason: string;
  attachments: string[];
  handoverUserId: string | null;
  enableDelegation: boolean;
  ruleSnapshot: JsonObject | null;
  hrRecipients: string[];
  requiresHr: boolean;
  managerApproverId: string | null;
  status: string;
  lifecycleVersion: number;
  createdAt: string;
}
interface AttendanceRecord extends RepositoryRecord {
  id: string;
  applicationId: string;
  active: boolean;
  startDate: string;
  endDate: string;
  startHalf: 'am' | 'pm';
  endHalf: 'am' | 'pm';
  days: number | string;
}
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
}
interface Types {
  record: CancellationRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'head'
    | 'hr'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface CancellationDependencies {
  db: DatabaseManager;
  balances: LeaveBalanceService;
  leave: LeaveService;
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
  throw new LeaveError(reason, message);
}
export interface CancellationInput {
  originalLeaveId: string;
  cancelAll: boolean;
  endDate: string;
  endHalf: 'am' | 'pm';
  reason: string;
}
export function createCancellationService(d: CancellationDependencies) {
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
        if (key === 'findRecord')
          return async (...args: Parameters<LifecycleStore['findRecord']>) => {
            const record = await target.findRecord(...args);
            if (!record || args[0] !== 'leaveCancellations') return record;
            // Match submit's canonical half-day string before freeze/hash checks;
            // PostgreSQL returns decimals such as "1.00" on subsequent reads.
            const days = Number(record.days);
            if (
              (typeof record.days !== 'string' &&
                typeof record.days !== 'number') ||
              !Number.isFinite(days) ||
              days < 0 ||
              days > 999999.99 ||
              !Number.isSafeInteger(days * 2)
            )
              throw new LeaveError(
                'LEAVE_FACT_INVALID',
                'Stored cancellation days must be a finite nonnegative half-day amount.',
                'precondition',
              );
            return { ...record, days: String(days) };
          };
        const policy = writePolicy.getStore();
        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'leaveCancellations')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new LeaveError(
                'LEAVE_FIELDS_RESTRICTED',
                'The grant must expose the created leave record.',
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
            if (collection !== 'leaveCancellations')
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
                    'oa.leaveCancellation',
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
                      action: `leaveCancellation.${change.action}`,
                      targetType: 'leaveCancellations',
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
    record: CancellationRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = ['cancelAll', 'endDate', 'endHalf', 'reason'];
  const stage = stagesFor<Types>();
  const actions = [
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    appointAction,
    reassignAction,
    ...createOaApprovalOperations(d),
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
    record: CancellationRecord,
    connection: DatabaseConnection,
    now: Date,
  ) {
    await lockUserForAdministration(connection, record.applicantId);
    const original = await connection
      .repository<LeaveRecord>('leaveRequests')
      .findOne({ filter: { id: record.originalLeaveId } });
    if (
      !original ||
      original.status !== 'approved' ||
      original.applicantId !== record.applicantId
    )
      refuse(
        'CANCELLATION_ORIGINAL_INVALID',
        'Only your approved leave can be cancelled.',
      );
    const attendance = await connection
      .repository<AttendanceRecord>('leaveAttendance')
      .findOne({ filter: { applicationId: original.id } });
    if (!attendance || attendance.active === false)
      refuse(
        'CANCELLATION_NO_REMAINDER',
        'The leave has already been cancelled.',
      );
    const baseline = {
      originalNumber: original.number ?? original.id,
      id: String(attendance.id),
      startDate: String(attendance.startDate),
      startHalf: String(attendance.startHalf),
      endDate: String(attendance.endDate),
      endHalf: String(attendance.endHalf),
      days: String(attendance.days),
    };
    const position = (date: string, half: string) =>
      `${date}:${half === 'am' ? 0 : 1}`;
    const start = position(baseline.startDate, baseline.startHalf),
      end = position(baseline.endDate, baseline.endHalf);
    let remaining = 0;
    let cancelledStart: string;
    let cancelledHalf: 'am' | 'pm';
    if (record.cancelAll) {
      cancelledStart = baseline.startDate;
      cancelledHalf = baseline.startHalf as 'am' | 'pm';
    } else {
      const target = position(record.endDate, record.endHalf);
      if (target < start || target >= end)
        refuse(
          'CANCELLATION_RANGE_INVALID',
          'Actual end must shorten the current leave range.',
        );
      remaining = d.calendar.workdaysBetween(
        baseline.startDate,
        record.endDate,
        {
          startHalf: baseline.startHalf as 'am' | 'pm',
          endHalf: record.endHalf,
        },
      );
      if (record.endHalf === 'am') {
        cancelledStart = record.endDate;
        cancelledHalf = 'pm';
      } else {
        cancelledStart = new Date(
          Date.parse(`${record.endDate}T00:00:00Z`) + 86400000,
        )
          .toISOString()
          .slice(0, 10);
        cancelledHalf = 'am';
      }
    }
    // Non-working dates have no leave half-days to start. A weekend preceding the
    // cancelled remainder must not prevent cancelling Monday's still-future leave.
    while (
      cancelledStart <= baseline.endDate &&
      d.calendar.workdaysBetween(cancelledStart, cancelledStart, {
        startHalf: cancelledHalf,
        endHalf:
          cancelledStart === baseline.endDate
            ? (baseline.endHalf as 'am' | 'pm')
            : 'pm',
      }) <= 0
    ) {
      cancelledStart = new Date(
        Date.parse(`${cancelledStart}T00:00:00Z`) + 86400000,
      )
        .toISOString()
        .slice(0, 10);
      cancelledHalf = 'am';
    }
    const boundary = localInstant(
      cancelledStart,
      workBoundary(cancelledStart, cancelledHalf === 'am' ? 'start' : 'middle'),
    );
    if (Date.parse(boundary) <= Math.max(now.getTime(), Date.now()))
      refuse(
        'CANCELLATION_ALREADY_STARTED',
        'A half-day that has already started cannot be cancelled.',
      );
    const refunded = Number(baseline.days) - remaining;
    if (refunded <= 0 || !Number.isInteger(refunded * 2))
      refuse(
        'CANCELLATION_NO_WORKDAYS',
        'No working half-days can be refunded.',
      );
    return { original, baseline, remaining, refunded };
  }
  const approval = defineApproval<Types>({
    name: CANCELLATION_LIFECYCLE,
    collection: 'leaveCancellations',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [
      ...fields,
      'days',
      'originalLeaveId',
      'baseline',
      'leaveType',
      'startDate',
      'startHalf',
    ],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: (r) => r.hrRecipients },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<CancellationRecord>('leaveCancellations')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: CANCELLATION_LIFECYCLE,
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
        onTransition: async ({ record, tx, now }) => {
          const connection = tx.handle as DatabaseConnection;
          await validate(record, connection, now);
        },
      },
      submit: {
        from: ['draft', 'revision'],
        to: 'manager',
        guard: owner,
        set: async ({ record, services, now }) => {
          const checked = await validate(record, services.connection!, now);
          return {
            baseline: checked.baseline,
            days: String(checked.refunded),
            ruleSnapshot: checked.original.ruleSnapshot,
            hrRecipients: checked.original.hrRecipients,
            number:
              record.number ??
              (await d.sequences.next(
                'LEAVECANCEL',
                services.connection!,
                now,
              )),
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
        from: ['draft', 'revision', 'manager'],
        to: 'withdrawn',
        guard: owner,
      },
      terminate: {
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'leaveCancellation.terminate',
              targetType: 'leaveCancellations',
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
    onEnterState: {
      approved: async ({ record, tx, now, actor }) => {
        const connection = tx.handle as DatabaseConnection;
        const checked = await validate(record, connection, now);
        if (
          JSON.stringify(checked.baseline) !== JSON.stringify(record.baseline)
        )
          refuse(
            'CANCELLATION_BASELINE_CHANGED',
            'The effective leave has changed; return and resubmit this cancellation.',
          );
        if (
          typeof checked.original.ruleSnapshot?.['leave.balanceType'] ===
          'string'
        ) {
          const employee = await d.employees.getByUserId(
            record.applicantId,
            connection,
          );
          if (!employee)
            refuse(
              'CANCELLATION_EMPLOYEE_MISSING',
              'The employee archive is unavailable.',
            );
          await d.balances.refund(
            {
              employeeId: employee.id,
              leaveType: checked.original.leaveType,
              reference: checked.original.id,
              units: checked.refunded * 2,
              requestKey: `cancel:${record.id}:refund`,
              actorId: actor.id,
              at: now,
            },
            connection,
          );
        }
        await connection
          .repository<AttendanceRecord>('leaveAttendance')
          .updateOne({
            filter: { id: checked.baseline.id },
            values: record.cancelAll
              ? { active: false, days: '0' }
              : {
                  endDate: record.endDate,
                  endHalf: record.endHalf,
                  days: String(checked.remaining),
                },
          });
        await d.directory.disableLeaveDelegations(record.originalLeaveId, {
          actorId: actor.id,
          connection,
        });
        await d.audit.record(
          {
            actorId: actor.id,
            action: 'leave.cancel',
            targetType: 'leaveRequests',
            targetId: record.originalLeaveId,
            reason: record.reason,
            after: {
              cancellationId: record.id,
              refundedDays: checked.refunded,
              remainingDays: checked.remaining,
            },
          },
          connection,
        );
      },
    },
    onEnter: Object.fromEntries(
      ['approved', 'rejected', 'revision'].map((state) => [
        state,
        [
          {
            name: `leaveCancellation.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: CancellationRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                kind: CANCELLATION_LIFECYCLE,
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
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
  // Conversion uses Intl for the application's calendar time zone, never the server's local zone.
  function workBoundary(
    date: string,
    boundary: 'start' | 'middle' | 'end',
  ): number {
    const hours = d.calendar.workHoursOn(date);
    const minutes = (v: string) => {
      const [h, m] = v.split(':').map(Number);
      return h + m / 60;
    };
    const start = minutes(hours.start),
      end = minutes(hours.end);
    return boundary === 'start'
      ? start
      : boundary === 'end'
        ? end
        : (start + end) / 2;
  }
  function localInstant(date: string, hour: number): string {
    const utc = Date.parse(
      `${date}T${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}:00Z`,
    );
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: d.calendar.timeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      format.formatToParts(new Date(utc)).map((p) => [p.type, p.value]),
    );
    const interpreted = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    return new Date(utc - (interpreted - utc)).toISOString();
  }
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(
        d.directory,
        'oa.leaveCancellation',
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
      .repository<CancellationRecord>('leaveCancellations')
      .findOne({ filter: { id } });
    if (!r)
      throw new LeaveError(
        'LEAVE_NOT_FOUND',
        'Leave request not found.',
        'notFound',
      );
    if (
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(CANCELLATION_LIFECYCLE, id, actorId))
        .length ||
      Boolean(
        policy &&
        (await d.db
          .repository<CancellationRecord>('leaveCancellations')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return r;
    throw new LeaveError(
      'LEAVE_ACCESS_DENIED',
      'This leave request is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<CancellationRecord>[]): CancellationRecord[] {
    const fields = [
      'id',
      'originalLeaveId',
      'cancelAll',
      'baseline',
      'applicantId',
      'createdById',
      'number',
      'leaveType',
      'startDate',
      'endDate',
      'startHalf',
      'endHalf',
      'days',
      'reason',
      'attachments',
      'handoverUserId',
      'enableDelegation',
      'ruleSnapshot',
      'hrRecipients',
      'requiresHr',
      'managerApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new LeaveError(
        'LEAVE_FIELDS_RESTRICTED',
        'This release requires all leave business fields for reading.',
        'permission',
      );
    return rows as CancellationRecord[];
  }
  async function enrich(records: CancellationRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.handoverUserId,
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
      handoverUser: r.handoverUserId
        ? (users.get(r.handoverUserId) ?? null)
        : null,
      managerApprover: r.managerApproverId
        ? (users.get(r.managerApproverId) ?? null)
        : null,
      hrUsers: r.hrRecipients
        .map((id) => users.get(id))
        .filter((u) => u !== undefined),
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(CANCELLATION_LIFECYCLE, id);
    for (const view of views) {
      if (view.run.status === 'manager' && view.tasks.length === 0)
        await d.notifications.alarm({
          kind: CANCELLATION_LIFECYCLE,
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
        });
    }
  }
  return {
    initialize: refresh,
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<CancellationRecord>('leaveCancellations')
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
            CANCELLATION_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            CANCELLATION_LIFECYCLE,
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
    async original(id: string, actorId: string) {
      const record = await d.db
        .repository<LeaveRecord>('leaveRequests')
        .findOne({ filter: { id } });
      if (
        !record ||
        record.applicantId !== actorId ||
        record.status !== 'approved'
      )
        throw new LeaveError(
          'CANCELLATION_ORIGINAL_INVALID',
          'Only your approved leave can be cancelled.',
          'permission',
        );
      const attendance = await d.db
        .repository<AttendanceRecord>('leaveAttendance')
        .findOne({ filter: { applicationId: id } });
      if (!attendance || attendance.active === false)
        refuse(
          'CANCELLATION_NO_REMAINDER',
          'The leave has already been cancelled.',
        );
      return {
        id: record.id,
        number: record.number,
        leaveType: record.leaveType,
        startDate: attendance.startDate,
        startHalf: attendance.startHalf,
        endDate: attendance.endDate,
        endHalf: attendance.endHalf,
        days: attendance.days,
        timeZone: d.calendar.timeZone(),
      };
    },
    async create(
      input: CancellationInput,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const original = await d.db
        .repository<LeaveRecord>('leaveRequests')
        .findOne({ filter: { id: input.originalLeaveId } });
      if (
        !original ||
        original.applicantId !== actorId ||
        original.status !== 'approved'
      )
        refuse(
          'CANCELLATION_ORIGINAL_INVALID',
          'Only your approved leave can be cancelled.',
        );
      const currentAttendance = await d.db
        .repository<AttendanceRecord>('leaveAttendance')
        .findOne({ filter: { applicationId: original.id } });
      if (!currentAttendance || currentAttendance.active === false)
        refuse(
          'CANCELLATION_NO_REMAINDER',
          'The leave has already been cancelled.',
        );
      // The approved original history is immutable. Resolve via the public API before opening
      // this runtime's transaction: a separate approval runtime cannot join its active transaction.
      const runs = await d.leave.approvals.runViewsFor(
        LEAVE_LIFECYCLE,
        original.id,
      );
      const first = runs
        .filter(
          (r) =>
            r.tasks.some((t) => t.stage === 'manager') &&
            r.run.status === 'approved',
        )
        .at(-1);
      const reviewer =
        first?.tasks.find(
          (t) => t.status === 'completed' && t.answer === 'approve',
        )?.assigneeId ?? original.managerApproverId;
      const create = () =>
        runtime.create(
          CANCELLATION_LIFECYCLE,
          {
            ...Object.fromEntries(
              Object.entries(original).filter(
                ([key]) =>
                  !['status', 'lifecycleVersion', 'statusChangedAt'].includes(
                    key,
                  ),
              ),
            ),
            ...input,
            id: randomUUID(),
            applicantId: actorId,
            createdById: actorId,
            number: null,
            days: '0',
            baseline: {
              originalNumber: original.number ?? original.id,
              id: currentAttendance.id,
              startDate: currentAttendance.startDate,
              startHalf: currentAttendance.startHalf,
              endDate: currentAttendance.endDate,
              endHalf: currentAttendance.endHalf,
              days: String(currentAttendance.days),
            },
            ruleSnapshot: null,
            managerApproverId: reviewer,
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
        runtime.fire(CANCELLATION_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(CANCELLATION_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new LeaveError(
          'LEAVE_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(CANCELLATION_LIFECYCLE, id);
      if (!views.some((view) => view.tasks.some((task) => task.id === taskId)))
        throw new LeaveError(
          'LEAVE_TARGET_MISMATCH',
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
        const runs = await approvals.runViewsFor(CANCELLATION_LIFECYCLE, id);
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.handoverUserId,
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
          view: await runtime.view(CANCELLATION_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(CANCELLATION_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(
            CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            CANCELLATION_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(CANCELLATION_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository =
          d.db.repository<CancellationRecord>('leaveCancellations');
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
        const selected: CancellationRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              CANCELLATION_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(
                  approvals,
                  CANCELLATION_LIFECYCLE,
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
                      CANCELLATION_LIFECYCLE,
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
        .repository<CancellationRecord>('leaveCancellations')
        .findMany({
          filter: (f) => f.or(['manager'].map((s) => f.string('status').eq(s))),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type CancellationService = ReturnType<typeof createCancellationService>;
export const cancellationServiceToken = createServiceToken<CancellationService>(
  'oa/leave-cancellation-service',
);
