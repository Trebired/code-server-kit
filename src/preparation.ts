import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

import {
  collectCodeServerStartupDiagnostics,
  normalizeCodeServerStartupFailure,
} from "./diagnostics.js";
import { CodeServerPreparationError } from "./errors.js";
import { resolveLogger } from "./logging.js";
import { resolveCodeServerPackageJsonPath } from "./package-resolution.js";
import type {
  CodeServerDependencyCheck,
  CodeServerEnsureLaunchableOptions,
  CodeServerEnsureLaunchableResult,
  CodeServerInstallArtifactCheck,
  CodeServerInstallValidationResult,
  CodeServerPreparationIssue,
  CodeServerPreparationOptions,
  CodeServerPreparationResult,
  CodeServerPreparationStatus,
  CodeServerReadinessStatus,
  CodeServerRepairAction,
  CodeServerRepairOptions,
  CodeServerRepairResult,
  CodeServerRuntimeDependencyIssue,
} from "./types.js";

const readinessCache = new Map<string, CodeServerReadinessStatus>();

function getCodeServerReadinessStatus(options: CodeServerPreparationOptions = {}): CodeServerReadinessStatus {
  const packageJsonPath = resolveCodeServerPackageJsonPath(options.resolveFrom);
  const packageRoot = path.dirname(packageJsonPath);
  const cacheKey = `${packageRoot}:${options.strictWatchdog === true ? "strict" : "relaxed"}`;
  const cached = readinessCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const status = buildReadinessStatus(packageRoot, options.strictWatchdog ?? false);
  readinessCache.set(cacheKey, status);
  return status;
}

function validateCodeServerInstall(options: CodeServerPreparationOptions = {}): CodeServerInstallValidationResult {
  const status = getCodeServerReadinessStatus(options);
  return {
    diagnostic: status.launchable
      ? null
      : collectCodeServerStartupDiagnostics({
        category: "preparation_failed",
        error: new CodeServerPreparationError("The code-server package is not launchable.", {
          issues: status.issues,
          packageRoot: status.packageRoot,
        }),
        hints: repairHints(status),
        phase: "prepare",
        retryable: status.state === "repairable",
      }),
    ok: status.launchable,
    status,
  };
}

async function repairCodeServerInstall(options: CodeServerRepairOptions = {}): Promise<CodeServerRepairResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const statusBefore = getCodeServerReadinessStatus(options);
  const actions: CodeServerRepairAction[] = [];

  if (statusBefore.launchable) {
    return {
      actions,
      changed: false,
      diagnostic: null,
      outcome: "noop",
      statusAfter: statusBefore,
      statusBefore,
    };
  }

  log.info("prepare:repair:start", "repairing code-server install", {
    packageRoot: statusBefore.packageRoot,
    state: statusBefore.state,
  });

  if (statusBefore.postinstallScriptPath) {
    actions.push(await runRepairAction({
      command: "sh",
      args: [statusBefore.postinstallScriptPath],
      cwd: statusBefore.packageRoot,
      details: {
        kind: "bootstrap",
        scriptPath: statusBefore.postinstallScriptPath,
      },
      label: "rerun code-server bootstrap",
    }));
  }

  const ripgrepPackageJsonPath = path.join(
    statusBefore.supportRoot ?? statusBefore.packageRoot,
    "node_modules",
    "@vscode",
    "ripgrep",
    "package.json",
  );
  if (isFile(ripgrepPackageJsonPath) && statusBefore.dependencies.some((dependency) => dependency.dependency === "@vscode/ripgrep" && !dependency.present)) {
    actions.push(await runRepairAction({
      command: "npm",
      args: ["rebuild", "@vscode/ripgrep", "--foreground-scripts"],
      cwd: path.dirname(path.dirname(path.dirname(ripgrepPackageJsonPath))),
      details: {
        dependency: "@vscode/ripgrep",
        kind: "dependency-postinstall",
      },
      label: "repair nested @vscode/ripgrep runtime dependency",
    }));
  }

  invalidateReadinessCache(statusBefore.packageRoot);
  const statusAfter = getCodeServerReadinessStatus(options);
  const changed = actions.some((action) => action.changed);
  const outcome = statusAfter.launchable
    ? changed ? "repaired" : "noop"
    : changed ? "partially_repaired" : "unrecoverable";
  const diagnostic = statusAfter.launchable
    ? null
    : collectCodeServerStartupDiagnostics({
      category: "preparation_failed",
      error: new CodeServerPreparationError("The code-server package still is not launchable after repair attempts.", {
        actions,
        issues: statusAfter.issues,
        packageRoot: statusAfter.packageRoot,
      }),
      hints: repairHints(statusAfter),
      phase: "repair",
      retryable: outcome === "partially_repaired",
    });

  log.info("prepare:repair:done", "finished repairing code-server install", {
    actionCount: actions.length,
    changed,
    outcome,
    packageRoot: statusAfter.packageRoot,
    state: statusAfter.state,
  });

  return {
    actions,
    changed,
    diagnostic,
    outcome,
    statusAfter,
    statusBefore,
  };
}

