import { useTranslation } from '@nocobase/i18n/client';
export function useProcessText() {
  const { t, i18n } = useTranslation();
  return {
    name: (kind: string) => t(`processManagement.kinds.${kind.slice(3)}`),
    state: (name: string) =>
      /^committee_v([1-9]\d*)$/.test(name)
        ? t('vendorQualifications.committeeVersion', {
            version: name.slice('committee_v'.length),
          })
        : t(`processManagement.states.${name}`, {
            defaultValue: t('processManagement.otherStage', { name }),
          }),
    transition: (name: string) => {
      const key = `processManagement.transitionNames.${name}`;
      return i18n.exists(key)
        ? t(key)
        : /Approved$/.test(name)
          ? t('processManagement.transitionNames.approved')
          : t('processManagement.transitionUnknown', { name });
    },
    event: (name: string) =>
      t(`processManagement.events.${name}`, {
        defaultValue: t('processManagement.otherEvent', { name }),
      }),
  };
}
