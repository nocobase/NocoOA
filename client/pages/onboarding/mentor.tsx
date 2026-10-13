import { useState } from 'react';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Input } from '#components/ui/input';
import { OptionSelect } from '../work-items/select.js';
import { Failure } from '../work-items/states.js';
import { useOnboardingResource } from './resource.js';
/** The directory owns visibility; completion still validates current employee activity in its transaction. */
export function Mentor({
  value,
  onChange,
  disabled,
  exclude,
  invalid,
  id = 'fact-mentorEmployeeId',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  exclude: string;
  id?: string;
  invalid?: boolean;
}) {
  const { t } = useTranslation(),
    [query, setQuery] = useState(''),
    grant = useCan({
      resource: { type: 'composite', id: 'oa.employees.directory' },
      action: 'view',
    }),
    allowed = grant.can && !grant.isPending && !grant.error,
    r = useOnboardingResource<{
      data: { id: string; name: string; code: string }[];
    }>(allowed ? 'directory' : null, { q: query, page: '1', pageSize: '100' });
  return allowed ? (
    <div className='flex flex-col gap-2'>
      <Input
        aria-label={t('onboarding.employeeSearch')}
        placeholder={t('onboarding.employeeSearch')}
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
      />
      <OptionSelect
        id={id}
        invalid={invalid}
        value={value}
        disabled={disabled || r.loading || !!r.error}
        onChange={onChange}
        options={(r.data?.data ?? [])
          .filter((v) => v.id !== exclude)
          .map((v) => ({ value: v.id, label: `${v.name} (${v.code})` }))}
      />
      {r.error ? (
        <Failure module='onboarding' error={r.error} retry={r.reload} />
      ) : null}
    </div>
  ) : (
    <p>{t('onboarding.mentorDenied')}</p>
  );
}
