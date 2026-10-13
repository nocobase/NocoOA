import type { ComponentProps } from 'react';
import type { StatusBadge } from '#components/status-badge';

const tones: Record<string, ComponentProps<typeof StatusBadge>['tone']> = {
  approved: 'success',
  full: 'success',
  revision: 'warning',
  rejected: 'destructive',
  head: 'info',
  hrbp: 'info',
  hrDirector: 'info',
  executive: 'info',
  gm: 'info',
  recruiting: 'info',
};

/** Only known business states receive emphasis; cancelled and drafts stay neutral. */
export function statusTone(status: string) {
  return tones[status] ?? 'neutral';
}
