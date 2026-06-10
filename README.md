# @trebired/code-server-kit

Framework-agnostic `code-server` integration helpers for Node.js applications.

`@trebired/code-server-kit` gives host applications a typed, generic layer for resolving an installed `code-server`, building a complete launch plan, waiting for readiness, syncing selected profile data, and preparing the result for direct processes, systemd units, containers, or custom sandboxes.

The package stays in one lane:

- resolve the installed `code-server` package root and launch entrypoint
- describe the final launch command, args, cwd, env, and path-access suggestions
- expose structured errors that host apps can log and branch on
- optionally spawn the process and wait for readiness
- sync allowlisted profile data without copying a whole runtime tree
- help reverse-proxy integrations with trusted-origin and forwarded-header helpers

It does not try to be a `code-server` fork, a sandbox manager, a container runtime, or a product layer with app-specific routes and filesystem rules.

## Install

Runtime target: Node.js 22+ on Linux first.

```sh
npm install @trebired/code-server-kit code-server
```

## Quick Start

```ts
import {
  createCodeServerLaunchPlan,
  launchCodeServerProcess,
  waitForCodeServerReady,
} from "@trebired/code-server-kit";

const plan = await createCodeServerLaunchPlan({
  dataRoot: "/srv/code-server/session-42",
  host: "127.0.0.1",
  port: 8080,
  trustedOrigins: [
    "https://app.example.com",
  ],
  workspacePath: "/srv/workspaces/demo",
});

const handle = await launchCodeServerProcess({
  plan,
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  },
});

await waitForCodeServerReady({
  host: plan.host,
  port: plan.port,
  process: handle,
  timeoutMs: 30_000,
});
```

## Why The Launch Plan Exists

Most host apps do not want to know where `code-server` put its real entry file, when to call `node <entry.js>` versus a direct executable, which package directories should be mounted read-only, or which runtime paths must stay writable.

`createCodeServerLaunchPlan()` moves that generic integration work into one reusable contract so host apps can focus on policy instead:

- what workspace should be opened
- which paths should actually be writable in a sandbox
- how processes are supervised
- which users, tokens, or routes exist in the host product

## Main Planning API

### `createCodeServerLaunchPlan(options)`

This is the main higher-level API. It returns a structured `CodeServerLaunchPlan` with:

- `command`
- `args`
- `cwd`
- `env`
- `entryKind`
- `launchMode`
- `installation`
- `userDataDir`
- `extensionsDir`
- `supportRoot`
- `supportBindings`
- `recommendedReadablePaths`
- `recommendedWritablePaths`
- `bindAddr`
- `host`
- `port`
- `trustedOrigins`
- `workspacePath`

If you pass `dataRoot`, the package derives:

- `${dataRoot}/user-data`
- `${dataRoot}/extensions`

If you omit `port` or pass `0`, the package allocates a free TCP port first.

Example:

```ts
import { createCodeServerLaunchPlan } from "@trebired/code-server-kit";

const plan = await createCodeServerLaunchPlan({
  dataRoot: "/srv/code-server/session-42",
  host: "127.0.0.1",
  port: 0,
  trustedOrigins: [
    "https://app.example.com",
    "https://admin.example.com",
  ],
  workspacePath: "/srv/workspaces/demo",
});
```

### `resolveCodeServerInstallation(options?)`

Use this lower-level helper when you only need installation metadata:

- `packageRoot`
- `packageJsonPath`
- `entryPoint`
- `entryRelativePath`
- `entryKind`
- `supportRoot`
- `version`

### `createCodeServerLaunch(options)`

This remains available as a compatibility-friendly alias for `createCodeServerLaunchPlan()`.

## Launch Specs And Sandbox Helpers

### `createCodeServerLaunchSpec(plan)`

Converts a launch plan into a smaller execution-oriented shape:

- `command`
- `args`
- `cwd`
- `env`
- `readablePaths`
- `writablePaths`
- `bindings`

This is useful when a caller wants to feed the launch plan into:

- a direct child-process launch
- a systemd unit generator
- a container wrapper
- a custom sandbox layer

### `formatCodeServerCommand(planOrSpec)`

Formats the command and arg vector as one safely escaped string for logs, debug output, shell transcripts, or generated unit files.

### `normalizeCodeServerStartupFailure(error)`

Converts package-specific and generic thrown values into one consistent startup-failure shape with:

- `name`
- `message`
- `code`
- `details`
- `isCodeServerKitError`

## Launching Strategies

### Direct Child Process

Use the built-in launcher when you want a plain host-owned child process:

```ts
import {
  createCodeServerLaunchPlan,
  launchCodeServerProcess,
} from "@trebired/code-server-kit";

const plan = await createCodeServerLaunchPlan({
  dataRoot: "/srv/code-server/session-42",
  workspacePath: "/srv/workspaces/demo",
});

const handle = await launchCodeServerProcess({ plan });
```

