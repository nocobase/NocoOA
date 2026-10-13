import { useBusinessErrorMessage } from '#hooks/use-business-error-message';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription, AlertAction } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { SessionExpiredAlert } from '#components/session-expired-alert';
function errorKey(error: unknown, context: 'leave' | 'query') {
  if (!(error instanceof ApiClientError)) return 'failed';
  const attachmentKeys: Record<string, string> = {
    LEAVE_ATTACHMENT_REQUIRED: 'attachmentRequired',
    LEAVE_ATTACHMENTS_UNAVAILABLE: 'attachmentUnavailable',
    LEAVE_ATTACHMENT_DENIED: 'attachmentDenied',
    LEAVE_FILE_SIZE: 'attachmentSize',
    LEAVE_FILE_TYPE: 'attachmentType',
    LEAVE_ATTACHMENT_INVALID: 'attachmentInvalid',
  };
  const attachmentKey = attachmentKeys[error.reason ?? ''];
  if (attachmentKey) return attachmentKey;
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'conflict';
  if (context === 'query') return 'failed';
  if (error.reason === 'LEAVE_BALANCE_UNAVAILABLE') return 'balanceLimit';
  if (error.reason === 'LEAVE_BALANCE_INSUFFICIENT')
    return 'balanceInsufficient';
  if (error.reason === 'LEAVE_OVERLAP') return 'overlap';
  if (error.reason === 'LEAVE_SLA_CONFIGURATION_UNSUPPORTED')
    return 'configuration';
  if (
    ['LEAVE_EMPLOYEE_INACTIVE', 'LEAVE_HANDOVER_INACTIVE'].includes(
      error.reason ?? '',
    )
  )
    return 'inactive';
  if (error.status === 400 || error.status === 422) return 'domainInvalid';
  return 'failed';
}
export function ErrorState({
  error,
  retry,
  context = 'leave',
}: {
  error: unknown;
  retry: () => void;
  context?: 'leave' | 'query';
}) {
  const businessMessage = useBusinessErrorMessage(error, 'approvals');
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const key = errorKey(error, context);
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ??
          t(
            key === 'balanceLimit' ||
              key === 'balanceInsufficient' ||
              key.startsWith('attachment') ||
              key === 'domainInvalid'
              ? `approvals.${key}`
              : `approvals.error.${key}`,
          )}
      </AlertDescription>
      {(!businessMessage ||
        (error instanceof ApiClientError && error.status === 409)) &&
      (key === 'failed' || key === 'conflict') ? (
        <AlertAction>
          <Button variant='outline' onClick={retry}>
            {t(key === 'conflict' ? 'approvals.loadLatest' : 'approvals.retry')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
