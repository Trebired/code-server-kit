import path from "node:path";
import { execFile } from "node:child_process";

import {
  collectCodeServerStartupDiagnostics,
  normalizeCodeServerStartupFailure,
} from "#585f3a8d1af0";
import { CodeServerPreparationError } from "#8974ac53d713";
import { resolveLogger } from "#5a29135e56c1";
import {
  invalidateReadinessCache,
  isFile,
  repairHints,
} from "./shared.js";
import { getCodeServerReadinessStatus } from "./readiness.js";
import type {
  CodeServerPreparationOptions,
  CodeServerReadinessStatus,
  CodeServerRepairAction,
  CodeServerRepairOptions,
  CodeServerRepairResult,
} from "#3c8d8166992a";

async function repairCodeServerInstall(
  readinessCache: Map<string, CodeServerReadinessStatus>,
  options: CodeServerRepairOptions = {},
): Promise<CodeServerRepairResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const statusBefore = getCodeServerReadinessStatus(readinessCache, options);
  const actions = await collectRepairActions(statusBefore);

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
  invalidateReadinessCache(statusBefore.packageRoot, readinessCache);
  const statusAfter = getCodeServerReadinessStatus(readinessCache, options);
  const changed = actions.some((action) => action.changed);
  const outcome = resolveRepairOutcome(statusBefore, statusAfter, changed);
  const diagnostic = createRepairDiagnostic(statusAfter, actions, outcome);

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

async function collectRepairActions(statusBefore: CodeServerReadinessStatus): Promise<CodeServerRepairAction[]> {
  const actions: CodeServerRepairAction[] = [];
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
  if (shouldRepairRipgrep(statusBefore, ripgrepPackageJsonPath)) {
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
  return actions;
}

function shouldRepairRipgrep(statusBefore: CodeServerReadinessStatus, ripgrepPackageJsonPath: string): boolean {
  return isFile(ripgrepPackageJsonPath)
    && statusBefore.dependencies.some((dependency) => {
      return dependency.dependency === "@vscode/ripgrep" && !dependency.present;
    });
}

function resolveRepairOutcome(
  statusBefore: CodeServerReadinessStatus,
  statusAfter: CodeServerReadinessStatus,
  changed: boolean,
): CodeServerRepairResult["outcome"] {
  if (statusAfter.launchable) return changed ? "repaired" : "noop";
  return changed ? "partially_repaired" : "unrecoverable";
}

function createRepairDiagnostic(
  statusAfter: CodeServerReadinessStatus,
  actions: CodeServerRepairAction[],
  outcome: CodeServerRepairResult["outcome"],
) {
  if (statusAfter.launchable) return null;
  return collectCodeServerStartupDiagnostics({
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

export { repairCodeServerInstall };
