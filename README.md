# @trebired/code-server-kit

Framework-agnostic `code-server` ownership layer for Bun hosts.

`@trebired/code-server-kit` is the generic Trebired package for taking control of the real `code-server` integration lifecycle on Linux-first systems:

- install validation, repair, and entrypoint resolution
- launch planning for direct and transient systemd execution
- session ownership with reuse, restart, stale invalidation, readiness, and persisted diagnostics
- browser bridge ownership for workbench detection, browser diagnostics, and readonly guards
- HTML transform ownership for nonce-safe injection and idempotent rewriting
- proxy ownership for forwarded headers, websocket headers, response branching, and service-worker overrides
- profile lifecycle ownership for allowlisted restore, persist, settings patching, and readonly runtime defaults

The package stays generic on purpose. It does not know about products, routes, repositories, branding, or vendor-specific runtime conventions.

## Install

Runtime support: Bun 1+.

```sh
bun i @trebired/code-server-kit
```

## Quick Start

The preferred host integration is:

1. Create one readonly policy.
2. Create one profile policy.
3. Create one browser bridge.
4. Create one proxy adapter.
5. Create one session manager.

```ts
import {
  createCodeServerBrowserBridge,
  createCodeServerProfilePolicy,
  createCodeServerProxyAdapter,
  createCodeServerSessionManager,
  createReadonlySessionPolicy,
} from "@trebired/code-server-kit";

const readonly = createReadonlySessionPolicy({
  enabled: true,
  mode: "view",
});

const profile = createCodeServerProfilePolicy({
  includeExtensionState: true,
  persistTo: "/srv/code-server/profiles/demo",
  restoreFrom: "/srv/code-server/profiles/demo",
  readonly,
});

const browser = createCodeServerBrowserBridge({
  diagnostics: {
    bridgeProperty: "__codeServerBridge__",
    transport: {
      mode: "postmessage",
      targetOrigin: "https://app.example.com",
    },
  },
  readonly,
  sessionKey: "workspace-42",
});

const proxy = createCodeServerProxyAdapter({
  browser,
  profile,
  profilePersistTrigger: "transformed-html",
  profileRuntimeDir: "/srv/code-server/state/sessions/workspace-42/runtime/user-data",
  readonly,
  serviceWorker: {
    mode: "neutralize",
  },
});

const sessions = createCodeServerSessionManager({
  browser: {
    integration: browser,
  },
  profile,
  readonly,
});

const started = await sessions.start({
  launchStrategy: "direct",
  sessionKey: "workspace-42",
  stateRoot: "/srv/code-server/state",
  trustedOrigins: [
    "https://app.example.com",
  ],
  workspacePath: "/srv/workspaces/demo",
});

console.log(started.status.ready, started.status.port, started.status.correlationId);
```

At that point the host mostly provides:

- `sessionKey`
- `stateRoot`
- `workspacePath`
- `trustedOrigins`
- launch strategy
- readonly mode
- profile roots
- optional metadata
- optional logging

## Concepts

### Session Diagnostics

Each managed session persists:

- `<stateRoot>/sessions/<safe-session-key>/session.json`
- `<stateRoot>/sessions/<safe-session-key>/diagnostics.json`

Diagnostics snapshots include:

- correlation id
- backend checkpoints
- readiness checkpoints
- readonly enforcement summaries for the active launch path
- normalized failures
- browser events
- browser summary
- stdout and stderr tails when available

`getCodeServerSessionStatus()` returns the latest persisted view plus current readiness probing.

### Browser + Proxy Example

The package does not force a specific HTTP framework. A host can wire the proxy adapter into its own server stack.

```ts
const upstream = await fetch("http://127.0.0.1:8080/", {
  headers: proxy.buildForwardedHeaders({
    forwardedFor: "10.0.0.10",
    host: "app.example.com",
    proto: "https",
  }),
});

const body = await upstream.text();
const handled = await proxy.handleResponse({
  body,
  headers: Object.fromEntries(upstream.headers.entries()),
  method: "GET",
  pathname: "/",
  statusCode: upstream.status,
});

// Write handled.statusCode, handled.headers, and handled.body to the client.
```

For browser diagnostics callbacks or endpoints:

