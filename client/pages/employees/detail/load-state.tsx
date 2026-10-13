import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';

/** A tab's failed load (guideline S4): 401 signs in again, 403 explains the section is not visible (S6), 404 R3. */
export function TabLoadError({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const status = error instanceof ApiClientError ? error.status : undefined;
  if (status === 401) return <SessionExpiredAlert />;
  if (status === 403 || status === 404)
    return (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertDescription>
          {status === 403
            ? t('employees.error.tabForbidden')
            : t('employees.error.notFound')}
        </AlertDescription>
      </Alert>
    );
  return (
    <Alert variant='destructive'>
      <AlertCircleIcon />
      <AlertDescription>{t('employees.error.requestFailed')}</AlertDescription>
      <AlertAction>
        <Button variant='outline' size='sm' onClick={onRetry}>
          {t('status.retry')}
        </Button>
      </AlertAction>
    </Alert>
  );
}

export function TabSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('status.loading')}
      className='flex flex-col gap-3 rounded-lg border p-6'
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[8rem_minmax(0,1fr)] gap-4'
        >
          <Skeleton className='h-4 w-20' />
          <Skeleton className='h-4 w-48' />
        </div>
      ))}
    </div>
  );
}
