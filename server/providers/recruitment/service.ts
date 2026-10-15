import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import {
  hasApprovalCandidate,
  createAppApprovalService,
} from '../approval-runtime/query-service.js';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import { AsyncLocalStorage } from 'node:async_hooks';
import { candidateDirectory } from '../approval-runtime/candidate-directory.js';
import { createHash, randomUUID } from 'node:crypto';
import { createServiceToken } from '@nocobase/service-provider';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import {
  LifecycleRuntime,
  type LifecycleStore,
  type EffectDispatcher,
  type JsonObject,
} from '@nocobase/lifecycle';
import {
  isOpenRun,
  type Approval,
  type PerformInput,
} from '@nocobase/app-plugin-approval/server';
import type { OrgService, Department } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import type { HeadcountService } from '../headcounts/contract.js';
import type {
  SalaryGradeSelection,
  SalaryGradeService,
} from '../job-grades/contract.js';
import type { AuditService } from '../audit/index.js';
import type {
  OaApprovalDirectory,
  ApprovalDirectoryService,
} from '../approval-directory/contract.js';
import type { CalendarService, RuleService } from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import {
  appLifecycleTransaction,
  createAppLifecycleStore,
} from '../approval-runtime/repository-store.js';
import {
  createRecruitmentApproval,
  RECRUITMENT_LIFECYCLE,
  type RecruitmentRecord,
  type RecruitmentApprovalServices,
} from './approval.js';
import {
  createRecruitmentSubmissionCoordinator,
  RecruitmentSubmissionError,
  type RecruitmentProposal,
  type RecruitmentSubmissionSnapshot,
} from './submission.js';
import { assertRecruitmentApprovalCheckpoint } from './checkpoint.js';
import { createRequisitionService } from './requisitions.js';

