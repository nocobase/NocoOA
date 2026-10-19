/** A translation is exact, whole-field and restricted to demo content. IDs, codes and protocol values never change. */
const textFields = new Set([
  'name',
  'title',
  'description',
  'reason',
  'purpose',
  'body',
  'markdown',
  'location',
  'facilities',
  'workLocation',
  'contact',
  'contactName',
  'bankName',
  'bankAccountName',
  'paymentTerms',
  'proof',
  'institution',
  'destination',
  'overrunReason',
  'noPriorApprovalReason',
  'specification',
  'unit',
  'cases',
  'scrapReason',
  'jobDescription',
  'selfEvaluation',
  'evaluation',
  'workstationRequirement',
  'note',
  'comment',
  'departmentTitle',
  'positionTitle',
  'gradeTitle',
  'departmentName',
  'employeeName',
  'applicantName',
  'userName',
  'assigneeName',
  'roomName',
  'vendorName',
  'assetName',
  'sealName',
  'shiftName',
  'summary',
]);
// A locale map and frozen approval evidence must remain byte-for-byte canonical.
const opaqueFields = new Set([
  'label',
  'translations',
  'snapshot',
  'snapshotData',
  'ruleSnapshot',
  'contentHash',
  'password',
  'token',
  'email',
  'username',
  'code',
  'id',
]);
const trialMarker = /示例|虚构|^oa-trial-v1|^Demo[ ·]|^Fictional[ ]/u;

export function translateTrialPayload<T>(
  value: T,
  translations: ReadonlyMap<string, string>,
  inTrialRecord = false,
  field = '',
): T {
  if (typeof value === 'string') {
    return (
      textFields.has(field) &&
      (inTrialRecord ||
        trialMarker.test(value) ||
        trialMarker.test(translations.get(value) ?? ''))
        ? (translations.get(value) ?? value)
        : value
    ) as T;
  }
  if (Array.isArray(value))
    return value.map((child: unknown) =>
      translateTrialPayload(child, translations, inTrialRecord, field),
    ) as T;
  if (!value || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  const trial =
    inTrialRecord ||
    Object.entries(object).some(
      ([key, item]) =>
        (textFields.has(key) || key === 'code' || key === 'email') &&
        typeof item === 'string' &&
        (trialMarker.test(item) ||
          trialMarker.test(translations.get(item) ?? '') ||
          item.endsWith('@oa-trial.example.test')),
    );
  return Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      opaqueFields.has(key)
        ? item
        : translateTrialPayload(item, translations, trial, key),
    ]),
  ) as T;
}

/** CLI coverage is metadata, so unlike business JSON every leaf can be localized. */
export function translateTrialMetadata<T>(
  value: T,
  translations: ReadonlyMap<string, string>,
): T {
  if (typeof value === 'string') return (translations.get(value) ?? value) as T;
  if (Array.isArray(value))
    return value.map((item: unknown) =>
      translateTrialMetadata(item, translations),
    ) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        translateTrialMetadata(item, translations),
      ]),
    ) as T;
  return value;
}
