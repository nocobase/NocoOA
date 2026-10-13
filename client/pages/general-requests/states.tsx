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
  const businessMessage = useBusinessErrorMessage(error, 'general');
  const { t } = useTranslation();
  const reasons: Record<string, string> = {
    GENERAL_APPROVERS_INVALID: 'approversInvalid',
    GENERAL_CONTENT_INVALID: 'invalid',
    GENERAL_EMPLOYEE_INACTIVE: 'inactive',
    GENERAL_SLA_CONFIGURATION_UNSUPPORTED: 'configuration',
    GENERAL_ATTACHMENTS_INVALID: 'attachmentInvalid',
    GENERAL_ATTACHMENT_INVALID: 'attachmentInvalid',
    GENERAL_ATTACHMENT_DENIED: 'attachmentDenied',
    GENERAL_FILE_TYPE: 'attachmentType',
    GENERAL_FILE_SIZE: 'attachmentSize',
  };
  const key =
    error instanceof ApiClientError
      ? (reasons[error.reason ?? ''] ??
        ([400, 422].includes(error.status) ? 'invalid' : undefined))
      : undefined;
  if (key || businessMessage)
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {businessMessage ?? t(`general.${key}`)}
        </AlertDescription>
      </Alert>
    );
  return <SharedError error={error} retry={retry} />;
}
