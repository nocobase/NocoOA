import {
  hasApprovalCandidate,
  createAppApprovalService,
  hasApprovalTaskActor,
} from '../approval-runtime/query-service.js';
import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import { createHash } from 'node:crypto';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
  type Approval,
  type PerformInput,
} from '@nocobase/app-plugin-approval/server';
import {
  LifecycleRuntime,
  type JsonObject,
  type EffectDispatcher,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import type { ApprovalDirectoryService } from '../approval-directory/contract.js';
import type {
  CalendarService,
  DictionaryService,
  RuleService,
  SequenceService,
} from '../platform/index.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type { AssetService, StockPhase } from '../assets/contract.js';
import { AssetError } from '../assets/errors.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import {
  ASSET_REQUEST_LIFECYCLE,
  type AssetRequestRecord,
  type AssetRequestInput,
} from './contract.js';
import { assetRequestApproval, assetRequestFingerprint } from './approval.js';
import { createAssetRequestStore } from './store.js';
import { createAssetRequestJournal } from './journal.js';
import { createAssetBorrowReminders } from './reminders.js';
import { projectAssetApprovalJson } from './projection.js';
import { createAssetRequestStockSource } from './stock-source.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import {
  assetRequestInputSchema,
  assetUnitsSchema,
  validateAssetSubmission,
} from './validation.js';
export interface AssetRequestDependencies {
  dispatcher?: EffectDispatcher;
  users: UserAdministrationService;
  db: DatabaseManager;
  audit: AuditService;
  org: OrgService;
  employees: EmployeeService;
  directory: ApprovalDirectoryService;
  calendar: CalendarService;
  dictionaries: DictionaryService;
  rules: RuleService;
  sequences: SequenceService;
  notifications: ApprovalNotificationService;
  assets: AssetService;
  /** Validate linked secure photo IDs in the actual record transaction; supplied by the attachment adapter. */
  remindersEnabled?: () => boolean;
  validatePhotos: (
    record: AssetRequestRecord,
    tx: DatabaseConnection,
  ) => Promise<void>;
}
export function createAssetRequestService(d: AssetRequestDependencies) {
  const store = createAssetRequestStore(d.db, d.directory),
    journal = createAssetRequestJournal(d.db, d.audit),
    stock = createAssetRequestStockSource();
  async function getFull(id: string, tx: DatabaseConnection) {
    const row = await tx
      .repository<AssetRequestRecord>('assetRequests')
      .findOne({ filter: { id } });
    if (!row)
      throw new AssetError(
        'ASSET_REQUEST_NOT_FOUND',
        'Asset request not found.',
        'notFound',
      );
    return {
      ...row,
      originalValueCents:
        row.originalValueCents === null ? null : Number(row.originalValueCents),
    };
  }
  function projectAmount<T extends Partial<AssetRequestRecord>>(
    row: T | null,
  ): T | null {
    if (
      !row ||
      row.originalValueCents === undefined ||
      row.originalValueCents === null
    )
      return row;
    const originalValueCents = Number(row.originalValueCents);
    if (!Number.isSafeInteger(originalValueCents) || originalValueCents < 0)
      throw new AssetError(
        'ASSET_INVALID_AMOUNT',
        'The stored asset value is invalid.',
      );
    return { ...row, originalValueCents };
  }
  async function read(id: string, policy?: RepositoryPolicy) {
    const repo = d.db.repository<AssetRequestRecord>('assetRequests');
    return projectAmount(
      (await (policy ? repo.withPolicy(policy) : repo).findOne({
        filter: { id },
      })) ?? null,
    );
  }
  async function requireRead(id: string, policy?: RepositoryPolicy) {
    const row = await read(id, policy);
    if (!row)
      throw new AssetError(
        'ASSET_REQUEST_NOT_FOUND',
        'Asset request not found.',
        'notFound',
      );
    return row;
  }
  async function stockWrite(
    record: AssetRequestRecord,
    actorId: string,
    phase: StockPhase,
    key: string,
    reason: string,
    tx: DatabaseConnection,
  ) {
    const command = { sourceId: record.id, actorId, reason, requestKey: key };
    return stock.perform(
      {
        sourceId: record.id,
        actorId,
        phase,
        administrativeScrap: record.ruleSnapshot?.administrativeScrap === true,
      },
      async () => {
        if (phase === 'reserve') return d.assets.reserve(command, tx);
        if (phase === 'release') return d.assets.release(command, tx);
        if (phase === 'issue')
          return d.assets.issue(
            { ...command, units: assetUnitsSchema.parse(record.handlingUnits) },
            tx,
          );
        if (phase === 'return')
          return d.assets.returnIssued(
            { ...command, units: assetUnitsSchema.parse(record.handlingUnits) },
            tx,
          );
        return d.assets.scrap(command, tx);
      },
    );
  }
  async function canResume(record: AssetRequestRecord, tx: DatabaseConnection) {
    await tx.repository('assetRequests').updateMany({
      filter: { id: record.id },
      values: { lifecycleVersion: { increment: 0 } },
    });
    return (
      (await d.assets.stockFacts(record.id, tx)).held.length ===
        record.quantity && (await d.assets.reservationCurrent(record.id, tx))
    );
  }
  const graph = assetRequestApproval({
    operations: createOaApprovalOperations({
      db: d.db,
      org: d.org,
      calendar: d.calendar,
    }),
    calendar: d.calendar,
    submit: async ({ record, services, now, actor }) => {
      const tx = services.connection;
      await lockUserForAdministration(tx, record.applicantId);
      const { employee, administrativeScrap } = await validateAssetSubmission(
        record,
        d,
        services.directory,
        tx,
        now,
      );
      await d.validatePhotos(record, tx);
      const department = await d.org.primaryDepartmentOf(
        record.applicantId,
        tx,
      );
      if (!department)
        throw new AssetError(
          'ASSET_DEPARTMENT_MISSING',
          'An active primary department is required.',
        );
      const head = await d.org.headOf(department.id, tx);
      if (!head || !services.directory.isActive(head))
        throw new AssetError(
          'ASSET_HEAD_MISSING',
          'An active department head is required.',
        );
      const unchanged =
        record.status === 'exception' &&
        record.approvedFingerprint === assetRequestFingerprint(record) &&
        (await canResume(record, tx));
      const rules =
        record.ruleSnapshot ??
        (await d.rules.snapshot(
          [
            'asset.scrapGm',
            'sla.remindHours',
            'sla.escalateHours',
            'sla.urgeCooldownHours',
          ],
          now,
          tx,
        ));
      if (rules['sla.remindHours'] !== 24 || rules['sla.escalateHours'] !== 48)
        throw new AssetError(
          'ASSET_SLA_UNSUPPORTED',
          'This release supports the default working-hour approval clocks only.',
        );
      const ruleSnapshot = { ...rules, administrativeScrap };
      // Persist validated source identities before public inventory reads them. This joins the lifecycle transaction;
      // any later CAS, policy, stock or audit failure rolls it back with the transition.
      await tx.repository('assetRequests').updateMany({
        filter: { id: record.id },
        values: {
          employeeId: employee.id,
          departmentId: department.id,
          headApproverId: head,
          ruleSnapshot,
        },
      });
      let allocation = unchanged
        ? (await d.assets.stockFacts(record.id, tx)).held
        : null;
      if (!unchanged) {
        if ((await d.assets.stockFacts(record.id, tx)).held.length)
          await stockWrite(
            { ...record, employeeId: employee.id, ruleSnapshot },
            actor.id,
            'release',
            `release-resubmit:${record.lifecycleVersion}`,
            'Replace reviewed inventory allocation',
            tx,
          );
        allocation = await stock.perform(
          {
            sourceId: record.id,
            actorId: actor.id,
            phase: 'reserve',
            administrativeScrap,
          },
          () =>
            d.assets.reserve(
              {
                sourceId: record.id,
                actorId: actor.id,
                reason: 'Reserve the actual submitted assets',
                requestKey: `reserve:${record.lifecycleVersion}`,
              },
              tx,
            ),
        );
      }
      if (!allocation?.length || allocation.length !== record.quantity)
        throw new AssetError(
          'ASSET_ALLOCATION_MISSING',
          'The complete actual allocation is required.',
        );
      const total = allocation.reduce(
        (sum, a) => sum + BigInt(a.originalValueCents),
        0n,
      );
      if (total > BigInt(Number.MAX_SAFE_INTEGER))
        throw new AssetError(
          'ASSET_INVALID_AMOUNT',
          'The asset value exceeds the supported exact amount.',
        );
      return {
        employeeId: employee.id,
        departmentId: department.id,
        headApproverId: head,
        allocation: allocation.map(
          ({ originalValueCents: _value, ...publicUnit }) => publicUnit,
        ),
        originalValueCents: Number(total),
        ruleSnapshot,
        needsGm:
          record.operation === 'scrap' &&
          exceedsMoneyThreshold(Number(total), rules['asset.scrapGm']),
        number: record.number ?? (await d.sequences.next('ASSET', tx, now)),
        updatedAt: now.toISOString(),
      };
    },
    write: async ({ record, actor, to, from, tx, input, now, entry }) => {
      const connection = tx.handle as DatabaseConnection,
        key = `${from}:${to}:${record.lifecycleVersion}`;
      if (entry.transition === 'edit')
        await d.validatePhotos(record, connection);
      if (from === 'issuing' && (to === 'issued' || to === 'returning')) {
        await lockUserForAdministration(connection, record.applicantId);
        const employee = record.employeeId
          ? await d.employees.getById(record.employeeId, connection)
          : null;
        if (
          !employee?.active ||
          employee.userId !== record.applicantId ||
          !['probation', 'regular'].includes(employee.status)
        )
          throw new AssetError(
            'ASSET_EMPLOYEE_INACTIVE',
            'An active validated employee is required before issue.',
          );
        if (
          record.operation === 'borrow' &&
          (!record.borrowDueDate ||
            record.borrowDueDate < d.calendar.localDate(now))
        )
          throw new AssetError(
            'ASSET_BORROW_DATE_INVALID',
            'Renew approval for an expired borrowing period before issue.',
          );
        await stockWrite(
          record,
          actor.id,
          'issue',
          key,
          'Issue every approved asset with its actual serial',
          connection,
        );
      }
      if (from === 'returning' && to === 'returned') {
        if (!record.handlingReason?.trim())
          throw new AssetError(
            'ASSET_RETURN_REASON_REQUIRED',
            'Confirm the physical receipt reason.',
          );
        await stockWrite(
          record,
          actor.id,
          'return',
          key,
          record.handlingReason,
          connection,
        );
      }
      if (to === 'scrapped')
        await stockWrite(
          record,
          actor.id,
          'scrap',
          key,
          'Dispose of the approved actual asset',
          connection,
        );
      if (
        ['rejected', 'withdrawn', 'terminated'].includes(to) &&
        (await d.assets.stockFacts(record.id, connection)).held.length
      )
        await stockWrite(
          record,
          actor.id,
          'release',
          key,
          'Release terminal application holds',
          connection,
        );
      await d.audit.record(
        {
          actorId: actor.id,
          action: `assetRequest.${from}.${to}`,
          targetType: 'assetRequests',
          targetId: record.id,
          reason: typeof input.reason === 'string' ? input.reason : null,
          after: { status: to },
        },
        connection,
      );
    },
    onEnter: Object.fromEntries(
      [
        'issued',
        'returning',
        'returned',
        'scrapped',
        'exception',
        'rejected',
        'revision',
        'withdrawn',
        'terminated',
      ].map((state) => [
        state,
        [
          {
            name: `assetRequest.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: AssetRequestRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                kind: ASSET_REQUEST_LIFECYCLE,
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
              }),
          },
        ],
      ]),
    ),
    onEnterState: {
      draft: async ({ record, actor, tx }) => {
        await lockUserForAdministration(
          tx.handle as DatabaseConnection,
          actor.id,
        );
        if (
          !(
            await d.directory.snapshot(tx.handle as DatabaseConnection)
          ).isActive(actor.id)
        )
          throw new AssetError(
            'ASSET_EMPLOYEE_INACTIVE',
            'An active applicant account is required.',
          );
        await d.validatePhotos(record, tx.handle as DatabaseConnection);
        await d.audit.record(
          {
            actorId: actor.id,
            action: 'assetRequest.create',
            targetType: 'assetRequests',
            targetId: record.id,
            after: { operation: record.operation, quantity: record.quantity },
          },
          tx.handle as DatabaseConnection,
        );
      },
    },
    notify: async ({ task, reason, services }) =>
      d.notifications.task({
        task,
        reason,
        directory: services.directory,
        kind: ASSET_REQUEST_LIFECYCLE,
      }),
  });
  const runtime = new LifecycleRuntime({
    store: store.store,
    dispatcher: d.dispatcher,
  });
  runtime.register(graph, {
    services: (handle: unknown) => store.services(handle),
  });
  const approvals = createAppApprovalService(
    runtime,
    [graph.approval as unknown as Approval<never>],
    (handle: unknown) => store.services(handle),
  );
  const facade = {
    runtime,
    approvals,
    approvalDefinition:
      graph.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    initialize: () => store.refresh(),
    async maintenance() {
      await store.refresh();
      const result = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      return result;
    },
    stockSource: stock.source,
    async list(
      actorId: string,
      view: 'mine' | 'pending' | 'done' | 'copied',
      policy: RepositoryPolicy,
    ) {
      await store.refresh();
      return store.withReadDirectory(async () => {
        const result: (Partial<AssetRequestRecord> & {
          applicant?: { id: string; name: string };
          createdBy?: { id: string; name: string };
        })[] = [];
        let cursor: string | undefined;
        for (;;) {
          const rows = await d.db
            .repository<AssetRequestRecord>('assetRequests')
            .withPolicy(policy)
            .findMany({
              cursor: cursor ? { id: cursor } : undefined,
              direction: cursor ? 'forward' : undefined,
              limit: 100,
              sort: (s) => [s.field('id').asc()],
            });
          for (const row of rows) {
            if (
              view === 'pending' &&
              rows.length > 10 &&
              !(await hasApprovalCandidate(
                approvals,
                ASSET_REQUEST_LIFECYCLE,
                row.id,
                actorId,
              ))
            )
              continue;

            if (typeof row.id !== 'string') continue;
            let match =
              view === 'mine' &&
              (row.applicantId === actorId || row.createdById === actorId);
            if (view !== 'mine') {
              const runs =
                  view === 'done' || view === 'copied'
                    ? await runTaskViewsFor(
                        approvals,
                        ASSET_REQUEST_LIFECYCLE,
                        row.id,
                      )
                    : [],
                tasks = runs.flatMap((r) => r.tasks);
              match =
                view === 'copied'
                  ? tasks.some(
                      (t) => t.kind === 'copy' && t.assigneeId === actorId,
                    )
                  : view === 'done'
                    ? tasks.some(
                        (t) =>
                          t.actorId === actorId &&
                          ['completed', 'transferred'].includes(t.status),
                      )
                    : (
                        await approvals.actionsFor(
                          ASSET_REQUEST_LIFECYCLE,
                          row.id,
                          { id: actorId },
                        )
                      ).some((a) =>
                        [
                          'approve',
                          'reject',
                          'complete',
                          'unable',
                          'claim',
                        ].some((name) =>
                          a.actions.some((offer) => offer.name === name),
                        ),
                      );
            }
            if (!match) continue;
            const applicant =
                typeof row.applicantId === 'string'
                  ? await d.users.get(row.applicantId)
                  : undefined,
              createdBy =
                typeof row.createdById === 'string'
                  ? await d.users.get(row.createdById)
                  : undefined;
            result.push({
              ...projectAmount(row),
              ...(applicant
                ? { applicant: { id: applicant.id, name: applicant.name } }
                : {}),
              ...(createdBy
                ? { createdBy: { id: createdBy.id, name: createdBy.name } }
                : {}),
            });
          }
          if (rows.length < 100) break;
          const next = rows.at(-1)?.id;
          if (typeof next !== 'string')
            throw new AssetError(
              'ASSET_ACCESS_DENIED',
              'The list policy must allow record ids for pagination.',
              'permission',
            );
          cursor = next;
        }
        return result;
      });
    },
    async readableIds(actorId: string) {
      await store.refresh();
      return store.withReadDirectory(async () => {
        const directory = store.services(undefined).directory;
        const ids: string[] = [];
        let cursor: string | undefined;
        for (;;) {
          const rows = await d.db
            .repository<AssetRequestRecord>('assetRequests')
            .findMany({
              cursor: cursor ? { id: cursor } : undefined,
              direction: cursor ? 'forward' : undefined,
              limit: 100,
              sort: (s) => [s.field('id').asc()],
            });
          for (const record of rows) {
            // These are already positive branches of the same read policy.
            if (
              record.applicantId === actorId ||
              record.createdById === actorId ||
              record.headApproverId === actorId ||
              ['admin', 'finance', 'gm', 'approval.admin'].some((role) =>
                directory.hasRole(actorId, role),
              )
            ) {
              ids.push(record.id);
              continue;
            }
            const involvement = await approvals.involvementOf(
              ASSET_REQUEST_LIFECYCLE,
              record.id,
              actorId,
            );
            if (involvement.length) {
              ids.push(record.id);
              continue;
            }
            const acted = await hasApprovalTaskActor(
              approvals,
              ASSET_REQUEST_LIFECYCLE,
              record.id,
              actorId,
            );
            if (
              record.applicantId === actorId ||
              record.createdById === actorId ||
              record.headApproverId === actorId ||
              involvement.length ||
              acted ||
              ['admin', 'finance', 'gm', 'approval.admin'].some((role) =>
                directory.hasRole(actorId, role),
              )
            )
              ids.push(record.id);
          }
          if (rows.length < 100) break;
          cursor = rows.at(-1)!.id;
        }
        return ids;
      });
    },
    async detail(id: string, actorId: string, policy: RepositoryPolicy) {
      const record = await requireRead(id, policy);
      await store.refresh();
      const actor = { id: actorId },
        runs = await approvals.runViewsFor(ASSET_REQUEST_LIFECYCLE, id);
      const userIds = [
        ...new Set(
          [
            record.applicantId,
            record.createdById,
            record.headApproverId,
            record.issuedById,
            ...runs.flatMap((r) =>
              r.tasks.flatMap((t) => [t.assigneeId, t.actorId]),
            ),
          ].filter((v): v is string => typeof v === 'string'),
        ),
      ];
      const users = (await Promise.all(userIds.map((id) => d.users.get(id))))
        .filter((u) => u !== undefined)
        .map((u) => ({ id: u.id, name: u.name }));
      return projectAssetApprovalJson(
        {
          record,
          users,
          timeZone: d.calendar.timeZone(),
          view: await (async () => {
            // The runtime record is an internal full read; HTTP exposes only the separately projected record.
            const value = await runtime.view(
              ASSET_REQUEST_LIFECYCLE,
              id,
              actor,
            );
            return {
              state: value.state,
              version: value.version,
              available: value.available,
              history: value.history,
            };
          })(),
          runs,
          taskActions: await approvals.actionsFor(
            ASSET_REQUEST_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            ASSET_REQUEST_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            ASSET_REQUEST_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(ASSET_REQUEST_LIFECYCLE, id),
        },
        record,
      );
    },
    async candidates(
      id: string,
      actorId: string,
      target: { taskId: string } | { runId: string },
      action: string,
      query: { search?: string; offset?: number; limit?: number },
      policy: RepositoryPolicy,
    ) {
      await requireRead(id, policy);
      await store.refresh();
      const runs = await approvals.runViewsFor(ASSET_REQUEST_LIFECYCLE, id);
      if (
        !runs.some((r) =>
          'runId' in target
            ? r.run.id === target.runId
            : r.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new AssetError(
          'ASSET_TARGET_MISMATCH',
          'The approval target belongs to another asset request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
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
    ...createAssetBorrowReminders({
      ...d,
      enabled: d.remindersEnabled ?? (() => false),
    }),
    async get(
      id: string,
      connection = d.db.connection(),
      policy?: RepositoryPolicy,
    ) {
      const repo = connection.repository<AssetRequestRecord>('assetRequests');
      return projectAmount(
        (await (policy ? repo.withPolicy(policy) : repo).findOne({
          filter: { id },
        })) ?? null,
      );
    },
    async create(
      actorId: string,
      input: AssetRequestInput,
      requestId: string,
      policy?: RepositoryPolicy,
    ) {
      const values = assetRequestInputSchema.parse(input);
      await store.refresh();
      const command = await journal.reserve({
        actorId,
        requestId,
        operation: 'create',
        payload: values,
      });
      if (
        await d.db
          .repository('assetRequests')
          .exists({ filter: { id: command.recordId } })
      )
        return requireRead(command.recordId, policy);
      await store.withMutationPolicy(policy, () =>
        runtime.create(
          ASSET_REQUEST_LIFECYCLE,
          {
            id: command.recordId,
            ...values,
            applicantId: actorId,
            createdById: actorId,
            employeeId: null,
            departmentId: null,
            headApproverId: null,
            issuedById: null,
            number: null,
            allocation: null,
            originalValueCents: null,
            ruleSnapshot: null,
            needsGm: false,
            appraisalOpinion: null,
            handlingUnits: null,
            handlingReason: null,
            approvedFingerprint: null,
            exceptionReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { actor: { id: actorId } },
        ),
      );
      return requireRead(command.recordId, policy);
    },
    async edit(
      id: string,
      actorId: string,
      input: AssetRequestInput & {
        lifecycleVersion: number;
        requestId: string;
      },
      policy?: RepositoryPolicy,
    ) {
      const { lifecycleVersion, requestId, ...candidate } = input,
        values = assetRequestInputSchema.parse(candidate);
      await requireRead(id, policy);
      await store.refresh();
      await journal.reserve({
        actorId,
        requestId,
        recordId: id,
        operation: 'edit',
        payload: { lifecycleVersion, values },
      });
      await store.withMutationPolicy(policy, () =>
        runtime.fire(ASSET_REQUEST_LIFECYCLE, id, 'edit', {
          manual: true,
          actor: { id: actorId },
          input: values,
          expect: { version: lifecycleVersion },
          requestId,
        }),
      );
      return requireRead(id, policy);
    },
    async act(
      id: string,
      actorId: string,
      action: string,
      input: { lifecycleVersion: number; requestId: string; comment?: string },
      policy?: RepositoryPolicy,
    ) {
      if (!['submit', 'withdraw', 'terminate'].includes(action))
        throw new AssetError(
          'ASSET_ACTION_INVALID',
          'Unknown asset lifecycle action.',
        );
      await requireRead(id, policy);
      await store.refresh();
      await journal.reserve({
        actorId,
        requestId: input.requestId,
        recordId: id,
        operation: action,
        payload: input,
      });
      const body: JsonObject = input.comment ? { reason: input.comment } : {};
      await store.withPreparation(
        async (tx) => ({
          resumeEligible:
            action === 'submit' && (await canResume(await getFull(id, tx), tx)),
        }),
        () =>
          runtime.fire(ASSET_REQUEST_LIFECYCLE, id, action, {
            manual: true,
            actor: { id: actorId },
            input: body,
            expect: { version: input.lifecycleVersion },
            requestId: input.requestId,
          }),
      );
      return requireRead(id, policy);
    },
    async action(
      id: string,
      actorId: string,
      input: PerformInput,
      policy?: RepositoryPolicy,
    ) {
      await requireRead(id, policy);
      await store.refresh();
      const views = await approvals.runViewsFor(ASSET_REQUEST_LIFECYCLE, id),
        target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new AssetError(
          'ASSET_TARGET_MISMATCH',
          'The approval target belongs to another asset request.',
          'permission',
        );
      if (!input.requestId)
        throw new AssetError(
          'ASSET_INVALID_COMMAND',
          'A stable request ID is required.',
        );
      await journal.reserve({
        actorId,
        requestId: input.requestId,
        recordId: id,
        operation: 'approvalAction',
        payload: { ...input, actor: { id: actorId } },
      });
      return approvals.perform({ ...input, actor: { id: actorId } });
    },
    maintenanceReassign(
      id: string,
      actorId: string,
      input: Omit<PerformInput, 'actor'>,
      policy: RepositoryPolicy,
    ): Promise<unknown> {
      if (input.action !== 'reassign')
        throw new AssetError(
          'ASSET_ACTION_INVALID',
          'Maintenance accepts only public reassignment.',
        );
      return facade.action(
        id,
        actorId,
        { ...input, actor: { id: actorId } },
        policy,
      );
    },
    async returnIssued(
      id: string,
      actorId: string,
      input: {
        units: import('../assets/contract.js').AssetUnit[];
        reason: string;
        requestId: string;
      },
      policy: RepositoryPolicy,
    ) {
      await requireRead(id, policy);
      const units = assetUnitsSchema.parse(input.units);
      if (!input.reason.trim())
        throw new AssetError(
          'ASSET_INVALID_COMMAND',
          'A return reason is required.',
        );
      await journal.reserve({
        actorId,
        requestId: input.requestId,
        recordId: id,
        operation: 'administrativeReturn',
        payload: { units, reason: input.reason },
      });
      await d.db.transaction(async (tx) => {
        const directory = await d.directory.snapshot(tx);
        if (
          !directory.isActive(actorId) ||
          !directory.hasRole(actorId, 'admin')
        )
          throw new AssetError(
            'ASSET_RETURN_FORBIDDEN',
            'An active asset administrator is required.',
            'permission',
          );
        // Real management scope is enforced on the application row, rather than merely checking an action name.
        if (
          !(await tx
            .repository('assetRequests')
            .withPolicy(policy)
            .exists({ filter: { id } }))
        )
          throw new AssetError(
            'ASSET_RETURN_FORBIDDEN',
            'This record is outside the management policy.',
            'permission',
          );
        const record = await getFull(id, tx);
        if (record.operation !== 'use' || record.status !== 'issued')
          throw new AssetError(
            'ASSET_RETURN_INELIGIBLE',
            'Only issued permanent use requests use administrative return.',
          );
        await stock.perform({ sourceId: id, actorId, phase: 'return' }, () =>
          d.assets.returnIssued(
            {
              sourceId: id,
              actorId,
              reason: input.reason,
              requestKey: createHash('sha256')
                .update(`admin-return:${input.requestId}`)
                .digest('hex'),
              units,
            },
            tx,
          ),
        );
      });
      return requireRead(id, policy);
    },
  };
  return facade;
}
