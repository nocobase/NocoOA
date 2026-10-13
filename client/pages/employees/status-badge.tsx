import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { StatusBadge } from '#components/status-badge';

import type { EmployeeStatus } from './types.js';

const VARIANTS: Record<
  EmployeeStatus,
  'info' | 'success' | 'warning' | 'neutral'
> = {
  probation: 'info',
  regular: 'success',
  leaving: 'warning',
  left: 'neutral',
};

/** An employee status as text in a Badge; the color only supports the text (guideline T1.4). */
export function EmployeeStatusBadge({
  status,
}: {
  readonly status: EmployeeStatus | undefined;
}): ReactElement {
  const { t } = useTranslation();
  if (!status) return <span className='text-muted-foreground'>—</span>;
  return (
    <StatusBadge tone={VARIANTS[status]}>
      {t(`employees.status.${status}`)}
    </StatusBadge>
  );
}
