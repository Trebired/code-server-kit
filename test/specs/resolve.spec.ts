import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  CodeServerBinaryNotFoundError,
  CodeServerPackageResolutionError,
  resolveCodeServerInstallation,
} from "../../src/index.js";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

describe("@trebired/code-server-kit resolve", () => {
  test("resolves the bundled code-server dependency by default", () => {
    const installation = resolveCodeServerInstallation();

    expect(installation.packageRoot.endsWith(`${path.sep}node_modules${path.sep}code-server`)).toBe(true);
    expect(installation.entryPoint.startsWith(installation.packageRoot)).toBe(true);
  });

  test("resolves the installed package root, entrypoint, support root, and entry relative path", () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);

    const installation = resolveCodeServerInstallation({
      resolveFrom: root,
    });

    expect(installation).toMatchObject({
      entryKind: "node_script",
      entryPoint: path.join(packageRoot, "out/node/entry.js"),
      entryRelativePath: "out/node/entry.js",
      packageJsonPath: path.join(packageRoot, "package.json"),
      packageRoot,
      supportRoot: path.join(packageRoot, "lib/vscode"),
      version: "4.117.0",
    });
  });

  test("falls back to main when the code-server bin entry is missing", () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root, {
      bin: {},
      entryRelativePath: "dist/code-server-launch.js",
      main: "dist/code-server-launch.js",
    });

    const installation = resolveCodeServerInstallation({
      resolveFrom: root,
    });

    expect(installation.entryPoint).toBe(path.join(packageRoot, "dist/code-server-launch.js"));
    expect(installation.entryRelativePath).toBe("dist/code-server-launch.js");
  });

  test("fails clearly when the package cannot be resolved", () => {
    const root = tempDir();

    expect(() => resolveCodeServerInstallation({
      resolveFrom: root,
    })).toThrow(CodeServerPackageResolutionError);
  });

  test("fails clearly when the resolved entrypoint does not exist", () => {
    const root = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: null,
    });

    expect(() => resolveCodeServerInstallation({
      resolveFrom: root,
    })).toThrow(CodeServerBinaryNotFoundError);
  });
});
