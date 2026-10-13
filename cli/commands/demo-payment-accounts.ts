import { AppCommand, CommandError } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
import { databaseManagerToken } from '@nocobase/db';
import {
  employeeModuleService,
  employeeServiceToken,
} from '../../server/providers/employees/index.js';

/** Explicit maintenance operation for a confirmed demo installation only. */
export default class DemoPaymentAccounts extends AppCommand {
  static override summary =
    'Fill missing employee payment fields in a demo database.';
  static override flags = {
    'demo-only': Flags.boolean({
      default: false,
      description:
        'Confirm this database is for demonstration, never real payments.',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Inspect missing fields without writing.',
    }),
  };

  async run(): Promise<unknown> {
    const { flags } = await this.parse(DemoPaymentAccounts);
    if (!flags['demo-only'])
      throw new CommandError('Explicit demo-only confirmation is required.', {
        code: 'DEMO_ONLY_REQUIRED',
      });
    return this.withApp(async ({ app }) => {
      await app.start();
      const db = app.container.resolve(databaseManagerToken);
      const service = employeeModuleService(
        app.container.resolve(employeeServiceToken),
      );
      const users = await db
        .repository('user')
        .findMany({ select: (s) => s.fields('id', 'username') });
      const actor = users.find((row) => row.username === 'trial.system');
      if (!actor)
        throw new Error('Demo administrator trial.system is required.');
      const userIds = new Set(users.map((row) => String(row.id)));
      const employees = await db
        .repository('employees')
        .findMany({ select: (s) => s.fields('id', 'userId') });
      let changed = 0;
      let missingFields = 0;
      let missingProfiles = 0;
      let complete = 0;
      for (const employee of employees) {
        if (!userIds.has(String(employee.userId))) continue;
        const employeeId = String(employee.id);
        const profile = await db
          .repository('employeeProfiles')
          .findOne({ filter: { employeeId } });
        if (!profile) {
          missingProfiles++;
          continue;
        }
        const values: Record<string, string> = {};
        const samples = {
          bankName: '示例银行（不可支付）',
          bankAccount: '0000000000000000',
          bankAccountName: '虚构试用账户',
        };
        for (const [field, value] of Object.entries(samples)) {
          if (profile[field] == null || String(profile[field]).trim() === '')
            values[field] = value;
        }
        if (!Object.keys(values).length) {
          complete++;
          continue;
        }
        missingFields += Object.keys(values).length;
        changed++;
        if (!flags['dry-run']) {
          await service.updateProfile(
            employeeId,
            values,
            { read: true, create: false, update: true, delete: false },
            String(actor.id),
          );
          const account = await app.container
            .resolve(employeeServiceToken)
            .paymentAccountOf(String(employee.userId), db.connection());
          if (
            !account ||
            Object.values(account).some(
              (value) => value == null || String(value).trim() === '',
            )
          )
            throw new Error('Payment account verification failed.');
        }
      }
      return {
        dryRun: flags['dry-run'],
        users: users.length,
        linkedEmployees: employees.filter((e) => userIds.has(String(e.userId)))
          .length,
        changed,
        missingFields,
        alreadyComplete: complete,
        missingProfiles,
        usersWithoutEmployee: users.filter(
          (u) => !employees.some((e) => String(e.userId) === String(u.id)),
        ).length,
      };
    });
  }
}
