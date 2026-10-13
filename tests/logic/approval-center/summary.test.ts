// @vitest-environment node
import { expect, test } from 'vitest';
import { readableSummary } from '../../../server/routes/approval-center/summary.js';

test('summaries whitelist the authorized display field and real edit timestamp only', () => {
  expect(
    readableSummary(
      {
        reason: '  Customer \n visit ',
        updatedAt: '2026-10-13T08:00:00Z',
        salary: 100,
        cost: 25,
        statusChangedAt: '2026-10-14T08:00:00Z',
      },
      'reason',
    ),
  ).toEqual({ title: 'Customer visit', updatedAt: '2026-10-13T08:00:00.000Z' });
  expect(
    readableSummary(
      {
        createdAt: '2026-10-13T08:00:00Z',
        statusChangedAt: '2026-10-14T08:00:00Z',
      },
      'reason',
    ),
  ).toEqual({});
  expect(
    readableSummary({ reason: '  ', updatedAt: 'invalid' }, 'reason'),
  ).toEqual({});
  expect(
    readableSummary({ reason: 'a'.repeat(300) }, 'reason').title,
  ).toHaveLength(240);
});
