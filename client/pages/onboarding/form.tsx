import { createRequestKey } from '#lib/request-key';
import { format, parseISO } from 'date-fns';
import { DatePicker } from '#components/date-picker';
import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { RouteDrawer } from '#components/route-drawer';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Mentor } from './mentor.js';
import { OptionSelect } from '../work-items/select.js';
import { Failure, Loading } from '../work-items/states.js';
import { useOnboardingResource, useViewerKey } from './resource.js';
import { resource, type Requisition } from './types.js';
import { Command } from './command.js';
import { ValidationFailure } from './validation.js';
export default function Page() {
  return <Form key={useViewerKey()} />;
}
function Form() {
  const { t } = useTranslation(),
    grant = useCan({ resource, action: 'create' }),
    salary = useCan({ resource, action: 'viewSalary' }),
    options = useOnboardingResource<{ data: { canCreate: boolean } }>(
      grant.can && !grant.isPending && salary.can && !salary.isPending
        ? 'onboardings/options'
        : null,
    ),
    sources = useOnboardingResource<{ data: (Requisition | null)[] }>(
      grant.can &&
        !grant.isPending &&
        salary.can &&
        !salary.isPending &&
        options.data?.data.canCreate
        ? 'requisitions'
        : null,
    );
  if (grant.isPending || salary.isPending || options.loading || sources.loading)
    return (
      <RouteDrawer title={t('onboarding.new')}>
        <Loading />
      </RouteDrawer>
    );
  if (
    !grant.can ||
    !salary.can ||
    !options.data?.data.canCreate ||
    grant.error ||
    salary.error ||
    options.error ||
    sources.error
  )
    return (
      <RouteDrawer title={t('onboarding.new')}>
        <Failure
          module='onboarding'
          denied={
            (!grant.can && !grant.error) ||
            (!salary.can && !salary.error) ||
            (!options.error && options.data?.data.canCreate === false)
          }
          error={grant.error ?? salary.error ?? options.error ?? sources.error}
          retry={() => {
            options.reload();
            sources.reload();
          }}
        />
      </RouteDrawer>
    );
  const candidates = (sources.data?.data ?? []).filter(
    (v): v is Requisition =>
      !!v &&
      v.status === 'recruiting' &&
      v.remaining > 0 &&
      Number.isInteger(v.version) &&
      !!v.departmentId &&
      !!v.positionId &&
      !!v.gradeId,
  );
  return <Create candidates={candidates} />;
}
function Create({ candidates }: { candidates: Requisition[] }) {
  const { t } = useTranslation(),
    [values, setValues] = useState<Record<string, string>>({}),
    [id] = useState(() => createRequestKey());
  const fields = [
    'name',
    'email',
    'password',
    'code',
    'hireDate',
    'careerStartDate',
    'probationEndDate',
    'baseSalary',
    'reason',
    'workstationRequirement',
  ];
  return (
    <Command
      printable
      title={t('onboarding.new')}
      submitLabel={t('onboarding.new')}
      path='onboardings'
      clear={() => setValues({})}
      body={() => {
        const source = candidates.find((v) => v.id === values.requisitionId);
        const messages: Record<string, string> = {};
        for (const key of [
          'name',
          'email',
          'password',
          'code',
          'hireDate',
          'probationEndDate',
          'baseSalary',
          'reason',
          'mentorEmployeeId',
          'workstationRequirement',
        ])
          if (!values[key]?.trim())
            messages[`create-${key}`] = t('onboarding.requiredField', {
              field: t(`onboarding.fields.${key}`),
            });
        if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
          messages['create-email'] = t('onboarding.invalidEmail');
        if (values.password && values.password.length < 8)
          messages['create-password'] = t('onboarding.invalidPassword');
        if (values.baseSalary && !/^\d{1,12}\.\d{2}$/.test(values.baseSalary))
          messages['create-baseSalary'] = t('onboarding.invalidSalary');
        if (!source) messages.source = t('onboarding.chooseSource');
        const invalid = Object.keys(messages);
        if (invalid.length)
          throw new ValidationFailure(
            invalid.includes('source')
              ? ['source', ...invalid.filter((key) => key !== 'source')]
              : invalid,
            messages,
          );
        if (!source)
          throw new ValidationFailure(['source'], {
            source: t('onboarding.chooseSource'),
          });
        return {
          id,
          requisitionId: source.id,
          requisitionVersion: source.version,
          reason: values.reason,
          account: {
            name: values.name,
            email: values.email,
            password: values.password,
          },
          employee: {
            code: values.code,
            name: values.name,
            managerId: values.managerId || null,
            hireDate: values.hireDate,
            careerStartDate: values.careerStartDate || null,
            probationEndDate: values.probationEndDate,
          },
          baseSalary: values.baseSalary,
          mentorEmployeeId: values.mentorEmployeeId,
          workstationRequirement: values.workstationRequirement,
        };
      }}
    >
      {({ disabled, changed, invalid, errorFor }) => (
        <FieldGroup>
          <p className='text-muted-foreground'>
            {t('onboarding.createNotice')}
          </p>
          <Field>
            <FieldLabel htmlFor='source'>
              {t('onboarding.fields.requisitionId')} *
            </FieldLabel>
            <OptionSelect
              id='source'
              value={values.requisitionId ?? ''}
              invalid={invalid('source')}
              disabled={disabled}
              options={candidates.map((v) => ({
                value: v.id,
                label: `${v.id} · ${t('onboarding.remaining', { count: v.remaining })}`,
              }))}
              onChange={(value) => {
                changed('source');
                setValues((old) => ({ ...old, requisitionId: value }));
              }}
            />
            {invalid('source') ? (
              <FieldError>{errorFor('source')}</FieldError>
            ) : null}
            {!candidates.length ? <p>{t('onboarding.noSources')}</p> : null}
          </Field>
          {fields.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`create-${key}`}>
                {t(`onboarding.fields.${key}`)}
                {key !== 'careerStartDate' ? ' *' : ''}
              </FieldLabel>
              {['reason', 'workstationRequirement'].includes(key) ? (
                <Textarea
                  id={`create-${key}`}
                  required
                  disabled={disabled}
                  maxLength={2000}
                  value={values[key] ?? ''}
                  onChange={(e) => {
                    changed(`create-${key}`);
                    setValues((old) => ({ ...old, [key]: e.target.value }));
                  }}
                />
              ) : key.endsWith('Date') ? (
                <DatePicker
                  id={`create-${key}`}
                  value={values[key] ? parseISO(values[key]) : undefined}
                  disabled={disabled}
                  invalid={invalid(`create-${key}`)}
                  className='w-full'
                  onChange={(value) => {
                    changed(`create-${key}`);
                    setValues((old) => ({
                      ...old,
                      [key]: value ? format(value, 'yyyy-MM-dd') : '',
                    }));
                  }}
                />
              ) : (
                <Input
                  id={`create-${key}`}
                  required={key !== 'careerStartDate'}
                  aria-invalid={invalid(`create-${key}`) || undefined}
                  type={
                    key === 'password'
                      ? 'password'
                      : key === 'email'
                        ? 'email'
                        : 'text'
                  }
                  disabled={disabled}
                  maxLength={key === 'password' ? 128 : 200}
                  minLength={key === 'password' ? 8 : undefined}
                  autoComplete={key === 'password' ? 'new-password' : undefined}
                  inputMode={key === 'baseSalary' ? 'decimal' : undefined}
                  value={values[key] ?? ''}
                  onChange={(e) => {
                    changed(`create-${key}`);
                    setValues((old) => ({ ...old, [key]: e.target.value }));
                  }}
                />
              )}
              {invalid(`create-${key}`) ? (
                <FieldError>{errorFor(`create-${key}`)}</FieldError>
              ) : null}
            </Field>
          ))}
          <Field>
            <FieldLabel htmlFor='create-mentorEmployeeId'>
              {t('onboarding.fields.mentorEmployeeId')} *
            </FieldLabel>
            <Mentor
              id='create-mentorEmployeeId'
              invalid={invalid('create-mentorEmployeeId')}
              value={values.mentorEmployeeId ?? ''}
              exclude=''
              disabled={disabled}
              onChange={(value) => {
                changed('create-mentorEmployeeId');
                setValues((old) => ({ ...old, mentorEmployeeId: value }));
              }}
            />
            {invalid('create-mentorEmployeeId') ? (
              <FieldError>{errorFor('create-mentorEmployeeId')}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='manager'>
              {t('onboarding.fields.managerId')}
            </FieldLabel>
            <Mentor
              id='manager'
              value={values.managerId ?? ''}
              exclude=''
              disabled={disabled}
              onChange={(value) => {
                changed();
                setValues((old) => ({ ...old, managerId: value }));
              }}
            />
          </Field>
        </FieldGroup>
      )}
    </Command>
  );
}
