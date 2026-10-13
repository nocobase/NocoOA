import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { SessionExpiredAlert } from '#components/session-expired-alert';
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'probationRequests');
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  const departureUnavailable =
    error instanceof ApiClientError &&
    error.reason === 'PROBATION_DEPARTURE_UNAVAILABLE';
  const key = departureUnavailable
    ? 'departureUnavailable'
    : status === 403
      ? 'forbidden'
      : status === 404
        ? 'notFound'
        : status === 409
          ? 'conflict'
          : status === 400 || status === 412
            ? 'invalid'
            : 'failed';
  return (
    <Alert variant='destructive' tabIndex={-1}>
      <AlertDescription>
        {businessMessage ?? t(`probationRequests.errors.${key}`)}
      </AlertDescription>
      {(!businessMessage || status === 409) &&
      ['failed', 'conflict'].includes(key) ? (
        <AlertAction>
          <Button variant='outline' onClick={retry}>
            {t(key === 'conflict' ? 'approvals.loadLatest' : 'approvals.retry')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