```ts
const events = browser.parseMessage(requestBody);
for (const event of events) {
  browser.bridge.recordEvent(event);
}
```

### Profile Policy Example

```ts
const profile = createCodeServerProfilePolicy({
  includeExtensionState: true,
  items: [
    "settings.json",
    "keybindings.json",
    "extensions",
    "globalStorage",
  ],
  persistTo: "/srv/code-server/profiles/demo",
  restoreFrom: "/srv/code-server/profiles/demo",
  readonly,
});

await profile.prepareRuntimeProfile("/srv/code-server/state/sessions/demo/runtime/user-data");
await profile.persistRuntimeProfile("/srv/code-server/state/sessions/demo/runtime/user-data");
```

## Runtime

### Install Notes

`code-server` is bundled as a normal dependency of this package. A host application usually does not need its own direct `code-server` dependency unless it intentionally wants to override resolution.

### Notes

- Linux-first by design.
- Bun-first by design.
- Generic by design.
- No host route names, repository assumptions, or branding hooks are required.

## Public API

### Main Ownership APIs

#### `createCodeServerSessionManager(options?)`

The package-owned lifecycle entrypoint.

Manager methods:

- `start(options)`
- `stop(options)`
- `restart(options)`
- `getStatus(options)`
- `readDiagnostics(options)`

What it owns:

- inflight join vs conflict behavior
- stale session invalidation
- reuse when the effective spec still matches
- direct vs systemd launch supervision
- readiness progression
- persisted session state
- normalized startup failures
- diagnostics snapshots with correlation ids and backend checkpoints

Useful related helpers:

- `startCodeServerSession(options)`
- `stopCodeServerSession(options)`
- `restartCodeServerSession(options)`
- `inspectSessionFailure(options)`

#### `createCodeServerBrowserBridge(options?)`

The preferred browser integration owner.

Main methods:

- `createScript()`
- `injectHtml({ html, ... })`
- `transformHtml({ html, ... })`
- `parseEvent(value)`
- `parseMessage(value)`
- `classifyFailure(events?)`
- `summarize(events?)`

What it owns:

- workbench bootstrap detection
- shell vs workbench readiness
- forever-loading and frontend-stall detection
- websocket diagnostics
- resource load failures
- CSP violation capture
- service-worker diagnostics
- iframe/embed diagnostics
- readonly browser guards and blocked-action messaging

Related exports:

- `injectCodeServerBrowserBridgeHtml(options)`
- `parseBrowserDiagnosticEvent(value)`
- `createBrowserDiagnosticsScript(options)`
- `createSessionDiagnosticsBridge(options)`

#### `createCodeServerProxyAdapter(options?)`

The preferred reverse-proxy owner for generic Bun hosts.

Main methods:

- `buildForwardedHeaders(options)`
- `buildWebSocketHeaders(options)`
- `classifyResponse(options)`
- `responseRequiresTransform(options)`
- `handleResponse(options)`
- `maybeOverrideServiceWorker(pathname)`
- `persistProfile(runtimeDir?)`

What it owns:

- forwarded headers
- websocket upgrade headers
- HTML transform vs passthrough branching
- transform-time body header stripping
- proxy failure classification
- optional service-worker neutralization
- optional post-response hooks
- optional profile persist triggers

#### `createCodeServerProfilePolicy(options?)`

The preferred profile lifecycle owner.

Main methods:

- `prepareRuntimeProfile(runtimeDir)`
- `restoreRuntimeProfile(runtimeDir)`
- `persistRuntimeProfile(runtimeDir)`
- `schedulePersistRuntimeProfile(runtimeDir)`
- `readRuntimeSnapshot(runtimeDir)`
- `describe()`

What it owns:

- allowlisted profile trees
- restore-if-missing-or-empty
- persist-if-changed
- signature comparison
- readonly runtime defaults
- settings patch merge
- optional extension-state handling through `globalStorage`
- optional persist debounce and inflight coalescing

#### `createReadonlySessionPolicy(options?)`

The preferred readonly policy owner.

Preferred host shape:

```ts
const readonly = createReadonlySessionPolicy({
  enabled: true,
  filesystem: {
    mode: "auto",
  },
  mode: "view",
});
```

What it owns:

