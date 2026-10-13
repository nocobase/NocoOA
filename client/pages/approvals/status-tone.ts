/** Shared by task center and workbench: approval is not always the business exit. */
export function approvalStatusTone(status: string, kind?: string) {
  if (
    [
      'draft',
      'withdrawn',
      'terminated',
      'cancelled',
      'forcedClosed',
      'administrativelyClosed',
    ].includes(status)
  )
    return 'neutral';
  if (['rejected', 'failed'].includes(status)) return 'destructive';
  if (
    [
      'revision',
      'exception',
      'returnException',
      'unable',
      'dispatch',
      'issuing',
      'returning',
      'cashier',
      'stamping',
      'usage',
      'pendingConfirmation',
    ].includes(status)
  )
    return 'warning';
  if (
    [
      'completed',
      'issued',
      'returned',
      'scrapped',
      'paid',
      'settled',
      'published',
      'effective',
      'acknowledged',
    ].includes(status)
  )
    return 'success';
  if (status === 'approved') {
    return kind &&
      [
        'oa.loan',
        'oa.payment',
        'oa.reimbursement',
        'oa.contract',
        'oa.assetRequest',
        'oa.purchase',
        'oa.certificateRequest',
        'oa.supplies',
        'oa.travel',
      ].includes(kind)
      ? 'info'
      : 'success';
  }
  return 'info';
}
