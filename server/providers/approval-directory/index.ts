import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { idGeneratorToken } from '@nocobase/app-server/id-generator';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';
import { auditServiceToken } from '../audit/index.js';
import { employeeServiceToken } from '../employees/contract.js';
import { orgServiceToken } from '../org/contract.js';
import {
  approvalDirectoryServiceToken,
  DELEGATION_SETTINGS,
} from './contract.js';
import { createApprovalDirectoryService } from './service.js';
import { approvalStatisticsChangesToken } from '../approval-runtime/statistics-contract.js';
export * from './contract.js';
export { DelegationError } from './errors.js';
export { createApprovalDirectoryService } from './service.js';
export default class ApprovalDirectoryProvider extends ServiceProvider<Application> {
  public readonly name: string = 'oa/approval-directory-provider';
  public override register(): void {
    this.app.container.singleton(approvalDirectoryServiceToken, (container) =>
      createApprovalDirectoryService({
        database: container.resolve(databaseManagerToken),
        users: container.resolve(userAdministrationServiceToken),
        employees: container.resolve(employeeServiceToken),
        org: container.resolve(orgServiceToken),
        audit: container.resolve(auditServiceToken),
        statisticsChanges: () =>
          container.resolve(approvalStatisticsChangesToken),
        authorization: container.has(authorizationToken)
          ? container.resolve(authorizationToken)
          : undefined,
        generateId: () => container.resolve(idGeneratorToken).generateString(),
      }),
    );
  }
  public override async boot(): Promise<void> {
    if (!this.app.container.has(authorizationToken)) return;
    const authz = this.app.container.resolve(authorizationToken);
    const label = (key: string) => ({
      key: `approvals.authz.${key}`,
      ns: 'nb3-oa',
    });
    authz.settings.add({
      id: DELEGATION_SETTINGS,
      title: label('delegations'),
      actions: [
        { name: 'read', title: label('read') },
        { name: 'update', title: label('update') },
      ],
    });
    authz.ui.place(
      { type: 'settings', id: DELEGATION_SETTINGS },
      { section: 'oa.platform' },
    );
  }
}
