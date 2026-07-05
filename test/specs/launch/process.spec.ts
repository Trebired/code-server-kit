import path from "node:path";

import { expect, test } from "bun:test";

import type { CodeServerLaunchPlan } from "#c0ucu2gxeffq";
import { launchCodeServerProcess } from "#c0ucu2gxeffq";
import { readFile, tempDir, writeFile } from "#bfmndbpzi7qu";

test("launches a child process with stdout and stderr capture hooks", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const handle = await launchCodeServerProcess({
    plan: createProcessTestPlan({
      env: {
        TB_CHILD: "1",
      },
    }),
    stderr(text) {
      stderr.push(text);
    },
    stdout(text) {
      stdout.push(text);
    },
  });

  const exit = await handle.exit;

  expect(exit.code).toBe(0);
  expect(stdout.join("")).toContain("ready");
  expect(stderr.join("")).toContain("warn");
  expect(handle.getStdout()).toContain("ready");
  expect(handle.getStderr()).toContain("warn");
  expect(handle.plan.env.TB_CHILD).toBe("1");
});

test("wraps readonly direct launches with bubblewrap when available", async () => {
  const fakeBin = tempDir();
  const argsLogRoot = tempDir();
  createFakeBubblewrap(fakeBin);
  const argsLog = path.join(argsLogRoot, "bwrap-args.txt");
  const handle = await launchCodeServerProcess({
    env: {
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      TB_BWRAP_ARGS_LOG: argsLog,
    },
    plan: createProcessTestPlan({
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        TB_CHILD: "1",
      },
      readonly: {
        enabled: true,
        mode: "view",
      },
      readonlyEnforcement: createBubblewrapReadonlyEnforcement(fakeBin),
    }),
  });

  const exit = await handle.exit;
  const args = readFile(argsLogRoot, "bwrap-args.txt");

  expect(exit.code).toBe(0);
  expect(args).toContain("--ro-bind");
  expect(args).toContain("/tmp");
  expect(args).toContain("/tmp/fake/user-data");
  expect(args).toContain(process.execPath);
  expect(handle.getStdout()).toContain("ready");
});

function createProcessTestPlan(options?: {
  env?: Record<string, string>;
  readonly?: {
    enabled: boolean;
    mode: "off" | "view";
  };
  readonlyEnforcement?: CodeServerLaunchPlan["readonlyEnforcement"];
}): CodeServerLaunchPlan {
  const readonlyEnabled = options?.readonly?.enabled ?? false;
  return {
    args: createProcessArgs(),
    bindAddr: "127.0.0.1:1",
    bindings: [],
    browser: createBrowserConfig(),
    codeServerPackageRoot: "/tmp/fake",
    command: process.execPath,
    cwd: process.cwd(),
    entryKind: "node_script" as const,
    entryPoint: process.execPath,
    env: { ...(options?.env ?? {}) },
    extensionsDir: "/tmp/fake/extensions",
    host: "127.0.0.1",
    installation: createFakeInstallation(),
    launchMode: "node" as const,
    port: 1,
    preparationStatus: createPreparedStatus(),
    readinessStatus: null as any,
    readonly: createReadonlyConfig(options?.readonly),
    readonlyEnforcement: options?.readonlyEnforcement ?? createReadonlyEnforcementConfig(),
    recommendedReadablePaths: ["/tmp/fake"],
    recommendedWritablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
    sandbox: createSandboxConfig(options?.readonly),
    supportBindings: [],
    supportRoot: null,
    translatedPaths: [],
    trustedOrigins: [],
    userDataDir: "/tmp/fake/user-data",
    watchdogMode: "native" as const,
    workspacePath: null,
  };
}

function createFakeInstallation() {
  return {
    defaultCwd: "/tmp/fake",
    defaultEnv: {},
    entryArgs: [],
    entryCommand: process.execPath,
    entryKind: "node_script" as const,
    entryPoint: process.execPath,
    entryRelativePath: process.execPath,
    packageJsonPath: "/tmp/fake/package.json",
    packageManagerHints: {
      installCommand: "npm install",
      packageManager: "npm" as const,
    },
    packageRoot: "/tmp/fake",
    preparationStatus: createPreparedStatus(),
    readinessStatus: null as any,
    recommendedReadablePaths: ["/tmp/fake"],
    supportBindings: [],
    supportRoot: null,
    version: "4.117.0",
  };
}

