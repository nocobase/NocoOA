import type { HeadcountService } from '../headcounts/contract.js';
import { requestConnectionRead } from '../request-performance/business-reads.js';
import { createHash } from 'node:crypto';
import {
  lockUserForAdministration,
  type UserAdministrationService,
} from '@nocobase/app-plugin-authentication';
import type { IdGeneratorService } from '@nocobase/snowflake';
import type {
  DatabaseConnection,
  DatabaseManager,
  FilterBuilder,
  FilterNode,
  RepositoryPolicy,
  RepositoryRecord,
} from '@nocobase/db';

import type { CalendarService } from '../platform/index.js';
import { isLocalDate } from '../platform/time-zone.js';
import type { AuditService } from '../audit/index.js';
import type { Department, OrgService } from '../org/contract.js';
import type {
  Employee,
  EmployeeCompensation,
  EmployeeHistoryEntry,
  EmployeeHistoryKind,
  EmployeeProfile,
  EmployeeService,
  EmployeeStatus,
} from './contract.js';
import { EmployeeError } from './errors.js';
import {
  activeChainAbove,
  buildReportingGraph,
  descendantsOf,
  effectiveDirectReportsOf,
  wouldCreateCycle,
  type ReportingGraph,
} from './reporting-chain.js';

/** Basic archive fields, in display order. */
export const EMPLOYEE_FIELDS = [
  'id',
  'userId',
  'code',
  'name',
  'managerId',
  'positionId',
  'gradeId',
  'hireDate',
  'careerStartDate',
  'probationEndDate',
  'status',
  'lastWorkingDay',
  'phone',
  'email',
  'workLocation',
  'emergencyContact',
  'active',
  'createdAt',
  'updatedAt',
] as const;

/** Fields HR maintains on an archive. Status, `active` and `lastWorkingDay` change only through flows or a correction. */
export const EMPLOYEE_EDITABLE_FIELDS = [
  'code',
  'name',
  'managerId',
  'positionId',
  'gradeId',
  'hireDate',
  'careerStartDate',
  'probationEndDate',
  'phone',
  'email',
  'workLocation',
  'emergencyContact',
] as const;

/** Directory fields everyone holding the directory may read. Contact fields are granted separately. */
export const DIRECTORY_FIELDS = [
  'id',
  'userId',
  'code',
  'name',
  'managerId',
  'positionId',
  'workLocation',
  'active',
] as const;
export const CONTACT_FIELDS = ['id', 'phone', 'email'] as const;

export const PROFILE_FIELDS = [
  'employeeId',
  'idType',
  'idNumber',
  'birthDate',
  'address',
  'education',
  'school',
  'major',
  'bankName',
  'bankAccount',
  'bankAccountName',
  'updatedAt',
] as const;
export const PROFILE_BANK_FIELDS = [
  'employeeId',
  'bankName',
  'bankAccount',
  'bankAccountName',
] as const;
export const PROFILE_EDITABLE_FIELDS = PROFILE_FIELDS.filter(
  (field) => field !== 'employeeId' && field !== 'updatedAt',
);

/** Profile fields whose values never enter an audit log in clear. */
const MASKED_PROFILE_FIELDS = new Set(['idNumber', 'bankAccount']);

export type EmployeeEditableField = (typeof EMPLOYEE_EDITABLE_FIELDS)[number];
export type EmployeeInput = { [K in EmployeeEditableField]?: Employee[K] };
export type ProfileEditableField = (typeof PROFILE_EDITABLE_FIELDS)[number];
export type ProfileInput = { [K in ProfileEditableField]?: string | null };

export interface CreateEmployeeInput extends EmployeeInput {
  userId: string;
  code: string;
  name: string;
  status: EmployeeStatus;
}

/**
 * How a trusted caller (the import) runs an archive write: as a savepoint of its own transaction, with a reason on the
 * audit entry. Without a connection the write runs in a transaction of its own, as the routes use it.
 */
export interface EmployeeWriteOptions {
  connection?: DatabaseConnection;
  /** Recorded on the audit entry, such as the import that made the change. */
  reason?: string | null;
}

export interface CorrectStatusInput {
  status: EmployeeStatus;
  lastWorkingDay?: string | null;
  active?: boolean;
  reason: string;
}

export interface NamedRef {
  id: string;
  title: string;
}

/** An archive as the pages show it: the stored fields a policy allowed plus resolved names. */
export interface EmployeeView extends Partial<Employee> {
  id: string;
  user: { id: string; name: string; email: string | null } | null;
  manager: { id: string; name: string; userId: string } | null;
  primaryDepartment: NamedRef | null;
  position: NamedRef | null;
  grade: NamedRef | null;
}

export interface DirectoryEntry {
  id: string;
  userId: string;
  user: { id: string; name: string } | null;
  code: string;
  name: string;
  manager: { id: string; name: string; userId: string } | null;
  primaryDepartment: NamedRef | null;
  position: NamedRef | null;
  workLocation: string | null;
  /** Absent when the viewer may not read this person's contact details. */
  phone?: string | null;
  email?: string | null;
}

/** Columns the archive list sorts by. Names are not: the database cannot sort them in pinyin order. */
export const EMPLOYEE_SORT_FIELDS = ['code', 'hireDate', 'updatedAt'] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export interface ListEmployeesQuery {
  q?: string;
  /** Defaults to the most recently updated first. */
  orderBy?: { field: EmployeeSortField; desc: boolean };
  status?: EmployeeStatus;
  active?: boolean;
  departmentId?: string;
  page: number;
  pageSize: number;
}

