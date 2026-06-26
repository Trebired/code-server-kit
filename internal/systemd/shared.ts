import { execFile } from "node:child_process";

import {
  CodeServerInvalidConfigurationError,
} from "#8974ac53d713";
import type {
  CodeServerLaunchSpec,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
} from "#3c8d8166992a";
import { createCodeServerLaunchSpec } from "#b6bd57e100f1";

function createCodeServerSystemdLaunchCommand(options: CodeServerSystemdLaunchOptions): CodeServerSystemdLaunchCommand {
  const scope = normalizeSystemdScope(options.scope);
  const spec = createCodeServerLaunchSpec(options.plan);
  const unitName = normalizeSystemdUnitName(options.unitName ?? buildDefaultCodeServerUnitName(options.sessionKey));
  const env = {
    ...options.plan.env,
    ...(options.env ?? {}),
  };
  const cwd = options.cwd ?? options.plan.cwd;
  const args = [
    scope === "user" ? "--user" : "--system",
    "--unit",
    unitName,
    "--service-type",
    "exec",
    "--collect",
    "--same-dir",
    "--working-directory",
    cwd,
  ];

  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue;
    args.push("--setenv", `${key}=${value}`);
  }
  for (const property of buildSystemdPathProperties(spec)) args.push("--property", property);
  for (const property of options.extraProperties ?? []) args.push("--property", property);
  args.push("--");
  args.push(options.plan.command);
  args.push(...options.plan.args);

  return {
    args,
    command: "systemd-run",
    scope,
    unitName,
  };
}

function buildSystemdPathProperties(spec: CodeServerLaunchSpec): string[] {
  const properties: string[] = [];
  if (spec.readonly.enabled && spec.readonly.filesystem.mode !== "off") {
    properties.push("NoNewPrivileges=yes");
    properties.push("PrivateTmp=yes");
    properties.push("ProtectSystem=strict");
    properties.push("ReadOnlyPaths=/");
  }
  for (const binding of spec.bindings) {
    properties.push(
      `${binding.access === "write" ? "BindPaths" : "BindReadOnlyPaths"}=${formatSystemdBinding(binding.hostPath, binding.mountPath)}`,
    );
  }
  for (const value of spec.readablePaths) properties.push(`ReadOnlyPaths=${value}`);
  for (const value of spec.writablePaths) properties.push(`ReadWritePaths=${value}`);
  return uniqueStrings(properties);
}

function buildDefaultCodeServerUnitName(sessionKey?: string): string {
  const suffix = String(sessionKey ?? "session").trim() || "session";
  return normalizeSystemdUnitName(`trebired-code-server-kit-${suffix}`);
}

function normalizeSystemdUnitName(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new CodeServerInvalidConfigurationError("systemd launch requires a non-empty unit name.");
  }

  const safe = normalized.replace(/[^a-z0-9_.@:-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) {
    throw new CodeServerInvalidConfigurationError("systemd launch requires a unit name with usable characters.", { value });
  }
  return safe.endsWith(".service") ? safe : `${safe}.service`;
}

function normalizeSystemdScope(value: CodeServerSystemdScope): CodeServerSystemdScope {
  if (value === "user" || value === "system") return value;
  throw new CodeServerInvalidConfigurationError("systemd launch requires an explicit scope of 'user' or 'system'.", {
    value,
  });
}

function parseSystemdShowOutput(output: string, scope: CodeServerSystemdScope, unitName: string): CodeServerSystemdStatus {
  const raw: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("=")) continue;
    const index = line.indexOf("=");
    raw[line.slice(0, index)] = line.slice(index + 1);
  }

  const loadState = raw.LoadState || null;
  const activeState = raw.ActiveState || null;
  const subState = raw.SubState || null;
  const result = raw.Result || null;
  const execMainPid = raw.ExecMainPID && raw.ExecMainPID !== "0" ? Number(raw.ExecMainPID) : null;
  const notFound = loadState === "not-found";
  const failed = activeState === "failed" || result === "failed";
  const reusable = !notFound && (activeState === "active" || activeState === "activating");

  return {
    activeState,
    execMainPid: Number.isFinite(execMainPid) ? execMainPid : null,
    failed,
    loadState,
    notFound,
    raw,
    reusable,
    result,
    scope,
    stateLabel: notFound ? "not_found" : failed ? "failed" : reusable ? "ready" : "stale",
    subState,
    unitName,
  };
}

function formatSystemdBinding(hostPath: string, mountPath: string): string {
  return hostPath === mountPath ? hostPath : `${hostPath}:${mountPath}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function runSystemCommand(command: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(stderr.trim() || stdout.trim() || error.message);
        Object.assign(wrapped, { cause: error });
        reject(wrapped);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export {
  buildDefaultCodeServerUnitName,
  buildSystemdPathProperties,
  createCodeServerSystemdLaunchCommand,
  normalizeSystemdScope,
  normalizeSystemdUnitName,
  parseSystemdShowOutput,
  runSystemCommand,
};
