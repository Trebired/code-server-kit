import fs from "node:fs";
import path from "node:path";

import { CodeServerInvalidConfigurationError } from "#8974ac53d713";
import { readonlyPolicyBlocksWritableSessionPromotions } from "#3nojkzzzf31b";
import type {
  CodeServerLaunchPlan,
  CodeServerReadonlyEnforcement,
  CodeServerReadonlyFilesystemEnforcement,
  CodeServerReadonlyPolicy,
} from "#3c8d8166992a";

function createReadonlyEnforcement(options: {
    env: NodeJS.ProcessEnv;
    readonly: CodeServerReadonlyPolicy;
    writablePaths: string[];
}): CodeServerReadonlyEnforcement {
  if (!options.readonly.enabled) {
    return {
      browser: createReadonlyBrowserEnforcement(options.readonly),
      directFilesystem: disabledReadonlyFilesystemEnforcement("none", options.readonly.filesystem.mode, options.writablePaths),
      systemdFilesystem: disabledReadonlyFilesystemEnforcement("systemd", options.readonly.filesystem.mode, options.writablePaths),
    };
  }

  const directFilesystem = createDirectReadonlyFilesystemEnforcement(options);
  const systemdFilesystem = createSystemdReadonlyFilesystemEnforcement(
    options.readonly.filesystem.mode,
    options.writablePaths,
  );

  return {
    browser: createReadonlyBrowserEnforcement(options.readonly),
    directFilesystem,
    systemdFilesystem,
  };
}

function buildDirectReadonlyLaunch(plan: CodeServerLaunchPlan, env: NodeJS.ProcessEnv): {
  args: string[];
  command: string;
} {
  if (!plan.readonly.enabled || plan.readonly.filesystem.mode === "off") {
    return {
      args: [...plan.args],
      command: plan.command,
    };
  }

  const enforcement = resolveBubblewrapEnforcement(plan, env);
  if (!enforcement.available || enforcement.boundary !== "bubblewrap" || !enforcement.command) {
    if (plan.readonly.filesystem.mode === "require") {
      throw new CodeServerInvalidConfigurationError(
        "Readonly direct launches require bubblewrap, but no bubblewrap command was available on PATH.",
        {
          launchMode: plan.launchMode,
          workspacePath: plan.workspacePath,
        },
      );
    }
    return {
      args: [...plan.args],
      command: plan.command,
    };
  }

  ensureReadonlyWritablePaths(enforcement.writablePaths);

  return {
    args: createBubblewrapLaunchArgs(plan, enforcement.writablePaths),
    command: enforcement.command,
  };
}

function createReadonlyBrowserEnforcement(readonly: CodeServerReadonlyPolicy) {
  return {
    blocksCommandLinks: readonly.browserGuards.blockCommandLinks,
    blocksDragAndDrop: readonly.browserGuards.blockDragAndDrop,
    blocksPaste: readonly.browserGuards.blockPaste,
    blocksUpload: readonly.browserGuards.blockUpload,
    blocksWritableSessionPromotions: readonlyPolicyBlocksWritableSessionPromotions(readonly),
    defaultActionSource: "unknown"as const,
  };
}

function createDirectReadonlyFilesystemEnforcement(options: {
    env: NodeJS.ProcessEnv;
    readonly: CodeServerReadonlyPolicy;
    writablePaths: string[];
}): CodeServerReadonlyFilesystemEnforcement {
  if (options.readonly.filesystem.mode === "off") {
    return disabledReadonlyFilesystemEnforcement("none", options.readonly.filesystem.mode, options.writablePaths);
  }

  const directCommand = findCommandOnPath("bwrap", options.env);
  if (!directCommand) {
    return {
      available: false,
      boundary: "none",
      command: null,
      hardReadonly: false,
      required: options.readonly.filesystem.mode === "require",
      summary: "Direct launches are limited to browser and command guards because bubblewrap is unavailable.",
      warnings: ["bubblewrap (bwrap) was not found on PATH for readonly direct launches."],
      writablePaths: [...options.writablePaths],
    };
  }

  return {
    available: true,
    boundary: "bubblewrap",
    command: directCommand,
    hardReadonly: true,
    required: options.readonly.filesystem.mode === "require",
    summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
    warnings: [],
    writablePaths: [...options.writablePaths],
  };
}

