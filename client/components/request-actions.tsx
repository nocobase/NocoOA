import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  requestActionDefinitions,
  requestActionGroups,
  defaultRequestActions,
  type RequestActionAvailability,
  type RequestActionKey,
} from './request-action-definitions.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Star } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '#components/ui/dialog';

type Props = { available: RequestActionAvailability; onSelect?: () => void };

function ActionLink({
  action,
  onSelect,
}: {
  action: (typeof requestActionDefinitions)[number];
  onSelect?: () => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const Icon = action.icon;
  return (
    <Button
      data-slot='request-action-card'
      variant='outline'
      size='lg'
      className='h-16 w-full min-w-0 justify-start gap-3 px-4 text-left whitespace-normal has-data-[icon=inline-start]:pl-4'
      render={
        <Link
          to={{
            pathname: action.to,
            search: location.search,
            hash: location.hash,
          }}
        />
      }
      nativeButton={false}
      onClick={onSelect}
    >
      <Icon data-icon='inline-start' aria-hidden='true' />
      <span className='min-w-0 break-words'>{t(action.label)}</span>
    </Button>
  );
}

/** Shared catalog: permissions are resolved by each caller before presentation. */
export function RequestActions({
  available,
  onSelect,
  favorites,
  onFavorite,
}: Props & {
  favorites?: RequestActionKey[];
  onFavorite?: (key: RequestActionKey) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const actions = requestActionDefinitions.filter(
    ({ key, label }) =>
      available[key] &&
      t(label).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className='space-y-4'>
      <Input
        aria-label={t('workbench.searchRequests')}
        placeholder={t('workbench.searchRequests')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {!actions.length ? (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('workbench.noMatchingRequests')}
        </p>
      ) : null}
      {(
        [
          'office',
          'people',
          'finance',
          'procurement',
          'administration',
        ] as const
      ).map((group) => {
        const rows = actions.filter(
          ({ key }) => requestActionGroups[key] === group,
        );
        return rows.length ? (
          <section key={group} className='space-y-2'>
            <h3 className='text-sm font-medium'>
              {t(`workbench.groups.${group}`)}
            </h3>
            <div className='grid gap-3 sm:grid-cols-2'>
              {rows.map((action) => (
                <div
                  key={action.key}
                  className='flex min-w-0 items-center gap-1'
                >
                  <div className='min-w-0 flex-1'>
                    <ActionLink action={action} onSelect={onSelect} />
                  </div>
                  {onFavorite && favorites ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            variant='ghost'
                            size='icon'
                            className='shrink-0'
                            aria-label={t('workbench.favorite', {
                              name: t(action.label),
                            })}
                            aria-pressed={favorites.includes(action.key)}
                            disabled={
                              favorites.length >= 6 &&
                              !favorites.includes(action.key)
                            }
                            onClick={() => onFavorite(action.key)}
                          />
                        }
                      >
                        <Star
                          className={
                            favorites.includes(action.key)
                              ? 'fill-current'
                              : undefined
                          }
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('workbench.favorite', { name: t(action.label) })}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null;
      })}
    </div>
  );
}

export function FavoriteRequestActions(props: Props) {
  const { session } = useAuthentication();
  // Remount on account changes: never show another user's browser preferences.
  return (
    <FavoriteActionsForUser
      key={session?.user.id ?? ''}
      {...props}
      userId={session?.user.id ?? ''}
    />
  );
}
function FavoriteActionsForUser({
  available,
  userId,
}: Props & { userId: string }) {
  const { t } = useTranslation();
  const storageKey = `nb3-oa:request-favorites:${userId}`;
  const [saved, setSaved] = useState<RequestActionKey[] | null>(() => {
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? 'null',
      );
      return Array.isArray(value)
        ? [
            ...new Set(
              value.filter((key): key is RequestActionKey =>
                requestActionDefinitions.some((action) => action.key === key),
              ),
            ),
          ].slice(0, 6)
        : null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const defaults = [
    ...defaultRequestActions,
    ...requestActionDefinitions.map(({ key }) => key),
  ];
  const favorites = [...new Set(saved ?? defaults)]
    .filter((key) => available[key])
    .slice(0, 6);
  const save = (value: RequestActionKey[] | null) => {
    setSaved(value);
    try {
      if (value === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(value));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  };
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
        {favorites.map((key) => (
          <ActionLink
            key={key}
            action={requestActionDefinitions.find(
              (action) => action.key === key,
            )!}
          />
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant='outline' />}>
          {t('workbench.allRequests')}
        </DialogTrigger>
        <DialogContent className='grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('workbench.allRequests')}</DialogTitle>
            <DialogDescription>
              {t('workbench.favoritesHint')}
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 overflow-y-auto'>
            <RequestActions
              available={available}
              onSelect={() => setOpen(false)}
              favorites={favorites}
              onFavorite={(key) =>
                save(
                  favorites.includes(key)
                    ? favorites.filter((item) => item !== key)
                    : [...favorites, key].slice(0, 6),
                )
              }
            />
          </div>
          <div className='space-y-2'>
            {saveFailed ? (
              <p role='alert' className='text-sm text-destructive'>
                {t('workbench.saveFailed')}
              </p>
            ) : null}
            <Button variant='outline' onClick={() => save(null)}>
              {t('workbench.resetFavorites')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
