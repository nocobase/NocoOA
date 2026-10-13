import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Field, FieldLabel } from '#components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '#components/ui/select';
import { OverlayCloseButton } from '../platform/shared/overlay-buttons.js';
import { FieldsSkeleton } from '../platform/shared/states.js';
import { RuleChangeForm } from '../platform/approval-rules/change-dialog.js';
import { ruleKeyId } from '../platform/approval-rules/rule-format.js';
import {
  PersonSetting,
  Structure,
} from '../vendor-qualifications/configuration.js';
import {
  rulesForNode,
  flowsUsingRule,
  committeeVersionForNode,
  hasVendorNodeSettings,
} from './node-settings.js';
import { useNodeSettings } from './use-node-settings.js';
import { Failure } from './shared.js';
import { useProcessText } from './text.js';
import type { DefinitionDto } from '../../../server/routes/process-management/schemas.js';
import type {
  Configuration,
  Committee,
} from '../vendor-qualifications/types.js';

export interface NodeSettingsContext {
  definition?: DefinitionDto;
  loading?: boolean;
  error?: unknown;
  reload: () => void;
}
const formIdFor = (topic: string) =>
  `process-node-setting-${encodeURIComponent(topic)}`;

export default function NodeSettingsDialog() {
  const { kind = '', node = '' } = useParams();
  const context = useOutletContext<NodeSettingsContext>();
  const text = useProcessText();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [blockedTopics, setBlockedTopics] = useState<Record<string, boolean>>(
    {},
  );
  const validNode =
    context.definition?.states.some((state) => state.name === node) ?? false;
  const keys = rulesForNode(kind, node);
  const vendorNode = hasVendorNodeSettings(kind, node);
  const settings = useNodeSettings(
    kind,
    validNode && !context.error && (keys.length > 0 || vendorNode),
  );
  const permitted = vendorNode
    ? settings.canManageVendor
    : settings.canUpdateRules;
  const resource = vendorNode ? settings.configuration : settings.rules;
  const configuration = settings.configuration.data?.data;
  const version = committeeVersionForNode(kind, node);
  const committee = configuration?.versions.find((v) => v.version === version);
  const topics = configuration
    ? node === 'removalReview'
      ? [
          {
            key: 'removal',
            label: t('vendorQualifications.configuration.removal'),
          },
        ]
      : [
          {
            key: 'structure',
            label: t('processManagement.nodeSettings.newCommittee'),
          },
          ...(committee?.seats
            .filter((seat) => seat.source !== 'applicantHead')
            .map((seat) => ({
              key: `seat:${seat.key}`,
              label: t('processManagement.nodeSettings.seat', {
                name: seat.key,
                version: committee.version,
              }),
            })) ?? []),
        ]
    : keys
        .filter((key) =>
          settings.rules.data?.data.some((rule) => rule.key === key),
        )
        .map((key) => ({
          key,
          label: t(`platform.rules.keys.${ruleKeyId(key)}.label`),
        }));
  const source = JSON.stringify([resource.identity, kind, node]);
  const [choice, setChoice] = useState<{ source: string; key: string }>();
  const selected =
    choice?.source === source &&
    topics.some((topic) => topic.key === choice.key)
      ? choice.key
      : (topics.find((topic) => topic.key === searchParams.get('rule'))?.key ??
        topics[0]?.key ??
        '');
  const available =
    validNode &&
    (keys.length > 0 || vendorNode) &&
    (!vendorNode || node === 'removalReview' || !!committee);
  const ready =
    available &&
    permitted &&
    !!resource.data &&
    !resource.loading &&
    !resource.error &&
    !context.error;
  let body: ReactNode;
  if (context.error)
    body = <Failure error={context.error} retry={context.reload} />;
  else if (!context.definition) body = <FieldsSkeleton fields={3} />;
  else if (!validNode || (!keys.length && !vendorNode))
    body = <p>{t('processManagement.nodeSettings.unavailable')}</p>;
  else if (!permitted)
    body = <p>{t('processManagement.nodeSettings.forbidden')}</p>;
  else if (resource.error && !resource.data)
    body = <Failure error={resource.error} retry={resource.reload} />;
  else if (!resource.data) body = <FieldsSkeleton fields={3} />;
  else if (!available || !topics.length)
    body = <p>{t('processManagement.nodeSettings.unavailable')}</p>;
  else
    body = (
      <>
        {!!resource.error && (
          <Failure error={resource.error} retry={resource.reload} />
        )}
        <NodeEditor
          key={source}
          selected={selected}
          topics={topics}
          onSelect={(key) => {
            if (!busyRef.current) setChoice({ source, key });
          }}
          configuration={configuration}
          committee={committee}
          rules={settings.rules.data?.data ?? []}
          busy={busy}
          disabled={resource.loading || !!resource.error}
          onSubmittingChange={(value) => {
            busyRef.current = value;
            setBusy(value);
          }}
          reload={resource.reload}
          onSaved={context.reload}
          onBlockedChange={(topic, value) =>
            setBlockedTopics((previous) => ({
              ...previous,
              [`${source}:${topic}`]: value,
            }))
          }
        />
      </>
    );
  return (
    <RouteDialog
      title={t('processManagement.nodeSettings.title', {
        name: text.state(node),
      })}
      description={text.name(kind)}
      className='sm:max-w-md'
      beforeClose={() => !busyRef.current}
      footer={
        <>
          <OverlayCloseButton
            label={t(ready ? 'actions.cancel' : 'actions.close')}
            disabled={busy}
          />
          {ready && (
            <Button
              type='submit'
              form={formIdFor(selected)}
              disabled={busy || blockedTopics[`${source}:${selected}`]}
            >
              {t(
                busy
                  ? 'actions.saving'
                  : selected === 'structure'
                    ? 'vendorQualifications.configuration.publish'
                    : 'actions.save',
              )}
            </Button>
          )}
        </>
      }
    >
      {body}
    </RouteDialog>
  );
}

