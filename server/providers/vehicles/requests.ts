import {
  hasApprovalCandidate,
  createAppApprovalService,
} from '../approval-runtime/query-service.js';
import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import { reassignAction } from '../process-management/actions.js';
import { processDirectorySnapshot } from '../process-management/context.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import {
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  claimAction,
  releaseAction,
  commentAction,
  readAction,
  defaultAssignmentRules,
  excludeApplicant,
  freezeOf,
  hashOf,
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
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import type { EmployeeService } from '../employees/contract.js';
import type {
  ApprovalDirectoryService,
  OaApprovalDirectory,
} from '../approval-directory/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
  DictionaryService,
} from '../platform/index.js';
import type { AuditService } from '../audit/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import { createVehicleService } from './service.js';
import { VehicleError } from './errors.js';
import type { Vehicle, VehicleIntent } from './contract.js';
import {
  dispatchPolicy,
  usagePolicy,
  dispatchComplete,
  dispatchUnable,
  usageComplete,
} from './handling.js';
export const VEHICLE_LIFECYCLE = 'oa.vehicleRequest';
export interface VehicleRequest extends LifecycleRecord {
  id: string;
  applicantId: string;
  createdById: string;
  purpose: string;
  destination: string;
  startAt: string;
  endAt: string;
  passengers: number;
  needsDriver: boolean;
  number: string | null;
  approvedFingerprint: string | null;
  approvedAt: string | null;
  ruleSnapshot: JsonObject | null;
  managerApproverId: string | null;
  status: string;
  lifecycleVersion: number;
  createdAt: string;
}
export type VehicleRequestInput = Pick<
  VehicleRequest,
  'purpose' | 'destination' | 'startAt' | 'endAt' | 'passengers' | 'needsDriver'
