import { ApiClientError } from '@nocobase/app-client';
import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { statusOf } from './types.js';
import { reasonOf } from './errors.js';
export { TableSkeleton, FieldsSkeleton } from '../platform/shared/states.js';
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'assetRequests');
  const { t } = useTranslation();
  const status = statusOf(error);
  const reason = reasonOf(error);
  const fallback = t(
    status === 403
      ? 'assetRequests.noAccess'
      : status === 404
        ? 'assetRequests.missing'
        : status === 409
          ? 'assetRequests.conflict'
          : status && status < 500
            ? 'assetRequests.invalid'
            : 'assetRequests.loadFailed',
  );
  if (status === 401) return <SessionExpiredAlert />;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ??
          (reason?.startsWith('ASSET_')
            ? t(`assetRequests.errors.${reason}`, { defaultValue: fallback })
            : fallback)}
      </AlertDescription>
      {retry &&
      (!businessMessage ||
        (error instanceof ApiClientError && error.status === 409)) &&
      status !== 403 &&
      status !== 404 ? (
        <Button variant='outline' onClick={retry}>
          {t(
            status === 409 ? 'assetRequests.loadLatest' : 'assetRequests.retry',
          )}
        </Button>
      ) : null}
    </Alert>
  );
}
