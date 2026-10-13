# Login control height fix

Date: 2026-10-13, Asia/Singapore.

The login page applied `h-12` to its inputs and submit button, but the application's global text-button rule overrode the submit height. Remove those overrides in [the login page](../../../client/pages/auth/login.tsx) so desktop controls use the existing `h-8` defaults: 32px in the default preset and approximately 25.6px in the compact preset. Below 640px, set the identifier input and password group to 2.75rem (44px at the default root font size), matching the submit button's existing touch minimum. The password input fills its group. Authentication actions and generated components are unchanged.

This is the user's approved presentation refinement; the original business requirements do not specify login control heights. Existing application designs and status records were updated in the source workspace, but are not yet tracked on main. This standalone record keeps the PR limited to this fix.

Validation in the source workspace:

- `pnpm exec eslint client/pages/auth/login.tsx --max-warnings 0`: passed.
- `pnpm exec prettier --check client/pages/auth/login.tsx`: passed.
- `pnpm exec tsc --noEmit -p tsconfig.json`: passed.
- `pnpm exec vitest run tests/logic/client-auth.test.tsx tests/components/auth-i18n.test.tsx`: 6 passed, 2 failed on existing English heading/aside expectations. Restoring the original className and repeating the same selection reproduced both failures.
- Read-only browser verification of the current OA app at its local service endpoint: all eight combinations of 1280px/375px, default/compact, and light/dark had equal identifier input, password group, and submit heights. Measurements were 32px, 25.59375px, and 44px respectively. Mobile compact/light and desktop default/dark screenshots were visually inspected. No credentials were entered.

The sandbox initially prevented Chromium launch; verification succeeded outside it after locating the OA server entry and allowing theme initialization and CSS transitions to settle. Unrelated local services and bare Vite pages were excluded. Verification used the source workspace, not a clean main checkout; main uses the same relevant primitives, theme presets, and global styles. Production release and real-account authentication were not tested.
