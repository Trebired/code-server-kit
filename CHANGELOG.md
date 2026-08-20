# Changelog

## 1.5.8

- Updated the result dependency range to the current package release so consumers do not retain older nested logger-adapter installs.

## 1.5.7

- Updated the logger-adapter dependency so repeated package initialization calls are de-duplicated by package source.

## 1.5.6

- Removed dead `config.creator` from `package.json`.
- Updated shared utilities to `@trebired/utils@^0.6.0` and replaced the removed `readPackageIdentity()` with `readPackageJsonUrl()` + `readOrganizationIdentity()` + `packageSlug()`/`joinLogGroup()`. No change to exported metadata values.

## 1.5.3

- Updated shared utilities to `@trebired/utils@^0.4.4`.

All notable changes to `@trebired/code-server-kit` will be documented here.

This project follows semantic versioning once published.

## 1.5.2

- Updated shared utilities to `@trebired/utils@^0.4.3`.
- Replaced local config normalization, value, time, and package metadata helpers with shared utilities.

## 1.5.0

- Updated the shared Trebired config dependency to `@trebired/configs@^0.1.2`.
- Added public `.trebired/code-server-kit/config.ts` support through `@trebired/code-server-kit/config`.
- Browser integration creation now merges configured appearance, diagnostics, embed, HTML, readonly, and theme defaults before explicit caller options.

## 1.4.15

- Adopted the external `@trebired/configs` preset and updated Code Discipline tooling to `@trebired/code-discipline@^6.0.9`.

## 1.4.14

- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.2`.
## 1.4.13

- Adopted the shared Trebired Code Discipline preset so package configs only keep repo-specific policy.
- Updated the Code Discipline devDependency and lockfile to public `@trebired/code-discipline@^5.5.1`.

## 1.4.12

- Updated the package Code Discipline config to the platform-aligned rule set, including formatting, redundant path segment cleanup, removable comment checks, structural blank lines, and dry checks.
- Updated the Code Discipline devDependency and lockfile to the current public `@trebired/code-discipline@^5.3.0`.

## 1.4.11

- Refreshed package dependency ranges and lockfile state with `bun update` after adopting the `.trebired/code-discipline` structure.

## 1.4.10

- Moved Code Discipline config, alias-map state, generated tsconfig paths, and reports to `.trebired/code-discipline/`.
- Updated the `@trebired/code-discipline` devDependency to `^4.10.0`.

## 1.4.9

- Updated Code Discipline configuration to the `imports` rule with dead import removal enabled.
- Updated code-server-kit log group metadata fallback so package-owned logs stay under the organization root when package metadata is unavailable.
- Updated internal package dependency ranges to the current published sibling releases.

## 1.4.8

- Fixed a broken published-package build: a fresh checkout has no committed `.code-discipline/generated/` output, and nothing regenerated it before `typecheck`/`build`, so every internal `#hash` import failed to resolve. `typecheck` and `build` now run `prepare:generated` first.
- Standardized package metadata (author field, config-driven organization name, dropped the Node engine constraint) and migrated `.code-discipline/config.ts` to `defineCodeDisciplineConfig`.
- Normalized README structure and removed the license footer.
- Updated the `@trebired/code-discipline` devDependency to 4.8.0.

## 1.4.6

- Standardized package metadata ordering and contributing guidance around the Trebired writing style.
- Added package-owned organization metadata and derived code-server-kit log groups from `package.json`.
- Updated internal package dependency ranges to the current sibling package releases.

## 1.4.5

- Removed dead test scripts and stale test commands from publish workflows and maintainer docs.

## 1.4.4

- Removed package test suites and banned committed `*.spec.ts`/`*.spec.tsx` files through Code Discipline.
- Added Code Discipline enforcement for hardcoded `trebired` strings outside package metadata.
- Migrated Code Discipline to `.code-discipline/config.ts` with alias-map sync output.
- Updated package-generated artifact ignores and internal package dependency ranges.

## 1.4.3

- Moved package-owned code-server-kit initialization logging under the `trebired.code-server-kit` group root.

## 1.4.2

- adopt `@trebired/result` as the internal outcome surface for touched code-server and systemd backend coordination paths instead of local result shaping
- enforce current `@trebired/code-discipline` expectations on the touched integration helpers while keeping the public host-facing API stable

## 1.4.1

- move the implementation tree under `src/` and remove the old `internal/` source root so the repository structure matches the actual package code layout
- update build, pack, alias-rewrite, and code-discipline tooling to publish directly from `src/` without the extra internal indirection

## 1.4.0

