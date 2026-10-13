import { nodeRuleBindings } from './node-settings.js';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { RuleSummary } from '../platform/shared/types.js';
import { useProcessResource } from './resource.js';
import type { Configuration } from '../vendor-qualifications/types.js';

/** Definition access never implies permission to read or edit the underlying settings. */
export function useNodeSettings(kind: string, definitionAvailable: boolean) {
  const read = useCan({
    resource: { type: 'settings', id: 'oa.platform.rules' },
    action: 'read',
  });
  const update = useCan({
    resource: { type: 'settings', id: 'oa.platform.rules' },
    action: 'update',
  });
  const vendor = useCan({
    resource: { type: 'composite', id: 'oa.vendorQualification' },
    action: 'manage',
  });
  const canReadRules =
    definitionAvailable &&
    !!nodeRuleBindings[kind] &&
    read.can &&
    !read.isPending &&
    !read.error;
  const canUpdateRules =
    canReadRules && update.can && !update.isPending && !update.error;
  const canManageVendor =
    definitionAvailable &&
    kind === 'oa.vendorQualification' &&
    vendor.can &&
    !vendor.isPending &&
    !vendor.error;
  const rules = useProcessResource<{ data: RuleSummary[] }>(
    canReadRules ? 'approvalRules' : null,
    { area: 'rules' },
  );
  const configuration = useProcessResource<{ data: Configuration }>(
    canManageVendor ? 'vendorQualifications/configuration' : null,
  );
  return {
    canReadRules,
    canUpdateRules,
    canManageVendor,
    rules,
    configuration,
  };
}
