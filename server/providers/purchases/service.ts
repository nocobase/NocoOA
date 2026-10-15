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
import { purchaseQuoteBasis } from './quotes.js';
import { lockUserForAdministration } from '@nocobase/app-plugin-authentication';
import { randomUUID } from 'node:crypto';
import {
  isOpenRun,
  APPROVAL_COLLECTIONS,
  type TaskRow,
  approvalState,
  defineApproval,
  stagesFor,
  approve,
  reject,
  returnTo,
  commentAction,
  readAction,
  ccAction,
  defineApprovalAction,
  configureAction,
  allActivePeople,
  claimAction,
  releaseAction,
  assignAction,
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
import { PurchaseError } from './errors.js';
import { VendorError } from '../vendors/service.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import type { BudgetService } from '../budgets/contract.js';
import type { DictionaryService } from '../platform/dictionaries.js';
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

import {
  PURCHASE_LIFECYCLE,
  type PurchaseRecord,
  type PurchaseInput,
} from './contract.js';
export {
  PURCHASE_LIFECYCLE,
  type PurchaseRecord,
  type PurchaseInput,
} from './contract.js';
import type { VendorService } from '../vendors/contract.js';
import type { PurchaseOrderService } from './contract.js';
import { createHash } from 'node:crypto';
import { quantityText, priceNeedsConfirmation } from './money.js';
import {
  purchaseHandlingActions,
  purchaseHandlingOutputs,
  purchaseHandlingPolicy,
  PricedInput,
} from './handling.js';
import { assertPurchaseQuoteFiles } from './attachments.js';
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  merges?: Map<string, JsonObject | null>;
  submitFacts?: { departmentId: string; year: number };
}
interface Types {
  record: PurchaseRecord;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'purchasing'
    | 'exception'
    | 'forcedClosed'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'approved'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface PurchaseDependencies {
  db: DatabaseManager;
  budgets: BudgetService;
  vendors: VendorService;
  orders: PurchaseOrderService;
  dictionaries: DictionaryService;
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
  throw new PurchaseError(reason, message);
}
function normalizePurchaseRecord(record: LifecycleRecord): PurchaseRecord {
  const estimatedCents = Number(record.estimatedCents);
  if (!Number.isSafeInteger(estimatedCents) || estimatedCents < 0)
    refuse(
      'PURCHASE_INVALID_AMOUNT',
      'Stored budget amounts must be safe integer cents.',
    );
  const heldCents = Number(record.heldCents);
  if (!Number.isSafeInteger(heldCents) || heldCents < 0)
    refuse(
      'PURCHASE_INVALID_AMOUNT',
      'Stored reservations must be safe integer cents.',
    );
  const actualCents =
    record.actualCents == null ? null : Number(record.actualCents);
  if (
    actualCents !== null &&
    (!Number.isSafeInteger(actualCents) || actualCents <= 0)
  )
    refuse(
      'PURCHASE_INVALID_STORED_AMOUNT',
      'Actual price must be exact positive safe cents.',
    );
  return {
    ...record,
    estimatedCents,
    actualCents,
    heldCents,
  } as PurchaseRecord;
}
export function createPurchaseService(d: PurchaseDependencies) {
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
  const writeRecordId = new AsyncLocalStorage<string>();
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
        if (key === 'findRecord')
          return async (collection: string, id: string | number) => {
            const record = await target.findRecord(collection, id);
            return collection === 'purchaseRequests' && record
              ? normalizePurchaseRecord(record)
              : record;
          };
        if (!policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            const record = await target.createRecord(collection, values);
            return collection === 'purchaseRequests'
              ? normalizePurchaseRecord(record)
              : record;
          };

        if (policy && key === 'createRecord')
          return async (
            collection: string,
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'purchaseRequests')
              return target.createRecord(collection, values);
            const connection = target.transactionHandle as DatabaseConnection;
            const row = await connection
              .repository(collection)
              .withPolicy(policy)
              .createOne({ values: values as RepositoryRecord });
            if (row.record.id === undefined)
              throw new PurchaseError(
                'PURCHASE_FIELDS_RESTRICTED',
                'The grant must expose the created purchase request record.',
                'permission',
              );
            return normalizePurchaseRecord(row.record as LifecycleRecord);
          };
        if (policy && key === 'updateRecordIf')
          return async (
            collection: string,
            id: string,
            condition: Parameters<LifecycleStore['updateRecordIf']>[2],
            values: Readonly<Record<string, unknown>>,
          ) => {
            if (collection !== 'purchaseRequests')
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
              const writeId = writeRecordId.getStore();
              if (writeId) {
                const current = await connection
                  .repository<PurchaseRecord>('purchaseRequests')
                  .findOne({ filter: { id: writeId } });
                if (current)
                  await lockUserForAdministration(
                    connection,
                    current.applicantId,
                  );
              }
              snapshots.set(connection, {
                directory:
                  readDirectory.getStore() ??
                  (await processDirectorySnapshot(
                    d.directory,
                    'oa.purchase',
                    connection,
                  )),
                connection,
                merges: new Map(),
              });
              const change = intervention.getStore();
              if (change) change.depth++;
              try {
                const result = await work(wrap(tx));
                if (change?.depth === 1)
                  await d.audit.record(
                    {
                      actorId: change.actorId,
                      action: `purchase.${change.action}`,
                      targetType: 'purchaseRequests',
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
    record: PurchaseRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const fields = [
    'items',
    'subject',
    'estimatedCents',
    'expectedDate',
    'suggestedVendorId',
    'purpose',
  ];
  const stage = stagesFor<Types>();
  const manualCc = configureAction(
    defineApprovalAction({
      ...ccAction,
      people: (context, query) => allActivePeople().search(context, query),
      validate: ({ to }, context) =>
        typeof to === 'string' && context.directory.isActive(to)
          ? null
          : 'Choose an active recipient.',
    }),
    { by: ['assignee', 'delegate', 'applicant', 'admin'] },
  );
  const actions = [
    ...createOaApprovalOperations(d),
    ...[approve(), reject({ reason: 'required' })].map((action) =>
      defineApprovalAction({
        ...action,
        validate: (input, context) => {
          const data = input.data;
          if (
            data !== undefined &&
            (data === null ||
              typeof data !== 'object' ||
              Array.isArray(data) ||
              Object.keys(data).length)
          )
            return {
              code: 'INVALID_INPUT',
              message:
                'Purchase decisions do not accept replacement reviewed fields or hashes.',
            };
          return action.validate?.(input, context) ?? null;
        },
      }),
    ),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    appointAction,
    reassignAction,
    manualCc,
    claimAction,
    releaseAction,
    assignAction,
    readAction,
  ];
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  function fingerprint(record: PurchaseRecord) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          record.items.map((i) => [
            i.id,
            i.name,
            i.specification,
            i.quantity,
            i.unit,
          ]),
          record.subject,
          record.estimatedCents,
          record.departmentId,
          record.year,
        ]),
      )
      .digest('hex');
  }
  async function validate(
    record: PurchaseRecord,
    connection: DatabaseConnection,
    requirePriceConfirmation = true,
  ) {
    const employee = await d.employees.getByUserId(
      record.applicantId,
      connection,
    );
    if (!employee?.active || employee.status === 'left')
      refuse(
        'PURCHASE_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    if (
      !Number.isSafeInteger(record.estimatedCents) ||
      record.estimatedCents <= 0 ||
      !record.purpose.trim() ||
      record.purpose.length > 10000 ||
      !Array.isArray(record.items) ||
      !record.items.length ||
      record.items.length > 100
    )
      refuse(
        'PURCHASE_INVALID_INPUT',
        'Positive estimated cents, purpose and purchase items are required.',
      );
    const ids = new Set<string>();
    for (const item of record.items) {
      if (
        !item.id ||
        ids.has(item.id) ||
        !item.name.trim() ||
        item.name.length > 255 ||
        item.specification.length > 1000 ||
        !item.unit.trim() ||
        item.unit.length > 64 ||
        quantityText(item.quantity) !== item.quantity
      )
        refuse(
          'PURCHASE_INVALID_ITEMS',
          'Every item requires distinct id, name, unit and canonical positive decimal quantity.',
        );
      ids.add(item.id);
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(record.expectedDate) ||
      !Number.isFinite(Date.parse(record.expectedDate)) ||
      new Date(record.expectedDate).toISOString().slice(0, 10) !==
        record.expectedDate
    )
      refuse('PURCHASE_INVALID_DATE', 'Choose a valid expected receipt date.');
    const department = await d.org.primaryDepartmentOf(
      record.applicantId,
      connection,
    );
    if (!department)
      refuse(
        'PURCHASE_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    if (
      !(await d.dictionaries.get('budgetSubject', record.subject, connection))
        ?.active
    )
      refuse('PURCHASE_INVALID_DICTIONARY', 'Choose an active budget subject.');
    if (record.suggestedVendorId)
      await d.vendors.snapshotForPurchase(record.suggestedVendorId, connection);
    if (
      requirePriceConfirmation &&
      record.priceConfirmationRequired &&
      (record.actualCents === null ||
        record.estimatedCents < record.actualCents)
    )
      refuse(
        'PURCHASE_PRICE_CONFIRMATION_REQUIRED',
        'Revise the estimated budget to confirm the quoted price before resubmission.',
      );
    return department;
  }
  async function pricedInput(
    record: PurchaseRecord,
    services: Services,
    input: JsonObject,
  ) {
    const raw =
      input.outcome === 'forcedPriced'
        ? {
            actualCents: input.actualCents,
            selectedVendorId: input.selectedVendorId,
            quotes: input.quotes,
          }
        : input.outputs;
    const parsed = PricedInput.safeParse(raw);
    if (!parsed.success)
      refuse(
        'PURCHASE_INVALID_PRICE',
        'A valid actual price, selected vendor and quote evidence are required.',
      );
    const value = parsed.data,
      tx = services.connection!;
    await d.vendors.snapshotForPurchase(value.selectedVendorId, tx);
    const vendors = new Set<string>(),
      files = new Set<string>();
    for (const quote of value.quotes) {
      if (vendors.has(quote.vendorId))
        refuse('PURCHASE_INVALID_QUOTES', 'Quote vendors must be distinct.');
      vendors.add(quote.vendorId);
      await d.vendors.snapshotForPurchase(quote.vendorId, tx);
      for (const id of quote.attachmentIds) {
        if (files.has(id))
          refuse(
            'PURCHASE_INVALID_QUOTES',
            'The same file cannot count for multiple quotes.',
          );
        files.add(id);
      }
      await assertPurchaseQuoteFiles(
        tx,
        record.id,
        quote.vendorId,
        quote.attachmentIds,
        purchaseQuoteBasis(record),
      );
    }
    if (
      exceedsMoneyThreshold(
        value.actualCents,
        record.ruleSnapshot?.['purchase.quotes'],
      ) &&
      vendors.size < 3
    )
      refuse(
        'PURCHASE_QUOTES_REQUIRED',
        'Three different vendors with quote attachments are required above the quote threshold.',
      );
    return value;
  }
  const budgetCommand = (
    record: PurchaseRecord,
    actorId: string,
    requestKey: string,
  ) => ({
    ...record.heldAccount!,
    actorId,
    reason: record.purpose,
    reference: `${PURCHASE_LIFECYCLE}:${record.id}`,
    requestKey,
  });
  const releaseReservation = async (
    record: PurchaseRecord,
    connection: DatabaseConnection,
    actorId: string,
    key: string,
  ) => {
    if (record.heldAccount && record.heldCents > 0)
      await d.budgets.release(budgetCommand(record, actorId, key), connection);
  };
  const needsExecutive = (record: PurchaseRecord) =>
    exceedsMoneyThreshold(
      record.actualCents ?? record.estimatedCents,
      record.ruleSnapshot?.['spend.vp'],
    );
  const needsGm = (record: PurchaseRecord) =>
    exceedsMoneyThreshold(
      record.actualCents ?? record.estimatedCents,
      record.ruleSnapshot?.['spend.gm'],
    );
  async function issueOrder(
    record: PurchaseRecord,
    actorId: string,
    connection: DatabaseConnection,
  ) {
    await d.orders.issue(record, actorId, connection);
  }
  async function mergeEvidence(
    record: PurchaseRecord,
    services: Services,
    input: JsonObject,
  ) {
    if (
      !needsGm(record) ||
      !record.executiveApproverId ||
      record.executiveApproverId !== record.gmApproverId ||
      typeof input.runId !== 'string'
    )
      return null;
    // Read-only adapter: the public service's runViewsFor opens independent transactions, so it cannot
    // observe this answer before commit. Read the plugin's public TaskRow/collection contract in the
    // caller transaction; only ApprovalService writes approval state.
    const tasks = await services
      .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
      .findMany({
        filter: {
          runId: input.runId,
          stage: 'executive',
          enteredVersion: record.lifecycleVersion,
          status: 'completed',
          depth: 0,
          mode: null,
          answer: 'approve',
          role: 'member',
          assigneeId: record.executiveApproverId,
          actorId: record.executiveApproverId,
        },
      });
    const task = tasks.find((t) => t.kind === 'decide');
    return task
      ? {
          runId: input.runId,
          taskId: task.id,
          personId: record.executiveApproverId,
        }
      : null;
  }
  const approval = defineApproval<Types>({
    name: PURCHASE_LIFECYCLE,
    collection: 'purchaseRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    freeze: [
      'items',
      'subject',
      'estimatedCents',
      'departmentId',
      'year',
      'actualCents',
      'selectedVendorId',
      'quotes',
    ],
    adminRole: 'approval.admin',
    afterEnd: [readAction],
    copies: { on: 'final', recipients: () => [] },
    notify: async ({ task, reason, services }) => {
      const record = await d.db
        .repository<PurchaseRecord>('purchaseRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: record?.applicantId,
        kind: PURCHASE_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    states: [
      'draft',
      'revision',
      'exception',
      approvalState(
        'head',
        stage.single({
          ...settings,
          covers: [
            'items',
            'subject',
            'estimatedCents',
            'departmentId',
            'year',
          ],
          assignee: ({ record }) => record.headApproverId ?? undefined,
        }),
      ),
      approvalState(
        'purchasing',
        stage.custom(
          purchaseHandlingPolicy,
          {},
          {
            qualification: 'purchasing',
            onEmpty: 'hold',
            remindAfterHours: 24,
            pools: [
              {
                key: 'purchasing',
                candidates: ({ services }) =>
                  services.directory.roleMembers('purchasing'),
                claimable: true,
              },
            ],
            outputs: purchaseHandlingOutputs,
            actions: [
              claimAction,
              releaseAction,
              assignAction,
              commentAction,
              manualCc,
              readAction,
              appointAction,
              reassignAction,
              purchaseHandlingActions.complete,
              purchaseHandlingActions.unable,
              purchaseHandlingActions.forceComplete,
              createOaApprovalOperations(d)[0],
              createOaApprovalOperations(d)[2],
            ],
          },
        ),
      ),
      approvalState(
        'finance',
        stage.any({
          ...settings,
          assignees: ({ services }) =>
            services.directory.roleMembers('finance'),
        }),
      ),
      approvalState(
        'executive',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.executiveApproverId ?? undefined,
        }),
      ),
      approvalState(
        'gm',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.gmApproverId ?? undefined,
        }),
      ),
      ...(
        [
          'approved',
          'forcedClosed',
          'rejected',
          'withdrawn',
          'terminated',
        ] as const
      ).map((name) => ({ name, final: true })),
    ],
    create: {
      guard: async ({ values, actor, services }) => {
        if (
          typeof values.applicantId !== 'string' ||
          values.applicantId !== actor.id
        )
          return false;
        await lockUserForAdministration(
          services.connection!,
          values.applicantId,
        );
        const employee = await d.employees.getByUserId(
          values.applicantId,
          services.connection,
        );
        return Boolean(employee?.active && employee.status !== 'left');
      },
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
          await validate(record, connection, false);
        },
      },
      submit: {
        from: ['draft', 'revision', 'exception'],
        to: ['head', 'purchasing'],
        guard: async (context) => {
          if (!owner(context)) return false;
          let department;
          try {
            department = await validate(
              context.record,
              context.services.connection!,
            );
          } catch (error) {
            // Availability is also evaluated while reading a detail. A correctable form must remain
            // readable so its owner can edit it; submit performs the same validation again below.
            if (error instanceof PurchaseError || error instanceof VendorError)
              return false;
            throw error;
          }
          context.services.submitFacts = {
            departmentId: department.id,
            year: Number(d.calendar.localDate(context.now).slice(0, 4)),
          };
          return true;
        },
        route: ({ record, services }) =>
          record.status === 'exception' &&
          record.approvedFingerprint ===
            fingerprint({
              ...record,
              departmentId: services.submitFacts!.departmentId,
              year: services.submitFacts!.year,
            })
            ? 'purchasing'
            : 'head',
        set: async ({ record, services, now }) => {
          const connection = services.connection!;
          await lockUserForAdministration(connection, record.applicantId);
          const department = await validate(record, connection);
          const snapshot =
            record.ruleSnapshot ??
            (await d.rules.snapshot(
              [
                'purchase.quotes',
                'spend.vp',
                'spend.gm',
                'sla.remindHours',
                'sla.escalateHours',
                'sla.urgeCooldownHours',
              ],
              now,
              connection,
            ));
          if (
            snapshot['sla.remindHours'] !== 24 ||
            snapshot['sla.escalateHours'] !== 48
          )
            refuse(
              'PURCHASE_SLA_CONFIGURATION_UNSUPPORTED',
              'This release supports the default 24/48 working-hour approval clocks only.',
            );
          try {
            exceedsMoneyThreshold(
              record.estimatedCents,
              snapshot['purchase.quotes'],
            );
            exceedsMoneyThreshold(record.estimatedCents, snapshot['spend.vp']);
            exceedsMoneyThreshold(record.estimatedCents, snapshot['spend.gm']);
          } catch {
            refuse(
              'PURCHASE_INVALID_RULE',
              'Spending thresholds must be valid nonnegative amounts.',
            );
          }
          const nextAccount = {
            departmentId: department.id,
            year: Number(d.calendar.localDate(now).slice(0, 4)),
            subject: record.subject,
          };
          return {
            departmentId: department.id,
            year: nextAccount.year,
            heldAccount: nextAccount,
            heldCents: record.estimatedCents,
            ruleSnapshot: snapshot,
            number:
              record.number ??
              (await d.sequences.next('PURCHASE', connection, now)),
            headApproverId:
              (await d.org.headOf(department.id, connection)) ?? null,
            executiveApproverId:
              (await d.org.executiveOf(department.id, connection)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            gmMerged: null,
            actualCents: null,
            selectedVendorId: null,
            quotes: [],
            handlingFailureReason: null,
            handlingForced: false,
            priceConfirmationRequired: false,
          };
        },
        onTransition: async ({ record, previous, actor, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          if (
            previous.heldAccount &&
            (previous.heldAccount.departmentId !==
              record.heldAccount?.departmentId ||
              previous.heldAccount.year !== record.heldAccount?.year ||
              previous.heldAccount.subject !== record.heldAccount?.subject)
          )
            await releaseReservation(
              previous,
              connection,
              actor.id,
              `purchase:${record.id}:${previous.lifecycleVersion}:release-old`,
            );
          if (record.heldAccount)
            await d.budgets.adjustHold(
              {
                ...budgetCommand(
                  record,
                  actor.id,
                  `purchase:${record.id}:${previous.lifecycleVersion}:hold`,
                ),
                cents: record.estimatedCents,
              },
              connection,
            );
        },
      },
      headApproved: {
        from: 'head',
        to: 'purchasing',
        approvalOutcome: 'approved',
        set: ({ record }) => ({ approvedFingerprint: fingerprint(record) }),
      },
      priced: {
        from: 'purchasing',
        to: ['revision', 'finance'],
        approvalOutcome: 'priced',
        guard: async ({ record, services, input }) => {
          await pricedInput(record, services, input);
          return true;
        },
        route: ({ record, input }) =>
          priceNeedsConfirmation(
            Number((input.outputs as JsonObject).actualCents),
            record.estimatedCents,
          )
            ? 'revision'
            : 'finance',
        set: ({ record, input, actor }) => ({
          heldCents: Number((input.outputs as JsonObject).actualCents),
          priceConfirmationRequired: priceNeedsConfirmation(
            Number((input.outputs as JsonObject).actualCents),
            record.estimatedCents,
          ),
          financeEntered:
            record.financeEntered ||
            !priceNeedsConfirmation(
              Number((input.outputs as JsonObject).actualCents),
              record.estimatedCents,
            ),
          handlingActorId: actor.id,
          handlingForced: false,
        }),
        onTransition: async ({ record, previous, actor, tx }) => {
          await d.budgets.adjustHold(
            {
              ...budgetCommand(
                record,
                actor.id,
                `purchase:${record.id}:${previous.lifecycleVersion}:price`,
              ),
              cents: record.actualCents!,
            },
            tx.handle as DatabaseConnection,
          );
        },
      },
      forcedPriced: {
        from: 'purchasing',
        to: ['revision', 'finance'],
        approvalOutcome: 'forcedPriced',
        guard: async ({ record, services, input }) => {
          await pricedInput(record, services, input);
          return true;
        },
        route: ({ record, input }) =>
          priceNeedsConfirmation(
            Number(input.actualCents),
            record.estimatedCents,
          )
            ? 'revision'
            : 'finance',
        set: ({ record, input, actor }) => ({
          actualCents: Number(input.actualCents),
          selectedVendorId:
            typeof input.selectedVendorId === 'string'
              ? input.selectedVendorId
              : null,
          quotes: input.quotes as unknown as PurchaseRecord['quotes'],
          heldCents: Number(input.actualCents),
          priceConfirmationRequired: priceNeedsConfirmation(
            Number(input.actualCents),
            record.estimatedCents,
          ),
          financeEntered:
            record.financeEntered ||
            !priceNeedsConfirmation(
              Number(input.actualCents),
              record.estimatedCents,
            ),
          handlingActorId: actor.id,
          handlingForced: true,
        }),
        onTransition: async ({ record, previous, actor, input, tx }) => {
          await d.budgets.adjustHold(
            {
              ...budgetCommand(
                record,
                actor.id,
                `purchase:${record.id}:${previous.lifecycleVersion}:forced-price`,
              ),
              cents: record.actualCents!,
            },
            tx.handle as DatabaseConnection,
          );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'purchase.forcePriced',
              targetType: 'purchaseRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
        },
      },
      unavailable: {
        from: 'purchasing',
        to: 'exception',
        approvalOutcome: 'unavailable',
        set: ({ input }) => {
          const outputs = input.outputs;
          const failure =
            outputs && typeof outputs === 'object' && !Array.isArray(outputs)
              ? outputs.handlingFailureReason
              : undefined;
          return {
            handlingFailureReason:
              typeof failure === 'string'
                ? failure
                : typeof input.reason === 'string'
                  ? input.reason
                  : 'No supplier available',
          };
        },
      },
      forceClosed: {
        from: 'purchasing',
        to: 'forcedClosed',
        approvalOutcome: 'forcedClosed',
        set: ({ actor }) => ({
          heldAccount: null,
          heldCents: 0,
          handlingForced: true,
          handlingActorId: actor.id,
        }),
        onTransition: async ({ record, previous, actor, input, tx }) => {
          await releaseReservation(
            previous,
            tx.handle as DatabaseConnection,
            actor.id,
            `purchase:${record.id}:forced-close`,
          );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'purchase.forceClosed',
              targetType: 'purchaseRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            tx.handle as DatabaseConnection,
          );
        },
      },
      financeApproved: {
        from: 'finance',
        to: ['executive', 'gm', 'approved'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          needsExecutive(record)
            ? 'executive'
            : needsGm(record)
              ? 'gm'
              : 'approved',
        set: ({ record }) =>
          needsExecutive(record) || needsGm(record)
            ? {}
            : { orderId: record.orderId ?? randomUUID() },
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved')
            await issueOrder(record, actor.id, tx.handle as DatabaseConnection);
        },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'approved'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          const merged = await mergeEvidence(record, services, input);
          services.merges!.set(
            typeof input.runId === 'string' ? input.runId : '',
            merged,
          );
          return true;
        },
        route: ({ record, services, input }) =>
          needsGm(record) &&
          !services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          )
            ? 'gm'
            : 'approved',
        set: ({ record, services, input, now }) => {
          const merged = services.merges?.get(
            typeof input.runId === 'string' ? input.runId : '',
          );
          return needsGm(record) && !merged
            ? {}
            : {
                orderId: record.orderId ?? randomUUID(),
                gmMerged: merged
                  ? {
                      ...merged,
                      at: now.toISOString(),
                      stages: ['executive', 'gm'],
                    }
                  : null,
              };
        },
        onTransition: async ({ record, actor, to, tx }) => {
          if (to === 'approved') {
            await issueOrder(record, actor.id, tx.handle as DatabaseConnection);
            if (record.gmMerged)
              await d.audit.record(
                {
                  actorId: actor.id,
                  action: 'purchase.samePersonMerged',
                  targetType: 'purchaseRequests',
                  targetId: record.id,
                  after: record.gmMerged,
                },
                tx.handle as DatabaseConnection,
              );
          }
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'approved',
        approvalOutcome: 'approved',
        set: ({ record }) => ({
          orderId: record.orderId ?? randomUUID(),
        }),
        onTransition: ({ record, actor, tx }) =>
          issueOrder(record, actor.id, tx.handle as DatabaseConnection),
      },
      rejected: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: ({ previous, actor, tx }) =>
          releaseReservation(
            previous,
            tx.handle as DatabaseConnection,
            actor.id,
            `purchase:${previous.id}:${previous.lifecycleVersion}:reject`,
          ),
      },
      returned: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'revision',
        approvalOutcome: 'returned',
      },
      withdraw: {
        from: ['draft', 'revision', 'head', 'purchasing', 'exception'],
        to: 'withdrawn',
        guard: (context) => owner(context) && !context.record.financeEntered,
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: ({ previous, actor, tx }) =>
          releaseReservation(
            previous,
            tx.handle as DatabaseConnection,
            actor.id,
            `purchase:${previous.id}:${previous.lifecycleVersion}:withdraw`,
          ),
      },
      terminate: {
        set: () => ({ heldAccount: null, heldCents: 0 }),
        onTransition: async ({ record, previous, actor, input, tx }) => {
          const connection = tx.handle as DatabaseConnection;
          await releaseReservation(
            previous,
            connection,
            actor.id,
            `purchase:${previous.id}:${previous.lifecycleVersion}:terminate`,
          );
          await d.audit.record(
            {
              actorId: actor.id,
              action: 'purchase.terminate',
              targetType: 'purchaseRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : null,
            },
            connection,
          );
        },
        from: [
          'draft',
          'revision',
          'head',
          'purchasing',
          'exception',
          'finance',
          'executive',
          'gm',
        ],
        to: 'terminated',
        guard: ({ actor, services, input }) =>
          services.directory.hasRole(actor.id, 'approval.admin') &&
          typeof input.reason === 'string' &&
          input.reason.trim().length > 0,
      },
    },
    onEnter: Object.fromEntries(
      [
        'approved',
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
            name: `purchase.notify.${state}`,
            retry: { attempts: 5, backoffMs: 1000 },
            run: ({
              record,
              idempotencyKey,
            }: {
              record: PurchaseRecord;
              idempotencyKey: string;
            }) =>
              d.notifications.result({
                recordId: record.id,
                applicantId: record.applicantId,
                state,
                transitionId: idempotencyKey,
                kind: PURCHASE_LIFECYCLE,
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
      directory: await processDirectorySnapshot(d.directory, 'oa.purchase'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    policy?: RepositoryPolicy,
  ) {
    await refresh();
    const r = await d.db
      .repository<PurchaseRecord>('purchaseRequests')
      .findOne({ filter: { id } });
    if (!r)
      throw new PurchaseError(
        'PURCHASE_NOT_FOUND',
        'Purchase request not found.',
        'notFound',
      );
    if (
      outside.directory.hasRole(actorId, 'approval.admin') ||
      r.createdById === actorId ||
      r.applicantId === actorId ||
      (await approvals.involvementOf(PURCHASE_LIFECYCLE, id, actorId)).length ||
      Boolean(
        policy &&
        (await d.db
          .repository<PurchaseRecord>('purchaseRequests')
          .withPolicy(policy)
          .findOne({ filter: { id } })),
      )
    )
      return normalizePurchaseRecord(r);
    throw new PurchaseError(
      'PURCHASE_ACCESS_DENIED',
      'This purchase request is not accessible.',
      'permission',
    );
  }
  function fullRows(rows: Partial<PurchaseRecord>[]): PurchaseRecord[] {
    const fields = [
      'id',
      'applicantId',
      'createdById',
      'number',
      'items',
      'subject',
      'estimatedCents',
      'expectedDate',
      'suggestedVendorId',
      'purpose',
      'actualCents',
      'selectedVendorId',
      'quotes',
      'departmentId',
      'year',
      'heldAccount',
      'heldCents',
      'ruleSnapshot',
      'headApproverId',
      'executiveApproverId',
      'gmApproverId',
      'gmMerged',
      'orderId',
      'handlingFailureReason',
      'approvedFingerprint',
      'financeEntered',
      'priceConfirmationRequired',
      'handlingForced',
      'handlingActorId',
      'status',
      'lifecycleVersion',
      'createdAt',
    ];
    if (rows.some((row) => fields.some((field) => !(field in row))))
      throw new PurchaseError(
        'PURCHASE_FIELDS_RESTRICTED',
        'This release requires all purchase request business fields for reading.',
        'permission',
      );
    return rows.map((row) => normalizePurchaseRecord(row as PurchaseRecord));
  }
  async function enrich(records: PurchaseRecord[]) {
    const ids = [
      ...new Set(
        records
          .flatMap((r) => [
            r.applicantId,
            r.createdById,
            r.headApproverId,
            r.executiveApproverId,
            r.gmApproverId,
            r.handlingActorId,
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
      handlingActor: r.handlingActorId
        ? (users.get(r.handlingActorId) ?? null)
        : null,
      createdBy: users.get(r.createdById) ?? null,
      headApprover: r.headApproverId
        ? (users.get(r.headApproverId) ?? null)
        : null,
      gmApprover: r.gmApproverId ? (users.get(r.gmApproverId) ?? null) : null,
      executiveApprover: r.executiveApproverId
        ? (users.get(r.executiveApproverId) ?? null)
        : null,
    }));
  }
  async function notifyHeld(id: string) {
    const views = await approvals.runViewsFor(PURCHASE_LIFECYCLE, id);
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
            kind: PURCHASE_LIFECYCLE,
          });
        }
      }
      if (isOpenRun(view.run) && view.tasks.length === 0)
        await d.notifications.alarm({
          recordId: id,
          recipients: outside.directory.roleMembers('approval.admin'),
          eventId: `hold:${view.run.id}`,
          reason: 'unassigned',
          kind: PURCHASE_LIFECYCLE,
        });
    }
  }
  return {
    initialize: refresh,
    async options(actorId: string) {
      const [vendors, subjects, department] = await Promise.all([
        d.vendors.options(),
        d.dictionaries.list('budgetSubject', { includeInactive: true }),
        d.org.primaryDepartmentOf(actorId),
      ]);
      return {
        timeZone: d.calendar.timeZone(),
        vendors,
        subjects,
        department: department
          ? { id: department.id, title: department.title }
          : null,
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const records = await d.db
          .repository<PurchaseRecord>('purchaseRequests')
          .findMany();
        const ids: string[] = [];
        for (const record of records) {
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            record.executiveApproverId === actorId ||
            ['finance', 'gm', 'approval.admin', 'purchasing'].some((role) =>
              outside.directory.hasRole(actorId, role),
            )
          ) {
            ids.push(record.id);
            continue;
          }
          const involvement = await approvals.involvementOf(
            PURCHASE_LIFECYCLE,
            record.id,
            actorId,
          );
          if (involvement.length) {
            ids.push(record.id);
            continue;
          }
          const acted = await hasApprovalTaskActor(
            approvals,
            PURCHASE_LIFECYCLE,
            record.id,
            actorId,
          );
          const head = Boolean(
            (record.departmentId
              ? await d.org.activeChain(record.departmentId)
              : undefined
            )?.some((department) => department.managerId === actorId),
          );
          if (
            record.applicantId === actorId ||
            record.createdById === actorId ||
            involvement.length ||
            acted ||
            outside.directory.hasRole(actorId, 'finance') ||
            record.executiveApproverId === actorId ||
            outside.directory.hasRole(actorId, 'gm') ||
            outside.directory.hasRole(actorId, 'approval.admin') ||
            head ||
            outside.directory.hasRole(actorId, 'purchasing')
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
      input: PurchaseInput,
      actorId: string,
      applicantId = actorId,
      policy?: RepositoryPolicy,
    ) {
      await refresh();
      const create = () =>
        runtime.create(
          PURCHASE_LIFECYCLE,
          {
            id: randomUUID(),
            ...input,
            applicantId,
            createdById: actorId,
            number: null,
            heldAccount: null,
            heldCents: 0,
            ruleSnapshot: null,
            headApproverId: null,
            executiveApproverId: null,
            gmApproverId: null,
            gmMerged: null,
            orderId: null,
            actualCents: null,
            selectedVendorId: null,
            quotes: [],
            handlingFailureReason: null,
            approvedFingerprint: null,
            financeEntered: false,
            priceConfirmationRequired: false,
            handlingForced: false,
            handlingActorId: null,
            departmentId: null,
            year: null,
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
        writeRecordId.run(id, () =>
          runtime.fire(PURCHASE_LIFECYCLE, id, transition, {
            manual: true,
            actor: { id: actorId },
            input,
            expect: { version },
            requestId,
          }),
        );
      return mutationPolicy ? writePolicy.run(mutationPolicy, fire) : fire();
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(PURCHASE_LIFECYCLE, id);
      const target = input.target;
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((t) => t.id === target.taskId),
        )
      )
        throw new PurchaseError(
          'PURCHASE_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const perform = () =>
        writeRecordId.run(id, () =>
          approvals.perform({ ...input, actor: { id: actorId } }),
        );
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
      target: { taskId: string } | { runId: string },
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      policy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, policy);
      const views = await approvals.runViewsFor(PURCHASE_LIFECYCLE, id);
      if (
        !views.some((view) =>
          'runId' in target
            ? view.run.id === target.runId
            : view.tasks.some((task) => task.id === target.taskId),
        )
      )
        throw new PurchaseError(
          'PURCHASE_TARGET_MISMATCH',
          'The action target belongs to another request.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
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
        const runs = await approvals.runViewsFor(PURCHASE_LIFECYCLE, id);
        const userIds = [
          ...new Set(
            [
              record.applicantId,
              record.createdById,
              record.headApproverId,
              record.executiveApproverId,
              record.gmApproverId,
              record.handlingActorId,

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
          timeZone: d.calendar.timeZone(),
          department: record.departmentId
            ? ((await d.org.activeChain(record.departmentId))?.map((d) => ({
                id: d.id,
                title: d.title,
              }))[0] ?? null)
            : null,
          quoteBasisHash: purchaseQuoteBasis(record),
          order: record.orderId ? await d.orders.get(record.orderId) : null,
          record,
          users,
          view: await runtime.view(PURCHASE_LIFECYCLE, id, actor),
          runs: await approvals.runViewsFor(PURCHASE_LIFECYCLE, id),
          taskActions: await approvals.actionsFor(
            PURCHASE_LIFECYCLE,
            id,
            actor,
          ),
          runActions: await approvals.runActionsFor(
            PURCHASE_LIFECYCLE,
            id,
            actor,
          ),
          upcoming: await approvals.upcomingStagesFor(
            PURCHASE_LIFECYCLE,
            id,
            actor,
          ),
          timeline: await approvals.timelineFor(PURCHASE_LIFECYCLE, id),
        };
      });
    },
    async list(actorId: string, view: string, policy?: RepositoryPolicy) {
      await refresh();
      return readDirectory.run(outside.directory, async () => {
        const repository = d.db.repository<PurchaseRecord>('purchaseRequests');
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
        const selected: PurchaseRecord[] = [];
        for (const record of records) {
          if (
            view === 'pending' &&
            records.length > 10 &&
            !(await hasApprovalCandidate(
              approvals,
              PURCHASE_LIFECYCLE,
              record.id,
              actorId,
            ))
          )
            continue;

          const runs =
            view === 'done' || view === 'copied'
              ? await runTaskViewsFor(approvals, PURCHASE_LIFECYCLE, record.id)
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
                    await approvals.actionsFor(PURCHASE_LIFECYCLE, record.id, {
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
    async maintenance() {
      await refresh();
      const sweep = await approvals.sweepReport();
      await runtime.reclaim();
      await runtime.recover();
      const held = await d.db
        .repository<PurchaseRecord>('purchaseRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['head', 'purchasing', 'finance', 'executive', 'gm'].map((s) =>
                f.string('status').eq(s),
              ),
            ),
        });
      for (const record of held) await notifyHeld(record.id);
      return sweep;
    },
  };
}
export type PurchaseService = ReturnType<typeof createPurchaseService>;
export const purchaseServiceToken = createServiceToken<PurchaseService>(
  'oa/purchase-service',
);
