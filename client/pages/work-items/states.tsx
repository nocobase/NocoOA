import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
export function Failure({
  error,
  retry,
  denied,
  module = 'workItems',
}: {
  error?: unknown;
  retry?: () => void;
  denied?: boolean;
  module?: string;
}) {
  const businessMessage = useBusinessErrorMessage(error, module);
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ??
          t(
            `workItems.${denied || status === 403 ? 'denied' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'failed'}`,
          )}
      </AlertDescription>
      {!denied && ![401, 403, 404, 409].includes(status) && retry ? (
        <Button variant='outline' onClick={retry}>
          {t('workItems.retry')}
        </Button>
      ) : null}
    </Alert>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t('workItems.loading')}
      className='flex flex-col gap-4'
    >
      <Skeleton className='h-12 w-full' />
      <Skeleton className='h-24 w-full' />
    </div>
  );
}
