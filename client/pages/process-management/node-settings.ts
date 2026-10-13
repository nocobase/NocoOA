/** Explicit bindings to parameters actually consumed by the owning business flow.
 * Shared keys retain their existing global scope; this registry never defines new rules.
 * Keep node names aligned with the registered lifecycle, not translated labels.
 */
const spend = {
  finance: ['spend.vp', 'spend.gm'],
  executive: ['spend.gm'],
};
export const nodeRuleBindings: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  'oa.leave': {
    manager: ['leave.head', 'leave.hr'],
    head: ['leave.hr'],
  },
  'oa.overtime': { manager: ['overtime.monthlyHead'] },
  'oa.attendanceChange': { draft: ['attendance.fixPerMonth'] },
  'oa.reimbursement': { manager: ['expense.head'], ...spend },
  'oa.loan': { draft: ['loan.personalMax'], ...spend },
  'oa.payment': spend,
  'oa.expensePlan': spend,
  'oa.travel': spend,
  'oa.training': spend,
  'oa.purchase': {
    draft: ['purchase.quotes'],
    purchasing: ['purchase.quotes'],
    ...spend,
  },
  'oa.contract': {
    legalFinance: ['spend.vp', 'contract.gm'],
    standardFinance: ['spend.vp', 'contract.gm'],
    executive: ['contract.gm'],
  },
  'oa.budgetAdjustment': { cfo: ['budget.increaseGm'] },
  'oa.assetRequest': { finance: ['asset.scrapGm'] },
  'oa.probation': { hr: ['grade.managerRank'] },
  'oa.departure': { hr: ['grade.managerRank'] },
  'oa.recruitment': { hrDirector: ['grade.directorRank'] },
  'oa.transfer': {
    hr: ['raise.vp', 'raise.gm', 'grade.managerRank', 'grade.directorRank'],
    executive: ['raise.gm', 'grade.directorRank'],
  },
};
export function rulesForNode(kind: string, node: string): readonly string[] {
  return nodeRuleBindings[kind]?.[node] ?? [];
}
export function flowsUsingRule(key: string): string[] {
  return Object.entries(nodeRuleBindings)
    .filter(([, nodes]) =>
      Object.values(nodes).some((keys) => keys.includes(key)),
    )
    .map(([kind]) => kind);
}
export function committeeVersionForNode(
  kind: string,
  node: string,
): number | undefined {
  if (kind !== 'oa.vendorQualification') return undefined;
  const match = /^committee_v([1-9]\d*)$/.exec(node);
  const version = match ? Number(match[1]) : undefined;
  return version !== undefined && Number.isSafeInteger(version)
    ? version
    : undefined;
}
export function hasVendorNodeSettings(kind: string, node: string): boolean {
  return (
    kind === 'oa.vendorQualification' &&
    (node === 'removalReview' ||
      committeeVersionForNode(kind, node) !== undefined)
  );
}

export function ruleNodeTargets(key: string) {
  return Object.entries(nodeRuleBindings).flatMap(([kind, nodes]) => {
    const node = Object.entries(nodes).find(([, keys]) =>
      keys.includes(key),
    )?.[0];
    return node
      ? [
          {
            kind,
            node,
            path: `/processManagement/definitions/${encodeURIComponent(kind)}/nodes/${encodeURIComponent(node)}/settings?rule=${encodeURIComponent(key)}`,
          },
        ]
      : [];
  });
}
