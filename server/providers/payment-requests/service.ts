import { runTaskViewsFor } from '../approval-runtime/task-views.js';
import {
  hasApprovalCandidate,
  createAppApprovalService,
} from '../approval-runtime/query-service.js';
import {
  appointAction,
  reassignAction,
} from '../process-management/actions.js';
import { processDirectorySnapshot } from '../process-management/context.js';
import type { ContractLedgerService } from '../contracts/contract.js';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import {
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
  allActivePeople,
  claimAction,
  releaseAction,
  assignAction,
  configureAction,
  peopleWithRole,
  transferAction,
  isOpenRun,
  APPROVAL_COLLECTIONS,
  type TaskRow,
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
import type { OrgService } from '../org/contract.js';
import type { AuditService } from '../audit/index.js';
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
import type { DictionaryService } from '../platform/dictionaries.js';
import type { ApprovalNotificationService } from '../approval-notifications/contract.js';
import type { PurchaseOrderService } from '../purchases/contract.js';
import type { VendorService } from '../vendors/contract.js';
import type { InvoiceService } from '../invoices/contract.js';
import { createOaApprovalOperations } from '../approval-directory/operations.js';
import { exceedsMoneyThreshold } from '../exact-money.js';
import {
  PAYMENT_REQUEST_LIFECYCLE,
  type PaymentRequestRecord,
  type PaymentRequestInput,
  type PaymentPayee,
} from './contract.js';
import { PaymentRequestError } from './errors.js';
import {
  createPaymentLifecycleStore,
  type PaymentMutation,
} from './lifecycle-store.js';
import { createPaymentRequestFunding } from './funding.js';
import { paymentCashActions } from './handling.js';
export { paymentRequestServiceToken } from './contract.js';

export const paymentRequestInputSchema = z.strictObject({
  reason: z.string().max(10000),
  sourceMode: z.enum(['purchase', 'contract', 'none']),
  purchaseOrderId: z.string().min(1).max(64).nullable(),
  contractId: z.string().min(1).max(64).nullable(),
  contractVersion: z.number().int().positive().nullable().default(null),
  noPriorApprovalReason: z.string().max(10000),
  vendorId: z.string().min(1).max(64).nullable(),
  amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  invoiceNumber: z.string().max(128),
  attachments: z.array(z.string().min(1).max(64)).max(10),
  paymentMethod: z.string().max(64),
});
const businessFields = [
  'reason',
  'sourceMode',
  'purchaseOrderId',
  'contractId',
  'contractVersion',
  'noPriorApprovalReason',
  'vendorId',
  'amountCents',
  'invoiceNumber',
  'attachments',
  'paymentMethod',
];
interface Services {
  directory: OaApprovalDirectory;
  connection?: DatabaseConnection;
  submissionFullApprovalRequired?: boolean;
  executiveGmMerge?: JsonObject | null;
}
interface Types {
  record: PaymentRequestRecord;
  state:
    | 'draft'
    | 'revision'
    | 'head'
    | 'finance'
    | 'executive'
    | 'gm'
    | 'cashier'
    | 'exception'
    | 'paid'
    | 'forcedPaid'
    | 'rejected'
    | 'withdrawn'
    | 'terminated';
  services: Services;
}
export interface PaymentRequestDependencies {
  db: DatabaseManager;
  orders: PurchaseOrderService;
  contracts: ContractLedgerService;
  vendors: VendorService;
  invoices: InvoiceService;
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
  validateAttachments(
    record: PaymentRequestRecord,
    purpose: 'invoice' | 'voucher',
    tx: DatabaseConnection,
  ): Promise<void>;
}
const fail = (
  code: string,
  message: string,
  kind: PaymentRequestError['kind'] = 'precondition',
): never => {
  throw new PaymentRequestError(code, message, kind);
};
const hashBusiness = (r: PaymentRequestRecord) =>
  createHash('sha256')
    .update(JSON.stringify(businessFields.map((key) => r[key])))
    .digest('hex');
export function createPaymentRequestService(d: PaymentRequestDependencies) {
  const policy = new AsyncLocalStorage<RepositoryPolicy>();
  const contractAccess = new AsyncLocalStorage<RepositoryPolicy | false>();
  async function checkContractAccess(
    id: string | null,
    tx: DatabaseConnection,
  ) {
    const access = contractAccess.getStore();
    if (!id || access === undefined) return; // Internal trusted owner calls enforce their own source authorization.
    if (!access)
      return fail(
        'PAYMENT_REQUEST_CONTRACT_DENIED',
        'Ordinary contract ledger access is required.',
        'permission',
      );
    const sources = await d.contracts.listForPayment(
      'payment-source',
      access,
      tx,
    );
    if (!sources.some((source) => source.id === id))
      fail(
        'PAYMENT_REQUEST_CONTRACT_DENIED',
        'The contract is outside the current granted scope.',
        'permission',
      );
  }
  const mutation = new AsyncLocalStorage<PaymentMutation>();
  const maintenance = new AsyncLocalStorage<boolean>();
  const adapter = createPaymentLifecycleStore({
    db: d.db,
    directory: d.directory,
    orders: d.orders,
    contracts: d.contracts,
    policy,
    mutation,
    maintenance,
    prepareSubmission: async (record, connection, actorId) => {
      await validate(record, connection);
      const reserved = await funding.reserve(
        record,
        actorId,
        `submit:${record.id}:${record.lifecycleVersion}`,
        connection,
      );
      return reserved.fullApprovalRequired;
    },
  });
  let outside: Services;
  const source = (handle: unknown): Services =>
    handle ? adapter.snapshots.get(handle)! : outside;
  const runtime = new LifecycleRuntime({
    store: adapter.store,
    dispatcher: d.dispatcher,
  });
  const funding = createPaymentRequestFunding(d);
  const owner = ({
    record,
    actor,
  }: {
    record: PaymentRequestRecord;
    actor: { id: string };
  }) => actor.id === record.applicantId || actor.id === record.createdById;
  const person = async (id: string) => ({
    id,
    name: (await d.users.get(id))?.name ?? id,
  });
  const namedRecord = async (record: PaymentRequestRecord) => ({
    ...record,
    applicant: await person(record.applicantId),
    creator: await person(record.createdById),
  });
  const admin = ({
    actor,
    services,
    input,
  }: {
    actor: { id: string };
    services: Services;
    input: JsonObject;
  }) =>
    services.directory.hasRole(actor.id, 'approval.admin') &&
    typeof input.reason === 'string' &&
    Boolean(input.reason.trim());
  const executiveNeeded = (r: PaymentRequestRecord) =>
    r.fullApprovalRequired &&
    exceedsMoneyThreshold(r.amountCents, r.ruleSnapshot?.['spend.vp']);
  const gmNeeded = (r: PaymentRequestRecord) =>
    r.fullApprovalRequired &&
    exceedsMoneyThreshold(r.amountCents, r.ruleSnapshot?.['spend.gm']);
  const stage = stagesFor<Types>();
  const cc = defineApprovalAction({
    ...ccAction,
    people: (ctx, query) => allActivePeople().search(ctx, query),
    validate: ({ to }, ctx) =>
      typeof to === 'string' && ctx.directory.isActive(to)
        ? null
        : 'Choose an active recipient.',
  });
  const actions = [
    ...createOaApprovalOperations(d),
    approve(),
    reject({ reason: 'required' }),
    returnTo({ targets: ['revision'], reason: 'required' }),
    commentAction,
    readAction,
    cc,
    defineApprovalAction({
      ...appointAction,
      people: async (context, query) => {
        const page = await allActivePeople().search(context, query);
        return {
          ...page,
          people: page.people.filter(
            (person) =>
              context.eligible(person, {
                replacing: false,
                kind: 'decide',
                role: 'member',
                via: 'assign',
              }).ok,
          ),
        };
      },
    }),
    defineApprovalAction({
      ...reassignAction,
      people: async (context, query) => {
        const page = await allActivePeople().search(context, query);
        return {
          ...page,
          people: page.people.filter(
            (person) =>
              context.eligible(person, { replacing: true, via: 'reassign' }).ok,
          ),
        };
      },
    }),
  ];
  const settings = {
    actions,
    onEmpty: 'hold' as const,
    reuse: 'unchanged' as const,
    remindAfterHours: 24,
    dueAfterHours: 48,
    onDue: 'escalate' as const,
  };
  async function validate(r: PaymentRequestRecord, tx: DatabaseConnection) {
    await checkContractAccess(r.contractId, tx);
    paymentRequestInputSchema.parse(
      Object.fromEntries(businessFields.map((key) => [key, r[key]])),
    );
    if (
      !r.reason.trim() ||
      !Number.isSafeInteger(r.amountCents) ||
      r.amountCents <= 0 ||
      (!r.vendorId && r.sourceMode !== 'contract') ||
      !r.invoiceNumber.trim() ||
      !r.attachments.length ||
      new Set(r.attachments).size !== r.attachments.length
    )
      fail(
        'PAYMENT_REQUEST_INVALID_INPUT',
        'Reason, payee, positive exact amount, invoice and protected evidence are required.',
      );
    const employee = await d.employees.getByUserId(r.applicantId, tx);
    if (!employee?.active || employee.status === 'left')
      fail(
        'PAYMENT_REQUEST_EMPLOYEE_INACTIVE',
        'An active employee archive is required.',
      );
    const department = await d.org.primaryDepartmentOf(r.applicantId, tx);
    if (!department)
      return fail(
        'PAYMENT_REQUEST_DEPARTMENT_REQUIRED',
        'An active primary department is required.',
      );
    if (
      !(await d.dictionaries.list('paymentMethod', {}, tx)).some(
        (method) => method.code === r.paymentMethod,
      )
    )
      fail(
        'PAYMENT_REQUEST_METHOD_INVALID',
        'Choose an active payment method.',
      );
    if (r.sourceMode === 'purchase' && r.purchaseOrderId) {
      const order = await d.orders.get(r.purchaseOrderId, tx);
      const directory = await processDirectorySnapshot(
        d.directory,
        'oa.payment',
        tx,
      );
      if (
        order &&
        order.departmentId !== department.id &&
        !['finance', 'financeManager', 'cfo', 'approval.admin'].some((role) =>
          directory.hasRole(r.applicantId, role),
        )
      )
        fail(
          'PAYMENT_REQUEST_SOURCE_SCOPE_DENIED',
          'The approved order is outside the applicant payment scope.',
          'permission',
        );
    }
    if (
      (r.sourceMode === 'purchase' && (r.contractId || !r.purchaseOrderId)) ||
      (r.sourceMode === 'contract' && (r.purchaseOrderId || !r.contractId)) ||
      (r.sourceMode === 'none' && (r.contractId || r.purchaseOrderId))
    )
      fail(
        'PAYMENT_REQUEST_SOURCE_INVALID',
        'Select exactly the source matching the payment mode.',
      );
    let vendorSnapshot: JsonObject;
    if (r.sourceMode === 'contract') {
      const contract = await d.contracts.source(r.contractId!, tx);
      if (
        !contract ||
        !['active', 'activePendingSeal'].includes(contract.status)
      )
        fail('PAYMENT_REQUEST_SOURCE_INVALID', 'Choose an effective contract.');
      if (r.contractVersion !== contract!.version)
        fail(
          'PAYMENT_REQUEST_CONTRACT_STALE',
          'The contract changed. Reload its latest version before resubmitting.',
          'conflict',
        );
      const counterparty = contract!.facts.counterparty;
      if (
        (counterparty.kind === 'vendor' ? counterparty.id : null) !== r.vendorId
      )
        fail(
          'PAYMENT_REQUEST_SOURCE_INVALID',
          'The payee must match the frozen contract counterparty.',
        );
      const directory = await processDirectorySnapshot(
        d.directory,
        'oa.payment',
        tx,
      );
      if (
        contract!.departmentId !== department.id &&
        !['finance', 'financeManager', 'cfo', 'approval.admin'].some((role) =>
          directory.hasRole(r.applicantId, role),
        )
      )
        fail(
          'PAYMENT_REQUEST_SOURCE_SCOPE_DENIED',
          'The contract is outside the applicant payment scope.',
          'permission',
        );
      vendorSnapshot = { ...counterparty };
      if (counterparty.kind === 'vendor')
        await d.vendors.snapshotForContract(counterparty.id, tx);
    } else
      vendorSnapshot = await d.vendors.snapshotForPurchase(r.vendorId!, tx);
    await d.validateAttachments(r, 'invoice', tx);
    return { department, vendorSnapshot };
  }
  async function snapshotPayee(
    r: PaymentRequestRecord,
    tx: DatabaseConnection,
  ) {
    const account =
      !r.vendorId || ['cash', 'cheque'].includes(r.paymentMethod)
        ? {
            bankName: '',
            bankAccount: '',
            bankAccountName:
              typeof r.vendorSnapshot?.name === 'string'
                ? r.vendorSnapshot.name
                : '',
          }
        : await d.vendors.paymentAccountOf(r.vendorId, tx);
    const values = {
      bankName: account.bankName,
      bankAccount: account.bankAccount,
      bankAccountName: account.bankAccountName,
    };
    const repo = tx.repository<PaymentPayee>('paymentPayees');
    const existing = await repo.findOne({ filter: { requestId: r.id } });
    if (existing)
      await repo.updateMany({
        filter: { requestId: r.id },
        values: { ...values, version: existing.version + 1 },
      });
    else
      await repo.createOne({
        values: { requestId: r.id, ...values, version: 1 },
      });
  }
  const release = (
    {
      previous,
      actor,
      tx,
    }: {
      previous: PaymentRequestRecord;
      actor: { id: string };
      tx: { handle?: unknown };
    },
    reason: string,
  ) =>
    funding.release(
      previous,
      actor.id,
      `${reason}:${previous.id}:${previous.lifecycleVersion}`,
      reason,
      tx.handle as DatabaseConnection,
    );
  const approval = defineApproval<Types>({
    name: PAYMENT_REQUEST_LIFECYCLE,
    collection: 'paymentRequests',
    initial: 'draft',
    version: 1,
    applicant: (r) => r.applicantId,
    directory: (s) => s.directory,
    calendar: () => d.calendar.approvalCalendar(),
    adminRole: 'approval.admin',
    freeze: [
      ...businessFields,
      'departmentId',
      'vendorSnapshot',
      'sourceContractId',
      'sourceContractVersion',
      'fullApprovalRequired',
      'sourceApprovedCents',
      'sourceCumulativeCents',
    ],
    afterEnd: [readAction],
    copies: { on: 'final', recipients: () => [] },
    notify: async ({ task, reason, services }) => {
      const r = await d.db
        .repository<PaymentRequestRecord>('paymentRequests')
        .findOne({ filter: { id: task.recordId } });
      await d.notifications.task({
        task,
        reason,
        directory: services.directory,
        applicantId: r?.applicantId,
        kind: PAYMENT_REQUEST_LIFECYCLE,
        at: new Date().toISOString(),
      });
    },
    create: {
      guard: async ({ values, actor, services }) => {
        await checkContractAccess(
          typeof values.contractId === 'string' ? values.contractId : null,
          services.connection!,
        );
        return (
          values.applicantId === actor.id ||
          services.directory.hasRole(actor.id, 'hr')
        );
      },
    },
    states: [
      'draft',
      'revision',
      'exception',
      approvalState(
        'head',
        stage.single({
          ...settings,
          assignee: ({ record }) => record.headApproverId ?? undefined,
        }),
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
          covers: ['amountCents'],
          assignee: ({ record }) => record.executiveApproverId ?? undefined,
        }),
      ),
      approvalState(
        'gm',
        stage.single({
          ...settings,
          covers: ['amountCents'],
          assignee: ({ record }) => record.gmApproverId ?? undefined,
        }),
      ),
      approvalState(
        'cashier',
        stage.first({
          onEmpty: 'hold',
          qualification: 'cashier',
          pools: [
            {
              key: 'cashier',
              candidates: ({ services }) =>
                services.directory.roleMembers('cashier'),
              claimable: true,
            },
          ],
          actions: [
            claimAction,
            releaseAction,
            assignAction,
            commentAction,
            readAction,
            ...actions.filter((action) =>
              ['appoint', 'reassign'].includes(
                'action' in action ? action.action.name : action.name,
              ),
            ),
            ...Object.values(paymentCashActions),
            configureAction(transferAction, {
              recipients: peopleWithRole(allActivePeople(), 'cashier'),
              reason: true,
            }),
            createOaApprovalOperations(d)[2],
          ],
          outputs: {
            fields: {
              voucherNumber: z.string().trim().min(1).max(128),
              voucherAttachments: z.array(z.string().min(1)).min(1).max(10),
            },
            required: ['voucherNumber', 'voucherAttachments'],
            writes: {
              voucherNumber: 'voucherNumber',
              voucherAttachments: 'voucherAttachments',
            },
          },
        }),
      ),
      ...(
        ['paid', 'forcedPaid', 'rejected', 'withdrawn', 'terminated'] as const
      ).map((name) => ({ name, final: true })),
    ],
    transitions: {
      edit: {
        from: ['draft', 'revision'],
        to: ['draft', 'revision'],
        route: ({ record }) => record.status as 'draft' | 'revision',
        guard: owner,
        accept: businessFields,
        set: async ({ record, actor, services, input }) => {
          const connection = services.connection!;
          const next = { ...record, ...paymentRequestInputSchema.parse(input) };
          await d.validateAttachments(next, 'invoice', connection);
          if (!record.ruleSnapshot) return {};
          await validate(next, connection);
          const reserved = await funding.reserve(
            next,
            actor.id,
            `edit:${record.id}:${record.lifecycleVersion}`,
            connection,
          );
          return reserved;
        },
      },
      submit: {
        from: ['draft', 'revision'],
        to: ['head', 'finance'],
        guard: owner,
        set: async ({ record, services, actor, now }) => {
          const tx = services.connection!;
          const { department, vendorSnapshot } = await validate(record, tx);
          const reserved = await funding.reserve(
            record,
            actor.id,
            `submit:${record.id}:${record.lifecycleVersion}`,
            tx,
          );
          const ruleSnapshot =
            record.ruleSnapshot ??
            (await d.rules.snapshot(
              [
                'spend.vp',
                'spend.gm',
                'sla.remindHours',
                'sla.escalateHours',
                'sla.urgeCooldownHours',
              ],
              now,
              tx,
            ));
          if (
            ruleSnapshot['sla.remindHours'] !== 24 ||
            ruleSnapshot['sla.escalateHours'] !== 48
          )
            fail(
              'PAYMENT_REQUEST_SLA_CONFIGURATION_UNSUPPORTED',
              'Only default 24/48 approval clocks are supported.',
            );
          exceedsMoneyThreshold(record.amountCents, ruleSnapshot['spend.vp']);
          exceedsMoneyThreshold(record.amountCents, ruleSnapshot['spend.gm']);
          return {
            ...reserved,
            departmentId: department.id,
            vendorSnapshot,
            ruleSnapshot,
            number:
              record.number ?? (await d.sequences.next('PAYMENT', tx, now)),
            headApproverId: (await d.org.headOf(department.id, tx)) ?? null,
            executiveApproverId:
              (await d.org.executiveOf(department.id, tx)) ?? null,
            gmApproverId: services.directory.uniqueRoleMember('gm') ?? null,
            headApprovedAt: null,
            financeApprovedAt: null,
            executiveApprovedAt: null,
            gmApprovedAt: null,
            gmMerged: null,
            approvalGrantedAt: null,
            voucherNumber: null,
            voucherAttachments: [],
            handlingFailureReason: null,
          };
        },
        // The SDK resolves route before set. The trusted transaction prelude
        // reserves the source first, so concurrent payments use its locked facts.
        route: ({ record, services }) =>
          (services.submissionFullApprovalRequired ??
          record.fullApprovalRequired)
            ? 'head'
            : 'finance',
      },
      headApproved: {
        from: 'head',
        to: 'finance',
        approvalOutcome: 'approved',
        set: ({ now }) => ({ headApprovedAt: now.toISOString() }),
      },
      financeApproved: {
        from: 'finance',
        to: ['executive', 'gm', 'cashier'],
        approvalOutcome: 'approved',
        route: ({ record }) =>
          executiveNeeded(record)
            ? 'executive'
            : gmNeeded(record)
              ? 'gm'
              : 'cashier',
        set: ({ now, record }) => ({
          financeApprovedAt: now.toISOString(),
          ...(executiveNeeded(record) || gmNeeded(record)
            ? {}
            : { approvalGrantedAt: now.toISOString() }),
        }),
        onTransition: async ({ record, to, tx }) => {
          if (to === 'cashier')
            await snapshotPayee(record, tx.handle as DatabaseConnection);
        },
      },
      executiveApproved: {
        from: 'executive',
        to: ['gm', 'cashier'],
        approvalOutcome: 'approved',
        guard: async ({ record, services, input }) => {
          services.executiveGmMerge = null;
          if (
            gmNeeded(record) &&
            record.executiveApproverId &&
            record.executiveApproverId === record.gmApproverId &&
            typeof input.runId === 'string'
          ) {
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
            if (task)
              services.executiveGmMerge = {
                runId: input.runId,
                taskId: task.id,
                personId: record.executiveApproverId,
              };
          }
          return true;
        },
        route: ({ record, services }) =>
          gmNeeded(record) && !services.executiveGmMerge ? 'gm' : 'cashier',
        set: ({ now, record, services }) => ({
          executiveApprovedAt: now.toISOString(),
          ...(services.executiveGmMerge
            ? {
                gmApprovedAt: now.toISOString(),
                gmMerged: {
                  ...services.executiveGmMerge,
                  at: now.toISOString(),
                  stages: ['executive', 'gm'],
                },
              }
            : {}),
          ...(gmNeeded(record) && !services.executiveGmMerge
            ? {}
            : { approvalGrantedAt: now.toISOString() }),
        }),
        onTransition: async ({ record, to, tx }) => {
          if (to === 'cashier')
            await snapshotPayee(record, tx.handle as DatabaseConnection);
        },
      },
      gmApproved: {
        from: 'gm',
        to: 'cashier',
        approvalOutcome: 'approved',
        set: ({ now }) => ({
          gmApprovedAt: now.toISOString(),
          approvalGrantedAt: now.toISOString(),
        }),
        onTransition: ({ record, tx }) =>
          snapshotPayee(record, tx.handle as DatabaseConnection),
      },
      cashCompleted: {
        from: 'cashier',
        to: 'paid',
        approvalOutcome: 'approved',
        set: async ({ record, actor, services, now, input }) => {
          const outputs = input.outputs as JsonObject;
          const completed = {
            ...record,
            voucherNumber: outputs.voucherNumber as string,
            voucherAttachments: outputs.voucherAttachments as string[],
          };
          await d.validateAttachments(
            completed,
            'voucher',
            services.connection!,
          );
          const payee = await services
            .connection!.repository<PaymentPayee>('paymentPayees')
            .findOne({ filter: { requestId: record.id } });
          if (
            !['cash', 'cheque'].includes(record.paymentMethod) &&
            (!payee?.bankAccount?.trim() ||
              !payee.bankName.trim() ||
              !payee.bankAccountName.trim())
          )
            fail(
              'PAYMENT_REQUEST_ACCOUNT_REQUIRED',
              'A complete protected payee account is required.',
            );
          return funding.settle(
            completed,
            actor.id,
            `pay:${record.id}:${record.lifecycleVersion}`,
            now,
            false,
            verifier,
            services.connection!,
          );
        },
      },
      cashForced: {
        from: 'cashier',
        to: 'forcedPaid',
        approvalOutcome: 'forcedPaid',
        set: async ({ record, input, actor, services, now }) => {
          if (input.confirmedCents !== record.amountCents)
            fail(
              'PAYMENT_REQUEST_FORCE_CONFIRMATION_REQUIRED',
              'Explicit exact confirmation of the approved payment amount is required.',
            );
          const updated = {
            ...record,
            forcedReason: typeof input.reason === 'string' ? input.reason : '',
            voucherNumber:
              typeof input.voucherNumber === 'string'
                ? input.voucherNumber.trim() || null
                : null,
          };
          return {
            ...(await funding.settle(
              updated,
              actor.id,
              `force:${record.id}:${record.lifecycleVersion}`,
              now,
              true,
              verifier,
              services.connection!,
            )),
            forcedReason: updated.forcedReason,
            voucherNumber: updated.voucherNumber,
          };
        },
      },
      cashUnable: {
        from: 'cashier',
        to: 'exception',
        approvalOutcome: 'rejected',
        set: async ({ record, input, actor, services }) => {
          const task =
            typeof input.runId === 'string'
              ? await services
                  .connection!.repository<TaskRow>(APPROVAL_COLLECTIONS.tasks)
                  .findOne({
                    filter: {
                      runId: input.runId,
                      stage: 'cashier',
                      status: 'completed',
                      answer: 'reject',
                      actorId: actor.id,
                    },
                  })
              : undefined;
          const explanation = task?.comment?.trim();
          if (!explanation)
            return fail(
              'PAYMENT_REQUEST_HANDLING_REASON_REQUIRED',
              'Unable-to-pay requires its persisted cashier explanation.',
            );
          return {
            exceptionContentHash: hashBusiness(record),
            handlingFailureReason: explanation,
          };
        },
      },
      returned: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'revision',
        approvalOutcome: 'returned',
      },
      rejected: {
        from: ['head', 'finance', 'executive', 'gm'],
        to: 'rejected',
        approvalOutcome: 'rejected',
        set: () => ({ sourceHeldCents: 0 }),
        onTransition: (ctx) => release(ctx, 'rejected'),
      },
      withdraw: {
        from: [
          'draft',
          'revision',
          'head',
          'finance',
          'executive',
          'gm',
          'exception',
        ],
        to: 'withdrawn',
        guard: owner,
        set: () => ({ sourceHeldCents: 0 }),
        onTransition: (ctx) => release(ctx, 'withdrawn'),
      },
      retryCash: {
        from: 'exception',
        to: 'cashier',
        guard: ({ record, actor }) =>
          owner({ record, actor }) &&
          record.exceptionContentHash === hashBusiness(record),
      },
      reviseBusiness: {
        from: 'exception',
        to: 'revision',
        guard: owner,
        accept: businessFields,
        set: async ({ record, actor, services, input }) => {
          const connection = services.connection!;
          const next = { ...record, ...paymentRequestInputSchema.parse(input) };
          await validate(next, connection);
          const reserved = await funding.reserve(
            next,
            actor.id,
            `revise:${record.id}:${record.lifecycleVersion}`,
            connection,
          );
          return reserved;
        },
      },
      retryCashAsAdmin: {
        from: 'exception',
        to: 'cashier',
        guard: admin,
        onTransition: ({ record, actor, input, tx }) =>
          d.audit.record(
            {
              actorId: actor.id,
              action: 'paymentRequest.retryCashAsAdmin',
              targetType: 'paymentRequests',
              targetId: record.id,
              reason: typeof input.reason === 'string' ? input.reason : '',
            },
            tx.handle as DatabaseConnection,
          ),
      },
      forcePayException: {
        from: 'exception',
        to: 'forcedPaid',
        guard: (context) => !context.record.sourceContractId && admin(context),
        set: async ({ record, input, actor, services, now }) => {
          if (input.confirmedCents !== record.amountCents)
            fail(
              'PAYMENT_REQUEST_FORCE_CONFIRMATION_REQUIRED',
              'Explicit exact confirmation of the approved payment amount is required.',
            );
          const updated = {
            ...record,
            forcedReason: typeof input.reason === 'string' ? input.reason : '',
            voucherNumber:
              typeof input.voucherNumber === 'string'
                ? input.voucherNumber.trim() || null
                : null,
          };
          return {
            ...(await funding.settle(
              updated,
              actor.id,
              `force:${record.id}:${record.lifecycleVersion}`,
              now,
              true,
              verifier,
              services.connection!,
            )),
            forcedReason: updated.forcedReason,
            voucherNumber: updated.voucherNumber,
          };
        },
      },
      terminate: {
        from: [
          'draft',
          'revision',
          'head',
          'finance',
          'executive',
          'gm',
          'cashier',
          'exception',
        ],
        to: 'terminated',
        guard: admin,
        set: () => ({ sourceHeldCents: 0 }),
        onTransition: async (ctx) => {
          await release(ctx, 'terminated');
          await d.audit.record(
            {
              actorId: ctx.actor.id,
              action: 'paymentRequest.terminate',
              targetType: 'paymentRequests',
              targetId: ctx.record.id,
              reason:
                typeof ctx.input.reason === 'string' ? ctx.input.reason : '',
            },
            ctx.tx.handle as DatabaseConnection,
          );
        },
      },
    },
    onEnter: Object.fromEntries(
      ['paid', 'forcedPaid', 'rejected', 'revision', 'exception'].map(
        (state) => [
          state,
          [
            {
              name: `paymentRequest.notify.${state}`,
              retry: { attempts: 5, backoffMs: 1000 },
              run: ({
                record,
                idempotencyKey,
              }: {
                record: PaymentRequestRecord;
                idempotencyKey: string;
              }) =>
                d.notifications.result({
                  recordId: record.id,
                  applicantId: record.applicantId,
                  state,
                  transitionId: idempotencyKey,
                  kind: PAYMENT_REQUEST_LIFECYCLE,
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
  const verifier = {
    async confirm(
      input: {
        paymentId: string;
        purchaseOrderId: string;
        contractId?: string;
        actorId: string;
        cents: number;
      },
      tx: DatabaseConnection,
    ) {
      const row = await tx
        .repository<PaymentRequestRecord>('paymentRequests')
        .findOne({ filter: { id: input.paymentId } });
      if (!row)
        return fail(
          'PAYMENT_REQUEST_NOT_FOUND',
          'Payment source not found.',
          'notFound',
        );
      const r = adapter.normalize(row);
      const intent = mutation.getStore();
      const directory = await processDirectorySnapshot(
        d.directory,
        'oa.payment',
        tx,
      );
      if (
        !intent ||
        intent.recordId !== r.id ||
        intent.actorId !== input.actorId ||
        !(
          // Native perform already checked the claimed task and qualification,
          // including its public proxy semantics. Do not replace that with a
          // second actor-role test that rejects an authorized proxy.
          (r.status === 'cashier' && intent.action === 'complete') ||
          (r.status === 'cashier' &&
            intent.action === 'forceComplete' &&
            directory.hasRole(input.actorId, 'approval.admin')) ||
          (r.status === 'exception' &&
            intent.transition === 'forcePayException' &&
            directory.hasRole(input.actorId, 'approval.admin'))
        )
      )
        return fail(
          'PAYMENT_REQUEST_SETTLEMENT_DENIED',
          'Only the actual claimed cashier completion or an explicit protected exception confirmation can settle this source.',
          'permission',
        );
      const full = Boolean(
        r.headApprovedAt &&
        r.financeApprovedAt &&
        (!executiveNeeded(r) || r.executiveApprovedAt) &&
        (!gmNeeded(r) || r.gmApprovedAt),
      );
      if (
        (input.contractId
          ? r.sourceContractId !== input.contractId ||
            r.contractId !== input.contractId
          : r.sourceOrderId !== input.purchaseOrderId ||
            r.purchaseOrderId !== input.purchaseOrderId) ||
        r.amountCents !== input.cents ||
        r.sourceHeldCents !== input.cents ||
        !r.approvalGrantedAt ||
        !r.financeApprovedAt ||
        !['cashier', 'exception', 'paid', 'forcedPaid'].includes(r.status) ||
        (r.fullApprovalRequired && !full)
      )
        return fail(
          'PAYMENT_REQUEST_SOURCE_INVALID',
          'The authoritative approved payment facts do not match this settlement.',
        );
      return {
        approved: true as const,
        contractId: r.sourceContractId ?? '',
        contractVersion: r.sourceContractVersion ?? 0,
        reference: `oa.payment:${r.id}:${r.sourceContractId}`,
        cents: r.amountCents,
        requiresFullApproval: r.fullApprovalRequired,
        completedFullApproval: full,
        sourceVersion: r.lifecycleVersion,
        forced:
          intent.action === 'forceComplete' ||
          intent.transition === 'forcePayException',
      };
    },
  };
  async function refresh() {
    outside = {
      directory: await processDirectorySnapshot(d.directory, 'oa.payment'),
    };
  }
  async function canRead(
    id: string,
    actorId: string,
    readPolicy?: RepositoryPolicy,
  ) {
    await refresh();
    const row = await d.db
      .repository<PaymentRequestRecord>('paymentRequests')
      .findOne({ filter: { id } });
    if (!row)
      return fail(
        'PAYMENT_REQUEST_NOT_FOUND',
        'Payment request not found.',
        'notFound',
      );
    // A domain owner/role never overrides the caller's scoped field grant.
    // Approval views include freeze/run snapshots, so a partial business record
    // cannot safely power this complete workflow surface.
    if (readPolicy) {
      const granted = await d.db
        .repository<PaymentRequestRecord>('paymentRequests')
        .withPolicy(readPolicy)
        .findOne({ filter: { id } });
      if (!granted)
        return fail(
          'PAYMENT_REQUEST_ACCESS_DENIED',
          'This payment is outside the granted scope.',
          'permission',
        );
      if (Object.keys(row).some((field) => !(field in granted)))
        return fail(
          'PAYMENT_REQUEST_FIELDS_RESTRICTED',
          'Complete payment workflow fields are outside this grant.',
          'permission',
        );
      return adapter.normalize(granted as PaymentRequestRecord);
    }
    if (
      owner({ record: row, actor: { id: actorId } }) ||
      outside.directory.hasRole(actorId, 'approval.admin') ||
      (await approvals.involvementOf(PAYMENT_REQUEST_LIFECYCLE, id, actorId))
        .length
    )
      return adapter.normalize(row);
    return fail(
      'PAYMENT_REQUEST_ACCESS_DENIED',
      'This payment is not accessible.',
      'permission',
    );
  }
  function rejectPrivateInput(input?: JsonObject) {
    if (
      input &&
      [
        'bankName',
        'bankAccount',
        'bankAccountName',
        'paymentAccount',
        'fullApprovalRequired',
        'headApprovedAt',
        'financeApprovedAt',
        'executiveApprovedAt',
        'gmApprovedAt',
        'gmMerged',
        'sourceOrderId',
        'sourceHeldCents',
        'sourceApprovedCents',
        'sourceCumulativeCents',
        'approvalGrantedAt',
        'paidAt',
        'paymentId',
        'vendorSnapshot',
        'ruleSnapshot',
      ].some((key) => key in input)
    )
      fail(
        'PAYMENT_REQUEST_PRIVATE_INPUT',
        'Protected payment facts cannot be written by a client.',
      );
  }
  return {
    initialize: refresh,
    runtime,
    approvals,
    approvalDefinition:
      approval.approval as unknown as import('@nocobase/app-plugin-approval/server').Approval<never>,
    confirm: (
      input: Parameters<typeof verifier.confirm>[0],
      tx: DatabaseConnection,
    ) => verifier.confirm(input, tx),
    async create(
      input: PaymentRequestInput,
      actorId: string,
      applicantId = actorId,
      createPolicy?: RepositoryPolicy,
      requestKey?: string,
      contractReadPolicy?: RepositoryPolicy | false,
    ) {
      const parsed = paymentRequestInputSchema.parse(input);
      await refresh();
      if (actorId !== applicantId && !outside.directory.hasRole(actorId, 'hr'))
        fail(
          'PAYMENT_REQUEST_ACCESS_DENIED',
          'Only HR may create a delegated payment.',
          'permission',
        );
      const create = (transaction?: DatabaseConnection) =>
        runtime.create(
          PAYMENT_REQUEST_LIFECYCLE,
          {
            ...parsed,
            id: randomUUID(),
            applicantId,
            createdById: actorId,
            number: null,
            departmentId: null,
            sourceOrderId: null,
            sourceContractId: null,
            sourceContractVersion: null,
            sourceHeldCents: 0,
            sourceApprovedCents: null,
            sourceCumulativeCents: null,
            vendorSnapshot: null,
            fullApprovalRequired: false,
            ruleSnapshot: null,
            headApproverId: null,
            executiveApproverId: null,
            gmApproverId: null,
            headApprovedAt: null,
            financeApprovedAt: null,
            executiveApprovedAt: null,
            gmApprovedAt: null,
            gmMerged: null,
            approvalGrantedAt: null,
            voucherNumber: null,
            voucherAttachments: [],
            paidAt: null,
            paymentId: null,
            exceptionContentHash: null,
            handlingFailureReason: null,
            forcedReason: null,
            createdAt: new Date().toISOString(),
          },
          { actor: { id: actorId }, transaction },
        );
      const perform = async () => {
        if (!requestKey) return create();
        if (requestKey.length > 128)
          fail(
            'PAYMENT_REQUEST_INVALID_INPUT',
            'The draft request key is too long.',
          );
        return d.db.connection().transaction(async (tx) => {
          for (const id of [...new Set([actorId, applicantId])].sort())
            await lockUserForAdministration(tx, id);
          const repo = tx.repository('paymentCreationCommands');
          const fingerprint = JSON.stringify({ applicantId, input: parsed });
          const old = await repo.findOne({ filter: { actorId, requestKey } });
          if (old) {
            if (old.fingerprint !== fingerprint)
              fail(
                'PAYMENT_REQUEST_IDEMPOTENCY_CONFLICT',
                'The request key already identifies different draft input.',
                'conflict',
              );
            const row = await tx
              .repository<PaymentRequestRecord>('paymentRequests')
              .findOne({ filter: { id: old.recordId as string } });
            if (!row)
              return fail(
                'PAYMENT_REQUEST_NOT_FOUND',
                'The original payment draft no longer exists.',
                'notFound',
              );
            return {
              record: adapter.normalize(row),
              entry: null,
              effectRuns: [],
              replayed: true,
            };
          }
          const result = await create(tx);
          await repo.createOne({
            values: {
              id: randomUUID(),
              actorId,
              requestKey,
              fingerprint,
              recordId: result.record.id,
            },
          });
          return result;
        });
      };
      const execute = () =>
        createPolicy ? policy.run(createPolicy, perform) : perform();
      return contractReadPolicy !== undefined
        ? contractAccess.run(contractReadPolicy, execute)
        : execute();
    },
    async transition(
      id: string,
      name: string,
      actorId: string,
      version: number,
      requestId: string,
      input: JsonObject = {},
      readPolicy?: RepositoryPolicy,
      writePolicy?: RepositoryPolicy,
      contractReadPolicy?: RepositoryPolicy | false,
    ) {
      rejectPrivateInput(input);
      await canRead(id, actorId, readPolicy);
      const perform = () =>
        mutation.run(
          {
            recordId: id,
            transition: name,
            actorId,
            ...(typeof input.purchaseOrderId === 'string' ||
            input.purchaseOrderId === null
              ? { nextOrderId: input.purchaseOrderId }
              : {}),
            ...(typeof input.contractId === 'string' ||
            input.contractId === null
              ? { nextContractId: input.contractId }
              : {}),
          },
          () =>
            runtime.fire(PAYMENT_REQUEST_LIFECYCLE, id, name, {
              manual: true,
              actor: { id: actorId },
              input,
              expect: { version },
              requestId,
            }),
        );
      const execute = () =>
        writePolicy ? policy.run(writePolicy, perform) : perform();
      return contractReadPolicy !== undefined
        ? contractAccess.run(contractReadPolicy, execute)
        : execute();
    },
    async action(
      id: string,
      input: Omit<PerformInput, 'actor'>,
      actorId: string,
      readPolicy?: RepositoryPolicy,
    ) {
      rejectPrivateInput(input.input);
      await canRead(id, actorId, readPolicy);
      const runs = await approvals.runViewsFor(PAYMENT_REQUEST_LIFECYCLE, id);
      const target = input.target;
      if (
        !runs.some((view) =>
          'taskId' in target
            ? view.tasks.some((task) => task.id === target.taskId)
            : view.run.id === target.runId,
        )
      )
        fail(
          'PAYMENT_REQUEST_TARGET_MISMATCH',
          'This action target belongs to another payment.',
          'permission',
        );
      return mutation.run({ recordId: id, action: input.action, actorId }, () =>
        approvals.perform({ ...input, actor: { id: actorId } }),
      );
    },
    async detail(id: string, actorId: string, readPolicy?: RepositoryPolicy) {
      const record = await canRead(id, actorId, readPolicy);
      const runs = await approvals.runViewsFor(PAYMENT_REQUEST_LIFECYCLE, id);
      const ids = [
        ...new Set(
          [
            record.applicantId,
            record.createdById,
            record.headApproverId,
            record.executiveApproverId,
            record.gmApproverId,
            ...runs.flatMap((view) =>
              view.tasks.flatMap((task) => [task.assigneeId, task.actorId]),
            ),
          ].filter((id): id is string => Boolean(id)),
        ),
      ];
      return {
        record,
        users: await Promise.all(
          ids.map(async (id) => ({
            id,
            name: (await d.users.get(id))?.name ?? id,
          })),
        ),
        view: await runtime.view(PAYMENT_REQUEST_LIFECYCLE, id, {
          id: actorId,
        }),
        runs,
        taskActions: await approvals.actionsFor(PAYMENT_REQUEST_LIFECYCLE, id, {
          id: actorId,
        }),
        runActions: await approvals.runActionsFor(
          PAYMENT_REQUEST_LIFECYCLE,
          id,
          { id: actorId },
        ),
        upcoming: await approvals.upcomingStagesFor(
          PAYMENT_REQUEST_LIFECYCLE,
          id,
          { id: actorId },
        ),
        timeline: await approvals.timelineFor(PAYMENT_REQUEST_LIFECYCLE, id),
      };
    },
    async paymentAccount(
      id: string,
      actorId: string,
      readPolicy?: RepositoryPolicy,
      viewPolicy?: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, readPolicy);
      if (viewPolicy) await canRead(id, actorId, viewPolicy);
      if (
        !owner({ record, actor: { id: actorId } }) &&
        !['finance', 'cashier', 'cfo', 'approval.admin'].some((role) =>
          outside.directory.hasRole(actorId, role),
        )
      )
        fail(
          'PAYMENT_REQUEST_ACCOUNT_DENIED',
          'The bank account has independent restricted access.',
          'permission',
        );
      return d.db
        .repository<PaymentPayee>('paymentPayees')
        .findOne({ filter: { requestId: id } });
    },
    async correctPaymentAccount(
      id: string,
      actorId: string,
      version: number,
      payeeVersion: number,
      account: Pick<
        PaymentPayee,
        'bankName' | 'bankAccount' | 'bankAccountName'
      >,
      reason: string,
      readPolicy?: RepositoryPolicy,
      viewPolicy?: RepositoryPolicy,
    ) {
      const record = await canRead(id, actorId, readPolicy);
      if (viewPolicy) await canRead(id, actorId, viewPolicy);
      if (
        record.status !== 'exception' ||
        !reason.trim() ||
        (!owner({ record, actor: { id: actorId } }) &&
          !outside.directory.hasRole(actorId, 'approval.admin'))
      )
        fail(
          'PAYMENT_REQUEST_ACCOUNT_CORRECTION_DENIED',
          'Only the applicant or approval administrator can correct an exception account with a reason.',
          'permission',
        );
      const fields = z
        .strictObject({
          bankName: z.string().trim().min(1).max(255),
          bankAccount: z.string().trim().min(1).max(255),
          bankAccountName: z.string().trim().min(1).max(255),
        })
        .parse(account);
      return d.db.connection().transaction(async (tx) => {
        await d.contracts.lockSources(
          [record.sourceContractId, record.contractId].filter(
            (id): id is string => Boolean(id),
          ),
          tx,
        );
        await d.orders.lockPaymentSources(
          [record.sourceOrderId, record.purchaseOrderId].filter(
            (id): id is string => Boolean(id),
          ),
          tx,
        );
        await lockUserForAdministration(tx, record.applicantId);
        const locked = await tx.repository('paymentRequests').updateMany({
          filter: { id, status: 'exception', lifecycleVersion: version },
          values: { status: 'exception' },
        });
        if (!locked.updatedCount)
          fail(
            'PAYMENT_REQUEST_ACCOUNT_STALE',
            'Reload the current exception before correcting its account.',
            'conflict',
          );
        const updated = await tx.repository('paymentPayees').updateMany({
          filter: { requestId: id, version: payeeVersion },
          values: { ...fields, version: payeeVersion + 1 },
        });
        if (!updated.updatedCount)
          fail(
            'PAYMENT_REQUEST_ACCOUNT_STALE',
            'The account changed. Reload before correcting it.',
            'conflict',
          );
        await d.audit.record(
          {
            actorId,
            action: 'paymentRequest.accountCorrection',
            targetType: 'paymentRequests',
            targetId: id,
            reason,
            before: { version: payeeVersion },
            after: { version: payeeVersion + 1 },
          },
          tx,
        );
        return { version: payeeVersion + 1 };
      });
    },
    async candidates(
      id: string,
      target: { taskId: string } | { runId: string },
      action: string,
      actorId: string,
      query: { search?: string; offset?: number; limit?: number },
      readPolicy?: RepositoryPolicy,
    ) {
      await canRead(id, actorId, readPolicy);
      const views = await approvals.runViewsFor(PAYMENT_REQUEST_LIFECYCLE, id);
      if (
        !views.some((v) =>
          'runId' in target
            ? v.run.id === target.runId
            : v.tasks.some((task) => task.id === target.taskId),
        )
      )
        fail(
          'PAYMENT_REQUEST_TARGET_MISMATCH',
          'The candidate target belongs to another payment.',
          'permission',
        );
      const page = await approvals.candidatesFor({
        target,
        action,
        actor: { id: actorId },
        query,
      });
      return {
        people: await Promise.all(
          page.people.map(async (id) => ({
            id,
            name: (await d.users.get(id))?.name ?? id,
          })),
        ),
        nextOffset: page.nextOffset,
      };
    },
    async readableIds(actorId: string) {
      await refresh();
      const records = await d.db
        .repository<PaymentRequestRecord>('paymentRequests')
        .findMany();
      const ids: string[] = [];
      for (const r of records) {
        if (
          owner({ record: r, actor: { id: actorId } }) ||
          [
            'finance',
            'financeManager',
            'cashier',
            'cfo',
            'approval.admin',
            'gm',
          ].some((role) => outside.directory.hasRole(actorId, role)) ||
          r.executiveApproverId === actorId ||
          (
            await approvals.involvementOf(
              PAYMENT_REQUEST_LIFECYCLE,
              r.id,
              actorId,
            )
          ).length ||
          (r.departmentId &&
            (await d.org.activeChain(r.departmentId))?.some(
              (dept) => dept.managerId === actorId,
            )) ||
          (await d.employees.isAboveInReportingLine(actorId, r.applicantId))
        )
          ids.push(r.id);
      }
      return ids;
    },
    async list(actorId: string, view: string, readPolicy?: RepositoryPolicy) {
      await refresh();
      const repo = d.db.repository<PaymentRequestRecord>('paymentRequests');
      const rows = await (
        readPolicy ? repo.withPolicy(readPolicy) : repo
      ).findMany({
        sort: (s) => [s.field('createdAt').desc(), s.field('id').asc()],
      });
      const required = [
        'id',
        'applicantId',
        'createdById',
        ...businessFields,
        'sourceHeldCents',
        'sourceApprovedCents',
        'sourceCumulativeCents',
        'status',
        'lifecycleVersion',
      ];
      if (rows.some((row) => required.some((field) => !(field in row))))
        fail(
          'PAYMENT_REQUEST_FIELDS_RESTRICTED',
          'The payment business fields are outside this grant.',
          'permission',
        );
      const records = rows.map((row) =>
        adapter.normalize(row as PaymentRequestRecord),
      );
      if (view === 'mine')
        return Promise.all(
          records
            .filter((record) => owner({ record, actor: { id: actorId } }))
            .map(namedRecord),
        );
      const selected: PaymentRequestRecord[] = [];
      for (const record of records) {
        if (
          view === 'pending' &&
          records.length > 10 &&
          !(await hasApprovalCandidate(
            approvals,
            PAYMENT_REQUEST_LIFECYCLE,
            record.id,
            actorId,
          ))
        )
          continue;

        const tasks =
          view === 'done' || view === 'copied'
            ? (
                await runTaskViewsFor(
                  approvals,
                  PAYMENT_REQUEST_LIFECYCLE,
                  record.id,
                )
              ).flatMap((run) => run.tasks)
            : [];
        const match =
          view === 'copied'
            ? tasks.some(
                (task) => task.kind === 'copy' && task.assigneeId === actorId,
              )
            : view === 'done'
              ? tasks.some(
                  (task) =>
                    task.actorId === actorId &&
                    ['completed', 'transferred'].includes(task.status),
                )
              : (
                  await approvals.actionsFor(
                    PAYMENT_REQUEST_LIFECYCLE,
                    record.id,
                    { id: actorId },
                  )
                ).some((task) =>
                  task.actions.some((action) =>
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
      return Promise.all(selected.map(namedRecord));
    },
    async options(
      actorId: string,
      applicantId = actorId,
      access?: RepositoryPolicy,
      recordId?: string,
      contractPolicy?: RepositoryPolicy,
    ) {
      await refresh();
      if (recordId) {
        const record = await canRead(recordId, actorId, access);
        if (record.applicantId !== applicantId)
          fail(
            'PAYMENT_REQUEST_ACCESS_DENIED',
            'Options must match the existing applicant.',
            'permission',
          );
      } else if (applicantId !== actorId) {
        const create = access?.create;
        if (
          !outside.directory.hasRole(actorId, 'hr') ||
          !create ||
          (create !== true &&
            (create.scope !== true ||
              create.fields === false ||
              (Array.isArray(create.fields) &&
                !create.fields.includes('applicantId'))))
        )
          fail(
            'PAYMENT_REQUEST_ACCESS_DENIED',
            'Delegated candidates require HR and an unrestricted target create grant.',
            'permission',
          );
      }
      const department = await d.org.primaryDepartmentOf(applicantId);
      const allDepartments = [
        'finance',
        'financeManager',
        'cfo',
        'approval.admin',
      ].some((role) => outside.directory.hasRole(applicantId, role));
      const orders = [];
      for (let page = 1; ; page++) {
        const result = await d.orders.list(
          { page, pageSize: 100, sort: 'createdAt', direction: 'desc' },
          { read: true, create: false, update: false, delete: false },
        );
        for (const order of result.data)
          if (
            order.status !== 'cancelled' &&
            (allDepartments || order.departmentId === department?.id)
          ) {
            const totals = await d.orders.paymentTotals(order.id);
            orders.push({
              id: order.id,
              number: order.number,
              applicantId: order.applicantId,
              applicant: await person(order.applicantId),
              actualCents: order.actualCents,
              vendor: order.vendor,
              status: order.status,
              ...totals,
            });
          }
        if (result.meta.page * result.meta.pageSize >= result.meta.total) break;
      }
      return {
        actorId,
        applicantId,
        actor: await person(actorId),
        applicant: await person(applicantId),
        timeZone: d.calendar.timeZone(),
        vendors: await d.vendors.options(),
        orders,
        contracts: contractPolicy
          ? (
              await d.contracts.listForPayment(
                actorId,
                contractPolicy,
                d.db.connection(),
              )
            ).filter(
              (contract) =>
                allDepartments || contract.departmentId === department?.id,
            )
          : [],
        paymentMethods: await d.dictionaries.list('paymentMethod'),
      };
    },
    async paymentFact(id: string, tx = d.db.connection()) {
      const row = await tx
        .repository('paymentRequestLedger')
        .findOne({ filter: { requestId: id } });
      return row
        ? {
            id,
            purchaseOrderId: row.purchaseOrderId as string | null,
            cents: Number(row.cents),
            paidAt: new Date(row.paidAt as Date).toISOString(),
            forced: Boolean(row.forced),
          }
        : null;
    },
    async maintenance() {
      await refresh();
      const sweep = await maintenance.run(true, () => approvals.sweepReport());
      await runtime.reclaim();
      await runtime.recover();
      const rows = await d.db
        .repository<PaymentRequestRecord>('paymentRequests')
        .findMany({
          filter: (f) =>
            f.or(
              ['head', 'finance', 'executive', 'gm', 'cashier'].map((state) =>
                f.string('status').eq(state),
              ),
            ),
        });
      for (const record of rows)
        for (const view of await approvals.runViewsFor(
          PAYMENT_REQUEST_LIFECYCLE,
          record.id,
        ))
          if (isOpenRun(view.run) && !view.tasks.length)
            await d.notifications.alarm({
              recordId: record.id,
              kind: PAYMENT_REQUEST_LIFECYCLE,
              recipients: outside.directory.roleMembers('approval.admin'),
              eventId: `hold:${view.run.id}`,
              reason: 'unassigned',
            });
      return sweep;
    },
  };
}
export type PaymentRequestService = ReturnType<
  typeof createPaymentRequestService
>;
