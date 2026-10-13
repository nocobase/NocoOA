import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { ErrorState as SharedError } from '../approvals/states.js';
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const businessMessage = useBusinessErrorMessage(error, 'leaveCancellations');
  const { t } = useTranslation();
  const reasons: Record<string, string> = {
    CANCELLATION_ORIGINAL_INVALID: 'invalidOriginal',
    CANCELLATION_NO_REMAINDER: 'noRemainder',
    CANCELLATION_RANGE_INVALID: 'invalidRange',
    CANCELLATION_ALREADY_STARTED: 'alreadyStarted',
    CANCELLATION_NO_WORKDAYS: 'noWorkdays',
    CANCELLATION_BASELINE_CHANGED: 'changed',
    CANCELLATION_EMPLOYEE_MISSING: 'inactive',
  };
  const key =
    error instanceof ApiClientError ? reasons[error.reason ?? ''] : undefined;
  if (key || businessMessage)
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {businessMessage ?? t(`leaveCancellations.${key}`)}
        </AlertDescription>
      </Alert>
    );
  return <SharedError error={error} retry={retry} />;
}
