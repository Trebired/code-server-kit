import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";

import { CodeServerPreparationError } from "./errors.js";
import { resolveLogger } from "./logging.js";
import type {
  CodeServerPreparationIssue,
  CodeServerPreparationOptions,
  CodeServerPreparationResult,
  CodeServerPreparationStatus,
  CodeServerRuntimeDependencyIssue,
  CodeServerWatchdogMode,
} from "./types.js";

const preparationCache = new Map<string, CodeServerPreparationStatus>();

function getCodeServerPreparationStatus(options: CodeServerPreparationOptions = {}): CodeServerPreparationStatus {
  const packageJsonPath = resolveCodeServerPackageJsonPath(options.resolveFrom);
  const packageRoot = path.dirname(packageJsonPath);
  const cached = preparationCache.get(packageRoot);
  if (cached) {
    return cached;
  }

  const status = buildPreparationStatus(packageRoot, options.strictWatchdog ?? false);
  preparationCache.set(packageRoot, status);
  return status;
}

async function ensureCodeServerPrepared(options: CodeServerPreparationOptions = {}): Promise<CodeServerPreparationResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const packageJsonPath = resolveCodeServerPackageJsonPath(options.resolveFrom);
  const packageRoot = path.dirname(packageJsonPath);
  let status = buildPreparationStatus(packageRoot, options.strictWatchdog ?? false);
  preparationCache.set(packageRoot, status);

  if (status.state === "prepared") {
    return {
      changed: false,
      command: null,
      output: null,
      status,
    };
  }

  const scriptPath = status.postinstallScriptPath;
  if (!scriptPath) {
    throw new CodeServerPreparationError("Could not prepare code-server because no package bootstrap script was found.", {
      issues: status.issues,
      packageRoot,
    });
  }

  log.info("preparation", "ensuring code-server package is prepared", {
    packageRoot,
    scriptPath,
  });

  const output = await runBootstrapScript(packageRoot, scriptPath);
  status = buildPreparationStatus(packageRoot, options.strictWatchdog ?? false);
  preparationCache.set(packageRoot, status);

  if (status.state !== "prepared") {
    throw new CodeServerPreparationError("The code-server package bootstrap step completed but the package still looks incomplete.", {
      issues: status.issues,
      output,
      packageRoot,
      scriptPath,
    });
  }

  return {
    changed: true,
    command: `sh ${scriptPath}`,
    output,
    status,
  };
}

function buildPreparationStatus(packageRoot: string, strictWatchdog: boolean): CodeServerPreparationStatus {
  const supportRoot = path.join(packageRoot, "lib", "vscode");
  const postinstallScriptPath = isFile(path.join(packageRoot, "postinstall.sh"))
    ? path.join(packageRoot, "postinstall.sh")
    : null;
  const issues: CodeServerPreparationIssue[] = [];

  if (!isDirectory(supportRoot)) {
    issues.push(issue("missing_support_root", "The embedded VS Code support root is missing.", {
      supportRoot,
    }));
  }

  const requiredPaths = [
    path.join(packageRoot, "package.json"),
    path.join(packageRoot, "out", "node", "entry.js"),
    path.join(supportRoot, "package.json"),
    path.join(supportRoot, "extensions", "package.json"),
    path.join(supportRoot, "out", "server-main.js"),
  ];

  for (const requiredPath of requiredPaths) {
    if (!isFile(requiredPath)) {
      issues.push(issue("missing_runtime_artifact", "A required code-server runtime artifact is missing.", {
        path: requiredPath,
      }));
    }
  }

  const watchdogIssue = resolveWatchdogIssue(supportRoot, strictWatchdog);
  if (watchdogIssue) {
    issues.push(watchdogIssue);
  }

  const state = issues.some((value) => value.code !== "missing_native_watchdog")
    ? postinstallScriptPath
      ? "repairable"
      : "missing"
    : "prepared";

  const status = {
    checkedAt: new Date().toISOString(),
    issues,
    packageRoot,
    postinstallScriptPath,
    state,
    supportRoot: isDirectory(supportRoot) ? supportRoot : null,
    watchdogIssue,
    watchdogMode: watchdogIssue ? "disabled_fallback" : "native",
  } satisfies CodeServerPreparationStatus;

  return status;
}

function resolveWatchdogIssue(supportRoot: string, strictWatchdog: boolean): CodeServerRuntimeDependencyIssue | null {
  const watchdogRoot = path.join(supportRoot, "node_modules", "@vscode", "native-watchdog");
  if (isDirectory(watchdogRoot) || isFile(path.join(watchdogRoot, "package.json"))) {
    return null;
  }

  return {
    code: "missing_native_watchdog",
    dependency: "@vscode/native-watchdog",
    details: {
      path: watchdogRoot,
      strictWatchdog,
    },
    fatal: strictWatchdog,
    message: strictWatchdog
      ? "The optional native watchdog dependency is missing and strict watchdog mode is enabled."
      : "The optional native watchdog dependency is missing. The package will use a disabled watchdog fallback.",
  };
}

function issue(code: string, message: string, details: Record<string, unknown>): CodeServerPreparationIssue {
  return {
    code,
    details,
    message,
  };
}

function resolveCodeServerPackageJsonPath(resolveFrom?: string): string {
  const anchorPath = createResolutionAnchor(resolveFrom);
  const requireFrom = createRequire(anchorPath);
  return requireFrom.resolve("code-server/package.json");
}

function createResolutionAnchor(resolveFrom?: string): string {
  const resolved = path.resolve(resolveFrom ?? process.cwd());

  try {
    const stats = fs.statSync(resolved);
    return stats.isDirectory()
      ? path.join(resolved, "__code_server_kit__.js")
      : resolved;
  } catch {
    return path.extname(resolved)
      ? resolved
      : path.join(resolved, "__code_server_kit__.js");
  }
}

async function runBootstrapScript(packageRoot: string, scriptPath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile("sh", [scriptPath], {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_user_agent: process.env.npm_config_user_agent ?? "npm/10 node/v22 linux x64",
        npm_config_unsafe_perm: process.env.npm_config_unsafe_perm ?? "true",
      },
    }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new CodeServerPreparationError("Could not run the code-server package bootstrap script.", {
          cause: error.message,
          output,
          packageRoot,
          scriptPath,
        }));
        return;
      }

      resolve(output);
    });
  });
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
  ensureCodeServerPrepared,
  getCodeServerPreparationStatus,
};
