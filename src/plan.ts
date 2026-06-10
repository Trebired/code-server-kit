import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  CodeServerBinaryNotFoundError,
  CodeServerInvalidConfigurationError,
  CodeServerLaunchPlanningError,
  CodeServerPortAllocationError,
} from "./errors.js";
import { ensureCodeServerPrepared } from "./preparation.js";
import { resolveCodeServerInstallation } from "./resolve.js";
import type {
  CodeServerInstallation,
  CodeServerIntegrationPlan,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerLaunchMode,
  CodeServerLaunchSpec,
  CodeServerPathBinding,
  CreateCodeServerLaunchPlanOptions,
} from "./types.js";

const DEFAULT_BIND_HOST = "127.0.0.1";
const DIRECT_LAUNCH_ACCESS = fs.constants.X_OK;

async function createCodeServerIntegrationPlan(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerIntegrationPlan> {
  try {
    if (options.preparation?.mode !== "skip") {
      await ensureCodeServerPrepared({
        resolveFrom: options.resolveFrom,
        strictWatchdog: options.preparation?.strictWatchdog,
      });
    }

    const installation = options.installation ?? await resolveCodeServerInstallation({
      resolveFrom: options.resolveFrom,
      strictWatchdog: options.preparation?.strictWatchdog,
    });
    const launchMode = normalizeLaunchMode(options.launchMode, installation);
    const { extensionsDir, userDataDir } = resolveLaunchDirectories(options);
    const binding = await resolveLaunchBinding(options);
    const workspacePath = options.workspacePath ? path.resolve(options.workspacePath) : null;
    const trustedOrigins = normalizeTrustedOrigins(options.trustedOrigins);
    const cwd = path.resolve(options.cwd ?? installation.defaultCwd);
    const env = {
      ...installation.defaultEnv,
      ...(options.env ?? {}),
    };
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

    const command = launchMode === "node"
      ? normalizeNodeCommand(options.nodeCommand)
      : installation.entryPoint;
    const args = launchMode === "node"
      ? [installation.entryPoint, ...cliArgs]
      : cliArgs;
    const recommendedReadablePaths = uniquePaths([
      ...installation.recommendedReadablePaths,
      workspacePath,
    ]);
    const recommendedWritablePaths = uniquePaths([
      userDataDir,
      extensionsDir,
    ]);
    const translatedPaths = uniquePaths([
      installation.packageRoot,
      installation.supportRoot,
      workspacePath,
      userDataDir,
      extensionsDir,
    ]).map((value) => ({
      hostPath: value,
      visiblePath: value,
    }));

    return {
      args,
      bindAddr: binding.bindAddr,
      codeServerPackageRoot: installation.packageRoot,
      command,
      cwd,
      defaultCwd: installation.defaultCwd,
      defaultEnv: {
        ...installation.defaultEnv,
      },
      entryKind: installation.entryKind,
      entryPoint: installation.entryPoint,
      env,
      extensionsDir,
      host: binding.host,
      hostVisiblePaths: [...recommendedReadablePaths, ...recommendedWritablePaths],
      installation,
      launchMode,
      port: binding.port,
      preparationStatus: installation.preparationStatus,
      recommendedReadablePaths,
      recommendedWritablePaths,
      sandboxVisiblePaths: translatedPaths.map((value) => value.visiblePath),
      supportBindings: [...installation.supportBindings],
      supportRoot: installation.supportRoot,
      translatedPaths,
      trustedOrigins,
      userDataDir,
      watchdogMode: installation.preparationStatus.watchdogMode,
      workspacePath,
    };
  } catch (error) {
    if (
      error instanceof CodeServerLaunchPlanningError ||
      error instanceof CodeServerInvalidConfigurationError ||
      error instanceof Error && "code" in error
    ) {
      throw error;
    }

    throw new CodeServerLaunchPlanningError("Could not create a code-server integration plan.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function createCodeServerLaunchPlan(options: CreateCodeServerLaunchPlanOptions): Promise<CodeServerLaunchPlan> {
  return await createCodeServerIntegrationPlan(options);
}

async function createCodeServerLaunch(options: CodeServerLaunchOptions): Promise<CodeServerLaunchPlan> {
  return await createCodeServerLaunchPlan(options);
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

function buildCodeServerLaunchSpec(plan: CodeServerLaunchPlan): CodeServerLaunchSpec {
  const bindings = uniqueBindings([
    {
      access: "read",
      hostPath: plan.installation.packageRoot,
      mountPath: plan.installation.packageRoot,
      reason: "code-server package root",
    },
    ...plan.supportBindings,
    ...plan.recommendedWritablePaths.map((value) => ({
      access: "write" as const,
      hostPath: value,
      mountPath: value,
      reason: value === plan.userDataDir
        ? "code-server user data"
        : value === plan.extensionsDir
          ? "code-server extensions"
          : "code-server writable path",
    })),
  ]);

  return {
    args: [...plan.args],
    bindings,
    command: plan.command,
    cwd: plan.cwd,
    env: {
      ...plan.env,
    },
    readablePaths: [...plan.recommendedReadablePaths],
    writablePaths: [...plan.recommendedWritablePaths],
  };
}

function normalizeTrustedOrigins(value?: string[]): string[] {
  const normalized: string[] = [];

  for (const raw of value ?? []) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;

    let origin: string;
    try {
      origin = new URL(trimmed).origin;
    } catch {
      throw new CodeServerInvalidConfigurationError("trustedOrigins entries must be absolute origins.", {
        value: trimmed,
      });
    }

    if (origin === "null") {
      throw new CodeServerInvalidConfigurationError("trustedOrigins entries must resolve to normal HTTP or HTTPS origins.", {
        value: trimmed,
      });
    }

    if (!normalized.includes(origin)) {
      normalized.push(origin);
    }
  }

  return normalized;
}

function resolveLaunchDirectories(options: CreateCodeServerLaunchPlanOptions): {
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
    throw new CodeServerInvalidConfigurationError(
      "createCodeServerLaunchPlan requires userDataDir and extensionsDir, or a shared dataRoot.",
    );
  }

  return {
    extensionsDir,
    userDataDir,
  };
}

async function resolveLaunchBinding(options: CreateCodeServerLaunchPlanOptions): Promise<{
  bindAddr: string;
  host: string;
  port: number;
}> {
  if (options.bindAddr && (options.host || options.port !== undefined)) {
    throw new CodeServerInvalidConfigurationError(
      "Pass either bindAddr or host/port to createCodeServerLaunchPlan, not both.",
    );
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
  requested: CreateCodeServerLaunchPlanOptions["launchMode"],
  installation: CodeServerInstallation,
): Exclude<CodeServerLaunchMode, "auto"> {
  if (requested === "direct" || requested === "node") {
    return requested;
  }

  return installation.entryKind === "executable" ? "direct" : "node";
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
    throw new CodeServerInvalidConfigurationError("Port must be an integer between 0 and 65535.", {
      value,
    });
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
    throw new CodeServerInvalidConfigurationError("bindAddr must use host:port or [host]:port format.", {
      bindAddr,
    });
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

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const nextValue = path.resolve(value);
    if (!normalized.includes(nextValue)) {
      normalized.push(nextValue);
    }
  }

  return normalized;
}

function uniqueBindings(values: CodeServerPathBinding[]): CodeServerPathBinding[] {
  const bindings: CodeServerPathBinding[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = `${value.access}:${value.hostPath}:${value.mountPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bindings.push(value);
  }

  return bindings;
}

export {
  allocatePort,
  buildCodeServerArgs,
  buildCodeServerLaunchSpec,
  createCodeServerIntegrationPlan,
  createCodeServerLaunch,
  createCodeServerLaunchPlan,
  normalizeTrustedOrigins,
};
