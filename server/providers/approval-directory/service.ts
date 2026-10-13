import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { AuditService } from '../audit/index.js';
import type { Employee, EmployeeService } from '../employees/contract.js';
import type { OrgService } from '../org/contract.js';
import type {
  ApprovalDelegation,
  ApprovalDirectoryService,
  DelegationInput,
  DelegationScope,
  DelegationWriteContext,
  OaApprovalDirectory,
} from './contract.js';
import { DelegationError } from './errors.js';

const instant = (value: unknown): string =>
  new Date(String(value)).toISOString();
function row(value: Record<string, unknown>): ApprovalDelegation {
  return {
    id: String(value.id),
    principalId: String(value.principalId),
    delegateId: String(value.delegateId),
    scope: value.scope as DelegationScope,
    from: instant(value.from),
    to: instant(value.to),
    source: value.source as ApprovalDelegation['source'],
    sourceApplication:
      value.sourceApplication == null
        ? null
        : (value.sourceApplication as string),
    active: Boolean(value.active),
    createdAt: instant(value.createdAt),
    updatedAt: instant(value.updatedAt),
  };
}
function scopesIntersect(a: DelegationScope, b: DelegationScope): boolean {
  return a === 'all' || b === 'all' || a.some((kind) => b.includes(kind));
}
export interface DirectoryDependencies {
  database: DatabaseManager;
  employees: EmployeeService;
  org: OrgService;
  users: UserAdministrationService;
  audit: AuditService;
  generateId: () => string;
  authorization?: AppAuthorization;
}
export function createApprovalDirectoryService({
  database,
  employees,
  org,
  users,
  audit,
  generateId,
  authorization,
}: DirectoryDependencies): ApprovalDirectoryService {
  const readSnapshots = new AsyncLocalStorage<{
    value?: Promise<OaApprovalDirectory>;
  }>();
  function snapshot(
    connection?: DatabaseConnection,
  ): Promise<OaApprovalDirectory> {
    const scope = readSnapshots.getStore();
    if (connection || !scope) return buildSnapshot(connection);
    return (scope.value ??= buildSnapshot());
  }
  const connectionOf = (connection?: DatabaseConnection) =>
    connection ?? database.connection();
  async function eligibility(
    userIds: readonly string[],
    roleCodes: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Pick<OaApprovalDirectory, 'isActive' | 'hasRole'>> {
    // Authorization may already have needed the complete directory in this GET.
    // Reuse that request-local read rather than querying the same people again.
    const existing = !connection && readSnapshots.getStore()?.value;
    if (existing) {
      const directory = await existing;
      const requested = new Set(
        roleCodes.filter((role) => role !== 'approval.admin'),
      );
      const selected = new Set(userIds);
      return {
        isActive: (id) => selected.has(id) && directory.isActive(id),
        hasRole: (id, role) =>
          selected.has(id) &&
          requested.has(role) &&
          directory.hasRole(id, role),
      };
    }
    const tx = connectionOf(connection);
    const ids = [...new Set(userIds)];
    const active = new Set<string>();
    if (!ids.length) return { isActive: () => false, hasRole: () => false };
    const entries = [
      ...(await employees.getByUserIds(ids, tx)).values(),
    ].filter((employee) => employee.active && employee.status !== 'left');
    for (let offset = 0; offset < entries.length; offset += 100) {
      const page = await users.withConnection(tx).list({
        userIds: entries
          .slice(offset, offset + 100)
          .map((entry) => entry.userId),
        page: 1,
        pageSize: 100,
        kind: 'person',
        status: 'enabled',
      });
      for (const user of page.items) active.add(user.id);
    }
    const members = await org.dutyRoleMembersByCodes(
      roleCodes.filter((code) => code !== 'approval.admin'),
      tx,
    );
    return {
      isActive: (id) => active.has(id),
      hasRole: (id, role) =>
        active.has(id) && (members.get(role)?.includes(id) ?? false),
    };
  }
  async function enabledEmployees(
    connection: DatabaseConnection,
  ): Promise<Employee[]> {
    const entries = (await connection
      .repository('employees')
      .findMany({ filter: { active: true } })) as unknown as Employee[];
    const enabled = new Set<string>();
    for (let offset = 0; offset < entries.length; offset += 100) {
      const page = await users.withConnection(connection).list({
        userIds: entries
          .slice(offset, offset + 100)
          .map((entry) => entry.userId),
        page: 1,
        pageSize: 100,
        kind: 'person',
        status: 'enabled',
      });
      for (const user of page.items) enabled.add(user.id);
    }
    return entries.filter(
      (entry) => entry.status !== 'left' && enabled.has(entry.userId),
    );
  }
  async function list(
    connection?: DatabaseConnection,
  ): Promise<ApprovalDelegation[]> {
    const entries = await connectionOf(connection)
      .repository('approvalDelegations')
      .findMany({ sort: (sort) => sort.field('id').desc() });
    return entries.map((entry) => row(entry));
  }
  async function buildSnapshot(
    connection?: DatabaseConnection,
  ): Promise<OaApprovalDirectory> {
    const tx = connectionOf(connection);
    const people = await enabledEmployees(tx);
    const active = new Set(people.map((person) => person.userId));
    const managers = new Map<string, string>();
    const heads = new Map<string, string>();
    const executives = new Map<string, string>();
    const roles = new Map<string, readonly string[]>();
    const departments = await org.primaryDepartmentsOf([...active], tx);
    // Many employees share a primary department. Resolve its chain once per
    // fresh snapshot, retaining the caller connection and avoiding a persistent cache.
    const chains = new Map<string, ReturnType<OrgService['activeChain']>>();
    const managerChains = await employees.managerChainsOf([...active], tx);
    for (const person of people) {
      const manager = (managerChains.get(person.userId) ?? []).find(
        (entry) => active.has(entry.userId) && entry.userId !== person.userId,
      );
      if (manager) managers.set(person.userId, manager.userId);
      const department = departments.get(person.userId);
      if (!department) continue;
      let pendingChain = chains.get(department.id);
      if (!pendingChain) {
        pendingChain = org.activeChain(department.id, tx);
        chains.set(department.id, pendingChain);
      }
      const chain = await pendingChain;
      const head = chain?.find(
        (entry) => entry.managerId && active.has(entry.managerId),
      );
      if (head?.managerId) heads.set(person.userId, head.managerId);
      const executive = chain?.find(
        (entry) => entry.executiveId && active.has(entry.executiveId),
      );
      if (executive?.executiveId)
        executives.set(person.userId, executive.executiveId);
    }
    const roleRows = await tx
      .repository('dutyRoles')
      .findMany({ filter: { active: true } });
    const membersByRole = await org.dutyRoleMembersByCodes(
      roleRows.map((role) => role.code as string),
      tx,
    );
    for (const role of roleRows) {
      const code = role.code as string;
      roles.set(code, [
        ...new Set(
          (membersByRole.get(code) ?? []).filter((id) => active.has(id)),
        ),
      ]);
    }
    const delegations = await list(tx);
    // Root is a protected unrestricted assignment, not the organisation's `admin` duty role.
    // Keep root out of ordinary approver pools when it has no employee archive.
    const administrators = new Set<string>();
    if (authorization) {
      const permissionSets = authorization.permissionSets.withTransaction(tx);
      for (const assignment of await permissionSets.listAssignments()) {
        if (
          assignment.subject.type !== 'user' ||
          !permissionSets.protection(assignment.permissionSet)?.unrestricted
        )
          continue;
        const user = await users.withConnection(tx).get(assignment.subject.id);
        if (user && !user.disabledAt && user.kind === 'person')
          administrators.add(user.id);
      }
    }
    return {
      isActive: (person) => active.has(person),
      managerOf: (person) => managers.get(person),
      headOf: (person) => heads.get(person),
      executiveOf: (person) => executives.get(person),
      hasRole: (person, role) =>
        role === 'approval.admin'
          ? administrators.has(person)
          : (roles.get(role)?.includes(person) ?? false),
      roleMembers: (role) =>
        role === 'approval.admin'
          ? [...administrators]
          : (roles.get(role) ?? []),
      uniqueRoleMember: (role) =>
        roles.get(role)?.length === 1 ? roles.get(role)?.[0] : undefined,
      searchPeople: ({ search, offset, limit }) =>
        people
          .filter(
            (person) =>
              !search ||
              person.name
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()) ||
              person.code
                .toLocaleLowerCase()
                .includes(search.toLocaleLowerCase()),
          )
          .map((person) => person.userId)
          .slice(offset, offset + limit),
      // Existing tasks may be answered during the delegation interval, regardless of assignment time.
      // Resolve exactly one hop: B's delegation never alters A -> B. Ambiguous concurrent entries fail closed.
      delegateOf(principal, kind, at) {
        if (!active.has(principal) || !Number.isFinite(Date.parse(at)))
          return undefined;
        const matches = delegations.filter(
          (entry) =>
            entry.active &&
            entry.principalId === principal &&
            active.has(entry.delegateId) &&
            entry.delegateId !== principal &&
            (entry.scope === 'all' || entry.scope.includes(kind)) &&
            Date.parse(entry.from) <= Date.parse(at) &&
            Date.parse(at) < Date.parse(entry.to),
        );
        return matches.length === 1
          ? { to: matches[0].delegateId, mode: 'proxy' }
          : undefined;
      },
    };
  }
  async function validate(
    input: DelegationInput,
    tx: DatabaseConnection,
    exceptId?: string,
  ): Promise<void> {
    if (
      !input.principalId ||
      !input.delegateId ||
      input.principalId === input.delegateId ||
      !Number.isFinite(Date.parse(input.from)) ||
      !Number.isFinite(Date.parse(input.to)) ||
      Date.parse(input.from) >= Date.parse(input.to) ||
      (input.scope !== 'all' &&
        (!Array.isArray(input.scope) ||
          !input.scope.length ||
          input.scope.some((kind) => typeof kind !== 'string' || !kind.trim())))
    )
      throw new DelegationError(
        'INVALID_DELEGATION',
        'A delegation requires different active employees, a nonempty scope and a valid increasing interval.',
      );
    const people = await enabledEmployees(tx);
    if (
      ![input.principalId, input.delegateId].every((id) =>
        people.some((person) => person.userId === id),
      )
    )
      throw new DelegationError(
        'INVALID_DELEGATION',
        'Both people must be active employees with enabled accounts.',
      );
    const overlap = (await list(tx)).some(
      (entry) =>
        entry.id !== exceptId &&
        entry.active &&
        entry.principalId === input.principalId &&
        scopesIntersect(entry.scope, input.scope) &&
        Date.parse(entry.from) < Date.parse(input.to) &&
        Date.parse(input.from) < Date.parse(entry.to),
    );
    if (overlap)
      throw new DelegationError(
        'DELEGATION_OVERLAP',
        'An active delegation already covers this scope and interval.',
      );
  }
  async function write(
    input: DelegationInput,
    context: DelegationWriteContext,
    source: 'manual' | 'leave',
    sourceApplication: string | null,
    id?: string,
  ): Promise<ApprovalDelegation> {
    const run = async (tx: DatabaseConnection) => {
      const repository = tx.repository('approvalDelegations');
      const before = id
        ? (await list(tx)).find((entry) => entry.id === id)
        : undefined;
      if (id && !before)
        throw new DelegationError(
          'DELEGATION_NOT_FOUND',
          'The delegation does not exist.',
        );
      if (before && before.source !== 'manual')
        throw new DelegationError(
          'DELEGATION_SOURCE_PROTECTED',
          'Leave delegations are controlled by their leave application.',
        );
      if (sourceApplication) {
        const previous = (await list(tx)).find(
          (entry) => entry.sourceApplication === sourceApplication,
        );
        if (previous) {
          if (
            previous.principalId === input.principalId &&
            previous.delegateId === input.delegateId &&
            previous.from === instant(input.from) &&
            previous.to === instant(input.to) &&
            JSON.stringify(previous.scope) === JSON.stringify(input.scope)
          )
            return previous;
          throw new DelegationError(
            'DELEGATION_SOURCE_PROTECTED',
            'This leave application already owns a delegation.',
          );
        }
      }
      // Public authentication lock serializes overlapping delegation writes for this principal.
      for (const principal of [
        ...new Set([
          input.principalId,
          ...(before ? [before.principalId] : []),
        ]),
      ].sort())
        await lockUserForAdministration(tx, principal);
      await validate(input, tx, id);
      const now = new Date();
      const values = {
        ...input,
        from: new Date(input.from),
        to: new Date(input.to),
        scope: input.scope === 'all' ? 'all' : [...new Set(input.scope)],
        updatedAt: now,
      };
      const targetId = id ?? generateId();
      if (id)
        await repository.updateOne({
          filter: { id, source: 'manual' },
          values,
        });
      else
        await repository.createOne({
          values: {
            ...values,
            id: targetId,
            source,
            sourceApplication,
            active: true,
            createdAt: now,
          },
        });
      const after = (await list(tx)).find((entry) => entry.id === targetId)!;
      await audit.record(
        {
          actorId: context.actorId,
          action: id
            ? 'approvalDelegation.update'
            : 'approvalDelegation.create',
          targetType: 'approvalDelegations',
          targetId: after.id,
          before: before ?? null,
          after,
        },
        tx,
      );
      return after;
    };
    return context.connection
      ? run(context.connection)
      : database.transaction(run);
  }
  async function disable(
    id: string,
    context: DelegationWriteContext,
    manual: boolean,
  ): Promise<ApprovalDelegation> {
    const run = async (tx: DatabaseConnection) => {
      const before = (await list(tx)).find((entry) => entry.id === id);
      if (!before)
        throw new DelegationError(
          'DELEGATION_NOT_FOUND',
          'The delegation does not exist.',
        );
      if (manual && before.source !== 'manual')
        throw new DelegationError(
          'DELEGATION_SOURCE_PROTECTED',
          'Leave delegations are controlled by their leave application.',
        );
      if (!before.active) return before;
      await tx.repository('approvalDelegations').updateOne({
        filter: { id },
        values: { active: false, updatedAt: new Date() },
      });
      const after = (await list(tx)).find((entry) => entry.id === id)!;
      await audit.record(
        {
          actorId: context.actorId,
          action: 'approvalDelegation.disable',
          targetType: 'approvalDelegations',
          targetId: id,
          before,
          after,
        },
        tx,
      );
      return after;
    };
    return context.connection
      ? run(context.connection)
      : database.transaction(run);
  }
  return {
    eligibility,
    snapshot,
    withReadSnapshot: (read) => readSnapshots.run({}, read),
    list,
    createManualDelegation: (input, context) =>
      write(input, context, 'manual', null),
    updateManualDelegation: (id, input, context) =>
      write(input, context, 'manual', null, id),
    disableManualDelegation: (id, context) => disable(id, context, true),
    createLeaveDelegation: (input, context) => {
      const { sourceApplication, ...values } = input;
      return write(values, context, 'leave', sourceApplication);
    },
    disableLeaveDelegations: async (sourceApplication, context) => {
      for (const entry of await list(context.connection))
        if (
          entry.source === 'leave' &&
          entry.sourceApplication === sourceApplication &&
          entry.active
        )
          await disable(entry.id, context, false);
    },
  };
}
