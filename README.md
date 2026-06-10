# @trebired/code-server-kit

Framework-agnostic `code-server` session runtime for Node.js applications.

`@trebired/code-server-kit` is the generic Trebired package for owning the full `code-server` lifecycle on Linux-first hosts:

- resolve the installed `code-server`
- build launch plans and sandbox-friendly execution specs
- restore and persist allowlisted profile data
- launch directly or through transient systemd services
- supervise readiness and startup failures
- reuse, stop, restart, and inspect sessions with structured metadata

The package stays generic on purpose. It does not know about products, repositories, organizations, users, routes, or app-specific filesystem conventions.

## Install

Runtime target: Node.js 22+ on Linux first.

```sh
npm install @trebired/code-server-kit code-server
```

## What Host Apps Still Provide

After the session runtime layer is in place, host applications mostly choose policy:

- `sessionKey`
- `stateRoot`
- `workspacePath`
- `trustedOrigins`
- `launchStrategy`
- systemd `scope` when using systemd
- optional profile roots
- optional logging and policy hooks

The package owns the generic mechanics:

- installation resolution
- entrypoint resolution
- `node <entry.js>` vs direct executable launch
- runtime profile directory defaults
- direct launch vs systemd launch translation
- readiness probing
- session reuse checks
- session metadata persistence
- startup diagnostics normalization

## Quick Start

