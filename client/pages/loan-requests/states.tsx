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
  const businessMessage = useBusinessErrorMessage(error, 'loanRequests');
  const { t } = useTranslation();
  const key =
    error instanceof ApiClientError
      ? error.reason === 'LOAN_REQUEST_PERSONAL_LIMIT'
        ? 'quota'
        : error.reason === 'LOAN_REQUEST_OVERDUE'
          ? 'overdue'
          : error.reason === 'LOAN_REQUEST_EMPLOYEE_INACTIVE'
            ? 'inactive'
            : error.reason === 'LOAN_REQUEST_SLA_CONFIGURATION_UNSUPPORTED'
              ? 'configuration'
              : [400, 422].includes(error.status)
                ? 'invalid'
                : undefined
      : undefined;
  return key || businessMessage ? (
    <Alert variant='destructive' aria-live='assertive'>
      <AlertDescription>
        {businessMessage ?? t(`loanRequests.errors.${key}`)}
      </AlertDescription>
    </Alert>
  ) : (
    <SharedError error={error} retry={retry} />
  );
}
