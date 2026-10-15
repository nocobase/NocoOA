import { actionMutation } from './action-mutation.js';
import { requestBusinessRead } from '../request-performance/business-reads.js';
import { createHash, randomUUID } from 'node:crypto';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import type {
  DatabaseConnection,
  DatabaseManager,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';
import {
  LifecycleRuntime,
  defineLifecycle,
  defineEffect,
  type EffectDispatcher,
  type JsonObject,
} from '@nocobase/lifecycle';
import { createAppLifecycleStore } from '../approval-runtime/repository-store.js';
import type { AuditService } from '../audit/index.js';
import type { OrgService } from '../org/contract.js';
import type { EmployeeService } from '../employees/contract.js';
import {
  WORK_ITEM_FIELDS,
  type WorkItem,
  type WorkItemService,
  type WorkItemAction,
  type Command,
} from './contract.js';
export class WorkItemError extends Error {
  constructor(
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(code);
  }
}
function fail(code: string): never {
  throw new WorkItemError(code);
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, v: unknown) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
            )
          : v,
      ),
    )
    .digest('hex');
export function createWorkItemService(d: {
  db: DatabaseManager;
  audit: AuditService;
  org: OrgService;
  employees: EmployeeService;
  users: UserAdministrationService;
  dispatcher?: EffectDispatcher;
  now?: () => Date;
  notify?: (users: string[], id: string, key: string) => Promise<void>;
}): WorkItemService & { runtime: LifecycleRuntime } {
  const now = () => d.now?.() ?? new Date();
  const qualificationReads = {};
  function readQualification<T>(
    tx: DatabaseConnection,
    key: string,
    read: () => Promise<T>,
  ): Promise<T> {
    // Only immutable facts in the current GET on the root connection are shared.
    // Transactional guards, commands and explicit snapshots always read afresh.
    return tx === d.db.connection()
      ? requestBusinessRead(qualificationReads, key, read)
      : read();
  }
  function hasDutyRole(actorId: string, role: string, tx: DatabaseConnection) {
    return readQualification(tx, `duty:${actorId}:${role}`, () =>
      d.org.hasDutyRole(actorId, role, tx),
    );
  }
  const final = (w: WorkItem) => ['completed', 'cancelled'].includes(w.status);
  // Share the authentication administration locks with departure before taking
  // the business row lock. Reassignment during acquisition fails closed.
  async function lockActors(
    tx: DatabaseConnection,
    actorId: string,
    id?: string,
    targetUserId?: string | null,
    extraUserIds: string[] = [],
  ) {
    const before = id
      ? await tx.repository<WorkItem>('workItems').findOne({ filter: { id } })
      : undefined;
    const identities = (w?: WorkItem) =>
      [
        actorId,
        ...extraUserIds,
        targetUserId,
        w?.creatorUserId,
        w?.confirmationOwnerUserId,
        w?.assigneeUserId,
        w?.targetUserId,
      ]
        .filter((v): v is string => !!v)
        .sort();
    const ids = [...new Set(identities(before))];
    for (const userId of ids) await lockUserForAdministration(tx, userId);
    if (id) {
      await lock(id, tx);
      const after = await tx
        .repository<WorkItem>('workItems')
        .findOne({ filter: { id } });
      if (identities(after).some((userId) => !ids.includes(userId)))
        fail('VERSION_CONFLICT');
    }
  }
  async function active(userId: string, tx: DatabaseConnection) {
    return readQualification(tx, `active:${userId}`, async () => {
      const [e, user] = await Promise.all([
        d.employees.getByUserId(userId, tx),
        d.users.withConnection(tx).get(userId),
      ]);
      return (
        !!e?.active &&
        e.status !== 'left' &&
        !!user &&
        user.disabledAt === null &&
        user.kind === 'person'
      );
    });
  }
  async function candidate(
    w: WorkItem,
    actorId: string,
    tx: DatabaseConnection,
  ) {
    return (
      (await active(actorId, tx)) &&
      (w.dutyRoleCode
        ? await hasDutyRole(actorId, w.dutyRoleCode, tx)
        : w.targetUserId === actorId)
    );
  }
  async function admin(actorId: string, tx: DatabaseConnection) {
    return (
      (await active(actorId, tx)) && (await hasDutyRole(actorId, 'admin', tx))
    );
  }
  async function qualification(
    w: WorkItem,
    actorId: string,
    tx: DatabaseConnection,
  ) {
    return (
      (await active(actorId, tx)) &&
      (w.creatorUserId === actorId ||
        w.confirmationOwnerUserId === actorId ||
        (await candidate(w, actorId, tx)))
    );
  }
  const notice = defineEffect<{
    record: WorkItem & { readonly [key: string]: unknown };
    state: WorkItem['status'];
  }>({
    name: 'oa.workItem.notice',
    retry: { attempts: 5, backoffMs: 5000, factor: 2 },
    run: async ({ record, input, to, idempotencyKey }) => {
      if (input.handoverConfirmation === true) return;
      const current = await d.db
        .repository<WorkItem>('workItems')
        .findOne({ filter: { id: record.id } });
      if (
        !current ||
        current.status !== to ||
        (typeof input.noticeVersion === 'number' &&
          current.version !== input.noticeVersion)
      )
        return;
      const tx = d.db.connection();
      let ids: string[] =
        current.status === 'awaitingConfirmation'
          ? current.confirmationOwnerUserId
            ? [current.confirmationOwnerUserId]
            : []
          : current.status === 'blocked' || final(current)
            ? [current.creatorUserId]
            : current.status === 'open' && current.dutyRoleCode
              ? [...(await d.org.dutyRoleMembers(current.dutyRoleCode, tx))]
              : current.assigneeUserId
                ? [current.assigneeUserId]
                : [];
      ids = [...new Set(ids)];
      const users = [];
      for (const id of ids) if (await active(id, tx)) users.push(id);
      if (users.length) await d.notify?.(users, current.id, idempotencyKey);
    },
  });
  const handoverNotice = defineEffect<{
    record: WorkItem & { readonly [key: string]: unknown };
    state: WorkItem['status'];
  }>({
    name: 'oa.workItem.confirmationHandoverNotice',
    retry: { attempts: 5, backoffMs: 5000, factor: 2 },
    run: async ({ record, input, idempotencyKey }) => {
      const current = await d.db
        .repository<WorkItem>('workItems')
        .findOne({ filter: { id: record.id } });
      if (
        !current ||
        current.version !== input.noticeVersion ||
        current.confirmationOwnerUserId !== input.toUserId ||
        final(current)
      )
        return;
      if (
        current.confirmationOwnerUserId &&
        (await active(current.confirmationOwnerUserId, d.db.connection()))
      )
        await d.notify?.(
          [current.confirmationOwnerUserId],
          current.id,
          idempotencyKey,
        );
    },
  });
  const lifecycle = defineLifecycle<{
    record: WorkItem & { readonly [key: string]: unknown };
    state: WorkItem['status'];
  }>({
    name: 'oa.workItem',
    collection: 'workItems',
    versionField: 'version',
    initial: 'draft',
    states: [
      'draft',
      'open',
      'assigned',
      'claimed',
      'awaitingConfirmation',
      'blocked',
      { name: 'completed', final: true },
      { name: 'cancelled', final: true },
    ],
    onEnter: {
      open: [notice],
      assigned: [notice],
      claimed: [notice],
      awaitingConfirmation: [notice],
      blocked: [notice],
      completed: [notice],
      cancelled: [notice],
    },
    transitions: {
      handoverConfirmation: {
        from: [
          'open',
          'assigned',
          'claimed',
          'awaitingConfirmation',
          'blocked',
        ],
        to: ['open', 'assigned', 'claimed', 'awaitingConfirmation', 'blocked'],
        route: ({ record }) => record.status,
        accept: ['confirmationOwnerUserId'],
        effects: [handoverNotice],
      },
      edit: {
        from: 'draft',
        to: 'draft',
        accept: [
          'title',
          'description',
          'targetUserId',
          'dutyRoleCode',
          'dueAt',
          'requiresConfirmation',
          'confirmationOwnerUserId',
          'attachments',
        ],
      },
      dispatch: {
        from: 'draft',
        to: ['open', 'assigned'],
        route: ({ record }) => (record.dutyRoleCode ? 'open' : 'assigned'),
        accept: ['assigneeUserId'],
      },
      claim: { from: 'open', to: 'claimed', accept: ['assigneeUserId'] },
      release: { from: 'claimed', to: 'open', accept: ['assigneeUserId'] },
      complete: {
        from: ['assigned', 'claimed'],
        to: ['completed', 'awaitingConfirmation'],
        route: ({ record }) =>
          record.requiresConfirmation ? 'awaitingConfirmation' : 'completed',
        accept: ['result', 'resultAttachments', 'completedAt'],
      },
      confirm: {
        from: 'awaitingConfirmation',
        to: 'completed',
        accept: ['completedAt'],
      },
      return: {
        from: 'awaitingConfirmation',
        to: ['assigned', 'claimed'],
        route: ({ record }) => (record.dutyRoleCode ? 'claimed' : 'assigned'),
        accept: ['reason', 'result', 'resultAttachments'],
      },
      block: {
        from: ['assigned', 'claimed'],
        to: 'blocked',
        accept: ['reason'],
      },
      resume: {
        from: 'blocked',
        to: ['assigned', 'claimed'],
        route: ({ record }) => (record.dutyRoleCode ? 'claimed' : 'assigned'),
        accept: ['reason'],
      },
      reassign: {
        from: [
          'open',
          'assigned',
          'claimed',
          'blocked',
          'awaitingConfirmation',
        ],
        to: ['open', 'assigned'],
        route: ({ input }) => (input.dutyRoleCode ? 'open' : 'assigned'),
        accept: [
          'targetUserId',
          'dutyRoleCode',
          'assigneeUserId',
          'reason',
          'result',
          'resultAttachments',
        ],
      },
      cancel: {
        from: [
          'draft',
          'open',
          'assigned',
          'claimed',
          'blocked',
          'awaitingConfirmation',
        ],
        to: 'cancelled',
        accept: ['reason'],
      },
      forceComplete: {
        from: [
          'open',
          'assigned',
          'claimed',
          'blocked',
          'awaitingConfirmation',
        ],
        to: 'completed',
        accept: [
          'forced',
          'reason',
          'result',
          'resultAttachments',
          'completedAt',
        ],
      },
    },
  });
  const runtime = new LifecycleRuntime({
    store: createAppLifecycleStore(d.db, {
      collections: {
        transitions: 'oaLifecycleTransitions',
        effectRuns: 'oaLifecycleEffectRuns',
      },
    }),
    clock: now,
    dispatcher: d.dispatcher,
  });
  runtime.register(lifecycle);
  async function lock(id: string, tx: DatabaseConnection) {
    const result = await tx
      .repository('workItems')
      .updateMany({ filter: { id }, values: { version: { increment: 0 } } });
    if (result.updatedCount !== 1) fail('NOT_FOUND');
  }
  async function get(
    id: string,
    actorId: string,
    tx: DatabaseConnection,
    p?: RepositoryPolicy,
  ) {
    if (p?.read === false) fail('ACCESS_DENIED');
    const repo = tx.repository<WorkItem>('workItems'),
      row = await (p ? repo.withPolicy(p) : repo).findOne({ filter: { id } });
    return row ? readableRow(row, actorId, tx) : undefined;
  }
  async function readableRow(
    row: Partial<WorkItem>,
    actorId: string,
    tx: DatabaseConnection,
  ) {
    if (WORK_ITEM_FIELDS.some((k) => !(k in row))) fail('ACCESS_DENIED');
    if (row.requiresConfirmation && !row.confirmationOwnerUserId)
      fail('ACCESS_DENIED');
    const w = row as WorkItem;
    if (
      w.status === 'draft' &&
      w.creatorUserId !== actorId &&
      !(await admin(actorId, tx))
    )
      return undefined;
    if (
      !(await qualification(w, actorId, tx)) &&
      !(await admin(actorId, tx)) &&
      !((await active(actorId, tx)) && (await hasDutyRole(actorId, 'hr', tx)))
    )
      return undefined;
    return w;
  }
  async function check(
    tx: DatabaseConnection,
    p: RepositoryPolicy | undefined,
    values: Record<string, unknown>,
    id?: string,
  ) {
    if (!p) return;
    if ((id ? p.update : p.create) === false) fail('ACCESS_DENIED');
    const result = await tx
      .repository('workItems')
      .withPolicy(p)
      .validateMutation(
        id
          ? {
              operation: 'updateOne',
              filter: { id },
              values: values as RepositoryRecord,
            }
          : { operation: 'createOne', values: values as RepositoryRecord },
      );
    if (!result.valid) fail('ACCESS_DENIED');
  }
  async function target(
    userId: string | null,
    role: string | null,
    tx: DatabaseConnection,
  ) {
    if (!!userId === !!role) fail('INVALID_TARGET');
    if (userId && !(await active(userId, tx))) fail('INVALID_TARGET');
    if (
      role &&
      !(await tx
        .repository('dutyRoles')
        .exists({ filter: { code: role, active: true } }))
    )
      fail('INVALID_TARGET');
  }
  async function files(
    ids: string[],
    w: WorkItem,
    actorId: string,
    purpose: string,
    tx: DatabaseConnection,
  ) {
    if (ids.length > 10 || new Set(ids).size !== ids.length)
      fail('INVALID_ATTACHMENT');
    for (const id of ids)
      if (
        !(await tx.repository('workItemFiles').exists({
          filter: { id, workItemId: w.id, ownerId: actorId, purpose },
        }))
      )
        fail('INVALID_ATTACHMENT');
  }
  async function command(
    input: Command,
    kind: string,
    tx: DatabaseConnection,
    work: () => Promise<WorkItem>,
    replay: (w: WorkItem) => Promise<WorkItem>,
  ) {
    if (!input.requestId || input.requestId.length > 128) fail('INVALID_INPUT');
    const id = hash(input.requestId),
      payloadHash = hash({ kind, input });
    const old = await tx
      .repository<{
        id: string;
        actorId: string;
        payloadHash: string;
        result: WorkItem;
      }>('workItemCommands')
      .findOne({ filter: { id } });
    if (old) {
      if (old.actorId !== input.actorId || old.payloadHash !== payloadHash)
        fail('COMMAND_CONFLICT');
      return replay(old.result);
    }
    const result = await work();
    await tx.repository('workItemCommands').createOne({
      values: {
        id,
        actorId: input.actorId,
        payloadHash,
        result: JSON.parse(JSON.stringify(result)) as JsonObject,
      },
    });
    await d.audit.record(
      {
        actorId: input.actorId,
        action: `workItem.${kind}`,
        targetType: 'workItems',
        targetId: result.id,
        after: { commandId: id, status: result.status, forced: result.forced },
        reason:
          kind === 'handoverConfirmation' &&
          'reason' in input &&
          typeof input.reason === 'string'
            ? input.reason
            : result.reason,
        ...(kind === 'handoverConfirmation' &&
        'fromUserId' in input &&
        'toUserId' in input
          ? {
              before: { confirmationOwnerUserId: input.fromUserId },
              after: {
                commandId: id,
                status: result.status,
                forced: result.forced,
                confirmationOwnerUserId: input.toUserId,
                version: result.version,
              },
            }
          : {}),
      },
      tx,
    );
    return result;
  }
  function replayMutation(
    w: WorkItem,
    i: Parameters<WorkItemService['act']>[0],
  ): RepositoryRecord {
    const v: RepositoryRecord = {};
    if (
      [
        'cancel',
        'forceComplete',
        'return',
        'block',
        'resume',
        'reassign',
      ].includes(i.action)
    )
      v.reason = i.reason ?? null;
    if (i.action === 'dispatch')
      v.assigneeUserId = w.dutyRoleCode ? null : w.targetUserId;
    if (i.action === 'claim') v.assigneeUserId = i.actorId;
    if (i.action === 'release') v.assigneeUserId = null;
    if (['complete', 'forceComplete'].includes(i.action)) {
      v.result = i.result ?? null;
      v.resultAttachments = i.resultAttachments ?? [];
      v.completedAt = w.completedAt;
      if (i.action === 'forceComplete') v.forced = true;
    }
    if (i.action === 'confirm') v.completedAt = w.completedAt;
    if (['return', 'reassign'].includes(i.action)) {
      v.result = null;
      v.resultAttachments = [];
    }
    if (i.action === 'reassign') {
      v.targetUserId = i.targetUserId ?? null;
      v.dutyRoleCode = i.dutyRoleCode ?? null;
      v.assigneeUserId = i.dutyRoleCode ? null : (i.targetUserId ?? null);
    }
    return v;
  }
  async function actions(
    w: WorkItem,
    actorId: string,
    tx: DatabaseConnection,
  ): Promise<WorkItemAction[]> {
    if (!(await active(actorId, tx)) || final(w)) return [];
    const result: WorkItemAction[] = [],
      creator = w.creatorUserId === actorId,
      eligible = await candidate(w, actorId, tx),
      assigned = eligible && w.assigneeUserId === actorId,
      isAdmin = await admin(actorId, tx);
    if (creator) {
      if (w.status === 'draft') result.push('dispatch');
      result.push('cancel');

      if (!['draft', 'completed', 'cancelled'].includes(w.status))
        result.push('reassign');
      if (
        w.status === 'blocked' &&
        w.assigneeUserId &&
        (await candidate(w, w.assigneeUserId, tx))
      )
        result.push('resume');
    }
    if (
      w.confirmationOwnerUserId === actorId &&
      w.status === 'awaitingConfirmation'
    )
      result.push('confirm', 'return');
    if (eligible && w.status === 'open') result.push('claim');
    if (assigned && w.status === 'claimed') result.push('release');
    if (assigned && ['assigned', 'claimed'].includes(w.status))
      result.push('complete', 'block');
    if (isAdmin) {
      if (w.status !== 'draft') result.push('forceComplete', 'reassign');
      result.push('cancel');
      if (
        w.status === 'blocked' &&
        w.assigneeUserId &&
        (await candidate(w, w.assigneeUserId, tx))
      )
        result.push('resume');
    }
    return [...new Set(result)];
  }
  return {
    async canHandoverConfirmation(id, actorId, tx, policies) {
      try {
        if (
          !policies.view ||
          !policies.handover ||
          !(await active(actorId, tx))
        )
          return false;
        if (
          !(await hasDutyRole(actorId, 'hr', tx)) &&
          !(await hasDutyRole(actorId, 'admin', tx))
        )
          return false;
        const w = await get(id, actorId, tx, policies.view);
        if (
          !w ||
          !w.requiresConfirmation ||
          !w.confirmationOwnerUserId ||
          w.status === 'draft' ||
          final(w) ||
          !(await active(w.confirmationOwnerUserId, tx))
        )
          return false;
        // Probe the complete mutation field policy without changing responsibility.
        await check(
          tx,
          policies.handover,
          {
            confirmationOwnerUserId: w.confirmationOwnerUserId,
            status: w.status,
            statusChangedAt: now(),
            version: w.version + 1,
          },
          w.id,
        );
        return true;
      } catch (error) {
        if (error instanceof WorkItemError && error.code === 'ACCESS_DENIED')
          return false;
        throw error;
      }
    },
    async handoverConfirmation(input, connection, policies) {
      return connection.transaction(async (tx) => {
        await lockActors(tx, input.actorId, input.id, input.toUserId, [
          input.fromUserId,
        ]);
        async function checked(replay = false) {
          if (
            !policies?.view ||
            !policies?.handover ||
            !(await active(input.actorId, tx)) ||
            (!(await hasDutyRole(input.actorId, 'hr', tx)) &&
              !(await hasDutyRole(input.actorId, 'admin', tx)))
          )
            fail('ACCESS_DENIED');
          const w = await get(input.id, input.actorId, tx, policies.view);
          if (!w) fail('ACCESS_DENIED');
          if (!w.requiresConfirmation || w.status === 'draft')
            fail('INVALID_INPUT');
          if (
            input.fromUserId === input.toUserId ||
            !(await active(input.fromUserId, tx)) ||
            !(await active(input.toUserId, tx)) ||
            input.toUserId === w.assigneeUserId ||
            (!w.dutyRoleCode && input.toUserId === w.targetUserId)
          )
            fail('INVALID_TARGET');
          if (!input.reason?.trim() || input.reason.length > 2000)
            fail('REASON_REQUIRED');
          if (replay) {
            if (w.confirmationOwnerUserId !== input.toUserId)
              fail('VERSION_CONFLICT');
          } else {
            if (final(w)) fail('INVALID_INPUT');
            if (
              w.confirmationOwnerUserId !== input.fromUserId ||
              w.version !== input.expectedVersion
            )
              fail('VERSION_CONFLICT');
          }
          await check(
            tx,
            policies.handover,
            {
              confirmationOwnerUserId: input.toUserId,
              status: w.status,
              statusChangedAt: now(),
              version: replay ? w.version : w.version + 1,
            },
            w.id,
          );
          return w;
        }
        return command(
          input,
          'handoverConfirmation',
          tx,
          async () => {
            const w = await checked();
            return (
              await runtime.fire('oa.workItem', w.id, 'handoverConfirmation', {
                actor: { id: input.actorId },
                expect: { version: w.version },
                input: {
                  confirmationOwnerUserId: input.toUserId,
                  fromUserId: input.fromUserId,
                  toUserId: input.toUserId,
                  reason: input.reason.trim(),
                  noticeVersion: w.version + 1,
                  handoverConfirmation: true,
                },
                transaction: tx,
              })
            ).record as unknown as WorkItem;
          },
          () => checked(true),
        );
      });
    },
    async departureBlockers(userId, tx) {
      const rows = await tx.repository<WorkItem>('workItems').findMany({
        filter: (f) =>
          f.and([
            f.string('status').ne('draft'),
            f.string('status').ne('completed'),
            f.string('status').ne('cancelled'),
            f.or([
              f.string('assigneeUserId').eq(userId),
              f.string('targetUserId').eq(userId),
              f.string('confirmationOwnerUserId').eq(userId),
            ]),
          ]),
        select: (s) =>
          s.fields(
            'id',
            'status',
            'assigneeUserId',
            'targetUserId',
            'confirmationOwnerUserId',
            'requiresConfirmation',
          ),
      });
      const items = [];
      for (const w of rows) {
        const reasons: ('assignee' | 'confirmationOwner')[] = [];
        if (w.assigneeUserId === userId || w.targetUserId === userId)
          reasons.push('assignee');
        if (w.confirmationOwnerUserId === userId && w.requiresConfirmation)
          reasons.push('confirmationOwner');
        if (reasons.length) items.push({ id: w.id, status: w.status, reasons });
      }
      return { items, remaining: items.length };
    },
    runtime,
    get,
    actions,
    async save(input, connection, p) {
      return connection.transaction(async (tx) => {
        await lockActors(tx, input.actorId, input.id, input.targetUserId);
        if (!(await active(input.actorId, tx))) fail('ACCESS_DENIED');
        return command(
          input,
          'save',
          tx,
          async () => {
            const old = input.id
              ? await get(input.id, input.actorId, tx, p)
              : undefined;
            if (input.id && (!old || old.creatorUserId !== input.actorId))
              fail('ACCESS_DENIED');
            if (
              old &&
              (old.status !== 'draft' || old.version !== input.expectedVersion)
            )
              fail('VERSION_CONFLICT');
            const dueAt = new Date(input.dueAt);
            if (
              !input.title.trim() ||
              input.title.length > 200 ||
              input.description.length > 100000
            )
              fail('INVALID_INPUT');
            if (!Number.isFinite(+dueAt) || dueAt <= now())
              throw new WorkItemError('INVALID_INPUT', 'dueAt');
            await target(input.targetUserId, input.dutyRoleCode, tx);
            const id = old?.id ?? randomUUID();
            await files(
              input.attachments,
              { id } as WorkItem,
              input.actorId,
              'input',
              tx,
            );
            const values = {
              title: input.title.trim(),
              description: input.description,
              targetUserId: input.targetUserId,
              dutyRoleCode: input.dutyRoleCode,
              dueAt,
              requiresConfirmation: input.requiresConfirmation,
              confirmationOwnerUserId: input.requiresConfirmation
                ? input.actorId
                : null,
              attachments: input.attachments,
            };
            if (old) {
              await check(
                tx,
                p,
                {
                  ...values,
                  status: 'draft',
                  statusChangedAt: now(),
                  version: old.version + 1,
                },
                id,
              );
              return (
                await runtime.fire('oa.workItem', id, 'edit', {
                  actor: { id: input.actorId },
                  expect: { version: old.version },
                  input: JSON.parse(JSON.stringify(values)) as JsonObject,
                  transaction: tx,
                })
              ).record as unknown as WorkItem;
            }
            const created = {
              id,
              creatorUserId: input.actorId,
              assigneeUserId: null,
              result: null,
              reason: null,
              forced: false,
              completedAt: null,
              resultAttachments: [],
              ...values,
            };
            await check(tx, p, {
              ...created,
              status: 'draft',
              version: 1,
              statusChangedAt: now(),
            });
            return (
              await runtime.create('oa.workItem', created, {
                actor: { id: input.actorId },
                transaction: tx,
              })
            ).record as unknown as WorkItem;
          },
          async (previous) => {
            const w = await get(previous.id, input.actorId, tx, p);
            if (!w || w.creatorUserId !== input.actorId) fail('ACCESS_DENIED');
            await check(
              tx,
              p,
              input.id
                ? {
                    title: input.title,
                    description: input.description,
                    targetUserId: input.targetUserId,
                    dutyRoleCode: input.dutyRoleCode,
                    dueAt: new Date(input.dueAt),
                    requiresConfirmation: input.requiresConfirmation,
                    confirmationOwnerUserId: input.requiresConfirmation
                      ? input.actorId
                      : null,
                    attachments: input.attachments,
                    version: w.version,
                    statusChangedAt: now(),
                  }
                : { ...w },
              input.id,
            );
            return w;
          },
        );
      });
    },
    async act(input, connection, p) {
      return connection.transaction(async (tx) => {
        await lockActors(tx, input.actorId, input.id, input.targetUserId);
        async function authorized(replay = false) {
          const w = await get(input.id, input.actorId, tx, p);
          if (!w) fail('ACCESS_DENIED');
          const possible = await actions(w, input.actorId, tx);
          if (!replay && !possible.includes(input.action))
            fail('ACCESS_DENIED');
          if (replay) {
            if (
              (input.action === 'dispatch' &&
                w.creatorUserId !== input.actorId) ||
              (['confirm', 'return'].includes(input.action) &&
                w.confirmationOwnerUserId !== input.actorId)
            )
              fail('ACCESS_DENIED');
            if (
              ['claim', 'release', 'complete', 'block'].includes(
                input.action,
              ) &&
              !(await candidate(w, input.actorId, tx))
            )
              fail('ACCESS_DENIED');
            if (
              input.action === 'forceComplete' &&
              !(await admin(input.actorId, tx))
            )
              fail('ACCESS_DENIED');
            if (
              ['cancel', 'reassign', 'resume'].includes(input.action) &&
              w.creatorUserId !== input.actorId &&
              !(await admin(input.actorId, tx))
            )
              fail('ACCESS_DENIED');
          }
          return w;
        }
        return command(
          input,
          input.action,
          tx,
          async () => {
            const w = await authorized();
            if (w.version !== input.expectedVersion) fail('VERSION_CONFLICT');
            const patch: Record<string, unknown> = {};
            if (
              [
                'cancel',
                'forceComplete',
                'return',
                'block',
                'resume',
                'reassign',
              ].includes(input.action)
            ) {
              if (!input.reason?.trim() || input.reason.length > 2000)
                fail('REASON_REQUIRED');
              patch.reason = input.reason.trim();
            }
            if (input.action === 'dispatch') {
              await target(w.targetUserId, w.dutyRoleCode, tx);
              await files(w.attachments, w, w.creatorUserId, 'input', tx);
              patch.assigneeUserId = w.dutyRoleCode ? null : w.targetUserId;
            }
            if (input.action === 'claim') patch.assigneeUserId = input.actorId;
            if (input.action === 'release') patch.assigneeUserId = null;
            if (
              input.action === 'complete' ||
              input.action === 'forceComplete'
            ) {
              if (input.action === 'complete' && !input.result?.trim())
                fail('RESULT_REQUIRED');
              if ((input.result?.length ?? 0) > 100000) fail('INVALID_INPUT');
              await files(
                input.resultAttachments ?? [],
                w,
                input.actorId,
                'result',
                tx,
              );
              patch.result = input.result?.trim() ?? null;
              patch.resultAttachments = input.resultAttachments ?? [];
              if (input.action === 'forceComplete') {
                patch.forced = true;
                patch.completedAt = now();
              } else patch.completedAt = w.requiresConfirmation ? null : now();
            }
            if (input.action === 'confirm') patch.completedAt = now();
            if (input.action === 'return') {
              patch.result = null;
              patch.resultAttachments = [];
            }
            if (input.action === 'reassign') {
              const targetUserId = input.targetUserId ?? null,
                dutyRoleCode = input.dutyRoleCode ?? null;
              await target(targetUserId, dutyRoleCode, tx);
              Object.assign(patch, {
                targetUserId,
                dutyRoleCode,
                assigneeUserId: dutyRoleCode ? null : targetUserId,
                result: null,
                resultAttachments: [],
              });
            }
            if (input.action === 'resume') {
              if (
                !w.assigneeUserId ||
                !(await candidate(w, w.assigneeUserId, tx))
              )
                fail('INVALID_TARGET');
            }
            const next =
              input.action === 'dispatch' || input.action === 'reassign'
                ? (
                    input.action === 'reassign'
                      ? patch.dutyRoleCode
                      : w.dutyRoleCode
                  )
                  ? 'open'
                  : 'assigned'
                : input.action === 'claim'
                  ? 'claimed'
                  : input.action === 'release'
                    ? 'open'
                    : input.action === 'complete'
                      ? w.requiresConfirmation
                        ? 'awaitingConfirmation'
                        : 'completed'
                      : input.action === 'confirm' ||
                          input.action === 'forceComplete'
                        ? 'completed'
                        : input.action === 'cancel'
                          ? 'cancelled'
                          : input.action === 'block'
                            ? 'blocked'
                            : w.dutyRoleCode
                              ? 'claimed'
                              : 'assigned';
            await check(
              tx,
              p,
              {
                ...patch,
                status: next,
                version: w.version + 1,
                statusChangedAt: now(),
              },
              w.id,
            );
            return (
              await runtime.fire('oa.workItem', w.id, input.action, {
                actor: { id: input.actorId },
                expect: { version: w.version },
                input: JSON.parse(
                  JSON.stringify({ ...patch, noticeVersion: w.version + 1 }),
                ) as JsonObject,
                transaction: tx,
              })
            ).record as unknown as WorkItem;
          },
          async () => {
            const w = await authorized(true);
            await check(
              tx,
              p,
              {
                ...replayMutation(w, input),
                status: w.status,
                version: w.version,
                statusChangedAt: now(),
              },
              w.id,
            );
            return w;
          },
        );
      });
    },
    async authorizeUpload(id, actorId, tx, p) {
      const item = await get(id, actorId, tx, p);
      if (!item) fail('ACCESS_DENIED');
      if (item.status === 'draft' && item.creatorUserId === actorId)
        return { item, purpose: 'input' };
      if (
        ['assigned', 'claimed', 'blocked'].includes(item.status) &&
        item.assigneeUserId === actorId &&
        (await candidate(item, actorId, tx))
      )
        return { item, purpose: 'result' };
      fail('ACCESS_DENIED');
    },
    async listForCenter(actorId, tx, policies) {
      const pending = await this.pending(actorId, tx, policies.view);
      const items = [];
      for (const summary of pending.items) {
        const w = await get(summary.sourceId, actorId, tx, policies.view);
        if (!w) continue;
        let allowed = false;
        for (const action of summary.actions) {
          const policy = policies.actions[action];
          if (!policy) continue;
          if (
            (
              await tx
                .repository('workItems')
                .withPolicy(policy)
                .validateMutation({
                  operation: 'updateOne',
                  filter: { id: w.id },
                  values: actionMutation(w, action, actorId),
                })
            ).valid
          ) {
            allowed = true;
            break;
          }
        }
        if (!allowed) continue;
        const row = await tx
          .repository('workItems')
          .withPolicy(policies.view)
          .findOne({ filter: { id: w.id } });
        if (!row) continue;
        items.push({
          id: w.id,
          initiatorId: w.creatorUserId,
          title: w.title,
          status: w.status,
          dueAt: new Date(w.dueAt).toISOString(),
          createdAt:
            row.createdAt instanceof Date || typeof row.createdAt === 'string'
              ? new Date(row.createdAt).toISOString()
              : null,
        });
      }
      return items;
    },
    async pending(actorId, tx, p) {
      const repo = tx.repository<WorkItem>('workItems'),
        rows = await (p ? repo.withPolicy(p) : repo).findMany({
          sort: (s) => s.field('dueAt').asc(),
        }),
        items = [];
      for (const row of rows) {
        const w = await readableRow(row, actorId, tx);
        if (!w) continue;
        const available = await actions(w, actorId, tx),
          relevant = available.filter((a) =>
            (w.status === 'blocked'
              ? ['resume', 'reassign']
              : ['claim', 'complete', 'confirm']
            ).includes(a),
          );
        if (relevant.length)
          items.push({
            kind: 'oa.workItem' as const,
            sourceId: w.id,
            title: w.title,
            dueAt: new Date(w.dueAt),
            overdue: new Date(w.dueAt) < now(),
            actions: relevant,
          });
      }
      return { items, count: items.length };
    },
  };
}
