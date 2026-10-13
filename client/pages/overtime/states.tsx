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
  const businessMessage = useBusinessErrorMessage(error, 'overtime');
  const { t } = useTranslation();
  const reasons: Record<string, string> = {
    OVERTIME_DUPLICATE_DATE: 'duplicate',
    OVERTIME_EMPLOYEE_INACTIVE: 'inactive',
    OVERTIME_INVALID_DURATION: 'durationInvalid',
    OVERTIME_SLA_CONFIGURATION_UNSUPPORTED: 'configuration',
    OVERTIME_INVALID_DATE: 'invalid',
    OVERTIME_INVALID_INPUT: 'invalid',
    FIELD_NOT_FOUND: 'schemaUnavailable',
  };
  const key =
    error instanceof ApiClientError ? reasons[error.reason ?? ''] : undefined;
  if (key || businessMessage)
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {businessMessage ?? t(`overtime.${key}`)}
        </AlertDescription>
      </Alert>
    );
  return <SharedError error={error} retry={retry} context='query' />;
}
