import { z } from 'zod';
import { hasApprovalAssignment } from '../approval-runtime/query-service.js';
import { createHash, randomUUID } from 'node:crypto';
import { createServiceToken } from '@nocobase/service-provider';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  isOpenRun,
  type PerformInput,
  type ApprovalService,
  type ActionTarget,
  type PeopleQuery,
} from '@nocobase/app-plugin-approval/server';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryPolicy,
} from '@nocobase/db';
import type { EffectDispatcher, JsonObject } from '@nocobase/lifecycle';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import { VendorError, type VendorService } from '../vendors/contract.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type {
  CalendarService,
  DictionaryService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type { ContractLedgerService, ContractFacts } from './contract.js';
import { CONTRACT_KIND, type ContractRequest } from './types.js';
import { createContractRuntime } from './runtime.js';
import { reusableOpinionAction } from './opinions.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import {
  createContractSchema,
  validateActionInput,
  ruleCents,
  proposalSchema,
  type ContractCreate,
} from './validation.js';
import { commandFingerprint } from './ledger.js';
import { ContractError, fail } from './errors.js';
interface Dependencies {
  db: DatabaseManager;
  audit: AuditService;
  org: OrgService;
  employees: EmployeeService;
  users: UserAdministrationService;
  vendors: VendorService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  dictionaries: DictionaryService;
  rules: RuleService;
  sequences: SequenceService;
  ledger: ContractLedgerService;
  notifications: ApprovalNotificationService;
  dispatcher?: EffectDispatcher;
  validateFiles(record: ContractRequest, tx: DatabaseConnection): Promise<void>;
}
const fieldKeys = [
  'contractType',
  'counterparty',
  'amountCents',
  'startsOn',
  'endsOn',
  'paymentTerms',
  'standardTemplate',
  'textVersionId',
  'attachments',
  'reason',
] as const;
function proposal(record: ContractRequest) {
  return proposalSchema.parse(
    Object.fromEntries(fieldKeys.map((key) => [key, record[key]])),
  );
}
function facts(record: ContractRequest): ContractFacts {
  if (!record.textVersionId)
    fail('TEXT_REQUIRED', 'An immutable contract text is required.');
  return {
    contractType: record.contractType,
    counterparty: record.counterparty,
    startsOn: record.startsOn,
    endsOn: record.endsOn,
    paymentTerms: record.paymentTerms,
    standardTemplate: record.standardTemplate,
    textVersionId: record.textVersionId,
    attachments: record.attachments,
  };
}
export function createContractService(d: Dependencies) {
  const reuse = reusableOpinionAction(() => kit.approvals, d.audit);
  async function qualifiedVendor(id: string, tx: DatabaseConnection) {
    try {
      return await d.vendors.snapshotForContract(id, tx);
    } catch (error) {
      if (error instanceof VendorError) fail('SUPPLIER_INVALID', error.message);
      throw error;
    }
  }
  async function activeApplicant(id: string, tx: DatabaseConnection) {
    const employee = await d.employees.getByUserId(id, tx),
      department = await d.org.primaryDepartmentOf(id, tx);
    if (!employee?.active || employee.status === 'left' || !department)
      fail(
        'EMPLOYEE_REQUIRED',
        'An active employee with a primary department is required.',
      );
    return department;
  }
  const kit = createContractRuntime(
    d.db,
    d.directory,
    {
      calendar: d.calendar,
      reuseAction: reuse,
      actions: createOaApprovalOperations(d),
      async edit(record, input, _actor, tx) {
        const next = proposalSchema.parse(input);
        await d.validateFiles({ ...record, ...next }, tx);
        return { ...next, nonStandard: null };
      },
      async submit(record, actorId, tx, now) {
        const clean = proposal(record);
        if (
          !clean.reason.trim() ||
          !clean.paymentTerms.trim() ||
          !clean.textVersionId
        )
          fail(
            'INCOMPLETE_PROPOSAL',
            'A reason, payment terms and immutable text are required.',
          );
        const department = await activeApplicant(record.applicantId, tx);
        const type = await d.dictionaries.get(
          'contractType',
          clean.contractType,
          tx,
        );
        if (!type?.active)
          fail('CATEGORY_INACTIVE', 'An active contract type is required.');
        if (clean.counterparty.kind === 'vendor') {
          const vendor = await qualifiedVendor(clean.counterparty.id, tx);
          clean.counterparty = {
            kind: 'vendor',
            id: vendor.id,
            name: vendor.name,
            category: vendor.category,
          };
        }
        await d.validateFiles({ ...record, ...clean }, tx);
        const rules = await d.rules.snapshot(
          [
            'spend.vp',
            'contract.gm',
            'sla.remindHours',
            'sla.escalateHours',
            'sla.urgeCooldownHours',
          ],
          now,
          tx,
        );
        for (const key of [
          'spend.vp',
          'contract.gm',
          'sla.remindHours',
          'sla.escalateHours',
          'sla.urgeCooldownHours',
        ])
          if (
            typeof rules[key] !== 'number' ||
            !Number.isFinite(rules[key]) ||
            Number(rules[key]) < 0
          )
            fail(
              'RULE_INVALID',
              'A contract approval policy is missing or invalid.',
            );
        for (const key of ['spend.vp', 'contract.gm'])
          ruleCents(Number(rules[key]));
        if (
          rules['sla.remindHours'] !== 24 ||
          rules['sla.escalateHours'] !== 48
        )
          fail(
            'SLA_UNSUPPORTED',
            'The installed approval stage supports only the configured 24/48 hour static clock.',
          );
        if (record.operation === 'new') {
          const existing = await d.ledger.source(record.contractId, tx);
          if (!existing)
            await d.ledger.createCandidate(
              {
                actorId,
                reason: record.reason,
                requestKey: `candidate:${record.id}:${record.lifecycleVersion}`,
                id: record.contractId,
                requestId: record.id,
                applicantId: record.applicantId,
                departmentId: department.id,
                amountCents: clean.amountCents,
                facts: facts({ ...record, ...clean }),
              },
              tx,
            );
        } else {
          const source = await d.ledger.source(record.contractId, tx);
          if (
            !source ||
            source.version !== record.baseVersion ||
            !['activePendingSeal', 'active'].includes(source.status)
          )
            fail(
              'VERSION_CONFLICT',
              'The approved contract changed; explicitly rebase the revision before submission.',
            );
          if (
            BigInt(clean.amountCents) <
            BigInt(source.paidCents) + BigInt(source.heldCents)
          )
            fail(
              'AMOUNT_BELOW_COMMITTED',
              'The proposal cannot be below paid plus held payment amounts.',
            );
        }
        return {
          ...clean,
          departmentId: department.id,
          ruleSnapshot: rules as Record<string, number>,
          submittedAt: now,
          nonStandard: null,
        };
      },
      async number(record, tx) {
        const source = await d.ledger.source(record.contractId, tx);
        return (
          source?.number ??
          record.number ??
          (await d.sequences.next('CONTRACT', tx))
        );
      },
      async publish(record, actorId, tx, historical = false) {
        if (record.counterparty.kind === 'vendor')
          await qualifiedVendor(record.counterparty.id, tx);
        if (historical) {
          proposal(record);
          await d.validateFiles(record, tx);
          const type = await d.dictionaries.get(
            'contractType',
            record.contractType,
            tx,
          );
          if (!type?.active)
            fail('CATEGORY_INACTIVE', 'An active contract type is required.');
          const department = await activeApplicant(record.applicantId, tx);
          await d.ledger.createCandidate(
            {
              actorId,
              reason: record.reason,
              requestKey: `historicalCandidate:${record.id}`,
              id: record.contractId,
              requestId: record.id,
              applicantId: record.applicantId,
              departmentId: department.id,
              amountCents: record.amountCents,
              facts: facts(record),
            },
            tx,
          );
        }
        await d.ledger.publish(
          {
            actorId,
            reason: record.reason,
            requestKey: `publish:${record.id}`,
            contractId: record.contractId,
            requestId: record.id,
            baseVersion: record.baseVersion,
            number: record.number ?? (await d.sequences.next('CONTRACT', tx)),
            amountCents: record.amountCents,
            facts: facts(record),
            terminate: record.operation === 'terminate',
            historical,
          },
          tx,
        );
      },
      async discard(record, actorId, tx) {
        if (
          record.operation !== 'new' ||
          !(await d.ledger.source(record.contractId, tx))
        )
          return;
        await d.ledger.discardCandidate(
          {
            actorId,
            reason: record.reason || 'Application cancelled',
            requestKey: `discard:${record.id}`,
            contractId: record.contractId,
            requestId: record.id,
          },
          tx,
        );
      },
      async autoReuse(record, key) {
        // Durable effect captures the entered generation. Late deliveries never act on a later revision.
        const history = await kit.runtime.history(CONTRACT_KIND, record.id);
        const ownRun = history.effectRuns.find(
          (run) => `${CONTRACT_KIND}:${run.id}` === key,
        );
        const origin =
          ownRun &&
          history.transitions.find((entry) => entry.id === ownRun.transitionId);
        if (!origin)
          throw new Error('The durable reuse origin is unavailable.');
        const latest = await d.db
          .repository<ContractRequest>('contractRequests')
          .findOne({ filter: { id: record.id } });
        if (!latest || latest.lifecycleVersion < origin.version)
          throw new Error(
            'The entered generation is not committed yet; retry the durable effect.',
          );
        if (
          latest.lifecycleVersion !== origin.version ||
          latest.status !== origin.to
        )
          return;
        await kit.read(async () => {
          const run = (
            await kit.approvals.runsFor(CONTRACT_KIND, record.id)
          ).find(isOpenRun);
          if (!run) return;
          const offered = await kit.approvals.runActionsFor(
            CONTRACT_KIND,
            record.id,
            { id: record.applicantId },
          );
          if (
            !offered.some(
              (group) =>
                group.run.id === run.id &&
                group.actions.some((a) => a.name === 'reuseOpinions'),
            )
          )
            return;
          await service.action(record.id, record.applicantId, {
            target: { runId: run.id },
            action: 'reuseOpinions',
            input: {},
            requestId: `reuse:${createHash('sha256').update(key).digest('hex')}`,
            contentHash: run.contentHash,
          });
        });
      },
      result: (record, state, key) =>
        d.notifications.result({
          kind: CONTRACT_KIND,
          recordId: record.id,
          applicantId: record.applicantId,
          state,
          transitionId: key,
        }),
      taskNotice: (task, reason) =>
        d.directory.snapshot().then((directory) =>
          d.notifications.task({
            task,
            reason,
            directory,
            kind: CONTRACT_KIND,
          }),
        ),
    },
    d.dispatcher,
  );
  function policyRecord(
    row: Partial<ContractRequest> | undefined,
  ): ContractRequest {
    if (
      !row ||
      !row.id ||
      !row.applicantId ||
      !row.status ||
      typeof row.lifecycleVersion !== 'number'
    )
      fail('ACCESS_DENIED', 'The contract application is not accessible.');
    if (
      [
        ...fieldKeys,
        'contractId',
        'operation',
        'baseVersion',
        'ruleSnapshot',
        'creatorId',
        'departmentId',
      ].some((key) => !(key in row))
    )
      fail('FIELDS_RESTRICTED', 'Complete contract fields are required.');
    return { ...row, amountCents: Number(row.amountCents) } as ContractRequest;
  }
  async function read(id: string, actorId: string, policy?: RepositoryPolicy) {
    const repo = d.db.repository<ContractRequest>('contractRequests');
    const row = policyRecord(
      await (policy ? repo.withPolicy(policy) : repo).findOne({
        filter: { id },
      }),
    );
    if (policy)
      return {
        ...row,
        amountCents: Number(row.amountCents),
      } as ContractRequest;
    const directory = await d.directory.snapshot();
    if (
      row.applicantId === actorId ||
      row.creatorId === actorId ||
      [
        'legal',
        'finance',
        'financeManager',
        'cfo',
        'gm',
        'approval.admin',
      ].some((role) => directory.hasRole(actorId, role))
    )
      return {
        ...row,
        amountCents: Number(row.amountCents),
      } as ContractRequest;
    const involvement = await kit.query(() =>
      kit.approvals.involvementOf(CONTRACT_KIND, id, actorId),
    );
    if (involvement.length)
      return {
        ...row,
        amountCents: Number(row.amountCents),
      } as ContractRequest;
    fail('ACCESS_DENIED', 'The contract application is not accessible.');
  }
  async function assertWritable(
    id: string,
    tx: DatabaseConnection,
    policy: RepositoryPolicy,
    field: string,
  ) {
    const update = policy.update;
    if (
      !update ||
      (update !== true &&
        (!Array.isArray(update.fields) || !update.fields.includes(field)))
    )
      fail(
        'FIELDS_RESTRICTED',
        'The changed field is outside the granted write access.',
      );
    const row = await tx
      .repository('contractRequests')
      .withPolicy({
        ...policy,
        read: update === true ? true : { scope: update.scope, fields: ['id'] },
      })
      .findOne({ filter: { id } });
    if (!row)
      fail('ACCESS_DENIED', 'The application is outside the write scope.');
  }
  async function durable<T>(
    actorId: string,
    key: string,
    targetId: string,
    payload: unknown,
    tx: DatabaseConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 128)
      fail('REQUEST_KEY_REQUIRED', 'A bounded stable request key is required.');
    const fingerprint = commandFingerprint(payload),
      repo = tx.repository('contractCommands');
    const old = await repo.findOne({ filter: { actorId, requestKey: key } });
    if (old) {
      if (old.fingerprint !== fingerprint || old.targetId !== targetId)
        fail('IDEMPOTENCY_CONFLICT', 'This key identifies another command.');
      return old.result as T;
    }
    const result = await work();
    await repo.createOne({
      values: {
        id: randomUUID(),
        actorId,
        requestKey: key,
        targetId,
        fingerprint,
        result: result as Readonly<Record<string, unknown>>,
      },
    });
    return result;
  }
  async function mutate<T>(
    id: string,
    actorId: string,
    key: string,
    payload: unknown,
    policy: RepositoryPolicy | undefined,
    work: (tx: DatabaseConnection, record: ContractRequest) => Promise<T>,
  ) {
    const before = await read(id, actorId, policy);
    return d.db.transaction(async (tx) => {
      // Effective source first, then applicant/request/approval locks. All paths use this order.
      if (before.operation !== 'new')
        await d.ledger.lockSources([before.contractId], tx);
      await lockUserForAdministration(tx, actorId);
      const latest = await tx
        .repository<ContractRequest>('contractRequests')
        .findOne({ filter: { id } });
      if (
        !latest ||
        latest.contractId !== before.contractId ||
        latest.lifecycleVersion !== before.lifecycleVersion
      )
        fail(
          'VERSION_CONFLICT',
          'The application changed; reload before acting.',
        );
      return durable(actorId, key, id, payload, tx, () => work(tx, latest));
    });
  }
  const service = {
    initialize: async () => kit,
    approvals: {
      tasksOf: (...args: Parameters<ApprovalService['tasksOf']>) =>
        kit.read(() => kit.approvals.tasksOf(...args)),
      runsFor: (...args: Parameters<ApprovalService['runsFor']>) =>
        kit.read(() => kit.approvals.runsFor(...args)),
      actionsOf: (...args: Parameters<ApprovalService['actionsOf']>) =>
        kit.read(() => kit.approvals.actionsOf(...args)),
    },
    async sweep() {
      const report = await kit.read(() => kit.approvals.sweepReport());
      const directory = await d.directory.snapshot();
      const rows = await d.db
        .repository<ContractRequest>('contractRequests')
        .findMany();
      for (const record of rows) {
        const views = await kit.read(() =>
          kit.approvals.runViewsFor(CONTRACT_KIND, record.id),
        );
        for (const view of views) {
          if (!isOpenRun(view.run)) continue;
          const tasks = view.tasks.filter(
            (task) =>
              task.stage === record.status &&
              task.enteredVersion === record.lifecycleVersion &&
              task.depth === 0 &&
              task.kind === 'decide' &&
              !['cancelled', 'transferred', 'voided'].includes(task.status),
          );
          const expected = record.status === 'legalFinance' ? 2 : 1;
          if (new Set(tasks.map((task) => task.order)).size < expected)
            await d.notifications.alarm({
              kind: CONTRACT_KIND,
              recordId: record.id,
              recipients: directory.roleMembers('approval.admin'),
              eventId: `hold:${view.run.id}:${record.lifecycleVersion}`,
              reason: 'unassigned',
            });
        }
      }
      return report;
    },
    async create(
      input: ContractCreate,
      actorId: string,
      key: string,
      policy?: RepositoryPolicy,
      sourcePolicy?: RepositoryPolicy,
    ) {
      const clean = createContractSchema.parse(input);
      return d.db.transaction(async (tx) => {
        if (clean.contractId)
          await d.ledger.lockSources([clean.contractId], tx);
        await lockUserForAdministration(tx, actorId);
        const department = await activeApplicant(actorId, tx);
        if (clean.contractId) {
          if (sourcePolicy) {
            const readable = await tx
              .repository('contracts')
              .withPolicy(sourcePolicy)
              .findOne({ filter: { id: clean.contractId } });
            if (
              !readable ||
              !Object.hasOwn(readable, 'version') ||
              !Object.hasOwn(readable, 'status')
            )
              fail(
                'ACCESS_DENIED',
                'The selected contract source is outside the ledger read grant.',
              );
          }
          const source = await d.ledger.source(clean.contractId, tx);
          if (
            !source ||
            source.version !== clean.baseVersion ||
            !['active', 'activePendingSeal'].includes(source.status)
          )
            fail(
              'VERSION_CONFLICT',
              'The selected approved source version is unavailable.',
            );
        }
        return durable(
          actorId,
          key,
          'create',
          { action: 'create', clean },
          tx,
          async () => {
            const id = randomUUID();
            const create = () =>
              kit.read(
                () =>
                  kit.runtime.create(
                    CONTRACT_KIND,
                    {
                      ...clean.proposal,
                      id,
                      creatorId: actorId,
                      applicantId: actorId,
                      departmentId: department.id,
                      number: null,
                      operation: clean.operation,
                      contractId: clean.contractId ?? randomUUID(),
                      baseVersion: clean.baseVersion,
                      ruleSnapshot: {},
                      nonStandard: null,
                      createdAt: new Date().toISOString(),
                      submittedAt: null,
                    },
                    { actor: { id: actorId }, transaction: tx },
                  ),
                tx,
              );
            return policy ? kit.write(policy, create) : create();
          },
        );
      });
    },
    async transition(
      id: string,
      actorId: string,
      name: string,
      input: JsonObject,
      key: string,
      version: number,
      policy?: RepositoryPolicy,
      mutationPolicy?: RepositoryPolicy,
    ) {
      if (name === 'rebase' || name === 'historicalEntry')
        fail(
          'TRANSITION_NOT_ALLOWED',
          'Use the dedicated guarded business operation.',
        );
      if (name === 'edit') proposalSchema.parse(input);
      else if (Object.keys(input).some((key) => key !== 'reason'))
        fail(
          'INPUT_INVALID',
          'Only the declared transition fields are accepted.',
        );
      return mutate(
        id,
        actorId,
        key,
        { action: name, input, version },
        policy,
        (tx) => {
          const fire = () =>
            kit.read(
              () =>
                kit.runtime.fire(CONTRACT_KIND, id, name, {
                  input,
                  expect: { version },
                  manual: true,
                  requestId: key,
                  actor: { id: actorId },
                  transaction: tx,
                }),
              tx,
            );
          return mutationPolicy ? kit.write(mutationPolicy, fire) : fire();
        },
      );
    },
    async action(
      id: string,
      actorId: string,
      input: Omit<PerformInput, 'actor'>,
      policy?: RepositoryPolicy,
    ) {
      // SDK perform has no transaction option. Trusted public store adapter joins this caller via within.
      if (
        ![
          'approve',
          'reject',
          'return',
          'claim',
          'comment',
          'read',
          'transfer',
          'addSigner',
          'urge',
          'appoint',
          'reassign',
          'reuseOpinions',
        ].includes(input.action)
      )
        fail(
          'ACTION_NOT_ALLOWED',
          'This action is unavailable for contract applications.',
        );
      validateActionInput(input.action, input.input);
      const target = input.target;
      const views = await kit.read(() =>
        kit.approvals.runViewsFor(CONTRACT_KIND, id),
      );
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        fail(
          'TARGET_MISMATCH',
          'The action target belongs to another document.',
        );
      return mutate(
        id,
        actorId,
        input.requestId ?? '',
        { action: 'approval', input },
        policy,
        async (tx) =>
          kit.read(
            () =>
              kit.within(tx, () =>
                kit.approvals.perform({ ...input, actor: { id: actorId } }),
              ),
            tx,
          ),
      );
    },
    async candidates(
      id: string,
      actorId: string,
      target: ActionTarget,
      action: string,
      query: PeopleQuery,
      policy: RepositoryPolicy,
    ) {
      await read(id, actorId, policy);
      return kit.read(async () => {
        const detail = await kit.approvals.runViewsFor(CONTRACT_KIND, id);
        const targetId = 'taskId' in target ? target.taskId : target.runId;
        if (
          !detail.some(
            (run) =>
              run.run.id === targetId ||
              run.tasks.some((task) => task.id === targetId),
          )
        )
          fail(
            'TARGET_MISMATCH',
            'The approval target belongs to another application.',
          );
        const page = await kit.approvals.candidatesFor({
          target,
          action,
          actor: { id: actorId },
          query,
        });
        return {
          people: await Promise.all(
            page.people.map(async (person) => ({
              id: person,
              name: (await d.users.get(person))?.name ?? person,
            })),
          ),
          nextOffset: page.nextOffset,
        };
      });
    },
    async printDetail(id: string, actorId: string, policy: RepositoryPolicy) {
      const detail = await service.detail(id, actorId, policy);
      return {
        record: detail.record,
        users: detail.knownUsers,
        runs: detail.runs,
        timeline: detail.timeline,
      };
    },
    async detail(id: string, actorId: string, policy?: RepositoryPolicy) {
      const record = await read(id, actorId, policy);
      return kit.read(async () => {
        const runs = await kit.approvals.runViewsFor(CONTRACT_KIND, id);
        const ids = [
          ...new Set([
            record.applicantId,
            record.creatorId,
            ...runs.flatMap((run) =>
              run.tasks.flatMap((task) => [
                task.assigneeId,
                ...(task.actorId ? [task.actorId] : []),
              ]),
            ),
          ]),
        ];
        const knownUsers = await Promise.all(
          ids.map(async (userId) => ({
            id: userId,
            name: (await d.users.get(userId))?.name ?? userId,
          })),
        );
        return {
          record: {
            ...record,
            applicant: knownUsers.find((u) => u.id === record.applicantId)!,
            creator: knownUsers.find((u) => u.id === record.creatorId)!,
          },
          knownUsers,
          runs,
          view: await kit.runtime.view(CONTRACT_KIND, id, { id: actorId }),
          actions: await kit.approvals.actionsFor(CONTRACT_KIND, id, {
            id: actorId,
          }),
          runActions: await kit.approvals.runActionsFor(CONTRACT_KIND, id, {
            id: actorId,
          }),
          timeline: await kit.approvals.timelineFor(CONTRACT_KIND, id),
          upcoming: await kit.approvals.upcomingStagesFor(CONTRACT_KIND, id, {
            id: actorId,
          }),
          timeZone: d.calendar.timeZone(),
        };
      });
    },
    async historicalEntry(
      id: string,
      actorId: string,
      key: string,
      version: number,
      policy: RepositoryPolicy,
      mutationPolicy: RepositoryPolicy,
    ) {
      return mutate(
        id,
        actorId,
        key,
        { action: 'historicalEntry', version },
        policy,
        async (tx, record) => {
          if (
            !record.reason.trim() ||
            !record.paymentTerms.trim() ||
            !record.textVersionId
          )
            fail(
              'INCOMPLETE_PROPOSAL',
              'A historical record requires a reason, terms and immutable text.',
            );
          const fire = () =>
            kit.within(tx, () =>
              kit.runtime.fire(CONTRACT_KIND, id, 'historicalEntry', {
                actor: { id: actorId },
                transaction: tx,
                expect: { version },
                requestId: key,
                manual: true,
                input: {},
              }),
            );
          return kit.write(mutationPolicy, fire);
        },
      );
    },
    /** Only the selected immutable text mapping is public; draft uploads remain governed by File Repository. */
    async selectedText(id: string, actorId: string, policy: RepositoryPolicy) {
      const record = await read(id, actorId, policy);
      if (!record.textVersionId) return { textVersion: null };
      const text = await d.db.repository('contractTextVersions').findOne({
        filter: { id: record.textVersionId, requestId: id },
        select: (s) => s.fields('id', 'requestId', 'fileId', 'version'),
      });
      if (
        !text ||
        typeof text.id !== 'string' ||
        typeof text.fileId !== 'string'
      )
        fail(
          'TEXT_INVALID',
          'The selected immutable contract text is unavailable.',
        );
      return {
        textVersion: {
          id: text.id,
          requestId: id,
          fileId: text.fileId,
          version: Number(text.version),
        },
      };
    },
    async appendText(
      id: string,
      actorId: string,
      fileId: string,
      key: string,
      policy: RepositoryPolicy,
      mutationPolicy: RepositoryPolicy = policy,
    ) {
      return mutate(
        id,
        actorId,
        key,
        { action: 'appendText', fileId },
        policy,
        async (tx, record) => {
          if (
            !['draft', 'revision'].includes(record.status) ||
            record.applicantId !== actorId
          )
            fail(
              'TEXT_NOT_EDITABLE',
              'Only the applicant may append text in a draft or revision.',
            );
          await assertWritable(id, tx, mutationPolicy, 'textVersionId');
          const file = await tx.repository('contractAttachmentFiles').findOne({
            filter: { id: fileId, requestId: id, purpose: 'text' },
          });
          if (!file || file.ext !== 'pdf')
            fail(
              'TEXT_INVALID',
              'Select a PDF uploaded for this application text.',
            );
          const existing = await tx
            .repository('contractTextVersions')
            .findMany({ filter: { requestId: id } });
          const version =
            existing.reduce(
              (max, row) => Math.max(max, Number(row.version)),
              0,
            ) + 1;
          const text = {
            id: randomUUID(),
            requestId: id,
            fileId,
            version,
            actorId,
            at: new Date(),
          };
          await tx
            .repository('contractTextVersions')
            .createOne({ values: text });
          await d.audit.record(
            {
              actorId,
              action: 'contract.appendText',
              targetType: 'contractRequests',
              targetId: id,
              before: null,
              after: text,
              reason: 'Append immutable contract text version',
            },
            tx,
          );
          return { textVersion: text };
        },
      );
    },
    async rebase(
      id: string,
      actorId: string,
      key: string,
      version: number,
      policy: RepositoryPolicy,
      mutationPolicy: RepositoryPolicy = policy,
    ) {
      return mutate(
        id,
        actorId,
        key,
        { action: 'rebase', version },
        policy,
        async (tx, record) => {
          if (
            record.operation === 'new' ||
            record.status !== 'revision' ||
            record.applicantId !== actorId
          )
            fail(
              'REBASE_NOT_ALLOWED',
              'Only an applicant revision may explicitly rebase.',
            );
          await assertWritable(id, tx, mutationPolicy, 'baseVersion');
          const source = await d.ledger.source(record.contractId, tx);
          if (!source || source.status === 'terminated')
            fail('INACTIVE_SOURCE', 'The approved source is unavailable.');
          return kit.within(tx, () =>
            kit.runtime.fire(CONTRACT_KIND, id, 'rebase', {
              actor: { id: actorId },
              transaction: tx,
              expect: { version },
              requestId: key,
              manual: true,
              input: { baseVersion: source.version },
            }),
          );
        },
      );
    },
    async options(
      actorId: string,
      vendorPolicy: RepositoryPolicy,
      ledgerPolicy: RepositoryPolicy,
    ) {
      const department = await d.org.primaryDepartmentOf(actorId),
        user = await d.users.get(actorId);
      const sources = await d.db
        .repository('contracts')
        .withPolicy(ledgerPolicy)
        .findMany();
      if (
        sources.some((source) =>
          ['id', 'number', 'version', 'amountCents', 'status'].some(
            (field) => !Object.hasOwn(source, field),
          ),
        )
      )
        fail(
          'FIELDS_RESTRICTED',
          'The approved source selector requires its public identity, amount, status and version fields.',
        );
      const employee = await d.employees.getByUserId(actorId);
      return {
        eligible:
          !!employee?.active && employee.status !== 'left' && !!department,
        applicant: { id: actorId, name: user?.name ?? actorId },
        department: department
          ? { id: department.id, name: department.title }
          : null,
        timeZone: d.calendar.timeZone(),
        contractTypes: await d.dictionaries.list('contractType'),
        vendors: (await d.vendors.options(undefined, vendorPolicy)).filter(
          (v) => v.active && v.status === 'qualified',
        ),
        contracts: sources
          .filter((s) =>
            ['activePendingSeal', 'active'].includes(
              typeof s.status === 'string' ? s.status : '',
            ),
          )
          .map((s) => ({
            id: s.id,
            number: s.number,
            version: s.version,
            amountCents: Number(s.amountCents),
            status: s.status,
          })),
      };
    },
    async ledgerDetail(
      id: string,
      policy: RepositoryPolicy,
      versionPolicy: RepositoryPolicy,
    ) {
      const row = await d.db
        .repository('contracts')
        .withPolicy(policy)
        .findOne({ filter: { id } });
      if (!row)
        fail(
          'ACCESS_DENIED',
          'The approved contract is outside the granted ledger scope.',
        );
      if (
        [
          'id',
          'version',
          'status',
          'amountCents',
          'facts',
          'number',
          'requestId',
          'applicantId',
          'departmentId',
        ].some((field) => !(field in row))
      )
        fail(
          'FIELDS_RESTRICTED',
          'Complete approved ledger fields are required.',
        );
      const current = await d.db.transaction((tx) => d.ledger.source(id, tx));
      if (!current || current.status === 'underApproval')
        fail(
          'INACTIVE_SOURCE',
          'The contract is not an effective approved source.',
        );
      const versions = await d.db
        .repository('contractVersions')
        .withPolicy(versionPolicy)
        .findMany({
          filter: { contractId: id },
          sort: (s) => s.field('version').asc(),
        });
      return {
        timeZone: d.calendar.timeZone(),
        contract: {
          ...current,
          ...(row.updatedAt instanceof Date || typeof row.updatedAt === 'string'
            ? { updatedAt: row.updatedAt }
            : {}),
        },
        versions: await Promise.all(
          versions.map(async (v) => ({
            ...v,
            amountCents: Number(v.amountCents),
            ...(typeof v.actorId === 'string'
              ? {
                  actor: {
                    id: v.actorId,
                    name: (await d.users.get(v.actorId))?.name ?? v.actorId,
                  },
                }
              : {}),
          })),
        ),
        applicant: {
          id: current.applicantId,
          name:
            (await d.users.get(current.applicantId))?.name ??
            current.applicantId,
        },
      };
    },
    /** Report-only DTO: ledger and ordinary request read scopes/fields must both apply.
     * Dates come from the current immutable source, never mutable request proposals.
     */
    async reportList(
      query: {
        page: number;
        pageSize: number;
        search?: string;
        status?: string;
        endsBefore?: string;
      },
      ledgerPolicy: RepositoryPolicy,
      versionPolicy: RepositoryPolicy,
      viewPolicy: RepositoryPolicy,
    ) {
      const sources = await d.db
        .repository('contracts')
        .withPolicy(ledgerPolicy)
        .findMany({
          sort: (s) => [s.field('updatedAt').desc(), s.field('id').desc()],
        });
      const asOf = d.calendar.localDate(new Date());
      const data = [];
      for (const source of sources) {
        if (
          ['id', 'requestId', 'status', 'number'].some(
            (field) => !(field in source),
          )
        )
          fail(
            'FIELDS_RESTRICTED',
            'Report source selectors are outside the read policy.',
          );
        if (
          source.status === 'underApproval' ||
          (query.status && source.status !== query.status)
        )
          continue;
        if (
          query.search &&
          !(typeof source.number === 'string' ? source.number : '')
            .toLocaleLowerCase()
            .includes(query.search.trim().toLocaleLowerCase())
        )
          continue;
        if (
          typeof source.requestId !== 'string' ||
          typeof source.id !== 'string'
        )
          fail(
            'FIELDS_RESTRICTED',
            'Report source identities are outside the read policy.',
          );
        const request = await d.db
          .repository('contractRequests')
          .withPolicy(viewPolicy)
          .findOne({ filter: { id: source.requestId } });
        if (!request) continue;
        if (
          [
            'id',
            'startsOn',
            'endsOn',
            'amountCents',
            'departmentId',
            'number',
            'status',
          ].some((field) => !(field in request))
        )
          fail(
            'FIELDS_RESTRICTED',
            'Contract dates and amount are outside the ordinary view policy.',
          );
        const { contract } = await service.ledgerDetail(
          source.id,
          ledgerPolicy,
          versionPolicy,
        );
        const immutable = await d.db
          .repository('contractVersions')
          .withPolicy(versionPolicy)
          .findOne({
            filter: { contractId: contract.id, version: contract.version },
          });
        if (!immutable)
          fail(
            'ACCESS_DENIED',
            'The current immutable version is outside the read policy.',
          );
        if (
          ['id', 'facts', 'amountCents', 'status'].some(
            (field) => !(field in immutable),
          )
        )
          fail(
            'FIELDS_RESTRICTED',
            'The immutable version report fields are outside the read policy.',
          );
        const dates = z
          .object({ startsOn: z.iso.date(), endsOn: z.iso.date() })
          .safeParse(immutable.facts);
        if (!dates.success)
          fail('INVALID_FACTS', 'The immutable contract dates are invalid.');
        const { startsOn, endsOn } = dates.data;
        if (query.endsBefore && endsOn > query.endsBefore) continue;
        data.push({
          id: contract.id,
          number: contract.number,
          departmentId: contract.departmentId,
          status: contract.status,
          amountCents: contract.amountCents,
          heldCents: contract.heldCents,
          paidCents: contract.paidCents,
          availableCents: contract.availableCents,
          startsOn,
          endsOn,
          asOf,
          expiryState:
            contract.status === 'terminated'
              ? ('terminated' as const)
              : endsOn < asOf
                ? ('expired' as const)
                : ('current' as const),
          paymentState:
            contract.paidCents > contract.amountCents
              ? ('overpaid' as const)
              : contract.paidCents === contract.amountCents
                ? ('paid' as const)
                : contract.paidCents > 0
                  ? ('partial' as const)
                  : ('unpaid' as const),
          // Integer basis points, with zero-value contracts explicitly undefined.
          paidBasisPoints:
            contract.amountCents === 0
              ? null
              : Number(
                  (BigInt(contract.paidCents) * 10000n) /
                    BigInt(contract.amountCents),
                ),
        });
      }
      return {
        data: data.slice(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize,
        ),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: data.length,
        },
      };
    },
    async ledgerList(
      query: {
        page: number;
        pageSize: number;
        search?: string;
        status?: string;
        sort?: 'updatedAt' | 'number' | 'amountCents';
        direction?: 'asc' | 'desc';
      },
      policy: RepositoryPolicy,
      versionPolicy: RepositoryPolicy,
    ) {
      const rows = await d.db
        .repository('contracts')
        .withPolicy(policy)
        .findMany({
          sort: (s) =>
            query.direction === 'asc'
              ? [s.field(query.sort ?? 'updatedAt').asc(), s.field('id').asc()]
              : [
                  s.field(query.sort ?? 'updatedAt').desc(),
                  s.field('id').desc(),
                ],
        });
      const data = [];
      for (const row of rows) {
        if (
          row.status === 'underApproval' ||
          (query.status && row.status !== query.status)
        )
          continue;
        if (
          query.search &&
          !(typeof row.number === 'string' ? row.number : '')
            .toLocaleLowerCase()
            .includes(query.search.trim().toLocaleLowerCase())
        )
          continue;
        data.push(
          (
            await service.ledgerDetail(
              typeof row.id === 'string'
                ? row.id
                : fail(
                    'STORED_ID_INVALID',
                    'Stored ledger identity is invalid.',
                  ),
              policy,
              versionPolicy,
            )
          ).contract,
        );
      }
      const page = Math.min(
        query.page,
        Math.max(1, Math.ceil(data.length / query.pageSize)),
      );
      return {
        data: data.slice((page - 1) * query.pageSize, page * query.pageSize),
        meta: {
          page,
          pageSize: query.pageSize,
          total: data.length,
          timeZone: d.calendar.timeZone(),
        },
      };
    },
    async listForCenter(
      actorId: string,
      view: 'all' | 'pending' | 'done' | 'copied',
      policy: RepositoryPolicy,
    ) {
      const rows = await d.db
        .repository<ContractRequest>('contractRequests')
        .withPolicy(policy)
        .findMany({
          sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
        });
      const result: ContractRequest[] = [];
      for (const row of rows) {
        if (typeof row.id !== 'string')
          fail('STORED_ID_INVALID', 'Stored ledger identity is invalid.');
        const record = policyRecord(row);
        if (view === 'all') {
          result.push(record);
          continue;
        }
        if (
          !(await hasApprovalAssignment(
            kit.approvals,
            CONTRACT_KIND,
            record.id,
            actorId,
          ))
        )
          continue;
        const tasks = await kit.read(() =>
          kit.approvals.tasksFor(CONTRACT_KIND, record.id),
        );
        if (
          tasks.some(
            (task) =>
              task.assigneeId === actorId &&
              (view === 'copied'
                ? task.role === 'info'
                : task.role !== 'info' &&
                  (view === 'done'
                    ? task.status === 'completed'
                    : ['pending', 'claimed', 'candidate'].includes(
                        task.status,
                      ))),
          )
        )
          result.push(record);
      }
      return Promise.all(
        result.map(async (record) => ({
          ...record,
          applicant: {
            id: record.applicantId,
            name:
              (await d.users.get(record.applicantId))?.name ??
              record.applicantId,
          },
          creator: {
            id: record.creatorId,
            name:
              (await d.users.get(record.creatorId))?.name ?? record.creatorId,
          },
        })),
      );
    },
    async list(
      actorId: string,
      query: {
        view: 'mine' | 'pending' | 'done' | 'copied';
        page: number;
        pageSize: number;
        search?: string;
        status?: string;
        sort: 'createdAt' | 'number' | 'amountCents';
        direction: 'asc' | 'desc';
      },
      policy: RepositoryPolicy,
    ) {
      let rows = await service.listForCenter(
        actorId,
        query.view === 'mine' ? 'all' : query.view,
        policy,
      );
      if (query.view === 'mine')
        rows = rows.filter(
          (r) => r.applicantId === actorId || r.creatorId === actorId,
        );
      if (query.status) rows = rows.filter((r) => r.status === query.status);
      const search = query.search?.trim().toLocaleLowerCase();
      if (search)
        rows = rows.filter((r) =>
          [r.number ?? '', r.counterparty.name, r.reason].some((v) =>
            v.toLocaleLowerCase().includes(search),
          ),
        );
      rows.sort((a, b) => {
        const left =
          query.sort === 'amountCents'
            ? a.amountCents
            : query.sort === 'number'
              ? (a.number ?? '')
              : new Date(a.createdAt).getTime();
        const right =
          query.sort === 'amountCents'
            ? b.amountCents
            : query.sort === 'number'
              ? (b.number ?? '')
              : new Date(b.createdAt).getTime();
        const cmp = left < right ? -1 : left > right ? 1 : 0;
        return (
          (cmp || a.id.localeCompare(b.id)) *
          (query.direction === 'asc' ? 1 : -1)
        );
      });
      const page = Math.min(
        query.page,
        Math.max(1, Math.ceil(rows.length / query.pageSize)),
      );
      return {
        data: rows.slice((page - 1) * query.pageSize, page * query.pageSize),
        meta: {
          page,
          pageSize: query.pageSize,
          total: rows.length,
          timeZone: d.calendar.timeZone(),
        },
      };
    },
    async readableIds(actorId: string) {
      const ids: string[] = [];
      for (const row of await d.db
        .repository<ContractRequest>('contractRequests')
        .findMany()) {
        try {
          await read(row.id, actorId);
          ids.push(row.id);
        } catch (error) {
          if (
            !(error instanceof ContractError) ||
            error.code !== 'CONTRACT_ACCESS_DENIED'
          )
            throw error;
        }
      }
      return ids;
    },
  };
  return service;
}
export type ContractService = ReturnType<typeof createContractService>;
export const contractHttpServiceToken = createServiceToken<ContractService>(
  'oa/contract-http-service',
);
