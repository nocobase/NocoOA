export function statusTone(status: string) {
  if (['issued'].includes(status)) return 'success';
  if (status === 'rejected') return 'destructive';
  if (['revision', 'exception'].includes(status)) return 'warning';
  if (['draft', 'withdrawn', 'terminated', 'cancelled'].includes(status))
    return 'neutral';
  return 'info';
}
