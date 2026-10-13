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
  const businessMessage = useBusinessErrorMessage(error, 'purchases');
  const { t } = useTranslation();
  const key =
    error instanceof ApiClientError
      ? error.reason === 'BUDGET_INSUFFICIENT'
        ? 'insufficient'
        : error.reason === 'PURCHASE_EMPLOYEE_INACTIVE'
          ? 'inactive'
          : error.reason === 'PURCHASE_SLA_CONFIGURATION_UNSUPPORTED'
            ? 'configuration'
            : [400, 422].includes(error.status)
              ? 'invalid'
              : undefined
      : undefined;
  return key || businessMessage ? (
    <Alert variant='destructive' aria-live='assertive'>
      <AlertDescription>
        {businessMessage ?? t(`purchases.errors.${key}`)}
      </AlertDescription>
    </Alert>
  ) : (
    <SharedError error={error} retry={retry} />
  );
}
