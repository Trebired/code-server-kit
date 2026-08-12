import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { uniquePaths } from "#wb3eftm3t8ku";
import {
  CodeServerBinaryNotFoundError,
  CodeServerInvalidConfigurationError,
  CodeServerPortAllocationError,
} from "#8974ac53d713";
import type {
  CodeServerInstallation,
  CodeServerLaunchMode,
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerPathBinding,
  CodeServerReadonlyPolicy,
  CodeServerSandboxPlan,
  CreateCodeServerLaunchPlanOptions,
} from "#3c8d8166992a";

const DEFAULT_BIND_HOST = "127.0.0.1";
const DIRECT_LAUNCH_ACCESS = fs.constants.X_OK;

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
  if (options.workspacePath) args.push(options.workspacePath);
  return args;
}

function buildCodeServerLaunchSpec(plan: CodeServerLaunchPlan): CodeServerLaunchSpec {
  return {
    args: [...plan.args],
    bindings: [...plan.bindings],
    command: plan.command,
    cwd: plan.cwd,
    env: {
      ...plan.env,
    },
    readablePaths: [...plan.recommendedReadablePaths],
    readonly: plan.readonly,
    writablePaths: [...plan.recommendedWritablePaths],
  };
}

function buildRecommendedBindings(options: {
    extensionsDir: string;
    installation: CodeServerInstallation;
    recommendedWritablePaths: string[];
    readonly: CodeServerReadonlyPolicy;
    userDataDir: string;
    workspacePath: string | null;
}): CodeServerPathBinding[] {
  return uniqueBindings([
      {
        access: "read",
        hostPath: options.installation.packageRoot,
        mountPath: options.installation.packageRoot,
        reason: "code-server package root",
      },
      ...options.installation.supportBindings,
      ...(options.workspacePath
        ? [{
            access: options.readonly.enabled ? "read"as const : "write"as const,
            hostPath: options.workspacePath,
            mountPath: options.workspacePath,
            reason: options.readonly.enabled ? "readonly workspace mount" : "workspace mount",
        }]
        : []),
      ...options.recommendedWritablePaths.map((value) => ({
            access: "write"as const,
            hostPath: value,
            mountPath: value,
            reason: value === options.userDataDir
            ? "code-server user data"
            : value === options.extensionsDir
            ? "code-server extensions"
            : "code-server writable path",
      })),
  ]);
}

function buildSandboxPlan(options: {
    bindings: CodeServerPathBinding[];
    dataRoot?: string;
    readonly: CodeServerReadonlyPolicy;
    stateRoot?: string;
    supportBindings: CodeServerPathBinding[];
    workspacePath: string | null;
}): CodeServerSandboxPlan {
  const dataRoot = options.dataRoot ? path.resolve(options.dataRoot) : null;
  const sessionRoot = options.stateRoot ? path.resolve(options.stateRoot) : dataRoot;

  return {
    bindings: [...options.bindings],
    collisionSafeName: sessionRoot ? path.basename(sessionRoot) : null,
    ephemeralStateRoot: dataRoot,
    readablePaths: options.bindings.filter((binding) => binding.access === "read").map((binding) => binding.hostPath),
    readonly: options.readonly,
    sessionRoot,
    supportMountTargets: options.supportBindings.map((binding) => binding.mountPath),
    writablePaths: options.bindings.filter((binding) => binding.access === "write").map((binding) => binding.hostPath),
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
      throw new CodeServerInvalidConfigurationError("trustedOrigins entries must be absolute origins.", { value: trimmed });
    }
    if (origin === "null") {
      throw new CodeServerInvalidConfigurationError("trustedOrigins entries must resolve to normal HTTP or HTTPS origins.", { value: trimmed });
    }
    if (!normalized.includes(origin)) normalized.push(origin);
  }

  return normalized;
}

function resolveLaunchDirectories(options: CreateCodeServerLaunchPlanOptions): {
  extensionsDir: string;
  userDataDir: string;
} {
  const dataRoot = options.dataRoot ? path.resolve(options.dataRoot) : null;
  const userDataDir = options.userDataDir ? path.resolve(options.userDataDir) : dataRoot ? path.join(dataRoot, "user-data") : null;
  const extensionsDir = options.extensionsDir ? path.resolve(options.extensionsDir) : dataRoot ? path.join(dataRoot, "extensions") : null;

  if (!userDataDir || !extensionsDir) {
    throw new CodeServerInvalidConfigurationError(
      "createCodeServerLaunchPlan requires userDataDir and extensionsDir, or a shared dataRoot.",
    );
  }

  return { extensionsDir, userDataDir };
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
  const port = options.port == null || options.port === 0 ? await allocatePort(host) : normalizePort(options.port);
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
  if (requested === "direct" || requested === "node") return requested;
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
    throw new CodeServerInvalidConfigurationError("Port must be an integer between 0 and 65535.", { value });
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
    throw new CodeServerInvalidConfigurationError("bindAddr must use host:port or [host]:port format.", { bindAddr });
  }
  return {
    host: normalized.slice(0, lastColonIndex),
    port: normalizePort(Number(normalized.slice(lastColonIndex + 1))),
  };
}

function formatBindAddr(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
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
            reject(new CodeServerPortAllocationError("Could not determine the allocated code-server TCP port.", { host }));
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
  assertDirectLaunchAvailable,
  buildCodeServerArgs,
  buildCodeServerLaunchSpec,
  buildRecommendedBindings,
  buildSandboxPlan,
  formatBindAddr,
  normalizeHost,
  normalizeLaunchMode,
  normalizeNodeCommand,
  normalizePort,
  normalizeTrustedOrigins,
  parseBindAddr,
  resolveLaunchBinding,
  resolveLaunchDirectories,
  uniqueBindings,
  uniquePaths,
};
