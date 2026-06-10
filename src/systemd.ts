import { execFile } from "node:child_process";

import {
  CodeServerInvalidConfigurationError,
  CodeServerSystemdJournalError,
  CodeServerSystemdLaunchError,
  CodeServerSystemdStatusError,
} from "./errors.js";
import { resolveLogger } from "./logging.js";
import { createCodeServerLaunchSpec } from "./spec.js";
import type {
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerPathBinding,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
} from "./types.js";

const DEFAULT_SYSTEMD_JOURNAL_LINES = 100;

async function launchCodeServerWithSystemd(options: CodeServerSystemdLaunchOptions): Promise<CodeServerSystemdLaunchResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const command = createCodeServerSystemdLaunchCommand(options);
  log.info("systemd", "launching code-server transient unit", {
    command: command.command,
    scope: command.scope,
    unitName: command.unitName,
  });

  try {
    const output = await runSystemCommand(command.command, command.args);
    return {
      ...command,
      output,
    };
  } catch (error) {
    throw new CodeServerSystemdLaunchError("Could not launch code-server with systemd-run.", {
      args: command.args,
      cause: error instanceof Error ? error.message : String(error),
      command: command.command,
      scope: command.scope,
      unitName: command.unitName,
    });
  }
}

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

  for (const property of buildSystemdPathProperties(spec)) {
    args.push("--property", property);
  }

  for (const property of options.extraProperties ?? []) {
    args.push("--property", property);
  }

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

async function stopCodeServerSystemdUnit(options: CodeServerSystemdStopOptions): Promise<void> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scopeFlag = options.scope === "user" ? "--user" : "--system";
  log.info("systemd", "stopping code-server transient unit", {
    resetFailed: options.resetFailed ?? false,
    scope: options.scope,
    unitName: options.unitName,
  });

  try {
    await runSystemCommand("systemctl", [scopeFlag, "stop", options.unitName]);
    if (options.resetFailed) {
      await runSystemCommand("systemctl", [scopeFlag, "reset-failed", options.unitName]);
    }
  } catch (error) {
    throw new CodeServerSystemdStatusError("Could not stop the code-server systemd unit.", {
      cause: error instanceof Error ? error.message : String(error),
      scope: options.scope,
      unitName: options.unitName,
    });
  }
}

async function readCodeServerSystemdStatus(options: {
  logger?: CodeServerSystemdLaunchOptions["logger"];
  loggerAdapter?: CodeServerSystemdLaunchOptions["loggerAdapter"];
  scope: CodeServerSystemdScope;
  unitName: string;
}): Promise<CodeServerSystemdStatus> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scope = normalizeSystemdScope(options.scope);
  const unitName = normalizeSystemdUnitName(options.unitName);
  const scopeFlag = scope === "user" ? "--user" : "--system";

  log.info("systemd", "reading code-server systemd status", {
    scope,
    unitName,
  });

  try {
    const output = await runSystemCommand("systemctl", [
      scopeFlag,
      "show",
      unitName,
      "--no-pager",
      "--property",
      "LoadState",
      "--property",
      "ActiveState",
      "--property",
      "SubState",
      "--property",
      "Result",
      "--property",
      "ExecMainPID",
    ]);

    return parseSystemdShowOutput(output, scope, unitName);
  } catch (error) {
    throw new CodeServerSystemdStatusError("Could not read the code-server systemd unit status.", {
      cause: error instanceof Error ? error.message : String(error),
      scope,
      unitName,
    });
  }
}

async function readCodeServerSystemdJournal(options: CodeServerSystemdJournalOptions): Promise<string> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const scope = normalizeSystemdScope(options.scope);
  const unitName = normalizeSystemdUnitName(options.unitName);
  const lines = options.lines ?? DEFAULT_SYSTEMD_JOURNAL_LINES;

  log.info("systemd", "reading code-server systemd journal", {
    lines,
    scope,
    unitName,
  });

  try {
    return await runSystemCommand("journalctl", [
      scope === "user" ? "--user-unit" : "--unit",
      unitName,
      "--no-pager",
      "--output",
      "short",
      "-n",
      String(lines),
    ]);
  } catch (error) {
    throw new CodeServerSystemdJournalError("Could not read the code-server systemd journal.", {
      cause: error instanceof Error ? error.message : String(error),
      lines,
      scope,
      unitName,
    });
  }
}

function buildSystemdPathProperties(spec: CodeServerLaunchSpec): string[] {
  const properties: string[] = [];

  for (const binding of spec.bindings) {
    properties.push(
      `${binding.access === "write" ? "BindPaths" : "BindReadOnlyPaths"}=${formatSystemdBinding(binding)}`,
    );
  }

  for (const value of spec.readablePaths) {
    properties.push(`ReadOnlyPaths=${value}`);
  }

  for (const value of spec.writablePaths) {
    properties.push(`ReadWritePaths=${value}`);
  }

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

  const safe = normalized
    .replace(/[^a-z0-9_.@:-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!safe) {
    throw new CodeServerInvalidConfigurationError("systemd launch requires a unit name with usable characters.", {
      value,
    });
  }

  return safe.endsWith(".service") ? safe : `${safe}.service`;
}

function normalizeSystemdScope(value: CodeServerSystemdScope): CodeServerSystemdScope {
  if (value === "user" || value === "system") {
    return value;
  }

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
  const execMainPid = raw.ExecMainPID && raw.ExecMainPID !== "0"
    ? Number(raw.ExecMainPID)
    : null;
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
    subState,
    unitName,
  };
}

function formatSystemdBinding(binding: CodeServerPathBinding): string {
  return binding.hostPath === binding.mountPath
    ? binding.hostPath
    : `${binding.hostPath}:${binding.mountPath}`;
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
  launchCodeServerWithSystemd,
  normalizeSystemdUnitName,
  parseSystemdShowOutput,
  readCodeServerSystemdJournal,
  readCodeServerSystemdStatus,
  stopCodeServerSystemdUnit,
};
