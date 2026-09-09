# About workspace

The desktop page has a 60px header, a product/version split and three permanent resource cards. Surface/card radii are 12px; controls reuse `Button` for focus, disabled and hover behavior. Chinese and English remain available. There is no mobile layout.

`app/about/useAboutRuntime.ts` owns version reads and the update state. `page.tsx` renders that state and handles explicit navigation. `lib/releases.ts` validates GitHub release data and compares versions using the existing semver package. The separation follows [VS Code's update contribution](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/update/browser/update.ts), where visible actions derive from the update service state; no upstream source was copied.

- Unknown runtime information stays unknown, rather than implying a preview build.
- Only a user-requested check reads GitHub. Checking replaces any previous result; duplicate requests are ignored and departure aborts outstanding reads.
- Failed checks offer the releases page and never claim the installed version is current.
- The download action opens the project's release page. This is not an automatic installer or proof that a downloadable desktop package exists.

Verification: eight About/release checks, scoped ESLint and complete frontend TypeScript check pass. Chrome at 1180×700 in both locales shows 60px headers, 12px resource cards and no horizontal overflow or page errors. GitHub responses and desktop metadata were simulated; no real download or installation was tested.
