import { validCommittee } from './configuration-model.js';
import { createRequestId } from '../approvals/request-id.js';
import { finalRefusal } from './errors.js';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Checkbox } from '#components/ui/checkbox';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from '#components/ui/field';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { useResource } from '../approvals/use-resource.js';
import { ErrorState } from './states.js';
import { CandidatePicker } from './candidate-picker.js';
import { Choice } from './shared.js';
import type { Configuration, Committee } from './types.js';
const sources = [
  'purchasing',
  'finance',
  'applicantHead',
  'technical',
  'legal',
] as const;
export default function ConfigurationPage() {
  const { t } = useTranslation(),
    { session } = useAuthentication(),
    grant = useCan({
      resource: { type: 'composite', id: 'oa.vendorQualification' },
      action: 'manage',
    }),
    allowed = grant.can && !grant.isPending && !grant.error;
  const resource = useResource<Configuration>(
    allowed ? 'vendorQualifications/configuration' : null,
    { viewer: session?.user.id ?? '' },
  );
  const data = resource.data;
  return (
    <PageContainer>
      <PageHeader title={t('vendorQualifications.configuration.title')} />
      {!allowed && !grant.isPending ? (
        <p>{t('vendorQualifications.errors.forbidden')}</p>
      ) : resource.error ? (
        <ErrorState error={resource.error} retry={resource.reload} />
      ) : !data ? (
        <FieldsSkeleton fields={8} />
      ) : (
        <>
          <Structure
            key={`${session?.user.id}:${data.versions.map((v) => v.version).join(',')}`}
            data={data}
            reload={resource.reload}
            disabled={!allowed || resource.loading}
          />
          <Assignments
            key={`${session?.user.id}:${JSON.stringify(data.assignments)}`}
            data={data}
            reload={resource.reload}
            disabled={!allowed || resource.loading}
          />
          <Removal
            key={`${session?.user.id}:${data.removalHead?.version}`}
            data={data}
            reload={resource.reload}
            disabled={!allowed || resource.loading}
          />
        </>
      )}
    </PageContainer>
  );
}
export function Structure({
  data,
  reload,
  disabled,
  compact = false,
  onSubmittingChange,
  onBlockedChange,
  onSaved,
  formId,
}: {
  data: Configuration;
  reload: () => void;
  disabled: boolean;
  compact?: boolean;
  onSubmittingChange?: (busy: boolean) => void;
  onBlockedChange?: (blocked: boolean) => void;
  onSaved?: () => void;
  formId?: string;
}) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster();
  const highest = Math.max(...data.versions.map((v) => v.version));
  const [structure, setStructure] = useState<Committee>(() => ({
      ...data.versions.find((v) => v.version === highest)!,
      version: highest + 1,
      seats: data.versions
        .find((v) => v.version === highest)!
        .seats.map((s) => ({ ...s })),
    })),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState(false),
    [blocked, setBlocked] = useState(false);
  const lockRef = useRef(false);
  const [seatKeys, setSeatKeys] = useState(() =>
    structure.seats.map(() => createRequestId()),
  );
  async function publish() {
    if (disabled || blocked || lockRef.current) return;
    if (
      !validCommittee(structure) ||
      structure.version <= highest ||
      !reason.trim()
    ) {
      setInvalid(true);
      return;
    }
    lockRef.current = true;
    setBusy(true);
    onSubmittingChange?.(true);
    try {
      await api.request({
        method: 'POST',
        path: 'vendorQualifications/configuration/versions',
        json: { ...structure, reason },
      });
      toaster.show({
        type: 'success',
        title: t('vendorQualifications.configuration.published', {
          version: structure.version,
        }),
      });
      if (onSaved) onSaved();
      else reload();
    } catch (cause) {
      setError(cause);
      // Invalid input can be corrected in place; ambiguous writes and stale versions require a refresh.
      const mustRefresh =
        !(cause instanceof ApiClientError) ||
        ![400, 412].includes(cause.status);
      setBlocked(mustRefresh);
      onBlockedChange?.(mustRefresh);
      reload();
    } finally {
      lockRef.current = false;
      setBusy(false);
      onSubmittingChange?.(false);
    }
  }
  const locked = disabled || busy || blocked;
  return (
    <ConfigurationSection
      compact={compact}
      title={t('vendorQualifications.configuration.structure')}
    >
      <p className='text-sm text-muted-foreground'>
        {t('vendorQualifications.configuration.active', {
          version: data.activeCommitteeVersion,
        })}
      </p>
      <p>{t('vendorQualifications.configuration.restartRequired')}</p>
      <ul>
        {data.versions.map((v) => (
          <li key={v.version}>
            {t('vendorQualifications.committeeVersion', {
              version: v.version,
            })}{' '}
            · {t('vendorQualifications.configuration.min')}: {v.min}
          </li>
        ))}
      </ul>
      {!!error && (
        <ErrorState
          error={error}
          retry={() => {
            reload();
            setBlocked(false);
            onBlockedChange?.(false);
          }}
        />
      )}
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
        className='flex flex-col gap-4'
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='committee-version'>
              {t('vendorQualifications.configuration.version')} *
            </FieldLabel>
            <Input
              id='committee-version'
              type='number'
              min={highest + 1}
              value={structure.version}
              disabled={locked}
              onChange={(event) =>
                setStructure((v) => ({
                  ...v,
                  version: Number(event.target.value),
                }))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='committee-min'>
              {t('vendorQualifications.configuration.min')} *
            </FieldLabel>
            <Input
              id='committee-min'
              type='number'
              min={1}
              max={structure.seats.length}
              value={structure.min}
              disabled={locked}
              onChange={(event) =>
                setStructure((v) => ({
                  ...v,
                  min: Number(event.target.value),
                }))
              }
            />
          </Field>
          {structure.seats.map((seat, index) => (
            <div
              key={seatKeys[index]}
              className='flex flex-wrap items-end gap-2'
            >
              <Field>
                <FieldLabel htmlFor={`seat-key-${index}`}>
                  {t('vendorQualifications.configuration.seatKey')} *
                </FieldLabel>
                <Input
                  id={`seat-key-${index}`}
                  maxLength={48}
                  value={seat.key}
                  disabled={locked}
                  onChange={(event) =>
                    setStructure((v) => ({
                      ...v,
                      seats: v.seats.map((s, i) =>
                        i === index ? { ...s, key: event.target.value } : s,
                      ),
                    }))
                  }
                />
              </Field>
              <Choice
                label={t('vendorQualifications.configuration.source')}
                value={seat.source}
                disabled={locked}
                items={sources.map((source) => ({
                  value: source,
                  label: t(`vendorQualifications.sources.${source}`),
                }))}
                onChange={(value) =>
                  setStructure((v) => ({
                    ...v,
                    seats: v.seats.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            source:
                              value as Committee['seats'][number]['source'],
                          }
                        : s,
                    ),
                  }))
                }
              />
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={seat.veto}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    setStructure((v) => ({
                      ...v,
                      seats: v.seats.map((s, i) =>
                        i === index ? { ...s, veto: !!checked } : s,
                      ),
                    }))
                  }
                />
                {t('vendorQualifications.configuration.veto')}
              </label>
              <Button
                type='button'
                variant='outline'
                disabled={locked || structure.seats.length <= 3}
                onClick={() => {
                  setSeatKeys((keys) => keys.filter((_, i) => i !== index));
                  setStructure((v) => ({
                    ...v,
                    seats: v.seats.filter((_, i) => i !== index),
                  }));
                }}
              >
                {t('vendorQualifications.configuration.removeSeat')}
              </Button>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={locked || structure.seats.length >= 32}
            onClick={() => {
              setSeatKeys((keys) => [...keys, createRequestId()]);
              setStructure((v) => ({
                ...v,
                seats: [
                  ...v.seats,
                  {
                    key: `technical${v.seats.length}`,
                    source: 'technical',
                    veto: false,
                  },
                ],
              }));
            }}
          >
            {t('vendorQualifications.configuration.addSeat')}
          </Button>
          <Field>
            <FieldLabel htmlFor='committee-reason'>
              {t('vendorQualifications.configuration.reason')} *
            </FieldLabel>
            <Input
              id='committee-reason'
              value={reason}
              maxLength={4000}
              disabled={locked}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {invalid && (
            <FieldError>
              {t('vendorQualifications.configuration.invalid')}
            </FieldError>
          )}
        </FieldGroup>
        <div className={compact ? 'hidden' : 'flex justify-end'}>
          <Button type='submit' disabled={locked}>
            {t(
              busy
                ? 'vendorQualifications.common.saving'
                : 'vendorQualifications.configuration.publish',
            )}
          </Button>
        </div>
      </form>
    </ConfigurationSection>
  );
}
function Assignments({
  data,
  reload,
  disabled,
}: {
  data: Configuration;
  reload: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const version = Math.max(...data.versions.map((v) => v.version));
  const structure = data.versions.find((v) => v.version === version)!;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('vendorQualifications.configuration.assignments')}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <p>{t('vendorQualifications.configuration.futureOnly')}</p>
        {structure.seats.map((seat) =>
          seat.source === 'applicantHead' ? (
            <p key={seat.key}>
              {t('vendorQualifications.configuration.dynamicHead')}
            </p>
          ) : (
            <Assignment
              key={seat.key}
              data={data}
              version={version}
              seat={seat}
              reload={reload}
              disabled={disabled}
            />
          ),
        )}
      </CardContent>
    </Card>
  );
}
function Assignment({
  data,
  version,
  seat,
  reload,
  disabled,
}: {
  data: Configuration;
  version: number;
  seat: Committee['seats'][number];
  reload: () => void;
  disabled: boolean;
}) {
  const existing = data.assignments
    .flat()
    .find((a) => a.committeeVersion === version && a.seatKey === seat.key);
  return (
    <PersonSetting
      data={data}
      disabled={disabled}
      reload={reload}
      source={
        seat.source as Exclude<
          Committee['seats'][number]['source'],
          'applicantHead'
        >
      }
      personId={existing?.personId ?? null}
      expectedVersion={existing?.version ?? 0}
      path='vendorQualifications/configuration/assignments'
      extra={{ committeeVersion: version, seatKey: seat.key }}
      name={seat.key}
    />
  );
}
function Removal({
  data,
  reload,
  disabled,
}: {
  data: Configuration;
  reload: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('vendorQualifications.configuration.removal')}</CardTitle>
      </CardHeader>
      <CardContent>
        <PersonSetting
          data={data}
          disabled={disabled}
          reload={reload}
          source='purchasing'
          personId={data.removalHead?.personId ?? null}
          expectedVersion={data.removalHead?.version ?? 0}
          path='vendorQualifications/configuration/removalHead'
          extra={{}}
          name='removalHead'
        />
      </CardContent>
    </Card>
  );
}
export function PersonSetting({
  data,
  reload,
  disabled,
  source,
  personId,
  expectedVersion,
  path,
  extra,
  name,
  compact = false,
  onSubmittingChange,
  onBlockedChange,
  onSaved,
  formId,
}: {
  data: Configuration;
  reload: () => void;
  disabled: boolean;
  source: 'purchasing' | 'finance' | 'technical' | 'legal';
  personId: string | null;
  expectedVersion: number;
  path: string;
  extra: Record<string, string | number>;
  name: string;
  compact?: boolean;
  onSubmittingChange?: (busy: boolean) => void;
  onBlockedChange?: (blocked: boolean) => void;
  onSaved?: () => void;
  formId?: string;
}) {
  const api = useApiClient(),
    { t } = useTranslation(),
    toaster = useToaster();
  const [person, setPerson] = useState(personId ?? ''),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState(false),
    [blocked, setBlocked] = useState(false);
  const lockRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (finalRefusal(error)) {
        setPerson('');
        setBlocked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [disabled, error]);
  async function save() {
    if (disabled || blocked || lockRef.current) return;
    if (!reason.trim()) {
      setInvalid(true);
      document.getElementById(`config-reason-${name}`)?.focus();
      return;
    }
    lockRef.current = true;
    setBusy(true);
    onSubmittingChange?.(true);
    try {
      await api.request({
        method: 'PATCH',
        path,
        json: { ...extra, personId: person || null, expectedVersion, reason },
      });
      toaster.show({
        type: 'success',
        title: t('vendorQualifications.savedNamed', {
          name: t(`vendorQualifications.sources.${source}`),
        }),
      });
      if (onSaved) onSaved();
      else reload();
    } catch (cause) {
      setError(cause);
      // Invalid input can be corrected in place; ambiguous writes and stale versions require a refresh.
      const mustRefresh =
        !(cause instanceof ApiClientError) ||
        ![400, 412].includes(cause.status);
      setBlocked(mustRefresh);
      onBlockedChange?.(mustRefresh);
      if (cause instanceof ApiClientError && cause.status === 409) reload();
    } finally {
      lockRef.current = false;
      setBusy(false);
      onSubmittingChange?.(false);
    }
  }
  return (
    <form
      id={formId}
      className={
        compact ? 'flex flex-col gap-4' : 'flex flex-col gap-4 border-b pb-4'
      }
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field>
        <FieldLabel htmlFor={`config-person-${name}`}>
          {t(`vendorQualifications.sources.${source}`)}
        </FieldLabel>
        <CandidatePicker
          id={`config-person-${name}`}
          path='vendorQualifications/configuration/candidates'
          query={{ source }}
          value={person}
          onChange={setPerson}
          known={data.knownUsers}
          disabled={disabled || busy || blocked}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`config-reason-${name}`}>
          {t('vendorQualifications.configuration.reason')} *
        </FieldLabel>
        <Input
          id={`config-reason-${name}`}
          value={reason}
          maxLength={4000}
          disabled={disabled || busy || blocked}
          onChange={(event) => {
            setReason(event.target.value);
            setInvalid(false);
          }}
        />
        {invalid && (
          <FieldError>{t('vendorQualifications.common.required')}</FieldError>
        )}
      </Field>
      {!!error && (
        <ErrorState
          error={error}
          retry={() => {
            reload();
            setBlocked(false);
            onBlockedChange?.(false);
          }}
        />
      )}
      <div className={compact ? 'hidden' : 'flex justify-end'}>
        <Button type='submit' disabled={disabled || busy || blocked}>
          {t(
            busy
              ? 'vendorQualifications.common.saving'
              : 'vendorQualifications.common.save',
          )}
        </Button>
      </div>
    </form>
  );
}

function ConfigurationSection({
  compact,
  title,
  children,
}: {
  compact: boolean;
  title: string;
  children: ReactNode;
}) {
  return compact ? (
    <div className='flex flex-col gap-4'>{children}</div>
  ) : (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>{children}</CardContent>
    </Card>
  );
}
