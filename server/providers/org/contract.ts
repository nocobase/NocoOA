import type { DatabaseConnection } from '@nocobase/db';
import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

/**
 * The organisation contract other OA modules code against (employees, directory, approval resolution).
 *
 * The `org` module owns the implementation in `server/providers/org/` and may add methods, but must not change or
 * remove these. Every read takes an optional connection so it can run inside the caller's transaction.
 */

export interface Department {
  id: string;
  title: string;
  code: string | null;
  parentId: string | null;
  /** Department head (user id); need not be a member. */
  managerId: string | null;
  /** Executive in charge (user id); filled on first-level departments only. */
  executiveId: string | null;
  active: boolean;
  sortOrder: number;
}

export interface Position {
  id: string;
  code: string;
  title: string;
  active: boolean;
}

export interface Grade {
  id: string;
  code: string;
  title: string;
  /** Comparable level; higher is more senior. */
  rank: number;
  active: boolean;
}

export interface DutyRole {
  /** Stable code from the plan (`gm`, `finance`, `cashier`, `hr`, …). */
  code: string;
  title: string;
  active: boolean;
}

export interface OrgService {
  /** The user's active primary department, counting only when it and every ancestor are active. */
  primaryDepartmentOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<Department | undefined>;
  /** Batch form of `primaryDepartmentOf`, keyed by user id; users without one are absent. */
  primaryDepartmentsOf(
    userIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<ReadonlyMap<string, Department>>;
  /** The department and its ancestors, nearest first; `undefined` when any is inactive or missing. */
  activeChain(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly Department[] | undefined>;
  activeChainsOf(
    departmentIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<ReadonlyMap<string, readonly Department[] | undefined>>;
  /** The department's id plus every active descendant id. */
  subtreeIds(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Head of the department, walking up the ancestor chain when the department has none. */
  headOf(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<string | undefined>;
  /** First non-empty `executiveId` on the ancestor chain, starting at the department itself. */
  executiveOf(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<string | undefined>;
  /** User ids of active members of an active duty role. */
  dutyRoleMembers(
    code: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Batch equivalent; inactive roles/members remain excluded. */
  dutyRoleMembersByCodes(
    codes: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<ReadonlyMap<string, readonly string[]>>;
  hasDutyRole(
    userId: string,
    code: string,
    connection?: DatabaseConnection,
  ): Promise<boolean>;
  listPositions(connection?: DatabaseConnection): Promise<readonly Position[]>;
  listGrades(connection?: DatabaseConnection): Promise<readonly Grade[]>;
}

export const orgServiceToken: ServiceToken<OrgService> =
  createServiceToken<OrgService>('oa/org-service');
