import { UserName } from '#components/user-name';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useState, useEffectEvent } from 'react';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '#components/ui/combobox';
import { ErrorState } from '../pages/approvals/states.js';
import type { Person } from '../pages/approvals/types.js';
export function ApprovalRecipientPicker({
  id,
  recordId,
  requestPath,
  taskId,
  target,
  action,
  value,
  onChange,
  disabled,
  focusRef,
  invalid,
  onBlur,
  searchCandidates,
}: {
  searchCandidates?: (
    search: string,
    signal: AbortSignal,
  ) => Promise<{ people: Person[]; nextOffset: number | null }>;
  focusRef?: (node: HTMLInputElement | null) => void;
  invalid?: boolean;
  onBlur?: () => void;
  id: string;
  recordId?: string;
  requestPath?:
    | 'leaveRequests'
    | 'overtimeRequests'
    | 'attendanceChangeRequests'
    | 'outingRequests'
    | 'generalRequests'
    | 'budgetAdjustments'
    | 'expensePlans'
    | 'trainingRequests'
    | 'loanRequests'
    | 'paymentRequests'
    | 'probationRequests'
    | 'departureRequests'
    | 'purchaseRequests'
    | 'reimbursementRequests'
    | 'travelRequests'
    | 'travelCancellations'
    | 'leaveCancellations'
    | 'supplyRequests';
  taskId?: string;
  target?: { taskId: string } | { runId: string };
  action: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const clearSelection = useEffectEvent(() => onChange(''));
  const api = useApiClient();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Person | null>(null);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<unknown>();
  const [failedSearch, setFailedSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const targetTaskId =
    target && 'taskId' in target ? target.taskId : target ? undefined : taskId;
  const targetRunId = target && 'runId' in target ? target.runId : undefined;
  useEffect(() => {
    if ((!searchCandidates && !targetTaskId && !targetRunId) || !search.trim())
      return;
    const abort = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const request = searchCandidates
        ? searchCandidates(search.trim(), abort.signal).then((data) => ({
            data,
          }))
        : api.request<{
            data: { people: Person[]; nextOffset: number | null };
          }>({
            signal: abort.signal,
            path: `${requestPath}/${encodeURIComponent(recordId ?? '')}/candidates`,
            query: {
              ...(targetRunId
                ? { runId: targetRunId }
                : { taskId: targetTaskId! }),
              action,
              search: search.trim(),
              offset: 0,
              limit: 50,
            },
          });
      void request
        .then(({ data }) => {
          if (disposed) return;
          setPeople(data.people.slice(0, 50));
          setError(undefined);
        })
        .catch((reason: unknown) => {
          if (!disposed) {
            setPeople([]);
            setSelected(null);
            clearSelection();
            setFailedSearch(search.trim());
            setError(reason);
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 300);
    return () => {
      disposed = true;
      abort.abort();
      clearTimeout(timer);
    };
  }, [
    api,
    searchCandidates,
    requestPath,
    recordId,
    targetTaskId,
    targetRunId,
    action,
    search,
    retry,
  ]);
  return (
    <div className='flex flex-col gap-2'>
      <Combobox
        items={
          selected &&
          selected.id === value &&
          !people.some((person) => person.id === value)
            ? [selected, ...people].slice(0, 50)
            : people
        }
        filter={null}
        value={
          people.find((person) => person.id === value) ??
          (selected?.id === value ? selected : null)
        }
        itemToStringLabel={(person: Person) => person.name}
        isItemEqualToValue={(a: Person, b: Person) => a.id === b.id}
        disabled={disabled}
        onValueChange={(person: Person | null) => {
          setSelected(person);
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
          ref={focusRef}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          placeholder={t('approvals.recipientSearch')}
          showClear={!!value && !disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {t(
              !search.trim()
                ? 'approvals.recipientSearch'
                : loading
                  ? 'userPicker.searching'
                  : 'userPicker.empty',
            )}
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
      {error ? (
        <ErrorState
          context='query'
          error={error}
          retry={() => {
            setSearch(failedSearch);
            setLoading(true);
            setRetry((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}
