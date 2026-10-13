import { UserName } from '#components/user-name';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Failure, Loading } from '../work-items/states.js';
import { useOnboardingResource } from './resource.js';
import type { Person } from './types.js';
export function TransferTarget({
  id,
  taskId,
  value,
  onChange,
  disabled,
}: {
  id: string;
  taskId: string;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const r = useOnboardingResource<{ data: Person[] }>(
    `onboardings/${id}/tasks/${encodeURIComponent(taskId)}/transferCandidates`,
  );
  if (r.loading) return <Loading />;
  if (r.error) return <Failure module='onboarding' error={r.error} />;
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v ?? '')}
      disabled={disabled}
    >
      <SelectTrigger id='transfer-target'>
        <SelectValue placeholder={t('onboarding.transferTarget')}>
          {value ? (
            <UserName
              name={
                r.data?.data.find((p) => p.id === value)?.name ??
                t('onboarding.unavailable')
              }
            />
          ) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
        {r.data?.data.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <UserName
              name={p.name}
              className='[&>span:last-child]:whitespace-normal [&>span:last-child]:overflow-visible [&>span:last-child]:text-clip'
            />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
