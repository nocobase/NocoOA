import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/ui/tabs';
import type { AuthorizationOptions } from './types.js';
import { permissionModules } from '../administration/authorization/pages/permission-sets/permission-modules.js';
import { resourceKey } from '../administration/authorization/pages/permission-sets/drafts.js';

/** Presentation only: the parent retains the complete permission definition. */
export function AccessModulePermissions({
  options,
  enabled,
  children,
  onNavigate = (navigate) => navigate(),
}: {
  options: AuthorizationOptions;
  enabled: ReadonlySet<string>;
  children: (keys: ReadonlySet<string>) => ReactNode;
  onNavigate?: (navigate: () => void) => void;
}) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const modules = options.sections.flatMap((section) =>
    section.subsections.flatMap((subsection) => {
      if (!subsection.resources.length) return [];
      const grouped = permissionModules(
        subsection.groups,
        subsection.resources,
        (key) =>
          t(
            key === 'permissionWorkspace.otherModules'
              ? 'access.otherModules'
              : 'access.allModules',
          ),
      );
      const entries = grouped.length
        ? grouped.filter((item) => item.value !== 'all')
        : [
            {
              value: 'section',
              label: subsection.label,
              resources: subsection.resources,
            },
          ];
      return entries.map((item) => ({
        ...item,
        value: JSON.stringify([section.value, subsection.value, item.value]),
      }));
    }),
  );
  const all = options.sections.flatMap((section) =>
    section.subsections.flatMap((subsection) => subsection.resources),
  );
  if (!modules.length) return <>{children(new Set())}</>;
  const choices = [
    ...modules,
    { value: 'all', label: t('access.allModules'), resources: all },
  ];
  const selected =
    choices.find((item) => item.value === params.get('accessModule')) ??
    modules[0];
  const keys = new Set(
    selected.resources.map((item) => resourceKey(item.type, item.value)),
  );
  return (
    <Tabs
      value={selected.value}
      onValueChange={(value) => {
        if (typeof value !== 'string') return;
        onNavigate(() =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set('accessModule', value);
              return next;
            },
            { replace: true },
          ),
        );
      }}
    >
      <div className='max-w-full overflow-x-auto'>
        <TabsList variant='line' aria-label={t('access.businessModules')}>
          {choices.map((module) => {
            const count = module.resources.filter((item) =>
              enabled.has(resourceKey(item.type, item.value)),
            ).length;
            return (
              <TabsTrigger
                value={module.value}
                key={module.value}
                aria-label={t('access.moduleCount', {
                  module: module.label,
                  configured: count,
                  total: module.resources.length,
                })}
                onFocus={(event) =>
                  event.currentTarget.scrollIntoView?.({
                    block: 'nearest',
                    inline: 'nearest',
                  })
                }
              >
                {module.label}
                <span>
                  {count}/{module.resources.length}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {choices.map((module) => (
        <TabsContent
          key={module.value}
          value={module.value}
          hidden={module.value !== selected.value}
        >
          {module.value === selected.value ? children(keys) : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
