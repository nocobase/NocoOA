export function statusTone(status: string) {
  if (['qualified', 'removed'].includes(status)) return 'success';
  if (status === 'rejected') return 'destructive';
  if (['revision'].includes(status)) return 'warning';
  if (['draft', 'withdrawn', 'terminated', 'cancelled'].includes(status))
    return 'neutral';
  return 'info';
}