- strengthen readonly sessions into a layered package capability with broader blocked command defaults, command-URI interception, writable-in-session promotion blocking, and richer browser-side guard diagnostics
- add readonly filesystem policy options with `filesystem.mode: "auto" | "require" | "off"` plus per-plan/session readonly enforcement reporting so hosts can see when direct launches are hard-enforced vs degraded
- harden direct readonly launches with automatic `bubblewrap` wrapping when available and stronger transient-systemd filesystem protections for systemd launches
- expand readonly coverage and regressions across browser, launch, systemd, and session tests so hosts get stronger out-of-the-box view-only behavior without app-specific patches

## 1.3.2

- fixed the packed package metadata so `main`, `types`, and package-private alias imports resolve to built files that actually exist in the published tarball
- added a publish-preparation step that promotes public `dist/src` entrypoints into `dist`, rewrites compiled alias imports to built relative paths, and rewrites packed `package.json` imports during `npm pack` and `npm publish`
- added explicit pack verification that inspects the tarball and smoke-tests install, typecheck, and runtime import from a clean temporary consumer project

## 1.3.1

- enforce the package `tb.code-discipline.ts` policy across the internal runtime tree, including import sync, folderization, file-size cleanup, and smaller session/planning/preparation/proxy/readiness/systemd/type modules
- reduce internal duplication and split oversized implementation files without changing the public `@trebired/code-server-kit` API shape

## 1.3.0

- expand browser integration into higher-level `createCodeServerBrowserIntegration()`, `transformCodeServerHtml()`, `createBrowserDiagnosticsTransport()`, and `createCodeServerEmbedController()` APIs so hosts can delete more custom `code-server` frontend glue
- add richer browser diagnostics coverage for websocket lifecycle, iframe state, worker failures, asset 404s, MIME mismatches, theme sync, readonly guard blocks, and frontend stall classification
- add browser-side readonly policy normalization and action blocking helpers with shared command, shortcut, selector, upload, and drag/drop rules
- add browser diagnostics summaries and classified failure helpers for safer logging and more actionable readiness failures
- strengthen README guidance with browser integration, iframe embedding, diagnostics transport, CSP injection, common failure modes, and migration notes

## 1.2.0

- add install launchability APIs with `getCodeServerReadinessStatus()`, `validateCodeServerInstall()`, `repairCodeServerInstall()`, and `ensureCodeServerLaunchable()` so hosts can distinguish incomplete installs from truly launchable ones
- validate more launch-critical `code-server` artifacts, including embedded workbench assets, server entrypoints, and nested runtime dependencies such as `@vscode/ripgrep`
- add structured repair outcomes with explicit `noop`, `repaired`, `partially_repaired`, and `unrecoverable` states plus per-action metadata
- extend readiness handling from bare TCP probes to phased `tcp`, `http`, `websocket`, `browser-shell`, and `workbench` targets
- add browser diagnostics helpers for generated injection scripts, event parsing, HTML injection planning, and bridge-backed readiness waiting
- expand session lifecycle APIs with `startSession()`, `stopSession()`, `reuseSession()`, and `inspectSessionFailure()` aliases on top of the existing manager flow
- add readonly planning helpers, default readonly settings patches, sandbox metadata, and readonly workspace binding suggestions
- add `runCodeServerDoctor()`, `runCodeServerSmokeTest()`, and `explainCodeServerFailure()` for maintainer and CI workflows
- strengthen persisted diagnostics and logging with normalized phases, retryability, hints, readiness checkpoints, browser events, and phase-based log groups

## 1.1.0

- make the bundled `code-server` dependency the default resolution target
- centralize package-resolution logic so preparation and installation discovery stay consistent
- add coverage and documentation for single-package host integration without a direct `code-server` dependency

## 1.0.0

- expand the package from a session helper into a fuller generic `code-server` integration layer
- add package preparation status and auto-repair helpers for the installed `code-server` dependency
- add richer integration planning, diagnostics normalization, redaction, and proxy websocket helpers
- add profile snapshot and deduplicated persistence helpers
- strengthen session lifecycle ownership with inflight dedup, richer status metadata, and persisted diagnostics
- expand systemd helpers with restart, journal summarization, and structured failure extraction

## 0.3.0

- expand the package from launch planning into a full generic `code-server` session runtime
- add session lifecycle APIs for start, stop, restart, status, diagnostics, and session-manager creation
- add Linux-first transient systemd helpers and launch-command builders
- add disk-backed session metadata, reuse checks, profile restore and persist hooks, and richer startup diagnostics
- add `@trebired/logger-adapter` support across the higher-level APIs

## 0.2.0

- add `createCodeServerLaunchPlan()` as the main higher-level launch planning API
- add generic launch spec, command formatting, and startup failure normalization helpers
- add readiness probe support and broader structured error coverage
- add generic allowlisted profile sync helpers for `code-server` user data and extensions
- add reverse-proxy helpers for forwarded headers, trusted origins, and HTML response detection

## 0.1.0

- Initial release
