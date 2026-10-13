import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { SessionExpiredAlert } from '#components/session-expired-alert';
export function ErrorState({
  error,
  retry,
  context = 'action',
}: {
  error: unknown;
  retry: () => void;
  context?: 'load' | 'action';
}) {
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  const key =
    error instanceof ApiClientError &&
    error.reason === 'VENDOR_QUALIFICATION_QUALIFICATION_FACTS_REQUIRED'
      ? 'qualificationFacts'
      : error instanceof ApiClientError &&
          error.reason?.includes('VENDOR_VERSION_CONFLICT')
        ? 'sourceConflict'
        : status === 403
          ? 'forbidden'
          : status === 404
            ? 'missing'
            : status === 409
              ? 'conflict'
              : status === 400 || status === 412
                ? context === 'load'
                  ? 'failed'
                  : 'invalid'
                : 'failed';
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {t(`vendorQualifications.errors.${key}`)}
      </AlertDescription>
      {['failed', 'conflict', 'sourceConflict'].includes(key) && (
        <AlertAction>
          <Button variant='outline' onClick={retry}>
            {t(key === 'failed' ? 'approvals.retry' : 'approvals.loadLatest')}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
