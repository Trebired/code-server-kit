# Changelog

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