export interface RecruitmentInput extends Omit<RecruitmentProposal, 'id'> {
  expectedStartDate: string;
  jobDescription: string;
  reason: string;
}
interface SalaryRevision extends RepositoryRecord {
  id: string;
  requestId: string;
  version: number;
  minimumCents: number | string;
  maximumCents: number | string;
}
export interface RecruitmentDependencies {
  db: DatabaseManager;
  org: OrgService;
  departmentOptions?: (
    connection: DatabaseConnection,
  ) => Promise<readonly Department[]>;
  employees: EmployeeService;
  headcounts: HeadcountService;
  grades: SalaryGradeService;
  rules: RuleService;
  calendar: CalendarService;
  audit: AuditService;
  directory: ApprovalDirectoryService;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
  users: UserAdministrationService;
}
export interface RecruitmentPolicies {
  view: RepositoryPolicy;
  write: RepositoryPolicy;
  salary?: RepositoryPolicy;
}
export function recruitmentEditableFields(status: string): string[] {
  if (['head', 'hrbp', 'draft', 'revision'].includes(status))
    return [
      'departmentId',
      'positionId',
      'gradeId',
      'quantity',
      'kind',
      'replacementEmployeeIds',
      'accountId',
      'year',
      'expectedStartDate',
      'jobDescription',
      'reason',
      'minimumCents',
      'maximumCents',
    ];
  if (status === 'hrDirector')
    return ['gradeId', 'quantity', 'minimumCents', 'maximumCents'];
  if (['executive', 'gm'].includes(status))
    return ['quantity', 'minimumCents', 'maximumCents'];
  return [];
}
export const RECRUITMENT_FIELDS = [
  'id',
  'applicantId',
  'departmentId',
  'privateSalaryRevisionId',
  'lifecycleVersion',
  'status',
  'positionId',
  'gradeId',
  'quantity',
  'kind',
  'replacementEmployeeIds',
  'accountId',
  'year',
  'expectedStartDate',
  'jobDescription',
  'reason',
  'snapshot',
  'createdAt',
  'statusChangedAt',
] as const;
export interface RecruitmentCommand {
  actorId: string;
  requestKey: string;
  reason: string;
}
function fail(reason: string): never {
  throw new RecruitmentSubmissionError(reason);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export function createRecruitmentService(d: RecruitmentDependencies) {
  const context = new AsyncLocalStorage<{
    tx: DatabaseConnection;
    policy?: RepositoryPolicy;
    mutation?: boolean;
    prepared?: RecruitmentSubmissionSnapshot;
    reuseOpinions?: boolean;
  }>();
  const snapshots = new WeakMap<object, RecruitmentApprovalServices>();
  let outside: RecruitmentApprovalServices & { directory: OaApprovalDirectory };
  const readDirectory = new AsyncLocalStorage<OaApprovalDirectory>();
  const coordinator = createRecruitmentSubmissionCoordinator(d);
  const requisitions = createRequisitionService(d);
  const base = createAppLifecycleStore(d.db, {
    collections: {
      transitions: 'oaLifecycleTransitions',
      effectRuns: 'oaLifecycleEffectRuns',
    },
  });
  // The shared capacity guard precedes every approval transaction, including SDK answers and maintenance.
  // Nested public stores join the caller transaction; directory reads never reuse an earlier write snapshot.
  function wrap(store: LifecycleStore): LifecycleStore {
    return new Proxy(store, {
      get(target, key) {
        if (key === 'transaction')
          return async <T>(
            work: (child: LifecycleStore) => Promise<T>,
            options?: Parameters<LifecycleStore['transaction']>[1],
          ) => {
            const join = async (within: unknown) =>
              target.transaction(
                async (child) => {
                  const tx = child.transactionHandle as DatabaseConnection;
                  snapshots.set(tx, {
                    connection: tx,
                    directory:
                      readDirectory.getStore() ??
                      (await d.directory.snapshot(tx)),
                    prepared: context.getStore()?.prepared,
                    reuseOpinions: context.getStore()?.reuseOpinions,
                  });
                  return work(wrap(child));
                },
                { ...options, within },
              );
            const within =
              options?.within ??
              appLifecycleTransaction() ??
              context.getStore()?.tx;
            if (within) return join(within);
            // readableIds only calls the public involvement read model. It neither
            // allocates capacity nor answers approval work; do not take the writer gate.
            if (readDirectory.getStore() || candidateDirectory())
              return join(undefined);
            return d.headcounts.within(d.db.connection(), (locked) =>
              join(locked),
            );
          };
        if (key === 'createRecord' && context.getStore()?.policy)
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'recruitmentRequests')
              return target.createRecord(collection, values);
            const tx = target.transactionHandle as DatabaseConnection;
            const row = await tx
              .repository(collection)
              .withPolicy(context.getStore()!.policy!)
              .createOne({ values: values as RepositoryRecord });
            if (!row.record.id) fail('RECRUITMENT_FORBIDDEN');
            return row.record;
          };
        if (
          key === 'updateRecordIf' &&
          context.getStore()?.policy &&
          context.getStore()?.mutation
        )
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'recruitmentRequests')
              return target.updateRecordIf(collection, id, condition, values);
            const result = await (
              target.transactionHandle as DatabaseConnection
            )
              .repository(collection)
              .withPolicy(context.getStore()!.policy!)
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
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }
  async function salary(record: RecruitmentRecord, tx: DatabaseConnection) {
    const row = await tx
      .repository<SalaryRevision>('recruitmentSalaryRevisions')
      .findOne({
        filter: { id: record.privateSalaryRevisionId, requestId: record.id },
      });
    if (!row) fail('RECRUITMENT_SALARY_UNAVAILABLE');
    const minimumCents = Number(row.minimumCents),
      maximumCents = Number(row.maximumCents);
    if (
      !Number.isSafeInteger(minimumCents) ||
      !Number.isSafeInteger(maximumCents)
    )
      fail('RECRUITMENT_INVALID_SALARY');
    return { minimumCents, maximumCents };
  }
  async function checkpoint(record: RecruitmentRecord, tx: DatabaseConnection) {
    if (!record.snapshot) fail('RECRUITMENT_SNAPSHOT_UNAVAILABLE');
    await assertRecruitmentApprovalCheckpoint(
      record.id,
      record.snapshot,
      await salary(record, tx),
      d,
      tx,
    );
  }
  const hooks = {
    calendar: () => d.calendar.approvalCalendar(),
    operations: createOaApprovalOperations(d),
    preparation: 'host' as const,
    authorizeCreate: async () => Boolean(context.getStore()?.policy),
    authorizeEdit: async () => Boolean(context.getStore()?.policy),
    async prepare(record, actorId, now, tx) {
      const employee = await d.employees.getByUserId(actorId, tx);
      if (!employee?.active || employee.status === 'left')
        fail('RECRUITMENT_EMPLOYEE_INACTIVE');
      if (record.year !== Number(d.calendar.localDate(now).slice(0, 4)))
        fail('RECRUITMENT_YEAR_MISMATCH');
      const amounts = await salary(record, tx);
      return coordinator.submit(
        { ...record, ...amounts },
        {
          actorId,
          requestKey: `submit:${record.id}:${record.lifecycleVersion}`,
          reason: record.reason,
          resubmission: record.status === 'revision',
          applicantId: record.applicantId,
          now,
          authorizeTarget: async (departmentId, authorizationTx) => {
            const policy = context.getStore()?.policy;
            if (!policy || departmentId !== record.departmentId) return false;
            const result = await authorizationTx
              .repository('recruitmentRequests')
              .withPolicy(policy)
              .updateMany({
                filter: { id: record.id, departmentId },
                values: { departmentId },
              });
            return result.updatedCount === 1;
          },
        },
        tx,
        async (snapshot, frozenSalary, _hold, connection) => {
          const privateSalaryRevisionId = await appendSalary(
            record.id,
            frozenSalary,
            actorId,
            connection,
          );
          return { ...snapshot, privateSalaryRevisionId };
        },
      );
    },
    validateHrBp: checkpoint,
    async publish(record, actorId, tx) {
      await checkpoint(record, tx);
      await requisitions.publish(
        {
          id: record.id,
          lifecycleVersion: record.lifecycleVersion,
          snapshot: record.snapshot!,
        },
        {
          actorId,
          requestKey: `publish:${record.id}:${record.lifecycleVersion}`,
          reason: 'Approved recruitment',
        },
        tx,
      );
    },
    async release(record, actorId, tx) {
      if (
        !(await d.headcounts.reservation(
          { sourceKind: RECRUITMENT_LIFECYCLE, sourceId: record.id },
          tx,
        ))
      )
        return;
      await d.headcounts.close(
        {
          sourceKind: RECRUITMENT_LIFECYCLE,
          sourceId: record.id,
          actorId,
          requestKey: `release:${record.id}:${record.lifecycleVersion}`,
          reason: 'Recruitment ended',
        },
        tx,
      );
    },
    async notify(task, reason, services) {
      const record = await d.db
        .repository<RecruitmentRecord>('recruitmentRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: RECRUITMENT_LIFECYCLE,
      });
    },
    result: (input) =>
      d.notifications.result({ ...input, kind: RECRUITMENT_LIFECYCLE }),
  } satisfies import('./approval.js').RecruitmentApprovalHooks;
  const definition = createRecruitmentApproval(hooks);
  const runtime = new LifecycleRuntime({
    store: wrap(base),
    dispatcher: d.dispatcher,
  });
  const source = (handle: unknown) =>
    handle ? snapshots.get(handle)! : outside;
  runtime.register(definition, { services: source });
  const approvals = createAppApprovalService(
    runtime,
    [definition.approval as unknown as Approval<never>],
    source,
  );
  async function refresh() {
    outside = {
      directory: await d.directory.snapshot(),
      connection: d.db.connection(),
    };
  }
  async function appendSalary(
    requestId: string,
    input: {
      minimumCents: number;
      maximumCents: number;
      band?: SalaryGradeSelection;
    },
    actorId: string,
    tx: DatabaseConnection,
  ) {
    if (
      !Number.isSafeInteger(input.minimumCents) ||
      !Number.isSafeInteger(input.maximumCents) ||
      input.minimumCents < 0 ||
      input.maximumCents < input.minimumCents
    )
      fail('RECRUITMENT_INVALID_SALARY');
    const rows = await tx
      .repository<SalaryRevision>('recruitmentSalaryRevisions')
      .findMany({ filter: { requestId } });
    // Keep the immutable salary identity when its business content has not changed. Fresh UUIDs
    // for identical values would falsely invalidate the SDK's covered-opinion comparison.
    // A submitted revision also binds the actual grade-table version; a new band never reuses it.
    const unchanged = rows.find(
      (row) =>
        Number(row.minimumCents) === input.minimumCents &&
        Number(row.maximumCents) === input.maximumCents &&
        (!input.band || hash(row.band) === hash(input.band)),
    );
    if (unchanged) return unchanged.id;
    const id = randomUUID();
    await tx.repository('recruitmentSalaryRevisions').createOne({
      values: {
        id,
        requestId,
        version: rows.length,
        minimumCents: input.minimumCents,
        maximumCents: input.maximumCents,
        band: input.band ? { ...input.band } : null,
        gradeRevisionId: input.band?.revisionId ?? null,
        gradeTableVersion: input.band?.tableVersion ?? null,
        createdAt: new Date(),
        createdById: actorId,
      },
    });
    return id;
  }
  async function read(
    id: string,
    policy: RepositoryPolicy,
    tx = d.db.connection(),
  ) {
    const row = await tx
      .repository<RecruitmentRecord>('recruitmentRequests')
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (!row || RECRUITMENT_FIELDS.some((field) => !(field in row)))
      fail('RECRUITMENT_FORBIDDEN');
    return Object.fromEntries(
      RECRUITMENT_FIELDS.map((field) => [field, row[field]]),
    ) as RecruitmentRecord;
  }
  async function durable<T extends RecruitmentRecord>(
    kind: string,
    payload: unknown,
    command: RecruitmentCommand,
    policy: RepositoryPolicy,
    work: (tx: DatabaseConnection) => Promise<T>,
    id?: string,
  ): Promise<T> {
    if (!command.actorId || !command.requestKey || !command.reason.trim())
      fail('RECRUITMENT_INVALID_COMMAND');
    return d.db.transaction((tx) =>
      d.headcounts.within(tx, async (locked) =>
        context.run(
          { tx: locked, policy, mutation: kind !== 'action' },
          async () => {
            if (kind === 'create' && !policy.create)
              fail('RECRUITMENT_FORBIDDEN');
            if (kind !== 'create' && kind !== 'action' && !policy.update)
              fail('RECRUITMENT_FORBIDDEN');
            if (id) await read(id, policy, locked);
            const key = hash([command.actorId, command.requestKey]),
              fingerprint = hash([
                kind,
                payload,
                command.actorId,
                command.reason,
              ]);
            const repo = locked.repository<{
              id: string;
              fingerprint: string;
              result: JsonObject;
              createdAt: Date;
            }>('recruitmentCommands');
            const old = await repo.findOne({ filter: { id: key } });
            if (old) {
              if (old.fingerprint !== fingerprint)
                fail('RECRUITMENT_IDEMPOTENCY_CONFLICT');
              if (typeof old.result.id !== 'string')
                fail('RECRUITMENT_INVALID_COMMAND');
              await read(old.result.id, policy, locked);
              return old.result as unknown as T;
            }
            const result = await work(locked);
            await repo.createOne({
              values: {
                id: key,
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
  function validate(input: RecruitmentInput) {
    if (
      !input.reason.trim() ||
      !input.jobDescription.trim() ||
      input.reason.length > 10000 ||
      input.jobDescription.length > 20000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedStartDate) ||
      !Number.isFinite(Date.parse(input.expectedStartDate)) ||
      new Date(input.expectedStartDate).toISOString().slice(0, 10) !==
        input.expectedStartDate
    )
      fail('RECRUITMENT_INVALID_INPUT');
  }
  return {
    runtime,
    approvals,
    approvalDefinition:
      definition.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    async salaryReadableIds(actorId: string) {
      await refresh();
      const rows = await d.db
        .repository<RecruitmentRecord>('recruitmentRequests')
        .findMany();
      return rows
        .filter(
          (row) =>
            row.applicantId === actorId ||
            row.snapshot?.headId === actorId ||
            row.snapshot?.executiveId === actorId ||
            row.snapshot?.gmId === actorId ||
            row.snapshot?.hrDirectorId === actorId ||
            row.snapshot?.hrbpIds.includes(actorId),
        )
        .map((row) => row.id);
    },
    async replacementNoticeRecipients(id: string, tx: DatabaseConnection) {
      const record = await tx
        .repository<RecruitmentRecord>('recruitmentRequests')
        .findOne({ filter: { id } });
      if (!record) return [];
      const directory = await d.directory.snapshot(tx);
      return [
        ...new Set([
          record.applicantId,
          ...(record.snapshot?.hrbpIds ?? []),
          ...directory.roleMembers('hrbp'),
          ...directory.roleMembers('hrDirector'),
          ...directory.roleMembers('hr'),
        ]),
      ].sort();
    },
    async replacementNoticeEligible(
      id: string,
      actorId: string,
      tx: DatabaseConnection,
      policy: RepositoryPolicy,
    ) {
      const record = await tx
        .repository<RecruitmentRecord>('recruitmentRequests')
        .withPolicy(policy)
        .findOne({ filter: { id }, select: (s) => s.fields('id') });
      if (!record || record.id !== id) return false;
      const directory = await d.directory.snapshot(tx);
      if (!directory.isActive(actorId)) return false;
      const reservation = await d.headcounts.reservation(
        { sourceKind: RECRUITMENT_LIFECYCLE, sourceId: id },
        tx,
      );
      return Boolean(reservation?.blocked);
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const rows = await d.db
          .repository<RecruitmentRecord>('recruitmentRequests')
          .findMany();
        const result: string[] = [];
        for (const row of rows) {
          if (
            row.applicantId === actorId ||
            outside.directory.hasRole(actorId, 'approval.admin') ||
            outside.directory.hasRole(actorId, 'hrbp') ||
            outside.directory.hasRole(actorId, 'hrDirector') ||
            outside.directory.hasRole(actorId, 'gm') ||
            row.snapshot?.executiveId === actorId ||
            (await d.org.activeChain(row.departmentId))?.some(
              (dept) => dept.managerId === actorId,
            ) ||
            (
              await approvals.involvementOf(
                RECRUITMENT_LIFECYCLE,
                row.id,
                actorId,
              )
            ).length
          )
            result.push(row.id);
        }
        return result;
      });
    },
    requisitions,
    initialize: refresh,
    async create(
      input: RecruitmentInput,
      command: RecruitmentCommand,
      policy: RepositoryPolicy,
      readbackPolicy: RepositoryPolicy = policy,
    ) {
      validate(input);
      await refresh();
      return durable('create', input, command, policy, async (tx) => {
        const id = randomUUID(),
          { minimumCents, maximumCents, ...values } = input;
        const privateSalaryRevisionId = await appendSalary(
          id,
          { minimumCents, maximumCents },
          command.actorId,
          tx,
        );
        const result = await runtime.create(
          RECRUITMENT_LIFECYCLE,
          {
            id,
            ...values,
            applicantId: command.actorId,
            privateSalaryRevisionId,
            snapshot: null,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: command.actorId }, transaction: tx },
        );
        // Composite collection scopes govern read/update; create has its own node. Recheck the
        // submitted target with this action's scoped read before committing either salary or draft.
        await read(String(result.record.id), policy, tx);
        return read(String(result.record.id), readbackPolicy, tx);
      });
    },
    async edit(
      id: string,
      input: RecruitmentInput,
      version: number,
      command: RecruitmentCommand,
      policy: RepositoryPolicy,
    ) {
      validate(input);
      await refresh();
      return durable(
        'edit',
        { id, input, version },
        command,
        policy,
        async (tx) => {
          const { minimumCents, maximumCents, ...values } = input;
          const privateSalaryRevisionId = await appendSalary(
            id,
            { minimumCents, maximumCents },
            command.actorId,
            tx,
          );
          const result = await runtime.fire(RECRUITMENT_LIFECYCLE, id, 'edit', {
            actor: { id: command.actorId },
            manual: true,
            input: {
              ...values,
              replacementEmployeeIds: [...values.replacementEmployeeIds],
              privateSalaryRevisionId,
            },
            expect: { version },
            requestId: command.requestKey,
            transaction: tx,
          });
          return result.record as RecruitmentRecord;
        },
        id,
      );
    },
    async reviewEdit(
      id: string,
      patch: Partial<RecruitmentInput>,
      version: number,
      command: RecruitmentCommand,
      policies: RecruitmentPolicies,
    ) {
      await refresh();
      // Both ordinary viewing and private salary policies are rechecked before replay.
      await read(id, policies.view);
      if ('minimumCents' in patch || 'maximumCents' in patch) {
        if (!policies.salary) fail('RECRUITMENT_FORBIDDEN');
        await read(id, policies.salary);
      }
      return durable(
        'reviewEdit',
        { id, patch, version },
        command,
        policies.write,
        async (tx) => {
          const record = await read(id, policies.view, tx);
          const offers = await approvals.actionsFor(RECRUITMENT_LIFECYCLE, id, {
            id: command.actorId,
          });
          if (
            !offers.some(
              (offer) =>
                offer.task.role !== 'info' &&
                offer.actions.some((action) => action.name === 'approve'),
            )
          )
            fail('RECRUITMENT_FORBIDDEN');
          const fields = recruitmentEditableFields(record.status);
          if (
            !Object.keys(patch).length ||
            Object.keys(patch).some((field) => !fields.includes(field))
          )
            fail('RECRUITMENT_FIELDS_FORBIDDEN');
          if ('minimumCents' in patch || 'maximumCents' in patch)
            await read(id, policies.salary!, tx);
          const amounts = { ...(await salary(record, tx)), ...patch };
          const updated = {
            ...record,
            ...patch,
            replacementEmployeeIds: [
              ...(patch.replacementEmployeeIds ??
                record.replacementEmployeeIds),
            ],
          };
          validate({ ...updated, ...amounts });
          const repository = tx
            .repository('recruitmentRequests')
            .withPolicy(policies.write);
          for (const field of Object.keys(patch)) {
            const actual = ['minimumCents', 'maximumCents'].includes(field)
              ? 'privateSalaryRevisionId'
              : field;
            const checked = await repository.validateMutation({
              operation: 'updateOne',
              filter: { id },
              values: {
                [actual]:
                  actual === 'privateSalaryRevisionId'
                    ? record.privateSalaryRevisionId
                    : patch[field as keyof RecruitmentInput],
              } as RepositoryRecord,
            });
            if (!checked.valid) fail('RECRUITMENT_FIELDS_FORBIDDEN');
          }
          const privateSalaryRevisionId = await appendSalary(
            id,
            amounts,
            command.actorId,
            tx,
          );
          // Resubmission atomically revises the actual hold and freezes current salary/rules/directory.
          // The SDK independently reuses only self-made opinions with unchanged stage coverage.
          context.getStore()!.prepared = await hooks.prepare(
            { ...updated, privateSalaryRevisionId, status: 'revision' },
            command.actorId,
            new Date(),
            tx,
          );
          const result = await runtime.fire(
            RECRUITMENT_LIFECYCLE,
            id,
            'reviewEdit',
            {
              actor: { id: command.actorId },
              manual: true,
              input: {
                ...Object.fromEntries(
                  recruitmentEditableFields('draft')
                    .filter(
                      (field) =>
                        !['minimumCents', 'maximumCents'].includes(field),
                    )
                    .map((field) => [
                      field,
                      updated[field as keyof typeof updated],
                    ]),
                ),
                privateSalaryRevisionId:
                  context.getStore()!.prepared!.privateSalaryRevisionId!,
              },
              expect: { version },
              requestId: command.requestKey,
              transaction: tx,
            },
          );
          return result.record as RecruitmentRecord;
        },
        id,
      );
    },
    async transition(
      id: string,
      transition: 'submit' | 'withdraw' | 'terminate',
      version: number,
      command: RecruitmentCommand,
      policy: RepositoryPolicy,
    ) {
      await refresh();
      return durable(
        transition,
        { id, version },
        command,
        policy,
        async (tx) => {
          if (transition === 'submit') {
            const record = await read(id, policy, tx);
            context.getStore()!.prepared = await hooks.prepare(
              record,
              command.actorId,
              new Date(),
              tx,
            );
          }
          const result = await runtime.fire(
            RECRUITMENT_LIFECYCLE,
            id,
            transition,
            {
              actor: { id: command.actorId },
              manual: true,
              input: { reason: command.reason },
              expect: { version },
              requestId: command.requestKey,
              transaction: tx,
            },
          );
          return result.record as RecruitmentRecord;
        },
        id,
      );
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      command: RecruitmentCommand,
      policy: RepositoryPolicy,
    ) {
      await refresh();
      // Check target membership before entering command replay; SDK request dedupe alone does not bind payloads.
      await read(id, policy);
      const views = await approvals.runViewsFor(RECRUITMENT_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        fail('RECRUITMENT_TARGET_MISMATCH');
      return durable(
        'action',
        { id, input },
        command,
        policy,
        async (tx) => {
          // SDK operations have their own precise actor guards; the view policy never grants reviewer authority.
          context.getStore()!.reuseOpinions = input.action !== 'return';
          await approvals.perform({ ...input, actor: { id: command.actorId } });
          if (['appoint', 'reassign'].includes(input.action))
            await d.audit.record(
              {
                actorId: command.actorId,
                action: `recruitment.${input.action}`,
                targetType: 'recruitmentRequests',
                targetId: id,
                reason: command.reason,
              },
              tx,
            );
          return (await tx
            .repository<RecruitmentRecord>('recruitmentRequests')
            .findOne({ filter: { id } }))!;
        },
        id,
      );
    },
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
      const runs = await approvals.runViewsFor(RECRUITMENT_LIFECYCLE, id);
      if (!runs.some((run) => run.tasks.some((task) => task.id === taskId)))
        fail('RECRUITMENT_TARGET_MISMATCH');
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
    async createOptions(actorId: string, policies: RecruitmentPolicies) {
      return d.db.transaction(async (tx) => {
        if (!policies.view.read || policies.write.create === false)
          fail('RECRUITMENT_FORBIDDEN');
        const departments: { id: string; name: string }[] = [];
        for (const department of (await d.departmentOptions?.(tx)) ?? []) {
          if (
            !department.active ||
            (await d.org.headOf(department.id, tx)) !== actorId ||
            !(await d.org.activeChain(department.id, tx))
          )
            continue;
          departments.push({ id: department.id, name: department.title });
        }
        const repository = tx
          .repository('recruitmentRequests')
          .withPolicy(policies.write);
        const editableFields: string[] = [];
        for (const field of recruitmentEditableFields('draft')) {
          const actualField = ['minimumCents', 'maximumCents'].includes(field)
            ? 'privateSalaryRevisionId'
            : field;
          const checked = await repository.validateMutation({
            operation: 'createOne',
            values: {
              [actualField]:
                field === 'expectedStartDate'
                  ? '2026-12-01'
                  : field === 'quantity'
                    ? 1
                    : field === 'year'
                      ? 2026
                      : field === 'replacementEmployeeIds'
                        ? []
                        : field === 'kind'
                          ? 'additional'
                          : 'candidate',
            },
          });
          if (checked.valid) editableFields.push(field);
        }
        return {
          canCreate:
            departments.length > 0 &&
            recruitmentEditableFields('draft').every((field) =>
              editableFields.includes(field),
            ),
          editableFields,
          departments,
          positions: editableFields.includes('positionId')
            ? (await d.org.listPositions(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
          grades: editableFields.includes('gradeId')
            ? (await d.org.listGrades(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
        };
      });
    },
    async createReplacementCandidates(
      actorId: string,
      query: { departmentId: string; positionId: string; search?: string },
      policies: RecruitmentPolicies,
      identities: RepositoryPolicy,
    ) {
      const options = await this.createOptions(actorId, policies);
      if (
        !options.canCreate ||
        !options.departments.some((row) => row.id === query.departmentId) ||
        !options.positions.some((row) => row.id === query.positionId)
      )
        fail('RECRUITMENT_FORBIDDEN');
      return d.db.transaction(async (tx) => {
        if (
          (await d.org.headOf(query.departmentId, tx)) !== actorId ||
          !(await d.org.activeChain(query.departmentId, tx))
        )
          fail('RECRUITMENT_FORBIDDEN');
        return d.employees.recruitmentReplacementCandidates(
          query,
          identities,
          tx,
        );
      });
    },
    async capacityOptions(
      actorId: string,
      query: {
        mode: 'create' | 'edit' | 'reviewEdit';
        requestId?: string;
        departmentId: string;
        positionId: string;
        year: number;
      },
      policies: RecruitmentPolicies,
    ) {
      if (query.mode === 'create') {
        const options = await this.createOptions(actorId, policies);
        if (
          !options.canCreate ||
          !options.departments.some((row) => row.id === query.departmentId) ||
          !options.positions.some((row) => row.id === query.positionId)
        )
          fail('RECRUITMENT_FORBIDDEN');
      } else {
        if (!query.requestId) fail('RECRUITMENT_FORBIDDEN');
        const options = await this.formOptions(
          actorId,
          query.requestId,
          query.mode,
          policies,
        );
        if (!options.editableFields.includes('accountId'))
          fail('RECRUITMENT_FIELDS_FORBIDDEN');
      }
      return d.db.transaction(async (tx) => {
        if (
          query.mode === 'create' &&
          (await d.org.headOf(query.departmentId, tx)) !== actorId
        )
          fail('RECRUITMENT_FORBIDDEN');
        if (query.mode !== 'create') {
          const record = await read(query.requestId!, policies.view, tx);
          if (!recruitmentEditableFields(record.status).includes('accountId'))
            fail('RECRUITMENT_FIELDS_FORBIDDEN');
          if (
            query.departmentId !== record.departmentId &&
            (await d.org.headOf(query.departmentId, tx)) !== actorId
          )
            fail('RECRUITMENT_FORBIDDEN');
          const target = await tx
            .repository('recruitmentRequests')
            .withPolicy(policies.write)
            .validateMutation({
              operation: 'updateOne',
              filter: { id: record.id },
              values: {
                departmentId: query.departmentId,
                positionId: query.positionId,
                year: query.year,
              },
            });
          if (!target.valid) fail('RECRUITMENT_FIELDS_FORBIDDEN');
        }
        if (!(await d.org.activeChain(query.departmentId, tx)))
          fail('RECRUITMENT_FORBIDDEN');
        const page = await d.headcounts.list(
          {
            page: 1,
            pageSize: 100,
            departmentId: query.departmentId,
            positionId: query.positionId,
            year: query.year,
          },
          tx,
          { read: true, create: false, update: false, delete: false },
        );
        return page.items
          .filter((row) => row.initialized)
          .map(({ id, departmentId, positionId, year, initialized }) => ({
            id,
            departmentId,
            positionId,
            year,
            initialized,
          }));
      });
    },
    async replacementCandidates(
      actorId: string,
      id: string,
      mode: 'edit' | 'reviewEdit',
      query: { departmentId: string; positionId: string; search?: string },
      policies: RecruitmentPolicies,
      identities: RepositoryPolicy,
    ) {
      const options = await this.formOptions(actorId, id, mode, policies);
      if (!options.editableFields.includes('replacementEmployeeIds'))
        fail('RECRUITMENT_FIELDS_FORBIDDEN');
      return d.db.transaction(async (tx) => {
        const record = await read(id, policies.view, tx);
        if (
          !recruitmentEditableFields(record.status).includes(
            'replacementEmployeeIds',
          )
        )
          fail('RECRUITMENT_FIELDS_FORBIDDEN');
        if (
          query.departmentId !== record.departmentId &&
          (await d.org.headOf(query.departmentId, tx)) !== actorId
        )
          fail('RECRUITMENT_FORBIDDEN');
        if (!(await d.org.activeChain(query.departmentId, tx)))
          fail('RECRUITMENT_FORBIDDEN');
        const target = await tx
          .repository('recruitmentRequests')
          .withPolicy(policies.write)
          .validateMutation({
            operation: 'updateOne',
            filter: { id },
            values: {
              departmentId: query.departmentId,
              positionId: query.positionId,
            },
          });
        if (!target.valid) fail('RECRUITMENT_FIELDS_FORBIDDEN');
        return d.employees.recruitmentReplacementCandidates(
          query,
          identities,
          tx,
        );
      });
    },
    async formOptions(
      actorId: string,
      id: string,
      mode: 'edit' | 'reviewEdit',
      policies: RecruitmentPolicies,
    ) {
      await refresh();
      const offers =
        mode === 'reviewEdit'
          ? await approvals.actionsFor(RECRUITMENT_LIFECYCLE, id, {
              id: actorId,
            })
          : [];
      return d.db.transaction(async (tx) => {
        const record = await read(id, policies.view, tx);
        if (mode === 'edit') {
          if (
            record.applicantId !== actorId ||
            !['draft', 'revision'].includes(record.status)
          )
            fail('RECRUITMENT_FORBIDDEN');
        } else if (
          !offers.some((offer) =>
            offer.actions.some((action) => action.name === 'approve'),
          )
        )
          fail('RECRUITMENT_NOT_CURRENT_REVIEWER');
        const repository = tx
          .repository('recruitmentRequests')
          .withPolicy(policies.write);
        const editableFields: string[] = [];
        for (const field of recruitmentEditableFields(record.status)) {
          const privateAmount = ['minimumCents', 'maximumCents'].includes(
            field,
          );
          if (privateAmount) {
            if (!policies.salary) continue;
            await read(id, policies.salary, tx);
          }
          const actualField = privateAmount ? 'privateSalaryRevisionId' : field;
          const checked = await repository.validateMutation({
            operation: 'updateOne',
            filter: { id },
            values: {
              [actualField]: record[actualField as keyof RecruitmentRecord],
            } as RepositoryRecord,
          });
          if (checked.valid) editableFields.push(field);
        }
        const department = (
          await d.org.activeChain(record.departmentId, tx)
        )?.[0];
        return {
          editableFields,
          department: department
            ? { id: department.id, name: department.title }
            : null,
          positions: editableFields.includes('positionId')
            ? (await d.org.listPositions(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
          grades: editableFields.includes('gradeId')
            ? (await d.org.listGrades(tx))
                .filter((row) => row.active)
                .map(({ id, title }) => ({ id, name: title }))
            : [],
        };
      });
    },
    async recordIdentities(
      record: Pick<
        RecruitmentRecord,
        'departmentId' | 'positionId' | 'gradeId'
      >,
    ) {
      const tx = d.db.connection();
      const [departments, positions, grades] = await Promise.all([
        d.departmentOptions?.(tx) ?? Promise.resolve([]),
        d.org.listPositions(tx),
        d.org.listGrades(tx),
      ]);
      const department = departments.find(
        (row) => row.id === record.departmentId,
      );
      const position = positions.find((row) => row.id === record.positionId);
      const grade = grades.find((row) => row.id === record.gradeId);
      return {
        department: department
          ? { id: department.id, name: department.title }
          : null,
        position: position ? { id: position.id, name: position.title } : null,
        grade: grade ? { id: grade.id, name: grade.title } : null,
      };
    },
    async detail(
      id: string,
      actorId: string,
      policy: RepositoryPolicy,
      transitionPolicy?: RepositoryPolicy,
    ) {
      await refresh();
      const record = await read(id, policy);
      const runs = await approvals.runViewsFor(RECRUITMENT_LIFECYCLE, id);
      const ids = [
        ...new Set(
          [
            record.applicantId,
            ...runs.flatMap((run) =>
              run.tasks.flatMap((task) => [task.assigneeId, task.actorId]),
            ),
            ...(record.snapshot?.hrbpIds ?? []),
            record.snapshot?.headId,
            record.snapshot?.executiveId,
            record.snapshot?.gmId,
            record.snapshot?.hrDirectorId,
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      const users = await Promise.all(
        ids.map(async (id) => {
          const user = await d.users.get(id);
          return { id, name: user?.name ?? id };
        }),
      );
      const view = await runtime.view(RECRUITMENT_LIFECYCLE, id, {
        id: actorId,
      });
      // This starts a host command; full preparation/SDK guards run only in POST.
      const canSubmit = Boolean(
        transitionPolicy &&
        transitionPolicy.update !== false &&
        record.applicantId === actorId &&
        ['draft', 'revision'].includes(record.status) &&
        (await d.db
          .repository<RecruitmentRecord>('recruitmentRequests')
          .withPolicy({
            read:
              transitionPolicy.update === true
                ? true
                : { scope: transitionPolicy.update.scope, fields: ['id'] },
            create: false,
            update: false,
            delete: false,
          })
          .findOne({ filter: { id } })) &&
        (
          await d.db
            .repository('recruitmentRequests')
            .withPolicy(transitionPolicy)
            .validateMutation({
              operation: 'updateOne',
              filter: { id },
              values: { departmentId: record.departmentId },
            })
        ).valid,
      );
      return {
        record,
        identities: await this.recordIdentities(record),
        users,
        canSubmit,
        view,
        runs,
        taskActions: await approvals.actionsFor(RECRUITMENT_LIFECYCLE, id, {
          id: actorId,
        }),
        runActions: await approvals.runActionsFor(RECRUITMENT_LIFECYCLE, id, {
          id: actorId,
        }),
        timeline: await approvals.timelineFor(RECRUITMENT_LIFECYCLE, id),
      };
    },
    async listPage(
      query: {
        page: number;
        pageSize: number;
        q?: string;
        status?: string;
        orderBy: 'createdAt' | 'statusChangedAt';
        desc: boolean;
      },
      policy: RepositoryPolicy,
    ) {
      const repository = d.db
        .repository<RecruitmentRecord>('recruitmentRequests')
        .withPolicy(policy);
      const filter = (
        f: import('@nocobase/db').FilterBuilder<RecruitmentRecord>,
      ) =>
        f.and([
          ...(query.status ? [f.string('status').eq(query.status)] : []),
          ...(query.q
            ? [
                f.or([
                  f
                    .text('jobDescription')
                    .includes(query.q, { mode: 'insensitive' }),
                  f.text('reason').includes(query.q, { mode: 'insensitive' }),
                ]),
              ]
            : []),
        ]);
      const [rows, total] = await Promise.all([
        repository.findMany({
          filter,
          sort: (s) => [
            query.desc
              ? s.field(query.orderBy).desc()
              : s.field(query.orderBy).asc(),
            s.field('id').asc(),
          ],
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
        repository.count({ filter }),
      ]);
      const items = await Promise.all(
        rows.map(async (row) => {
          const record = await read(String(row.id), policy);
          const user = await d.users.get(record.applicantId);
          return {
            ...record,
            identities: await this.recordIdentities(record),
            applicant: user ? { id: user.id, name: user.name } : null,
          };
        }),
      );
      return { items, total };
    },
    async list(policy: RepositoryPolicy) {
      const rows = await d.db
        .repository<RecruitmentRecord>('recruitmentRequests')
        .withPolicy(policy)
        .findMany({ sort: (s) => [s.field('createdAt').desc()] });
      return Promise.all(
        rows.map(async (row) => {
          const record = await read(String(row.id), policy);
          const user = record.applicantId
            ? await d.users.get(record.applicantId)
            : undefined;
          return {
            ...record,
            identities: await this.recordIdentities(record),
            applicant: user ? { id: user.id, name: user.name } : null,
          };
        }),
      );
    },
    async listForCenter(
      actorId: string,
      view: 'mine' | 'pending' | 'done' | 'copied' | 'all',
      policy: RepositoryPolicy,
    ) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const rows = await d.db
          .repository<RecruitmentRecord>('recruitmentRequests')
          .withPolicy(policy)
          .findMany({ sort: (s) => [s.field('createdAt').desc()] });
        const selected: Partial<RecruitmentRecord>[] = [];
        for (const record of rows) {
          if (
            !record.id ||
            !record.applicantId ||
            !record.status ||
            !record.createdAt ||
            !('expectedStartDate' in record)
          )
            fail('RECRUITMENT_FORBIDDEN');
          if (
            view === 'pending' &&
            rows.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              RECRUITMENT_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;
          if (view === 'mine' && record.applicantId !== actorId) continue;
          if (['pending', 'done', 'copied'].includes(view)) {
            const runs =
              view === 'pending'
                ? []
                : await runTaskViewsFor(
                    approvals,
                    RECRUITMENT_LIFECYCLE,
                    record.id,
                  );
            const tasks = runs.flatMap((run) => run.tasks);
            const match =
              view === 'done'
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
                      await approvals.actionsFor(
                        RECRUITMENT_LIFECYCLE,
                        record.id,
                        { id: actorId },
                      )
                    ).some((offer) =>
                      offer.actions.some((action) =>
                        ['approve', 'reject', 'return'].includes(action.name),
                      ),
                    );
            if (!match) continue;
          }
          selected.push(record);
        }
        return Promise.all(
          selected.map(async (record) => {
            const user = await d.users.get(record.applicantId!);
            return {
              ...record,
              // The current recruitment schema has no request number column; do not invent one.
              number: null,
              createdAt: String(record.createdAt),
              applicant: user ? { id: user.id, name: user.name } : null,
            };
          }),
        );
      });
    },
    async salary(
      id: string,
      viewPolicy: RepositoryPolicy,
      salaryPolicy: RepositoryPolicy,
    ) {
      return d.db.transaction(async (tx) => {
        const record = await read(id, viewPolicy, tx);
        await read(id, salaryPolicy, tx);
        return salary(record, tx);
      });
    },
    async maintenance() {
      await refresh();
      const report = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const pending = await d.db
        .repository<RecruitmentRecord>('recruitmentRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['head', 'hrbp', 'hrDirector', 'executive', 'gm'].map((state) =>
                f.string('status').eq(state),
              ),
            ),
        });
      for (const record of pending) {
        const runs = await approvals.runViewsFor(
          RECRUITMENT_LIFECYCLE,
          record.id,
        );
        for (const view of runs.filter((view) => isOpenRun(view.run))) {
          if (!view.tasks.length)
            await d.notifications.alarm({
              kind: RECRUITMENT_LIFECYCLE,
              recordId: record.id,
              recipients: outside.directory.roleMembers('approval.admin'),
              eventId: `hold:${view.run.id}`,
              reason: 'unassigned',
            });
          for (const task of view.tasks)
            if (
              task.status === 'pending' &&
              task.dueAt &&
              Date.parse(task.dueAt) <= Date.now() &&
              task.assigneeId &&
              !outside.directory.managerOf(task.assigneeId)
            )
              await d.notifications.alarm({
                kind: RECRUITMENT_LIFECYCLE,
                recordId: record.id,
                recipients: outside.directory.roleMembers('approval.admin'),
                eventId: `chain-top:${task.id}:${task.dueAt}`,
                reason: 'chainTop',
              });
        }
      }
      return report;
    },
  };
}
export type RecruitmentService = ReturnType<typeof createRecruitmentService>;
export const recruitmentServiceToken = createServiceToken<RecruitmentService>(
  'oa/recruitment-service',
);
