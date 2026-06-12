# @trebired/code-server-kit

Framework-agnostic `code-server` integration layer for Node.js applications.

`@trebired/code-server-kit` is the generic Trebired package for owning the real `code-server` integration lifecycle on Linux-first hosts:

- install validation, launchability checks, and targeted repair
- installation and support-root resolution
- launch, sandbox, and readonly policy planning
- direct and transient systemd launching
- server-side and browser-side readiness
- session reuse, restart, stop, and status refresh
- structured startup diagnostics, browser events, and redaction
- allowlisted profile restore and persistence
- proxy-facing helpers for forwarded and websocket headers

The package stays generic on purpose. It does not know about products, repositories, organizations, routes, or app-specific filesystem conventions.

## Install

Runtime target: Node.js 22+ on Linux first.

```sh
npm install @trebired/code-server-kit
```

`code-server` is installed as a normal dependency of this package. A host application only needs a separate direct `code-server` dependency when it intentionally wants to override how resolution happens.

By default, the package resolves and prepares its own bundled `code-server`. A host does not need to pass `resolveFrom` just to make normal session startup work.

## Preferred Flow

The preferred host integration flow is now:

1. Create a session manager.
2. Start a session with `sessionKey`, `stateRoot`, `workspacePath`, and trusted origins.
3. Let the package prepare `code-server`, restore profile data, choose launch mechanics, supervise readiness, and persist diagnostics.

```ts
import {
  createCodeServerSessionManager,
} from "@trebired/code-server-kit";

const sessions = createCodeServerSessionManager({
  logger: console,
});

const started = await sessions.start({
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
  trustedOrigins: [
    "https://app.example.com",
  ],
  workspacePath: "/srv/workspaces/demo",
});

console.log(started.status.state, started.status.port);

const status = await sessions.getStatus({
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
});

console.log(status?.ready);

await sessions.stop({
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
});
```

The host application only needs a separate direct `code-server` dependency for explicit override scenarios, such as testing against a different installation root or intentionally pinning resolution outside `@trebired/code-server-kit`.

## What The Package Owns

High-level APIs now own generic mechanics that host apps previously had to rebuild:

- validating whether the installed `code-server` package is actually launchable
- repairing incomplete installs through package bootstrap and targeted dependency repair
- resolving the true entrypoint and support root
- deriving support-tree read-only bind suggestions
- deriving readonly workspace bindings and ephemeral profile defaults
- deciding `node <entry.js>` vs direct execution
- preparing profile directories and syncing only allowlisted items
- handling missing optional native watchdog support with a non-fatal fallback mode
- deduplicating concurrent starts for the same `sessionKey`
- reusing healthy sessions when the effective spec still matches
- invalidating stale sessions and restarting cleanly when the spec changes
- collecting phase-based backend diagnostics plus optional browser events
- translating launch plans into transient systemd unit arguments

Host applications mostly provide:

- `sessionKey`
- `stateRoot`
- `workspacePath`
- `trustedOrigins`
- `launchStrategy`
- systemd `scope` when using systemd
- optional profile and sanitization policy
- optional logging

## Main High-Level APIs

### `createCodeServerSessionManager(options?)`

Creates the main lifecycle object.

Manager methods:

- `start(options)`
- `stop(options)`
- `restart(options)`
- `getStatus(options)`
- `readDiagnostics(options)`

### `startCodeServerSession(options)`

One-shot helper around the session manager.

Defaults:

- `launchStrategy` defaults to `"direct"`
- preparation defaults to auto-ensure
- readiness defaults to `"http"` and can be raised to `"websocket"`, `"browser-shell"`, or `"workbench"`
- exact-spec inflight starts join each other
- conflicting inflight starts fail with a structured conflict error
- profile restore defaults to `"if-missing-or-empty"`
- profile persist defaults to `"if-changed"`

High-level aliases are also available for hosts that prefer shorter lifecycle names:

- `startSession()`
- `stopSession()`
- `reuseSession()`
- `inspectSessionFailure()`

### `getCodeServerSessionStatus(options)`

Returns a refreshed status object with:

- `state`
- `health`
- `ready`
- `preparation`
- `watchdogMode`
- `lastStartSummary`
- `sanitizedDiagnostics`

### `readCodeServerSessionDiagnostics(options)`

Reads the persisted diagnostics snapshot under:

- `<stateRoot>/sessions/<safe-session-key>/session.json`
- `<stateRoot>/sessions/<safe-session-key>/diagnostics.json`

## Preparation APIs

The package now distinguishes install presence from install launchability.

### `getCodeServerReadinessStatus(options?)`

Returns the current launchability view of the resolved install, including:

- launch-critical artifacts
- nested runtime dependency checks
- missing critical paths
- launchable vs repairable vs unrecoverable state
- watchdog fallback mode

### `validateCodeServerInstall(options?)`

Returns `{ ok, status, diagnostic }` so hosts and CI jobs can fail on incomplete installs without parsing log strings.

### `repairCodeServerInstall(options?)`

