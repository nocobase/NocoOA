import { Alert, AlertDescription } from '#components/ui/alert';
import { useEffect, useRef, useState } from 'react';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Failure, Loading } from '../work-items/states.js';
import { FileList } from '../../extensions/nocobase-file-component-ui/index.js';
import type { FileRecord } from '@nocobase/app-plugin-file/client';
export function Attachments({
  id,
  taskId,
  ids,
}: {
  id: string;
  taskId: string;
  ids: string[];
}) {
  const api = useApiClient(),
    [r, setR] = useState<{
      key: string;
      files?: FileRecord[];
      error?: unknown;
    }>();
  const key = JSON.stringify([id, ids]);
  useEffect(() => {
    if ((JSON.parse(key) as [string, string[]])[1].length === 0) return;
    const controllerRef = new AbortController();
    api
      .request<{ data: FileRecord[] }>({
        method: 'POST',
        path: 'onboardingAttachments/findMany',
        headers: { 'x-onboarding-id': id, 'x-onboarding-task-id': taskId },
        json: {
          filter: {
            kind: 'filter',
            version: 1,
            root: {
              kind: 'group',
              logic: 'or',
              items: (JSON.parse(key) as [string, string[]])[1].map(
                (value) => ({
                  kind: 'condition',
                  path: ['id'],
                  operator: '$eq',
                  value,
                }),
              ),
            },
          },
          limit: 10,
        },
        signal: controllerRef.signal,
      })
      .then(
        ({ data }) => {
          if (!controllerRef.signal.aborted) setR({ key, files: data });
        },
        (error) => {
          if (!controllerRef.signal.aborted) setR({ key, error });
        },
      );
    return () => controllerRef.abort();
  }, [api, id, taskId, key]);
  if (!ids.length) return <span>—</span>;
  if (r?.key !== key) return <Loading />;
  if (r.error) return <Failure module='onboarding' error={r.error} />;
  return (
    <FileList files={r.files ?? []} onError={(error) => setR({ key, error })} />
  );
}

export function AttachmentEditor({
  id,
  taskId,
  ids,
  onChange,
  disabled,
  onBusy,
}: {
  id: string;
  taskId: string;
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const api = useApiClient(),
    { t } = useTranslation(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [validation, setValidation] = useState(false),
    lockedRef = useRef(false),
    controllerRef = useRef(new AbortController());
  useEffect(() => {
    const c = new AbortController();
    controllerRef.current = c;
    return () => c.abort();
  }, []);
  async function upload(file: File) {
    if (lockedRef.current || disabled || !id) return;
    if (
      !file.size ||
      file.size > 20 * 1024 * 1024 ||
      ids.length >= 10 ||
      !['pdf', 'png', 'jpg', 'jpeg', 'txt'].includes(
        file.name.split('.').at(-1)?.toLowerCase() ?? '',
      )
    ) {
      setValidation(true);
      return;
    }
    setValidation(false);
    lockedRef.current = true;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.request<{ data: { record: FileRecord } }>({
        method: 'POST',
        path: 'onboardingAttachments/uploadOne',
        headers: { 'x-onboarding-id': id, 'x-onboarding-task-id': taskId },
        body,
        signal: controllerRef.current.signal,
      });
      if (!controllerRef.current.signal.aborted) {
        await api.request({
          path: `onboardings/${id}`,
          signal: controllerRef.current.signal,
        });
        if (controllerRef.current.signal.aborted) return;
        onChange([...ids, data.record.id]);
      }
    } catch (e) {
      if (!controllerRef.current.signal.aborted) setError(e);
    } finally {
      if (!controllerRef.current.signal.aborted) {
        lockedRef.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-muted-foreground'>
        {t('onboarding.fileLimit')}
      </p>
      <Input
        type='file'
        aria-label={t('onboarding.upload')}
        accept='.pdf,.png,.jpg,.jpeg,.txt'
        disabled={disabled || busy || !id || ids.length >= 10}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      {busy ? <p role='status'>{t('onboarding.uploading')}</p> : null}
      {validation && (
        <Alert variant='destructive'>
          <AlertDescription>{t('onboarding.fileLimit')}</AlertDescription>
        </Alert>
      )}
      {error ? <Failure module='onboarding' error={error} /> : null}
      {id ? <Attachments id={id} taskId={taskId} ids={ids} /> : null}
      {ids.map((fileId, index) => (
        <Button
          key={fileId}
          type='button'
          variant='outline'
          disabled={disabled || busy}
          onClick={() => onChange(ids.filter((v) => v !== fileId))}
        >
          {t('onboarding.removeFile', { number: index + 1 })}
        </Button>
      ))}
    </div>
  );
}
