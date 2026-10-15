import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import { requestConnectionRead } from '../request-performance/business-reads.js';
import type { AuthorizationTitle } from '@nocobase/authorization/core';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { AuditEntry, AuditService } from '../audit/index.js';
import { label } from './constants.js';
import type { Department, Grade, OrgService, Position } from './contract.js';
import { OrgError } from './errors.js';
import { readTitle, sortText, titleMatches } from './titles.js';
import {
  activeChainOf,
  activeSubtrees,
  chainOf,
  compareNodes,
  headedIn,
  isEffectivelyActive,
  subtreeOf,
  walkUp,
  type Tree,
  type TreeNode,
} from './tree.js';

import type { HeadcountService } from '../headcounts/contract.js';

/** Who performs a write, and optionally the caller's transaction to run it in. */
export interface OrgWriteContext {
  readonly actorId: string | null;
  /** Run inside this transaction (as a savepoint) instead of a new one. */
  readonly connection?: DatabaseConnection;
  /** Recorded on the audit entry, such as the import that made the change. */
  readonly reason?: string | null;
}

export interface CreateDepartmentInput {
  readonly title: string;
  readonly code?: string | null;
  readonly parentId?: string | null;
  readonly managerId?: string | null;
  readonly executiveId?: string | null;
  readonly sortOrder?: number;
}

/** Only the fields named change; `null` clears a code, parent, head or executive. */
export interface UpdateDepartmentInput {
  readonly title?: string;
  readonly code?: string | null;
  readonly parentId?: string | null;
  readonly managerId?: string | null;
  readonly executiveId?: string | null;
  readonly sortOrder?: number;
}

export interface DirectMember {
  readonly userId: string;
  readonly primary: boolean;
}

export interface Membership {
  readonly departmentId: string;
  readonly primary: boolean;
}

/** One entry of a subject picker, the shape the authorization workspace reads. */
export interface SubjectOption {
  readonly id: string;
  readonly title: AuthorizationTitle;
  readonly description?: AuthorizationTitle;
}