>;
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
}
interface Types {
  record: VehicleRequest;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'dispatch'
    | 'exception'
    | 'usage'
    | 'completed'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface VehicleRequestDependencies {
  db: DatabaseManager;
  users: UserAdministrationService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  dictionaries: DictionaryService;
  audit: AuditService;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
}
export function createVehicleRequestService(d: VehicleRequestDependencies) {
  const fail = (code: string, message: string): never => {
    throw new VehicleError(code, message);
  };
  let outside: Services;
  const snapshots = new WeakMap<object, Services>();
  const writePolicy = new AsyncLocalStorage<RepositoryPolicy>();
  const readDirectory = new AsyncLocalStorage<OaApprovalDirectory>();
  const sourceCapability = new AsyncLocalStorage<{
    record: VehicleRequest;
    actorId: string;
    phase: 'dispatch' | 'usage';
    connection: DatabaseConnection;
  }>();
  const actionContext = new AsyncLocalStorage<{
    id: string;
    actorId: string;
    requestId: string;
    fingerprint: string;
    phase: 'dispatch' | 'usage';
    payload: JsonObject;
    depth: number;
    operation: string;
    reason: string | null;
  }>();
  const store = createAppLifecycleStore(d.db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  const digest = (r: VehicleRequest) =>
    hashOf(
      freezeOf(r, [
        'purpose',
        'destination',
        'startAt',
        'endAt',
        'passengers',
        'needsDriver',
      ]),
    );
  const vehicles = createVehicleService({
    audit: d.audit,
    dictionaries: d.dictionaries,
    employeeUserId: async (id, tx) => {
      const employee = await d.employees.getById(id, tx);
      if (!employee?.userId)
        throw new VehicleError(
          'VEHICLE_CUSTODY_EMPLOYEE_REQUIRED',
          'A real employee identity is required.',
        );
      return employee.userId;
    },
    lockCustody: async (applicantId, driverEmployeeId, tx) => {
      const driver = driverEmployeeId
        ? await d.employees.getById(driverEmployeeId, tx)
        : null;
      if (driverEmployeeId && !driver)
        throw new VehicleError(
          'VEHICLE_DRIVER_INACTIVE',
          'A real driver employee is required.',
        );
      const userIds = [
        ...new Set([applicantId, ...(driver ? [driver.userId] : [])]),
      ].sort();
      for (const userId of userIds) await lockUserForAdministration(tx, userId);
      for (const userId of userIds) {
        const employee = await d.employees.getByUserId(userId, tx);
        const user = await d.users.withConnection(tx).get(userId);
        if (
          !employee?.active ||
          employee.status === 'left' ||
          !user ||
          user.disabledAt
        )
          throw new VehicleError(
            'VEHICLE_CUSTODY_PERSON_INACTIVE',
            'Actual applicant and driver must remain active.',
          );
      }
    },
    activeDriver: async (id, tx) => {
      const e = await d.employees.getById(id, tx);
      const u = e && (await d.users.withConnection(tx).get(e.userId));
      return Boolean(e?.active && e.status !== 'left' && u && !u.disabledAt);
    },
    source: {
      async intent(id, actorId, phase, tx) {
        const c = sourceCapability.getStore();
        if (
          !c ||
          c.record.id !== id ||
          c.actorId !== actorId ||
          c.phase !== phase ||
          c.connection !== tx
        )
          throw new VehicleError(
            'VEHICLE_SOURCE_DENIED',
            'A real allowed approval operation in its transaction is required.',
          );
        return {
          sourceId: id,
          applicantId: c.record.applicantId,
          startAt: c.record.startAt,
          endAt: c.record.endAt,
          passengers: c.record.passengers,
          needsDriver: c.record.needsDriver,
        };
      },
    },
  });
  function wrap(base: LifecycleStore): LifecycleStore {
    return new Proxy(base, {
      get(target, key) {
        const policy = writePolicy.getStore();
        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'vehicleRequests')
              return target.createRecord(collection, values);
            const tx = target.transactionHandle as DatabaseConnection;
            const result = await tx
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (result.record.id === undefined)
              throw new VehicleError(
                'VEHICLE_FIELDS_RESTRICTED',
                'Created request identity must be readable.',
              );
            return result.record as LifecycleRecord;
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'vehicleRequests')
              return target.updateRecordIf(collection, id, condition, values);
            const tx = target.transactionHandle as DatabaseConnection;
            const result = await tx
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
          return async <T>(
            work: (s: LifecycleStore) => Promise<T>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) =>
            target.transaction(async (tx) => {
              const connection = tx.transactionHandle as DatabaseConnection;
              snapshots.set(connection, {
                directory:
                  readDirectory.getStore() ??
                  (await processDirectorySnapshot(
                    d.directory,
                    'oa.vehicleRequest',
                    connection,
                  )),
                connection,
              });
              let newCommand = false;
              const command = actionContext.getStore();
              if (command) command.depth++;
              try {
                if (command?.depth === 1) {
                  await activeActor(command.actorId, false, connection);
                  // Serialize on the real request before SDK request dedupe, including replayed keys with changed private inputs.
                  await connection.repository('vehicleRequests').updateMany({
                    filter: { id: command.id },
                    values: { id: command.id },
                  });
                  const id = createHash('sha256')
                    .update(JSON.stringify([command.id, command.requestId]))
                    .digest('hex');
                  const repo = connection.repository<{
                      id: string;
                      fingerprint: string;
                    }>('vehicleRequestCommands'),
                    old = await repo.findOne({ filter: { id } });
                  if (old && old.fingerprint !== command.fingerprint)
                    throw new VehicleError(
                      'VEHICLE_REQUEST_REUSED',
                      'The action key is bound to another actor, target or private payload.',
                    );
                  if (!old) {
                    await repo.createOne({
                      values: { id, fingerprint: command.fingerprint },
                    });
                    newCommand = true;
                  }
                }
                const result = await work(wrap(tx));
                if (
                  command?.depth === 1 &&
                  command.operation === 'reassign' &&
                  newCommand
                )
                  await d.audit.record(
                    {
                      actorId: command.actorId,
                      action: 'vehicle.reassign',
                      targetType: 'vehicleRequests',
                      targetId: command.id,
                      reason: command.reason,
                    },
                    connection,
                  );
                return result;
              } finally {
                if (command) command.depth--;
              }
            }, options);
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }
  const services = (handle: unknown): Services =>
    handle ? snapshots.get(handle)! : outside;
  const runtime = new LifecycleRuntime({
    store: wrap(store),
    dispatcher: d.dispatcher,
  });
  const stage = stagesFor<Types>();
  const owner = ({
    record,
    actor,
  }: {
    record: VehicleRequest;
    actor: { id: string };
  }) => record.applicantId === actor.id;
  const fields = [
    'purpose',
    'destination',
    'startAt',
    'endAt',
    'passengers',
    'needsDriver',
  ];
  async function validate(r: VehicleRequest, tx: DatabaseConnection) {
    const e = await d.employees.getByUserId(r.applicantId, tx);
    if (!e?.active || e.status === 'left')
      fail(
        'VEHICLE_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !r.purpose?.trim() ||
      r.purpose.length > 5000 ||
      !r.destination?.trim() ||
      r.destination.length > 5000 ||
      !Number.isSafeInteger(r.passengers) ||
      r.passengers < 1 ||
      !Number.isFinite(Date.parse(r.startAt)) ||
      !Number.isFinite(Date.parse(r.endAt)) ||
      Date.parse(r.startAt) >= Date.parse(r.endAt)
    )
      fail(
        'VEHICLE_INVALID_INPUT',
        'Provide purpose, destination, passenger count and ordered UTC interval.',
      );
    const candidates = await tx
      .repository<Vehicle>('vehicles')
      .findMany({ filter: { status: 'active' } });
    const uses = await tx
      .repository<VehicleIntent & { vehicleId: string }>('vehicleUses')
      .findMany();
    if (
      !candidates.some(
        (v) =>
          v.capacity >= r.passengers &&
          !uses.some(
            (u) =>
              u.vehicleId === v.id &&
              Date.parse(u.startAt) < Date.parse(r.endAt) &&
              Date.parse(u.endAt) > Date.parse(r.startAt),
          ),
      )
    )
      fail(
        'VEHICLE_NO_AVAILABLE_CAPACITY',
        'No current vehicle has sufficient capacity in this interval. Submission does not reserve it.',
      );
  }
  const approval = defineApproval<Types>({
    name: VEHICLE_LIFECYCLE,
    collection: 'vehicleRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: fields,
    adminRole: 'approval.admin',
    // SDK pre-screen assignment has stage='' so identify applicant usage by its public configured action as well.
    assignment: defaultAssignmentRules.map((rule) =>
      rule.name === excludeApplicant.name
        ? {
            name: rule.name,
            apply: (context) =>
              ['dispatch', 'usage'].includes(context.stage) ||
              context.definition.actions.some(
                (entry) =>
                  ('name' in entry ? entry.name : entry.action.name) ===
                  'registerUsage',
              )
                ? { kind: 'keep' as const }
                : rule.apply(context),
          }
        : rule,
    ),
    afterEnd: [readAction],
    notify: async ({ task, reason, services }) => {
      const r = await d.db
        .repository<VehicleRequest>('vehicleRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: r?.applicantId,
        kind: VEHICLE_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    states: [
      'draft',
      'revision',
      approvalState(
        'head',
        stage.single({
          assignee: ({ record, directory }) =>
            (directory as OaApprovalDirectory).headOf(record.applicantId),
          onEmpty: 'hold',
          actions: [
            approve(),
            reject({ reason: 'required' }),
            returnTo({ targets: ['revision'], reason: 'required' }),
            commentAction,
            reassignAction,
          ],
          remindAfterHours: 24,
          dueAfterHours: 48,
          onDue: 'escalate',
        }),
      ),
      approvalState(
        'dispatch',
        stage.custom(
          dispatchPolicy,
          {},
          {
            qualification: 'admin',
            onEmpty: 'hold',
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
              commentAction,
              dispatchComplete,
              dispatchUnable,
              reassignAction,
            ],
          },
        ),
      ),
      'exception',
      approvalState(
        'usage',
        stage.custom(
          usagePolicy,
          {},
          {
            assignees: ({ record }) => [record.applicantId],
            onEmpty: 'hold',
            actions: [usageComplete, commentAction],
          },
        ),
      ),
      ...(['completed', 'rejected', 'withdrawn', 'terminated'] as const).map(
        (name) => ({ name, final: true }),
      ),
    ],
    create: { guard: ({ values, actor }) => values.applicantId === actor.id },
    transitions: {
      edit: {
        from: ['draft', 'revision', 'exception'],
        to: ['draft', 'revision', 'exception'],
        guard: owner,
        accept: fields,
        route: ({ record }) =>
          record.status as 'draft' | 'revision' | 'exception',
      },
      submit: {
        from: ['draft', 'revision', 'exception'],
        to: ['head', 'dispatch'],
        guard: owner,
        route: ({ record }) =>
          record.status === 'exception' &&
          record.approvedFingerprint === digest(record)
            ? 'dispatch'
            : 'head',
        set: async ({ record, services, now }) => {
          const tx = services.connection!;
          await validate(record, tx);
          const snapshot = await d.rules.snapshot(
            ['sla.remindHours', 'sla.escalateHours', 'sla.urgeCooldownHours'],
            now,
            tx,
          );
          if (
            snapshot['sla.remindHours'] !== 24 ||
            snapshot['sla.escalateHours'] !== 48
          )
            fail(
              'VEHICLE_SLA_UNSUPPORTED',
              'This release requires the default working-hour approval clocks.',
            );
          return {
            ruleSnapshot: snapshot,
            number:
              record.number ?? (await d.sequences.next('VEHICLE', tx, now)),
            managerApproverId:
              services.directory.headOf(record.applicantId) ?? null,
          };
        },
      },
      headApproved: {
        from: 'head',
        to: 'dispatch',
        approvalOutcome: 'approved',
        set: ({ record, now }) => ({
          approvedFingerprint: digest(record),
          approvedAt: now.toISOString(),
        }),
      },
      rejected: { from: 'head', to: 'rejected', approvalOutcome: 'rejected' },
      returned: { from: 'head', to: 'revision', approvalOutcome: 'returned' },
      dispatched: {
        from: 'dispatch',
        to: 'usage',
        approvalOutcome: 'dispatched',
        onTransition: async ({ record, actor, tx }) => {
          const c = actionContext.getStore(),
            connection = tx.handle as DatabaseConnection;
          if (
            !c ||
            c.phase !== 'dispatch' ||
            c.id !== record.id ||
            record.approvedFingerprint !== digest(record)
          )
            fail(
              'VEHICLE_CONTENT_CHANGED',
              'Dispatch requires unchanged approved content and its private action payload.',
            );
          await sourceCapability.run(
            { record, actorId: actor.id, phase: 'dispatch', connection },
            () =>
              vehicles.dispatch(
                {
                  sourceId: record.id,
                  actorId: actor.id,
                  requestKey: c!.requestId,
                  reason: 'Approved vehicle dispatch',
                  vehicleId:
                    typeof c!.payload.vehicleId === 'string'
                      ? c!.payload.vehicleId
                      : fail(
                          'VEHICLE_INVALID_INPUT',
                          'Vehicle identity is required.',
                        ),
                  driverId:
                    c!.payload.driverId === null
                      ? null
                      : typeof c!.payload.driverId === 'string'
                        ? c!.payload.driverId
                        : fail(
                            'VEHICLE_INVALID_INPUT',
                            'Driver identity is required.',
                          ),
                },
                connection,
              ),
          );
        },
      },
      unavailable: {
        from: 'dispatch',
        to: 'exception',
        approvalOutcome: 'unavailable',
      },
      registered: {
        from: 'usage',
        to: 'completed',
        approvalOutcome: 'registered',
        onTransition: async ({ record, actor, tx }) => {
          const c = actionContext.getStore(),
            connection = tx.handle as DatabaseConnection;
          if (!c || c.phase !== 'usage' || c.id !== record.id)
            fail(
              'VEHICLE_PRIVATE_INPUT_REQUIRED',
              'Actual usage requires its guarded private input.',
            );
          await sourceCapability.run(
            { record, actorId: actor.id, phase: 'usage', connection },
            () =>
              vehicles.registerUsage(
                {
                  sourceId: record.id,
                  actorId: actor.id,
                  requestKey: c!.requestId,
                  reason: 'Actual vehicle use',
                  mileage: Number(c!.payload.mileage),
                  fuelCents: Number(c!.payload.fuelCents),
                  exception:
                    typeof c!.payload.exception === 'string'
                      ? c!.payload.exception
                      : '',
                },
                connection,
              ),
          );
        },
      },
      withdraw: {
        from: ['draft', 'revision', 'head', 'dispatch', 'exception'],
        to: 'withdrawn',
        guard: owner,
      },
      // Every termination path excludes usage: immutable dispatched facts cannot be erased or hidden.
      terminate: {
        from: ['revision', 'head', 'dispatch', 'exception'],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          Boolean(input.reason.trim()),
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'vehicle.terminate',
              targetType: 'vehicleRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          ),
      },
    },
    onEnter: Object.fromEntries(
      [
        'completed',
        'exception',
        'rejected',
        'revision',
        'withdrawn',
        'terminated',
      ].map((state) => [
        state,
        [
          {
            name: `vehicle.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: VehicleRequest;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: VEHICLE_LIFECYCLE,
              }),
          },
        ],
      ]),
    ),
  });
  runtime.register(approval, { services });
  const approvals = createAppApprovalService(
    runtime,
    [approval.approval as unknown as Approval<never>],
    services,
  );
  async function activeActor(
    actorId: string,
    requireEmployee = false,
    connection?: DatabaseConnection,
  ) {
    const [e, u] = await Promise.all([
      d.employees.getByUserId(actorId, connection),
      (connection ? d.users.withConnection(connection) : d.users).get(actorId),
    ]);
    if (
      (requireEmployee && !e) ||
      (e && (!e.active || e.status === 'left')) ||
      u?.kind !== 'person' ||
      u.disabledAt
    )
      fail(
        'VEHICLE_EMPLOYEE_INACTIVE',
        'An active person employee is required.',
      );
  }
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(
        d.directory,
        'oa.vehicleRequest',
      ),
    };
  }
  async function readable(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const repo = d.db.repository<VehicleRequest>('vehicleRequests');
    const r = await (policy ? repo.withPolicy(policy) : repo).findOne({
      filter: { id },
    });
    if (!r)
      throw new VehicleError(
        'VEHICLE_NOT_FOUND',
        'Request not found in the readable policy.',
      );
    if (
      [
        'id',
        'applicantId',
        'createdById',
        'purpose',
        'destination',
        'startAt',
        'endAt',
        'passengers',
        'needsDriver',
        'number',
        'approvedFingerprint',
        'approvedAt',
        'ruleSnapshot',
        'managerApproverId',
        'status',
        'lifecycleVersion',
        'createdAt',
      ].some((field) => !(field in r))
    )
      throw new VehicleError(
        'VEHICLE_FIELDS_RESTRICTED',
        'Complete nonfinancial request fields are required for the approval facade.',
      );
    if (
      !policy &&
      r.applicantId !== actorId &&
      !outside.directory.hasRole(actorId, 'approval.admin') &&
      !(await approvals.involvementOf(VEHICLE_LIFECYCLE, id, actorId)).length
    )
      throw new VehicleError(
        'VEHICLE_ACCESS_DENIED',
        'This request is not accessible.',
      );
    return r;
  }
  return {
    runtime,
    approvals,
    async involvementForScope(id: string, actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, () =>
        approvals.involvementOf(VEHICLE_LIFECYCLE, id, actorId),
      );
    },
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    vehicles,
    initialize: refresh,
    async create(
      input: VehicleRequestInput,
      actorId: string,
      policy?: RepositoryPolicy,
      requestId?: string,
    ) {
      await activeActor(actorId, true);
      await refresh();
      const create = () =>
        runtime.create(
          VEHICLE_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId: actorId,
            createdById: actorId,
            number: null,
            approvedFingerprint: null,
            approvedAt: null,
            ruleSnapshot: null,
            managerApproverId: null,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: actorId } },
        );
      if (!requestId)
        return policy ? writePolicy.run(policy, create) : create();
      return d.db.transaction(async (tx) => {
        await lockUserForAdministration(tx, actorId);
        await activeActor(actorId, true, tx);
        const id = createHash('sha256')
            .update(JSON.stringify(['request-create', actorId, requestId]))
            .digest('hex'),
          fingerprint = createHash('sha256')
            .update(JSON.stringify([actorId, input]))
            .digest('hex'),
          repo = tx.repository<{
            id: string;
            fingerprint: string;
            receipt: JsonObject;
            createdAt: string;
          }>('vehicleCommands'),
          old = await repo.findOne({ filter: { id } });
        if (old) {
          if (old.fingerprint !== fingerprint)
            fail(
              'VEHICLE_REQUEST_REUSED',
              'Creation key is bound to its original payload.',
            );
          const saved = old.receipt as unknown as Awaited<
              ReturnType<typeof create>
            >,
            visible = await tx
              .repository('vehicleRequests')
              .withPolicy(
                policy ?? {
                  read: true,
                  create: true,
                  update: true,
                  delete: false,
                },
              )
              .findOne({ filter: { id: String(saved.record.id) } });
          if (
            !visible ||
            Object.keys(saved.record).some((k) => !(k in visible))
          )
            fail(
              'VEHICLE_FIELDS_RESTRICTED',
              'Replayed creation must remain readable.',
            );
          return { ...saved, replayed: true };
        }
        const initial = {
          id: randomUUID(),
          ...input,
          applicantId: actorId,
          createdById: actorId,
          number: null,
          approvedFingerprint: null,
          approvedAt: null,
          ruleSnapshot: null,
          managerApproverId: null,
          createdAt: new Date().toISOString(),
        };
        const createInTx = () =>
          runtime.create(VEHICLE_LIFECYCLE, initial, {
            actor: { id: actorId },
            transaction: tx,
          });
        const result = await (policy
          ? writePolicy.run(policy, createInTx)
          : createInTx());
        await repo.createOne({
          values: {
            id,
            fingerprint,
            receipt: JSON.parse(JSON.stringify(result)) as JsonObject,
            createdAt: new Date().toISOString(),
          },
        });
        return result;
      });
    },
    async transition(
      id: string,
      name: string,
      actorId: string,
      version: number,
      requestId: string,
      input: JsonObject = {},
      policy?: RepositoryPolicy,
      mutationPolicy?: RepositoryPolicy,
    ) {
      await activeActor(actorId);
      await readable(id, actorId, policy);
      const fire = () =>
        runtime.fire(VEHICLE_LIFECYCLE, id, name, {
          manual: true,
          actor: { id: actorId },
          expect: { version },
          requestId,
          input,
        });
      return actionContext.run(
        {
          id,
          actorId,
          requestId,
          fingerprint: createHash('sha256')
            .update(JSON.stringify([actorId, name, version, input]))
            .digest('hex'),
          phase: 'dispatch',
          payload: {},
          depth: 0,
          operation: name,
          reason: typeof input.reason === 'string' ? input.reason : null,
        },
        () => (mutationPolicy ? writePolicy.run(mutationPolicy, fire) : fire()),
      );
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      privateInput: JsonObject = {},
      policy?: RepositoryPolicy,
    ) {
      await activeActor(actorId);
      const r = await readable(id, actorId, policy);
      const views = await approvals.runViewsFor(VEHICLE_LIFECYCLE, id);
      if (
        !views.some((v) =>
          'runId' in input.target
            ? v.run.id === input.target.runId
            : v.tasks.some(
                (t) =>
                  t.id ===
                  ('taskId' in input.target ? input.target.taskId : undefined),
              ),
        )
      )
        throw new VehicleError(
          'VEHICLE_TARGET_MISMATCH',
          'The action target belongs to another request.',
        );
      if (
        Object.keys(input.input ?? {}).some((k) =>
          ['fuelCents', 'mileage', 'vehicleId', 'driverId'].includes(k),
        )
      )
        fail(
          'VEHICLE_PRIVATE_INPUT_REQUIRED',
          'Business execution payloads must use the private facade.',
        );
      const phase = r.status === 'usage' ? 'usage' : 'dispatch';
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([actorId, input, privateInput]))
        .digest('hex');
      return actionContext.run(
        {
          id,
          actorId,
          requestId:
            input.requestId ??
            fail(
              'VEHICLE_REQUEST_KEY_REQUIRED',
              'A stable request key is required.',
            ),
          fingerprint,
          phase,
          payload: privateInput,
          depth: 0,
          operation: input.action,
          reason: input.comment ?? null,
        },
        () => approvals.perform({ ...input, actor: { id: actorId } }),
      );
    },
    async listForCenter(
      actorId: string,
      view: 'mine' | 'pending' | 'done' | 'copied',
      policy: RepositoryPolicy,
    ) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const rows = await d.db
          .repository<VehicleRequest>('vehicleRequests')
          .withPolicy(policy)
          .findMany({ sort: (s) => s.field('createdAt').desc() });
        const selected = [];
        for (const row of rows) {
          if (typeof row.id !== 'string')
            fail('VEHICLE_FIELDS_RESTRICTED', 'Request identity is required.');
          // The owner facade checks the complete current ordinary field policy before SDK reads.
          const record = await readable(row.id!, actorId, policy);
          if (
            view === 'pending' &&
            rows.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              VEHICLE_LIFECYCLE,
              row.id,
              actorId,
            ))
          )
            continue;
          if (view === 'mine' && record.applicantId !== actorId) continue;
          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, VEHICLE_LIFECYCLE, row.id!)
              : [];
          const tasks = runs.flatMap((run) => run.tasks);
          const matches =
            view === 'mine' ||
            (view === 'done'
              ? tasks.some(
                  (task) =>
                    task.actorId === actorId &&
                    ['completed', 'transferred'].includes(task.status),
                )
              : view === 'copied'
                ? tasks.some(
                    (task) =>
                      task.kind === 'copy' && task.assigneeId === actorId,
                  )
                : (
                    await approvals.actionsFor(VEHICLE_LIFECYCLE, row.id!, {
                      id: actorId,
                    })
                  ).some((offer) =>
                    offer.actions.some((action) =>
                      [
                        'approve',
                        'reject',
                        'return',
                        'claim',
                        'release',
                        'complete',
                        'unable',
                        'registerUsage',
                      ].includes(action.name),
                    ),
                  ));
          if (!matches) continue;
          const user =
            typeof record.applicantId === 'string'
              ? await d.users.get(record.applicantId)
              : undefined;
          selected.push({
            ...record,
            applicant: user ? { id: user.id, name: user.name } : null,
          });
        }
        return selected;
      });
    },
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await readable(id, actorId, policy);
      return readDirectory.run(outside.directory, async () => ({
        record,
        users: (
          await Promise.all(
            [record.applicantId, record.managerApproverId]
              .filter((v): v is string => Boolean(v))
              .map((id) => d.users.get(id)),
          )
        )
          .filter((u) => u !== undefined)
          .map((u) => ({ id: u.id, name: u.name })),
        timeZone: d.calendar.timeZone(),
        view: await runtime.view(VEHICLE_LIFECYCLE, id, { id: actorId }),
        runs: await approvals.runViewsFor(VEHICLE_LIFECYCLE, id),
        taskActions: await approvals.actionsFor(VEHICLE_LIFECYCLE, id, {
          id: actorId,
        }),
        runActions: await approvals.runActionsFor(VEHICLE_LIFECYCLE, id, {
          id: actorId,
        }),
        timeline: await approvals.timelineFor(VEHICLE_LIFECYCLE, id),
      }));
    },
    async dispatchCandidates(
      id: string,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      await readable(id, actorId, policy);
      return wrap(store).transaction(async (child) => {
        const tx = child.transactionHandle as DatabaseConnection;
        await tx
          .repository('vehicleRequests')
          .updateMany({ filter: { id }, values: { id } });
        const record = await tx
          .repository<VehicleRequest>('vehicleRequests')
          .findOne({ filter: { id } });
        const reader = new LifecycleRuntime({ store: child });
        reader.register(approval, { services });
        const readerApprovals = createAppApprovalService(
          reader,
          [approval.approval as unknown as Approval<never>],
          services,
        );
        const offers = await readerApprovals.actionsFor(VEHICLE_LIFECYCLE, id, {
          id: actorId,
        });
        if (
          !record ||
          record.status !== 'dispatch' ||
          !offers.some((o) => o.actions.some((a) => a.name === 'complete'))
        )
          throw new VehicleError(
            'VEHICLE_DISPATCH_NOT_OFFERED',
            'An actual allowed dispatch task is required.',
          );
        return sourceCapability.run(
          { record, actorId, phase: 'dispatch', connection: tx },
          () => vehicles.candidates(id, actorId, tx),
        );
      });
    },
    async maintenance(now = new Date()) {
      await refresh();
      const result = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const bucket = d.calendar.localDate(now);
      if (!d.calendar.isWorkday(bucket)) return result;
      const records = await d.db
        .repository<VehicleRequest>('vehicleRequests')
        .findMany({ filter: { status: 'usage' } });
      for (const record of records) {
        const end = new Date(record.endAt);
        const localTime = new Intl.DateTimeFormat('en-GB', {
          timeZone: d.calendar.timeZone(),
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(end);
        const due = d.calendar.resolveLocalDateTime(
          d.calendar.addWorkdays(d.calendar.localDate(end), 2),
          localTime,
        );
        due.setTime(
          due.getTime() + end.getUTCSeconds() * 1000 + end.getUTCMilliseconds(),
        );
        if (now <= due) continue;
        const id = createHash('sha256')
          .update(JSON.stringify([record.id, bucket]))
          .digest('hex');
        const receipt = await d.db
          .repository<{ id: string; status: string }>('vehicleUsageReminders')
          .findOne({ filter: { id } });
        if (receipt?.status === 'sent') continue;
        if (!receipt)
          await d.db.transaction(async (tx) => {
            await tx.repository('vehicleRequests').updateMany({
              filter: { id: record.id },
              values: { id: record.id },
            });
            if (
              !(await tx
                .repository('vehicleUsageReminders')
                .exists({ filter: { id } }))
            )
              await tx.repository('vehicleUsageReminders').createOne({
                values: {
                  id,
                  sourceId: record.id,
                  bucket,
                  status: 'pending',
                },
              });
          });
        if (
          !(await d.db
            .repository('vehicleRequests')
            .exists({ filter: { id: record.id, status: 'usage' } }))
        )
          continue;
        // Public notification event ID is stable across failures and concurrent sweep retries.
        await d.notifications.alarm({
          kind: VEHICLE_LIFECYCLE,
          recordId: record.id,
          recipients: [record.applicantId],
          eventId: `vehicle-usage:${id}`,
          reason: 'vehicleUsageOverdue',
        });
        await d.db
          .repository('vehicleUsageReminders')
          .updateMany({ filter: { id }, values: { status: 'sent' } });
      }
      return result;
    },
  };
}
export type VehicleRequestService = ReturnType<
  typeof createVehicleRequestService
>;
