import type { FilterBuilder, FilterNode } from '@nocobase/db';

/** Call only after the owning record and its attachment field are authorized.
 * Undefined allows editable draft uploads; an empty selection permits an empty
 * list, while its impossible scope prevents access to any unselected file.
 */
export function attachmentSelectionFilters(
  filter: FilterBuilder,
  ids: readonly string[] | undefined,
): FilterNode[] {
  if (ids === undefined) return [];
  if (ids.length === 0)
    // File IDs can be native PostgreSQL UUIDs as well as strings. This valid
    // UUID keeps the contradictory filter type-safe for both column kinds.
    return [
      filter.string('id').eq('00000000-0000-0000-0000-000000000000'),
      filter.string('id').ne('00000000-0000-0000-0000-000000000000'),
    ];
  return [filter.or(ids.map((id) => filter.string('id').eq(id)))];
}
