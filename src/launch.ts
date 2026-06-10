import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  CodeServerBinaryNotFoundError,
  CodeServerPortAllocationError,
} from "./errors.js";
import { resolveCodeServerInstallation } from "./resolve.js";
import type {
  CodeServerInstallation,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  LaunchCodeServerProcessOptions,
} from "./types.js";

const DEFAULT_BIND_HOST = "127.0.0.1";
const DIRECT_LAUNCH_ACCESS = fs.constants.X_OK;

async function createCodeServerLaunch(options: CodeServerLaunchOptions): Promise<CodeServerLaunchPlan> {
  const installation = options.installation ?? resolveCodeServerInstallation({
    resolveFrom: options.resolveFrom,
  });
  const launchMode = normalizeLaunchMode(options.launchMode, installation);
  const { extensionsDir, userDataDir } = resolveLaunchDirectories(options);
  const binding = await resolveLaunchBinding(options);
  const workspacePath = options.workspacePath ? path.resolve(options.workspacePath) : null;
  const trustedOrigins = normalizeTrustedOrigins(options.trustedOrigins);
  const cliArgs = buildCodeServerArgs({
    bindAddr: binding.bindAddr,
    extensionsDir,
    trustedOrigins,
    userDataDir,
    workspacePath,
  });

  if (launchMode === "direct") {
    assertDirectLaunchAvailable(installation.entryPoint);
  }

  return launchMode === "node"
    ? {
      args: [installation.entryPoint, ...cliArgs],
      bindAddr: binding.bindAddr,
      codeServerPackageRoot: installation.packageRoot,
      command: normalizeNodeCommand(options.nodeCommand),
      entryPoint: installation.entryPoint,
      extensionsDir,
      host: binding.host,
      launchMode,
      port: binding.port,
      supportRoot: installation.supportRoot,
      userDataDir,
      workspacePath,
    }
    : {
      args: cliArgs,
      bindAddr: binding.bindAddr,
      codeServerPackageRoot: installation.packageRoot,
      command: installation.entryPoint,
      entryPoint: installation.entryPoint,
      extensionsDir,
      host: binding.host,
      launchMode,
      port: binding.port,
      supportRoot: installation.supportRoot,
      userDataDir,
      workspacePath,
    };
}

async function launchCodeServerProcess(options: LaunchCodeServerProcessOptions): Promise<CodeServerProcessHandle> {
  const plan = options.plan;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const child = spawn(plan.command, plan.args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdoutChunks.push(text);
    options.stdout?.(text);
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrChunks.push(text);
    options.stderr?.(text);
  });

  const exit = new Promise<CodeServerProcessExit>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal: typeof signal === "string" ? signal as NodeJS.Signals : null,
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(wrapSpawnError(error, plan)));
  });

  return {
    args: [...plan.args],
    bindAddr: plan.bindAddr,
    child,
    codeServerPackageRoot: plan.codeServerPackageRoot,
    command: plan.command,
    exit,
    extensionsDir: plan.extensionsDir,
    getStderr() {
      return stderrChunks.join("");
    },
    getStdout() {
      return stdoutChunks.join("");
    },
    host: plan.host,
    kill(signal?: NodeJS.Signals | number) {
      return child.kill(signal);
    },
    launchMode: plan.launchMode,
    pid: child.pid,
    port: plan.port,
    supportRoot: plan.supportRoot,
    userDataDir: plan.userDataDir,
    workspacePath: plan.workspacePath,
  };
}

function buildCodeServerArgs(options: {
  bindAddr: string;
  extensionsDir: string;
  trustedOrigins: string[];
  userDataDir: string;
  workspacePath: string | null;
}): string[] {
  const args = [
    "--auth",
    "none",
    "--bind-addr",
    options.bindAddr,
    "--disable-telemetry",
    "--disable-update-check",
    "--disable-workspace-trust",
    "--disable-getting-started-override",
    "--user-data-dir",
    options.userDataDir,
    "--extensions-dir",
    options.extensionsDir,
  ];

  for (const origin of options.trustedOrigins) {
    args.push("--trusted-origins", origin);
  }

  if (options.workspacePath) {
    args.push(options.workspacePath);
  }

  return args;
}

