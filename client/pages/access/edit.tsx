import { useRouteFormCloseGuard } from '#hooks/use-route-form-close-guard';
import { useCallback, useState, useRef } from 'react';
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
import { PermissionEditor } from '#components/permission-editor';
import { Button } from '#components/ui/button';
import { Field, FieldLabel } from '#components/ui/field';
import { Input } from '#components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Spinner } from '#components/ui/spinner';
import { ConfirmDialog } from '../administration/authorization/components/confirm-dialog.js';
import { titleText } from '../administration/authorization/i18n.js';
import { useAuthorizationClient } from '../administration/authorization/use-authorization-client.js';
import { useCatalog, useLoad } from './hooks.js';
import { actionRows } from './model.js';
import { AccessModulePermissions } from './module-permissions.js';
import { resourceKey } from '../administration/authorization/pages/permission-sets/drafts.js';
import { Blank, ErrorState, Loading } from './ui.js';
import type { AuthorizationOptions, DefinitionSnapshot } from './types.js';

export default function EditPage() {
  const { t: drawerTitle } = useTranslation();
  const location = useLocation();
  const parent = useOutletContext<{ reload: () => void }>();
  const { permissionSetKey = '' } = useParams();
  const api = useApiClient();
  const catalog = useCatalog();
  const state = useLoad(
    useCallback(
      async () =>
        (
          await api.request<{ data: DefinitionSnapshot }>({
            path: `access/permissionSets/${encodeURIComponent(permissionSetKey)}`,
          })
        ).data,
      [api, permissionSetKey],
    ),
  );
  return (
    <RouteFormPage presentation='page' title={drawerTitle('access.edit')}>
      {state.error || catalog.error ? (
        <ErrorState
          error={state.error ?? catalog.error}
          backTo={`${location.pathname.split('/').slice(0, -2).join('/')}${location.search}`}
          onBack={parent?.reload}
          retry={() => {
            state.reload();
            catalog.reload();
          }}
        />
      ) : state.data && catalog.options ? (
        <EditorForm
          key={state.data.revision}
          snapshot={state.data}
          options={catalog.options}
          reloadSnapshot={state.reload}
        />
      ) : (
        <Loading />
      )}
    </RouteFormPage>
  );
}
function EditorForm({
  snapshot,
  options,
  reloadSnapshot,
}: {
  snapshot: DefinitionSnapshot;
  options: AuthorizationOptions;
  reloadSnapshot: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const client = useAuthorizationClient();
  const toaster = useToaster();
  const location = useLocation();
  const navigate = useNavigate();
  const parent = useOutletContext<{
    reload: () => void;
    name: string;
    definitionSaved?: (data: DefinitionSnapshot) => void;
  }>();
  const original = actionRows(options, snapshot.definition);
  const [rows, setRows] = useState(original);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const changes = rows.filter(
    (row, index) =>
      !row.custom &&
      (row.enabled !== original[index]?.enabled ||
        (row.enabled &&
          JSON.stringify(row.scopes) !==
            JSON.stringify(original[index]?.scopes))),
  );
  const name = titleText(snapshot.definition.title, t, parent.name);
  const impact = useLoad(
    useCallback(async () => {
      const names: string[] = [];
      for (const type of new Set(
        snapshot.assignments.map((entry) => entry.subject.type),
      )) {
        const entries = snapshot.assignments.filter(
          (entry) => entry.subject.type === type,
        );
        const resolved = await client.resolveSubjects(
          'permissionSets',
          type,
          entries.map((entry) => entry.subject.id),
        );
        if (
          resolved.length <
          new Set(entries.map((entry) => entry.subject.id)).size
        )
          throw new Error('INCOMPLETE_IMPACT');
        names.push(...resolved.map((entry) => titleText(entry.title, t)));
      }
      return names;
    }, [client, snapshot, t]),
  );
  const allowLeaveRef = useRef(false);
  useRouteFormCloseGuard(() => {
    if (busy) return false;
    if (allowLeaveRef.current || !changes.length) return true;
    setDiscard(true);
    return false;
  });
  useNavigationGuard(
    () =>
      allowLeaveRef.current ||
      (!busy && (!changes.length || window.confirm(t('access.discardHelp')))),
  );
  const close = () => {
    allowLeaveRef.current = true;
    void navigate(`../..${location.search}`, { relative: 'path' });
  };
  const protectedSet = Boolean(
    snapshot.definition.protection &&
    !snapshot.definition.protection.allow.includes('update'),
  );
  async function save() {
    if (impact.error || impact.busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const saved = await api.request<{ data: DefinitionSnapshot }>({
        path: `access/permissionSets/${encodeURIComponent(snapshot.definition.key)}`,
        method: 'PUT',
        json: {
          expectedRevision: snapshot.revision,
          changes: changes.map((row) => ({
            resource: { type: row.resource.type, id: row.resource.value },
            action: row.action,
            enabled: row.enabled,
            scopes: row.scopes,
          })),
        },
      });
      if (parent.definitionSaved) parent.definitionSaved(saved.data);
      else parent.reload();
      close();
      toaster.show({ type: 'success', title: t('access.saved', { name }) });
    } catch (cause) {
      setError(cause);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const changeRow = (id: string, enabled?: boolean, value?: string) =>
    setRows((current) =>
      current.map((row) =>
        row.id === id && !row.custom
          ? {
              ...row,
              ...(enabled === undefined ? {} : { enabled }),
              ...(value === undefined
                ? {}
                : {
                    scopes: {
                      ...row.scopes,
                      [(row.resource.dataScopes?.[row.action] ?? [])[0].key]:
                        value,
                    },
                  }),
            }
          : row,
      ),
    );
  const visible = options.sections
    .flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.resources.map((resource) => ({
          resource,
          module: `${section.label} · ${subsection.label}`,
        })),
      ),
    )
    .filter(({ resource }) =>
      `${resource.label} ${(resource.actions ?? []).map((entry) => entry.label).join(' ')}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('access.editTitle', { name })}
        description={t('access.editorHelp')}
      />
      {error ? (
        <ErrorState
          error={error}
          retry={reloadSnapshot}
          backTo={`${location.pathname.split('/').slice(0, -2).join('/')}${location.search}`}
          onBack={parent?.reload}
        />
      ) : null}
      {impact.error ? (
        <ErrorState error={impact.error} retry={impact.reload} />
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('access.impact')}: {impact.data?.join('、') || t('access.loading')}
        </p>
      )}
      <Input
        placeholder={t('access.searchActions')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query ? (
        <Button variant='ghost' onClick={() => setQuery('')}>
          {t('access.clearModuleFilters')}
        </Button>
      ) : null}
      <p className='text-sm text-muted-foreground'>
        {t('access.pageActionHelp')}
      </p>
      <AccessModulePermissions
        options={options}
        onNavigate={(navigateModule) => {
          // A module switch keeps this form mounted; only real exits need the dirty guard.
          const wasAllowed = allowLeaveRef.current;
          allowLeaveRef.current = true;
          try {
            navigateModule();
          } finally {
            allowLeaveRef.current = wasAllowed;
          }
        }}
        enabled={
          new Set(
            rows
              .filter((row) => row.enabled)
              .map((row) => resourceKey(row.resource.type, row.resource.value)),
          )
        }
      >
        {(keys) => (
          <div className='flex flex-col gap-4'>
            {!visible.some(({ resource }) =>
              keys.has(resourceKey(resource.type, resource.value)),
            ) ? (
              <p className='text-sm text-muted-foreground'>
                {t('access.noModuleMatches')}
              </p>
            ) : null}
            {visible
              .filter(({ resource }) =>
                keys.has(resourceKey(resource.type, resource.value)),
              )
              .map(({ resource, module }, index) => {
                const entries = rows.filter((row) => row.resource === resource);
                const regular = entries.filter((row) => !row.custom);
                return (
                  <div
                    key={`${resource.type}:${resource.value}`}
                    className='flex flex-col gap-3'
                  >
                    {visible.filter(({ resource: item }) =>
                      keys.has(resourceKey(item.type, item.value)),
                    )[index - 1]?.module !== module ? (
                      <h2 className='text-lg font-semibold'>{module}</h2>
                    ) : null}
                    <PermissionEditor
                      readOnly={busy || protectedSet}
                      sections={[
                        {
                          id: `${resource.type}:${resource.value}`,
                          title: resource.label,
                          groups: [
                            {
                              id: resource.value,
                              rows: regular.map((row) => {
                                const scopes =
                                  resource.dataScopes?.[row.action] ?? [];
                                return {
                                  id: row.id,
                                  label: row.label,
                                  enabled: row.enabled,
                                  ...(scopes.length === 1
                                    ? {
                                        levels: scopes[0].options.map(
                                          (option) => ({
                                            value: option.value,
                                            label: option.label,
                                          }),
                                        ),
                                        level: row.scopes[scopes[0].key],
                                      }
                                    : {}),
                                  hint:
                                    scopes.length > 1
                                      ? t('access.multipleScopes')
                                      : undefined,
                                };
                              }),
                            },
                          ],
                        },
                      ]}
                      labels={{
                        levelFor: (label) =>
                          t('access.levelFor', { name: label }),
                      }}
                      onEnabledChange={(id, enabled) => changeRow(id, enabled)}
                      onLevelChange={(id, level) =>
                        changeRow(id, undefined, level)
                      }
                    />
                    {regular
                      .filter(
                        (row) =>
                          row.enabled &&
                          (resource.dataScopes?.[row.action]?.length ?? 0) > 1,
                      )
                      .map((row) => (
                        <div key={row.id} className='flex flex-col gap-3'>
                          {resource.dataScopes![row.action].map((scope) => (
                            <Field key={scope.key}>
                              <FieldLabel>
                                {row.label} · {scope.label} *
                              </FieldLabel>
                              <Select
                                items={scope.options}
                                value={row.scopes[scope.key]}
                                disabled={busy || protectedSet}
                                onValueChange={(value) => {
                                  if (value !== null)
                                    setRows((current) =>
                                      current.map((entry) =>
                                        entry.id === row.id
                                          ? {
                                              ...entry,
                                              scopes: {
                                                ...entry.scopes,
                                                [scope.key]: value,
                                              },
                                            }
                                          : entry,
                                      ),
                                    );
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                                  {scope.options.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                          ))}
                        </div>
                      ))}
                    {entries
                      .filter((row) => row.custom)
                      .map((row) => (
                        <p
                          key={row.id}
                          className='text-sm text-muted-foreground'
                        >
                          {row.label} · {t('access.specialReadOnly')}
                        </p>
                      ))}
                  </div>
                );
              })}
          </div>
        )}
      </AccessModulePermissions>
      {protectedSet ? (
        <Blank
          title={t('access.protected')}
          description={t('access.protectedHelp')}
        />
      ) : null}
      <div className='flex justify-end gap-2'>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => (changes.length ? setDiscard(true) : close())}
        >
          {t('access.cancel')}
        </Button>
        <Button
          disabled={
            busy ||
            !changes.length ||
            protectedSet ||
            impact.busy ||
            Boolean(impact.error)
          }
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
        {t('access.sharedHelp')}
        <span className='block mt-2'>
          {changes
            .map(
              (row) =>
                `${row.enabled ? '+' : '−'} ${row.resource.label} · ${row.label}`,
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
