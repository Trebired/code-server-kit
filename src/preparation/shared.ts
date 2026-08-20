import path from "node:path";

import {
  isDirectory,
  isFile,
} from "#wb3eftm3t8ku";
import type {
  CodeServerDependencyCheck,
  CodeServerInstallArtifactCheck,
  CodeServerPreparationIssue,
  CodeServerReadinessStatus,
  CodeServerRuntimeDependencyIssue,
} from "#3c8d8166992a";

type RipgrepPackageCandidate = {
  binaryPath: string;
  packageJsonPath: string;
  packageName: string;
};

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
  const ripgrep = resolveRipgrepRuntime(supportRoot);
  const nativeWatchdogPath = path.join(supportRoot, "node_modules", "@vscode", "native-watchdog", "package.json");

  return [
    hasNestedNodeModules
    ? {
      dependency: ripgrep.packageName,
      details: {
        candidatePaths: ripgrep.candidates.map((candidate) => candidate.binaryPath),
        path: ripgrep.binaryPath,
      },
      fatal: true,
      kind: "required",
      message: "The nested ripgrep runtime dependency is missing.",
      present: ripgrep.present,
    }
    : {
      dependency: "@vscode/ripgrep",
      details: { reason: "layout_not_detected" },
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

function resolveRipgrepRuntime(supportRoot: string): {
  binaryPath: string;
  candidates: RipgrepPackageCandidate[];
  packageName: string;
  present: boolean;
} {
  const candidates = ripgrepPackageCandidates(supportRoot);
  const presentCandidate = candidates.find((candidate) => isFile(candidate.binaryPath));
  const primaryCandidate = presentCandidate ?? candidates[0];
  return {
    binaryPath: primaryCandidate.binaryPath,
    candidates,
    packageName: primaryCandidate.packageName,
    present: Boolean(presentCandidate),
  };
}

function ripgrepPackageCandidates(supportRoot: string): RipgrepPackageCandidate[] {
  const legacyRoot = path.join(supportRoot, "node_modules", "@vscode", "ripgrep");
  const universalRoot = path.join(supportRoot, "node_modules", "@vscode", "ripgrep-universal");
  const universalPlatform = ripgrepUniversalPlatformFolder();
  const ripgrepBinary = process.platform === "win32" ? "rg.exe" : "rg";
  return [
    {
      binaryPath: path.join(legacyRoot, "bin", ripgrepBinary),
      packageJsonPath: path.join(legacyRoot, "package.json"),
      packageName: "@vscode/ripgrep",
    },
    {
      binaryPath: path.join(universalRoot, "bin", universalPlatform, ripgrepBinary),
      packageJsonPath: path.join(universalRoot, "package.json"),
      packageName: "@vscode/ripgrep-universal",
    },
  ];
}

function ripgrepUniversalPlatformFolder(): string {
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "win32") return `win32-${process.arch}`;
  return `linux-${process.arch}`;
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
  return { code, details, message };
}

function toWatchdogIssue(dependency?: CodeServerDependencyCheck): CodeServerRuntimeDependencyIssue | null {
  if (!dependency || dependency.dependency !== "@vscode/native-watchdog" || dependency.present) return null;
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
  if (status.postinstallScriptPath) hints.add("Rerun the package bootstrap flow before launching the next session.");
  if (status.missingCriticalArtifacts.some((artifactPath) => artifactPath.includes("workbench.web.main"))) {
    hints.add("Reinstall code-server if embedded workbench assets are missing.");
  }
  if (status.dependencies.some((dependency) => dependency.dependency.startsWith("@vscode/ripgrep") && !dependency.present)) {
    hints.add("Repair the nested ripgrep dependency or reinstall the package tree.");
  }
  if (hints.size === 0) hints.add("Reinstall the code-server package and re-run validation.");
  return [...hints];
}

function invalidateReadinessCache(packageRoot: string, readinessCache: Map<string, CodeServerReadinessStatus>): void {
  for (const key of readinessCache.keys()) {
    if (key.startsWith(`${packageRoot}:`)) readinessCache.delete(key);
  }
}

export {
  buildArtifactChecks,
  buildDependencyChecks,
  invalidateReadinessCache,
  isDirectory,
  isFile,
  issue,
  ripgrepPackageCandidates,
  repairHints,
  toWatchdogIssue,
};
