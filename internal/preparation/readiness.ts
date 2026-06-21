import path from "node:path";

import {
  buildArtifactChecks,
  buildDependencyChecks,
  isDirectory,
  isFile,
  issue,
} from "./shared.js";
import type { CodeServerPreparationOptions, CodeServerReadinessStatus } from "#3c8d8166992a";
import { resolveCodeServerPackageJsonPath } from "#cd9b970a8e3b";

function getCodeServerReadinessStatus(
  readinessCache: Map<string, CodeServerReadinessStatus>,
  options: CodeServerPreparationOptions = {},
): CodeServerReadinessStatus {
  const packageJsonPath = resolveCodeServerPackageJsonPath(options.resolveFrom);
  const packageRoot = path.dirname(packageJsonPath);
  const cacheKey = `${packageRoot}:${options.strictWatchdog === true ? "strict" : "relaxed"}`;
  const cached = readinessCache.get(cacheKey);
  if (cached) return cached;

  const status = buildReadinessStatus(packageRoot, options.strictWatchdog ?? false);
  readinessCache.set(cacheKey, status);
  return status;
}

function buildReadinessStatus(packageRoot: string, strictWatchdog: boolean): CodeServerReadinessStatus {
  const supportRoot = path.join(packageRoot, "lib", "vscode");
  const postinstallScriptPath = isFile(path.join(packageRoot, "postinstall.sh")) ? path.join(packageRoot, "postinstall.sh") : null;
  const entryPoint = path.join(packageRoot, "out", "node", "entry.js");
  const artifacts = buildArtifactChecks(packageRoot, supportRoot);
  const dependencies = buildDependencyChecks(supportRoot, strictWatchdog);
  const issues = [
    ...collectArtifactIssues(artifacts),
    ...collectDependencyIssues(dependencies),
  ];
  const launchable = artifacts.every((artifact) => artifact.present || !artifact.runtimeCritical)
    && dependencies.every((dependency) => dependency.present || !dependency.fatal);
  const state = resolveReadinessState(launchable, postinstallScriptPath, dependencies);

  return {
    artifacts,
    checkedAt: new Date().toISOString(),
    dependencies,
    entryPoint: isFile(entryPoint) ? entryPoint : null,
    issues,
    launchable,
    missingCriticalArtifacts: artifacts.filter((artifact) => !artifact.present && artifact.runtimeCritical).map((artifact) => artifact.path),
    packageRoot,
    postinstallScriptPath,
    state,
    supportRoot: isDirectory(supportRoot) ? supportRoot : null,
    watchdogMode: dependencies.some((dependency) => dependency.dependency === "@vscode/native-watchdog" && !dependency.present)
      ? "disabled_fallback"
      : "native",
  };
}

function collectArtifactIssues(artifacts: CodeServerReadinessStatus["artifacts"]) {
  return artifacts.flatMap((artifact) => {
    if (artifact.present || !artifact.runtimeCritical) return [];
    return [issue("missing_runtime_artifact", "A launch-critical code-server artifact is missing.", {
      label: artifact.label,
      path: artifact.path,
    })];
  });
}

function collectDependencyIssues(dependencies: CodeServerReadinessStatus["dependencies"]) {
  return dependencies.flatMap((dependency) => {
    if (dependency.present || (!dependency.fatal && dependency.dependency !== "@vscode/native-watchdog")) return [];
    return [issue(
      dependency.dependency === "@vscode/native-watchdog" ? "missing_native_watchdog" : "missing_runtime_dependency",
      dependency.message,
      { dependency: dependency.dependency, ...dependency.details },
    )];
  });
}

function resolveReadinessState(
  launchable: boolean,
  postinstallScriptPath: string | null,
  dependencies: CodeServerReadinessStatus["dependencies"],
): CodeServerReadinessStatus["state"] {
  if (launchable) return "launchable";
  if (postinstallScriptPath || dependencies.some((dependency) => dependency.dependency === "@vscode/ripgrep" && dependency.present === false)) {
    return "repairable";
  }
  return "unrecoverable";
}

export {
  buildReadinessStatus,
  getCodeServerReadinessStatus,
};
