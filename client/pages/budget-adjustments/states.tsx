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
  const businessMessage = useBusinessErrorMessage(error, 'budgetAdjustments');
  const { t } = useTranslation();
  const key =
    error instanceof ApiClientError
      ? error.reason === 'BUDGET_INSUFFICIENT'
        ? 'insufficient'
        : error.reason === 'BUDGET_ADJUSTMENT_EMPLOYEE_INACTIVE'
          ? 'inactive'
          : error.reason === 'BUDGET_ADJUSTMENT_SLA_CONFIGURATION_UNSUPPORTED'
            ? 'configuration'
            : [400, 422].includes(error.status)
              ? 'invalid'
              : undefined
      : undefined;
  return key || businessMessage ? (
    <Alert variant='destructive' aria-live='assertive'>
      <AlertDescription>
        {businessMessage ?? t(`budgetAdjustments.${key}`)}
      </AlertDescription>
    </Alert>
  ) : (
    <SharedError error={error} retry={retry} />
  );
}