import type { RuleSummary } from '../platform/shared/types.js';
function NodeEditor({
  selected,
  topics,
  onSelect,
  configuration,
  committee,
  rules,
  busy,
  disabled,
  onSubmittingChange,
  reload,
  onSaved,
  onBlockedChange,
}: {
  selected: string;
  topics: { key: string; label: string }[];
  onSelect: (key: string) => void;
  configuration?: Configuration;
  committee?: Committee;
  rules: RuleSummary[];
  busy: boolean;
  disabled: boolean;
  onSubmittingChange: (value: boolean) => void;
  reload: () => void;
  onSaved: () => void;
  onBlockedChange: (topic: string, blocked: boolean) => void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const text = useProcessText();
  const { close } = useRouteOverlay();
  const [visited, setVisited] = useState<ReadonlySet<string>>(
    () => new Set([selected]),
  );
  // Keep mounted drafts when switching topics; render-time adjustment is scoped to this component.
  if (!visited.has(selected)) setVisited(new Set([...visited, selected]));
  const mounted = new Set([...visited, selected]);
  const locked = busy || disabled;
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);
  function saved() {
    if (!activeRef.current) return;
    onSaved();
    void close();
  }
  if (!topics.length)
    return <p>{t('processManagement.nodeSettings.unavailable')}</p>;
  return (
    <div className='flex flex-col gap-4'>
      <Field>
        <FieldLabel htmlFor='process-node-topic'>
          {t('processManagement.nodeSettings.parameter')}
        </FieldLabel>
        <Select
          items={topics.map((topic) => ({
            value: topic.key,
            label: topic.label,
          }))}
          value={selected}
          disabled={locked}
          onValueChange={(next) => {
            if (next && !locked) onSelect(next);
          }}
        >
          <SelectTrigger id='process-node-topic'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
            <SelectGroup>
              {topics.map((topic) => (
                <SelectItem key={topic.key} value={topic.key}>
                  {topic.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <p className='text-sm text-muted-foreground'>
        {t('processManagement.nodeSettings.effect')}
      </p>
      {committee && configuration && (
        <p className='text-sm text-muted-foreground'>
          {t('processManagement.nodeSettings.committeeContext', {
            selected: committee.version,
            active: configuration.activeCommitteeVersion,
            latest: Math.max(...configuration.versions.map((v) => v.version)),
          })}
        </p>
      )}
      {topics
        .filter((topic) => mounted.has(topic.key))
        .map((topic) => {
          let editor: ReactNode;
          if (configuration) {
            const personProps = {
              data: configuration,
              reload,
              disabled: locked,
              compact: true,
              formId: formIdFor(topic.key),
              onSubmittingChange,
              onBlockedChange: (value: boolean) =>
                onBlockedChange(topic.key, value),
              onSaved: saved,
            };
            if (topic.key === 'structure')
              editor = <Structure {...personProps} />;
            else if (topic.key === 'removal')
              editor = (
                <PersonSetting
                  {...personProps}
                  source='purchasing'
                  personId={configuration.removalHead?.personId ?? null}
                  expectedVersion={configuration.removalHead?.version ?? 0}
                  path='vendorQualifications/configuration/removalHead'
                  extra={{}}
                  name='removalHead'
                />
              );
            else {
              const seat = committee?.seats.find(
                (entry) => `seat:${entry.key}` === topic.key,
              );
              const assignment = configuration.assignments
                .flat()
                .find(
                  (entry) =>
                    entry.committeeVersion === committee?.version &&
                    entry.seatKey === seat?.key,
                );
              editor =
                seat && seat.source !== 'applicantHead' && committee ? (
                  <PersonSetting
                    {...personProps}
                    source={seat.source}
                    personId={assignment?.personId ?? null}
                    expectedVersion={assignment?.version ?? 0}
                    path='vendorQualifications/configuration/assignments'
                    extra={{
                      committeeVersion: committee.version,
                      seatKey: seat.key,
                    }}
                    name={seat.key}
                  />
                ) : null;
            }
          } else {
            const rule = rules.find((item) => item.key === topic.key);
            const flows = flowsUsingRule(topic.key);
            editor = rule ? (
              <>
                {flows.length > 1 && (
                  <p className='text-sm text-muted-foreground'>
                    {t('processManagement.nodeSettings.shared', {
                      flows: flows
                        .map(text.name)
                        .join(locale.startsWith('zh') ? '、' : ', '),
                    })}
                  </p>
                )}
                <RuleChangeForm
                  rule={rule}
                  formId={formIdFor(topic.key)}
                  disabled={locked}
                  onSubmittingChange={onSubmittingChange}
                  onSaved={saved}
                />
              </>
            ) : null;
          }
          return (
            <div
              key={topic.key}
              hidden={selected !== topic.key}
              className={
                selected === topic.key ? 'flex flex-col gap-4' : 'hidden'
              }
            >
              {editor}
            </div>
          );
        })}
    </div>
  );
}
