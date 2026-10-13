/** Approval and completion are distinct; each module declares its own successful exits. */
export function statusTone(status: string | null | undefined) {
  if (['completed'].includes(status ?? '')) return 'success';
  if (status === 'rejected') return 'destructive';
  if (
    [
      'revision',
      'exception',
      'returnException',
      'stamping',
      'returning',
    ].includes(status ?? '')
  )
    return 'warning';
  if (
    !status ||
    [
      'draft',
      'withdrawn',
      'terminated',
      'cancelled',
      'administrativelyClosed',
    ].includes(status)
  )
    return 'neutral';
  return 'info';
}
