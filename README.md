# @trebired/code-server-kit

Framework-agnostic `code-server` launch planning for Node.js applications.

`@trebired/code-server-kit` gives your app a small, typed layer for finding an installed `code-server`, building a stable launch command, waiting for readiness, and optionally spawning the process without leaking `code-server` package layout details into product code.

The package stays in one lane:

- resolve the installed `code-server` package root and launch entrypoint
- build standard `code-server` CLI args for host-managed sessions
- expose the launch command and args for your own sandbox or supervisor
- optionally spawn the process and capture stdout and stderr
- wait for the TCP port to become ready with timeout and early-exit handling

It does not try to be a `code-server` fork, a sandbox manager, a container runtime, or a product layer with app-specific routes and filesystem rules.

## Install

Runtime target: Node.js 22+ on Linux first.

```sh
npm install @trebired/code-server-kit code-server
```

## Quick Start

```ts
import {
  createCodeServerLaunch,
  launchCodeServerProcess,
  resolveCodeServerInstallation,
  waitForCodeServerReady,
} from "@trebired/code-server-kit";

const installation = resolveCodeServerInstallation({
  resolveFrom: process.cwd(),
});

const launch = await createCodeServerLaunch({
  installation,
  dataRoot: "/srv/code-server/session-42",
  host: "127.0.0.1",
  port: 8080,
  trustedOrigins: [
    "https://app.example.com",
  ],
  workspacePath: "/srv/workspaces/demo",
});

const processHandle = await launchCodeServerProcess({
  plan: launch,
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  },
});

await waitForCodeServerReady({
  host: launch.host,
  port: launch.port,
  process: processHandle,
  timeoutMs: 30_000,
});
```

## Public API

### `resolveCodeServerInstallation(options?)`

Resolves the installed `code-server` package from a caller-controlled starting path and returns:

- `packageRoot`
- `packageJsonPath`
- `entryPoint`
- `entryKind`
- `supportRoot`
- `version`

### `createCodeServerLaunch(options)`

Builds a stable launch plan and returns:

- `command`
- `args`
- `codeServerPackageRoot`
- `supportRoot`
- `userDataDir`
- `extensionsDir`
- `bindAddr`
- `host`
- `port`
- `workspacePath`

If you pass `dataRoot`, the package derives:

- `${dataRoot}/user-data`
- `${dataRoot}/extensions`

If you omit `port` or pass `0`, the package allocates a free TCP port first.

### `waitForCodeServerReady(options)`

Polls the target TCP port until it accepts connections or fails with:

- `CodeServerProcessExitedBeforeReadyError`
- `CodeServerStartupTimeoutError`

### `launchCodeServerProcess(options)`

Starts the resolved command directly with `stdout` and `stderr` hooks and returns a typed handle with:

- `child`
- `pid`
- `exit`
- `kill()`
- `getStdout()`
- `getStderr()`

## Launch Modes

`createCodeServerLaunch()` supports two concrete launch modes:

- `node`, which runs `node <entrypoint> ...`
- `direct`, which runs the resolved entrypoint directly when it is executable

`auto` is the default. It prefers `node` for JS entry files and `direct` for non-JS executables.

## Standard CLI Args

The launch plan always includes:

- `--auth none`
- `--bind-addr`
- `--disable-telemetry`
- `--disable-update-check`
- `--disable-workspace-trust`
- `--disable-getting-started-override`
- `--user-data-dir`
- `--extensions-dir`

Trusted origins are appended with repeated `--trusted-origins` flags, and `workspacePath` is appended as the positional workspace/folder target when provided.

## Dependency vs Peer Dependency for `code-server`

For an application, prefer a regular `dependency` on `code-server` when you want one installed runtime and want `@trebired/code-server-kit` to resolve the same package reliably every time.

For a wrapper library on top of this package, prefer a `peerDependency` on `code-server` when the host application must choose the exact `code-server` version and install location itself. In that setup, document that `code-server` must still be resolvable from the host application's dependency tree, and pass `resolveFrom` when you need to anchor resolution to the host side explicitly.

## Error Types

The package exposes structured errors for the failure modes that usually matter in integration code:

- `CodeServerBinaryNotFoundError`
- `CodeServerPackageResolutionError`
- `CodeServerPortAllocationError`
- `CodeServerProcessExitedBeforeReadyError`
- `CodeServerStartupTimeoutError`
