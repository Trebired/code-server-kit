import fs from "node:fs";

import { expect, test } from "bun:test";

import {
  ensureCodeServerLaunchable,
  ensureCodeServerPrepared,
  getCodeServerReadinessStatus,
  getCodeServerPreparationStatus,
  repairCodeServerInstall,
  validateCodeServerInstall,
} from "#c0ucu2gxeffq";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

test("detects a prepared code-server package", () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);

    const status = getCodeServerPreparationStatus({
      resolveFrom: root,
    });

    expect(status.packageRoot).toBe(packageRoot);
    expect(status.state).toBe("prepared");
    expect(status.launchable).toBe(true);
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

test("reports launchability with real launch-critical artifacts", () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    fs.rmSync(`${root}/node_modules/code-server/lib/vscode/out/vs/workbench/workbench.web.main.internal.js`);

    const status = getCodeServerReadinessStatus({
      resolveFrom: root,
    });
    const validation = validateCodeServerInstall({
      resolveFrom: root,
    });

    expect(status.launchable).toBe(false);
    expect(status.state).toBe("repairable");
    expect(status.missingCriticalArtifacts.some((artifact) => artifact.includes("workbench.web.main.internal.js"))).toBe(true);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostic?.phase).toBe("prepare");
});

test("detects missing nested ripgrep runtime dependencies", () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    fs.rmSync(`${root}/node_modules/code-server/lib/vscode/node_modules/@vscode/ripgrep/bin/rg`);

    const status = getCodeServerReadinessStatus({
      resolveFrom: root,
    });

    expect(status.launchable).toBe(false);
    expect(status.dependencies.some((dependency) => dependency.dependency === "@vscode/ripgrep" && dependency.present === false)).toBe(true);
});

test("repairs missing support-tree artifacts when the bootstrap script exists", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    const supportFile = `${root}/node_modules/code-server/lib/vscode/out/vs/workbench/workbench.web.main.internal.css`;
    fs.rmSync(supportFile);

    const statusBefore = getCodeServerPreparationStatus({
      resolveFrom: root,
    });
    expect(statusBefore.state).toBe("repairable");

    const result = await ensureCodeServerPrepared({
      resolveFrom: root,
    });

    expect(result.changed).toBe(true);
    expect(result.outcome).toBe("repaired");
    expect(result.status.state).toBe("prepared");
});

test("returns structured repair outcomes", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    fs.rmSync(`${root}/node_modules/code-server/lib/vscode/node_modules/@vscode/ripgrep/bin/rg`);

    const result = await repairCodeServerInstall({
      resolveFrom: root,
    });

    expect(result.outcome).toBe("repaired");
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.statusAfter.launchable).toBe(true);
});

test("ensures a code-server install is launchable after repair", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    fs.rmSync(`${root}/node_modules/code-server/lib/vscode/out/server-main.js`);

    const result = await ensureCodeServerLaunchable({
      resolveFrom: root,
    });

    expect(result.status.launchable).toBe(true);
    expect(result.repaired?.outcome).toBe("repaired");
});
