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
  const businessMessage = useBusinessErrorMessage(error, 'attendanceChange');
  const { t, i18n } = useTranslation();
  const key =
    error instanceof ApiClientError
      ? `attendanceChange.errors.${error.reason ?? ''}`
      : '';
  if (businessMessage || (key && i18n.exists(key)))
    return (
      <Alert variant='destructive'>
        <AlertDescription>{businessMessage ?? t(key)}</AlertDescription>
      </Alert>
    );
  return <SharedError error={error} retry={retry} />;
}
