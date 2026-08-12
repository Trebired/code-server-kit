import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { CodeServerPackageResolutionError } from "#8974ac53d713";
import { PACKAGE_NAME } from "#ztxam4p5ur4e";

function resolveCodeServerPackageJsonPath(resolveFrom?: string): string {
  if (!resolveFrom) {
    try {
      return createRequire(import.meta.url).resolve("code-server/package.json");
    } catch (error) {
      throw new CodeServerPackageResolutionError("Could not resolve the bundled code-server package dependency.", {
          cause: error instanceof Error ? error.message : String(error),
          resolveFrom: PACKAGE_NAME,
      });
    }
  }

  const anchorPath = createResolutionAnchor(resolveFrom);
  const requireFrom = createRequire(anchorPath);

  try {
    return requireFrom.resolve("code-server/package.json");
  } catch (error) {
    throw new CodeServerPackageResolutionError("Could not resolve the installed code-server package.", {
        cause: error instanceof Error ? error.message : String(error),
        resolveFrom: path.resolve(resolveFrom),
    });
  }
}

function createResolutionAnchor(resolveFrom: string): string {
  const resolved = path.resolve(resolveFrom);

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

export { resolveCodeServerPackageJsonPath };
