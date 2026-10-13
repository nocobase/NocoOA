import { useRouteFormCloseGuard } from '#hooks/use-route-form-close-guard';
import { useState, useRef } from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import {
  useApiClient,
  useToaster,
  useNavigationGuard,
} from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteFormPage } from '#components/route-form-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Checkbox } from '#components/ui/checkbox';
import { Card, CardContent } from '#components/ui/card';
import { Spinner } from '#components/ui/spinner';
import { ConfirmDialog } from '../administration/authorization/components/confirm-dialog.js';
import { titleText } from '../administration/authorization/i18n.js';
import { useCatalog, useSnapshot } from './hooks.js';
import { operationSummary, sensitiveSummary } from './model.js';
import { Blank, ErrorState, Loading } from './ui.js';
import type { AccessSnapshot, AuthorizationOptions } from './types.js';
export default function AssignPage() {
  const { t: drawerTitle } = useTranslation();
  const location = useLocation();
  const parent = useOutletContext<{ reload: () => void }>();
  const snapshot = useSnapshot();
  const catalog = useCatalog();
  return (
    <RouteFormPage presentation='page' title={drawerTitle('access.assign')}>
      {snapshot.error || catalog.error ? (
        <ErrorState
          error={snapshot.error ?? catalog.error}
          backTo={`${location.pathname.replace(/\/assign$/, '')}${location.search}`}
          onBack={parent?.reload}
          retry={() => {
            snapshot.reload();
            catalog.reload();
          }}
        />
      ) : snapshot.data && catalog.options ? (
        <AssignmentForm
          key={snapshot.data.revision}
          snapshot={snapshot.data}
          options={catalog.options}
          reloadSnapshot={snapshot.reload}
        />
      ) : (
        <Loading />
      )}
    </RouteFormPage>
  );
}
function AssignmentForm({
  snapshot,
  options,
  reloadSnapshot,
}: {
  snapshot: AccessSnapshot;
  options: AuthorizationOptions;
  reloadSnapshot: () => void;
}) {
  const { type, id, userId } = useParams();
  const subject = {
    type: userId ? 'user' : (type ?? ''),
    id: userId ?? id ?? '',
  };
  const { name, reload, assignmentsSaved } = useOutletContext<{
    name: string;
    reload: () => void;
    assignmentsSaved?: (data: AccessSnapshot) => void | Promise<void>;
  }>();
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const before = snapshot.assignments
    .filter(
      (entry) =>
        entry.subject.type === subject.type && entry.subject.id === subject.id,
    )
    .map((entry) => entry.permissionSet);
  const choices = snapshot.sets.filter(
    (set) =>
      (!set.protection ||
        (set.protection.allow.includes('assign') &&
          set.protection.allow.includes('revoke'))) &&
      (!set.protection?.assignableTo ||
        set.protection.assignableTo.includes(subject.type)),
  );
  const managed = choices.map((set) => set.key);
  const [selected, setSelected] = useState(
    before.filter((key) => managed.includes(key)),
  );
  const changed = managed.filter(
    (key) => before.includes(key) !== selected.includes(key),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const allowLeaveRef = useRef(false);
  useRouteFormCloseGuard(() => {
    if (busy) return false;
    if (allowLeaveRef.current || !changed.length) return true;
    setDiscard(true);
    return false;
  });
  useNavigationGuard(
    () =>
      allowLeaveRef.current ||
      (!busy && (!changed.length || window.confirm(t('access.discardHelp')))),
  );
  const close = () => {
    allowLeaveRef.current = true;
    void navigate(`..${location.search}`, { relative: 'path' });
  };
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.request<{ data: AccessSnapshot }>({
        path: `access/subjects/${encodeURIComponent(subject.type)}/${encodeURIComponent(subject.id)}/assignments`,
        method: 'PUT',
        json: {
          expectedRevision: snapshot.revision,
          managedPermissionSets: managed,
          permissionSets: selected,
        },
      });
      if (assignmentsSaved) await assignmentsSaved(saved.data);
      else reload();
      close();
      toaster.show({ type: 'success', title: t('access.saved', { name }) });
    } catch (cause) {
      setError(cause);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageContainer>
      <PageHeader
        title={t('access.assignTitle', { name })}
        description={t('access.assignHelp')}
      />
      {error ? (
        <ErrorState
          error={error}
          retry={reloadSnapshot}
          backTo={`${location.pathname.replace(/\/assign$/, '')}${location.search}`}
          onBack={reload}
        />
      ) : null}
      {choices.length ? (
        <div className='flex flex-col gap-4'>
          {choices.map((set) => (
            <Card key={set.key}>
              <CardContent className='flex gap-3'>
                <Checkbox
                  id={`assign-${set.key}`}
                  checked={selected.includes(set.key)}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    setSelected((value) =>
                      checked
                        ? [...value, set.key]
                        : value.filter((key) => key !== set.key),
                    )
                  }
                />
                <label
                  htmlFor={`assign-${set.key}`}
                  className='flex min-w-0 flex-col gap-2'
                >
                  <span className='font-medium'>
                    {titleText(set.title, t, t('access.permissions'))}
                  </span>
                  {sensitiveSummary(options, set).length ? (
                    <span className='text-sm'>
                      <Badge variant='outline'>{t('access.sensitive')}</Badge>{' '}
                      {sensitiveSummary(options, set).join('、')}
                    </span>
                  ) : null}
                  <span className='text-sm text-muted-foreground'>
                    {set.unrestricted
                      ? t('access.unrestricted')
                      : operationSummary(options, set).join('、') ||
                        t('access.special')}
                  </span>
                </label>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Blank
          title={t('access.noAssignable')}
          description={t('access.noneHelp')}
        />
      )}
      <p className='text-sm text-muted-foreground'>
        {t('access.preserveInherited')}
      </p>
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => (changed.length ? setDiscard(true) : close())}
        >
          {t('access.cancel')}
        </Button>
        <Button
          disabled={busy || !changed.length}
          onClick={() => setConfirm(true)}
        >
          {busy ? <Spinner /> : null}
          {t('access.save')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('access.confirmTitle', { name })}
        confirmLabel={t('access.save')}
        cancelLabel={t('access.cancel')}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void save()}
      >
        {t('access.assignmentImpact')}
        <span className='block mt-2'>
          {changed
            .map(
              (key) =>
                `${selected.includes(key) ? '+' : '−'} ${titleText(snapshot.sets.find((set) => set.key === key)?.title, t)}: ${operationSummary(
                  options,
                  snapshot.sets.find((set) => set.key === key)!,
                ).join('、')}`,
            )
            .join('；')}
        </span>
      </ConfirmDialog>
      <ConfirmDialog
        open={discard}
        title={t('access.discardTitle')}
        confirmLabel={t('access.discard')}
        cancelLabel={t('access.cancel')}
        onCancel={() => setDiscard(false)}
        onConfirm={close}
      >
        {t('access.discardHelp')}
      </ConfirmDialog>
    </PageContainer>
  );
}
