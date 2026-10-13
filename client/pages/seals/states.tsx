import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { Link, useLocation } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Skeleton } from '#components/ui/skeleton';
import { Button } from '#components/ui/button';
export function SealError({
  error,
  retry,
  returnTo = '/seal-requests',
}: {
  error: unknown;
  retry?: () => void;
  returnTo?: string;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'seals');
  const { t } = useTranslation(),
    location = useLocation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const denied =
    error instanceof ApiClientError && [403, 404].includes(error.status);
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ?? t(`seals.${denied ? 'unavailable' : 'failed'}`)}
      </AlertDescription>
      {denied ? (
        <Button
          nativeButton={false}
          variant='outline'
          render={
            <Link
              to={{
                pathname: returnTo,
                search: location.search,
                hash: location.hash,
              }}
            />
          }
        >
          {t('seals.backToList')}
        </Button>
      ) : null}
      {!denied &&
      (!businessMessage ||
        (error instanceof ApiClientError && error.status === 409)) &&
      retry ? (
        <Button variant='outline' onClick={retry}>
          {t(
            error instanceof ApiClientError && error.status === 409
              ? 'approvals.loadLatest'
              : 'seals.retry',
          )}
        </Button>
      ) : null}
    </Alert>
  );
}

export function SealSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('seals.loading')}
      className='flex flex-col gap-5'
    >
      <Skeleton className='h-6 w-1/2' />
      <Skeleton className='h-20 w-full' />
      <Skeleton className='h-10 w-full' />
    </div>
  );
}