function createPreparedStatus() {
  return {
    artifacts: [],
    checkedAt: "",
    issues: [],
    launchable: true,
    packageRoot: "/tmp/fake",
    postinstallScriptPath: null,
    readiness: null as any,
    state: "prepared" as const,
    supportRoot: null,
    watchdogIssue: null,
    watchdogMode: "native" as const,
  };
}

function createProcessArgs(): string[] {
  return [
    "-e",
    'process.stdout.write("ready\\n"); process.stderr.write("warn\\n");',
  ];
}

function createBrowserConfig(): CodeServerLaunchPlan["browser"] {
  return {
    policy: {
      bootstrapTimeoutMs: 20_000,
      target: "workbench" as const,
      workbenchSelectors: [".monaco-workbench", ".workbench"],
    },
  };
}

function createReadonlyConfig(readonly?: { enabled: boolean; mode: "off" | "view" }): CodeServerLaunchPlan["readonly"] {
  const enabled = readonly?.enabled ?? false;
  return {
    browserGuards: {
      blockBeforeInput: false,
      blockCommandLinks: enabled,
      blockDragAndDrop: false,
      blockPaste: false,
      blockUpload: false,
      blockedCommandLinkSchemes: enabled ? ["command"] : [],
      blockedSelectors: [],
      blockedUiLabels: [],
      readonlyMessage: "This is a readonly session.",
      showBanner: false,
    },
    blockedCommandIds: [],
    blockedCommandPrefixes: [],
    blockedCommandSubstrings: [],
    blockedShortcuts: [],
    enabled,
    filesystem: {
      allowHostTempDir: false,
      extraWritablePaths: [],
      mode: enabled ? "auto" : "off",
    },
    mode: readonly?.mode ?? "off",
    settingsPatch: {},
  };
}

function createReadonlyEnforcementConfig(): CodeServerLaunchPlan["readonlyEnforcement"] {
  return {
    browser: {
      blocksCommandLinks: false,
      blocksDragAndDrop: false,
      blocksPaste: false,
      blocksUpload: false,
      blocksWritableSessionPromotions: false,
      defaultActionSource: "unknown" as const,
    },
    directFilesystem: {
      available: false,
      boundary: "none" as const,
      command: null,
      hardReadonly: false,
      required: false,
      summary: "Readonly filesystem enforcement is disabled.",
      warnings: [],
      writablePaths: [],
    },
    systemdFilesystem: {
      available: false,
      boundary: "systemd" as const,
      command: null,
      hardReadonly: false,
      required: false,
      summary: "Readonly filesystem enforcement is disabled.",
      warnings: [],
      writablePaths: [],
    },
  };
}

function createSandboxConfig(readonly?: { enabled: boolean; mode: "off" | "view" }): CodeServerLaunchPlan["sandbox"] {
  return {
    bindings: [],
    collisionSafeName: null,
    ephemeralStateRoot: null,
    readablePaths: [],
    readonly: createReadonlyConfig(readonly),
    sessionRoot: null,
    supportMountTargets: [],
    writablePaths: [],
  };
}

function createBubblewrapReadonlyEnforcement(fakeBin: string): CodeServerLaunchPlan["readonlyEnforcement"] {
  return {
    ...createReadonlyEnforcementConfig(),
    browser: {
      ...createReadonlyEnforcementConfig().browser,
      blocksCommandLinks: true,
    },
    directFilesystem: {
      available: true,
      boundary: "bubblewrap" as const,
      command: path.join(fakeBin, "bwrap"),
      hardReadonly: true,
      required: false,
      summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
      warnings: [],
      writablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
    },
    systemdFilesystem: {
      available: true,
      boundary: "systemd" as const,
      command: "systemd-run",
      hardReadonly: true,
      required: false,
      summary: "systemd launches can enforce a readonly write barrier with transient unit filesystem protections.",
      warnings: [],
      writablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
    },
  };
}

function createFakeBubblewrap(fakeBin: string): void {
  writeFile(
    fakeBin,
    "bwrap",
    [
      "#!/usr/bin/env bash",
      "set -eu",
      "printf '%s\\n' \"$@\" > \"$TB_BWRAP_ARGS_LOG\"",
      "while [ \"$1\" != \"--\" ]; do shift; done",
      "shift",
      "exec \"$@\"",
      "",
    ].join("\n"),
    0o755,
  );
}
