import fs from "node:fs";
import path from "node:path";

import { CodeServerBinaryNotFoundError, CodeServerPackageResolutionError } from "./errors.js";
import { resolveCodeServerPackageJsonPath } from "./package-resolution.js";
import { getCodeServerPreparationStatus } from "./preparation.js";
import type { CodeServerEntryKind, CodeServerInstallation, ResolveCodeServerInstallationOptions } from "./types.js";

type CodeServerPackageJson = {
  bin?: Record<string, unknown> | string;
  main?: unknown;
  version?: unknown;
};

function resolveCodeServerInstallation(
  options: ResolveCodeServerInstallationOptions = {},
): CodeServerInstallation {
  const packageJsonPath = resolveCodeServerPackageJsonPath(options.resolveFrom);
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = readCodeServerPackageJson(packageJsonPath);
  const entryRelativePath = resolveEntryRelativePath(packageJson);
  const entryPoint = path.resolve(packageRoot, entryRelativePath);

  if (!isFile(entryPoint)) {
    throw new CodeServerBinaryNotFoundError("Resolved code-server entrypoint was not found.", {
      entryPoint,
      entryRelativePath,
      packageJsonPath,
      packageRoot,
    });
  }

  const supportRoot = resolveSupportRoot(packageRoot);
  const preparationStatus = getCodeServerPreparationStatus({
    resolveFrom: options.resolveFrom,
    strictWatchdog: options.strictWatchdog,
  });

  return {
    defaultCwd: packageRoot,
    defaultEnv: {},
    entryArgs: [],
    entryCommand: detectEntryKind(entryPoint) === "node_script"
      ? process.execPath
      : entryPoint,
    entryKind: detectEntryKind(entryPoint),
    entryPoint,
    entryRelativePath,
    packageJsonPath,
    packageManagerHints: {
      installCommand: "npm install",
      packageManager: "npm",
    },
    packageRoot,
    preparationStatus,
    recommendedReadablePaths: uniquePaths([
      packageRoot,
      entryPoint,
      supportRoot,
    ]),
    supportBindings: supportRoot
      ? [{
        access: "read",
        hostPath: supportRoot,
        mountPath: supportRoot,
        reason: "code-server support root",
      }]
      : [],
    supportRoot,
    version: typeof packageJson.version === "string" ? packageJson.version : undefined,
  };
}

function readCodeServerPackageJson(packageJsonPath: string): CodeServerPackageJson {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as CodeServerPackageJson;
  } catch (error) {
    throw new CodeServerPackageResolutionError("Could not read the resolved code-server package metadata.", {
      cause: error instanceof Error ? error.message : String(error),
      packageJsonPath,
    });
  }
}

function resolveEntryRelativePath(packageJson: CodeServerPackageJson): string {
  if (typeof packageJson.bin === "string" && packageJson.bin.trim()) {
    return packageJson.bin;
  }

  if (packageJson.bin && typeof packageJson.bin === "object") {
    const binPath = packageJson.bin["code-server"];
    if (typeof binPath === "string" && binPath.trim()) {
      return binPath;
    }
  }

  if (typeof packageJson.main === "string" && packageJson.main.trim()) {
    return packageJson.main;
  }

  throw new CodeServerBinaryNotFoundError("The installed code-server package does not expose a launch entrypoint.", {});
}

function detectEntryKind(entryPoint: string): CodeServerEntryKind {
  const extension = path.extname(entryPoint).toLowerCase();
  if (extension === ".cjs" || extension === ".js" || extension === ".mjs") {
    return "node_script";
  }

  try {
    const handle = fs.openSync(entryPoint, "r");
    const buffer = Buffer.alloc(128);
    const length = fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);
    const header = buffer.toString("utf8", 0, length);
    return header.startsWith("#!") && header.includes("node")
      ? "node_script"
      : "executable";
  } catch {
    return "executable";
  }
}

function resolveSupportRoot(packageRoot: string): string | null {
  const supportRoot = path.join(packageRoot, "lib", "vscode");
  return isDirectory(supportRoot) ? supportRoot : null;
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const nextValue = path.resolve(value);
    if (!normalized.includes(nextValue)) {
      normalized.push(nextValue);
    }
  }

  return normalized;
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

export { resolveCodeServerInstallation };