export interface ListDirectoryQuery {
  q?: string;
  departmentId?: string;
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** What the reporting-line record access and subjects need besides the contract. */
export interface EmployeeModuleService extends EmployeeService {
  /** Shared by import preflight and archive writes; computed in the platform calendar time zone. */
  validateCareerDates(
    input: Pick<Employee, 'careerStartDate' | 'hireDate'>,
  ): void;
  loadGraph(connection?: DatabaseConnection): Promise<ReportingGraph>;
  listEmployees(
    query: ListEmployeesQuery,
    policy: RepositoryPolicy,
  ): Promise<Page<EmployeeView>>;
  getEmployeeView(
    id: string,
    policy: RepositoryPolicy,
  ): Promise<EmployeeView | undefined>;
  /** Whether the employee exists at all, for telling 403 from 404 after a scoped read found nothing. */
  exists(id: string): Promise<boolean>;
  createEmployee(
    input: CreateEmployeeInput,
    policy: RepositoryPolicy,
    actorId: string,
    options?: EmployeeWriteOptions,
  ): Promise<EmployeeView>;
  updateEmployee(
    id: string,
    input: EmployeeInput,
    policy: RepositoryPolicy,
    actorId: string,
    options?: EmployeeWriteOptions,
  ): Promise<EmployeeView>;
  correctStatus(
    id: string,
    input: CorrectStatusInput,
    policy: RepositoryPolicy,
    actorId: string,
    options?: Pick<EmployeeWriteOptions, 'connection'>,
  ): Promise<EmployeeView>;
  getProfile(
    employeeId: string,
    policy: RepositoryPolicy | true,
  ): Promise<Partial<EmployeeProfile> | undefined>;
  updateProfile(
    employeeId: string,
    input: ProfileInput,
    policy: RepositoryPolicy,
    actorId: string,
  ): Promise<Partial<EmployeeProfile>>;
  listCompensation(
    employeeId: string,
    policy: RepositoryPolicy | true,
  ): Promise<EmployeeCompensation[]>;
  listHistory(employeeId: string): Promise<EmployeeHistoryEntry[]>;
  listDirectory(
    query: ListDirectoryQuery,
    policy: RepositoryPolicy,
    contactPolicy: RepositoryPolicy | false,
  ): Promise<Page<DirectoryEntry>>;
  /** The viewer's own archive with names resolved; undefined when they have none. */
  getOwnView(userId: string): Promise<EmployeeView | undefined>;
}

export interface EmployeeServiceDependencies {
  headcounts?: () => HeadcountService | undefined;
  database: DatabaseManager;
  calendar: () => Pick<CalendarService, 'localDate'>;
  audit: () => AuditService;
  users: () => UserAdministrationService;
  ids: () => IdGeneratorService;
  /** The organisation service, when the org module has bound it. */
  org: () => OrgService | undefined;
  /** Called after commit with the users whose inherited subjects (position, manager) may have changed. */
  onSubjectsChanged?: (userIds: readonly string[]) => Promise<void> | void;
}

const TRUSTED = true as const;

/** A stored scalar as text; ids and codes come back as strings or numbers depending on the dialect. */
function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return value == null ? '' : JSON.stringify(value);
}

/** `YYYY-MM-DD` of a stored date, whatever the dialect hands back. */
function dateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return str(value).slice(0, 10);
}

function isoTime(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(str(value));
  return Number.isNaN(date.getTime()) ? str(value) : date.toISOString();
}

function text(value: unknown): string | null {
  return value == null ? null : str(value);
}

/** A decimal as a two-place string, without passing through arithmetic. */
export function formatAmount(value: unknown): string {
  const raw = str(value ?? '0').trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/u.exec(raw);
  if (!match) return raw;
  const [, sign, whole, fraction = ''] = match;
  return `${sign}${whole || '0'}.${(fraction + '00').slice(0, 2)}`;
}

/** Maps a stored row to the fields present in it; a policy may have left some out. */
function toEmployee(row: RepositoryRecord): Partial<Employee> & { id: string } {
  const result: Record<string, unknown> = { id: str(row.id) };
  for (const field of EMPLOYEE_FIELDS) {
    if (!(field in row) || field === 'id') continue;
    const value = row[field];
    switch (field) {
      case 'hireDate':
      case 'careerStartDate':
      case 'probationEndDate':
      case 'lastWorkingDay':
        result[field] = dateOnly(value);
        break;
      case 'createdAt':
      case 'updatedAt':
        result[field] = isoTime(value);
        break;
      case 'active':
        result[field] = Boolean(value);
        break;
      default:
        result[field] = text(value);
    }
  }
  return result as Partial<Employee> & { id: string };
}

function toProfile(row: RepositoryRecord): Partial<EmployeeProfile> {
  const result: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    if (!(field in row)) continue;
    const value = row[field];
    if (field === 'birthDate') result[field] = dateOnly(value);
    else if (field === 'updatedAt') result[field] = isoTime(value);
    else result[field] = text(value);
  }
  return result;
}

function toCompensation(row: RepositoryRecord): EmployeeCompensation {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    gradeId: text(row.gradeId),
    baseSalary: formatAmount(row.baseSalary),
    effectiveFrom: dateOnly(row.effectiveFrom) ?? '',
    sourceApplication: text(row.sourceApplication),
    note: text(row.note),
    createdById: text(row.createdById),
    createdAt: isoTime(row.createdAt) ?? '',
  };
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toHistory(row: RepositoryRecord): EmployeeHistoryEntry {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    kind: str(row.kind) as EmployeeHistoryKind,
    before: jsonObject(row.before),
    after: jsonObject(row.after),
    effectiveAt: dateOnly(row.effectiveAt) ?? '',
    sourceApplication: text(row.sourceApplication),
    note: text(row.note),
    createdById: text(row.createdById),
    createdAt: isoTime(row.createdAt) ?? '',
  };
}

function mask(value: unknown): unknown {
  if (value == null || value === '') return value;
  const raw = str(value);
  return raw.length <= 4 ? '****' : `****${raw.slice(-4)}`;
}

/** The fields whose value differs, as `{ before, after }` snapshots. */
function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  masked: ReadonlySet<string> = new Set(),
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const result = {
    before: {} as Record<string, unknown>,
    after: {} as Record<string, unknown>,
  };
  for (const [field, value] of Object.entries(after)) {
    if ((before[field] ?? null) === (value ?? null)) continue;
    result.before[field] = masked.has(field)
      ? mask(before[field])
      : (before[field] ?? null);
    result.after[field] = masked.has(field) ? mask(value) : (value ?? null);
  }
  return result;
}

const SALARY_KEY = /salary|amount|pay/iu;

function containsSalary(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) => SALARY_KEY.test(key) || containsSalary(nested),
  );
}

function anyEq(
  f: FilterBuilder<RepositoryRecord>,
  field: string,
  values: readonly string[],
): FilterNode {
  return f.or(values.map((value) => f.string(field).eq(value)));
}

