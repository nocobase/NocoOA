import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { hasApprovalCandidate } from '../approval-runtime/query-service.js';
import { randomUUID } from 'node:crypto';
import {
  defineEffect,
  type EffectDispatcher,
  type JsonObject,
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
import type { ServerFileRepositoryManager } from '@nocobase/app-plugin-file/server';
import type { NocoBaseDriveManager } from '@nocobase/drive';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type {
  CalendarService,
  RuleService,
  SequenceService,
  DictionaryService,
} from '../platform/index.js';
import type { ContractLedgerService } from '../contracts/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import { createSealLedger, existingCommand, saveCommand } from './ledger.js';
import { createSealRuntime } from './store.js';
import { sealFingerprint, type SealTypes } from './graph.js';
import {
  SEAL_KIND,
  SEAL_REQUEST_FIELDS,
  type SealRequest,
  type SealRequestInput,
  type SealAccess,
  type SealRequestService,
  type SealLedger,
  type SealReceipt,
} from './contract.js';
import { fail } from './errors.js';
import { createSealAttachments } from './attachments.js';
export interface SealDependencies {
  db: DatabaseManager;
  users: UserAdministrationService;
  audit: AuditService;
  org: OrgService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  notifications: ApprovalNotificationService;
  calendar: CalendarService;
  rules: RuleService;
  sequences: SequenceService;
  dictionaries: DictionaryService;
  contracts: ContractLedgerService;
  files: ServerFileRepositoryManager;
  drive: NocoBaseDriveManager;
  dispatcher?: EffectDispatcher;
  now?: () => Date;
}
export function createSealApplication(d: SealDependencies) {
  const clock = () => d.now?.() ?? new Date(),
    physical = createSealLedger(d),
    accessContext = new AsyncLocalStorage<SealAccess>();
  function normalize(row: SealRequest): SealRequest {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        v instanceof Date ? v.toISOString() : v,
      ]),
    ) as SealRequest;
  }
  async function read(
    id: string,
    tx: DatabaseConnection,
    policy: RepositoryPolicy,
  ): Promise<SealRequest> {
    const row = await tx
      .repository<SealRequest>('sealRequests')
      .withPolicy(policy)
      .findOne({ filter: { id } });
    if (!row) fail('REQUEST_NOT_FOUND');
    const ordinary = accessContext.getStore()?.view;
    if (ordinary) {
      const viewed = await tx
        .repository<SealRequest>('sealRequests')
        .withPolicy(ordinary)
        .findOne({ filter: { id } });
      if (!viewed || SEAL_REQUEST_FIELDS.some((f) => !(f in viewed)))
        fail('ACCESS_DENIED');
    }
    if (SEAL_REQUEST_FIELDS.some((f) => !(f in row))) fail('ACCESS_DENIED');
    return normalize(row as SealRequest);
  }
  async function raw(id: string, tx: DatabaseConnection): Promise<SealRequest> {
    const row = await tx
      .repository<SealRequest>('sealRequests')
      .findOne({ filter: { id } });
    if (!row) fail('REQUEST_NOT_FOUND');
    return normalize(row);
  }
  async function mutation(
    tx: DatabaseConnection,
    id: string,
    policy: RepositoryPolicy,
    values: Record<string, unknown>,
  ) {
    const checked = await tx
      .repository('sealRequests')
      .withPolicy(policy)
      .validateMutation({
        operation: 'updateOne',
        filter: { id },
        values: values as RepositoryRecord,
      });
    if (!checked.valid) fail('ACCESS_DENIED');
  }
  async function source(
    record: Pick<
      SealRequest,
      'contractId' | 'contractVersion' | 'contractTextVersionId'
    >,
    tx: DatabaseConnection,
    policy?: RepositoryPolicy,
    baseline = true,
  ) {
    if (!record.contractId) return null;
    if (!policy) fail('CONTRACT_ACCESS_DENIED');
    const allowed = await tx
      .repository<{
        id: string;
        number: string | null;
        status: string;
        version: number;
        facts: { textVersionId: string };
      }>('contracts')
      .withPolicy(policy)
      .findOne({ filter: { id: record.contractId } });
    if (
      !allowed ||
      ['id', 'number', 'status', 'version', 'facts'].some(
        (f) => !(f in allowed),
      )
    )
      fail('CONTRACT_ACCESS_DENIED');
    const full = await d.contracts.source(record.contractId, tx);
    if (!full || !['activePendingSeal', 'active'].includes(full.status))
      fail('CONTRACT_NOT_EFFECTIVE');
    if (
      baseline &&
      (record.contractVersion !== full.version ||
        record.contractTextVersionId !== full.facts.textVersionId)
    )
      fail('CONTRACT_VERSION_CONFLICT');
    return { version: full.version, textVersionId: full.facts.textVersionId };
  }
  async function lockSources(
    record: SealRequest | SealRequestInput,
    tx: DatabaseConnection,
    extraContractId?: string | null,
    sealId?: string | null,
  ) {
    const ids = [
      ...new Set(
        [record.contractId, extraContractId].filter((id): id is string => !!id),
      ),
    ].sort();
    if (ids.length) await d.contracts.lockSources(ids, tx);
    for (const id of [
      ...new Set(
        ['sealId' in record ? record.sealId : null, sealId].filter(
          (id): id is string => !!id,
        ),
      ),
    ].sort())
      await physical.lock(id, tx);
  }
  async function employee(actorId: string, tx: DatabaseConnection) {
    const e = await d.employees.getByUserId(actorId, tx),
      u = await d.users.withConnection(tx).get(actorId);
    if (!e?.active || e.status === 'left' || !u || u.disabledAt)
      fail('ACTIVE_EMPLOYEE_REQUIRED');
    return e;
  }
  async function validateInput(
    record: SealRequest | SealRequestInput,
    tx: DatabaseConnection,
    complete = false,
  ) {
    if (
      !Number.isInteger(record.copies) ||
      record.copies < 1 ||
      record.copies > 10000 ||
      !record.purpose.trim() ||
      record.purpose.length > 5000 ||
      record.contact.length > 2000 ||
      !Array.isArray(record.fileIds) ||
      new Set(record.fileIds).size !== record.fileIds.length ||
      record.fileIds.length > 20 ||
      (complete && !record.contractId && !record.fileIds.length)
    )
      fail('INVALID_INPUT');
    await physical.activeType(record.sealType, tx);
    if (record.external) {
      if (
        !record.returnDueAt ||
        !Number.isFinite(Date.parse(record.returnDueAt))
      )
        fail('INVALID_TIME');
    } else if (record.returnDueAt !== null) fail('INVALID_TIME');
  }
  const attachments = createSealAttachments({ ...d, read, raw, employee });
  async function contractComplete(
    record: SealRequest,
    ledgerId: string,
    actorId: string,
    tx: DatabaseConnection,
    now: Date,
  ) {
    if (!record.contractId) return;
    await source(record, tx, accessContext.getStore()?.contract);
    await d.contracts.confirmSealed(
      {
        contractId: record.contractId,
        expectedVersion: record.contractVersion!,
        sealRecordId: ledgerId,
        actorId,
        requestKey: `seal-complete:${record.id}:${ledgerId}`,
        reason: 'Confirmed actual sealing from immutable seal evidence',
        now,
      },
      () => physical.publicService.proof(ledgerId, tx),
      tx,
    );
  }
  const resultEffect = defineEffect<SealTypes>({
    name: 'oa.seal-result',
    retry: { attempts: 5, backoffMs: 1000, factor: 2 },
    run: ({ record, idempotencyKey }) =>
      d.notifications.result({
        kind: SEAL_KIND,
        recordId: record.id,
        applicantId: record.applicantId,
        state: record.status,
        transitionId: idempotencyKey,
      }),
  });
  const engine = createSealRuntime(
    d.db,
    d.directory,
    {
      calendar: d.calendar,
      operations: createOaApprovalOperations({
        org: d.org,
        db: d.db,
        calendar: d.calendar,
      }),
      submit: async (record, actorId, tx, now) => {
        await employee(actorId, tx);
        await validateInput(record, tx, true);
        await attachments.validate(record, tx);
        if (record.external && new Date(record.returnDueAt!) <= now)
          fail('INVALID_TIME');
        const department = await d.org.primaryDepartmentOf(actorId, tx);
        if (!department) fail('DEPARTMENT_REQUIRED');
        const contract = await source(
          record,
          tx,
          accessContext.getStore()?.contract,
          false,
        );
        const snapshot = await d.rules.snapshot(
          ['sla.remindHours', 'sla.escalateHours', 'sla.urgeCooldownHours'],
          now,
          tx,
        );
        if (
          snapshot['sla.remindHours'] !== 24 ||
          snapshot['sla.escalateHours'] !== 48
        )
          fail('SLA_UNSUPPORTED');
        return {
          departmentId: department.id,
          contractVersion: contract?.version ?? null,
          contractTextVersionId: contract?.textVersionId ?? null,
          ruleSnapshot: snapshot as JsonObject,
          number: record.number ?? (await d.sequences.next('SEAL', tx, now)),
          submittedAt: now.toISOString(),
          exceptionReason: null,
        };
      },
      validateEdit: async (record, tx) => {
        await validateInput(record, tx);
        await attachments.validate(record, tx);
      },
      register: async (record, actorId, tx, now) => {
        await source(record, tx, accessContext.getStore()?.contract);
        const ledger = await physical.register(record, actorId, tx, now);
        if (!record.external)
          await contractComplete(record, ledger.id, actorId, tx, now);
        return { ledgerId: ledger.id };
      },
      returnSeal: async (record, actorId, reason, tx, now) => {
        await source(record, tx, accessContext.getStore()?.contract);
        await physical.returnSeal(record, actorId, reason, tx, now);
        await contractComplete(record, record.ledgerId!, actorId, tx, now);
      },
      audit: async ({ record, actor, to, from, tx, entry, input }) => {
        if (['terminate', 'retry', 'forceComplete'].includes(entry.transition))
          await d.audit.record(
            {
              actorId: actor.id,
              action: `seal.${entry.transition}`,
              targetType: 'sealRequests',
              targetId: record.id,
              before: { status: from },
              after: { status: to },
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
      },
      notify: async (task, reason, directory) => {
        await d.notifications.task({
          task,
          reason,
          directory,
          kind: SEAL_KIND,
        });
      },
      onEnter: {
        stamping: [resultEffect],
        exception: [resultEffect],
        returnException: [resultEffect],
        completed: [resultEffect],
        administrativelyClosed: [resultEffect],
        rejected: [resultEffect],
        withdrawn: [resultEffect],
        terminated: [resultEffect],
      },
    },
    d.dispatcher,
  );
  async function run<T>(
    access: SealAccess,
    work: (tx: DatabaseConnection) => Promise<T>,
  ): Promise<T> {
    return d.db.transaction((tx) =>
      accessContext.run(access, () =>
        engine.within(tx, () => engine.write(access.requests, () => work(tx))),
      ),
    );
  }
  const requests: SealRequestService = {
    runtime: engine.runtime,
    approvalDefinition: engine.definition
      .approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    async transitions(id, actorId, access) {
      return d.db.transaction(async (tx) => {
        const record = await read(id, tx, access.view ?? access.requests);
        await employee(actorId, tx);
        return engine.within(tx, () =>
          engine.preparation(
            async () => {
              let resumeEligible =
                record.status === 'exception' &&
                record.approvedFingerprint === sealFingerprint(record) &&
                !(await tx
                  .repository('sealLedger')
                  .exists({ filter: { requestId: id } }));
              if (resumeEligible && record.contractId) {
                try {
                  await source(record, tx, access.contract);
                } catch {
                  resumeEligible = false;
                }
              }
              return { resumeEligible };
            },
            () =>
              engine.read(async () => {
                const names = [
                  'edit',
                  'submit',
                  'withdraw',
                  'terminate',
                  'retry',
                  'forceComplete',
                ];
                const allowed: string[] = [];
                for (const name of names) {
                  if (
                    (
                      await engine.runtime.can(
                        SEAL_KIND,
                        id,
                        name,
                        { id: actorId },
                        {
                          input: { reason: 'Browser transition preview' },
                        },
                      )
                    ).allowed
                  )
                    allowed.push(name);
                }
                return allowed;
              }, tx),
          ),
        );
      });
    },
    approvals: new Proxy(engine.approvals, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function'
          ? (...args: unknown[]) =>
              engine.read(
                () => Reflect.apply(value, target, args) as Promise<unknown>,
              )
          : value;
      },
    }),
    async create(actorId, input, requestKey, access) {
      return run(access, async (tx) => {
        await employee(actorId, tx);
        await validateInput(input, tx);
        await lockSources(input, tx);
        await lockUserForAdministration(tx, actorId);
        await employee(actorId, tx);
        const contract = await source(
          { ...input, contractVersion: null, contractTextVersionId: null },
          tx,
          access.contract,
          false,
        );
        const department = await d.org.primaryDepartmentOf(actorId, tx);
        if (!department) fail('DEPARTMENT_REQUIRED');
        const command = await existingCommand(
          { actorId, requestKey },
          'create',
          input,
          tx,
        );
        if (command.old) {
          const old = command.old.result as SealRequest;
          const checked = await tx
            .repository('sealRequests')
            .withPolicy(access.requests)
            .validateMutation({
              operation: 'createOne',
              values: old as unknown as RepositoryRecord,
            });
          if (!checked.valid) fail('ACCESS_DENIED');
          return read(old.id, tx, access.requests);
        }
        const id = randomUUID(),
          now = clock().toISOString();
        const record: SealRequest = {
          ...input,
          id,
          applicantId: actorId,
          createdById: actorId,
          departmentId: department.id,
          number: null,
          contractVersion: contract?.version ?? null,
          contractTextVersionId: contract?.textVersionId ?? null,
          approvedFingerprint: null,
          approvedAt: null,
          sealId: null,
          actualCopies: null,
          sealedAt: null,
          borrowedAt: null,
          returnedAt: null,
          ledgerId: null,
          exceptionReason: null,
          administrativeReason: null,
          ruleSnapshot: {},
          status: 'draft',
          lifecycleVersion: 1,
          createdAt: now,
          statusChangedAt: now,
          submittedAt: null,
        };
        const {
          status: _status,
          lifecycleVersion: _version,
          statusChangedAt: _changedAt,
          ...creation
        } = record;
        await engine.read(
          () =>
            engine.runtime.create(SEAL_KIND, creation, {
              actor: { id: actorId },
            }),
          tx,
        );
        await saveCommand(command, actorId, id, record, tx);
        return read(id, tx, access.requests);
      });
    },
    async change(
      id,
      actorId,
      transition,
      input,
      requestKey,
      expectedVersion,
      access,
    ) {
      return run(access, async (tx) => {
        const record = await read(id, tx, access.requests);
        await employee(actorId, tx);
        await lockSources(
          record,
          tx,
          typeof input.contractId === 'string' ? input.contractId : undefined,
        );
        await mutation(tx, id, access.requests, {
          lifecycleVersion: record.lifecycleVersion,
          status: record.status,
        });
        await tx
          .repository('sealRequests')
          .withPolicy(access.requests)
          .updateMany({
            filter: { id },
            values: { lifecycleVersion: { increment: 0 } },
          });
        const command = await existingCommand(
          { actorId, requestKey },
          transition,
          { id, input, expectedVersion },
          tx,
        );
        if (command.old) return read(id, tx, access.requests);
        return engine.preparation(
          async () => {
            let resumeEligible =
              record.status === 'exception' &&
              record.approvedFingerprint === sealFingerprint(record) &&
              !(await tx
                .repository('sealLedger')
                .exists({ filter: { requestId: id } }));
            if (resumeEligible && record.contractId) {
              try {
                await source(record, tx, access.contract);
              } catch {
                resumeEligible = false;
              }
            }
            return { resumeEligible };
          },
          async () => {
            await engine.read(
              () =>
                engine.runtime.fire(SEAL_KIND, id, transition, {
                  actor: { id: actorId },
                  manual: true,
                  input,
                  requestId: requestKey,
                  expect: { version: expectedVersion },
                }),
              tx,
            );
            const changed = await read(id, tx, access.requests);
            await saveCommand(command, actorId, id, changed, tx);
            return changed;
          },
        );
      });
    },
    async perform(id, actorId, input, access) {
      return run(access, async (tx) => {
        const record = await read(id, tx, access.requests);
        await employee(actorId, tx);
        await lockSources(
          record,
          tx,
          undefined,
          typeof input.input?.sealId === 'string'
            ? input.input.sealId
            : undefined,
        );
        await mutation(tx, id, access.requests, {
          lifecycleVersion: record.lifecycleVersion,
          status: record.status,
        });
        await tx
          .repository('sealRequests')
          .withPolicy(access.requests)
          .updateMany({
            filter: { id },
            values: { lifecycleVersion: { increment: 0 } },
          });
        const command = await existingCommand(
          { actorId, requestKey: input.requestId ?? '' },
          'perform',
          { id, input },
          tx,
        );
        const saved = command.old?.result as
          | {
              stage: string;
              performed: Awaited<ReturnType<SealRequestService['perform']>>;
            }
          | undefined;
        if (
          ['stamping', 'returning', 'returnException'].includes(
            saved?.stage ?? record.status,
          ) &&
          [
            'claim',
            'release',
            'assign',
            'transfer',
            'complete',
            'unable',
          ].includes(input.action) &&
          !(await d.org.hasDutyRole(actorId, 'sealKeeper', tx))
        )
          fail('KEEPER_REQUIRED');
        async function currentReviewer(reviewerId: string) {
          const stage = saved?.stage ?? record.status;
          if (
            ['legal', 'financeManager', 'gm'].includes(stage) &&
            ['approve', 'reject', 'return', 'answer'].includes(input.action)
          ) {
            const reviewer = await d.employees.getByUserId(reviewerId, tx),
              user = await d.users.withConnection(tx).get(reviewerId);
            if (
              !reviewer?.active ||
              reviewer.status === 'left' ||
              !user ||
              user.disabledAt ||
              !(await d.org.hasDutyRole(reviewerId, stage, tx))
            )
              fail('REVIEWER_REQUIRED');
          }
        }
        if (saved) {
          await currentReviewer(saved.performed.task?.assigneeId ?? actorId);
          return saved.performed;
        }
        return engine.read(async () => {
          const views = await engine.approvals.runViewsFor(SEAL_KIND, id);
          const target = input.target;
          if (
            !views.some((v) =>
              'runId' in target
                ? v.run.id === target.runId
                : v.tasks.some((t) => t.id === target.taskId),
            )
          )
            fail('TARGET_MISMATCH');
          const targetTask =
            'taskId' in target
              ? views
                  .flatMap((v) => v.tasks)
                  .find((t) => t.id === target.taskId)
              : undefined;
          await currentReviewer(targetTask?.assigneeId ?? actorId);
          const performed = await engine.approvals.perform({
            ...input,
            actor: { id: actorId },
          });
          await saveCommand(
            command,
            actorId,
            id,
            { stage: record.status, performed },
            tx,
          );
          return performed;
        }, tx);
      });
    },
    async detail(id, _actorId, policy) {
      return d.db.transaction(async (tx) => {
        const record = await read(id, tx, policy);
        return engine.within(tx, () =>
          engine.read(
            async () => ({
              record,
              tasks: await engine.approvals.tasksOf(_actorId),
              runs: await engine.approvals.runsFor(SEAL_KIND, id),
              actions: await engine.approvals.actionsOf(SEAL_KIND, id),
            }),
            tx,
          ),
        );
      });
    },
    async listForCenter(actorId, view, policy) {
      const records = await this.list(actorId, policy);
      return engine.query(async () => {
        const selected = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              engine.approvals,
              SEAL_KIND,
              record.id,
              actorId,
            ))
          )
            continue;

          if (view === 'mine' && record.applicantId !== actorId) continue;
          if (view !== 'mine') {
            const runs =
              view === 'done' || view === 'copied'
                ? await runTaskViewsFor(engine.approvals, SEAL_KIND, record.id)
                : [];
            const tasks = runs.flatMap((run) => run.tasks);
            const matches =
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
                      await engine.approvals.actionsFor(SEAL_KIND, record.id, {
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
                        ].includes(action.name),
                      ),
                    );
            if (!matches) continue;
          }
          const user = await d.users.get(record.applicantId);
          selected.push({
            ...record,
            applicant: user ? { id: user.id, name: user.name } : null,
          });
        }
        return selected;
      });
    },
    async list(_actorId, policy) {
      const rows = await d.db
        .repository<SealRequest>('sealRequests')
        .withPolicy(policy)
        .findMany({ sort: (s) => s.field('createdAt').desc() });
      if (rows.some((r) => SEAL_REQUEST_FIELDS.some((f) => !(f in r))))
        fail('ACCESS_DENIED');
      return rows.map((r) => normalize(r as SealRequest));
    },
    upload: attachments.upload,
    content: attachments.content,
    async actualReturn(id, actorId, input, access) {
      return run(access, async (tx) => {
        const record = await read(id, tx, access.requests);
        await employee(actorId, tx);
        if (
          !(await d.org.hasDutyRole(actorId, 'admin', tx)) ||
          !(await d.org.hasDutyRole(actorId, 'sealKeeper', tx))
        )
          fail('ADMIN_KEEPER_REQUIRED');
        if (
          record.status !== 'administrativelyClosed' ||
          !record.external ||
          !record.ledgerId ||
          !input.reason.trim()
        )
          fail('INVALID_RETURN');
        await lockSources(record, tx);
        await mutation(tx, id, access.requests, {
          returnedAt: input.returnedAt,
          sealedAt: input.sealedAt,
          actualCopies: input.actualCopies,
        });
        await tx
          .repository('sealRequests')
          .withPolicy(access.requests)
          .updateMany({
            filter: { id },
            values: { lifecycleVersion: { increment: 0 } },
          });
        const command = await existingCommand(
          { actorId, requestKey: input.requestKey },
          'actualReturn',
          { id, input },
          tx,
        );
        if (command.old) return command.old.result as SealReceipt;
        if (record.lifecycleVersion !== input.expectedVersion)
          fail('VERSION_CONFLICT');
        const receipt = await physical.returnSeal(
          {
            ...record,
            actualCopies: input.actualCopies,
            sealedAt: input.sealedAt,
            returnedAt: input.returnedAt,
          },
          actorId,
          input.reason,
          tx,
          clock(),
          record.contractId ? 'unconfirmed' : 'notApplicable',
        );
        // Physical custody is closed independently. Administrative exemptions never activate a current contract.
        await tx
          .repository('sealRequests')
          .withPolicy(access.requests)
          .updateOne({
            filter: {
              id,
              lifecycleVersion: input.expectedVersion,
              status: 'administrativelyClosed',
            },
            values: {
              actualCopies: receipt.actualCopies,
              sealedAt: receipt.sealedAt,
              returnedAt: receipt.returnedAt,
              lifecycleVersion: { increment: 1 },
            },
          });
        await saveCommand(command, actorId, id, receipt, tx);
        return receipt;
      });
    },
    sweep: () => engine.read(() => engine.approvals.sweep()),
    async remindOverdue(now = clock()) {
      const date = d.calendar.localDate(now),
        ledgers = await d.db
          .repository<SealLedger>('sealLedger')
          .findMany({ filter: { external: true } });
      let notified = 0,
        checked = 0;
      for (const ledger of ledgers) {
        if (
          await d.db
            .repository('sealReceipts')
            .exists({ filter: { ledgerId: ledger.id } })
        )
          continue;
        const request = await d.db.transaction((tx) =>
          raw(ledger.requestId, tx),
        );
        if (!request.returnDueAt || new Date(request.returnDueAt) > now)
          continue;
        checked++;
        const key = `${ledger.id}:${date}`,
          delivery = await d.db.transaction(async (tx) => {
            await physical.lock(ledger.sealId, tx);
            if (
              await tx
                .repository('sealReceipts')
                .exists({ filter: { ledgerId: ledger.id } })
            )
              return null;
            let row = await tx
              .repository<{ id: string; deliveredAt: Date | null }>(
                'sealReminderDeliveries',
              )
              .findOne({ filter: { id: key } });
            if (!row) {
              await tx.repository('sealReminderDeliveries').createOne({
                values: {
                  id: key,
                  ledgerId: ledger.id,
                  date,
                  deliveredAt: null,
                },
              });
              row = { id: key, deliveredAt: null };
            }
            return row;
          });
        if (!delivery || delivery.deliveredAt) continue;
        const manager = await d.employees.managerOf(ledger.applicantId),
          recipients = [
            ledger.applicantId,
            ...(manager ? [manager.userId] : []),
          ];
        const lateDate = d.calendar.addCalendarDays(
          d.calendar.localDate(new Date(request.returnDueAt)),
          3,
        );
        if (date >= lateDate)
          recipients.push(...(await d.org.dutyRoleMembers('admin')));
        await d.notifications.alarm({
          kind: SEAL_KIND,
          recordId: request.id,
          recipients: [...new Set(recipients)],
          eventId: key,
          reason: 'seal-return-overdue',
          detail: { key: 'seals.notifications.overdue' },
        });
        await d.db.transaction((tx) =>
          tx
            .repository('sealReminderDeliveries')
            .updateOne({ filter: { id: key }, values: { deliveredAt: now } }),
        );
        notified++;
      }
      return { checked, notified };
    },
  };
  return { requests, ledger: physical.publicService, engine, physical };
}
