import { useId } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import {
  requestActionDefinitions,
  requestActionGroups,
  type RequestActionAvailability,
} from '#components/request-action-definitions';

export function GroupedRequestActions({
  available,
}: {
  available: RequestActionAvailability;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const id = useId();
  // Rows accommodate unequal group sizes without leaving tall empty columns.
  return (
    <div className='divide-y divide-border'>
      {(
        [
          'office',
          'people',
          'finance',
          'procurement',
          'administration',
        ] as const
      ).map((group) => {
        const actions = requestActionDefinitions.filter(
          ({ key }) => available[key] && requestActionGroups[key] === group,
        );
        if (!actions.length) return null;
        return (
          <section
            key={group}
            aria-labelledby={`${id}-${group}`}
            className='grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_minmax(0,1fr)]'
          >
            <h3
              id={`${id}-${group}`}
              className='text-sm font-medium text-muted-foreground sm:pt-3'
            >
              {t(`workbench.groups.${group}`)}
            </h3>
            <div className='grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]'>
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={action.key}
                    data-slot='request-action-card'
                    variant='outline'
                    className='h-auto min-h-[44px] min-w-0 justify-start gap-2 px-3 py-2 text-left whitespace-normal'
                    nativeButton={false}
                    render={
                      <Link
                        to={{
                          pathname: action.to,
                          search: location.search,
                          hash: location.hash,
                        }}
                      />
                    }
                  >
                    <Icon aria-hidden='true' className='shrink-0' />
                    <span className='min-w-0 break-words'>
                      {t(action.label)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
