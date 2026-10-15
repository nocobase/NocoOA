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
  defaultAssignmentRules,
  excludeApplicant,
  claimAction,
  releaseAction,
  assignAction,
  hashOf,
  freezeOf,
} from '@nocobase/app-plugin-approval/server';
import {
  LifecycleRuntime,
  type LifecycleStore,
  type LifecycleRecord,
  type JsonObject,
  type EffectDispatcher,
  type EnterStateHookContext,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import { issuingPolicy, handlingActions } from './handling.js';
import { SupplyError } from './errors.js';
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
  DictionaryService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';

export interface SupplyItem {
  code: string;
  quantity: number;
  printInfo?: {
    name: string;
    title: string;
    phone: string;
    email: string;
    address: string;
    department?: string;
  };
}
export const SUPPLY_LIFECYCLE = 'oa.supplies';
export interface SupplyRecord extends LifecycleRecord {
  id: string;
  applicantId: string;
  createdById: string;
  number: string | null;
  items: SupplyItem[];
  purpose: string;
  itemSnapshot: JsonObject | null;
  approvedFingerprint: string | null;
  approvedAt: string | null;
  issuedById: string | null;
  forcedClosed: boolean;
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
  record: SupplyRecord;
  state:
    | 'draft'
    | 'revision'
    | 'manager'
    | 'issuing'
    | 'exception'
    | 'issued'
    | 'forcedClosed'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface SupplyDependencies {
  db: DatabaseManager;
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
  throw new SupplyError(reason, message);
}
export type SupplyInput = Pick<SupplyRecord, 'items' | 'purpose'>;
export function createSupplyService(d: SupplyDependencies) {
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
            if (collection !== 'supplyRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new SupplyError(
                'SUPPLY_FIELDS_RESTRICTED',
                'The grant must expose the created supply record.',
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
            if (collection !== 'supplyRequests')
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
                    'oa.supplies',
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
                      action: `supply.${change.action}`,
                      targetType: 'supplyRequests',
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
    record: SupplyRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = ['items', 'purpose'];
  const fingerprint = (r: SupplyRecord) => hashOf(freezeOf(r, fields));
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
    record: SupplyRecord,
    connection: DatabaseConnection,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'SUPPLY_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !record.purpose.trim() ||
      !record.items.length ||
      record.items.length > 100
    )
      refuse('SUPPLY_REQUIRED_FIELDS', 'Items and a purpose are required.');
    const unique = new Set<string>();
    for (const item of record.items) {
      if (
        unique.has(item.code) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 100000
      )
        refuse(
          'SUPPLY_INVALID_ITEMS',
          'Each item must occur once with a positive integer quantity.',
        );
      unique.add(item.code);
      const entry =
        record.status === 'exception' &&
        record.approvedFingerprint === fingerprint(record) &&
        record.itemSnapshot
          ? (record.itemSnapshot[item.code] as {
              active: boolean;
              extra: { requiresPrintInfo: boolean };
            })
          : await d.dictionaries.get('officeItem', item.code, connection);
      if (!entry?.active)
        refuse('SUPPLY_ITEM_UNAVAILABLE', 'An item is disabled or missing.');
      if (
        entry.extra?.requiresPrintInfo === true &&
        (!item.printInfo ||
          !item.printInfo.name.trim() ||
          !item.printInfo.title.trim() ||
          !item.printInfo.phone.trim() ||
          !item.printInfo.email.trim() ||
          !item.printInfo.address.trim())
      )
        refuse(
          'SUPPLY_PRINT_INFO_REQUIRED',
          'Business card print information is required.',
        );
    }
  }
  async function saveLedger({
    record,
    tx,
    actor,
    input,
    now,
  }: EnterStateHookContext<Types>) {
    const connection = tx.handle as DatabaseConnection;
    await lockUserForAdministration(connection, record.applicantId);
    if (
      !record.approvedFingerprint ||
      fingerprint(record) !== record.approvedFingerprint
    )
      refuse('SUPPLY_CONTENT_CHANGED', 'Issuing must match approved content.');
    const reason = record.forcedClosed
      ? typeof input.reason === 'string'
        ? input.reason.trim()
        : ''
      : null;
    if (record.forcedClosed && !reason)
      refuse(
        'SUPPLY_REASON_REQUIRED',
        'Forced closure requires an explanation.',
      );
    const recipientName =
      (await d.users.withConnection(connection).get(record.applicantId))
        ?.name ?? record.applicantId;
    const issuerName =
      (await d.users.withConnection(connection).get(actor.id))?.name ??
      actor.id;
    for (const [line, item] of record.items.entries()) {
      await connection.repository('supplyIssueLedger').createOne({
        values: {
          id: randomUUID(),
          applicationId: record.id,
          number: record.number,
          itemLabel:
            (record.itemSnapshot?.[item.code] as JsonObject | undefined)
              ?.label ?? {},
          recipientName,
          issuerName,
          line,
          itemCode: item.code,
          requestedQuantity: item.quantity,
          actualQuantity: record.forcedClosed ? null : item.quantity,
          printInfo: item.printInfo ?? null,
          recipientId: record.applicantId,
          issuerId: actor.id,
          outcome: record.forcedClosed ? 'forcedClosed' : 'issued',
          reason,
          createdAt: now,
        },
      });
    }
    await d.audit.record(
      {
        actorId: actor.id,
        action: record.forcedClosed ? 'supply.forceClose' : 'supply.issue',
        targetType: 'supplyRequests',
        targetId: record.id,
        reason,
      },
      connection,
    );
  }
  // One-stage approvals deliberately use the plugin for shared inbox, delegation and OA maintenance clocks.
  const approval = defineApproval<Types>({
    name: SUPPLY_LIFECYCLE,
    collection: 'supplyRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: fields,
    adminRole: 'approval.admin',
    // Issuing supplies is execution; an administrator may collect their approved supplies.
    assignment: defaultAssignmentRules.map((rule) =>
      rule.name === excludeApplicant.name
        ? {
            name: rule.name,
            apply: (context) =>
              context.stage === 'issuing'
                ? { kind: 'keep' as const }
                : rule.apply(context),
          }
        : rule,
    ),
    afterEnd: [readAction],
    copies: { on: 'final', recipients: (r) => r.hrRecipients },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<SupplyRecord>('supplyRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: SUPPLY_LIFECYCLE,
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
      'exception',
      approvalState(
        'issuing',
        stage.custom(
          issuingPolicy,
          {},
          {
            qualification: 'admin',
            onEmpty: 'hold',
            remindAfterHours: 24,
            pools: [
              {
                key: 'administration',
                candidates: ({ services }) =>
                  services.directory.roleMembers('admin'),
                claimable: true,
              },
            ],
            actions: [
              claimAction,
              releaseAction,
              assignAction,
              commentAction,
              appointAction,
              reassignAction,
              handlingActions.complete,
              handlingActions.unable,
              handlingActions.forceComplete,
              createOaApprovalOperations(d)[0],
              createOaApprovalOperations(d)[2],
            ],
          },
        ),
      ),
      { name: 'issued', final: true },
      { name: 'forcedClosed', final: true },
      ...(['rejected', 'withdrawn', 'terminated'] as const).map((name) => ({
        name,
        final: true,
      })),
    ],
    create: {
      guard: ({ values, actor }) => values.applicantId === actor.id,
    },
    transitions: {
      edit: {
        from: ['draft', 'revision', 'exception'],
        to: ['draft', 'revision', 'exception'],
        guard: owner,
        route: ({ record }) =>
          record.status as 'draft' | 'revision' | 'exception',
        accept: fields,
        onTransition: async ({ record, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          await lockUserForAdministration(connection, record.applicantId);
        },
      },
      submit: {
        from: ['draft', 'revision', 'exception'],
        to: ['manager', 'issuing'],
        route: ({ record }) =>
          record.status === 'exception' &&
          record.approvedFingerprint === fingerprint(record)
            ? 'issuing'
            : 'manager',
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
              'SUPPLY_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          await validate(record, connection);
          const unchanged =
            record.status === 'exception' &&
            record.approvedFingerprint === fingerprint(record);
          const itemSnapshot: JsonObject =
            unchanged && record.itemSnapshot ? record.itemSnapshot : {};
          if (!unchanged)
            for (const item of record.items) {
              const entry = await d.dictionaries.get(
                'officeItem',
                item.code,
                connection,
              );
              itemSnapshot[item.code] = {
                active: true,
                label: entry!.label,
                extra: {
                  requiresPrintInfo: entry!.extra?.requiresPrintInfo === true,
                },
              };
            }
          return {
            itemSnapshot,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('SUPPLY', connection, now)),
            hrRecipients: [...services.directory.roleMembers('hr')],
            managerApproverId:
              services.directory.managerOf(record.applicantId) ?? null,
          };
        },
      },
      managerApproved: {
        from: 'manager',
        to: 'issuing',
        approvalOutcome: 'approved',
        set: ({ record, now }) => ({
          approvedFingerprint: fingerprint(record),
          approvedAt: now.toISOString(),
        }),
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
      issued: {
        from: 'issuing',
        to: 'issued',
        approvalOutcome: 'issued',
        set: ({ actor }) => ({ issuedById: actor.id, forcedClosed: false }),
      },
      unavailable: {
        from: 'issuing',
        to: 'exception',
        approvalOutcome: 'unavailable',
      },
      forceClosed: {
        from: 'issuing',
        to: 'forcedClosed',
        approvalOutcome: 'forcedClosed',
        set: ({ actor }) => ({ issuedById: actor.id, forcedClosed: true }),
      },
      withdraw: {
        from: ['draft', 'revision', 'manager', 'exception'],
        to: 'withdrawn',
        guard: owner,
      },
      terminate: {
        from: ['revision', 'manager', 'issuing', 'exception'],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          !!input.reason.trim(),
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'supply.terminate',
              targetType: 'supplyRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          ),
      },
    },
    onEnterState: { issued: saveLedger, forcedClosed: saveLedger },
    onEnter: Object.fromEntries(
      [
        'issued',
        'forcedClosed',
        'exception',
        'rejected',
        'revision',
        'withdrawn',
        'terminated',
      ].map((state) => [
        state,
        [
          {
            name: `supply.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: SupplyRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: SUPPLY_LIFECYCLE,
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
      directory: await processDirectorySnapshot(d.directory, 'oa.supplies'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<SupplyRecord>('supplyRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new SupplyError(
        'SUPPLY_NOT_FOUND',
        'Supply request not found.',
        'notFound',
      );
    if (
      r.createdById === actorId ||
      r.applicantId === actorId ||
      outside.directory.hasRole(actorId, 'approval.admin') ||
      (await approvals.involvementOf(SUPPLY_LIFECYCLE, id, actorId)).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<SupplyRecord>('supplyRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return r;
    throw new SupplyError(
      'SUPPLY_ACCESS_DENIED',
      'This supply request is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<SupplyRecord>[]): SupplyRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'items',
      'purpose',
      'itemSnapshot',
      'approvedFingerprint',
      'approvedAt',
      'issuedById',
      'forcedClosed',
      'ruleSnapshot',
      'hrRecipients',
      'managerApproverId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new SupplyError(
        'SUPPLY_FIELDS_RESTRICTED',
        'This release requires all supply business fields for reading.',
        'permission',
      );
    return rows as SupplyRecord[];
  }
  async function enrich(records: SupplyRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.managerApproverId,
            r.issuedById,
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
      issuedBy: r.issuedById ? (users.get(r.issuedById) ?? null) : null,
      hrUsers: r.hrRecipients
        .map((id) => users.get(id))
        .filter((u) => u !== undefined),
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(SUPPLY_LIFECYCLE, id);
    for (const view of views) {
      if (view.run.status === 'manager') {
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
            kind: SUPPLY_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: SUPPLY_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    options: async () => ({
      timeZone: d.calendar.timeZone(),
      officeItems: await d.dictionaries.list('officeItem'),
    }),
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<SupplyRecord>('supplyRequests')
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
            SUPPLY_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            SUPPLY_LIFECYCLE,
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
      input: SupplyInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          SUPPLY_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            itemSnapshot: null,
            approvedFingerprint: null,
            approvedAt: null,
            issuedById: null,
            forcedClosed: false,
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
        runtime.fire(SUPPLY_LIFECYCLE, id, transition, {
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
      const views = await approvals.runViewsFor(SUPPLY_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new SupplyError(
          'SUPPLY_TARGET_MISMATCH',
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
      const views = await approvals.runViewsFor(SUPPLY_LIFECYCLE, id);
      if (!views.some((view) => view.tasks.some((task) => task.id === taskId)))
        throw new SupplyError(
          'SUPPLY_TARGET_MISMATCH',
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
        const runs = await approvals.runViewsFor(SUPPLY_LIFECYCLE, id);
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.managerApproverId,
              record.issuedById,
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
          view: await runtime.view(SUPPLY_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(SUPPLY_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(SUPPLY_LIFECYCLE, id, actor),
          runActions: await approvals.runActionsFor(
            SUPPLY_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            SUPPLY_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(SUPPLY_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<SupplyRecord>('supplyRequests');
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
        const selected: SupplyRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              SUPPLY_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, SUPPLY_LIFECYCLE, record.id)
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
                    await approvals.actionsFor(SUPPLY_LIFECYCLE, record.id, {
                      id: actorId,
                    })
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
    async ledger(
      query: {
        offset: number;
        limit: number;
        applicationId?: string;
        entryId?: string;
        sortBy?:
          | 'createdAt'
          | 'number'
          | 'itemCode'
          | 'requestedQuantity'
          | 'actualQuantity';
        direction?: 'asc' | 'desc';
      },
      policy: RepositoryPolicy,
    ) {
      const repository = d.db
        .repository<{
          id: string;
          applicationId: string;
          recipientId: string;
          issuerId: string;
          recipientName: string;
          issuerName: string;
          createdAt: string;
          number: string | null;
          itemCode: string;
          requestedQuantity: number;
          actualQuantity: number | null;
        }>('supplyIssueLedger')
        .withPolicy(policy);
      const filter = query.entryId
        ? {
            id: query.entryId,
            ...(query.applicationId
              ? { applicationId: query.applicationId }
              : {}),
          }
        : query.applicationId
          ? { applicationId: query.applicationId }
          : undefined;
      const sortBy = query.sortBy ?? 'createdAt';
      const [rows, total] = await Promise.all([
        repository.findMany({
          filter,
          sort: (s) => [
            query.direction === 'asc'
              ? s.field(sortBy).asc()
              : s.field(sortBy).desc(),
            s.field('id').asc(),
          ],
          offset: query.offset,
          limit: query.limit,
        }),
        repository.count({ filter }),
      ]);
      if (
        rows.some(
          (row) =>
            !row.recipientId ||
            !row.issuerId ||
            !row.id ||
            !row.applicationId ||
            !row.recipientName ||
            !row.issuerName,
        )
      )
        throw new SupplyError(
          'SUPPLY_FIELDS_RESTRICTED',
          'Ledger requires issuer, recipient and application identity.',
          'permission',
        );
      return {
        items: rows.map((row) => ({
          ...row,
          recipient: { id: row.recipientId, name: row.recipientName },
          issuer: { id: row.issuerId, name: row.issuerName },
        })),
        nextOffset:
          query.offset + query.limit < total
            ? query.offset + query.limit
            : null,
        meta: {
          total,
          page: Math.floor(query.offset / query.limit) + 1,
          pageSize: query.limit,
        },
      };
    },
    async maintenance() {
      await refresh();
      const sweep = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const held = await d.db
        .repository<SupplyRecord>('supplyRequests')
        .findMany({
          filter: (f) =>
            f.or(['manager', 'issuing'].map((s) => f.string('status').eq(s))),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type SupplyService = ReturnType<typeof createSupplyService>;
export const supplyServiceToken =
  createServiceToken<SupplyService>('oa/supply-service');
