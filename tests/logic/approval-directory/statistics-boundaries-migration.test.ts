// @vitest-environment node
import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

describeMigration('202610140001_approval_statistics_boundaries', {
  sources: [
    {
      packageName: 'oa-statistics-boundaries-test',
      directory: path.resolve(
        import.meta.dirname,
        '../../../database/main/migrations',
      ),
    },
  ],
  before: async ({ connection }) => {
    await connection.repository('approvalDelegations').createMany({
      values: ['all', ['oa.leave'], ['oa.leave']].map((scope, index) => ({
        id: `existing-${index}`,
        principalId: 'principal',
        delegateId: 'delegate',
        scope,
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2027-01-01T00:00:00Z'),
        source: 'manual',
        sourceApplication: null,
        active: index !== 2,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    });
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('oaApprovalStatisticsBoundaries').toHaveIndex([
      'dueAt',
      'id',
    ]);
    await expectCollection('oaApprovalStatisticsBoundaries').toHaveIndex([
      'dependencyKey',
    ]);
    const rows = await connection
      .repository('oaApprovalStatisticsBoundaries')
      .findMany();
    expect(rows).toHaveLength(4);
    expect(
      rows
        .filter((row) => row.dependencyKey === 'delegation/existing-0')
        .every((row) => row.kinds === 'all'),
    ).toBe(true);
    expect(
      rows
        .filter((row) => row.dependencyKey === 'delegation/existing-1')
        .map((row) => row.kinds),
    ).toEqual([['oa.leave'], ['oa.leave']]);
    expect(
      rows.every(
        (row) =>
          JSON.stringify(row.userIds) ===
          JSON.stringify(['principal', 'delegate']),
      ),
    ).toBe(true);
    expect(
      rows.some((row) => row.dependencyKey === 'delegation/existing-2'),
    ).toBe(false);
  },
  down: async ({ expectCollection }) => {
    await expectCollection('oaApprovalStatisticsBoundaries').not.toExist();
    await expectCollection('approvalDelegations').toExist();
  },
});
