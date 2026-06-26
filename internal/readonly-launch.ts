import fs from "node:fs";
import path from "node:path";

import { CodeServerInvalidConfigurationError } from "./errors.js";
import { readonlyPolicyBlocksWritableSessionPromotions } from "./readonly.js";
import type {
  CodeServerLaunchPlan,
  CodeServerReadonlyEnforcement,
  CodeServerReadonlyFilesystemEnforcement,
  CodeServerReadonlyPolicy,
} from "./types.js";

function createReadonlyEnforcement(options: {
  env: NodeJS.ProcessEnv;
  readonly: CodeServerReadonlyPolicy;
  writablePaths: string[];
}): CodeServerReadonlyEnforcement {
  if (!options.readonly.enabled) {
    return {
      browser: {
        blocksCommandLinks: false,
        blocksDragAndDrop: false,
        blocksPaste: false,
        blocksUpload: false,
        blocksWritableSessionPromotions: false,
        defaultActionSource: "unknown",
      },
      directFilesystem: disabledReadonlyFilesystemEnforcement("none", options.readonly.filesystem.mode, options.writablePaths),
      systemdFilesystem: disabledReadonlyFilesystemEnforcement("systemd", options.readonly.filesystem.mode, options.writablePaths),
    };
  }

  const directCommand = findCommandOnPath("bwrap", options.env);
  const directFilesystem = options.readonly.filesystem.mode === "off"
    ? disabledReadonlyFilesystemEnforcement("none", options.readonly.filesystem.mode, options.writablePaths)
    : directCommand
      ? {
        available: true,
        boundary: "bubblewrap" as const,
        command: directCommand,
        hardReadonly: true,
        required: options.readonly.filesystem.mode === "require",
        summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
        warnings: [],
        writablePaths: [...options.writablePaths],
      }
      : {
        available: false,
        boundary: "none" as const,
        command: null,
        hardReadonly: false,
        required: options.readonly.filesystem.mode === "require",
        summary: "Direct launches are limited to browser and command guards because bubblewrap is unavailable.",
        warnings: ["bubblewrap (bwrap) was not found on PATH for readonly direct launches."],
        writablePaths: [...options.writablePaths],
      };

  const systemdFilesystem = options.readonly.filesystem.mode === "off"
    ? disabledReadonlyFilesystemEnforcement("systemd", options.readonly.filesystem.mode, options.writablePaths)
    : {
      available: true,
      boundary: "systemd" as const,
      command: "systemd-run",
      hardReadonly: true,
      required: options.readonly.filesystem.mode === "require",
      summary: "systemd launches can enforce a readonly write barrier with transient unit filesystem protections.",
      warnings: [],
      writablePaths: [...options.writablePaths],
    };

  return {
    browser: {
      blocksCommandLinks: options.readonly.browserGuards.blockCommandLinks,
      blocksDragAndDrop: options.readonly.browserGuards.blockDragAndDrop,
      blocksPaste: options.readonly.browserGuards.blockPaste,
      blocksUpload: options.readonly.browserGuards.blockUpload,
      blocksWritableSessionPromotions: readonlyPolicyBlocksWritableSessionPromotions(options.readonly),
      defaultActionSource: "unknown",
    },
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

  const runtimeCommand = findCommandOnPath("bwrap", env);
  const enforcement = plan.readonlyEnforcement.directFilesystem.available && plan.readonlyEnforcement.directFilesystem.command
    ? plan.readonlyEnforcement.directFilesystem
    : runtimeCommand
      ? {
        ...plan.readonlyEnforcement.directFilesystem,
        available: true,
        boundary: "bubblewrap" as const,
        command: runtimeCommand,
        hardReadonly: true,
        summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
        warnings: [],
      }
      : plan.readonlyEnforcement.directFilesystem;
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
  if (usesHostTempDir(plan, enforcement.writablePaths)) {
    args.push("--bind", "/tmp", "/tmp");
  } else {
    args.push("--tmpfs", "/tmp");
  }

  for (const writablePath of enforcement.writablePaths) {
    args.push("--bind", writablePath, writablePath);
  }

  args.push("--chdir", plan.cwd);
  args.push("--");
  args.push(plan.command, ...plan.args);

  return {
    args,
    command: enforcement.command,
  };
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

function uniquePaths(values: Array<string | null | undefined>): string[] {
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