async function ensureCodeServerLaunchable(
  options: CodeServerEnsureLaunchableOptions = {},
): Promise<CodeServerEnsureLaunchableResult> {
  const validation = validateCodeServerInstall(options);
  if (validation.ok) {
    return {
      diagnostic: null,
      repaired: null,
      status: validation.status,
    };
  }

  if (options.attemptRepair === false) {
    throw new CodeServerPreparationError("The code-server package is not launchable.", {
      issues: validation.status.issues,
      packageRoot: validation.status.packageRoot,
      phase: "prepare",
    });
  }

  const repaired = await repairCodeServerInstall(options);
  if (!repaired.statusAfter.launchable) {
    throw new CodeServerPreparationError("The code-server package is still not launchable after repair attempts.", {
      actions: repaired.actions,
      issues: repaired.statusAfter.issues,
      outcome: repaired.outcome,
      packageRoot: repaired.statusAfter.packageRoot,
      phase: repaired.outcome === "unrecoverable" ? "prepare" : "repair",
    });
  }

  return {
    diagnostic: repaired.diagnostic,
    repaired,
    status: repaired.statusAfter,
  };
}

function getCodeServerPreparationStatus(options: CodeServerPreparationOptions = {}): CodeServerPreparationStatus {
  const readiness = getCodeServerReadinessStatus(options);
  const watchdogIssue = toWatchdogIssue(readiness.dependencies.find((dependency) => dependency.dependency === "@vscode/native-watchdog"));

  return {
    artifacts: readiness.artifacts,
    checkedAt: readiness.checkedAt,
    issues: readiness.issues,
    launchable: readiness.launchable,
    packageRoot: readiness.packageRoot,
    postinstallScriptPath: readiness.postinstallScriptPath,
    readiness,
    state: readiness.launchable ? "prepared" : readiness.state === "repairable" ? "repairable" : "missing",
    supportRoot: readiness.supportRoot,
    watchdogIssue,
    watchdogMode: readiness.watchdogMode,
  };
}

async function ensureCodeServerPrepared(options: CodeServerPreparationOptions = {}): Promise<CodeServerPreparationResult> {
  const result = await ensureCodeServerLaunchable({
    ...options,
    attemptRepair: true,
  });

  return {
    actions: result.repaired?.actions ?? [],
    changed: result.repaired?.changed ?? false,
    command: result.repaired?.actions[0]?.command ?? null,
    output: result.repaired?.actions.map((action) => action.output).filter(Boolean).join("\n\n") || null,
    outcome: result.repaired?.outcome ?? "noop",
    status: getCodeServerPreparationStatus(options),
  };
}