export function createEmployeeService(
  deps: EmployeeServiceDependencies,
): EmployeeModuleService {
  const { database } = deps;
  const conn = (connection?: DatabaseConnection): DatabaseConnection =>
    connection ?? database.connection();

  async function administrativeWrite(
    userId: string | undefined,
    connection: DatabaseConnection,
    work: (tx: DatabaseConnection) => Promise<void>,
  ) {
    const capacity = deps.headcounts?.();
    if (!capacity) return connection.transaction(work);
    try {
      return await capacity.protectRoster(
        userId ? [userId] : undefined,
        connection,
        work,
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        String(error.code).startsWith('HEADCOUNT_')
      )
        throw new EmployeeError(
          'EMPLOYEE_HEADCOUNT_CONFLICT',
          'The initialized headcount roster must remain consistent; use the corresponding business flow or reconcile the original source.',
        );
      throw error;
    }
  }

  async function loadGraph(
    connection?: DatabaseConnection,
  ): Promise<ReportingGraph> {
    return requestConnectionRead(
      conn(),
      conn(connection),
      'employees.reportingGraph',
      async () => {
        const rows = await conn(connection)
          .query.selectFrom('employees')
          .select(['id', 'userId', 'managerId', 'active'])
          .execute();
        return buildReportingGraph(
          rows.map((row) => ({
            id: str(row.id),
            userId: str(row.userId),
            managerId: row.managerId == null ? null : str(row.managerId),
            active: Boolean(row.active),
          })),
        );
      },
    );
  }

  async function getById(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Employee | undefined> {
    const row = await conn(connection)
      .repository('employees')
      .findOne({ filter: { id } });
    return row ? (toEmployee(row) as Employee) : undefined;
  }

  async function getByUserId(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<Employee | undefined> {
    return requestConnectionRead(
      conn(),
      conn(connection),
      `employees.byUser:${JSON.stringify(userId)}`,
      async () => {
        const row = await conn(connection)
          .repository('employees')
          .findOne({ filter: { userId } });
        return row ? (toEmployee(row) as Employee) : undefined;
      },
    );
  }

  async function byIds(
    ids: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Employee[]> {
    if (!ids.length) return [];
    const rows = await conn(connection)
      .repository('employees')
      .findMany({ filter: (f) => anyEq(f, 'id', ids) });
    const map = new Map(
      rows.map((row) => [str(row.id), toEmployee(row) as Employee]),
    );
    return ids.flatMap((id) => {
      const employee = map.get(id);
      return employee ? [employee] : [];
    });
  }

  async function startOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<{ graph: ReportingGraph; id: string } | undefined> {
    const graph = await loadGraph(connection);
    const node = graph.byUserId.get(userId);
    return node ? { graph, id: node.id } : undefined;
  }

  // ---- names and organisation lookups -------------------------------------------------------------------------

  async function userNames(
    userIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Map<string, { id: string; name: string; email: string | null }>> {
    const unique = [...new Set(userIds)];
    const result = new Map<
      string,
      { id: string; name: string; email: string | null }
    >();
    const users = connection
      ? deps.users().withConnection(connection)
      : deps.users();
    // The users service caps a page at 100.
    for (let index = 0; index < unique.length; index += 100) {
      const chunk = unique.slice(index, index + 100);
      const page = await users.list({
        userIds: chunk,
        pageSize: 100,
        kind: 'all',
      });
      for (const user of page.items)
        result.set(user.id, {
          id: user.id,
          name: user.name,
          email: user.email ?? null,
        });
    }
    return result;
  }

  interface OrgLookups {
    departments: ReadonlyMap<string, Department>;
    positions: ReadonlyMap<string, NamedRef>;
    grades: ReadonlyMap<string, NamedRef>;
  }

  async function orgLookups(
    userIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<OrgLookups> {
    const org = deps.org();
    if (!org)
      return {
        departments: new Map(),
        positions: new Map(),
        grades: new Map(),
      };
    const [departments, positions, grades] = await Promise.all([
      userIds.length
        ? org.primaryDepartmentsOf(userIds, connection)
        : Promise.resolve(new Map<string, Department>()),
      org.listPositions(connection),
      org.listGrades(connection),
    ]);
    return {
      departments,
      positions: new Map(
        positions.map((p) => [p.id, { id: p.id, title: String(p.title) }]),
      ),
      grades: new Map(
        grades.map((g) => [g.id, { id: g.id, title: String(g.title) }]),
      ),
    };
  }

  async function managerNames(
    managerIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Map<string, { id: string; name: string; userId: string }>> {
    const managers = await byIds([...new Set(managerIds)], connection);
    return new Map(
      managers.map((m) => [m.id, { id: m.id, name: m.name, userId: m.userId }]),
    );
  }

  async function views(
    employees: readonly (Partial<Employee> & { id: string })[],
    connection?: DatabaseConnection,
  ): Promise<EmployeeView[]> {
    const userIds = employees.flatMap((e) => (e.userId ? [e.userId] : []));
    const managerIds = employees.flatMap((e) =>
      e.managerId ? [e.managerId] : [],
    );
    // Sequential inside a caller's transaction, whose connection runs one statement at a time; parallel otherwise.
    const [users, lookups, managers] = connection
      ? [
          await userNames(userIds, connection),
          await orgLookups(userIds, connection),
          await managerNames(managerIds, connection),
        ]
      : await Promise.all([
          userNames(userIds),
          orgLookups(userIds),
          managerNames(managerIds),
        ]);
    return employees.map((employee) => {
      const department = employee.userId
        ? lookups.departments.get(employee.userId)
        : undefined;
      return {
        ...employee,
        user: employee.userId ? (users.get(employee.userId) ?? null) : null,
        manager: employee.managerId
          ? (managers.get(employee.managerId) ?? null)
          : null,
        primaryDepartment: department
          ? { id: department.id, title: String(department.title) }
          : null,
        position: employee.positionId
          ? (lookups.positions.get(employee.positionId) ?? null)
          : null,
        grade: employee.gradeId
          ? (lookups.grades.get(employee.gradeId) ?? null)
          : null,
      };
    });
  }

  /** User ids whose primary department is in the department's active subtree; undefined without the org module. */
  async function userIdsInDepartment(
    departmentId: string,
    candidateUserIds: readonly string[],
  ): Promise<string[]> {
    const org = deps.org();
    if (!org || !candidateUserIds.length) return [];
    const [subtree, primaries] = await Promise.all([
      org.subtreeIds(departmentId),
      org.primaryDepartmentsOf(candidateUserIds),
    ]);
    const inTree = new Set(subtree);
    return candidateUserIds.filter((userId) => {
      const department = primaries.get(userId);
      return department ? inTree.has(department.id) : false;
    });
  }

  function validateCareerDate(
    input: Pick<Employee, 'careerStartDate' | 'hireDate'>,
  ): void {
    const date = input.careerStartDate;
    if (date == null) return;
    if (!isLocalDate(date))
      throw new EmployeeError(
        'EMPLOYEE_CAREER_START_INVALID',
        'The first employment date must be a valid local date.',
      );
    if (date > deps.calendar().localDate(new Date()))
      throw new EmployeeError(
        'EMPLOYEE_CAREER_START_FUTURE',
        'The first employment date cannot be in the future.',
      );
    if (input.hireDate && date > input.hireDate)
      throw new EmployeeError(
        'EMPLOYEE_CAREER_START_AFTER_HIRE',
        'The first employment date cannot be later than the hire date.',
      );
  }

  // ---- validation ---------------------------------------------------------------------------------------------

  async function validateReferences(
    input: EmployeeInput & { userId?: string },
    employeeId: string,
    connection: DatabaseConnection,
    allowDisabled = false,
  ): Promise<void> {
    if (input.userId !== undefined) {
      const user = await deps
        .users()
        .withConnection(connection)
        .get(input.userId);
      if (!user)
        throw new EmployeeError(
          'EMPLOYEE_USER_NOT_FOUND',
          `User ${input.userId} does not exist.`,
        );
      if (user.disabledAt && !allowDisabled)
        throw new EmployeeError(
          'EMPLOYEE_USER_DISABLED',
          `User ${input.userId} is disabled.`,
        );
      const taken = await connection.query
        .selectFrom('employees')
        .select('id')
        .where('userId', '=', input.userId)
        .where('id', '!=', employeeId)
        .executeTakeFirst();
      if (taken)
        throw new EmployeeError(
          'EMPLOYEE_USER_TAKEN',
          `User ${input.userId} already has an archive.`,
        );
    }
    if (input.code !== undefined) {
      const taken = await connection.query
        .selectFrom('employees')
        .select('id')
        .where('code', '=', input.code)
        .where('id', '!=', employeeId)
        .executeTakeFirst();
      if (taken)
        throw new EmployeeError(
          'EMPLOYEE_CODE_TAKEN',
          `Employee code ${input.code} is already used.`,
        );
    }
    if (input.managerId) {
      const graph = await loadGraph(connection);
      const manager = graph.byId.get(input.managerId);
      if (!manager)
        throw new EmployeeError(
          'EMPLOYEE_MANAGER_NOT_FOUND',
          `Manager ${input.managerId} does not exist.`,
        );
      if (!manager.active)
        throw new EmployeeError(
          'EMPLOYEE_MANAGER_INACTIVE',
          `Manager ${input.managerId} is not active.`,
        );
      if (wouldCreateCycle(graph, employeeId, input.managerId))
        throw new EmployeeError(
          'EMPLOYEE_MANAGER_CYCLE',
          'The manager would close a loop in the reporting line.',
        );
    }
    const org = deps.org();
    if (org && input.positionId) {
      const position = (await org.listPositions(connection)).find(
        (p) => p.id === input.positionId,
      );
      if (!position?.active)
        throw new EmployeeError(
          'EMPLOYEE_POSITION_NOT_FOUND',
          `Position ${input.positionId} does not exist or is disabled.`,
        );
    }
    if (org && input.gradeId) {
      const grade = (await org.listGrades(connection)).find(
        (g) => g.id === input.gradeId,
      );
      if (!grade?.active)
        throw new EmployeeError(
          'EMPLOYEE_GRADE_NOT_FOUND',
          `Grade ${input.gradeId} does not exist or is disabled.`,
        );
    }
  }

  function notifyAfterCommit(
    connection: DatabaseConnection,
    userIds: readonly (string | null | undefined)[],
  ): void {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (!ids.length || !deps.onSubjectsChanged) return;
    const notify = deps.onSubjectsChanged;
    connection.afterCommit(() => notify(ids));
  }

  /** The users whose subjects depend on an archive: the person, and their previous and new managers. */
  async function affectedUsers(
    before: Partial<Employee> | undefined,
    after: Partial<Employee>,
    connection: DatabaseConnection,
  ): Promise<string[]> {
    const managerIds = [before?.managerId, after.managerId].filter(
      (id): id is string => !!id,
    );
    const managers = await byIds(managerIds, connection);
    return [
      before?.userId ?? '',
      after.userId ?? '',
      ...managers.map((m) => m.userId),
    ].filter(Boolean);
  }

  // ---- contract -----------------------------------------------------------------------------------------------

  const service: EmployeeModuleService = {
    async createForOnboarding(input, origin, connection) {
      if (
        !origin.actorId ||
        !origin.sourceApplication.startsWith('oa.onboarding:') ||
        !origin.sourceApplication.slice(14).trim()
      )
        throw new EmployeeError(
          'EMPLOYEE_ONBOARDING_SOURCE_CONFLICT',
          'A fixed onboarding source and actor are required.',
        );
      return connection.transaction(async (tx) => {
        await lockUserForAdministration(tx, input.userId);
        const sourceId = createHash('sha256')
          .update(origin.sourceApplication)
          .digest('hex');
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify([
              input.userId,
              input.code,
              input.name,
              input.managerId,
              input.positionId,
              input.gradeId,
              input.hireDate,
              input.careerStartDate,
              input.probationEndDate,
              origin.actorId,
            ]),
          )
          .digest('hex');
        const origins = tx.repository('employeeOnboardingOrigins');
        const prior = await origins.findOne({ filter: { id: sourceId } });
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new EmployeeError(
              'EMPLOYEE_ONBOARDING_SOURCE_CONFLICT',
              'Onboarding source payload cannot change.',
            );
          const employee = await getById(str(prior.employeeId), tx);
          if (!employee)
            throw new EmployeeError(
              'EMPLOYEE_NOT_FOUND',
              'Onboarding employee is missing.',
            );
          return employee;
        }
        const user = await deps.users().withConnection(tx).get(input.userId);
        if (!user)
          throw new EmployeeError(
            'EMPLOYEE_USER_NOT_FOUND',
            'Onboarding account is missing.',
          );
        if (!user.disabledAt)
          throw new EmployeeError(
            'EMPLOYEE_ONBOARDING_ACCOUNT_ENABLED',
            'Onboarding account must be disabled.',
          );
        const id = deps.ids().generateString();
        await validateReferences(input, id, tx, true);
        validateCareerDate(input);
        if (
          !isLocalDate(input.hireDate) ||
          !isLocalDate(input.probationEndDate) ||
          input.probationEndDate < input.hireDate
        )
          throw new EmployeeError(
            'EMPLOYEE_PROBATION_END_INVALID',
            'Onboarding hire and probation dates must be valid and ordered.',
          );
        const now = new Date();
        await tx.repository('employees').createOne({
          values: {
            userId: input.userId,
            code: input.code,
            name: input.name,
            managerId: input.managerId,
            positionId: input.positionId,
            gradeId: input.gradeId,
            hireDate: input.hireDate,
            careerStartDate: input.careerStartDate,
            probationEndDate: input.probationEndDate,
            id,
            status: 'probation',
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx
          .repository('employeeProfiles')
          .createOne({ values: { employeeId: id, updatedAt: now } });
        await origins.createOne({
          values: { id: sourceId, employeeId: id, fingerprint, createdAt: now },
        });
        const employee = (await getById(id, tx))!;
        await deps.audit().record(
          {
            actorId: origin.actorId,
            action: 'employee.onboardingCreate',
            targetType: 'employees',
            targetId: id,
            after: employee,
            reason: origin.sourceApplication,
          },
          tx,
        );
        await service.appendHistory(
          {
            employeeId: id,
            kind: 'hire',
            after: {
              status: 'probation',
              positionId: input.positionId,
              gradeId: input.gradeId,
            },
            effectiveAt: input.hireDate,
          },
          origin,
          tx,
        );
        notifyAfterCommit(tx, await affectedUsers(undefined, employee, tx));
        return employee;
      });
    },

    loadGraph,
    async recruitmentReplacementCandidates(query, policy, connection) {
      const rows = await connection
        .repository('employees')
        .withPolicy(policy)
        .findMany({
          select: (selection) =>
            selection.fields('id', 'name', 'status', 'userId', 'positionId'),
          filter: (filter) =>
            filter.and([
              filter.string('positionId').eq(query.positionId),
              filter.or([
                filter.string('status').eq('leaving'),
                filter.string('status').eq('left'),
              ]),
              ...(query.search
                ? [
                    filter
                      .string('name')
                      .includes(query.search, { mode: 'insensitive' }),
                  ]
                : []),
            ]),
        });
      const org = deps.org();
      if (!org) return [];
      const departments = await org.primaryDepartmentsOf(
        rows.map((row) => str(row.userId)),
        connection,
      );
      return rows
        .filter(
          (row) => departments.get(str(row.userId))?.id === query.departmentId,
        )
        .slice(0, 100)
        .map((row) => ({
          id: str(row.id),
          name: str(row.name),
          status: str(row.status) as EmployeeStatus,
        }));
    },
    getById,
    getByUserId,

    async paymentAccountOf(userId, connection) {
      const employee = await getByUserId(userId, connection);
      if (!employee) return undefined;
      const row = await connection.repository('employeeProfiles').findOne({
        filter: { employeeId: employee.id },
        select: (s) => s.fields('bankName', 'bankAccount', 'bankAccountName'),
      });
      if (!row) return undefined;
      return {
        bankName: row.bankName == null ? null : str(row.bankName),
        bankAccount: row.bankAccount == null ? null : str(row.bankAccount),
        bankAccountName:
          row.bankAccountName == null ? null : str(row.bankAccountName),
      };
    },

    async getByUserIds(userIds, connection) {
      if (!userIds.length) return new Map();
      return requestConnectionRead(
        conn(),
        conn(connection),
        `employees.byUsers:${JSON.stringify([...new Set(userIds)].sort())}`,
        async () => {
          const rows = await conn(connection)
            .repository('employees')
            .findMany({
              filter: (f) => anyEq(f, 'userId', [...new Set(userIds)]),
            });
          return new Map(
            rows.map((row) => [str(row.userId), toEmployee(row) as Employee]),
          );
        },
      );
    },

    async managerChainOf(userId, connection) {
      const start = await startOf(userId, connection);
      if (!start) return [];
      return byIds(
        activeChainAbove(start.graph, start.id).map((node) => node.id),
        connection,
      );
    },

    async managerChainsOf(userIds, connection) {
      const result = new Map<string, Employee[]>();
      if (!userIds.length) return result;
      const graph = await loadGraph(connection);
      const chains = new Map(
        [...new Set(userIds)].map((userId) => {
          const node = graph.byUserId.get(userId);
          return [
            userId,
            node
              ? activeChainAbove(graph, node.id).map((entry) => entry.id)
              : [],
          ] as const;
        }),
      );
      const managers = new Map(
        (
          await byIds([...new Set([...chains.values()].flat())], connection)
        ).map((entry) => [entry.id, entry]),
      );
      for (const [userId, ids] of chains)
        result.set(
          userId,
          ids.flatMap((id) => {
            const manager = managers.get(id);
            return manager ? [manager] : [];
          }),
        );
      return result;
    },

    async managerOf(userId, connection) {
      const start = await startOf(userId, connection);
      if (!start) return undefined;
      const nearest = activeChainAbove(start.graph, start.id)[0];
      return nearest ? getById(nearest.id, connection) : undefined;
    },

    async directReportsOf(userId, connection) {
      const start = await startOf(userId, connection);
      if (!start || !start.graph.byId.get(start.id)?.active) return [];
      return byIds(
        effectiveDirectReportsOf(start.graph, start.id).map((node) => node.id),
        connection,
      );
    },

    async reportsOf(userId, connection) {
      const start = await startOf(userId, connection);
      if (!start || !start.graph.byId.get(start.id)?.active) return [];
      return byIds(
        descendantsOf(start.graph, start.id).map((node) => node.id),
        connection,
      );
    },

    async isAboveInReportingLine(managerUserId, userId, connection) {
      const start = await startOf(userId, connection);
      if (!start) return false;
      return activeChainAbove(start.graph, start.id).some(
        (node) => node.userId === managerUserId,
      );
    },

    async currentCompensationOf(employeeId, effectiveDate, connection) {
      if (!isLocalDate(effectiveDate))
        throw new EmployeeError(
          'EMPLOYEE_ASSIGNMENT_INVALID',
          'An exact effective local date is required.',
        );
      const rows = await connection
        .repository('employeeCompensation')
        .findMany({
          filter: (f) =>
            f.and([
              f.string('employeeId').eq(employeeId),
              f.date('effectiveFrom').notAfter(effectiveDate),
            ]),
          sort: (s) => [
            s.field('effectiveFrom').desc(),
            s.field('createdAt').desc(),
            s.field('id').desc(),
          ],
          limit: 1,
        });
      return rows[0] ? toCompensation(rows[0]) : undefined;
    },

    async applyAssignmentChange(input, origin, connection) {
      if (
        !origin.actorId ||
        !origin.sourceApplication.startsWith('oa.transfer:') ||
        !origin.sourceApplication.slice(12).trim()
      )
        throw new EmployeeError(
          'EMPLOYEE_ASSIGNMENT_SOURCE_CONFLICT',
          'A fixed personnel change source and actor are required.',
        );
      if (!isLocalDate(input.effectiveAt))
        throw new EmployeeError(
          'EMPLOYEE_ASSIGNMENT_INVALID',
          'An exact effective local date is required.',
        );
      return connection.transaction(async (tx) => {
        const discovered = await getById(input.employeeId, tx);
        if (!discovered)
          throw new EmployeeError('EMPLOYEE_NOT_FOUND', 'Employee is missing.');
        await lockUserForAdministration(tx, discovered.userId);
        const before = (await getById(input.employeeId, tx))!;
        if (
          !before.active ||
          before.status === 'left' ||
          before.status === 'leaving'
        )
          throw new EmployeeError(
            'EMPLOYEE_ASSIGNMENT_INVALID',
            'An active probation or regular employee is required.',
          );
        const user = await deps.users().withConnection(tx).get(before.userId);
        if (!user || user.disabledAt)
          throw new EmployeeError(
            'EMPLOYEE_USER_DISABLED',
            'The employee account must be enabled.',
          );
        const sourceId = createHash('sha256')
          .update(origin.sourceApplication)
          .digest('hex');
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify([
              input.employeeId,
              input.expected.positionId,
              input.expected.gradeId,
              input.expected.managerId,
              input.expected.status,
              input.positionId,
              input.gradeId,
              input.managerId,
              input.effectiveAt,
              input.note ?? null,
              origin.actorId,
            ]),
          )
          .digest('hex');
        const origins = tx.repository('employeeAssignmentOrigins');
        const prior = await origins.findOne({ filter: { id: sourceId } });
        if (prior) {
          if (
            prior.fingerprint !== fingerprint ||
            prior.employeeId !== input.employeeId
          )
            throw new EmployeeError(
              'EMPLOYEE_ASSIGNMENT_SOURCE_CONFLICT',
              'Personnel change source payload cannot change.',
            );
          return before;
        }
        if (
          (['positionId', 'gradeId', 'managerId', 'status'] as const).some(
            (key) => before[key] !== input.expected[key],
          )
        )
          throw new EmployeeError(
            'EMPLOYEE_ASSIGNMENT_STALE',
            'The actual employee assignment changed.',
          );
        if (!input.positionId || !input.gradeId)
          throw new EmployeeError(
            'EMPLOYEE_ASSIGNMENT_INVALID',
            'An active target position and grade are required.',
          );
        await validateReferences(
          {
            positionId: input.positionId,
            gradeId: input.gradeId,
            managerId: input.managerId,
          },
          input.employeeId,
          tx,
        );
        if (input.managerId) {
          const manager = await getById(input.managerId, tx);
          if (
            !manager ||
            manager.status === 'left' ||
            manager.status === 'leaving'
          )
            throw new EmployeeError(
              'EMPLOYEE_MANAGER_INACTIVE',
              'The target manager must be currently employed.',
            );
        }
        await tx.repository('employees').updateOne({
          filter: { id: input.employeeId },
          values: {
            positionId: input.positionId,
            gradeId: input.gradeId,
            managerId: input.managerId,
            updatedAt: new Date(),
          },
        });
        const after = (await getById(input.employeeId, tx))!;
        const changed = diff(before as unknown as Record<string, unknown>, {
          positionId: after.positionId,
          gradeId: after.gradeId,
          managerId: after.managerId,
        });
        await service.appendHistory(
          {
            employeeId: input.employeeId,
            kind: 'transfer',
            before: changed.before,
            after: changed.after,
            effectiveAt: input.effectiveAt,
            note: input.note ?? null,
          },
          origin,
          tx,
        );
        await deps.audit().record(
          {
            actorId: origin.actorId,
            action: 'employee.assignment',
            targetType: 'employees',
            targetId: input.employeeId,
            before: changed.before,
            after: changed.after,
            reason: origin.sourceApplication,
          },
          tx,
        );
        await origins.createOne({
          values: {
            id: sourceId,
            employeeId: input.employeeId,
            fingerprint,
            createdAt: new Date(),
          },
        });
        notifyAfterCommit(tx, await affectedUsers(before, after, tx));
        return after;
      });
    },

    async applyStatusChange(input, origin, connection) {
      const before = await getById(input.employeeId, connection);
      if (!before)
        throw new EmployeeError(
          'EMPLOYEE_NOT_FOUND',
          `Employee ${input.employeeId} does not exist.`,
        );
      const values: RepositoryRecord = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (input.lastWorkingDay !== undefined)
        values.lastWorkingDay = input.lastWorkingDay;
      if (input.probationEndDate !== undefined) {
        if (
          input.probationEndDate !== null &&
          !isLocalDate(input.probationEndDate)
        )
          throw new EmployeeError(
            'EMPLOYEE_PROBATION_END_INVALID',
            'A valid probation end date is required.',
          );
        values.probationEndDate = input.probationEndDate;
      }
      if (input.gradeId !== undefined) {
        if (input.gradeId !== null) {
          const grade = ((await deps.org()?.listGrades(connection)) ?? []).find(
            (g) => g.id === input.gradeId && g.active,
          );
          if (!grade)
            throw new EmployeeError(
              'EMPLOYEE_GRADE_NOT_FOUND',
              'Choose an active grade.',
            );
        }
        values.gradeId = input.gradeId;
      }
      if (input.active !== undefined) values.active = input.active;
      await connection.repository('employees').updateOne({
        filter: { id: input.employeeId },
        values,
      });
      const after = (await getById(input.employeeId, connection))!;
      const changed = diff(before as unknown as Record<string, unknown>, {
        status: after.status,
        probationEndDate: after.probationEndDate,
        gradeId: after.gradeId,
        lastWorkingDay: after.lastWorkingDay,
        active: after.active,
      });
      await service.appendHistory(
        {
          employeeId: input.employeeId,
          kind: input.kind,
          before: changed.before,
          after: changed.after,
          effectiveAt: input.effectiveAt,
          note: input.note ?? null,
        },
        origin,
        connection,
      );
      await deps.audit().record(
        {
          actorId: origin.actorId,
          action: 'employee.status',
          targetType: 'employees',
          targetId: input.employeeId,
          before: changed.before,
          after: changed.after,
          reason: origin.sourceApplication ?? input.note ?? null,
        },
        connection,
      );
      if ('active' in changed.after)
        notifyAfterCommit(
          connection,
          await affectedUsers(before, after, connection),
        );
      return after;
    },

    async appendCompensation(input, origin, connection) {
      const amount = String(input.baseSalary).trim();
      if (!/^\d{1,12}(\.\d{1,2})?$/u.test(amount))
        throw new EmployeeError(
          'EMPLOYEE_INVALID_AMOUNT',
          'The base salary must be a non-negative amount with at most two decimals.',
        );
      const run = async (
        tx: DatabaseConnection,
      ): Promise<EmployeeCompensation> => {
        if (!(await getById(input.employeeId, tx)))
          throw new EmployeeError(
            'EMPLOYEE_NOT_FOUND',
            `Employee ${input.employeeId} does not exist.`,
          );
        const result = await tx.repository('employeeCompensation').createOne({
          values: {
            employeeId: input.employeeId,
            gradeId: input.gradeId ?? null,
            baseSalary: amount,
            effectiveFrom: input.effectiveFrom,
            sourceApplication: origin.sourceApplication ?? null,
            note: input.note ?? null,
            createdById: origin.actorId,
            createdAt: new Date(),
          },
        });
        const record = toCompensation(result.record);
        // The amount stays out of the audit log, which administrators read; the row itself is the record.
        await deps.audit().record(
          {
            actorId: origin.actorId,
            action: 'employeeCompensation.append',
            targetType: 'employees',
            targetId: input.employeeId,
            after: {
              compensationId: record.id,
              gradeId: record.gradeId,
              effectiveFrom: record.effectiveFrom,
            },
            reason: origin.sourceApplication ?? null,
          },
          tx,
        );
        return record;
      };
      return connection ? run(connection) : database.transaction(run);
    },

    async appendHistory(input, origin, connection) {
      if (containsSalary(input.before) || containsSalary(input.after))
        throw new EmployeeError(
          'EMPLOYEE_HISTORY_SALARY',
          'Salary amounts belong in compensation rows, not in employee history.',
        );
      const run = async (
        tx: DatabaseConnection,
      ): Promise<EmployeeHistoryEntry> => {
        const result = await tx.repository('employeeHistory').createOne({
          values: {
            employeeId: input.employeeId,
            kind: input.kind,
            before: input.before ?? null,
            after: input.after ?? null,
            effectiveAt: input.effectiveAt,
            sourceApplication: origin.sourceApplication ?? null,
            note: input.note ?? null,
            createdById: origin.actorId,
            createdAt: new Date(),
          },
        });
        const record = toHistory(result.record);
        await deps.audit().record(
          {
            actorId: origin.actorId,
            action: 'employeeHistory.append',
            targetType: 'employees',
            targetId: input.employeeId,
            after: { historyId: record.id, kind: record.kind },
            reason: origin.sourceApplication ?? input.note ?? null,
          },
          tx,
        );
        return record;
      };
      return connection ? run(connection) : database.transaction(run);
    },

    // ---- archive (HR) ---------------------------------------------------------------------------------------

    async exists(id) {
      return Boolean(
        await database
          .query()
          .selectFrom('employees')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    },

    async listEmployees(query, policy) {
      const repository = database.repository('employees').withPolicy(policy);
      let userFilter: string[] | undefined;
      if (query.departmentId) {
        const candidates = await repository.findMany({
          select: (s) => s.fields('id', 'userId'),
        });
        userFilter = await userIdsInDepartment(
          query.departmentId,
          candidates.map((row) => str(row.userId)),
        );
        if (!userFilter.length) return { items: [], total: 0 };
      }
      const filter = (f: FilterBuilder<RepositoryRecord>): FilterNode =>
        f.and([
          ...(query.q
            ? [
                f.or([
                  f.string('name').includes(query.q, { mode: 'insensitive' }),
                  f.string('code').includes(query.q, { mode: 'insensitive' }),
                ]),
              ]
            : []),
          ...(query.status ? [f.string('status').eq(query.status)] : []),
          ...(query.active === undefined
            ? []
            : [
                query.active
                  ? f.boolean('active').isTrue()
                  : f.boolean('active').isFalse(),
              ]),
          ...(userFilter ? [anyEq(f, 'userId', userFilter)] : []),
        ]);
      const [rows, total] = await Promise.all([
        repository.findMany({
          filter,
          sort: (s) => {
            const order = query.orderBy ?? { field: 'updatedAt', desc: true };
            const field = s.field(order.field);
            return [
              order.desc ? field.desc() : field.asc(),
              s.field('id').asc(),
            ];
          },
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
        repository.count({ filter }),
      ]);
      return { items: await views(rows.map(toEmployee)), total };
    },

    async getEmployeeView(id, policy) {
      const row = await database
        .repository('employees')
        .withPolicy(policy)
        .findOne({ filter: { id } });
      if (!row) return undefined;
      const [view] = await views([toEmployee(row)]);
      return view;
    },

    async getOwnView(userId) {
      const employee = await getByUserId(userId);
      if (!employee) return undefined;
      const [view] = await views([employee]);
      return view;
    },

    validateCareerDates: validateCareerDate,

    async createEmployee(input, policy, actorId, options) {
      const id = deps.ids().generateString();
      await administrativeWrite(
        input.userId,
        conn(options?.connection),
        async (connection) => {
          await lockUserForAdministration(connection, input.userId);
          await validateReferences(input, id, connection);
          validateCareerDate({
            careerStartDate: input.careerStartDate ?? null,
            hireDate: input.hireDate ?? null,
          });
          const now = new Date();
          const values: RepositoryRecord = {
            id,
            userId: input.userId,
            code: input.code,
            name: input.name,
            status: input.status,
            active: true,
            createdAt: now,
            updatedAt: now,
          };
          for (const field of EMPLOYEE_EDITABLE_FIELDS)
            if (input[field] !== undefined) values[field] = input[field];
          await connection
            .repository('employees')
            .withPolicy(policy)
            .createOne({ values });
          // Every archive has its controlled profile row, so reads never have to tell "empty" from "hidden".
          await connection.repository('employeeProfiles').createOne({
            values: { employeeId: id, updatedAt: now },
          });
          const created = (await getById(id, connection))!;
          await deps.audit().record(
            {
              actorId,
              action: 'employee.create',
              targetType: 'employees',
              targetId: id,
              after: created,
              reason: options?.reason ?? null,
            },
            connection,
          );
          notifyAfterCommit(
            connection,
            await affectedUsers(undefined, created, connection),
          );
        },
      );
      const [view] = await views(
        [(await getById(id, options?.connection))!],
        options?.connection,
      );
      return view;
    },

    async updateEmployee(id, input, policy, actorId, options) {
      await administrativeWrite(
        (await getById(id, options?.connection))?.userId,
        conn(options?.connection),
        async (connection) => {
          const scoped = connection.repository('employees').withPolicy(policy);
          const visible = await scoped.findOne({
            filter: { id },
            select: (s) => s.fields('id'),
          });
          if (!visible)
            throw new EmployeeError(
              'EMPLOYEE_NOT_FOUND',
              `Employee ${id} does not exist.`,
            );
          const discovered = (await getById(id, connection))!;
          // Date constraints span fields, so serialise edits before reading the baseline used for validation.
          await lockUserForAdministration(connection, discovered.userId);
          const before = (await getById(id, connection))!;
          await validateReferences(input, id, connection);
          validateCareerDate({
            careerStartDate:
              input.careerStartDate === undefined
                ? before.careerStartDate
                : input.careerStartDate,
            hireDate:
              input.hireDate === undefined ? before.hireDate : input.hireDate,
          });
          const values: RepositoryRecord = { updatedAt: new Date() };
          for (const field of EMPLOYEE_EDITABLE_FIELDS)
            if (input[field] !== undefined) values[field] = input[field];
          await scoped.updateOne({ filter: { id }, values });
          const after = (await getById(id, connection))!;
          const changed = diff(
            before as unknown as Record<string, unknown>,
            Object.fromEntries(
              EMPLOYEE_EDITABLE_FIELDS.map((field) => [field, after[field]]),
            ),
          );
          if (Object.keys(changed.after).length)
            await deps.audit().record(
              {
                actorId,
                action: 'employee.update',
                targetType: 'employees',
                targetId: id,
                before: changed.before,
                after: changed.after,
                reason: options?.reason ?? null,
              },
              connection,
            );
          if ('managerId' in changed.after || 'positionId' in changed.after)
            notifyAfterCommit(
              connection,
              await affectedUsers(before, after, connection),
            );
        },
      );
      const [view] = await views(
        [(await getById(id, options?.connection))!],
        options?.connection,
      );
      return view;
    },

    async correctStatus(id, input, policy, actorId, options) {
      await administrativeWrite(
        (await getById(id, options?.connection))?.userId,
        conn(options?.connection),
        async (connection) => {
          const scoped = connection.repository('employees').withPolicy(policy);
          const visible = await scoped.findOne({
            filter: { id },
            select: (s) => s.fields('id'),
          });
          if (!visible)
            throw new EmployeeError(
              'EMPLOYEE_NOT_FOUND',
              `Employee ${id} does not exist.`,
            );
          const before = (await getById(id, connection))!;
          const values: RepositoryRecord = {
            status: input.status,
            updatedAt: new Date(),
          };
          if (input.lastWorkingDay !== undefined)
            values.lastWorkingDay = input.lastWorkingDay;
          if (input.active !== undefined) values.active = input.active;
          const changed = diff(before as unknown as Record<string, unknown>, {
            status: input.status,
            ...(input.lastWorkingDay !== undefined
              ? { lastWorkingDay: input.lastWorkingDay }
              : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          });
          if (!Object.keys(changed.after).length)
            throw new EmployeeError(
              'EMPLOYEE_STATUS_UNCHANGED',
              'The correction changes nothing.',
            );
          await scoped.updateOne({ filter: { id }, values });
          await connection.repository('employeeHistory').createOne({
            values: {
              employeeId: id,
              kind: 'correction',
              before: changed.before,
              after: changed.after,
              effectiveAt: new Date().toISOString().slice(0, 10),
              note: input.reason,
              createdById: actorId,
              createdAt: new Date(),
            },
          });
          await deps.audit().record(
            {
              actorId,
              action: 'employee.correctStatus',
              targetType: 'employees',
              targetId: id,
              before: changed.before,
              after: changed.after,
              reason: input.reason,
            },
            connection,
          );
          // Data corrections restoring a leaving employee must invalidate future replacement claims,
          // just like the business cancellation exit; a later leaving status must not revive old approval.
          if (
            before.status === 'leaving' &&
            (input.status === 'regular' || input.status === 'probation')
          ) {
            await deps.headcounts?.()?.invalidateReplacements(
              {
                actorId,
                employeeId: id,
                requestKey: `employee-correction:${deps.ids().generateString()}`,
                reason: input.reason,
              },
              connection,
            );
          }
          if ('active' in changed.after) {
            const after = (await getById(id, connection))!;
            notifyAfterCommit(
              connection,
              await affectedUsers(before, after, connection),
            );
          }
        },
      );
      const [view] = await views(
        [(await getById(id, options?.connection))!],
        options?.connection,
      );
      return view;
    },

    async getProfile(employeeId, policy) {
      const repository =
        policy === TRUSTED
          ? database.repository('employeeProfiles')
          : database.repository('employeeProfiles').withPolicy(policy);
      const row = await repository.findOne({ filter: { employeeId } });
      return row ? toProfile(row) : undefined;
    },

    async updateProfile(employeeId, input, policy, actorId) {
      await database.transaction(async (connection) => {
        const scoped = connection
          .repository('employeeProfiles')
          .withPolicy(policy);
        const visible = await scoped.findOne({
          filter: { employeeId },
          select: (s) => s.fields('employeeId'),
        });
        if (!visible)
          throw new EmployeeError(
            'EMPLOYEE_NOT_FOUND',
            `Employee ${employeeId} does not exist.`,
          );
        const beforeRow = await connection
          .repository('employeeProfiles')
          .findOne({ filter: { employeeId } });
        const before = beforeRow ? toProfile(beforeRow) : {};
        const values: RepositoryRecord = { updatedAt: new Date() };
        for (const field of PROFILE_EDITABLE_FIELDS)
          if (input[field] !== undefined) values[field] = input[field];
        await scoped.updateOne({ filter: { employeeId }, values });
        const changed = diff(
          before,
          Object.fromEntries(
            PROFILE_EDITABLE_FIELDS.filter(
              (field) => input[field] !== undefined,
            ).map((field) => [field, input[field] ?? null]),
          ),
          MASKED_PROFILE_FIELDS,
        );
        if (Object.keys(changed.after).length)
          await deps.audit().record(
            {
              actorId,
              action: 'employeeProfile.update',
              targetType: 'employees',
              targetId: employeeId,
              before: changed.before,
              after: changed.after,
            },
            connection,
          );
      });
      return (await service.getProfile(employeeId, TRUSTED)) ?? {};
    },

    async listCompensation(employeeId, policy) {
      const repository =
        policy === TRUSTED
          ? database.repository('employeeCompensation')
          : database.repository('employeeCompensation').withPolicy(policy);
      const rows = await repository.findMany({
        filter: { employeeId },
        sort: (s) => [s.field('effectiveFrom').desc(), s.field('id').desc()],
      });
      return rows.map(toCompensation);
    },

    async listHistory(employeeId) {
      const rows = await database.repository('employeeHistory').findMany({
        filter: { employeeId },
        sort: (s) => [s.field('effectiveAt').desc(), s.field('id').desc()],
      });
      return rows.map(toHistory);
    },

    async listDirectory(query, policy, contactPolicy) {
      const repository = database.repository('employees').withPolicy(policy);
      let userFilter: string[] | undefined;
      if (query.departmentId) {
        const candidates = await repository.findMany({
          filter: (f) => f.boolean('active').isTrue(),
          select: (s) => s.fields('id', 'userId'),
        });
        userFilter = await userIdsInDepartment(
          query.departmentId,
          candidates.map((row) => str(row.userId)),
        );
        if (!userFilter.length) return { items: [], total: 0 };
      }
      const filter = (f: FilterBuilder<RepositoryRecord>): FilterNode =>
        f.and([
          f.boolean('active').isTrue(),
          ...(query.q
            ? [
                f.or([
                  f.string('name').includes(query.q, { mode: 'insensitive' }),
                  f.string('code').includes(query.q, { mode: 'insensitive' }),
                ]),
              ]
            : []),
          ...(userFilter ? [anyEq(f, 'userId', userFilter)] : []),
        ]);
      const [rows, total] = await Promise.all([
        repository.findMany({
          filter,
          select: (s) => s.fields(...DIRECTORY_FIELDS),
          sort: (s) => [s.field('name').asc(), s.field('id').asc()],
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
        repository.count({ filter }),
      ]);
      const ids = rows.map((row) => str(row.id));
      const contacts = new Map<
        string,
        { phone: string | null; email: string | null }
      >();
      if (contactPolicy && ids.length) {
        const visible = await database
          .repository('employees')
          .withPolicy(contactPolicy)
          .findMany({
            filter: (f) => anyEq(f, 'id', ids),
            select: (s) => s.fields(...CONTACT_FIELDS),
          });
        for (const row of visible)
          contacts.set(str(row.id), {
            phone: text(row.phone),
            email: text(row.email),
          });
      }
      const enriched = await views(rows.map(toEmployee));
      return {
        items: enriched.map((view) => ({
          id: view.id,
          userId: view.userId!,
          user: view.user ? { id: view.user.id, name: view.user.name } : null,
          code: view.code!,
          name: view.name!,
          manager: view.manager,
          primaryDepartment: view.primaryDepartment,
          position: view.position,
          workLocation: view.workLocation ?? null,
          ...(contacts.get(view.id) ?? {}),
        })),
        total,
      };
    },
  };
  return service;
}
