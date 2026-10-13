import { zodResolver } from '@hookform/resolvers/zod';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import {
  type FormEvent,
  type ReactElement,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useOutletContext, useParams } from 'react-router';
import { z } from 'zod';

import { RouteDialog } from '#components/route-dialog';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '#components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '#components/ui/input-group';
import { Textarea } from '#components/ui/textarea';
import { useRouteOverlay } from '#components/use-route-overlay';

import {
  effectiveFromOf,
  type EffectiveMode,
} from '../shared/effective-from-value.js';
import { EffectiveFromFields } from '../shared/effective-from.js';
import {
  OverlayCloseButton,
  OverlayFormFooter,
} from '../shared/overlay-buttons.js';
import { fieldViolationsOf, reasonOf, statusOf } from '../shared/errors.js';
import { FieldsSkeleton, LoadErrorAlert } from '../shared/states.js';
import type { RuleSummary } from '../shared/types.js';
import { useResource } from '../shared/use-resource.js';
import {
  formatRuleValue,
  isNumericRule,
  ruleKeyId,
  type RulesOutletContext,
} from './rule-format.js';

const FORM_ID = 'platform-rule-change';

/**
 * Adds a version of a rule. Two routes load it: `edit/:key`, which a row's menu opens over the list, and `:key/edit`,
 * stacked on the history drawer. It loads the rules fresh rather than taking the list's copy (guideline T3.8).
 */
export default function RuleChangeDialog(): ReactElement {
  const { key = '' } = useParams();
  return <ChangeDialog key={key} ruleKey={key} />;
}

function ChangeDialog({ ruleKey }: { readonly ruleKey: string }): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const handleSubmitting = (value: boolean): void => {
    submittingRef.current = value;
    setSubmitting(value);
  };
  const rules = useResource<RuleSummary[]>('approvalRules', { area: 'rules' });
  const rule = rules.data?.find((item) => item.key === ruleKey);
  const name = t(`platform.rules.keys.${ruleKeyId(ruleKey)}.label`, {
    defaultValue: ruleKey,
  });

  let body: ReactElement;
  let footer: ReactElement;
  if (rules.error) {
    body = <LoadErrorAlert error={rules.error} onRetry={rules.reload} />;
    footer = <OverlayCloseButton label={t('actions.close')} />;
  } else if (!rules.data) {
    body = <FieldsSkeleton fields={3} />;
    footer = <OverlayCloseButton label={t('actions.cancel')} />;
  } else if (!rule || !isNumericRule(rule)) {
    body = (
      <Alert variant='destructive'>
        <AlertCircleIcon />
        <AlertDescription>{t('platform.rules.notFound')}</AlertDescription>
      </Alert>
    );
    footer = <OverlayCloseButton label={t('actions.close')} />;
  } else {
    body = <ChangeForm rule={rule} onSubmittingChange={handleSubmitting} />;
    footer = (
      <OverlayFormFooter
        formId={FORM_ID}
        submitting={submitting}
        submitLabel={t('actions.save')}
      />
    );
  }

  return (
    <RouteDialog
      title={t('platform.rules.changeTitle', { name })}
      description={t('platform.rules.changeDescription')}
      className='sm:max-w-md'
      beforeClose={() => !submittingRef.current}
      footer={footer}
    >
      {body}
    </RouteDialog>
  );
}

function ChangeForm({
  rule,
  onSubmittingChange,
}: {
  readonly rule: RuleSummary;
  readonly onSubmittingChange: (submitting: boolean) => void;
}): ReactElement {
  const { close } = useRouteOverlay();
  const { reload } = useOutletContext<RulesOutletContext>();
  return (
    <RuleChangeForm
      rule={rule}
      onSubmittingChange={onSubmittingChange}
      onSaved={() => {
        reload();
        void close();
      }}
    />
  );
}

