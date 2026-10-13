/** Presentation only; backend lifecycle state and actions remain authoritative. */
export function statusTone(status: string) {
  if (['completed'].includes(status)) return 'success';
  if (status === 'rejected') return 'destructive';
  if (['revision', 'exception'].includes(status)) return 'warning';
  if (['draft', 'withdrawn', 'terminated', 'cancelled'].includes(status))
    return 'neutral';
  return 'info';
}
