# nb3-oa Development Guide

## Project goal

A NocoBase 3 office automation application for mid-size companies, covering organization and HR, daily office work, approvals, finance and expenses, procurement and contracts, and administration and assets. It provides a unified workbench, task center, and access management.

This repository owns the application business code. Build features directly in the application; create a plugin only when explicitly asked for an independently published, reusable package. Do not apply NocoBase 2 Skills or reset existing business features to the empty template.

## Stack and plugins

- Stack: TypeScript, React, shadcn/ui, Tailwind CSS, and NocoBase 3. PostgreSQL is the default database for the application and its database tests.
- Environment: Node.js >= 24 and pnpm. See [package.json](package.json) and the lockfile for exact versions.
- Registered plugins below omit the `@nocobase/app-plugin-` prefix:

| Capability                          | Plugins                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Authentication, users, and API keys | `authentication`, `users`, `api-keys`                                                     |
| Authorization and data scopes       | `authorization`, `authz-default-access`, `authz-sharing-rules`, `authz-restriction-rules` |
| Internationalization and files      | `i18n`, `file`                                                                            |
| Notifications and inbox             | `notification`, `notification-in-app`, `notification-providers`                           |
| Approvals, scheduling, and agents   | `approval`, `scheduler`, `agents`                                                         |

Registration lives in [server/plugins.ts](server/plugins.ts), [client/plugins.ts](client/plugins.ts), and [cli/plugins.ts](cli/plugins.ts), as needed by each runtime. Approval pages import the plugin's frontend helpers and locales directly. Template printing uses `@nocobase/app-plugin-template-print` through the application's `server/providers/template-print/`. An installed dependency is not necessarily registered or enabled.

## Project structure

```text
client/
  runtime.ts                 Browser application composition
  routes.ts                  Page routes and navigation composition
  route-modules/<module>.ts  Module routes
  pages/<module>/            Module pages and page-local components
  components/                Shared components; ui/ contains CLI-generated shadcn primitives
  hooks/, lib/               Shared hooks and utilities
  locales/                   User-visible copy; module locales live in modules/
server/
  runtime.ts, app.ts         Server composition and application assembly
  plugins.ts                 Server plugin registration
  providers/<module>/        Business services, public contracts, permissions, and background jobs
  routes/<module>/           HTTP endpoints and response schemas
  config/                    Configuration defaults and environment variable mappings
database/main/
  migrations/, seeds/        Production migrations and initial data
  collections/               Generated Collection artifacts
cli/commands/                Application commands
tests/                       Unit, integration, and browser tests; fixtures/ for isolated fixtures
docs/                        Requirements, designs, plans, records, and operating guides
```

Register new modules in `server/providers/index.ts`, `server/routes/index.ts`, `client/routes.ts`, and the locale entry points. Place business pages under existing domain navigation groups and approval types in the existing task center.

## Development workflow

1. Read the local [application development Skill](.agents/skills/nocobase-app-development/SKILL.md), then choose references and plugin Skills for the task. Follow its UI workflow for frontend changes. Use the corresponding local Skills for template upgrades and production deployment.
2. Before business development, read chapters 01, 02, and 08, the relevant business chapters, and the original detailed designs/reviews in the [complete requirements baseline](docs/designs/baseline/README.md), then the current module design. Explicitly record differences between requirements and implementation.
3. Reuse existing components, plugins, and public services. Keep changes within module boundaries and complete main application registration. Use `pnpm dev` for development; see [README.MD](README.MD) for operation and configuration.
4. Scope formatting, static checks, and tests to the affected code; do not default to full `pnpm check`. Documentation-only changes require formatting and local-link checks. State unverified limits honestly. Write PR titles and descriptions in English.

`pnpm install` synchronizes local Skills; run `pnpm nocobase skills sync` if they are missing or stale. When users mention page annotations, first run `pnpm exec agent-annotations list --json` from the root to locate them. Do not implement changes when the user only asks where annotations are.

<a id="unified-application-table-presentation"></a>

## Essential conventions

- Every endpoint independently enforces authentication, action permissions, record scopes, and field permissions. Hiding navigation does not replace server authorization.
- Call other modules through public service tokens, not their implementations or plugin internal tables. Commit business writes, audits, and related changes in the same transaction. Use platform services for working days, rule snapshots, and document numbers.
- Published migrations are immutable; add new migrations for changes. Do not edit generated collections. Register permission seeds in the main application only after their providers and actions are registered.
- Declare menus through route `navigation` and fetch data with `useApiClient`. Reuse existing tables, pickers, and layouts; follow the [shared table design](docs/designs/oa/table-presentation-design.md). Add shadcn primitives through the CLI; do not edit generated files.
- Put user-visible copy in locale files. Frontend request identifiers use `createRequestKey` from `#lib/request-key`; do not use `crypto.randomUUID`, to support intranet HTTP origins.
- Keep tests in `tests/`. Database tests use isolated environments, never business databases; do not switch to SQLite to bypass failures. Preserve existing application adapters and review their owning designs and records during upgrades.

## Documentation rules

Start at [docs/README.md](docs/README.md). Find and update the existing owning document first. Keep this file limited to a stable project overview and essential rules; do not append module implementation logs or progress reports.

- `docs/plans/`: plans; `docs/designs/<module>/`: business rules and current contracts; `docs/records/<module>/`: execution and verification; `docs/guides/`: operating instructions.
- Use lowercase kebab-case for new documents and ISO dates for plans and records. Maintain category indexes and relative links. Preserve provenance and history in the original baseline and `source/`; do not depend on the ignored local worklog.
- Business code changes update the owning design, progress, and module audit. Distinguish source presence, main registration, automated validation, real-role browser acceptance, and production release. Record date/time zone, commands, actual results, and limits; do not rewrite historical failures.
- Executable fixtures belong in `tests/fixtures/`. Temporary logs are not sufficient durable evidence. Never store credentials or real personal business data in documentation.

Find current status, source reviews, module gaps, and development plans through the [documentation index](docs/README.md). The owning module design defines its business contracts.

The route-level denied and load-failure surfaces use user-facing generic messages rather than internal route/package identifiers; denied pages link back to the workbench. This application shell presentation is customized in `client/routing/client-route.tsx`; preserve it during template upgrades. See [page experience](docs/designs/oa/page-experience-design.md).
