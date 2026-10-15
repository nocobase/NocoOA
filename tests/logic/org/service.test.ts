// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgError } from '../../../server/providers/org/index.ts';
import { startOrgTestApp, type OrgTestApp } from './helpers.ts';
import { withBusinessReads } from '../../../server/providers/request-performance/business-reads.js';

const ctx = { actorId: 'tester' };

async function auditActions(test: OrgTestApp, targetId: string) {
  const rows = await test.testApp.database
    .query()
    .selectFrom('auditLogs')
    .select(['action', 'actorId'])
    .where('targetId', '=', targetId)
    .orderBy('id', 'asc')
    .execute();
  return rows.map((row) => String(row.action));
}

describe('organisation service rules', () => {
  let test: OrgTestApp;
  let alice: string;
  let bob: string;
  let carol: string;

  it('shares organisation facts on explicit root reads but observes transactional changes', async () => {
    const org = test.organization;
    const connection = test.testApp.database.connection();
    const client = await connection.client();
    const counts = new Map<string, number>();
    const count = (query: { sql: string }) => {
      const table = query.sql.match(
        /from\s+(?:"public"\.)?"(departments|positions|duty_roles|duty_role_members|department_members)"/i,
      )?.[1];
      if (table) counts.set(table, (counts.get(table) ?? 0) + 1);
    };
    client.on('query', count);
    try {
      await withBusinessReads(async () => {
        await Promise.all(
          Array.from({ length: 4 }, async () => {
            await org.departmentsOf(alice, connection);
            await org.headedBy(alice, connection);
            await org.listPositions(connection);
            await org.hasDutyRole(alice, 'admin', connection);
            await org.hasDutyRole(alice, 'hr', connection);
          }),
        );
      });
      expect(counts.get('departments')).toBe(1);
      expect(counts.get('positions')).toBe(1);
      expect(counts.get('department_members')).toBe(1);
      expect(counts.get('duty_role_members')).toBe(1);
    } finally {
      client.removeListener('query', count);
    }
    const createdId = await withBusinessReads(async () => {
      await org.listPositions(connection);
      const id = await connection.transaction(async (tx) => {
        const position = await org.createPosition(
          { title: 'Transactional read', code: `tx-${Date.now()}` },
          ctx,
          tx,
        );
        expect(
          (await org.listPositions(tx)).some((row) => row.id === position.id),
        ).toBe(true);
        return position.id;
      });
      expect(
        (await org.listPositions(connection)).some((row) => row.id === id),
      ).toBe(false);
      return id;
    });
    expect(
      (await org.listPositions(connection)).some((row) => row.id === createdId),
    ).toBe(true);
  });

  beforeAll(async () => {
    test = await startOrgTestApp();
    alice = (await test.createUser('Alice')).user.id;
    bob = (await test.createUser('Bob')).user.id;
    carol = (await test.createUser('Carol')).user.id;
  }, 120_000);

  afterAll(async () => {
    await test?.close();
  });

  it('builds a tree, rejects cycles and records audit in the same write', async () => {
    const org = test.organization;
    const root = await org.createDepartment(
      { title: 'Company', code: 'HQ', executiveId: alice },
      ctx,
    );
    const child = await org.createDepartment(
      { title: 'R&D', parentId: root.id },
      ctx,
    );
    const grandchild = await org.createDepartment(
      { title: 'Platform', parentId: child.id },
      ctx,
    );
    expect(await auditActions(test, root.id)).toEqual(['department.create']);

    await expect(
      org.updateDepartment(root.id, { parentId: grandchild.id }, ctx),
    ).rejects.toMatchObject({ code: 'PARENT_CYCLE' });
    await expect(
      org.updateDepartment(root.id, { parentId: root.id }, ctx),
    ).rejects.toMatchObject({ code: 'PARENT_CYCLE' });
    await expect(
      org.createDepartment({ title: 'X', parentId: 'missing' }, ctx),
    ).rejects.toMatchObject({ code: 'PARENT_NOT_FOUND' });
    await expect(
      org.createDepartment({ title: 'Dup', code: 'HQ' }, ctx),
    ).rejects.toMatchObject({ code: 'DEPARTMENT_CODE_EXISTS' });
    await expect(
      org.createDepartment({ title: 'Ghost head', managerId: 'nobody' }, ctx),
    ).rejects.toBeInstanceOf(OrgError);

    // A failed write leaves no audit entry behind.
    expect(await auditActions(test, root.id)).toEqual(['department.create']);

    // Moving the grandchild to the top is fine and audited as a move.
    await org.updateDepartment(grandchild.id, { parentId: null }, ctx);
    expect(await auditActions(test, grandchild.id)).toEqual([
      'department.create',
      'department.move',
    ]);
    await org.updateDepartment(grandchild.id, { parentId: child.id }, ctx);
  });

  it('walks up for the head and the executive', async () => {
    const org = test.organization;
    const top = await org.createDepartment(
      { title: 'Sales', executiveId: alice, managerId: bob },
      ctx,
    );
    const mid = await org.createDepartment(
      { title: 'North', parentId: top.id },
      ctx,
    );
    const leaf = await org.createDepartment(
      { title: 'North-1', parentId: mid.id, managerId: carol },
      ctx,
    );
    expect(await org.headOf(leaf.id)).toBe(carol);
    expect(await org.headOf(mid.id)).toBe(bob);
    expect(await org.executiveOf(leaf.id)).toBe(alice);
    await expect(
      org.updateDepartment(mid.id, { executiveId: carol }, ctx),
    ).rejects.toMatchObject({
      code: 'EXECUTIVE_TOP_LEVEL_ONLY',
      field: 'executiveId',
    });
    expect(await org.executiveOf(leaf.id)).toBe(alice);
    expect(await org.executiveOf(top.id)).toBe(alice);
    expect(await org.headOf('missing')).toBeUndefined();
  });

  it('restricts executives to top-level departments and rolls back invalid moves', async () => {
    const org = test.organization;
    const parent = await org.createDepartment(
      { title: 'Executive parent' },
      ctx,
    );
    await expect(
      org.createDepartment(
        { title: 'Invalid child', parentId: parent.id, executiveId: alice },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTIVE_TOP_LEVEL_ONLY' });
    const top = await org.createDepartment(
      { title: 'Executive top', executiveId: alice },
      ctx,
    );
    await expect(
      org.updateDepartment(top.id, { parentId: parent.id }, ctx),
    ).rejects.toMatchObject({ code: 'EXECUTIVE_TOP_LEVEL_ONLY' });
    expect((await org.getDepartment(top.id))?.parentId).toBeNull();
    expect(await auditActions(test, top.id)).toEqual(['department.create']);
    await org.updateDepartment(
      top.id,
      { parentId: parent.id, executiveId: null },
      ctx,
    );
    expect((await org.getDepartment(top.id))?.executiveId).toBeNull();
    await org.updateDepartment(
      top.id,
      { parentId: null, executiveId: bob },
      ctx,
    );
    expect(await org.executiveOf(top.id)).toBe(bob);
  });

  it('keeps one active primary membership per user', async () => {
    const org = test.organization;
    const a = await org.createDepartment({ title: 'Primary A' }, ctx);
    const b = await org.createDepartment({ title: 'Primary B' }, ctx);
    const user = (await test.createUser('Primary')).user.id;

    await org.addMember({ departmentId: a.id, userId: user }, ctx);
    // The first membership becomes primary on its own; the second does not.
    await org.addMember({ departmentId: b.id, userId: user }, ctx);
    expect(await org.membershipsOf(user)).toEqual([
      { departmentId: a.id, primary: true },
      { departmentId: b.id, primary: false },
    ]);
    expect((await org.primaryDepartmentOf(user))?.id).toBe(a.id);

    await org.setPrimary(b.id, user, ctx);
    const after = await org.membershipsOf(user);
    expect(after.filter((row) => row.primary)).toEqual([
      { departmentId: b.id, primary: true },
    ]);

    // Adding with `primary: true` clears the other primary flag too.
    await org.addMember(
      { departmentId: a.id, userId: user, primary: true },
      ctx,
    );
    expect(
      (await org.membershipsOf(user)).filter((row) => row.primary),
    ).toEqual([{ departmentId: a.id, primary: true }]);

    await org.removeMember(a.id, user, ctx);
    expect(await org.primaryDepartmentOf(user)).toBeUndefined();
    await expect(org.removeMember(a.id, user, ctx)).rejects.toMatchObject({
      code: 'MEMBER_NOT_FOUND',
    });
    expect((await org.primaryDepartmentsOf([user, 'nobody'])).size).toBe(0);
    await expect(
      org.addMember({ departmentId: a.id, userId: 'nobody' }, ctx),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('disables a whole subtree through its parent without rewriting children', async () => {
    const org = test.organization;
    const parent = await org.createDepartment({ title: 'Ops' }, ctx);
    const child = await org.createDepartment(
      { title: 'Ops-1', parentId: parent.id },
      ctx,
    );
    const user = (await test.createUser('Subtree')).user.id;
    await org.addMember({ departmentId: child.id, userId: user }, ctx);
    expect(await org.departmentsOf(user)).toEqual(
      expect.arrayContaining([child.id, parent.id]),
    );
    expect(await org.subtreeIds(parent.id)).toEqual([parent.id, child.id]);

    await org.setDepartmentActive(parent.id, false, ctx);
    expect((await org.getDepartment(child.id))?.active).toBe(true);
    expect(await org.departmentsOf(user)).toEqual([]);
    expect(await org.activeChain(child.id)).toBeUndefined();
    expect(
      (await org.activeChainsOf([child.id, 'missing'])).get(child.id),
    ).toBeUndefined();
    expect(await org.primaryDepartmentOf(user)).toBeUndefined();
    expect(await org.filterActive([parent.id, child.id])).toEqual([]);

    await org.setDepartmentActive(parent.id, true, ctx);
    expect((await org.activeChain(child.id))?.map((node) => node.id)).toEqual([
      child.id,
      parent.id,
    ]);
    const chains = await org.activeChainsOf([
      child.id,
      parent.id,
      child.id,
      'missing',
    ]);
    expect(chains.size).toBe(3);
    expect(chains.get(child.id)).toEqual(await org.activeChain(child.id));
    expect(chains.get(parent.id)).toEqual(await org.activeChain(parent.id));
    expect(chains.get('missing')).toBeUndefined();
    expect(await auditActions(test, parent.id)).toEqual([
      'department.create',
      'department.disable',
      'department.enable',
    ]);
  });

  it('runs inside a caller transaction and rolls back with it', async () => {
    const org = test.organization;
    const before = (await org.listTree()).length;
    await expect(
      test.testApp.database.transaction(async (connection) => {
        await org.createDepartment(
          { title: 'Rolled back' },
          { actorId: 'tester', connection },
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect((await org.listTree()).length).toBe(before);
  });

  it('keeps positions and grades unique by code', async () => {
    const org = test.organization;
    const position = await org.createPosition(
      { code: 'BUYER', title: 'Buyer' },
      ctx,
    );
    await expect(
      org.createPosition({ code: 'BUYER', title: 'Other' }, ctx),
    ).rejects.toMatchObject({ code: 'POSITION_CODE_EXISTS' });
    await org.setPositionActive(position.id, false, ctx);
    expect(
      (await org.listPositions()).find((row) => row.id === position.id)?.active,
    ).toBe(false);

    await org.createGrade({ code: 'P5', title: 'P5', rank: 50 }, ctx);
    const m2 = await org.createGrade(
      { code: 'M2', title: 'M2', rank: 80 },
      ctx,
    );
    await expect(
      org.updateGrade(m2.id, { code: 'P5' }, ctx),
    ).rejects.toMatchObject({ code: 'GRADE_CODE_EXISTS' });
    const updated = await org.updateGrade(m2.id, { rank: 90 }, ctx);
    expect(updated.rank).toBe(90);
    expect((await org.listGrades()).map((grade) => grade.code)).toEqual([
      'P5',
      'M2',
    ]);
  });

  it('seeds the duty roles and resolves their members', async () => {
    const org = test.organization;
    const roles = await org.listDutyRoles();
    expect(roles.map((role) => role.code)).toEqual([
      'gm',
      'cfo',
      'hr',
      'hrbp',
      'hrDirector',
      'admin',
      'sealKeeper',
      'finance',
      'financeManager',
      'cashier',
      'legal',
      'purchasing',
      'it',
      'committeeTech',
    ]);
    expect(roles[0]?.title).toEqual({
      key: 'org.dutyRoleTitles.gm',
      ns: 'nb3-oa',
    });

    await org.addDutyRoleMember('cashier', alice, ctx);
    await org.addDutyRoleMember('cashier', bob, ctx);
    expect(await org.dutyRoleMembers('cashier')).toEqual([alice, bob].sort());
    expect(
      (await org.dutyRoleMembersByCodes(['cashier', 'missing'])).get('cashier'),
    ).toEqual([alice, bob].sort());
    expect(
      (await org.dutyRoleMembersByCodes(['cashier', 'missing'])).get('missing'),
    ).toEqual([]);
    expect(await org.hasDutyRole(alice, 'cashier')).toBe(true);

    await org.removeDutyRoleMember('cashier', bob, ctx);
    expect(await org.dutyRoleMembers('cashier')).toEqual([alice]);

    await org.setDutyRoleActive('cashier', false, ctx);
    expect(await org.dutyRoleMembers('cashier')).toEqual([]);
    expect(
      (await org.dutyRoleMembersByCodes(['cashier'])).get('cashier'),
    ).toEqual([]);
    expect(await org.hasDutyRole(alice, 'cashier')).toBe(false);
    expect(await org.listDutyRoleMembers('cashier')).toEqual([alice]);
    await org.setDutyRoleActive('cashier', true, ctx);
    expect(await org.dutyRolesOf(alice)).toEqual(['cashier']);

    await expect(
      org.addDutyRoleMember('nope', alice, ctx),
    ).rejects.toMatchObject({ code: 'DUTY_ROLE_NOT_FOUND' });
    expect(await auditActions(test, `cashier:${bob}`)).toEqual([
      'dutyRoleMember.add',
      'dutyRoleMember.remove',
    ]);

    // The picker searches seeded titles in every shipped language.
    const zh = await org.listDutyRoleOptions({
      search: '出纳',
      page: 1,
      pageSize: 20,
    });
    expect(zh.items.map((item) => item.id)).toEqual(['cashier']);
    const en = await org.listDutyRoleOptions({
      search: 'cashier',
      page: 1,
      pageSize: 20,
    });
    expect(en.items.map((item) => item.id)).toEqual(['cashier']);
  });
});
