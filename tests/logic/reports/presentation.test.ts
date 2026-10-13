// @vitest-environment node
import { expect, it } from 'vitest';
import { reportMoney } from '../../../client/pages/reports/presentation.js';

it('keeps the final cent exact at the safe-integer boundary and never invents zero for invalid amounts', () => {
  expect(reportMoney(Number.MAX_SAFE_INTEGER, 'en-US')).toBe(
    '90,071,992,547,409.91',
  );
  expect(reportMoney(-1, 'zh-CN')).toBe('-0.01');
  expect(reportMoney(Number.NaN, 'zh-CN')).toBe('—');
});
