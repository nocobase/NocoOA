import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import { createServiceToken } from '@nocobase/service-provider';
import {
  LifecycleRuntime,
  type LifecycleStore,
  type EffectDispatcher,
  type JsonObject,
} from '@nocobase/lifecycle';
import {
  ApprovalService,
  type Approval,
  type PerformInput,
} from '@nocobase/app-plugin-approval/server';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { EmployeeService } from '../employees/contract.js';
import type { OrganizationService } from '../org/service.js';
import type { HeadcountService } from '../headcounts/contract.js';
import type { SalaryGradeService } from '../job-grades/contract.js';
import type { CalendarService, RuleService } from '../platform/index.js';
import type { AuditService } from '../audit/index.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import {
  createTransferApproval,
  TRANSFER_LIFECYCLE,
  type TransferRecord,
  type TransferApprovalServices,
} from './approval.js';
import {
  transferPreparation,
  TransferError,
  type TransferProposal,
  type TransferSnapshot,
  type TransferSalarySnapshot,
} from './submission.js';
import { salaryCents } from './salary.js';
import { transferExecutor } from './execution.js';
export interface TransferDependencies {
  db: DatabaseManager;
  employees: EmployeeService;
  org: OrganizationService;
  headcounts: HeadcountService;
  grades: SalaryGradeService;
  calendar: CalendarService;
  rules: RuleService;
  audit: AuditService;
  directory: ApprovalDirectoryService;
  users: UserAdministrationService;
  dispatcher?: EffectDispatcher;
  notifications: ApprovalNotificationService;
}
export interface TransferInput extends TransferProposal {
  sourceAccountId: string | null;
  targetAccountId: string | null;
  reason: string;
}
export interface TransferCommand {
  actorId: string;
  requestKey: string;
  reason: string;
}
export type TransferCenterView = 'pending' | 'done' | 'copied' | 'mine';
export interface TransferCenterItem {
  id: string;
  kind: 'oa.transfer';
  title?: string;
  number: null;
  applicantId: string;
  applicant: { id: string; name: string } | null;
  status: string;
  createdAt: string;
  startDate: string;
  endDate: null;
  amount: null;
  unit: null;
}
export interface TransferPolicies {
  view: RepositoryPolicy;
  write: RepositoryPolicy;
  salary?: RepositoryPolicy;
}
export const TRANSFER_FIELDS = [
  'id',
  'applicantId',
  'employeeId',
  'kinds',
  'targetDepartmentId',
  'targetPositionId',
  'targetGradeId',
  'targetManagerId',
  'sourceAccountId',
  'targetAccountId',
  'effectiveDate',
  'reason',
  'privateSalaryRevisionId',
  'snapshot',
  'cancelConfirmerId',
  'cancellationReason',
  'executionFailureCode',
  'status',
  'lifecycleVersion',
  'statusChangedAt',
  'createdAt',
] as const;
function refuse(reason: string): never {
  throw new TransferError(reason);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function transferEditableFields(status: string): string[] {
  return status === 'targetHead'
    ? ['targetPositionId', 'effectiveDate']
    : ['executive', 'gm'].includes(status)
      ? ['targetGradeId', 'targetSalary']
      : status === 'hr'
        ? [
            'kinds',
            'targetDepartmentId',
            'targetPositionId',
            'targetGradeId',
            'targetManagerId',
            'targetSalary',
            'sourceAccountId',
            'targetAccountId',
            'effectiveDate',
            'reason',
          ]
        : ['manager', 'sourceHead'].includes(status)
          ? [
              'kinds',
              'targetDepartmentId',
              'targetPositionId',
              'targetGradeId',
              'targetManagerId',
              'sourceAccountId',
              'targetAccountId',
              'effectiveDate',
              'reason',
            ]
          : [];
}
export function createTransferService(d: TransferDependencies) {
  const context = new AsyncLocalStorage<{
    tx: DatabaseConnection;
    policies?: TransferPolicies;
    prepared?: TransferSnapshot;
    preparedSalaryRevisionId?: string;
    mutation?: boolean;
    reviewEditor?: string;
  }>();
  const directories = new WeakMap<object, TransferApprovalServices>();
  let outside: TransferApprovalServices;
  const readDirectory = new AsyncLocalStorage<
    TransferApprovalServices['directory']
  >();
  const prepare = transferPreparation(d),
    execute = transferExecutor({ ...d, organization: d.org });
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
          return async <T>(
            work: (child: LifecycleStore) => Promise<T>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) => {
            const within = options?.within ?? context.getStore()?.tx;
            const join = (tx: unknown) =>
              target.transaction(
                async (child) => {
                  const handle = child.transactionHandle as DatabaseConnection;
                  directories.set(handle, {
                    connection: handle,
                    directory:
                      readDirectory.getStore() ??
                      (await d.directory.snapshot(handle)),
                    prepared: context.getStore()?.prepared,
                    preparedSalaryRevisionId:
                      context.getStore()?.preparedSalaryRevisionId,
                  });
                  return work(wrap(child));
                },
                { ...options, within: tx },
              );
            return within
              ? join(within)
              : readDirectory.getStore()
                ? join(undefined)
                : d.headcounts.within(d.db.connection(), join);
          };
        if (key === 'createRecord' && context.getStore()?.policies)
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'transferRequests')
              return target.createRecord(collection, values);
            const row = await (target.transactionHandle as DatabaseConnection)
              .repository(collection)
              .withPolicy(context.getStore()!.policies!.write)
              .createOne({ values: values as RepositoryRecord });
            return row.record;
          };
        if (
          key === 'updateRecordIf' &&
          context.getStore()?.mutation &&
          context.getStore()?.policies
        )
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'transferRequests')
              return target.updateRecordIf(collection, id, condition, values);
            const result = await (
              target.transactionHandle as DatabaseConnection
            )
              .repository(collection)
              .withPolicy(context.getStore()!.policies!.write)
              .updateMany({
                filter: {
                  id,
                  [condition.stateField]: condition.state,
                  [condition.versionField]: condition.version,
                },
                values: values as RepositoryRecord,
              });
            return result.updatedCount === 1;
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (value as (...a: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }
  async function refresh() {
    outside = {
      connection: d.db.connection(),
      directory: await d.directory.snapshot(),
    };
  }
  async function active(actorId: string, tx: DatabaseConnection) {
    const employee = await d.employees.getByUserId(actorId, tx),
      user = await d.users.withConnection(tx).get(actorId);
    if (
      !employee?.active ||
      !['probation', 'regular'].includes(employee.status) ||
      !user ||
      user.disabledAt
    )
      refuse('TRANSFER_ACTOR_UNAVAILABLE');
  }
  async function read(
    id: string,
    policy: RepositoryPolicy,
    tx: DatabaseConnection = d.db.connection(),
  ): Promise<TransferRecord> {
    if (policy.read === false) refuse('TRANSFER_FORBIDDEN');
    const row = await tx
      .repository<TransferRecord>('transferRequests')
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (!row || TRANSFER_FIELDS.some((field) => !(field in row)))
      refuse('TRANSFER_FORBIDDEN');
    return row as TransferRecord;
  }
  function safe(record: TransferRecord): TransferRecord {
    return Object.fromEntries(
      TRANSFER_FIELDS.map((field) => [field, record[field]]),
    ) as unknown as TransferRecord;
  }
  async function privateSalary(
    record: TransferRecord,
    tx: DatabaseConnection,
  ): Promise<TransferSalarySnapshot> {
    const row = await tx
      .repository<{
        id: string;
        requestId: string;
        currentCents: number | string;
        targetCents: number | string;
        currentCompensationId: string;
        band: TransferSalarySnapshot['band'];
      }>('transferSalaryRevisions')
      .findOne({
        filter: { id: record.privateSalaryRevisionId, requestId: record.id },
      });
    if (!row || !row.band || !row.currentCompensationId)
      refuse('TRANSFER_SALARY_UNAVAILABLE');
    return {
      currentCents: Number(row.currentCents),
      targetCents: Number(row.targetCents),
      currentCompensationId: row.currentCompensationId,
      band: row.band,
    };
  }
  async function salaryRevision(
    id: string,
    targetCents: number,
    actorId: string,
    tx: DatabaseConnection,
    prepared?: TransferSalarySnapshot,
  ) {
    const rows = await tx.repository('transferSalaryRevisions').findMany({
      filter: { requestId: id },
      sort: (s) => [s.field('version').desc()],
      limit: 1,
    });
    const revisionId = randomUUID();
    await tx.repository('transferSalaryRevisions').createOne({
      values: {
        id: revisionId,
        requestId: id,
        version: Number(rows[0]?.version ?? 0) + 1,
        targetCents,
        currentCents: prepared?.currentCents ?? null,
        currentCompensationId: prepared?.currentCompensationId ?? null,
        band: prepared ? { ...prepared.band } : null,
        gradeRevisionId: prepared?.band.revisionId ?? null,
        gradeTableVersion: prepared?.band.tableVersion ?? null,
        createdById: actorId,
        createdAt: new Date(),
      },
    });
    return revisionId;
  }
  async function rawTarget(record: TransferRecord, tx: DatabaseConnection) {
    const row = await tx.repository('transferSalaryRevisions').findOne({
      filter: { id: record.privateSalaryRevisionId, requestId: record.id },
    });
    if (!row) refuse('TRANSFER_SALARY_UNAVAILABLE');
    const cents = Number(row.targetCents);
    if (!Number.isSafeInteger(cents) || cents < 0)
      refuse('TRANSFER_SALARY_UNAVAILABLE');
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  }
  async function prepareRecord(
    record: TransferRecord,
    actorId: string,
    tx: DatabaseConnection,
    frozen?: TransferSnapshot,
  ) {
    const proposed = await prepare(
      { ...record, targetSalary: await rawTarget(record, tx) },
      record.applicantId,
      new Date(),
      tx,
      frozen ?? undefined,
    );
    if (
      record.snapshot &&
      (record.snapshot.sourcePositionId !==
        proposed.snapshot.sourcePositionId ||
        record.snapshot.sourceDepartmentId !==
          proposed.snapshot.sourceDepartmentId ||
        record.snapshot.sourceGradeId !== proposed.snapshot.sourceGradeId ||
        record.snapshot.sourceManagerId !== proposed.snapshot.sourceManagerId)
    )
      refuse('TRANSFER_SOURCE_CHANGED');
    if (proposed.snapshot.capacityChanges) {
      if (!record.sourceAccountId || !record.targetAccountId)
        refuse('TRANSFER_ACCOUNT_UNAVAILABLE');
      const sourceAccount = await d.headcounts.balance(
          record.sourceAccountId,
          tx,
        ),
        target = await d.headcounts.balance(record.targetAccountId, tx);
      const year = Number(record.effectiveDate.slice(0, 4));
      if (
        !sourceAccount ||
        !target ||
        sourceAccount.departmentId !== proposed.snapshot.sourceDepartmentId ||
        sourceAccount.positionId !== proposed.snapshot.sourcePositionId ||
        target.departmentId !== record.targetDepartmentId ||
        target.positionId !== record.targetPositionId ||
        target.year !== year ||
        sourceAccount.year !== year
      )
        refuse('TRANSFER_ACCOUNT_UNAVAILABLE');
      const command = {
        actorId,
        requestKey: `hold:${record.id}:${record.lifecycleVersion}:${record.privateSalaryRevisionId}`,
        reason: record.reason,
        sourceKind: TRANSFER_LIFECYCLE,
        sourceId: record.id,
        accountId: target.id,
        quantity: 1,
      };
      if (await d.headcounts.reservation(command, tx))
        await d.headcounts.reviseHold(command, tx);
      else await d.headcounts.hold(command, tx);
    } else if (
      await d.headcounts.reservation(
        { sourceKind: TRANSFER_LIFECYCLE, sourceId: record.id },
        tx,
      )
    )
      await d.headcounts.close(
        {
          sourceKind: TRANSFER_LIFECYCLE,
          sourceId: record.id,
          actorId,
          requestKey: `close-revision:${record.id}:${record.lifecycleVersion}`,
          reason: 'Capacity key no longer changes',
        },
        tx,
      );
    const revision = await salaryRevision(
      record.id,
      proposed.salary.targetCents,
      actorId,
      tx,
      proposed.salary,
    );
    return { ...proposed, revision };
  }
  const hooks = {
    calendar: () => d.calendar.approvalCalendar(),
    operations: createOaApprovalOperations(d),
    notify: async (
      task: import('@nocobase/app-plugin-approval/server').TaskRow,
      reason: string,
      services: TransferApprovalServices,
    ) => {
      const record = await d.db
        .repository<TransferRecord>('transferRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: TRANSFER_LIFECYCLE,
      });
    },
    result: (input: {
      recordId: string;
      applicantId: string;
      state: string;
      transitionId: string;
    }) => d.notifications.result({ ...input, kind: TRANSFER_LIFECYCLE }),
    authorizeCreate: async () => !!context.getStore()?.policies,
    authorizeEdit: async () => !!context.getStore()?.policies,
    authorizeReviewEdit: async (_record: TransferRecord, actorId: string) =>
      context.getStore()?.reviewEditor === actorId,
    checkpoint: async (
      record: TransferRecord,
      _actorId: string,
      tx: DatabaseConnection,
    ) => {
      if (!record.snapshot) refuse('TRANSFER_SNAPSHOT_UNAVAILABLE');
      const salary = await privateSalary(record, tx);
      const fresh = await prepare(
        {
          ...record,
          targetSalary: `${Math.floor(salary.targetCents / 100)}.${String(salary.targetCents % 100).padStart(2, '0')}`,
        },
        record.applicantId,
        new Date(),
        tx,
        record.snapshot,
      );
      if (digest(fresh.snapshot) !== digest(record.snapshot))
        refuse('TRANSFER_SNAPSHOT_CHANGED');
      if (fresh.snapshot.capacityChanges) {
        const reservation = await d.headcounts.reservation(
          { sourceKind: TRANSFER_LIFECYCLE, sourceId: record.id },
          tx,
        );
        if (!reservation || reservation.blocked || reservation.remaining !== 1)
          refuse('TRANSFER_ALLOCATION_UNAVAILABLE');
      }
    },
    allocate: async (
      record: TransferRecord,
      actorId: string,
      tx: DatabaseConnection,
    ) => {
      if (record.snapshot?.capacityChanges)
        await d.headcounts.allocate(
          {
            sourceKind: TRANSFER_LIFECYCLE,
            sourceId: record.id,
            actorId,
            requestKey: `allocate:${record.id}`,
            reason: record.reason,
          },
          tx,
        );
    },
    release: async (
      record: TransferRecord,
      actorId: string,
      tx: DatabaseConnection,
    ) => {
      if (
        await d.headcounts.reservation(
          { sourceKind: TRANSFER_LIFECYCLE, sourceId: record.id },
          tx,
        )
      )
        await d.headcounts.close(
          {
            sourceKind: TRANSFER_LIFECYCLE,
            sourceId: record.id,
            actorId,
            requestKey: `release:${record.id}:${record.lifecycleVersion}`,
            reason: 'Personnel change ended',
          },
          tx,
        );
    },
    execute: async (record: TransferRecord, tx: DatabaseConnection) => {
      if (!record.snapshot) refuse('TRANSFER_SNAPSHOT_UNAVAILABLE');
      await execute(
        {
          id: record.id,
          actorId: record.applicantId,
          effectiveDate: record.effectiveDate,
          sourceAccountId: record.sourceAccountId,
          snapshot: record.snapshot,
          salary: await privateSalary(record, tx),
          now: new Date(),
        },
        tx,
      );
    },
    cancellationConfirmer: async (
      _record: TransferRecord,
      actorId: string,
      tx: DatabaseConnection,
    ) => {
      const ids = await d.org.dutyRoleMembers('hr', tx);
      for (const id of ids)
        if (id !== actorId) {
          const employee = await d.employees.getByUserId(id, tx),
            user = await d.users.withConnection(tx).get(id);
          if (
            employee?.active &&
            ['probation', 'regular'].includes(employee.status) &&
            user &&
            !user.disabledAt
          )
            return id;
        }
      return refuse('TRANSFER_CANCELLATION_CONFIRMER_UNAVAILABLE');
    },
    authorizeCancellation: async (
      record: TransferRecord,
      actorId: string,
      tx: DatabaseConnection,
    ) =>
      record.status === 'pendingEffective'
        ? record.applicantId === actorId
        : // The SDK verifies ownership of the current single-person task, including reassignment.
          // The originally selected confirmer is an immutable origin fact, not a second task owner.
          record.applicantId !== actorId &&
          (await d.org.hasDutyRole(actorId, 'hr', tx)),
  };
  const definition = createTransferApproval(hooks),
    runtime = new LifecycleRuntime({
      store: wrap(base),
      dispatcher: d.dispatcher,
    });
  const source = (handle: unknown) =>
    handle ? directories.get(handle)! : outside;
  runtime.register(definition, { services: source });
  const approvals = new ApprovalService(
    runtime,
    [definition.approval as unknown as Approval<never>],
    source,
  );
  async function durable(
    kind: string,
    id: string | undefined,
    payload: unknown,
    command: TransferCommand,
    policies: TransferPolicies,
    work: (tx: DatabaseConnection) => Promise<TransferRecord>,
  ) {
    if (!command.actorId || !command.requestKey || !command.reason.trim())
      refuse('TRANSFER_INVALID_COMMAND');
    await refresh();
    return d.db.transaction((tx) =>
      d.headcounts.within(tx, (locked) =>
        context.run(
          { tx: locked, policies, mutation: kind !== 'action' },
          async () => {
            await active(command.actorId, locked);
            if (
              kind === 'create'
                ? !policies.write.create
                : kind !== 'action' && !policies.write.update
            )
              refuse('TRANSFER_FORBIDDEN');
            if (id) {
              await read(id, policies.view, locked);
              await read(id, policies.write, locked);
            }
            const key = digest([command.actorId, command.requestKey]),
              fingerprint = digest([
                kind,
                id,
                payload,
                command.actorId,
                command.reason,
              ]);
            const repo = locked.repository('transferCommands'),
              old = await repo.findOne({ filter: { id: key } });
            if (old) {
              if (old.fingerprint !== fingerprint)
                refuse('TRANSFER_IDEMPOTENCY_CONFLICT');
              const result = old.result as unknown as TransferRecord;
              await read(result.id, policies.view, locked);
              await read(result.id, policies.write, locked);
              if (['create', 'edit', 'submit'].includes(kind)) {
                const subject = await d.employees.getById(
                  result.employeeId,
                  locked,
                );
                const manager = subject
                  ? await d.employees.managerOf(subject.userId, locked)
                  : undefined;
                if (
                  manager?.userId !== command.actorId &&
                  !(await d.org.hasDutyRole(command.actorId, 'hr', locked))
                )
                  refuse('TRANSFER_FORBIDDEN');
              }
              if (
                kind === 'rebind' &&
                !(await d.org.hasDutyRole(command.actorId, 'hr', locked))
              )
                refuse('TRANSFER_FORBIDDEN');
              if (
                kind === 'reviewEdit' &&
                'targetSalary' in (payload as { patch: object }).patch
              ) {
                if (!policies.salary) refuse('TRANSFER_FORBIDDEN');
                await read(result.id, policies.salary, locked);
              }
              if (kind === 'reviewEdit' || kind === 'action') {
                const offers = await approvals.actionsFor(
                  TRANSFER_LIFECYCLE,
                  result.id,
                  { id: command.actorId },
                );
                const requested =
                  kind === 'reviewEdit'
                    ? 'approve'
                    : (payload as { action?: string }).action;
                if (
                  !offers.some((offer) =>
                    offer.actions.some((action) => action.name === requested),
                  )
                )
                  refuse('TRANSFER_FORBIDDEN');
              }
              return result;
            }
            const result = safe(await work(locked));
            await read(result.id, policies.view, locked);
            await repo.createOne({
              values: {
                id: key,
                requestId: result.id,
                actorId: command.actorId,
                action: kind,
                fingerprint,
                result: result as unknown as JsonObject,
                createdAt: new Date(),
              },
            });
            return result;
          },
        ),
      ),
    );
  }
  return {
    runtime,
    approvals,
    approvalDefinition:
      definition.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    initialize: refresh,
    create: (
      input: TransferInput,
      command: TransferCommand,
      policies: TransferPolicies,
    ) =>
      durable('create', undefined, input, command, policies, async (tx) => {
        await prepare(input, command.actorId, new Date(), tx);
        const id = randomUUID(),
          { targetSalary, ...values } = input;
        const privateSalaryRevisionId = await salaryRevision(
          id,
          salaryCents(targetSalary),
          command.actorId,
          tx,
        );
        const result = await runtime.create(
          TRANSFER_LIFECYCLE,
          {
            ...values,
            id,
            applicantId: command.actorId,
            privateSalaryRevisionId,
            snapshot: null,
            cancelConfirmerId: null,
            cancellationReason: null,
            executionFailureCode: null,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: command.actorId }, transaction: tx },
        );
        await read(id, policies.write, tx);
        return result.record as TransferRecord;
      }),
    edit: (
      id: string,
      input: TransferInput,
      version: number,
      command: TransferCommand,
      policies: TransferPolicies,
    ) =>
      durable('edit', id, { input, version }, command, policies, async (tx) => {
        const before = await read(id, policies.view, tx);
        if (before.applicantId !== command.actorId)
          refuse('TRANSFER_FORBIDDEN');
        await prepare(
          input,
          command.actorId,
          new Date(),
          tx,
          before.snapshot ?? undefined,
        );
        const { targetSalary, ...values } = input;
        const privateSalaryRevisionId = await salaryRevision(
          id,
          salaryCents(targetSalary),
          command.actorId,
          tx,
        );
        return (
          await runtime.fire(TRANSFER_LIFECYCLE, id, 'edit', {
            actor: { id: command.actorId },
            manual: true,
            input: {
              ...values,
              kinds: [...values.kinds],
              privateSalaryRevisionId,
            },
            expect: { version },
            requestId: command.requestKey,
            transaction: tx,
          })
        ).record as TransferRecord;
      }),
    transition: (
      id: string,
      transition: 'submit' | 'withdraw' | 'terminate' | 'requestCancellation',
      version: number,
      command: TransferCommand,
      policies: TransferPolicies,
    ) =>
      durable(transition, id, { version }, command, policies, async (tx) => {
        const record = await read(id, policies.view, tx);
        if (transition === 'submit') {
          const prepared = await prepareRecord(
            record,
            command.actorId,
            tx,
            record.snapshot ?? undefined,
          );
          context.getStore()!.prepared = prepared.snapshot;
          context.getStore()!.preparedSalaryRevisionId = prepared.revision;
        }
        return (
          await runtime.fire(TRANSFER_LIFECYCLE, id, transition, {
            actor: { id: command.actorId },
            manual: true,
            input: {
              reason: command.reason,
              cancellationReason: command.reason,
            },
            expect: { version },
            requestId: command.requestKey,
            transaction: tx,
          })
        ).record as TransferRecord;
      }),
    async reviewEdit(
      id: string,
      patch: Partial<Omit<TransferInput, 'employeeId'>>,
      version: number,
      command: TransferCommand,
      policies: TransferPolicies,
    ) {
      return durable(
        'reviewEdit',
        id,
        { patch, version },
        command,
        policies,
        async (tx) => {
          const record = await read(id, policies.view, tx);
          const offers = await approvals.actionsFor(TRANSFER_LIFECYCLE, id, {
            id: command.actorId,
          });
          if (
            !offers.some((offer) =>
              offer.actions.some((a) => a.name === 'approve'),
            )
          )
            refuse('TRANSFER_FORBIDDEN');
          const allowed = transferEditableFields(record.status);
          if (
            !Object.keys(patch).length ||
            Object.keys(patch).some((field) => !allowed.includes(field))
          )
            refuse('TRANSFER_FIELDS_FORBIDDEN');
          if ('targetSalary' in patch) {
            if (!policies.salary) refuse('TRANSFER_FORBIDDEN');
            await read(id, policies.salary, tx);
          }
          if (!record.snapshot) refuse('TRANSFER_SNAPSHOT_UNAVAILABLE');
          const targetSalary =
            patch.targetSalary ?? (await rawTarget(record, tx));
          const revision = await salaryRevision(
            id,
            salaryCents(targetSalary),
            command.actorId,
            tx,
          );
          const updated = {
            ...record,
            ...patch,
            privateSalaryRevisionId: revision,
            kinds: [...(patch.kinds ?? record.kinds)],
          };
          if (
            'targetPositionId' in patch ||
            'targetDepartmentId' in patch ||
            'effectiveDate' in patch
          ) {
            const found = await d.headcounts.list(
              {
                page: 1,
                pageSize: 2,
                departmentId: updated.targetDepartmentId,
                positionId: updated.targetPositionId,
                year: Number(updated.effectiveDate.slice(0, 4)),
              },
              tx,
              { read: true, create: false, update: false, delete: false },
            );
            if (found.total !== 1 || !found.items[0]?.initialized)
              refuse('TRANSFER_ACCOUNT_UNAVAILABLE');
            updated.targetAccountId = found.items[0].id;
          }
          const prepared = await prepareRecord(
            updated,
            command.actorId,
            tx,
            record.snapshot,
          );
          context.getStore()!.prepared = prepared.snapshot;
          context.getStore()!.reviewEditor = command.actorId;
          const {
            targetSalary: _salary,
            kinds: patchKinds,
            ...safePatch
          } = patch;
          const result = await runtime.fire(
            TRANSFER_LIFECYCLE,
            id,
            'reviewEdit',
            {
              actor: { id: command.actorId },
              manual: true,
              input: {
                ...safePatch,
                ...(patchKinds ? { kinds: [...patchKinds] } : {}),
                targetAccountId: updated.targetAccountId,
                privateSalaryRevisionId: prepared.revision,
              },
              expect: { version },
              requestId: command.requestKey,
              transaction: tx,
            },
          );
          await d.audit.record(
            {
              actorId: command.actorId,
              action: 'transfer.reviewEdit',
              targetType: 'transferRequests',
              targetId: id,
              after: { changedFields: Object.keys(patch) },
              reason: command.reason,
            },
            tx,
          );
          return result.record as TransferRecord;
        },
      );
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      command: TransferCommand,
      policies: TransferPolicies,
    ) {
      await refresh();
      await read(id, policies.view);
      const runs = await approvals.runViewsFor(TRANSFER_LIFECYCLE, id);
      const target = input.target;
      if (
        !runs.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        refuse('TRANSFER_TARGET_MISMATCH');
      return durable('action', id, input, command, policies, async (tx) => {
        await approvals.perform({
          ...input,
          requestId: digest([
            TRANSFER_LIFECYCLE,
            id,
            command.actorId,
            command.requestKey,
          ]),
          actor: { id: command.actorId },
        });
        if (['reassign', 'appoint', 'transfer'].includes(input.action))
          await d.audit.record(
            {
              actorId: command.actorId,
              action: `transfer.${input.action}`,
              targetType: 'transferRequests',
              targetId: id,
              reason: command.reason,
            },
            tx,
          );
        return (await tx
          .repository<TransferRecord>('transferRequests')
          .findOne({ filter: { id } }))!;
      });
    },
    rebind: (
      id: string,
      version: number,
      command: TransferCommand,
      policies: TransferPolicies,
    ) =>
      durable('rebind', id, { version }, command, policies, async (tx) => {
        const record = await read(id, policies.view, tx);
        if (
          record.status !== 'pendingEffective' ||
          record.lifecycleVersion !== version ||
          !record.snapshot?.capacityChanges ||
          !(await d.org.hasDutyRole(command.actorId, 'hr', tx))
        )
          refuse('TRANSFER_REBIND_FORBIDDEN');
        const year = Number(d.calendar.localDate(new Date()).slice(0, 4));
        const policy = {
          read: true,
          create: false,
          update: false,
          delete: false,
        };
        const source = await d.headcounts.list(
          {
            page: 1,
            pageSize: 2,
            departmentId: record.snapshot.sourceDepartmentId,
            positionId: record.snapshot.sourcePositionId,
            year,
          },
          tx,
          policy,
        );
        const target = await d.headcounts.list(
          {
            page: 1,
            pageSize: 2,
            departmentId: record.snapshot.targetDepartmentId,
            positionId: record.snapshot.targetPositionId,
            year,
          },
          tx,
          policy,
        );
        if (
          source.total !== 1 ||
          target.total !== 1 ||
          !source.items[0].initialized ||
          !target.items[0].initialized
        )
          refuse('TRANSFER_ACCOUNT_UNAVAILABLE');
        await d.headcounts.rebind(
          {
            sourceKind: TRANSFER_LIFECYCLE,
            sourceId: id,
            targetAccountId: target.items[0].id,
            ...command,
          },
          tx,
        );
        const result = await tx
          .repository<TransferRecord>('transferRequests')
          .withPolicy(policies.write)
          .updateMany({
            filter: {
              id,
              status: 'pendingEffective',
              lifecycleVersion: version,
            },
            values: {
              sourceAccountId: source.items[0].id,
              targetAccountId: target.items[0].id,
              lifecycleVersion: version + 1,
            },
          });
        if (result.updatedCount !== 1) refuse('TRANSFER_VERSION_CONFLICT');
        await d.audit.record(
          {
            actorId: command.actorId,
            action: 'transfer.rebind',
            targetType: 'transferRequests',
            targetId: id,
            reason: command.reason,
          },
          tx,
        );
        return read(id, policies.view, tx);
      }),
    async candidates(
      id: string,
      taskId: string,
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy: RepositoryPolicy,
    ) {
      await read(id, policy);
      await refresh();
      const runs = await approvals.runViewsFor(TRANSFER_LIFECYCLE, id);
      if (!runs.some((run) => run.tasks.some((task) => task.id === taskId)))
        refuse('TRANSFER_TARGET_MISMATCH');
      const page = await approvals.candidatesFor({
        target: { taskId },
        action,
        actor: { id: actorId },
        query,
      });
      const people = await Promise.all(
        page.people.map(async (id) => ({
          id,
          name: (await d.users.get(id))?.name ?? id,
        })),
      );
      return { people, nextOffset: page.nextOffset };
    },
    canCreateAsHR: (actorId: string) => d.org.hasDutyRole(actorId, 'hr'),
    async formOptions(
      actorId: string,
      mode: 'create' | 'edit' | 'reviewEdit',
      policies: TransferPolicies,
      id?: string,
    ) {
      // The SDK read model resolves its own repository context. Build metadata before
      // opening our transaction to avoid waiting for a second SQLite connection.
      const offers =
        mode === 'reviewEdit' && id
          ? await approvals.actionsFor(TRANSFER_LIFECYCLE, id, { id: actorId })
          : [];
      return d.db.transaction(async (tx) => {
        const hr = await d.org.hasDutyRole(actorId, 'hr', tx);
        let record: TransferRecord | undefined;
        let fields: string[];
        if (mode === 'create') {
          if (id || !hr || policies.write.create === false)
            refuse('TRANSFER_FORBIDDEN');
          fields = ['employeeId', ...transferEditableFields('hr')];
          const repository = tx
            .repository('transferRequests')
            .withPolicy(policies.write);
          fields = (
            await Promise.all(
              fields.map(async (field) => {
                const actualField =
                  field === 'targetSalary' ? 'privateSalaryRevisionId' : field;
                const checked = await repository.validateMutation({
                  operation: 'createOne',
                  values: {
                    // Authorization probing still runs schema validation: an empty date
                    // is invalid and would hide an otherwise permitted effective date.
                    [actualField]:
                      field === 'kinds'
                        ? ['transfer']
                        : field === 'effectiveDate'
                          ? d.calendar.localDate(new Date())
                          : '',
                  } as RepositoryRecord,
                });
                return checked.valid ? field : null;
              }),
            )
          ).filter((field): field is string => !!field);
        } else {
          if (!id) refuse('TRANSFER_INVALID_ID');
          record = await read(id, policies.view, tx);
          if (mode === 'edit') {
            if (
              record.applicantId !== actorId ||
              !['draft', 'revision'].includes(record.status)
            )
              refuse('TRANSFER_FORBIDDEN');
            fields = transferEditableFields('hr');
          } else {
            if (
              !offers.some((offer) =>
                offer.actions.some((action) => action.name === 'approve'),
              )
            )
              refuse('TRANSFER_FORBIDDEN');
            fields = transferEditableFields(record.status);
          }
          // Use the same repository mutation checker as writes, including current record scope and field restrictions.
          const repository = tx
            .repository('transferRequests')
            .withPolicy(policies.write);
          if (policies.write.update === false) refuse('TRANSFER_FORBIDDEN');
          fields = (
            await Promise.all(
              fields.map(async (field) => {
                if (field === 'targetSalary') {
                  if (!policies.salary) return null;
                  try {
                    await read(id, policies.salary, tx);
                  } catch {
                    return null;
                  }
                  const checked = await repository.validateMutation({
                    operation: 'updateOne',
                    filter: { id },
                    values: {
                      privateSalaryRevisionId: record!.privateSalaryRevisionId,
                    },
                  });
                  return checked.valid ? field : null;
                }
                const checked = await repository.validateMutation({
                  operation: 'updateOne',
                  filter: { id },
                  values: {
                    [field]: record![field as keyof TransferRecord],
                  } as RepositoryRecord,
                });
                return checked.valid ? field : null;
              }),
            )
          ).filter((field): field is string => !!field);
        }
        const departments =
          fields.includes('targetDepartmentId') ||
          fields.includes('targetManagerId')
            ? (await d.org.listTree(tx)).filter(
                (department) => department.active && department.id,
              )
            : [];
        const managers = new Map<string, { id: string; name: string }>();
        if (fields.includes('targetManagerId')) {
          const userIds = [
            ...new Set(
              departments
                .map((department) => department.managerId)
                .filter((value): value is string => !!value),
            ),
          ];
          for (const userId of userIds) {
            const employee = await d.employees.getByUserId(userId, tx);
            if (employee?.active && employee.status !== 'left')
              managers.set(employee.id, {
                id: employee.id,
                name: employee.name,
              });
          }
          if (record?.targetManagerId) {
            const employee = await d.employees.getById(
              record.targetManagerId,
              tx,
            );
            if (employee)
              managers.set(employee.id, {
                id: employee.id,
                name: employee.name,
              });
          }
        }
        const employee = record
          ? await d.employees.getById(record.employeeId, tx)
          : undefined;
        return {
          canCreateAsHR: hr && mode === 'create',
          editableFields: fields,
          employee: employee ? { id: employee.id, name: employee.name } : null,
          departments: fields.includes('targetDepartmentId')
            ? departments.map(({ id, title }) => ({ id, name: title }))
            : [],
          positions: fields.includes('targetPositionId')
            ? (await d.org.listPositions(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
          grades: fields.includes('targetGradeId')
            ? (await d.org.listGrades(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
          managers: [...managers.values()],
        };
      });
    },
    async capacityOptions(
      actorId: string,
      input: {
        employeeId: string;
        targetDepartmentId: string;
        targetPositionId: string;
        effectiveDate: string;
        requestId?: string;
        mode: 'create' | 'edit' | 'reviewEdit';
      },
      policies: TransferPolicies,
    ) {
      const choices = await this.formOptions(
        actorId,
        input.mode,
        policies,
        input.requestId,
      );
      return d.db.transaction(async (tx) => {
        if (input.requestId) {
          const record = await read(input.requestId, policies.view, tx);
          if (input.employeeId !== record.employeeId)
            refuse('TRANSFER_FORBIDDEN');
          for (const field of [
            'targetDepartmentId',
            'targetPositionId',
            'effectiveDate',
          ] as const) {
            if (
              input[field] !== record[field] &&
              !choices.editableFields.includes(field)
            )
              refuse('TRANSFER_FIELDS_FORBIDDEN');
          }
        }
        const employee = await d.employees.getById(input.employeeId, tx);
        if (!employee?.active || !employee.positionId)
          refuse('TRANSFER_EMPLOYEE_UNAVAILABLE');
        const department = await d.org.primaryDepartmentOf(employee.userId, tx);
        if (!department) refuse('TRANSFER_SOURCE_DEPARTMENT_UNAVAILABLE');
        if (
          department.id === input.targetDepartmentId &&
          employee.positionId === input.targetPositionId
        )
          return { sourceAccountId: null, targetAccountId: null };
        const year = Number(input.effectiveDate.slice(0, 4));
        const account = async (departmentId: string, positionId: string) => {
          const found = await d.headcounts.list(
            { page: 1, pageSize: 2, year, departmentId, positionId },
            tx,
            { read: true, create: false, update: false, delete: false },
          );
          if (found.total !== 1 || !found.items[0]?.initialized)
            refuse('TRANSFER_ACCOUNT_UNAVAILABLE');
          return found.items[0].id;
        };
        return {
          sourceAccountId: await account(department.id, employee.positionId),
          targetAccountId: await account(
            input.targetDepartmentId,
            input.targetPositionId,
          ),
        };
      });
    },
    async detail(id: string, actorId: string, policy: RepositoryPolicy) {
      await refresh();
      const record = await read(id, policy);
      const runs = await approvals.runViewsFor(TRANSFER_LIFECYCLE, id);
      const snapshot = record.snapshot;
      const ids = [
        ...new Set(
          [
            record.applicantId,
            record.cancelConfirmerId,
            snapshot?.userId,
            snapshot?.directManagerId,
            snapshot?.sourceHeadId,
            snapshot?.targetHeadId,
            snapshot?.executiveId,
            snapshot?.gmId,
            ...(snapshot?.hrIds ?? []),
            ...runs.flatMap((run) =>
              run.tasks.flatMap((task) => [task.assigneeId, task.actorId]),
            ),
          ].filter((value): value is string => Boolean(value)),
        ),
      ];
      const users = await Promise.all(
        ids.map(async (id) => {
          const user = await d.users.get(id);
          return { id, name: user?.name ?? id };
        }),
      );
      return {
        record: safe(record),
        facts: {
          employee: {
            id: record.employeeId,
            name:
              (await d.employees.getById(record.employeeId))?.name ??
              record.employeeId,
          },
          department: {
            id: record.targetDepartmentId,
            name:
              (await d.org.getDepartment(record.targetDepartmentId))?.title ??
              record.targetDepartmentId,
          },
          position: {
            id: record.targetPositionId,
            name:
              (await d.org.listPositions()).find(
                (row) => row.id === record.targetPositionId,
              )?.title ?? record.targetPositionId,
          },
          grade: {
            id: record.targetGradeId,
            name:
              (await d.org.listGrades()).find(
                (row) => row.id === record.targetGradeId,
              )?.title ?? record.targetGradeId,
          },
          manager: record.targetManagerId
            ? {
                id: record.targetManagerId,
                name:
                  (await d.employees.getById(record.targetManagerId))?.name ??
                  record.targetManagerId,
              }
            : null,
        },
        users,
        view: await runtime.view(TRANSFER_LIFECYCLE, id, { id: actorId }),
        runs,
        actions: await approvals.actionsFor(TRANSFER_LIFECYCLE, id, {
          id: actorId,
        }),
        timeline: await approvals.timelineFor(TRANSFER_LIFECYCLE, id),
      };
    },
    async salary(
      id: string,
      viewPolicy: RepositoryPolicy,
      salaryPolicy: RepositoryPolicy,
    ) {
      return d.db.transaction(async (tx) => {
        const record = await read(id, viewPolicy, tx);
        await read(id, salaryPolicy, tx);
        return {
          targetSalary: await rawTarget(record, tx),
          ...(record.snapshot
            ? { currentSalary: (await privateSalary(record, tx)).currentCents }
            : {}),
        };
      });
    },
    async list(policy: RepositoryPolicy) {
      const rows = await d.db
        .repository<TransferRecord>('transferRequests')
        .withPolicy(policy)
        .findMany({
          sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        });
      if (rows.some((row) => TRANSFER_FIELDS.some((field) => !(field in row))))
        refuse('TRANSFER_FORBIDDEN');
      return rows.map((row) => safe(row as TransferRecord));
    },
    async listForCenter(
      actorId: string,
      view: TransferCenterView,
      policy: RepositoryPolicy,
    ): Promise<TransferCenterItem[]> {
      if (policy.read === false) refuse('TRANSFER_FORBIDDEN');
      await refresh();
      const rows = await d.db
        .repository<TransferRecord>('transferRequests')
        .withPolicy(policy)
        .findMany({
          sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
        });
      if (rows.some((row) => TRANSFER_FIELDS.some((field) => !(field in row))))
        refuse('TRANSFER_FORBIDDEN');
      const items: TransferCenterItem[] = [];
      for (const row of rows as TransferRecord[]) {
        let included = false;
        if (view === 'mine') included = row.applicantId === actorId;
        else if (view === 'pending')
          included = (
            await approvals.actionsFor(TRANSFER_LIFECYCLE, row.id, {
              id: actorId,
            })
          ).some(
            (offer) =>
              offer.task.role !== 'info' &&
              offer.actions.some((action) =>
                ['approve', 'reject', 'return'].includes(action.name),
              ),
          );
        else if (view === 'done')
          // Public TaskRow documents completed as answered, transferred as handed over,
          // and actorId as the actual assignee/delegate who performed the action.
          included = (
            await approvals.tasksFor(TRANSFER_LIFECYCLE, row.id)
          ).some(
            (task) =>
              task.role !== 'info' &&
              task.actorId === actorId &&
              ['completed', 'transferred'].includes(task.status),
          );
        else if (view === 'copied')
          included = (
            await approvals.involvementOf(TRANSFER_LIFECYCLE, row.id, actorId)
          ).includes('copied');
        if (!included) continue;
        const applicant = await d.users.get(row.applicantId);
        items.push({
          id: row.id,
          kind: 'oa.transfer',
          title: row.reason.trim().replace(/\s+/g, ' ').slice(0, 240),
          number: null,
          applicantId: row.applicantId,
          applicant: applicant
            ? { id: applicant.id, name: applicant.name }
            : null,
          status: row.status,
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : String(row.createdAt),
          startDate: row.effectiveDate,
          endDate: null,
          amount: null,
          unit: null,
        });
      }
      return items;
    },
    async listPage(
      query: {
        page: number;
        pageSize: number;
        q?: string;
        status?: string;
        orderBy?: string;
      },
      policy: RepositoryPolicy,
    ) {
      if (policy.read === false) refuse('TRANSFER_FORBIDDEN');
      const repository = d.db
        .repository<TransferRecord>('transferRequests')
        .withPolicy(policy);
      const filter = query.status ? { status: query.status } : undefined;
      const rows = await repository.findMany({
        filter,
        sort: (s) => {
          const [field, direction] = (query.orderBy ?? 'createdAt:desc').split(
            ':',
          );
          if (!['createdAt', 'effectiveDate', 'id'].includes(field))
            refuse('TRANSFER_INVALID_SORT');
          const column = s.field(field);
          return [
            direction === 'asc' ? column.asc() : column.desc(),
            s.field('id').asc(),
          ];
        },
      });
      if (rows.some((row) => TRANSFER_FIELDS.some((field) => !(field in row))))
        refuse('TRANSFER_FORBIDDEN');
      const records = rows as TransferRecord[];
      const search = query.q?.trim().toLocaleLowerCase();
      const filtered = search
        ? records.filter(
            (row) =>
              row.reason.toLocaleLowerCase().includes(search) ||
              row.id.toLocaleLowerCase().includes(search),
          )
        : records;
      const items = await Promise.all(
        filtered
          .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
          .map(async (row) => {
            const ids = [
              row.applicantId,
              row.cancelConfirmerId,
              row.snapshot?.userId,
            ].filter((id): id is string => !!id);
            const users = await Promise.all(
              [...new Set(ids)].map(async (id) => ({
                id,
                name: (await d.users.get(id))?.name ?? id,
              })),
            );
            return {
              ...safe(row),
              employee: {
                id: row.employeeId,
                name:
                  (await d.employees.getById(row.employeeId))?.name ??
                  row.employeeId,
              },
              users,
            };
          }),
      );
      return { items, total: filtered.length };
    },
    async readableIds(actorId: string) {
      await refresh();
      // Only involvementOf is invoked here. Actual SDK answers and all capacity
      // writers still acquire the coordinated headcount transaction above.
      return readDirectory.run(outside.directory, async () => {
        const rows = await d.db
          .repository<TransferRecord>('transferRequests')
          .findMany();
        const ids: string[] = [];
        for (const row of rows)
          if (
            row.applicantId === actorId ||
            row.snapshot?.userId === actorId ||
            (await d.org.hasDutyRole(actorId, 'hr')) ||
            (await approvals.involvementOf(TRANSFER_LIFECYCLE, row.id, actorId))
              .length
          )
            ids.push(row.id);
        return ids;
      });
    },
    async maintenance() {
      await refresh();
      await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const today = d.calendar.localDate(new Date()),
        rows = await d.db
          .repository<TransferRecord>('transferRequests')
          .findMany({ filter: { status: 'pendingEffective' } });
      let completed = 0;
      const failures: { id: string; reason: string }[] = [];
      for (const row of rows) {
        if (row.effectiveDate > today) continue;
        try {
          await d.headcounts.within(d.db.connection(), (tx) =>
            context.run({ tx }, async () => {
              await runtime.fire(TRANSFER_LIFECYCLE, row.id, 'execute', {
                actor: { id: 'system', system: true },
                manual: false,
                expect: { version: row.lifecycleVersion },
                requestId: `effective:${row.id}:${row.lifecycleVersion}`,
                transaction: tx,
              });
            }),
          );
          completed++;
        } catch (error) {
          const reason =
            error instanceof TransferError
              ? error.reason
              : 'TRANSFER_EXECUTION_FAILED';
          // This separate diagnostic transaction runs only after the business transaction rolled back.
          // It never changes eligibility, releases capacity or pretends execution succeeded.
          await d.headcounts.within(d.db.connection(), async (tx) => {
            await tx.repository('transferRequests').updateMany({
              filter: {
                id: row.id,
                status: 'pendingEffective',
                lifecycleVersion: row.lifecycleVersion,
              },
              values: { executionFailureCode: reason },
            });
          });
          failures.push({ id: row.id, reason });
        }
      }
      return { completed, failures };
    },
  };
}
export type TransferService = ReturnType<typeof createTransferService>;
export const transferServiceToken = createServiceToken<TransferService>(
  'oa/transfer-service',
);