Runs package-owned repair actions and returns a structured result with:

- `outcome: "noop" | "repaired" | "partially_repaired" | "unrecoverable"`
- `actions`
- `statusBefore`
- `statusAfter`

### `ensureCodeServerLaunchable(options?)`

Validates the install and attempts repair when needed. This is the preferred preflight API when a host wants one explicit “make it runnable” step.

### `getCodeServerPreparationStatus(options?)`

Checks whether the installed package looks ready to run and reports:

- package root
- support root
- bootstrap script path
- preparation state
- issues
- watchdog mode

### `ensureCodeServerPrepared(options?)`

Runs the package-owned bootstrap script when the installation is repairable.

Use this explicitly when a host wants a preflight step. Otherwise the session manager runs it automatically.

## Readiness Targets

The package now treats readiness as a sequence instead of a single open port:

- `tcp`
- `http`
- `websocket`
- `browser-shell`
- `workbench`

`waitForCodeServerReady()` returns explicit checkpoints. Session startup persists those details so a host can distinguish cases such as “HTTP shell ready but browser bootstrap failed” from “process exited before ready”.

`websocket`, `browser-shell`, and `workbench` readiness can use the browser diagnostics bridge when a host does not want to hardcode product-specific websocket routes.

## Launch Planning APIs

The lower-level planning APIs still exist for hosts that want custom execution layers.

### `createCodeServerIntegrationPlan(options)`

This is the preferred lower-level planning API. It returns:

- final `command` and `args`
- final `bindings`
- `cwd` and `env`
- preparation status
- support-root bind suggestions
- readable and writable path suggestions
- host-visible and sandbox-visible path lists
- translated path pairs

### `createCodeServerLaunchPlan(options)`

Compatibility-friendly alias for callers that still want the previous naming. It now routes through the richer integration-plan path.

The returned plan already includes final `bindings`, `recommendedReadablePaths`, `recommendedWritablePaths`, and `translatedPaths`, so a host does not need to rebuild support-tree mount decisions itself.

### `createCodeServerLaunchSpec(plan)`

Converts the plan into a smaller execution-oriented shape:

- `command`
- `args`
- `cwd`
- `env`
- `bindings`
- `readablePaths`
- `writablePaths`

## Direct And Systemd Launching

### Direct

```ts
import {
  createCodeServerLaunchPlan,
  launchCodeServerProcess,
  waitForCodeServerReady,
} from "@trebired/code-server-kit";

const plan = await createCodeServerLaunchPlan({
  dataRoot: "/srv/code-server/session-42",
  workspacePath: "/srv/workspaces/demo",
});

const handle = await launchCodeServerProcess({ plan });

await waitForCodeServerReady({
  host: plan.host,
  port: plan.port,
  process: handle,
});
```

### Session Diagnostics

```ts
const sessions = createCodeServerSessionManager();

const started = await sessions.start({
  sanitizer: {
    pathPrefixes: ["/srv"],
  },
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
  trustedOrigins: ["https://app.example.com"],
  workspacePath: "/srv/workspaces/demo",
});

const diagnostics = await sessions.readDiagnostics({
  sanitizer: {
    pathPrefixes: ["/srv"],
  },
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
});

console.log(started.status.lastStartSummary);
console.log(diagnostics?.sanitized?.summary);
```

Persisted diagnostics now include:

- normalized phase
- stable code
- retryability
- hints
- readiness checkpoints
- browser events when browser integration is enabled

### Browser Integration

Browser integration is optional but first-class. The package provides generic helpers so hosts do not need to reimplement the fragile frontend instrumentation layer:

- `createBrowserDiagnosticsScript(options)`
- `browserReadinessPolicy(options)`
- `parseBrowserDiagnosticEvent(value)`
- `createHtmlInjectionPlan(options)`
- `createSessionDiagnosticsBridge(options)`

Typical flow:

1. Create a diagnostics bridge on the server.
2. Generate an injected browser script.
3. Insert that script into proxied shell HTML.
4. Forward emitted browser events into the bridge.
5. Start the session with `readinessTarget: "browser-shell"` or `"workbench"` and pass the bridge.

The generated script can report generic events such as:

- shell loaded
- websocket opened
- workbench mounted
- bootstrap timeout
- resource failures
- CSP violations
- worker and service-worker issues

### Readonly Sessions

Readonly mode is now planned inside the package rather than copied in each host:

- readonly workspace binding suggestions
- ephemeral user-data and extensions roots
- shared readonly settings patch helpers
- optional browser guard hooks

Relevant helpers:

- `createReadonlySessionPolicy(options)`
- `DEFAULT_CODE_SERVER_READONLY_SETTINGS_PATCH`

### Maintainer And CI Tooling

The package now includes higher-level helpers for CI and package maintenance:

- `runCodeServerDoctor()`
- `runCodeServerSmokeTest()`
- `explainCodeServerFailure()`

These helpers are intended for validation jobs, reproduction harnesses, and “tell me why this failed” workflows without forcing callers to stitch together the lower-level pieces themselves.

