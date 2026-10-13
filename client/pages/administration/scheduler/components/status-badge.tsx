import type { ReactElement } from 'react';

import { StatusBadge as ApplicationStatusBadge } from '#components/status-badge';

export interface StatusBadgeProps {
  readonly label: string;
  readonly status: string;
}

/** A state chip whose tone follows the lifecycle status it reports. */
export function StatusBadge({ label, status }: StatusBadgeProps): ReactElement {
  return (
    <ApplicationStatusBadge tone={statusTone(status)}>
      {label}
    </ApplicationStatusBadge>
  );
}

/** Settled states read as success, in-flight ones as progress, and withdrawn ones as a warning. */
function statusTone(
  status: string,
): 'success' | 'destructive' | 'info' | 'warning' | 'neutral' {
  if (status === 'active' || status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'targetIssue') return 'destructive';
  if (status === 'running' || status === 'waiting') return 'info';
  if (status === 'inactive' || status === 'triggered' || status === 'timed_out')
    return 'warning';
  return 'neutral';
}