/** Shared version editor; callers provide their own overlay and refresh behavior. */
export function RuleChangeForm({
  rule,
  onSubmittingChange,
  onSaved,
  formId = FORM_ID,
  disabled = false,
}: {
  readonly rule: RuleSummary;
  readonly onSubmittingChange: (submitting: boolean) => void;
  readonly onSaved: () => void;
  readonly formId?: string;
  readonly disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const toaster = useToaster();
  const submittingRef = useRef(false);
  const ratio = rule.type === 'ratio';
  const name = t(`platform.rules.keys.${ruleKeyId(rule.key)}.label`);
  const current =
    typeof (rule.current?.value ?? rule.defaultValue) === 'number'
      ? ((rule.current?.value ?? rule.defaultValue) as number)
      : undefined;

  const schema = useMemo(() => {
    const min = rule.min ?? (rule.type === 'workingHours' ? 1 : 0);
    const max = rule.max;
    return z
      .object({
        value: z
          .string()
          .trim()
          .min(1, t('platform.rules.errors.valueRequired'))
          .refine(
            (value) => !Number.isNaN(Number(value)),
            t('platform.rules.errors.notANumber'),
          )
          .refine(
            (value) => {
              const number = ratio ? Number(value) / 100 : Number(value);
              return number >= min && (max === undefined || number <= max);
            },
            ratio
              ? t('platform.rules.errors.percentRange', {
                  min: min * 100,
                  max: (max ?? 1) * 100,
                })
              : t('platform.rules.errors.minimum', { min }),
          )
          .refine(
            (value) =>
              !['count', 'rank', 'integer'].includes(rule.type) ||
              Number.isInteger(Number(value)),
            t('platform.rules.errors.integer'),
          )
          .refine(
            (value) =>
              rule.type !== 'days' || Number.isInteger(Number(value) * 2),
            t('platform.rules.errors.halfDays'),
          ),
        mode: z.enum(['now', 'date']),
        date: z.date().optional(),
        note: z
          .string()
          .trim()
          .max(500, t('platform.rules.errors.noteTooLong', { max: 500 })),
      })
      .refine((values) => values.mode === 'now' || values.date !== undefined, {
        path: ['date'],
        message: t('platform.rules.effective.dateRequired'),
      });
  }, [ratio, rule, t]);

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      value:
        current === undefined
          ? ''
          : String(ratio ? Math.round(current * 10000) / 100 : current),
      mode: 'now' as EffectiveMode,
      date: undefined as Date | undefined,
      note: '',
    },
  });
  const mode = useWatch({ control: form.control, name: 'mode' });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    await form.handleSubmit(async (values) => {
      if (disabled || submittingRef.current) return;
      submittingRef.current = true;
      const value = ratio ? Number(values.value) / 100 : Number(values.value);
      onSubmittingChange(true);
      try {
        await api.request({
          path: `approvalRules/${encodeURIComponent(rule.key)}/versions`,
          method: 'POST',
          json: {
            value,
            effectiveFrom: effectiveFromOf(values.mode, values.date),
            note: values.note || null,
          },
        });
      } catch (error: unknown) {
        const status = statusOf(error);
        const reason = reasonOf(error);
        const fields = fieldViolationsOf(error);
        if (status === 401) form.setError('root', { type: 'sessionExpired' });
        else if (
          reason === 'RULE_EFFECTIVE_IN_PAST' ||
          (status === 400 && fields.includes('effectiveFrom'))
        )
          form.setError(
            'date',
            { message: t('platform.rules.effective.pastError') },
            { shouldFocus: true },
          );
        else if (reason === 'RULE_INVALID_VALUE')
          form.setError(
            'value',
            { message: t('platform.rules.errors.invalidValue') },
            { shouldFocus: true },
          );
        else
          form.setError('root', {
            message:
              reason === 'RULE_ORDER_VIOLATED'
                ? t('platform.rules.errors.orderViolated')
                : reason === 'RULE_VERSION_EXISTS'
                  ? t('platform.rules.errors.versionExists')
                  : status === 403
                    ? t('platform.common.writeForbidden')
                    : t('platform.common.saveFailed'),
          });
        return;
      } finally {
        submittingRef.current = false;
        onSubmittingChange(false);
      }
      toaster.show({
        type: 'success',
        title: t('platform.rules.changed', { name }),
      });
      onSaved();
    })(event);
  };

  const rootError = form.formState.errors.root;

  return (
    <form id={formId} noValidate onSubmit={(event) => void submit(event)}>
      <fieldset
        disabled={disabled || form.formState.isSubmitting}
        className='min-w-0'
      >
        <FieldGroup>
          {rootError?.type === 'sessionExpired' ? (
            <SessionExpiredAlert />
          ) : rootError ? (
            <Alert variant='destructive'>
              <AlertCircleIcon />
              <AlertDescription>{rootError.message}</AlertDescription>
            </Alert>
          ) : null}
          <Controller
            control={form.control}
            name='value'
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-value`}>
                  {t('platform.rules.fields.newValue')}
                  <span aria-hidden='true' className='text-destructive'>
                    *
                  </span>
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id={`${formId}-value`}
                    inputMode='decimal'
                    autoComplete='off'
                    aria-required='true'
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align='inline-end'>
                    <InputGroupText>
                      {t(`platform.rules.unitSuffix.${rule.type}`)}
                    </InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  {t('platform.rules.currentValue', {
                    value: formatRuleValue(
                      t,
                      locale,
                      rule.type,
                      rule.current?.value ?? rule.defaultValue,
                    ),
                  })}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name='date'
            render={({ field, fieldState }) => (
              <EffectiveFromFields
                formId={formId}
                mode={mode}
                date={field.value}
                onModeChange={(next) => form.setValue('mode', next)}
                onDateChange={field.onChange}
                dateError={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name='note'
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${formId}-note`}>
                  {t('platform.rules.fields.note')}
                </FieldLabel>
                <Textarea
                  {...field}
                  id={`${formId}-note`}
                  rows={2}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </fieldset>
    </form>
  );
}
