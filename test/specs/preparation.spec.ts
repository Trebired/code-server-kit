import fs from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  ensureCodeServerPrepared,
  getCodeServerPreparationStatus,
} from "../../src/index.js";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

describe("@trebired/code-server-kit preparation", () => {
  test("detects a prepared code-server package", () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);

    const status = getCodeServerPreparationStatus({
      resolveFrom: root,
    });

    expect(status.packageRoot).toBe(packageRoot);
    expect(status.state).toBe("prepared");
    expect(status.watchdogMode).toBe("native");
  });

  test("falls back cleanly when the optional native watchdog is missing", () => {
    const root = tempDir();
    createFakeCodeServerPackage(root, {
      includeWatchdog: false,
    });

    const status = getCodeServerPreparationStatus({
      resolveFrom: root,
    });
    expect(status.watchdogMode).toBe("disabled_fallback");
    expect(status.issues.some((issue) => issue.code === "missing_native_watchdog")).toBe(true);
  });

  test("repairs missing support-tree artifacts when the bootstrap script exists", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    const supportFile = `${root}/node_modules/code-server/lib/vscode/extensions/package.json`;
    fs.rmSync(supportFile);

    const statusBefore = getCodeServerPreparationStatus({
      resolveFrom: root,
    });
    expect(statusBefore.state).toBe("repairable");

    const result = await ensureCodeServerPrepared({
      resolveFrom: root,
    });

    expect(result.changed).toBe(true);
    expect(result.status.state).toBe("prepared");
  });
});