- normalized readonly mode
- launch-time readonly workspace treatment
- direct-launch readonly filesystem wrapping when available
- systemd readonly filesystem hardening
- settings patch defaults
- blocked browser commands and shortcuts
- blocked command-URI links and writable-session promotion flows
- upload and drag/drop blocking
- readonly browser banner and messaging

Readonly filesystem policy is additive:

- `filesystem.mode: "auto"` tries to enforce a hard readonly write barrier in package-managed launches and reports when direct mode had to fall back to UI-only guards
- `filesystem.mode: "require"` keeps the same API shape but lets hosts require a hard boundary instead of silently accepting a soft fallback
- `filesystem.mode: "off"` keeps the browser/session guards while skipping filesystem wrapping

### Preparation APIs

The package distinguishes install presence from install launchability.

Main preparation exports:

- `getCodeServerReadinessStatus(options?)`
- `validateCodeServerInstall(options?)`
- `repairCodeServerInstall(options?)`
- `ensureCodeServerLaunchable(options?)`
- `getCodeServerPreparationStatus(options?)`
- `ensureCodeServerPrepared(options?)`

Use these when a host wants an explicit preflight step. Otherwise the session manager runs preparation automatically.

### Launch Planning APIs

Lower-level planning APIs still exist for advanced integrations:

- `createCodeServerIntegrationPlan(options)`
- `createCodeServerLaunchPlan(options)`
- `createCodeServerLaunchSpec(plan)`
- `buildCodeServerArgs(options)`

Returned plans already include:

- command and args
- readable and writable path suggestions
- readonly workspace treatment
- support-tree binding suggestions
- translated visible paths
- direct vs node execution decisions

### Systemd APIs

Transient systemd support remains available for hosts that need it:

- `createCodeServerSystemdLaunchCommand(options)`
- `launchCodeServerWithSystemd(options)`
- `readCodeServerSystemdStatus(options)`
- `stopCodeServerSystemdUnit(options)`
- `summarizeCodeServerSystemdJournal(options)`

The session manager uses the same underlying launch plan for direct and systemd flows.

## Migration Notes

### Migration Guide

The package now prefers high-level ownership APIs over app-side helper glue.

#### Replace This

- app-owned session reuse maps, inflight guards, and stale restart checks
- app-owned browser bootstrap scripts
- app-owned HTML string rewriting pipelines
- app-owned proxy HTML vs passthrough branching
- app-owned readonly browser event interception
- app-owned profile restore/persist orchestration

#### With This

- `createCodeServerSessionManager()`
- `createCodeServerBrowserBridge()`
- `createCodeServerProxyAdapter()`
- `createCodeServerProfilePolicy()`
- `createReadonlySessionPolicy()`

#### Recommended Mapping

- `createBrowserDiagnosticsScript()` -> `createCodeServerBrowserBridge()`
- `transformCodeServerHtml()` -> `createCodeServerProxyAdapter()` or `injectCodeServerBrowserBridgeHtml()`
- `buildForwardedHeaders()` and `buildCodeServerWebSocketHeaders()` -> `createCodeServerProxyAdapter()`
- `syncCodeServerProfile()` and `persistCodeServerProfileIfChanged()` -> `createCodeServerProfilePolicy()`
- host reuse/restart glue -> `createCodeServerSessionManager()`

#### What Stays Low-Level

These exports remain supported for advanced hosts that intentionally want more control:

- `createCodeServerIntegrationPlan()`
- `createCodeServerLaunchPlan()`
- `createCodeServerLaunchSpec()`
- `launchCodeServerProcess()`
- `createCodeServerSystemdLaunchCommand()`
- `buildForwardedHeaders()`
- `buildCodeServerWebSocketHeaders()`
- `createBrowserDiagnosticsScript()`
- `transformCodeServerHtml()`
- `createHtmlInjectionPlan()`
- `syncCodeServerProfile()`
- `persistCodeServerProfileIfChanged()`

These are still useful, but they are no longer the preferred starting point for normal host integrations.

## What It Does Not Do

This package does not:

- replace `code-server`
- own product routes, repositories, branding, or vendor runtime conventions
- hide host security or process-supervision policy

## License

Licensed under MIT. See [LICENSE](./LICENSE).
