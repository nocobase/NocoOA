import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';

/** Translate only declared business reasons in the owning module. Never render
 * raw API messages, field paths or an unknown reason as user-facing copy. */
export function useBusinessErrorFormatter(module: string) {
  const { t, i18n } = useTranslation();
  return (error: unknown): string | undefined => {
    if (
      !(error instanceof ApiClientError) ||
      (![400, 409, 412, 422].includes(error.status) &&
        !(
          error.status === 403 &&
          ['CLAIM_FIRST', 'CERTIFICATE_CLAIM_REQUIRED'].includes(
            error.reason ?? '',
          )
        ))
    )
      return undefined;
    let businessMessage: string | undefined;
    for (const group of error.reason && /^[A-Z][A-Z0-9_]+$/.test(error.reason)
      ? ['businessErrors', 'errors']
      : []) {
      const key = `${module}.${group}.${error.reason}`;
      if (i18n.exists(key)) {
        businessMessage = t(key);
        break;
      }
    }
    if (!businessMessage && error.reason) {
      const actionKey = `approvals.actionErrors.${error.reason}`;
      if (i18n.exists(actionKey)) businessMessage = t(actionKey);
    }
    const payload = error.payload as
      | {
          error?: { fieldViolations?: { field?: string }[] };
        }
      | undefined;
    const labels: string[] = [];
    const violations = payload?.error?.fieldViolations;
    for (const violation of Array.isArray(violations) ? violations : []) {
      if (typeof violation?.field !== 'string') continue;
      const leaf = violation.field
        ?.replace(/\[\d+\]/g, '')
        .split('.')
        .at(-1);
      if (!leaf || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(leaf)) continue;
      for (const key of [
        `${module}.fields.${leaf}`,
        `${module}.form.${leaf}`,
        `${module}Form.${leaf}`,
        `${module}.${leaf}`,
      ]) {
        if (i18n.exists(key)) {
          const label = t(key);
          if (typeof label === 'string' && !labels.includes(label))
            labels.push(label);
          break;
        }
      }
    }
    if (!labels.length) return businessMessage;
    const fields = labels.join(t('approvals.fieldSeparator'));
    return businessMessage
      ? t('approvals.businessErrorFields', { message: businessMessage, fields })
      : t('approvals.invalidFields', { fields });
  };
}

export function useBusinessErrorMessage(error: unknown, module: string) {
  return useBusinessErrorFormatter(module)(error);
}
