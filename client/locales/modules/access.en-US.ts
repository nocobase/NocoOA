export default {
  access: {
    clearModuleFilters: 'Clear filters',
    noModuleMatches: 'No permissions match in this module',

    businessModules: 'Business modules',
    allModules: 'All',
    otherModules: 'Other',
    noModulePermissions: 'No permissions configured in this module',
    moduleCount: '{{module}}: {{configured}} configured / {{total}} resources',

    actionsFor: 'Actions for "{{name}}"',
    configuredScopes: 'Configured scopes',

    lastAdmin:
      'At least one active system administrator must remain. Assign a replacement first.',
    subjectNotAllowed:
      'This access cannot be assigned to this type of subject. Choose different business access.',

    title: 'Access management',
    description:
      "Assign access by responsibility and review each person's access sources.",
    roles: 'Role access',
    people: 'People access',
    baseline: 'Signed-in baseline access',
    baselineHelp:
      'Baseline access applies to signed-in accounts. Duty membership also affects approval candidates.',
    name: 'Name',
    type: 'Type',
    all: 'All types',
    dutyRoles: 'Duty roles',
    positions: 'Positions',
    departments: 'Departments',
    automatic: 'Automatic access',
    members: 'Members',
    permissions: 'Business permissions',
    missingMembers: 'No members assigned',
    memberDenied: 'Member access unavailable',
    membersFailed: 'Could not load members',
    byMembership: 'Applied by membership',
    none: 'No business access assigned',
    noneHelp:
      'Assign existing business access after confirming responsibilities. Inherited access remains in effect.',
    searchRoles: 'Search roles, positions or departments…',
    searchPeople: 'Search by name…',
    clear: 'Clear filters',
    noResults: 'No matching results',
    clearHelp: 'Change your search or clear the filters.',
    loading: 'Loading',
    refresh: 'Refresh',
    denied:
      'You do not have access to this operation. Contact an access administrator.',
    missing: 'This item no longer exists. Return to the list.',
    conflict: 'Access configuration changed. Reload and review before saving.',
    failed:
      'Could not complete this operation. Try again or contact an administrator.',
    reload: 'Reload',
    retry: 'Retry',
    roleHelp:
      "Review this responsibility's members, business operations and record scopes.",
    rules:
      "Additional access rules may apply. Check the person's access and the actual business operation.",
    actions: 'Actions',
    addMember: 'Add member',
    remove: 'Remove',
    memberImpact:
      'Duty membership affects inherited access and approval candidates. Other access sources remain after removal.',
    assign: 'Assign business access',
    usedBy:
      'This access is assigned to {{count}} subjects. Editing affects all of them.',
    edit: 'Edit',
    special: 'Existing custom configuration',
    specialReadOnly:
      'Custom configuration is read-only and will be preserved on save.',
    noScope: 'No record scope configured',
    systemAdmin: 'System administrator',
    unrestricted: 'System administrator: unrestricted access',
    removeTitle: 'Remove member "{{name}}"?',
    cancel: 'Cancel',
    removed: 'Removed "{{name}}"',
    added: 'Added "{{name}}"',
    addMemberTitle: 'Add {{name}} member',
    add: 'Add',
    person: 'Person',
    selectPerson: 'Select the person who will hold this responsibility.',
    email: 'Email',
    peopleHelp: 'Select a person to review access and its sources.',
    userDenied: 'You cannot view the user directory. Contact an administrator.',
    personHelp:
      'Review direct access, inherited sources and record scope restrictions.',
    source: 'Access sources',
    personal: 'Personal access',
    changePersonal: 'Change personal access',
    ruleHelp:
      'Conditional access also depends on records, business state and task assignments.',
    direct: 'Assigned directly',
    inherited: 'Inherited access',
    conditionalHelp:
      'Conditional checks and additional access rules apply. Configured scopes below do not describe every restriction; the business operation enforces the final access check.',
    personUnknown: 'Person (name unavailable)',
    back: 'Return to list',
    pageActionHelp:
      'Page access controls the menu and entry. Grant each business operation and its record scopes separately; opening a page alone does not grant its actions.',
    emptyDirectory: 'No subjects available',
    emptyPeople: 'No people available',
    emptyHelp: 'No records are currently available in this directory.',
    deniedAction: 'Not authorized',
    unchecked: 'Check unavailable',
    conditionalSpecial: 'Limited scope: existing custom configuration',
    sensitive: 'Sensitive access',
    impactUnavailable:
      'The complete impact cannot be verified. Check the affected subjects and their visibility before changing this shared access.',
    conditional: 'Conditional access',
    permitted: 'Unconditional access',
    assignTitle: 'Change access for "{{name}}"',
    assignHelp:
      "Select this subject's direct business access. Other sources are preserved.",
    noAssignable: 'No assignable business access',
    preserveInherited:
      'Only direct assignments change here. Access inherited from departments, positions, duties and the baseline remains.',
    save: 'Save',
    saved: 'Saved access for "{{name}}"',
    confirmTitle: 'Save access changes for "{{name}}"?',
    assignmentImpact:
      'Review added and removed access. Other sources remain; a system administrator must remain active.',
    discardTitle: 'Discard unsaved changes?',
    discard: 'Discard',
    discardHelp: 'Your changes have not been saved. Discarding removes them.',
    editTitle: 'Edit business access for "{{name}}"',
    editorHelp:
      'Select operations and scopes individually. Sensitive operations are separate; review the impact before saving.',
    impact: 'Affected subjects',
    searchActions: 'Search business features or operations…',
    multipleScopes: 'Configure each of the scopes below for this operation.',
    levelFor: 'Record scope for "{{name}}"',
    protected: 'This access is protected',
    protectedHelp:
      'System protection remains. Manage administrator membership through personal access.',
    sharedHelp:
      'This change affects every subject listed above. Review the operations and scopes.',
    system: 'System responsibilities',
  },
};
