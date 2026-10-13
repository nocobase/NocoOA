import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';

import { FieldsSkeleton, LoadErrorAlert } from '../shared/states.js';
import type { RuleSummary } from '../shared/types.js';
import { useResource } from '../shared/use-resource.js';
import { CALENDAR_SETTINGS } from './constants.js';
import { SpecialDaysCard } from './special-days-card.js';
import { TimeZoneCard } from './time-zone-card.js';
import { WorkHoursCard } from './work-hours-card.js';

/**
 * Route /work-calendar: the working window and time zone approval clocks count in (stored as the rule keys
 * `calendar.workHours` and `calendar.timeZone`), and each year's explicit days. Opens with read on
 * `oa.platform.calendar`; every write needs update, which the endpoints check and `useCan` mirrors.
 */
export default function WorkCalendarPage(): ReactElement {
  const { t } = useTranslation();
  const update = useCan({
    resource: { type: 'settings', id: CALENDAR_SETTINGS },
    action: 'update',
  });
  const rules = useResource<RuleSummary[]>('approvalRules', {
    area: 'calendar',
  });
  const workHours = rules.data?.find(
    (rule) => rule.key === 'calendar.workHours',
  );
  const timeZone = rules.data?.find((rule) => rule.key === 'calendar.timeZone');
  // Wait for the update check too, so an editable card never appears and then turns read-only.
  const ready = rules.data !== undefined && !update.isPending;
  const canUpdate = update.can && !update.error;

  let settings: ReactElement;
  if (rules.error) {
    settings = (
      <LoadErrorAlert
        error={rules.error}
        title={t('platform.calendar.loadFailedTitle')}
        onRetry={rules.reload}
      />
    );
  } else if (!ready || !workHours || !timeZone) {
    settings = (
      <div className='grid gap-6 lg:grid-cols-2'>
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardHeader>
              <CardTitle>
                {index === 0
                  ? t('platform.calendar.workHours.title')
                  : t('platform.calendar.timeZone.title')}
              </CardTitle>
              <CardDescription>
                {index === 0
                  ? t('platform.calendar.workHours.description')
                  : t('platform.calendar.timeZone.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldsSkeleton />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  } else {
    settings = (
      <div className='flex flex-col items-stretch gap-6 lg:flex-row [&>*]:min-w-0 [&>*]:flex-1'>
        <WorkHoursCard
          // A new key after a save mounts the form with the saved values as its defaults.
          key={`${workHours.current?.id ?? ''}:${workHours.scheduled.length}`}
          rule={workHours}
          canUpdate={canUpdate}
          onSaved={rules.reload}
        />
        <TimeZoneCard
          key={timeZone.current?.id ?? ''}
          rule={timeZone}
          canUpdate={canUpdate}
          onSaved={rules.reload}
        />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('platform.calendar.title')}
        description={t('platform.calendar.description')}
      />
      {settings}
      <SpecialDaysCard canUpdate={ready && canUpdate} />
    </PageContainer>
  );
}
