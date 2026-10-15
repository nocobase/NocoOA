import { ServiceProvider } from '@nocobase/service-provider';
import type { Application } from '@nocobase/app-server/application';
import { databaseManagerToken } from '@nocobase/db';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { ApprovalQuery } from '@nocobase/app-plugin-approval/server';
import type { ScheduleExecutor } from '@nocobase/jobs';
import { processOwners } from '../process-management/owners.js';
import {
  approvalQuerySources,
  initializeApprovalQuery,
} from './query-service.js';
import {
  approvalQueryToken,
  approvalStatisticsChangesToken,
} from './statistics-contract.js';
import { ApprovalStatisticsChangeService } from './statistics-changes.js';
import { installDelegationWriteBoundary } from './dependency-write-boundary.js';

export * from './statistics-contract.js';

export default class ApprovalQueryProvider extends ServiceProvider<Application> {
  readonly name = 'oa/approval-query';
  private readonly disposers: (() => void)[] = [];
  private readonly query = new ApprovalQuery();
  private changes?: ApprovalStatisticsChangeService;
  private schedule?: ScheduleExecutor;
  override register() {
    this.app.container.instance(approvalQueryToken, this.query);
    this.app.container.singleton(
      approvalStatisticsChangesToken,
      (container) => {
        this.changes = new ApprovalStatisticsChangeService(
          container.resolve(databaseManagerToken),
          this.query,
        );
        return this.changes;
      },
    );
  }
  override async start() {
    const db = this.app.container.resolve(databaseManagerToken);
    this.app.container.resolve(approvalStatisticsChangesToken);
    for (const owner of processOwners) {
      if (!(await db.connection().collections.get(owner.collection))) continue;
      const sdk = await owner.sdk(this.app);
      const dispose = await initializeApprovalQuery(sdk.approvals, this.query);
      if (dispose) this.disposers.push(dispose);
      for (const source of approvalQuerySources(sdk.approvals))
        this.changes!.register(source);
    }
    await this.query.initialize();
    this.changes!.activate();
    for (const owner of processOwners) {
      if (!['oa.leave', 'oa.leaveCancellation'].includes(owner.kind)) continue;
      if (!(await db.connection().collections.get(owner.collection))) continue;
      const sdk = await owner.sdk(this.app);
      this.disposers.push(
        installDelegationWriteBoundary(
          sdk.runtime,
          sdk.approvals,
          this.changes!,
        ),
      );
    }
    // These are known business time events, not a periodic statistics repair.
    this.schedule = this.app.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor('oa-approval-statistics-time');
    await this.schedule.addJob({
      name: 'dispatch-time-changes',
      options: { every: 1000 },
      payload: {},
      execute: async ({ signal }) => {
        await this.changes!.processDue({ signal });
      },
    });
    await this.schedule.setup();
  }
  override async shutdown() {
    await this.schedule?.shutdown();
    this.changes?.deactivate();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.query.dispose();
  }
}
