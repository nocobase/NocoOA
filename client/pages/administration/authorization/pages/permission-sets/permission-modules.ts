import type {
  ResourceGroupOption,
  ResourceOption,
} from '../../authorization-client.js';
import type { Translate } from '../../i18n.js';
import { descendantGroups } from './resource-groups.js';

export interface PermissionModule {
  value: string;
  label: string;
  resources: readonly ResourceOption[];
}

/** Use registered group ids, including descendants; unknown ids stay reachable. */
export function permissionModules(
  groups: readonly ResourceGroupOption[],
  resources: readonly ResourceOption[],
  t: Translate,
): readonly PermissionModule[] {
  const grouped = new Set<string>();
  const modules = groups.flatMap((group) => {
    const ids = new Set(descendantGroups([group], group.value));
    const items = resources.filter((item) => item.group && ids.has(item.group));
    if (!items.length) return [];
    for (const id of ids) grouped.add(id);
    return [
      { value: `group:${group.value}`, label: group.label, resources: items },
    ];
  });
  if (!modules.length) return [];
  const other = resources.filter(
    (item) => !item.group || !grouped.has(item.group),
  );
  return [
    ...modules,
    ...(other.length
      ? [
          {
            value: 'other',
            label: t('permissionWorkspace.otherModules'),
            resources: other,
          },
        ]
      : []),
    { value: 'all', label: t('permissionWorkspace.allModules'), resources },
  ];
}