function buildReadinessStatus(packageRoot: string, strictWatchdog: boolean): CodeServerReadinessStatus {
  const supportRoot = path.join(packageRoot, "lib", "vscode");
  const postinstallScriptPath = isFile(path.join(packageRoot, "postinstall.sh"))
    ? path.join(packageRoot, "postinstall.sh")
    : null;
  const entryPoint = path.join(packageRoot, "out", "node", "entry.js");
  const artifacts = buildArtifactChecks(packageRoot, supportRoot);
  const dependencies = buildDependencyChecks(supportRoot, strictWatchdog);
  const issues: CodeServerPreparationIssue[] = [];

  for (const artifact of artifacts) {
    if (!artifact.present && artifact.runtimeCritical) {
      issues.push(issue("missing_runtime_artifact", "A launch-critical code-server artifact is missing.", {
        label: artifact.label,
        path: artifact.path,
      }));
    }
  }

  for (const dependency of dependencies) {
    if (!dependency.present && (dependency.fatal || dependency.dependency === "@vscode/native-watchdog")) {
      issues.push(issue(dependency.dependency === "@vscode/native-watchdog" ? "missing_native_watchdog" : "missing_runtime_dependency", dependency.message, {
        dependency: dependency.dependency,
        ...dependency.details,
      }));
    }
  }

  const launchable = artifacts.every((artifact) => artifact.present || !artifact.runtimeCritical)
    && dependencies.every((dependency) => dependency.present || !dependency.fatal);
  const state = launchable
    ? "launchable"
    : postinstallScriptPath || dependencies.some((dependency) => dependency.dependency === "@vscode/ripgrep" && dependency.present === false)
      ? "repairable"
      : "unrecoverable";

  return {
    artifacts,
    checkedAt: new Date().toISOString(),
    dependencies,
    entryPoint: isFile(entryPoint) ? entryPoint : null,
    issues,
    launchable,
    missingCriticalArtifacts: artifacts
      .filter((artifact) => !artifact.present && artifact.runtimeCritical)
      .map((artifact) => artifact.path),
    packageRoot,
    postinstallScriptPath,
    state,
    supportRoot: isDirectory(supportRoot) ? supportRoot : null,
    watchdogMode: dependencies.some((dependency) => dependency.dependency === "@vscode/native-watchdog" && !dependency.present)
      ? "disabled_fallback"
      : "native",
  };
}

function buildArtifactChecks(packageRoot: string, supportRoot: string): CodeServerInstallArtifactCheck[] {
  return [
    artifact("file", "code-server package manifest", path.join(packageRoot, "package.json"), true),
    artifact("file", "code-server node entrypoint", path.join(packageRoot, "out", "node", "entry.js"), true),
    artifact("file", "code-server node runtime main", path.join(packageRoot, "out", "node", "main.js"), true),
    artifact("directory", "embedded vscode support root", supportRoot, true),
    artifact("file", "embedded vscode manifest", path.join(supportRoot, "package.json"), true),
    artifact("file", "embedded vscode product manifest", path.join(supportRoot, "product.json"), true),
    artifact("file", "embedded vscode server main", path.join(supportRoot, "out", "server-main.js"), true),
    artifact("file", "embedded workbench script", path.join(supportRoot, "out", "vs", "workbench", "workbench.web.main.internal.js"), true),
    artifact("file", "embedded workbench stylesheet", path.join(supportRoot, "out", "vs", "workbench", "workbench.web.main.internal.css"), true),
    artifact("directory", "embedded vscode extensions", path.join(supportRoot, "extensions"), true),
  ];
}

function buildDependencyChecks(supportRoot: string, strictWatchdog: boolean): CodeServerDependencyCheck[] {
  const hasNestedNodeModules = isDirectory(path.join(supportRoot, "node_modules"));
  const ripgrepPath = path.join(supportRoot, "node_modules", "@vscode", "ripgrep", "bin", "rg");
  const nativeWatchdogPath = path.join(supportRoot, "node_modules", "@vscode", "native-watchdog", "package.json");

  return [
    hasNestedNodeModules
      ? {
        dependency: "@vscode/ripgrep",
        details: {
          path: ripgrepPath,
        },
        fatal: true,
        kind: "required",
        message: "The nested @vscode/ripgrep runtime dependency is missing.",
        present: isFile(ripgrepPath),
      }
      : {
        dependency: "@vscode/ripgrep",
        details: {
          reason: "layout_not_detected",
        },
        fatal: false,
        kind: "required",
        message: "The current code-server package layout does not expose nested @vscode/ripgrep artifacts for direct validation.",
        present: true,
      },
    {
      dependency: "@vscode/native-watchdog",
      details: {
        path: nativeWatchdogPath,
        strictWatchdog,
      },
      fatal: strictWatchdog,
      kind: "optional",
      message: strictWatchdog
        ? "The optional native watchdog dependency is missing and strict watchdog mode is enabled."
        : "The optional native watchdog dependency is missing. The package will use a disabled watchdog fallback.",
      present: isFile(nativeWatchdogPath),
    },
  ];
}

