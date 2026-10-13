import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { Link, useLocation } from 'react-router';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
export function TransferError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'transfer');
  const { t } = useTranslation(),
    location = useLocation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ??
          t(
            `transfer.errors.${status === 404 ? 'missing' : status === 403 ? 'denied' : status === 409 ? 'conflict' : status === 412 || (status === 400 && error instanceof ApiClientError && error.reason !== 'INVALID_ARGUMENT') ? 'precondition' : 'failed'}`,
          )}
      </AlertDescription>
      {status === 404 ? (
        <Button
          variant='outline'
          render={<Link to={{ pathname: '..', search: location.search }} />}
          nativeButton={false}
        >
          {t('transfer.return')}
        </Button>
      ) : null}
      {![401, 403, 404].includes(status) ? (
        <Button variant='outline' onClick={retry}>
          {t(status === 409 ? 'transfer.loadLatest' : 'transfer.retry')}
        </Button>
      ) : null}
    </Alert>
  );
}
