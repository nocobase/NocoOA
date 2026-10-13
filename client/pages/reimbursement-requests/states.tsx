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
  const businessMessage = useBusinessErrorMessage(
    error,
    'reimbursementRequests',
  );
  const { t } = useTranslation();
  if (error instanceof ApiClientError && error.status === 401)
    return <SessionExpiredAlert />;
  const status = error instanceof ApiClientError ? error.status : 0;
  const reason = error instanceof ApiClientError ? error.reason : undefined;
  const reasons: Record<string, string> = {
    EXPENSE_AUTHORIZATION_OVERRUN_REASON: 'overrunReasonRequired',
    INVOICE_ALREADY_OCCUPIED: 'invoiceUnavailable',
    INVOICE_DUPLICATE_LINE: 'invoiceDuplicate',
    REIMBURSEMENT_PAYMENT_ACCOUNT_REQUIRED: 'paymentAccountRequired',
    REIMBURSEMENT_EMPLOYEE_INACTIVE: 'employeeInactive',
    REIMBURSEMENT_DEPARTMENT_REQUIRED: 'departmentRequired',
    REIMBURSEMENT_CATEGORY_INVALID: 'categoryInvalid',
    REIMBURSEMENT_SOURCE_INVALID: 'sourceInvalid',
    REIMBURSEMENT_AUTHORIZATION_INVALID: 'sourceInvalid',
    REIMBURSEMENT_SOURCE_REBIND_FORBIDDEN: 'sourceRebind',
    REIMBURSEMENT_LOAN_REQUIRED: 'loanRequired',
    REIMBURSEMENT_LOAN_INVALID: 'loanInvalid',
    REIMBURSEMENT_LOAN_INSUFFICIENT: 'loanInsufficient',
    REIMBURSEMENT_INVALID_OFFSET: 'invalidOffset',
    REIMBURSEMENT_ATTACHMENT_INVALID: 'attachmentInvalid',
    REIMBURSEMENT_STANDARD_REASON_REQUIRED: 'standardReason',
    REIMBURSEMENT_STANDARD_CATEGORY_CHANGED: 'standardCategoryChanged',
    REIMBURSEMENT_STANDARD_CONFIGURATION: 'standardConfiguration',
    REIMBURSEMENT_SLA_CONFIGURATION_UNSUPPORTED: 'slaConfiguration',
    REIMBURSEMENT_INVALID_INPUT: 'inputInvalid',
    FIELD_NOT_FOUND: 'configuration',
    COLLECTION_NOT_FOUND: 'configuration',
  };
  const key =
    status === 403
      ? 'forbidden'
      : status === 404
        ? 'notFound'
        : status === 409
          ? 'conflict'
          : (reasons[reason ?? ''] ??
            (status === 400 || status === 412 ? 'invalid' : 'failed'));
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {businessMessage ?? t(`reimbursementRequests.errors.${key}`)}
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
