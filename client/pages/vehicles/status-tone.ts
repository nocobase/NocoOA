import type { ComponentProps } from 'react';
import type { StatusBadge } from '#components/status-badge';

const tones: Record<string, ComponentProps<typeof StatusBadge>['tone']> = {
  completed: 'success',
  active: 'success',
  revision: 'warning',
  exception: 'warning',
  dispatch: 'warning',
  usage: 'warning',
  maintenance: 'warning',
  rejected: 'destructive',
  head: 'info',
};

/** Only known business states receive emphasis; cancelled and drafts stay neutral. */
export function statusTone(status: string) {
  return tones[status] ?? 'neutral';
}
