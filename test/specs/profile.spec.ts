import { expect, test } from "bun:test";

import {
  createCodeServerProfilePolicy,
  createCodeServerProfileSyncPlan,
  persistCodeServerProfileIfChanged,
  readCodeServerProfileSignature,
  syncCodeServerProfile,
} from "#c0ucu2gxeffq";
import { exists, readFile, tempDir, writeFile } from "./helpers.js";

test("creates an allowlisted profile sync plan without copying the whole profile tree", () => {
    const plan = createCodeServerProfileSyncPlan({
      items: ["settings.json", "snippets", "extensions"],
      sourceDir: "/srv/source-profile",
      targetDir: "/srv/target-profile",
    });

    expect(plan.entries).toEqual([
      {
        item: "settings.json",
        kind: "file",
        relativePath: "User/settings.json",
        sourcePath: "/srv/source-profile/User/settings.json",
        targetPath: "/srv/target-profile/User/settings.json",
      },
      {
        item: "snippets",
        kind: "directory",
        relativePath: "User/snippets",
        sourcePath: "/srv/source-profile/User/snippets",
        targetPath: "/srv/target-profile/User/snippets",
      },
      {
        item: "extensions",
        kind: "directory",
        relativePath: "extensions",
        sourcePath: "/srv/source-profile/extensions",
        targetPath: "/srv/target-profile/extensions",
      },
    ]);
});

test("copies only the allowlisted profile items and skips missing sources cleanly", async () => {
    const sourceDir = tempDir();
    const targetDir = tempDir();

    writeFile(sourceDir, "User/settings.json", "{\n  \"editor.fontSize\": 14\n}\n");
    writeFile(sourceDir, "User/snippets/app.json", "{\n  \"prefix\": \"app\"\n}\n");
    writeFile(sourceDir, "extensions/demo-extension/package.json", "{\n  \"name\": \"demo-extension\"\n}\n");
    writeFile(sourceDir, "User/ignored.json", "{\n  \"skip\": true\n}\n");

    const result = await syncCodeServerProfile({
      items: ["settings.json", "snippets", "extensions", "keybindings.json"],
      sourceDir,
      targetDir,
    });

    expect(result.copied.map((entry) => entry.item)).toEqual([
      "settings.json",
      "snippets",
      "extensions",
    ]);
    expect(result.skipped).toEqual([
      {
        entry: {
          item: "keybindings.json",
          kind: "file",
          relativePath: "User/keybindings.json",
          sourcePath: `${sourceDir}/User/keybindings.json`,
          targetPath: `${targetDir}/User/keybindings.json`,
        },
        reason: "missing_source",
      },
    ]);

    expect(readFile(targetDir, "User/settings.json")).toContain("\"editor.fontSize\"");
    expect(readFile(targetDir, "User/snippets/app.json")).toContain("\"prefix\"");
    expect(readFile(targetDir, "extensions/demo-extension/package.json")).toContain("\"demo-extension\"");
    expect(exists(targetDir, "User/ignored.json")).toBe(false);
});

test("persists only when the allowlisted profile signature changed", async () => {
    const sourceDir = tempDir();
    const targetDir = tempDir();

    writeFile(sourceDir, "User/settings.json", "{\n  \"editor.fontSize\": 14\n}\n");
    writeFile(targetDir, "User/settings.json", "{\n  \"editor.fontSize\": 14\n}\n");

    const first = await persistCodeServerProfileIfChanged({
      items: ["settings.json"],
      sourceDir,
      targetDir,
    });

    expect(first.changed).toBe(false);

    writeFile(sourceDir, "User/settings.json", "{\n  \"editor.fontSize\": 16\n}\n");

    const second = await persistCodeServerProfileIfChanged({
      items: ["settings.json"],
      sourceDir,
      targetDir,
    });

    expect(second.changed).toBe(true);
    expect(second.previousSignature).not.toBe(second.nextSignature);
    expect(await readCodeServerProfileSignature({
      items: ["settings.json"],
      rootDir: targetDir,
    })).toBe(second.nextSignature);
});

test("owns runtime profile restore, readonly patching, and persist orchestration", async () => {
    const restoreFrom = tempDir();
    const persistTo = tempDir();
    const runtimeDir = tempDir();

    writeFile(restoreFrom, "User/settings.json", "{\n  \"editor.fontSize\": 14\n}\n");
    writeFile(restoreFrom, "User/globalStorage/demo/state.json", "{\n  \"enabled\": true\n}\n");

    const policy = createCodeServerProfilePolicy({
      debounceMs: 1,
      includeExtensionState: true,
      persistTo,
      readonly: {
        enabled: true,
        mode: "view",
      },
      restoreFrom,
      settingsPatch: {
        "workbench.colorTheme": "Quiet Light",
      },
    });

    const prepared = await policy.prepareRuntimeProfile(runtimeDir);
    const persisted = await policy.persistRuntimeProfile(runtimeDir);

    expect(prepared.restore.restored).toBe(true);
    expect(prepared.restore.settingsPatched).toBe(true);
    expect(readFile(runtimeDir, "User/settings.json")).toContain("\"workbench.colorTheme\": \"Quiet Light\"");
    expect(readFile(runtimeDir, "User/settings.json")).toContain("\"extensions.autoUpdate\": false");
    expect(exists(runtimeDir, "User/globalStorage/demo/state.json")).toBe(true);
    expect(persisted?.persisted).toBe(true);
    expect(exists(persistTo, "User/globalStorage/demo/state.json")).toBe(true);
});
