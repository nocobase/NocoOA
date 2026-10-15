import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202610140001_approval_statistics_boundaries',
  async up({ builder, query }) {
    await builder.createCollection('oaApprovalStatisticsBoundaries', (c) => {
      c.string('id', { length: 160, nullable: false });
      c.string('dependencyKey', { length: 128, nullable: false });
      c.json('kinds', { nullable: false });
      c.json('userIds', { nullable: false });
      c.string('reason', { length: 128, nullable: false });
      c.datetimeTz('dueAt', { nullable: false });
      c.primary('id');
      c.index(['dueAt', 'id'], {
        name: 'idx_oa_approval_statistics_boundary_due',
      });
      c.index('dependencyKey');
    });
    // Existing active delegations need durable events too. Past edges are kept
    // for catch-up after deployment; recompute always uses current facts/time.
    const delegations = await query
      .selectFrom('approvalDelegations')
      .select(['id', 'principalId', 'delegateId', 'scope', 'from', 'to'])
      .where('active', '=', true)
      .execute();
    for (const entry of delegations) {
      const key = `delegation/${String(entry.id)}`;
      const scope =
        typeof entry.scope === 'string' && entry.scope !== 'all'
          ? (JSON.parse(entry.scope) as unknown)
          : entry.scope;
      for (const [index, at] of [entry.from, entry.to].entries())
        await query
          .insertInto('oaApprovalStatisticsBoundaries')
          .values({
            id: `${key}:${index}`,
            dependencyKey: key,
            kinds: scope,
            userIds: [entry.principalId, entry.delegateId],
            reason: 'delegationTimeChanged',
            dueAt: new Date(String(at)),
          })
          .execute();
    }
  },
  async down({ builder }) {
    await builder.dropCollection('oaApprovalStatisticsBoundaries');
  },
});

export default migration;
