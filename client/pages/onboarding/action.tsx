import { createRequestKey } from '#lib/request-key';
import { TransferTarget } from './transfer-target.js';
import { AttachmentEditor } from './attachments.js';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { RouteDrawer } from '#components/route-drawer';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from '#components/ui/field';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Failure, Loading } from '../work-items/states.js';
import { useOnboardingResource, useViewerKey } from './resource.js';
import { resource, fieldsFor, type Detail } from './types.js';
import { Command } from './command.js';
import { ValidationFailure } from './validation.js';
import { Mentor } from './mentor.js';
export default function Page() {
  return <Action key={useViewerKey()} />;
}
function Action() {
  const { t } = useTranslation(),
    { onboardingId = '', taskId, action = 'cancel' } = useParams(),
    r = useOnboardingResource<{ data: Detail }>(`onboardings/${onboardingId}`),
    grant = useCan({ resource, action }),
    d = r.data?.data,
    task = d?.tasks.find((v) => v.id === taskId),
    allowed =
      grant.can &&
      !grant.isPending &&
      !grant.error &&
      (taskId
        ? !!task && task.actions.includes(action as never)
        : action === 'cancel' && d?.canCancel);
  if (r.loading)
    return (
      <RouteDrawer title={t(`onboarding.actions.${action}`)}>
        <Loading />
      </RouteDrawer>
    );
  if (r.error || !d || !allowed)
    return (
      <RouteDrawer title={t('onboarding.unavailable')}>
        <Failure module='onboarding' error={r.error} denied={!r.error} />
      </RouteDrawer>
    );
  return (
    <Fields
      key={`${task?.version ?? d.record.version}:${action}`}
      detail={d}
      taskId={taskId}
      action={action}
    />
  );
}
function Fields({
  detail,
  taskId,
  action,
}: {
  detail: Detail;
  taskId?: string;
  action: string;
}) {
  const { t } = useTranslation(),
    task = detail.tasks.find((v) => v.id === taskId),
    fields = task && action === 'complete' ? fieldsFor(task.kind) : [],
    [facts, setFacts] = useState<Record<string, string>>({
      ...(task?.kind === 'it' ? { accountId: detail.record.userId } : {}),
    }),
    [reason, setReason] = useState(''),
    [targetUserId, setTargetUserId] = useState(''),
    [attachmentIds, setAttachmentIds] = useState<string[]>([]),
    [uploadBusy, setUploadBusy] = useState(false),
    [assetUnits, setAssetUnits] = useState<
      { key: string; code: string; serialNumber: string }[]
    >([]),
    assetGrant = useCan({
      resource: { type: 'composite', id: 'oa.assets' },
      action: task?.kind.startsWith('recovery:') ? 'returnHeld' : 'manage',
    });
  const assetTask =
    task &&
    ['it', 'administration', 'recovery:it', 'recovery:administration'].includes(
      task.kind,
    ) &&
    action === 'complete' &&
    assetGrant.can &&
    !assetGrant.isPending &&
    !assetGrant.error;
  const path = task
    ? `onboardings/${detail.record.id}/tasks/${encodeURIComponent(task.id)}/actions`
    : `onboardings/${detail.record.id}/cancel`;
  return (
    <Command
      title={t(`onboarding.actions.${action}`)}
      submitLabel={t(`onboarding.actions.${action}`)}
      destructive={action === 'cancel' || action === 'forceComplete'}
      confirmation={`${detail.record.user.name}: ${t(action === 'cancel' ? 'onboarding.cancelNotice' : 'onboarding.forceNotice')}`}
      path={path}
      externalBusy={uploadBusy}
      clear={() => {
        setFacts({});
        setReason('');
        setAssetUnits([]);
        setTargetUserId('');
        setAttachmentIds([]);
      }}
      body={() => {
        const missing = fields
          .filter((key) => !facts[key]?.trim())
          .map((key) => `fact-${key}`);
        if (
          assetUnits.some(
            (unit) => !unit.code.trim() || !unit.serialNumber.trim(),
          )
        )
          missing.push('asset-units');
        if (action === 'transfer' && !targetUserId)
          missing.push('transfer-target');
        if (!reason.trim()) missing.push('command-reason');
        if (missing.length)
          throw new ValidationFailure(
            missing,
            Object.fromEntries(
              missing.map((id) => [
                id,
                t('onboarding.requiredField', {
                  field:
                    id === 'transfer-target'
                      ? t('onboarding.transferTarget')
                      : id === 'asset-units'
                        ? t('onboarding.assetUnits')
                        : id === 'command-reason'
                          ? t('onboarding.reason')
                          : t(`onboarding.fields.${id.slice(5)}`),
                }),
              ]),
            ),
          );
        return {
          expectedVersion: task?.version ?? detail.record.version,
          reason: reason.trim(),
          ...(action === 'transfer' ? { targetUserId } : {}),
          ...(action === 'complete' && attachmentIds.length
            ? { attachmentIds }
            : {}),
          ...(assetUnits.length
            ? {
                assetUnits: assetUnits.map(({ code, serialNumber }) => ({
                  code,
                  serialNumber,
                })),
              }
            : {}),
          ...(task
            ? { action, ...(action === 'complete' ? { facts } : {}) }
            : {}),
        };
      }}
    >
      {({ disabled, changed, invalid, errorFor }) => (
        <FieldGroup>
          {action === 'reassignMentor' ? (
            <p className='text-muted-foreground'>
              {t('onboarding.reassignMentorNotice')}
            </p>
          ) : null}
          {action === 'forceComplete' ? (
            <p className='text-muted-foreground'>
              {t('onboarding.forceNotice')}
            </p>
          ) : null}
          {action === 'cancel' ? (
            <p className='text-muted-foreground'>
              {t('onboarding.cancelNotice')}
            </p>
          ) : null}
          {action === 'transfer' && task ? (
            <Field>
              <FieldLabel htmlFor='transfer-target'>
                {t('onboarding.transferTarget')} *
              </FieldLabel>
              <TransferTarget
                id={detail.record.id}
                taskId={task.id}
                value={targetUserId}
                disabled={disabled}
                onChange={(id) => {
                  changed('transfer-target');
                  setTargetUserId(id);
                }}
              />
              {invalid('transfer-target') ? (
                <FieldError>{errorFor('transfer-target')}</FieldError>
              ) : null}
            </Field>
          ) : null}
          {action === 'complete' &&
          task &&
          !['finance', 'recovery:finance'].includes(task.kind) ? (
            <Field>
              <FieldLabel>{t('onboarding.attachments')}</FieldLabel>
              <AttachmentEditor
                id={detail.record.id}
                taskId={task.id}
                ids={attachmentIds}
                disabled={disabled}
                onBusy={setUploadBusy}
                onChange={(ids) => {
                  changed('attachments');
                  setAttachmentIds(ids);
                }}
              />
            </Field>
          ) : null}
          {fields.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`fact-${key}`}>
                {t(`onboarding.fields.${key}`)} *
              </FieldLabel>
              {key === 'mentorEmployeeId' ? (
                <Mentor
                  invalid={invalid(`fact-${key}`)}
                  value={facts[key] ?? ''}
                  disabled={disabled}
                  exclude={detail.record.employeeId}
                  onChange={(value) => {
                    changed(`fact-${key}`);
                    setFacts((old) => ({ ...old, [key]: value }));
                  }}
                />
              ) : key === 'plan' ? (
                <Textarea
                  id={`fact-${key}`}
                  required
                  disabled={disabled}
                  aria-invalid={invalid(`fact-${key}`) || undefined}
                  value={facts[key] ?? ''}
                  maxLength={100000}
                  onChange={(e) => {
                    changed(`fact-${key}`);
                    setFacts((old) => ({ ...old, [key]: e.target.value }));
                  }}
                />
              ) : (
                <Input
                  id={`fact-${key}`}
                  required
                  disabled={disabled || key === 'accountId'}
                  aria-invalid={invalid(`fact-${key}`) || undefined}
                  value={facts[key] ?? ''}
                  maxLength={1000}
                  onChange={(e) => {
                    changed(`fact-${key}`);
                    setFacts((old) => ({ ...old, [key]: e.target.value }));
                  }}
                />
              )}
              {invalid(`fact-${key}`) ? (
                <FieldError>{errorFor(`fact-${key}`)}</FieldError>
              ) : null}
            </Field>
          ))}
          {assetTask ? (
            <Field id='asset-units'>
              <FieldLabel>{t('onboarding.assetUnits')}</FieldLabel>
              <p className='text-muted-foreground'>
                {t('onboarding.assetUnitsHelp')}
              </p>
              {assetUnits.map((unit, index) => (
                <div key={unit.key} className='flex gap-2'>
                  <Input
                    aria-label={t('onboarding.assetCode')}
                    placeholder={t('onboarding.assetCode')}
                    value={unit.code}
                    disabled={disabled}
                    maxLength={64}
                    onChange={(e) => {
                      changed('asset-units');
                      setAssetUnits((old) =>
                        old.map((u, i) =>
                          i === index ? { ...u, code: e.target.value } : u,
                        ),
                      );
                    }}
                  />
                  <Input
                    aria-label={t('onboarding.assetSerial')}
                    placeholder={t('onboarding.assetSerial')}
                    value={unit.serialNumber}
                    disabled={disabled}
                    maxLength={200}
                    onChange={(e) => {
                      changed('asset-units');
                      setAssetUnits((old) =>
                        old.map((u, i) =>
                          i === index
                            ? { ...u, serialNumber: e.target.value }
                            : u,
                        ),
                      );
                    }}
                  />
                  <Button
                    type='button'
                    variant='outline'
                    disabled={disabled}
                    onClick={() => {
                      changed('asset-units');
                      setAssetUnits((old) => old.filter((_, i) => i !== index));
                    }}
                  >
                    {t('onboarding.removeAsset')}
                  </Button>
                </div>
              ))}
              <Button
                type='button'
                variant='outline'
                disabled={disabled || assetUnits.length >= 100}
                onClick={() => {
                  changed('asset-units');
                  setAssetUnits((old) => [
                    ...old,
                    { key: createRequestKey(), code: '', serialNumber: '' },
                  ]);
                }}
              >
                {t('onboarding.addAsset')}
              </Button>
              {invalid('asset-units') ? (
                <FieldError>{errorFor('asset-units')}</FieldError>
              ) : null}
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor='command-reason'>
              {t('onboarding.reason')} *
            </FieldLabel>
            <Textarea
              id='command-reason'
              aria-invalid={invalid('command-reason') || undefined}
              required
              disabled={disabled}
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                changed('command-reason');
                setReason(e.target.value);
              }}
            />
            {invalid('command-reason') ? (
              <FieldError>{errorFor('command-reason')}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
      )}
    </Command>
  );
}
