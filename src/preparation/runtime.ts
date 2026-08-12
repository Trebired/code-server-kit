import {
  collectCodeServerStartupDiagnostics,
} from "#585f3a8d1af0";
import { CodeServerPreparationError } from "#8974ac53d713";
import { getCodeServerReadinessStatus as getCachedReadinessStatus, buildReadinessStatus } from "./readiness.js";
import { repairCodeServerInstall as repairCodeServerInstallWithCache } from "./repair.js";
import { repairHints, toWatchdogIssue } from "./shared.js";
import type {
  CodeServerEnsureLaunchableOptions,
  CodeServerEnsureLaunchableResult,
  CodeServerInstallValidationResult,
  CodeServerPreparationOptions,
  CodeServerPreparationResult,
  CodeServerPreparationStatus,
  CodeServerReadinessStatus,
  CodeServerRepairOptions,
} from "#3c8d8166992a";

const readinessCache = new Map<string, CodeServerReadinessStatus>();

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

  const repaired = await repairCodeServerInstallWithCache(readinessCache, options);
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
  const watchdogIssue = toWatchdogIssue(readiness.dependencies.find((dependency) => {
        return dependency.dependency === "@vscode/native-watchdog";
  }));

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

export {
  buildReadinessStatus,
  ensureCodeServerLaunchable,
  ensureCodeServerPrepared,
  getCodeServerPreparationStatus,
  getCodeServerReadinessStatus,
  repairCodeServerInstall,
  validateCodeServerInstall,
};

function getCodeServerReadinessStatus(options: CodeServerPreparationOptions = {}): CodeServerReadinessStatus {
  return getCachedReadinessStatus(readinessCache, options);
}

async function repairCodeServerInstall(options: CodeServerRepairOptions = {}) {
  return await repairCodeServerInstallWithCache(readinessCache, options);
}
