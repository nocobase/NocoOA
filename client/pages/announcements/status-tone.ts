import type { ComponentProps } from 'react';
import type { StatusBadge } from '#components/status-badge';

const tones: Record<string, ComponentProps<typeof StatusBadge>['tone']> = {
  published: 'success',
  scheduled: 'info',
  pending: 'warning',
  confirmed: 'success',
};

/** Only known business states receive emphasis; cancelled and drafts stay neutral. */
export function statusTone(status: string) {
  return tones[status] ?? 'neutral';
}