function createSystemdReadonlyFilesystemEnforcement(
  mode: CodeServerReadonlyPolicy["filesystem"]["mode"],
  writablePaths: string[],
): CodeServerReadonlyFilesystemEnforcement {
  if (mode === "off") {
    return disabledReadonlyFilesystemEnforcement("systemd", mode, writablePaths);
  }

  return {
    available: true,
    boundary: "systemd",
    command: "systemd-run",
    hardReadonly: true,
    required: mode === "require",
    summary: "systemd launches can enforce a readonly write barrier with transient unit filesystem protections.",
    warnings: [],
    writablePaths: [...writablePaths],
  };
}

function resolveBubblewrapEnforcement(
  plan: CodeServerLaunchPlan,
  env: NodeJS.ProcessEnv,
): CodeServerReadonlyEnforcement["directFilesystem"] {
  if (plan.readonlyEnforcement.directFilesystem.available && plan.readonlyEnforcement.directFilesystem.command) {
    return plan.readonlyEnforcement.directFilesystem;
  }

  const runtimeCommand = findCommandOnPath("bwrap", env);
  if (!runtimeCommand) {
    return plan.readonlyEnforcement.directFilesystem;
  }

  return {
    ...plan.readonlyEnforcement.directFilesystem,
    available: true,
    boundary: "bubblewrap",
    command: runtimeCommand,
    hardReadonly: true,
    summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
    warnings: [],
  };
}

function createBubblewrapLaunchArgs(plan: CodeServerLaunchPlan, writablePaths: string[]): string[] {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--proc",
    "/proc",
    "--dev-bind",
    "/dev",
    "/dev",
    "--ro-bind",
    "/",
    "/",
  ];

  if (usesHostTempDir(plan, writablePaths)) {
    args.push("--bind", "/tmp", "/tmp");
  } else {
    args.push("--tmpfs", "/tmp");
  }

  for (const writablePath of writablePaths) {
    args.push("--bind", writablePath, writablePath);
  }

  args.push("--chdir", plan.cwd, "--", plan.command, ...plan.args);
  return args;
}

function disabledReadonlyFilesystemEnforcement(
  boundary: CodeServerReadonlyFilesystemEnforcement["boundary"],
  mode: CodeServerReadonlyPolicy["filesystem"]["mode"],
  writablePaths: string[],
): CodeServerReadonlyFilesystemEnforcement {
  return {
    available: false,
    boundary,
    command: null,
    hardReadonly: false,
    required: mode === "require",
    summary: "Readonly filesystem enforcement is disabled.",
    warnings: [],
    writablePaths: [...writablePaths],
  };
}

function resolveReadonlyWritablePaths(options: {
    readonly: CodeServerReadonlyPolicy;
    writablePaths: string[];
}): string[] {
  return uniquePaths([
      ...options.writablePaths,
      ...options.readonly.filesystem.extraWritablePaths,
  ]);
}

function ensureReadonlyWritablePaths(paths: string[]): void {
  for (const current of paths) {
    if (current === "/tmp") continue;
    if (fs.existsSync(current)) continue;
    fs.mkdirSync(current, { recursive: true });
  }
}

function usesHostTempDir(plan: CodeServerLaunchPlan, writablePaths: string[]): boolean {
  if (plan.readonly.filesystem.allowHostTempDir) {
    return true;
  }

  return [
    plan.codeServerPackageRoot,
    plan.cwd,
    plan.extensionsDir,
    plan.supportRoot,
    plan.userDataDir,
    plan.workspacePath,
    ...writablePaths,
  ].some((value) => typeof value === "string" && value === "/tmp" || typeof value === "string" && value.startsWith("/tmp/"));
}

function findCommandOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  if (path.isAbsolute(command)) {
    return isExecutable(command) ? command : null;
  }

  const searchPath = env.PATH ?? process.env.PATH ?? "";
  for (const entry of searchPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isExecutable(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(values: Array<string|null|undefined>): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const nextValue = path.resolve(value);
    if (!normalized.includes(nextValue)) normalized.push(nextValue);
  }
  return normalized;
}

export {
  buildDirectReadonlyLaunch,
  createReadonlyEnforcement,
  resolveReadonlyWritablePaths,
};