### Systemd

Linux-first transient systemd support is built into the same package and stays explicit.

Relevant APIs:

- `launchCodeServerWithSystemd(options)`
- `restartCodeServerSystemdUnit(options)`
- `stopCodeServerSystemdUnit(options)`
- `readCodeServerSystemdStatus(options)`
- `readCodeServerSystemdJournal(options)`
- `summarizeCodeServerSystemdJournal(options)`
- `extractCodeServerSystemdFailure(options)`
- `createCodeServerSystemdLaunchCommand(options)`

`systemd` launches require an explicit scope:

- `scope: "user"`
- `scope: "system"`

There is no package default.

```ts
const sessions = createCodeServerSessionManager();

const started = await sessions.start({
  launchStrategy: "systemd",
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
  systemd: {
    scope: "user",
  },
  trustedOrigins: ["https://app.example.com"],
  workspacePath: "/srv/workspaces/demo",
});

console.log(started.status.unitName);
```

## Diagnostics And Redaction

### `collectCodeServerStartupDiagnostics(options)`

Builds a structured diagnostic object with:

- category
- code
- summary
- machine-readable details
- launch strategy
- watchdog mode
- stderr and stdout tails
- systemd journal summary

Supported normalized categories include:

- `startup_timeout`
- `process_exited_before_ready`
- `systemd_launch_failed`
- `systemd_unit_failed`
- `entrypoint_resolution_failed`
- `missing_runtime_dependency`
- `preparation_failed`
- `invalid_configuration`

### `sanitizeCodeServerDiagnostics(diagnostics, options)`

Supports:

- path-prefix redaction
- exact-value redaction
- a custom replacer hook

The package only sanitizes when a host asks for it.

## Profile Lifecycle

Profile sync stays allowlist-based instead of copying the whole runtime tree.

Supported items:

- `settings.json`
- `extensions.json`
- `keybindings.json`
- `snippets`
- `extensions`

Lower-level APIs:

- `createCodeServerProfileSyncPlan(options)`
- `syncCodeServerProfile(options)`
- `readCodeServerProfileSnapshot(options)`
- `readCodeServerProfileSignature(options)`
- `persistCodeServerProfileIfChanged(options)`

Session-manager integration now handles:

- restore only when runtime profile data is missing or empty by default
- persistence only when the allowlisted signature changed by default
- optional extension snapshotting in the signature

```ts
const sessions = createCodeServerSessionManager();

await sessions.start({
  profile: {
    persistTo: "/srv/code-server-profiles/workspace-42",
    restoreFrom: "/srv/code-server-profiles/workspace-42",
    snapshotExtensions: true,
  },
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
  trustedOrigins: ["https://app.example.com"],
  workspacePath: "/srv/workspaces/demo",
});
```

## Proxy Helpers

Generic proxy-facing helpers now include:

- `buildForwardedHeaders(options)`
- `buildCodeServerWebSocketHeaders(options)`
- `isCodeServerHtmlResponse(options)`
- `classifyCodeServerProxyFailure(options)`

These helpers stay framework-agnostic and do not add product-specific route rewriting.

## Structured Errors

Examples:

- `CodeServerPreparationError`
- `CodeServerInvalidConfigurationError`
- `CodeServerInstallationResolutionError`
- `CodeServerEntrypointResolutionError`
- `CodeServerLaunchPlanningError`
- `CodeServerPortAllocationError`
- `CodeServerStartupTimeoutError`
- `CodeServerProcessExitedBeforeReadyError`
- `CodeServerSessionLifecycleError`
- `CodeServerSessionReuseConflictError`
- `CodeServerSystemdLaunchError`
- `CodeServerSystemdCollisionError`
- `CodeServerSystemdStatusError`
- `CodeServerSystemdJournalError`

Use `normalizeCodeServerStartupFailure(error)` when you want one consistent structured startup-failure payload.

## Migration Note

Existing host apps should delete generic glue for:

- reading from `node_modules/code-server/...` directly
- running `code-server` postinstall repair themselves
- discovering support roots or remapping entrypoints manually
- building support-tree read-only bind lists manually
- translating host paths into sandbox-visible `code-server` paths
- deduplicating concurrent starts for the same session key
- comparing profile state before persisting
- parsing raw startup output into user-facing summaries
- building websocket proxy headers and classifying common upstream failures

Prefer:

- `createCodeServerSessionManager()`
- `startCodeServerSession()`

Keep low-level APIs only when you truly need a custom execution layer.

## Direct `code-server` Dependency

None by default.

Host applications only need a separate direct `code-server` dependency when they intentionally override resolution behavior, such as:

- testing against a different installation root
- pinning a different package copy outside `@trebired/code-server-kit`
- using custom resolution during advanced development workflows

## Intentionally Deferred

- non-Linux lifecycle orchestration
- container runtime wrappers
- host-specific sandbox policy
- Windows and macOS service-management behavior
- a stronger watchdog strategy than preparation plus disabled-fallback classification, unless future `code-server` versions expose a cleaner supported switch
