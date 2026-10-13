import { describe, expect, it } from 'vitest';
import { approvalStatusTone } from '../../client/pages/approvals/status-tone.js';

describe('shared task status semantics', () => {
  it('does not present approval as payment or physical issue completion', () => {
    expect(approvalStatusTone('approved', 'oa.payment')).toBe('info');
    expect(approvalStatusTone('paid', 'oa.payment')).toBe('success');
    expect(approvalStatusTone('approved', 'oa.supplies')).toBe('info');
    expect(approvalStatusTone('issuing', 'oa.supplies')).toBe('warning');
    expect(approvalStatusTone('issued', 'oa.supplies')).toBe('success');
    expect(approvalStatusTone('approved', 'oa.leave')).toBe('success');
  });
  it('distinguishes a required correction, rejection, and administrative closure', () => {
    expect(approvalStatusTone('revision', 'oa.loan')).toBe('warning');
    expect(approvalStatusTone('rejected', 'oa.loan')).toBe('destructive');
    expect(approvalStatusTone('forcedClosed', 'oa.supplies')).toBe('neutral');
    expect(approvalStatusTone('terminated', 'oa.loan')).toBe('neutral');
  });
});