export interface SubjectPageQuery {
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface PositionView extends Position {
  readonly sortOrder: number;
}

export interface CreatePositionInput {
  readonly code: string;
  readonly title: string;
  readonly sortOrder?: number;
}

export interface UpdatePositionInput {
  readonly code?: string;
  readonly title?: string;
  readonly sortOrder?: number;
}

export interface CreateGradeInput {
  readonly code: string;
  readonly title: string;
  readonly rank: number;
}

export interface UpdateGradeInput {
  readonly code?: string;
  readonly title?: string;
  readonly rank?: number;
}

/** A duty role as the organisation stores it; a seeded title is a translation descriptor. */
export interface DutyRoleView {
  readonly code: string;
  readonly title: AuthorizationTitle;
  readonly description: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

/**
 * The whole organisation service. It extends the cross-module contract (`OrgService`) with the administration the
 * settings pages use, the subject and scope reads authorization uses, and membership writes other modules may call
 * inside their own transaction (entry, transfer).
 *
 * Reads take an optional connection so they can run inside a caller's transaction. Every write runs in one
 * transaction (a savepoint when the caller passes its own), records an audit entry in it, and after the outermost
 * commit tells each user whose subjects changed to refresh their permission snapshot.
 */
export interface OrganizationService extends OrgService {
  // Departments
  listTree(connection?: DatabaseConnection): Promise<readonly Department[]>;
  getDepartment(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Department | undefined>;
  /** Active direct members per department id. */
  memberCounts(
    connection?: DatabaseConnection,
  ): Promise<ReadonlyMap<string, number>>;
  createDepartment(
    input: CreateDepartmentInput,
    context: OrgWriteContext,
  ): Promise<Department>;
  updateDepartment(
    id: string,
    input: UpdateDepartmentInput,
    context: OrgWriteContext,
  ): Promise<Department>;
  setDepartmentActive(
    id: string,
    active: boolean,
    context: OrgWriteContext,
  ): Promise<Department>;

  // Memberships
  /** Independent administrative membership write, preserving initialized headcount rosters.
   * Business-source writes use addMember/removeMember/setPrimary in their owner's capacity transaction.
   * A caller already taking capacity locks must acquire the target user administration lock first.
   */
  manageMember(
    input: { departmentId: string; userId: string } & (
      | { action: 'add'; primary?: boolean }
      | { action: 'remove' | 'makePrimary' }
    ),
    context: OrgWriteContext,
  ): Promise<void>;
  /** Active direct memberships of one department, primary first. */
  directMembers(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly DirectMember[]>;
  /** The user's active memberships, primary first. */
  membershipsOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly Membership[]>;
  /**
   * Adds the user, or re-activates an earlier membership. Without `primary`, the department becomes primary only when
   * the user has no other active primary one. A primary membership clears every other primary flag of the user.
   */
  addMember(
    input: { departmentId: string; userId: string; primary?: boolean },
    context: OrgWriteContext,
  ): Promise<void>;
  removeMember(
    departmentId: string,
    userId: string,
    context: OrgWriteContext,
  ): Promise<void>;
  setPrimary(
    departmentId: string,
    userId: string,
    context: OrgWriteContext,
  ): Promise<void>;

  // Subjects and scopes
  /** Active direct departments of the user's active memberships, plus their ancestors. */
  departmentsOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** The requested department ids whose whole chain is active. */
  filterActive(
    ids: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Effectively active departments the user heads. */
  headedBy(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /**
   * The departments a viewer-relative data scope starts from. `memberships` counts the viewer's active memberships,
   * `headed` the departments they head; `descendants` adds every active department below. Only departments whose
   * whole chain is active count.
   */
  viewerDepartments(
    userId: string,
    options: {
      readonly memberships: boolean;
      readonly headed: boolean;
      readonly descendants: boolean;
    },
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Users with an active direct membership in any of the departments. */
  membersOf(
    departmentIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  listDepartmentOptions(
    query: SubjectPageQuery,
  ): Promise<{ items: readonly SubjectOption[]; total: number }>;
  resolveDepartments(ids: readonly string[]): Promise<readonly SubjectOption[]>;

  // Positions and grades
  listPositions(
    connection?: DatabaseConnection,
  ): Promise<readonly PositionView[]>;
  createPosition(
    input: CreatePositionInput,
    context: OrgWriteContext,
  ): Promise<PositionView>;
  updatePosition(
    id: string,
    input: UpdatePositionInput,
    context: OrgWriteContext,
  ): Promise<PositionView>;
  setPositionActive(
    id: string,
    active: boolean,
    context: OrgWriteContext,
  ): Promise<PositionView>;
  createGrade(
    input: CreateGradeInput,
    context: OrgWriteContext,
  ): Promise<Grade>;
  updateGrade(
    id: string,
    input: UpdateGradeInput,
    context: OrgWriteContext,
  ): Promise<Grade>;
  setGradeActive(
    id: string,
    active: boolean,
    context: OrgWriteContext,
  ): Promise<Grade>;

  // Duty roles
  listDutyRoles(
    connection?: DatabaseConnection,
  ): Promise<readonly DutyRoleView[]>;
  getDutyRole(
    code: string,
    connection?: DatabaseConnection,
  ): Promise<DutyRoleView | undefined>;
  /** Active members per role code, whether or not the role is active. */
  dutyRoleMemberCounts(
    connection?: DatabaseConnection,
  ): Promise<ReadonlyMap<string, number>>;
  /** Active memberships of the role, whether or not the role itself is active (the settings page lists them). */
  listDutyRoleMembers(
    code: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Codes of the active roles the user is an active member of. */
  dutyRolesOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  filterActiveDutyRoles(
    codes: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  listDutyRoleOptions(
    query: SubjectPageQuery,
  ): Promise<{ items: readonly SubjectOption[]; total: number }>;
  resolveDutyRoles(codes: readonly string[]): Promise<readonly SubjectOption[]>;
  setDutyRoleActive(
    code: string,
    active: boolean,
    context: OrgWriteContext,
  ): Promise<DutyRoleView>;
  addDutyRoleMember(
    code: string,
    userId: string,
    context: OrgWriteContext,
  ): Promise<void>;
  removeDutyRoleMember(
    code: string,
    userId: string,
    context: OrgWriteContext,
  ): Promise<void>;
}

export const organizationServiceToken: ServiceToken<OrganizationService> =
  createServiceToken<OrganizationService>('oa/organization-service');

export interface OrganizationServiceDependencies {
  readonly database: DatabaseManager;
  readonly users: Pick<UserAdministrationService, 'get' | 'withConnection'>;
  readonly audit: AuditService;
  readonly generateId: () => string;
  /** Lazy resolution avoids the org -> headcounts -> employees -> org construction cycle. */
  readonly headcounts?: () =>
    Pick<HeadcountService, 'protectRoster'> | undefined;
  /** Tells signed-in clients of these users to refresh their permission snapshot. Called after commit. */
  readonly notifyUsers: (userIds: readonly string[]) => Promise<void>;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return value.toString();
  throw new TypeError('Expected a scalar column value.');
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function toNode(row: Record<string, unknown>): TreeNode {
  return {
    id: text(row.id),
    title: text(row.title),
    code: nullableText(row.code),
    parentId: nullableText(row.parentId),
    managerId: nullableText(row.managerId),
    executiveId: nullableText(row.executiveId),
    active: toBoolean(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

function toDepartment(node: TreeNode): Department {
  return { ...node };
}

function toPosition(row: Record<string, unknown>): PositionView {
  return {
    id: text(row.id),
    code: text(row.code),
    title: text(row.title),
    active: toBoolean(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

function toGrade(row: Record<string, unknown>): Grade {
  return {
    id: text(row.id),
    code: text(row.code),
    title: text(row.title),
    rank: Number(row.rank ?? 0),
    active: toBoolean(row.active),
  };
}

function toDutyRole(row: Record<string, unknown>): DutyRoleView {
  return {
    code: text(row.code),
    title: readTitle(row.title),
    description: nullableText(row.description),
    active: toBoolean(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

function normalizeTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 255)
    throw new OrgError(
      'INVALID_INPUT',
      'A title of 1 to 255 characters is required.',
      'title',
    );
  return title.trim();
}

function normalizeCode(code: unknown, required: boolean): string | null {
  if (code === null || code === undefined || code === '') {
    if (required)
      throw new OrgError('INVALID_INPUT', 'A code is required.', 'code');
    return null;
  }
  if (typeof code !== 'string' || !CODE.test(code.trim()))
    throw new OrgError(
      'INVALID_INPUT',
      'A code uses letters, digits, ".", "_" and "-", up to 64 characters.',
      'code',
    );
  return code.trim();
}

function normalizeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value))
    throw new OrgError('INVALID_INPUT', `\`${field}\` is an integer.`, field);
  return value;
}

function validatePage(query: SubjectPageQuery): void {
  if (
    !Number.isInteger(query.page) ||
    query.page < 1 ||
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 100
  )
    throw new OrgError('INVALID_INPUT', 'Invalid pagination.');
}

/** Only the keys whose value differs, for an audit snapshot. */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const keys = Object.keys(after).filter((key) => before[key] !== after[key]);
  return {
    before: Object.fromEntries(keys.map((key) => [key, before[key]])),
    after: Object.fromEntries(keys.map((key) => [key, after[key]])),
  };
}

function page<T>(
  items: readonly T[],
  query: SubjectPageQuery,
): { items: readonly T[]; total: number } {
  const offset = (query.page - 1) * query.pageSize;
  return {
    items: items.slice(offset, offset + query.pageSize),
    total: items.length,
  };
}

export function createOrganizationService(
  dependencies: OrganizationServiceDependencies,
): OrganizationService {
  const { database, users, audit, generateId, notifyUsers } = dependencies;

  const root = (connection?: DatabaseConnection): DatabaseConnection =>
    connection ?? database.connection();

  /**
   * Runs a write in one transaction, a savepoint of the caller's when it passes one. The users it returns are told to
   * refresh once the outermost transaction commits, and never after a rollback.
   */
  async function write<T>(
    context: OrgWriteContext,
    run: (
      connection: DatabaseConnection,
      record: (entry: Omit<AuditEntry, 'actorId' | 'reason'>) => Promise<void>,
    ) => Promise<{ result: T; changed?: readonly string[] }>,
  ): Promise<T> {
    return root(context.connection).transaction(async (connection) => {
      const { result, changed = [] } = await run(connection, (entry) =>
        audit.record(
          {
            ...entry,
            actorId: context.actorId,
            reason: context.reason ?? null,
          },
          connection,
        ),
      );
      const ids = [...new Set(changed)];
      if (ids.length) connection.afterCommit(() => notifyUsers(ids));
      return result;
    });
  }

  async function loadTree(connection?: DatabaseConnection): Promise<Tree> {
    return requestConnectionRead(
      root(),
      root(connection),
      'org.departmentTree',
      async () => {
        const rows = await root(connection)
          .query.selectFrom('departments')
          .select([
            'id',
            'title',
            'code',
            'parentId',
            'managerId',
            'executiveId',
            'active',
            'sortOrder',
          ])
          .execute();
        return new Map(
          rows.map((row) => {
            const node = toNode(row);
            return [node.id, node];
          }),
        );
      },
    );
  }

  async function activeMemberships(
    connection: DatabaseConnection,
    where: { userIds?: readonly string[]; departmentIds?: readonly string[] },
  ): Promise<{ departmentId: string; userId: string; primary: boolean }[]> {
    return requestConnectionRead(
      root(),
      connection,
      `org.memberships:${JSON.stringify([where.userIds ? [...where.userIds].sort() : null, where.departmentIds ? [...where.departmentIds].sort() : null])}`,
      async () => {
        if (where.departmentIds?.length === 0 || where.userIds?.length === 0)
          return [];
        let query = connection.query
          .selectFrom('departmentMembers')
          .select(['departmentId', 'userId', 'primary'])
          .where('active', '=', true);
        if (where.userIds)
          query = query.where('userId', 'in', [...where.userIds]);
        if (where.departmentIds)
          query = query.where('departmentId', 'in', [...where.departmentIds]);
        const rows = await query.execute();
        return rows.map((row) => ({
          departmentId: text(row.departmentId),
          userId: text(row.userId),
          primary: toBoolean(row.primary),
        }));
      },
    );
  }

  async function requireEnabledUser(
    userId: unknown,
    field: string,
    connection?: DatabaseConnection,
  ): Promise<string> {
    // Inside a caller's transaction the lookup must go through it: on SQLite the transaction holds the only
    // connection, so a lookup outside it would wait for that connection forever (the import runs every write in one).
    const directory = connection ? users.withConnection(connection) : users;
    const user =
      typeof userId === 'string' && userId
        ? await directory.get(userId)
        : undefined;
    if (!user || user.disabledAt)
      throw new OrgError(
        'USER_NOT_FOUND',
        `User "${String(userId)}" does not exist or is disabled.`,
        field,
      );
    return user.id;
  }

  function requireNode(tree: Tree, id: string): TreeNode {
    const node = tree.get(id);
    if (!node)
      throw new OrgError(
        'DEPARTMENT_NOT_FOUND',
        `Department "${id}" does not exist.`,
      );
    return node;
  }

  function validateParent(
    tree: Tree,
    id: string | undefined,
    parentId: string | null,
  ): void {
    if (parentId === null) return;
    if (!tree.has(parentId))
      throw new OrgError(
        'PARENT_NOT_FOUND',
        `Parent department "${parentId}" does not exist.`,
        'parentId',
      );
    if (id === undefined) return;
    // The new parent must not be the department itself or one of its descendants.
    const ancestors = chainOf(tree, parentId);
    if (!ancestors || ancestors.some((node) => node.id === id))
      throw new OrgError(
        'PARENT_CYCLE',
        'A department cannot be moved below itself.',
        'parentId',
      );
  }

  async function assertCodeFree(
    connection: DatabaseConnection,
    table: 'departments' | 'positions' | 'grades',
    code: string,
    exceptId: string | undefined,
  ): Promise<void> {
    const row = await connection.query
      .selectFrom(table)
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst();
    if (row && text(row.id) !== exceptId)
      throw new OrgError(
        table === 'departments'
          ? 'DEPARTMENT_CODE_EXISTS'
          : table === 'positions'
            ? 'POSITION_CODE_EXISTS'
            : 'GRADE_CODE_EXISTS',
        `The code "${code}" is already used.`,
        'code',
      );
  }

  async function subtreeMemberIds(
    connection: DatabaseConnection,
    tree: Tree,
    id: string,
  ): Promise<string[]> {
    const departmentIds = subtreeOf(tree, id).map((node) => node.id);
    const memberships = await activeMemberships(connection, { departmentIds });
    return [...new Set(memberships.map((row) => row.userId))];
  }

  function headsOf(nodes: readonly TreeNode[]): string[] {
    return nodes
      .map((node) => node.managerId)
      .filter((id): id is string => id !== null);
  }

  async function primaryMap(
    connection: DatabaseConnection,
    userIds: readonly string[],
  ): Promise<Map<string, Department>> {
    const result = new Map<string, Department>();
    const memberships = (
      await activeMemberships(connection, { userIds })
    ).filter((row) => row.primary);
    if (!memberships.length) return result;
    const tree = await loadTree(connection);
    for (const membership of memberships) {
      if (result.has(membership.userId)) continue;
      if (!isEffectivelyActive(tree, membership.departmentId)) continue;
      const node = tree.get(membership.departmentId);
      if (node) result.set(membership.userId, toDepartment(node));
    }
    return result;
  }

  function departmentOption(tree: Tree, node: TreeNode): SubjectOption {
    const parent = node.parentId === null ? undefined : tree.get(node.parentId);
    // A disabled marker the client translates; otherwise the parent names where the department sits.
    const description = !isEffectivelyActive(tree, node.id)
      ? label('subjects.disabled')
      : parent?.title;
    return {
      id: node.id,
      title: node.title,
      ...(description === undefined ? {} : { description }),
    };
  }

  async function loadDutyRole(
    connection: DatabaseConnection,
    code: string,
  ): Promise<DutyRoleView> {
    const row = await connection.query
      .selectFrom('dutyRoles')
      .selectAll()
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row)
      throw new OrgError(
        'DUTY_ROLE_NOT_FOUND',
        `Duty role "${code}" does not exist.`,
      );
    return toDutyRole(row);
  }

  async function activeDutyRoleCodes(
    connection: DatabaseConnection,
  ): Promise<Set<string>> {
    return requestConnectionRead(
      root(),
      connection,
      'org.activeDutyRoleCodes',
      async () => {
        const rows = await connection.query
          .selectFrom('dutyRoles')
          .select('code')
          .where('active', '=', true)
          .execute();
        return new Set(rows.map((row) => text(row.code)));
      },
    );
  }

  async function activeDutyRoleMembers(
    connection: DatabaseConnection,
    code: string,
  ): Promise<string[]> {
    return requestConnectionRead(
      root(),
      connection,
      `org.dutyMembers:${JSON.stringify(code)}`,
      async () => {
        const rows = await connection.query
          .selectFrom('dutyRoleMembers')
          .select('userId')
          .where('dutyRoleCode', '=', code)
          .where('active', '=', true)
          .execute();
        return rows.map((row) => text(row.userId)).sort();
      },
    );
  }

  function dutyRoleOption(role: DutyRoleView): SubjectOption {
    return {
      id: role.code,
      title: role.title,
      ...(role.active ? {} : { description: label('subjects.disabled') }),
    };
  }

  function compareDutyRoles(left: DutyRoleView, right: DutyRoleView): number {
    return (
      left.sortOrder - right.sortOrder ||
      sortText(left.title).localeCompare(sortText(right.title)) ||
      left.code.localeCompare(right.code)
    );
  }

  async function loadRow(
    connection: DatabaseConnection,
    table: 'positions' | 'grades',
    id: string,
  ): Promise<Record<string, unknown>> {
    const row = await connection.query
      .selectFrom(table)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row)
      throw new OrgError(
        table === 'positions' ? 'POSITION_NOT_FOUND' : 'GRADE_NOT_FOUND',
        `${table === 'positions' ? 'Position' : 'Grade'} "${id}" does not exist.`,
      );
    return row;
  }

  const service: OrganizationService = {
    // ---- Contract -------------------------------------------------------------------------------------------------

    async primaryDepartmentOf(userId, connection) {
      return (await primaryMap(root(connection), [userId])).get(userId);
    },

    async primaryDepartmentsOf(userIds, connection) {
      return primaryMap(root(connection), userIds);
    },

    async activeChain(departmentId, connection) {
      return activeChainOf(await loadTree(connection), departmentId)?.map(
        toDepartment,
      );
    },
    async activeChainsOf(departmentIds, connection) {
      const tree = await loadTree(connection);
      return new Map(
        [...new Set(departmentIds)].map((id) => [
          id,
          activeChainOf(tree, id)?.map(toDepartment),
        ]),
      );
    },

    async subtreeIds(departmentId, connection) {
      const tree = await loadTree(connection);
      if (!tree.has(departmentId)) return [];
      const below = subtreeOf(tree, departmentId)
        .filter(
          (node) =>
            node.id !== departmentId && isEffectivelyActive(tree, node.id),
        )
        .map((node) => node.id);
      return [departmentId, ...below];
    },

    async headOf(departmentId, connection) {
      return walkUp(
        await loadTree(connection),
        departmentId,
        (node) => node.managerId,
      );
    },

    async executiveOf(departmentId, connection) {
      return walkUp(
        await loadTree(connection),
        departmentId,
        (node) => node.executiveId,
      );
    },

    async dutyRoleMembers(code, connection) {
      const target = root(connection);
      if (!(await activeDutyRoleCodes(target)).has(code)) return [];
      return activeDutyRoleMembers(target, code);
    },

    async dutyRoleMembersByCodes(codes, connection) {
      if (!codes.length) return new Map();
      const target = root(connection);
      const active = await activeDutyRoleCodes(target);
      const selected = [...new Set(codes)].filter((code) => active.has(code));
      const result = new Map<string, string[]>(codes.map((code) => [code, []]));
      if (!selected.length) return result;
      const rows = await target.query
        .selectFrom('dutyRoleMembers')
        .select(['dutyRoleCode', 'userId'])
        .where('dutyRoleCode', 'in', selected)
        .where('active', '=', true)
        .execute();
      for (const row of rows)
        result.get(text(row.dutyRoleCode))?.push(text(row.userId));
      for (const members of result.values()) members.sort();
      return result;
    },

    async hasDutyRole(userId, code, connection) {
      return (await service.dutyRolesOf(userId, connection)).includes(code);
    },

    async listPositions(connection) {
      return requestConnectionRead(
        root(),
        root(connection),
        'org.positions',
        async () => {
          const rows = await root(connection)
            .query.selectFrom('positions')
            .selectAll()
            .execute();
          return rows
            .map(toPosition)
            .sort(
              (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.title.localeCompare(right.title) ||
                left.id.localeCompare(right.id),
            );
        },
      );
    },

    async listGrades(connection) {
      const rows = await root(connection)
        .query.selectFrom('grades')
        .selectAll()
        .execute();
      return rows
        .map(toGrade)
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.code.localeCompare(right.code) ||
            left.id.localeCompare(right.id),
        );
    },

    // ---- Departments ----------------------------------------------------------------------------------------------

    async listTree(connection) {
      return [...(await loadTree(connection)).values()]
        .sort(compareNodes)
        .map(toDepartment);
    },

    async getDepartment(id, connection) {
      const node = (await loadTree(connection)).get(id);
      return node ? toDepartment(node) : undefined;
    },

    async memberCounts(connection) {
      const counts = new Map<string, number>();
      for (const row of await activeMemberships(root(connection), {}))
        counts.set(row.departmentId, (counts.get(row.departmentId) ?? 0) + 1);
      return counts;
    },

    async createDepartment(input, context) {
      const title = normalizeTitle(input.title);
      const code = normalizeCode(input.code, false);
      const parentId = input.parentId ?? null;
      const sortOrder =
        input.sortOrder === undefined
          ? 0
          : normalizeInteger(input.sortOrder, 'sortOrder');
      const managerId =
        input.managerId == null
          ? null
          : await requireEnabledUser(
              input.managerId,
              'managerId',
              context.connection,
            );
      const executiveId =
        input.executiveId == null
          ? null
          : await requireEnabledUser(
              input.executiveId,
              'executiveId',
              context.connection,
            );
      return write(context, async (connection, record) => {
        const tree = await loadTree(connection);
        validateParent(tree, undefined, parentId);
        if (parentId !== null && executiveId !== null)
          throw new OrgError(
            'EXECUTIVE_TOP_LEVEL_ONLY',
            'Only top-level departments may appoint an executive.',
            'executiveId',
          );
        if (code !== null)
          await assertCodeFree(connection, 'departments', code, undefined);
        const node: TreeNode = {
          id: generateId(),
          title,
          code,
          parentId,
          managerId,
          executiveId,
          active: true,
          sortOrder,
        };
        await connection.query
          .insertInto('departments')
          .values({ ...node })
          .execute();
        await record({
          action: 'department.create',
          targetType: 'departments',
          targetId: node.id,
          after: node,
        });
        // An appointed head gains the head subject and the department's scope.
        return {
          result: toDepartment(node),
          changed: managerId ? [managerId] : [],
        };
      });
    },

    async updateDepartment(id, input, context) {
      const values: Partial<Record<keyof TreeNode, unknown>> = {};
      if (input.title !== undefined) values.title = normalizeTitle(input.title);
      if (input.code !== undefined)
        values.code = normalizeCode(input.code, false);
      if (input.sortOrder !== undefined)
        values.sortOrder = normalizeInteger(input.sortOrder, 'sortOrder');
      if (input.managerId !== undefined)
        values.managerId =
          input.managerId === null
            ? null
            : await requireEnabledUser(
                input.managerId,
                'managerId',
                context.connection,
              );
      if (input.executiveId !== undefined)
        values.executiveId =
          input.executiveId === null
            ? null
            : await requireEnabledUser(
                input.executiveId,
                'executiveId',
                context.connection,
              );
      if (input.parentId !== undefined) values.parentId = input.parentId;
      return write(context, async (connection, record) => {
        const tree = await loadTree(connection);
        const current = requireNode(tree, id);
        const changed: string[] = [];
        if ('parentId' in values && values.parentId !== current.parentId) {
          validateParent(tree, id, input.parentId ?? null);
          // A move changes what the subtree inherits, and which departments heads above it reach.
          changed.push(...(await subtreeMemberIds(connection, tree, id)));
          changed.push(
            ...headsOf(subtreeOf(tree, id)),
            ...headsOf(
              current.parentId === null
                ? []
                : (chainOf(tree, current.parentId) ?? []),
            ),
            ...headsOf(
              input.parentId == null
                ? []
                : (chainOf(tree, input.parentId) ?? []),
            ),
          );
        } else {
          delete values.parentId;
        }
        const nextParent =
          input.parentId === undefined ? current.parentId : input.parentId;
        const nextExecutive =
          input.executiveId === undefined
            ? current.executiveId
            : input.executiveId;
        if (nextParent !== null && nextExecutive !== null)
          throw new OrgError(
            'EXECUTIVE_TOP_LEVEL_ONLY',
            'Clear the executive before moving a department below another department.',
            'executiveId',
          );
        if (typeof values.code === 'string')
          await assertCodeFree(connection, 'departments', values.code, id);
        // A new head gains the department's scope and the previous one loses it.
        if ('managerId' in values && values.managerId !== current.managerId) {
          if (current.managerId) changed.push(current.managerId);
          if (typeof values.managerId === 'string')
            changed.push(values.managerId);
        }
        const snapshot = diff(
          current as unknown as Record<string, unknown>,
          values,
        );
        if (Object.keys(snapshot.after).length) {
          await connection.query
            .updateTable('departments')
            .set(snapshot.after)
            .where('id', '=', id)
            .execute();
          await record({
            action:
              'parentId' in snapshot.after
                ? 'department.move'
                : 'department.update',
            targetType: 'departments',
            targetId: id,
            ...snapshot,
          });
        }
        const updated = requireNode(await loadTree(connection), id);
        return { result: toDepartment(updated), changed };
      });
    },

    async setDepartmentActive(id, active, context) {
      if (typeof active !== 'boolean')
        throw new OrgError('INVALID_INPUT', '`active` is a boolean.', 'active');
      return write(context, async (connection, record) => {
        const tree = await loadTree(connection);
        const current = requireNode(tree, id);
        if (current.active === active) return { result: toDepartment(current) };
        await connection.query
          .updateTable('departments')
          .set({ active })
          .where('id', '=', id)
          .execute();
        await record({
          action: active ? 'department.enable' : 'department.disable',
          targetType: 'departments',
          targetId: id,
          before: { active: current.active },
          after: { active },
        });
        // Disabling is a check on the ancestor chain, not a cascade: every member and head of the subtree is affected.
        const changed = [
          ...(await subtreeMemberIds(connection, tree, id)),
          ...headsOf(subtreeOf(tree, id)),
        ];
        return { result: toDepartment({ ...current, active }), changed };
      });
    },

    // ---- Memberships ----------------------------------------------------------------------------------------------

    async directMembers(departmentId, connection) {
      const target = root(connection);
      requireNode(await loadTree(target), departmentId);
      const rows = await activeMemberships(target, {
        departmentIds: [departmentId],
      });
      return rows
        .map((row) => ({ userId: row.userId, primary: row.primary }))
        .sort(
          (left, right) =>
            Number(right.primary) - Number(left.primary) ||
            left.userId.localeCompare(right.userId),
        );
    },

    async membershipsOf(userId, connection) {
      const rows = await activeMemberships(root(connection), {
        userIds: [userId],
      });
      return rows
        .map((row) => ({
          departmentId: row.departmentId,
          primary: row.primary,
        }))
        .sort(
          (left, right) =>
            Number(right.primary) - Number(left.primary) ||
            left.departmentId.localeCompare(right.departmentId),
        );
    },

    async manageMember(input, context) {
      await root(context.connection).transaction(async (connection) => {
        // Departure holds this public account lock before memberships and capacity release.
        // Taking it first prevents guard -> member versus member -> guard inversion for this user.
        // The public lock is a no-op for an absent row and also locks disabled accounts;
        // preserve each underlying membership operation's existing validation semantics.
        await lockUserForAdministration(connection, input.userId);
        const run = async (tx: DatabaseConnection) => {
          const caller = { ...context, connection: tx };
          if (input.action === 'add')
            await service.addMember(
              {
                departmentId: input.departmentId,
                userId: input.userId,
                ...(input.primary === undefined
                  ? {}
                  : { primary: input.primary }),
              },
              caller,
            );
          else if (input.action === 'remove')
            await service.removeMember(
              input.departmentId,
              input.userId,
              caller,
            );
          else
            await service.setPrimary(input.departmentId, input.userId, caller);
        };
        const capacity = dependencies.headcounts?.();
        if (capacity)
          await capacity.protectRoster([input.userId], connection, run);
        else await run(connection);
      });
    },

    async addMember(input, context) {
      const userId = await requireEnabledUser(
        input.userId,
        'userId',
        context.connection,
      );
      await write(context, async (connection, record) => {
        requireNode(await loadTree(connection), input.departmentId);
        const existing = await connection.query
          .selectFrom('departmentMembers')
          .select(['id', 'active', 'primary'])
          .where('departmentId', '=', input.departmentId)
          .where('userId', '=', userId)
          .executeTakeFirst();
        const others = await activeMemberships(connection, {
          userIds: [userId],
        });
        const hasOtherPrimary = others.some(
          (row) => row.primary && row.departmentId !== input.departmentId,
        );
        const primary = input.primary ?? !hasOtherPrimary;
        if (
          existing &&
          toBoolean(existing.active) &&
          toBoolean(existing.primary) === primary
        )
          return { result: undefined };
        // At most one active primary membership per user.
        if (primary)
          await connection.query
            .updateTable('departmentMembers')
            .set({ primary: false })
            .where('userId', '=', userId)
            .where('primary', '=', true)
            .execute();
        if (existing)
          await connection.query
            .updateTable('departmentMembers')
            .set({ active: true, primary })
            .where('id', '=', text(existing.id))
            .execute();
        else
          await connection.query
            .insertInto('departmentMembers')
            .values({
              id: generateId(),
              departmentId: input.departmentId,
              userId,
              primary,
              active: true,
            })
            .execute();
        await record({
          action: 'departmentMember.add',
          targetType: 'departmentMembers',
          targetId: `${input.departmentId}:${userId}`,
          before: existing
            ? {
                active: toBoolean(existing.active),
                primary: toBoolean(existing.primary),
              }
            : null,
          after: { departmentId: input.departmentId, userId, primary },
        });
        return { result: undefined, changed: [userId] };
      });
    },

    async removeMember(departmentId, userId, context) {
      await write(context, async (connection, record) => {
        requireNode(await loadTree(connection), departmentId);
        const membership = await connection.query
          .selectFrom('departmentMembers')
          .select(['id', 'primary'])
          .where('departmentId', '=', departmentId)
          .where('userId', '=', userId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!membership)
          throw new OrgError(
            'MEMBER_NOT_FOUND',
            `User "${userId}" is not a member of "${departmentId}".`,
          );
        // Memberships are disabled, not deleted, so history and a later re-add keep the same row.
        await connection.query
          .updateTable('departmentMembers')
          .set({ active: false, primary: false })
          .where('id', '=', text(membership.id))
          .execute();
        await record({
          action: 'departmentMember.remove',
          targetType: 'departmentMembers',
          targetId: `${departmentId}:${userId}`,
          before: { active: true, primary: toBoolean(membership.primary) },
          after: { active: false, primary: false },
        });
        return { result: undefined, changed: [userId] };
      });
    },

    async setPrimary(departmentId, userId, context) {
      await write(context, async (connection, record) => {
        requireNode(await loadTree(connection), departmentId);
        const membership = await connection.query
          .selectFrom('departmentMembers')
          .select(['id', 'primary'])
          .where('departmentId', '=', departmentId)
          .where('userId', '=', userId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!membership)
          throw new OrgError(
            'MEMBER_NOT_FOUND',
            `User "${userId}" is not a member of "${departmentId}".`,
          );
        if (toBoolean(membership.primary)) return { result: undefined };
        const previous = (
          await activeMemberships(connection, { userIds: [userId] })
        ).find((row) => row.primary);
        await connection.query
          .updateTable('departmentMembers')
          .set({ primary: false })
          .where('userId', '=', userId)
          .where('primary', '=', true)
          .execute();
        await connection.query
          .updateTable('departmentMembers')
          .set({ primary: true })
          .where('id', '=', text(membership.id))
          .execute();
        await record({
          action: 'departmentMember.setPrimary',
          targetType: 'departmentMembers',
          targetId: `${departmentId}:${userId}`,
          before: { primaryDepartmentId: previous?.departmentId ?? null },
          after: { primaryDepartmentId: departmentId },
        });
        return { result: undefined, changed: [userId] };
      });
    },

    // ---- Subjects and scopes --------------------------------------------------------------------------------------

    async departmentsOf(userId, connection) {
      const target = root(connection);
      const memberships = await activeMemberships(target, {
        userIds: [userId],
      });
      if (!memberships.length) return [];
      const tree = await loadTree(target);
      const result = new Set<string>();
      for (const membership of memberships)
        for (const node of activeChainOf(tree, membership.departmentId) ?? [])
          result.add(node.id);
      return [...result];
    },

    async filterActive(ids, connection) {
      if (!ids.length) return [];
      const tree = await loadTree(connection);
      return ids.filter((id) => isEffectivelyActive(tree, id));
    },

    async headedBy(userId, connection) {
      return headedIn(await loadTree(connection), userId);
    },

    async viewerDepartments(userId, options, connection) {
      const target = root(connection);
      const tree = await loadTree(target);
      const direct = new Set<string>();
      if (options.headed)
        for (const id of headedIn(tree, userId)) direct.add(id);
      if (options.memberships)
        for (const membership of await activeMemberships(target, {
          userIds: [userId],
        }))
          if (isEffectivelyActive(tree, membership.departmentId))
            direct.add(membership.departmentId);
      return options.descendants
        ? activeSubtrees(tree, [...direct])
        : [...direct];
    },

    async membersOf(departmentIds, connection) {
      const memberships = await activeMemberships(root(connection), {
        departmentIds,
      });
      return [...new Set(memberships.map((row) => row.userId))];
    },

    async listDepartmentOptions(query) {
      validatePage(query);
      const tree = await loadTree();
      // The tree is small: search and order in memory, literally.
      const matches = [...tree.values()]
        .filter(
          (node) =>
            isEffectivelyActive(tree, node.id) &&
            titleMatches(node.title, query.search),
        )
        .sort(
          (left, right) =>
            left.title.localeCompare(right.title) ||
            left.id.localeCompare(right.id),
        );
      const result = page(matches, query);
      return {
        items: result.items.map((node) => departmentOption(tree, node)),
        total: result.total,
      };
    },

    async resolveDepartments(ids) {
      if (!ids.length) return [];
      const tree = await loadTree();
      const options: SubjectOption[] = [];
      for (const id of new Set(ids)) {
        const node = tree.get(id);
        if (node) options.push(departmentOption(tree, node));
      }
      return options;
    },

    // ---- Positions ------------------------------------------------------------------------------------------------

    async createPosition(input, context) {
      const code = normalizeCode(input.code, true) as string;
      const title = normalizeTitle(input.title);
      const sortOrder =
        input.sortOrder === undefined
          ? 0
          : normalizeInteger(input.sortOrder, 'sortOrder');
      return write(context, async (connection, record) => {
        await assertCodeFree(connection, 'positions', code, undefined);
        const position: PositionView = {
          id: generateId(),
          code,
          title,
          active: true,
          sortOrder,
        };
        await connection.query
          .insertInto('positions')
          .values({ ...position })
          .execute();
        await record({
          action: 'position.create',
          targetType: 'positions',
          targetId: position.id,
          after: position,
        });
        return { result: position };
      });
    },

    async updatePosition(id, input, context) {
      const values: Record<string, unknown> = {};
      if (input.code !== undefined)
        values.code = normalizeCode(input.code, true);
      if (input.title !== undefined) values.title = normalizeTitle(input.title);
      if (input.sortOrder !== undefined)
        values.sortOrder = normalizeInteger(input.sortOrder, 'sortOrder');
      return write(context, async (connection, record) => {
        const current = toPosition(await loadRow(connection, 'positions', id));
        if (typeof values.code === 'string')
          await assertCodeFree(connection, 'positions', values.code, id);
        const snapshot = diff(
          current as unknown as Record<string, unknown>,
          values,
        );
        if (Object.keys(snapshot.after).length) {
          await connection.query
            .updateTable('positions')
            .set(snapshot.after)
            .where('id', '=', id)
            .execute();
          await record({
            action: 'position.update',
            targetType: 'positions',
            targetId: id,
            ...snapshot,
          });
        }
        const updated: PositionView = { ...current, ...snapshot.after };
        return { result: updated };
      });
    },

    async setPositionActive(id, active, context) {
      return write(context, async (connection, record) => {
        const current = toPosition(await loadRow(connection, 'positions', id));
        if (current.active === active) return { result: current };
        await connection.query
          .updateTable('positions')
          .set({ active })
          .where('id', '=', id)
          .execute();
        await record({
          action: active ? 'position.enable' : 'position.disable',
          targetType: 'positions',
          targetId: id,
          before: { active: current.active },
          after: { active },
        });
        return { result: { ...current, active } };
      });
    },

    // ---- Grades ---------------------------------------------------------------------------------------------------

    async createGrade(input, context) {
      const code = normalizeCode(input.code, true) as string;
      const title = normalizeTitle(input.title);
      const rank = normalizeInteger(input.rank, 'rank');
      return write(context, async (connection, record) => {
        await assertCodeFree(connection, 'grades', code, undefined);
        const grade: Grade = {
          id: generateId(),
          code,
          title,
          rank,
          active: true,
        };
        await connection.query
          .insertInto('grades')
          .values({ ...grade })
          .execute();
        await record({
          action: 'grade.create',
          targetType: 'grades',
          targetId: grade.id,
          after: grade,
        });
        return { result: grade };
      });
    },

    async updateGrade(id, input, context) {
      const values: Record<string, unknown> = {};
      if (input.code !== undefined)
        values.code = normalizeCode(input.code, true);
      if (input.title !== undefined) values.title = normalizeTitle(input.title);
      if (input.rank !== undefined)
        values.rank = normalizeInteger(input.rank, 'rank');
      return write(context, async (connection, record) => {
        const current = toGrade(await loadRow(connection, 'grades', id));
        if (typeof values.code === 'string')
          await assertCodeFree(connection, 'grades', values.code, id);
        const snapshot = diff(
          current as unknown as Record<string, unknown>,
          values,
        );
        if (Object.keys(snapshot.after).length) {
          await connection.query
            .updateTable('grades')
            .set(snapshot.after)
            .where('id', '=', id)
            .execute();
          await record({
            action: 'grade.update',
            targetType: 'grades',
            targetId: id,
            ...snapshot,
          });
        }
        const updated: Grade = { ...current, ...snapshot.after };
        return { result: updated };
      });
    },

    async setGradeActive(id, active, context) {
      return write(context, async (connection, record) => {
        const current = toGrade(await loadRow(connection, 'grades', id));
        if (current.active === active) return { result: current };
        await connection.query
          .updateTable('grades')
          .set({ active })
          .where('id', '=', id)
          .execute();
        await record({
          action: active ? 'grade.enable' : 'grade.disable',
          targetType: 'grades',
          targetId: id,
          before: { active: current.active },
          after: { active },
        });
        return { result: { ...current, active } };
      });
    },

    // ---- Duty roles -----------------------------------------------------------------------------------------------

    async listDutyRoles(connection) {
      const rows = await root(connection)
        .query.selectFrom('dutyRoles')
        .selectAll()
        .execute();
      return rows.map(toDutyRole).sort(compareDutyRoles);
    },

    async getDutyRole(code, connection) {
      const row = await root(connection)
        .query.selectFrom('dutyRoles')
        .selectAll()
        .where('code', '=', code)
        .executeTakeFirst();
      return row ? toDutyRole(row) : undefined;
    },

    async dutyRoleMemberCounts(connection) {
      const rows = await root(connection)
        .query.selectFrom('dutyRoleMembers')
        .select('dutyRoleCode')
        .where('active', '=', true)
        .execute();
      const counts = new Map<string, number>();
      for (const row of rows) {
        const code = text(row.dutyRoleCode);
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      return counts;
    },

    async listDutyRoleMembers(code, connection) {
      const target = root(connection);
      await loadDutyRole(target, code);
      return activeDutyRoleMembers(target, code);
    },

    async dutyRolesOf(userId, connection) {
      const target = root(connection);
      return requestConnectionRead(
        root(),
        target,
        `org.dutiesOf:${JSON.stringify(userId)}`,
        async () => {
          const rows = await target.query
            .selectFrom('dutyRoleMembers')
            .select('dutyRoleCode')
            .where('userId', '=', userId)
            .where('active', '=', true)
            .execute();
          if (!rows.length) return [];
          const active = await activeDutyRoleCodes(target);
          return rows
            .map((row) => text(row.dutyRoleCode))
            .filter((code) => active.has(code));
        },
      );
    },

    async filterActiveDutyRoles(codes, connection) {
      if (!codes.length) return [];
      const active = await activeDutyRoleCodes(root(connection));
      return codes.filter((code) => active.has(code));
    },

    async listDutyRoleOptions(query) {
      validatePage(query);
      const roles = (await service.listDutyRoles()).filter(
        (role) => role.active && titleMatches(role.title, query.search),
      );
      const result = page(roles, query);
      return { items: result.items.map(dutyRoleOption), total: result.total };
    },

    async resolveDutyRoles(codes) {
      if (!codes.length) return [];
      const wanted = new Set(codes);
      return (await service.listDutyRoles())
        .filter((role) => wanted.has(role.code))
        .map(dutyRoleOption);
    },

    async setDutyRoleActive(code, active, context) {
      if (typeof active !== 'boolean')
        throw new OrgError('INVALID_INPUT', '`active` is a boolean.', 'active');
      return write(context, async (connection, record) => {
        const current = await loadDutyRole(connection, code);
        if (current.active === active) return { result: current };
        await connection.query
          .updateTable('dutyRoles')
          .set({ active })
          .where('code', '=', code)
          .execute();
        await record({
          action: active ? 'dutyRole.enable' : 'dutyRole.disable',
          targetType: 'dutyRoles',
          targetId: code,
          before: { active: current.active },
          after: { active },
        });
        // Every member gains or loses the role subject.
        return {
          result: { ...current, active },
          changed: await activeDutyRoleMembers(connection, code),
        };
      });
    },

    async addDutyRoleMember(code, userId, context) {
      const user = await requireEnabledUser(
        userId,
        'userId',
        context.connection,
      );
      await write(context, async (connection, record) => {
        await loadDutyRole(connection, code);
        const existing = await connection.query
          .selectFrom('dutyRoleMembers')
          .select(['id', 'active'])
          .where('dutyRoleCode', '=', code)
          .where('userId', '=', user)
          .executeTakeFirst();
        if (existing && toBoolean(existing.active))
          return { result: undefined };
        if (existing)
          await connection.query
            .updateTable('dutyRoleMembers')
            .set({ active: true })
            .where('id', '=', text(existing.id))
            .execute();
        else
          await connection.query
            .insertInto('dutyRoleMembers')
            .values({
              id: generateId(),
              dutyRoleCode: code,
              userId: user,
              active: true,
            })
            .execute();
        await record({
          action: 'dutyRoleMember.add',
          targetType: 'dutyRoleMembers',
          targetId: `${code}:${user}`,
          after: { dutyRoleCode: code, userId: user, active: true },
        });
        return { result: undefined, changed: [user] };
      });
    },

    async removeDutyRoleMember(code, userId, context) {
      await write(context, async (connection, record) => {
        await loadDutyRole(connection, code);
        const membership = await connection.query
          .selectFrom('dutyRoleMembers')
          .select('id')
          .where('dutyRoleCode', '=', code)
          .where('userId', '=', userId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!membership)
          throw new OrgError(
            'MEMBER_NOT_FOUND',
            `User "${userId}" is not a member of duty role "${code}".`,
          );
        await connection.query
          .updateTable('dutyRoleMembers')
          .set({ active: false })
          .where('id', '=', text(membership.id))
          .execute();
        await record({
          action: 'dutyRoleMember.remove',
          targetType: 'dutyRoleMembers',
          targetId: `${code}:${userId}`,
          before: { active: true },
          after: { active: false },
        });
        return { result: undefined, changed: [userId] };
      });
    },
  };

  return service;
}