### Systemd

Use `createCodeServerLaunchPlan()` or `createCodeServerLaunchSpec()` to generate:

- `ExecStart` from `command` plus `args`
- `WorkingDirectory` from `cwd`
- `Environment` lines from `env`
- read and write path policy from `bindings`, `readablePaths`, and `writablePaths`

### Containers

Use the launch plan to decide:

- which package and support paths should be mounted read-only
- which runtime paths should be mounted writable
- the final command and arg vector inside the container

The package does not impose a container layout. It only returns generic path suggestions.

### Custom Sandboxes

Use `supportBindings`, `recommendedReadablePaths`, and `recommendedWritablePaths` as generic inputs to your own sandbox policy. Host apps can tighten or expand those lists without re-deriving them from package internals.

## Readiness Helpers

### `waitForCodeServerReady(options)`

Waits for the target TCP port to accept connections and can also:

- fail on startup timeout
- fail early if a child process exits first
- run a caller-provided `failureProbe`

The readiness helper throws structured errors instead of returning vague booleans.

Example:

```ts
await waitForCodeServerReady({
  host: plan.host,
  port: plan.port,
  process: handle,
  failureProbe({ elapsedMs }) {
    if (elapsedMs > 10_000) {
      return {
        message: "startup looked stalled",
      };
    }
    return null;
  },
});
```

## Profile Sync Helpers

The package now includes generic profile sync helpers built around an allowlist model.

Supported profile items:

- `settings.json`
- `extensions.json`
- `keybindings.json`
- `snippets`
- `extensions`

### `createCodeServerProfileSyncPlan(options)`

Builds a sync plan between two profile roots without copying anything yet.

### `syncCodeServerProfile(options)`

Copies only the allowlisted profile items. By default it skips missing or unreadable sources cleanly instead of assuming full access to every runtime-owned path.

Example:

```ts
import { syncCodeServerProfile } from "@trebired/code-server-kit";

const result = await syncCodeServerProfile({
  sourceDir: "/srv/persisted-profile",
  targetDir: "/srv/runtime-profile",
  items: ["settings.json", "snippets", "extensions"],
});

console.log(result.copied.length, result.skipped.length);
```

Default relative paths are also exported through `DEFAULT_CODE_SERVER_PROFILE_PATHS`, and callers can override them when needed through `pathMap`.

## Reverse Proxy Helpers

### `normalizeTrustedOrigins(origins)`

Normalizes absolute origins for launch planning and rejects invalid values clearly.

### `normalizeTrustedOrigin(origin)`

Normalizes one origin value.

### `buildForwardedHeaders(options)`

Builds a small forwarded-header record for reverse-proxy embedding.

### `isCodeServerHtmlResponse(options)`

Returns `true` when a response looks like HTML that a host app may want to transform before returning it to a browser.

This helper is intentionally narrow. It does not rewrite routes or inject product-specific markup.

## Structured Errors

The package exposes structured error classes so host apps can log clearly and branch reliably:

- `CodeServerInstallationResolutionError`
- `CodeServerEntrypointResolutionError`
- `CodeServerLaunchPlanningError`
- `CodeServerInvalidConfigurationError`
- `CodeServerPortAllocationError`
- `CodeServerProcessExitedBeforeReadyError`
- `CodeServerStartupProbeError`
- `CodeServerStartupTimeoutError`

The earlier compatibility exports are still available:

- `CodeServerPackageResolutionError`
- `CodeServerBinaryNotFoundError`

## Public Surface

The current API is centered around these exports:

- `resolveCodeServerInstallation()`
- `createCodeServerLaunchPlan()`
- `createCodeServerLaunch()`
- `createCodeServerLaunchSpec()`
- `launchCodeServerProcess()`
- `waitForCodeServerReady()`
- `createCodeServerProfileSyncPlan()`
- `syncCodeServerProfile()`
- `buildForwardedHeaders()`
- `normalizeTrustedOrigins()`
- `normalizeTrustedOrigin()`
- `isCodeServerHtmlResponse()`
- `formatCodeServerCommand()`
- `normalizeCodeServerStartupFailure()`

## Dependency vs Peer Dependency for `code-server`

For an application, prefer a regular `dependency` on `code-server` when you want one installed runtime and want `@trebired/code-server-kit` to resolve the same package reliably every time.

For a wrapper library on top of this package, prefer a `peerDependency` on `code-server` when the host application must choose the exact `code-server` version and install location itself. In that setup, document that `code-server` must still be resolvable from the host application's dependency tree, and pass `resolveFrom` when you need to anchor resolution to the host side explicitly.
