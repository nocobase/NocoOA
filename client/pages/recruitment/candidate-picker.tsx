import { Button } from '#components/ui/button';
import { UserName } from '#components/user-name';
import { useEffect, useState, useEffectEvent } from 'react';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from '#components/ui/combobox';
import { Alert, AlertDescription } from '#components/ui/alert';
import { ApiClientError } from '@nocobase/app-client';
import { SessionExpiredAlert } from '#components/session-expired-alert';
import type { Person } from './types.js';
/** Both endpoints return already eligible named identities; no broad users query. */
export function CandidatePicker({
  path,
  query,
  value,
  onChange,
  disabled,
  id,
  known = [],
}: {
  path: string;
  query: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  id: string;
  known?: Person[];
}) {
  const clearSelection = useEffectEvent(() => onChange(''));
  const api = useApiClient(),
    { t } = useTranslation();
  const [remembered, setRemembered] = useState<Person | null>(null);
  const [failedSearch, setFailedSearch] = useState('');
  const [search, setSearch] = useState(''),
    [people, setPeople] = useState<Person[]>([]),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const queryKey = JSON.stringify(query),
    source = JSON.stringify([path, queryKey]);
  const [identity, setIdentity] = useState(source);
  const current = identity === source ? people : [];
  useEffect(() => {
    if (disabled || !search.trim()) return;
    let disposed = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void api
        .request<{ data: { people: Person[]; nextOffset: number | null } }>({
          path,
          query: {
            ...(JSON.parse(queryKey) as Record<string, string>),
            search: search.trim(),
            offset: '0',
            limit: '50',
          },
        })
        .then(({ data }) => {
          if (disposed) return;
          setIdentity(source);
          setPeople(data.people.slice(0, 50));
          setError(undefined);
        })
        .catch((cause: unknown) => {
          if (!disposed) {
            setPeople([]);
            setFailedSearch(search.trim());
            setError(cause);
            clearSelection();
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 300);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, path, queryKey, source, search, retry, disabled]);
  const selected =
    remembered?.id === value ? remembered : known.find((p) => p.id === value);
  const items =
    selected && !current.some((p) => p.id === value)
      ? [selected, ...current].slice(0, 50)
      : current;
  return (
    <div className='flex flex-col gap-2'>
      <Combobox
        items={items}
        filter={null}
        value={items.find((person) => person.id === value) ?? null}
        itemToStringLabel={(person: Person) => person.name}
        isItemEqualToValue={(a: Person, b: Person) => a.id === b.id}
        disabled={disabled}
        onValueChange={(person: Person | null) => {
          setRemembered(person);
          onChange(person?.id ?? '');
          if (person) {
            setSearch('');
            setPeople([]);
            setLoading(false);
          }
        }}
        onInputValueChange={(text, details) => {
          if (
            details.reason === 'input-change' ||
            (details.reason === 'input-clear' && !!value)
          ) {
            if (text === search) return;
            setSearch(text);
            setPeople([]);
            setError(undefined);
            setLoading(!!text.trim());
          }
        }}
      >
        <ComboboxInput
          id={id}
          placeholder={t('recruitment.recipientSearch')}
          showClear={!!value && !disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {t(loading ? 'userPicker.searching' : 'recruitment.noCandidates')}
          </ComboboxEmpty>
          <ComboboxList>
            {(person: Person) => (
              <ComboboxItem key={person.id} value={person}>
                <UserName name={person.name} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {!!error &&
        (error instanceof ApiClientError && error.status === 401 ? (
          <SessionExpiredAlert />
        ) : (
          <Alert variant='destructive'>
            <AlertDescription>
              {t(
                error instanceof ApiClientError && error.status === 403
                  ? 'recruitment.noAccess'
                  : 'recruitment.candidatesFailed',
              )}
            </AlertDescription>
            <Button
              type='button'
              variant='outline'
              disabled={disabled || loading}
              onClick={() => {
                setSearch(failedSearch);
                setLoading(true);
                setRetry((n) => n + 1);
              }}
            >
              {t('recruitment.retry')}
            </Button>
          </Alert>
        ))}
    </div>
  );
}