```ts
import {
  createCodeServerSessionManager,
} from "@trebired/code-server-kit";

const sessions = createCodeServerSessionManager({
  logger: console,
});

const started = await sessions.start({
  launchStrategy: "direct",
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

## Main Session APIs

### `createCodeServerSessionManager(options?)`

Creates the main high-level lifecycle object and wires logging through `@trebired/logger-adapter`.

Manager methods:

- `start(options)`
- `stop(options)`
- `restart(options)`
- `getStatus(options)`
- `readDiagnostics(options)`

### `startCodeServerSession(options)`

One-shot helper that creates a manager and starts a session.

Lifecycle-managed session APIs require:

- `sessionKey`
- `stateRoot`

Defaults:

- `launchStrategy` defaults to `"direct"`
- reuse defaults to exact normalized spec match
- `dataRoot` defaults to `stateRoot/sessions/<sessionKey>/runtime`
- systemd never defaults its scope

### `stopCodeServerSession(options)`

Stops a direct child process or a systemd transient unit using the stored session metadata. If profile persistence is configured, the package persists allowlisted profile items after stop.

### `restartCodeServerSession(options)`

Runs stop then start with the same session request shape.

### `getCodeServerSessionStatus(options)`

Loads the package-owned session record and re-probes the live backing resource instead of trusting disk alone.

### `readCodeServerSessionDiagnostics(options)`

Reads the persisted diagnostics snapshot for a session.

## Session Metadata

The package stores generic lifecycle metadata under:

- `<stateRoot>/sessions/<safe-session-key>/session.json`
- `<stateRoot>/sessions/<safe-session-key>/diagnostics.json`

The session record tracks values such as:

- `state`
- `launchStrategy`
- `specHash`
- `bindAddr`
- `port`
- `userDataDir`
- `extensionsDir`
- `workspacePath`
- `pid` for direct launches
- `unitName` and `systemdScope` for systemd launches
- timestamps and normalized failure details

This disk-backed record is what allows the package to reuse, stop, restart, and inspect sessions across calls.

## Reuse Model

The package builds a normalized session spec from the effective launch plan plus lifecycle-relevant inputs such as:

- launch strategy
- workspace path
- trusted origins
- env overrides
- profile restore and persist configuration
- systemd scope and unit naming

That normalized spec is hashed and stored. Reuse only happens when:

- the same `sessionKey` is used
- the spec hash matches exactly
- the backing process or unit still exists
- the target port becomes ready again

If the hash changes, the package marks the old record stale, stops the old runtime when needed, and starts a fresh session.

## Launch Planning APIs

The lower-level launch planning APIs remain available for callers that want policy ownership while still avoiding `code-server` package-layout details.

### `resolveCodeServerInstallation(options?)`

Returns installation metadata:

- `packageRoot`
- `packageJsonPath`
- `entryPoint`
- `entryRelativePath`
- `entryKind`
- `supportRoot`
- `version`

### `createCodeServerLaunchPlan(options)`

Returns a structured launch plan with:

- `command`
- `args`
- `cwd`
- `env`
- `entryKind`
- `launchMode`
- `installation`
- `bindAddr`
- `host`
- `port`
- `supportRoot`
- `supportBindings`
- `recommendedReadablePaths`
- `recommendedWritablePaths`
- `userDataDir`
- `extensionsDir`
- `workspacePath`

### `createCodeServerLaunchSpec(plan)`

Converts the launch plan into an execution-oriented shape:

- `command`
- `args`
- `cwd`
- `env`
- `bindings`
- `readablePaths`
- `writablePaths`

This is useful when a host wants to feed the same plan into a container, custom sandbox, or generated unit file.

## Direct Launch

Use the built-in child-process helper when you want a plain process owned by the current Node.js runtime.

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

The lifecycle manager uses this same lower-level path internally for `launchStrategy: "direct"`.

## Systemd Launch

Linux systemd support is built into the same package and stays explicit.

Use `launchStrategy: "systemd"` only when you also provide:

- `systemd.scope: "user"` or `"system"`

The package uses transient services through `systemd-run`, not scopes.

Relevant APIs:

- `launchCodeServerWithSystemd(options)`
- `stopCodeServerSystemdUnit(options)`
- `readCodeServerSystemdStatus(options)`
- `readCodeServerSystemdJournal(options)`
- `createCodeServerSystemdLaunchCommand(options)`
- `buildSystemdPathProperties(spec)`

The systemd translation layer derives:

- `--unit`
- `--working-directory`
- `--setenv`
- `BindPaths`
- `BindReadOnlyPaths`
- `ReadOnlyPaths`
- `ReadWritePaths`

That means host applications do not need to rebuild transient unit arguments from raw launch-plan data themselves.

## Profile Restore And Persist

Profile sync stays allowlist-based rather than copying the entire runtime tree.

Supported items:

- `settings.json`
- `extensions.json`
- `keybindings.json`
- `snippets`
- `extensions`

Lower-level helpers:

- `createCodeServerProfileSyncPlan(options)`
- `syncCodeServerProfile(options)`
- `resolveCodeServerProfilePathMap(overrides?)`

Lifecycle integration:

- restore before launch with `profile.restoreFrom`
- persist after stop with `profile.persistTo`
- skip missing or unreadable sources cleanly by default

Example:

```ts
await sessions.start({
  profile: {
    items: ["settings.json", "keybindings.json", "extensions"],
    persistTo: "/srv/profiles/demo",
    restoreFrom: "/srv/profiles/demo",
  },
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server-state",
  workspacePath: "/srv/workspaces/demo",
});
```

## Readiness And Failure Handling

### `waitForCodeServerReady(options)`

Waits for the TCP port to accept connections and can also:

- fail on startup timeout
- fail on direct-process early exit
- fail on a caller-provided failure probe

The lifecycle manager builds on this and adds strategy-aware supervision:

- direct-process stdout and stderr tails
- systemd state probing
- systemd journal collection
- normalized startup failure metadata

## Structured Errors

The package throws structured error classes so callers can log and branch on them reliably.

Examples:

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

Use `normalizeCodeServerStartupFailure(error)` when you want one tagged object shape for logs or API responses.

## Reverse Proxy Helpers

The package also includes a few small generic embedding helpers:

- `buildForwardedHeaders(options)`
- `normalizeTrustedOrigin(value)`
- `isCodeServerHtmlResponse(options)`

These helpers stay intentionally small. They do not add product-specific route rewriting.

## Logging

High-level APIs accept:

- `logger`
- `loggerAdapter`

The package resolves those through `@trebired/logger-adapter`, matching the style used by other `@trebired/*` packages. `createCodeServerSessionManager()` also emits `logPackageInitialized()` on creation.

## `code-server`: Dependency vs Peer Dependency

Use `code-server` as a normal `dependency` when:

- this package is part of an application deployment
- you want the runtime to own the exact installed `code-server`
- you want installation resolution to succeed without extra host setup

Use `code-server` as a `peerDependency` in your own higher-level package when:

- your package wraps `@trebired/code-server-kit`
- the final host application should choose the `code-server` version
- you want to avoid forcing duplicate `code-server` installs across wrappers

`@trebired/code-server-kit` itself depends on `code-server` because the generic runtime layer needs a predictable package to resolve.