function resolveLaunchDirectories(options: CodeServerLaunchOptions): {
  extensionsDir: string;
  userDataDir: string;
} {
  const dataRoot = options.dataRoot ? path.resolve(options.dataRoot) : null;
  const userDataDir = options.userDataDir
    ? path.resolve(options.userDataDir)
    : dataRoot
      ? path.join(dataRoot, "user-data")
      : null;
  const extensionsDir = options.extensionsDir
    ? path.resolve(options.extensionsDir)
    : dataRoot
      ? path.join(dataRoot, "extensions")
      : null;

  if (!userDataDir || !extensionsDir) {
    throw new TypeError(
      "createCodeServerLaunch requires userDataDir and extensionsDir, or a shared dataRoot.",
    );
  }

  return {
    extensionsDir,
    userDataDir,
  };
}

async function resolveLaunchBinding(options: CodeServerLaunchOptions): Promise<{
  bindAddr: string;
  host: string;
  port: number;
}> {
  if (options.bindAddr && (options.host || options.port !== undefined)) {
    throw new TypeError("Pass either bindAddr or host/port to createCodeServerLaunch, not both.");
  }

  if (options.bindAddr) {
    const parsed = parseBindAddr(options.bindAddr);
    const port = parsed.port === 0 ? await allocatePort(parsed.host) : parsed.port;

    return {
      bindAddr: formatBindAddr(parsed.host, port),
      host: parsed.host,
      port,
    };
  }

  const host = normalizeHost(options.host);
  const port = options.port == null || options.port === 0
    ? await allocatePort(host)
    : normalizePort(options.port);

  return {
    bindAddr: formatBindAddr(host, port),
    host,
    port,
  };
}

function normalizeLaunchMode(
  requested: CodeServerLaunchOptions["launchMode"],
  installation: CodeServerInstallation,
): Exclude<CodeServerLaunchOptions["launchMode"], "auto"> {
  if (requested === "direct" || requested === "node") {
    return requested;
  }

  return installation.entryKind === "executable" ? "direct" : "node";
}

function normalizeTrustedOrigins(value?: string[]): string[] {
  const normalized: string[] = [];

  for (const origin of value ?? []) {
    if (typeof origin !== "string") continue;
    const trimmed = origin.trim();
    if (!trimmed || normalized.includes(trimmed)) continue;
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeNodeCommand(value?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || process.execPath;
}

function normalizeHost(value?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || DEFAULT_BIND_HOST;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new TypeError("Port must be an integer between 0 and 65535.");
  }

  return value;
}

function parseBindAddr(bindAddr: string): {
  host: string;
  port: number;
} {
  const normalized = bindAddr.trim();
  const ipv6Match = /^\[(.+)\]:(\d+)$/.exec(normalized);
  if (ipv6Match) {
    return {
      host: ipv6Match[1],
      port: normalizePort(Number(ipv6Match[2])),
    };
  }

  const lastColonIndex = normalized.lastIndexOf(":");
  if (lastColonIndex <= 0) {
    throw new TypeError("bindAddr must use host:port or [host]:port format.");
  }

  return {
    host: normalized.slice(0, lastColonIndex),
    port: normalizePort(Number(normalized.slice(lastColonIndex + 1))),
  };
}

function formatBindAddr(host: string, port: number): string {
  return host.includes(":")
    ? `[${host}]:${port}`
    : `${host}:${port}`;
}

async function allocatePort(host: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      reject(new CodeServerPortAllocationError("Could not allocate a code-server TCP port.", {
        cause: error instanceof Error ? error.message : String(error),
        host,
      }));
    });

    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new CodeServerPortAllocationError("Could not determine the allocated code-server TCP port.", {
          host,
        }));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(new CodeServerPortAllocationError("Could not release the allocated code-server TCP port.", {
            cause: error.message,
            host,
            port: address.port,
          }));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function assertDirectLaunchAvailable(entryPoint: string) {
  try {
    fs.accessSync(entryPoint, DIRECT_LAUNCH_ACCESS);
  } catch (error) {
    throw new CodeServerBinaryNotFoundError("Resolved code-server entrypoint is not directly executable.", {
      cause: error instanceof Error ? error.message : String(error),
      entryPoint,
    });
  }
}

function wrapSpawnError(error: unknown, plan: CodeServerLaunchPlan): Error {
  const errorCode = typeof error === "object" && error && "code" in error
    ? String(error.code)
    : null;

  if (errorCode === "ENOENT") {
    return new CodeServerBinaryNotFoundError("Could not launch the resolved code-server command.", {
      args: plan.args,
      command: plan.command,
    });
  }

  return error instanceof Error ? error : new Error(String(error));
}

export { createCodeServerLaunch, launchCodeServerProcess };
