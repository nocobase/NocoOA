// @vitest-environment node
import { expect } from 'vitest';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { createEmployeesAppTest, createEmployee } from './employees/helpers.js';
import {
  requestUserSummary,
  withRequestUserSummaries,
} from '../../server/providers/request-performance/user-summaries.js';
import { withBusinessReads } from '../../server/providers/request-performance/business-reads.js';
import { employeeServiceToken } from '../../server/providers/employees/contract.js';

const test = createEmployeesAppTest();
test('batched summaries preserve disabled people, service accounts and missing identities on PostgreSQL', async ({
  testApp,
}) => {
  const users = testApp.application.container.resolve(
    userAdministrationServiceToken,
  );
  const person = await createEmployee(testApp, 'Summary display');
  const service = await users.createServiceAccount({ name: 'Summary service' });
  await users.disable(person.userId);
  const ids = [person.userId, service.id, 'missing-user'];
  const expected = await Promise.all(
    ids.map(async (id) => {
      const user = await users.get(id);
      return user ? { id: user.id, name: user.name } : undefined;
    }),
  );
  expect(
    await withRequestUserSummaries(() =>
      Promise.all(ids.map((id) => requestUserSummary(users, id))),
    ),
  ).toEqual(expected);
  await users.update(person.userId, { name: 'Summary renamed' });
  expect(
    (
      await withRequestUserSummaries(() =>
        requestUserSummary(users, person.userId),
      )
    )?.name,
  ).toBe('Summary renamed');
  const employees = testApp.application.container.resolve(employeeServiceToken);
  const root = testApp.database.connection();
  await withBusinessReads(async () => {
    expect((await employees.getByUserId(person.userId, root))?.active).toBe(
      true,
    );
    await root.transaction(async (tx) => {
      await tx.repository('employees').updateOne({
        filter: { id: person.employeeId },
        values: { active: false },
      });
      expect((await employees.getByUserId(person.userId, tx))?.active).toBe(
        false,
      );
    });
    expect((await employees.getByUserId(person.userId, root))?.active).toBe(
      true,
    );
  });
  expect((await employees.getByUserId(person.userId, root))?.active).toBe(
    false,
  );
});
