# Form options performance

The asset, vendor qualification and probation options endpoints need a small set of employee/account and organisation duty-role facts. They use the public approval directory eligibility(userIds, roles, connection?) service instead of building the complete approval directory solely for these facts.

Eligibility requires an active employee who has not left, an enabled person account, and an active duty role and membership. It only answers for the requested users and roles, and deliberately excludes protected approval.admin assignments. If authorization has already loaded the full directory in the same GET request, eligibility reuses that request-local snapshot. An explicit connection remains independent. No settled data or authorization decision is cached across requests.

Asset options check the applicant and the department head selected by the existing org.headOf service. Vendor qualification options check the current purchasing role. Probation options check the current hr role. Departure options read departureType once and derive all three existing lists from that result.

Endpoint action permissions, record scopes, field policies and write-time lifecycle checks retain their existing enforcement. Complete approval planning, delegations and transactional guards continue to use the full snapshot. The response contracts and business requirements remain unchanged.

SQL budgets in the real PostgreSQL workbench fixture limit asset options to 80 queries and vendor qualification options to 86. Millisecond timings are measurements rather than hard assertions because concurrent load varies. Permissions and approval summaries still incur expensive cross-module readable-scope scans; this change does not establish complete first-page performance acceptance.

See the [verification record](../../records/workbench/options-performance-2026-10-13.md).
