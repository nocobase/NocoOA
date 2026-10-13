import type { ReactElement, ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/ui/tabs';
import { useAuthorizationTranslation } from '../../i18n.js';
import type { PermissionModule } from './permission-modules.js';
import { resourceKey } from './drafts.js';
import type { GrantDraft } from './types.js';

export function PermissionModuleTabs({
  modules,
  selected,
  grants,
  busy,
  onSelect,
  children,
}: {
  modules: readonly PermissionModule[];
  selected: string;
  grants: readonly GrantDraft[];
  busy: boolean;
  onSelect: (value: string) => void;
  children: ReactNode;
}): ReactElement {
  const t = useAuthorizationTranslation();
  const configured = new Set(
    grants
      .filter((grant) => grant.actions.length)
      .map((grant) => resourceKey(grant.resource.type, grant.resource.id)),
  );
  if (!modules.length) return <>{children}</>;
  return (
    <Tabs
      value={selected}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value);
      }}
      className='min-h-0 flex-1 gap-0'
    >
      <div className='shrink-0 overflow-x-auto border-b px-3 py-2'>
        <TabsList
          aria-label={t('permissionWorkspace.businessModules')}
          variant='line'
        >
          {modules.map((module) => {
            const count = module.resources.filter((item) =>
              configured.has(resourceKey(item.type, item.value)),
            ).length;
            return (
              <TabsTrigger
                key={module.value}
                value={module.value}
                disabled={busy}
                aria-label={t('permissionWorkspace.moduleCount', {
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
      {modules.map((module) => (
        <TabsContent
          key={module.value}
          value={module.value}
          className='flex min-h-0 flex-col'
          hidden={module.value !== selected}
        >
          {module.value === selected ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