function artifact(
  kind: CodeServerInstallArtifactCheck["kind"],
  label: string,
  targetPath: string,
  runtimeCritical: boolean,
): CodeServerInstallArtifactCheck {
  return {
    kind,
    label,
    path: targetPath,
    present: kind === "directory" ? isDirectory(targetPath) : isFile(targetPath),
    runtimeCritical,
  };
}

function issue(code: string, message: string, details: Record<string, unknown>): CodeServerPreparationIssue {
  return {
    code,
    details,
    message,
  };
}

function toWatchdogIssue(dependency?: CodeServerDependencyCheck): CodeServerRuntimeDependencyIssue | null {
  if (!dependency || dependency.dependency !== "@vscode/native-watchdog" || dependency.present) {
    return null;
  }

  return {
    code: "missing_native_watchdog",
    dependency: "@vscode/native-watchdog",
    details: dependency.details,
    fatal: dependency.fatal,
    message: dependency.message,
  };
}

function repairHints(status: CodeServerReadinessStatus): string[] {
  const hints = new Set<string>();
  if (status.postinstallScriptPath) {
    hints.add("Rerun the package bootstrap flow before launching the next session.");
  }
  if (status.missingCriticalArtifacts.some((artifactPath) => artifactPath.includes("workbench.web.main"))) {
    hints.add("Reinstall code-server if embedded workbench assets are missing.");
  }
  if (status.dependencies.some((dependency) => dependency.dependency === "@vscode/ripgrep" && !dependency.present)) {
    hints.add("Repair the nested @vscode/ripgrep dependency or reinstall the package tree.");
  }
  if (hints.size === 0) {
    hints.add("Reinstall the code-server package and re-run validation.");
  }
  return [...hints];
}

async function runRepairAction(options: {
  args: string[];
  command: string;
  cwd: string;
  details: Record<string, unknown>;
  label: string;
}): Promise<CodeServerRepairAction> {
  try {
    const output = await runCommand(options.command, options.args, options.cwd);
    return {
      changed: true,
      command: [options.command, ...options.args].join(" "),
      details: options.details,
      label: options.label,
      output,
      succeeded: true,
    };
  } catch (error) {
    const normalized = normalizeCodeServerStartupFailure(error, {
      phase: "repair",
      retryable: true,
    });
    return {
      changed: false,
      command: [options.command, ...options.args].join(" "),
      details: {
        ...options.details,
        error: normalized.summary,
      },
      label: options.label,
      output: normalized.stderrTail ?? normalized.stdoutTail ?? normalized.summary,
      succeeded: false,
    };
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_user_agent: process.env.npm_config_user_agent ?? "npm/10 node/v22 linux x64",
        npm_config_unsafe_perm: process.env.npm_config_unsafe_perm ?? "true",
      },
    }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new CodeServerPreparationError("Could not run the requested code-server repair action.", {
          args,
          cause: error.message,
          command,
          cwd,
          output,
        }));
        return;
      }

      resolve(output);
    });
  });
}

function invalidateReadinessCache(packageRoot: string): void {
  for (const key of readinessCache.keys()) {
    if (key.startsWith(`${packageRoot}:`)) {
      readinessCache.delete(key);
    }
  }
}

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function isFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

export {
  ensureCodeServerLaunchable,
  ensureCodeServerPrepared,
  getCodeServerPreparationStatus,
  getCodeServerReadinessStatus,
  repairCodeServerInstall,
  validateCodeServerInstall,
};
