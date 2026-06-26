import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createCodeServerLaunch,
  createCodeServerLaunchPlan,
  createCodeServerLaunchSpec,
  formatCodeServerCommand,
  launchCodeServerProcess,
  resolveCodeServerInstallation,
} from "#c0ucu2gxeffq";
import { createFakeCodeServerPackage, readFile, tempDir, writeFile } from "./helpers.js";

describe("@trebired/code-server-kit launch", () => {
  test("builds a richer node launch plan that host apps can feed into their own execution layer", async () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);
    const installation = resolveCodeServerInstallation({
      resolveFrom: root,
    });

    const plan = await createCodeServerLaunchPlan({
      cwd: "/srv/runtime",
      env: {
        TB_MODE: "test",
      },
      extensionsDir: "/tmp/code-server/extensions",
      installation,
      launchMode: "node",
      trustedOrigins: [
        "https://app.example.com",
        "https://app.example.com/",
        "https://admin.example.com",
      ],
      userDataDir: "/tmp/code-server/user-data",
      workspacePath: "/srv/workspaces/demo",
    });

    expect(plan).toMatchObject({
      args: [
        path.join(packageRoot, "out/node/entry.js"),
        "--auth",
        "none",
        "--bind-addr",
        `127.0.0.1:${plan.port}`,
        "--disable-telemetry",
        "--disable-update-check",
        "--disable-workspace-trust",
        "--disable-getting-started-override",
        "--user-data-dir",
        "/tmp/code-server/user-data",
        "--extensions-dir",
        "/tmp/code-server/extensions",
        "--trusted-origins",
        "https://app.example.com",
        "--trusted-origins",
        "https://admin.example.com",
        "/srv/workspaces/demo",
      ],
      bindAddr: `127.0.0.1:${plan.port}`,
      bindings: [
        {
          access: "read",
          hostPath: packageRoot,
          mountPath: packageRoot,
          reason: "code-server package root",
        },
        {
          access: "read",
          hostPath: path.join(packageRoot, "lib/vscode"),
          mountPath: path.join(packageRoot, "lib/vscode"),
          reason: "code-server support root",
        },
        {
          access: "write",
          hostPath: "/srv/workspaces/demo",
          mountPath: "/srv/workspaces/demo",
          reason: "workspace mount",
        },
        {
          access: "write",
          hostPath: "/tmp/code-server/user-data",
          mountPath: "/tmp/code-server/user-data",
          reason: "code-server user data",
        },
        {
          access: "write",
          hostPath: "/tmp/code-server/extensions",
          mountPath: "/tmp/code-server/extensions",
          reason: "code-server extensions",
        },
      ],
      codeServerPackageRoot: packageRoot,
      command: process.execPath,
      cwd: "/srv/runtime",
      entryKind: "node_script",
      entryPoint: path.join(packageRoot, "out/node/entry.js"),
      env: {
        TB_MODE: "test",
      },
      extensionsDir: "/tmp/code-server/extensions",
      host: "127.0.0.1",
      installation,
      launchMode: "node",
      recommendedReadablePaths: [
        packageRoot,
        path.join(packageRoot, "out/node/entry.js"),
        path.join(packageRoot, "lib/vscode"),
        "/srv/workspaces/demo",
      ],
      recommendedWritablePaths: [
        "/tmp/code-server/user-data",
        "/tmp/code-server/extensions",
      ],
      supportRoot: path.join(packageRoot, "lib/vscode"),
      trustedOrigins: [
        "https://app.example.com",
        "https://admin.example.com",
      ],
      userDataDir: "/tmp/code-server/user-data",
      workspacePath: "/srv/workspaces/demo",
    });
    expect(plan.preparationStatus.state).toBe("prepared");
    expect(plan.readinessStatus.launchable).toBe(true);
    expect(plan.readonly.mode).toBe("off");
    expect(plan.bindings).toHaveLength(5);
  });

  test("derives support bindings and writable path suggestions in the launch spec", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);

    const plan = await createCodeServerLaunch({
      dataRoot: "/tmp/code-server/session-42",
      host: "127.0.0.1",
      port: 8123,
      resolveFrom: root,
    });
    const spec = createCodeServerLaunchSpec(plan);

    expect(plan.bindings).toEqual(spec.bindings);
    expect(spec.readablePaths).toContain(plan.installation.packageRoot);
    expect(spec.writablePaths).toEqual([
      "/tmp/code-server/session-42/user-data",
      "/tmp/code-server/session-42/extensions",
    ]);
    expect(spec.bindings).toContainEqual({
      access: "read",
      hostPath: plan.installation.packageRoot,
      mountPath: plan.installation.packageRoot,
      reason: "code-server package root",
    });
    expect(spec.bindings).toContainEqual({
      access: "write",
      hostPath: "/tmp/code-server/session-42/user-data",
      mountPath: "/tmp/code-server/session-42/user-data",
      reason: "code-server user data",
    });
    expect(plan.sandbox.ephemeralStateRoot).toBe("/tmp/code-server/session-42");
  });

  test("plans readonly workspace mounts and sandbox metadata", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);

    const plan = await createCodeServerLaunchPlan({
      dataRoot: "/tmp/code-server/readonly-session",
      env: {
        PATH: "",
      },
      readonly: true,
      resolveFrom: root,
      stateRoot: "/tmp/code-server-state",
      workspacePath: "/srv/workspaces/demo",
    });

    expect(plan.readonly.enabled).toBe(true);
    expect(plan.bindings).toContainEqual({
      access: "read",
      hostPath: "/srv/workspaces/demo",
      mountPath: "/srv/workspaces/demo",
      reason: "readonly workspace mount",
    });
    expect(plan.sandbox.readonly.enabled).toBe(true);
    expect(plan.sandbox.supportMountTargets).toContain(path.join(plan.installation.packageRoot, "lib/vscode"));
    expect(plan.readonlyEnforcement.directFilesystem.available).toBe(false);
    expect(plan.readonlyEnforcement.systemdFilesystem.hardReadonly).toBe(true);
  });

  test("detects bubblewrap for harder local readonly enforcement", async () => {
    const root = tempDir();
    const fakeBin = tempDir();
    createFakeCodeServerPackage(root);
    writeFile(fakeBin, "bwrap", "#!/usr/bin/env sh\nexit 0\n", 0o755);

    const plan = await createCodeServerLaunchPlan({
      dataRoot: "/tmp/code-server/readonly-direct",
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      },
      readonly: true,
      resolveFrom: root,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(plan.readonlyEnforcement.directFilesystem.available).toBe(true);
    expect(plan.readonlyEnforcement.directFilesystem.boundary).toBe("bubblewrap");
    expect(plan.readonlyEnforcement.directFilesystem.command).toContain("bwrap");
  });

  test("can prefer direct launch mode when the resolved entrypoint is executable", async () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root, {
      entryContents: "#!/usr/bin/env bash\nexit 0\n",
      entryRelativePath: "bin/code-server",
      entryMode: 0o755,
    });
    const installation = resolveCodeServerInstallation({
      resolveFrom: root,
    });

    const plan = await createCodeServerLaunchPlan({
      bindAddr: "127.0.0.1:8124",
      dataRoot: "/tmp/code-server/direct",
      installation,
      launchMode: "direct",
    });

    expect(plan.command).toBe(path.join(packageRoot, "bin/code-server"));
    expect(plan.args[0]).toBe("--auth");
    expect(plan.launchMode).toBe("direct");
  });

  test("formats command output safely for logs, shells, or systemd debugging", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);

    const plan = await createCodeServerLaunchPlan({
      bindAddr: "127.0.0.1:8125",
      dataRoot: "/tmp/code-server/quoted values",
      resolveFrom: root,
      workspacePath: "/srv/workspaces/demo app",
    });

    const text = formatCodeServerCommand(plan);

    expect(text).toContain(plan.command);
    expect(text).toContain("'/tmp/code-server/quoted values/user-data'");
    expect(text).toContain("'/srv/workspaces/demo app'");
  });

  test("launches a child process with stdout and stderr capture hooks", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const handle = await launchCodeServerProcess({
      plan: {
        args: [
          "-e",
          'process.stdout.write("ready\\n"); process.stderr.write("warn\\n");',
        ],
        bindAddr: "127.0.0.1:1",
        bindings: [],
        codeServerPackageRoot: "/tmp/fake",
        command: process.execPath,
        cwd: process.cwd(),
        entryKind: "node_script",
        entryPoint: process.execPath,
        env: {
          TB_CHILD: "1",
        },
        extensionsDir: "/tmp/fake/extensions",
        host: "127.0.0.1",
        installation: {
          defaultCwd: "/tmp/fake",
          defaultEnv: {},
          entryArgs: [],
          entryCommand: process.execPath,
          entryKind: "node_script",
          entryPoint: process.execPath,
          entryRelativePath: process.execPath,
          packageJsonPath: "/tmp/fake/package.json",
          packageManagerHints: {
            installCommand: "npm install",
            packageManager: "npm",
          },
          packageRoot: "/tmp/fake",
          preparationStatus: {
            artifacts: [],
            checkedAt: "",
            issues: [],
            launchable: true,
            packageRoot: "/tmp/fake",
            postinstallScriptPath: null,
            readiness: null as any,
            state: "prepared",
            supportRoot: null,
            watchdogIssue: null,
            watchdogMode: "native",
          },
          readinessStatus: null as any,
          recommendedReadablePaths: ["/tmp/fake"],
          supportBindings: [],
          supportRoot: null,
          version: "4.117.0",
        },
        launchMode: "node",
        port: 1,
        preparationStatus: {
          artifacts: [],
          checkedAt: "",
          issues: [],
          launchable: true,
          packageRoot: "/tmp/fake",
          postinstallScriptPath: null,
          readiness: null as any,
          state: "prepared",
          supportRoot: null,
          watchdogIssue: null,
          watchdogMode: "native",
        },
        readinessStatus: null as any,
        readonly: {
          browserGuards: {
            blockBeforeInput: false,
            blockCommandLinks: false,
            blockDragAndDrop: false,
            blockPaste: false,
            blockUpload: false,
            blockedCommandLinkSchemes: [],
            blockedSelectors: [],
            blockedUiLabels: [],
            readonlyMessage: "This is a readonly session.",
            showBanner: false,
          },
          blockedCommandIds: [],
          blockedCommandPrefixes: [],
          blockedCommandSubstrings: [],
          blockedShortcuts: [],
          enabled: false,
          filesystem: {
            allowHostTempDir: false,
            extraWritablePaths: [],
            mode: "off",
          },
          mode: "off",
          settingsPatch: {},
        },
        readonlyEnforcement: {
          browser: {
            blocksCommandLinks: false,
            blocksDragAndDrop: false,
            blocksPaste: false,
            blocksUpload: false,
            blocksWritableSessionPromotions: false,
            defaultActionSource: "unknown",
          },
          directFilesystem: {
            available: false,
            boundary: "none",
            command: null,
            hardReadonly: false,
            required: false,
            summary: "Readonly filesystem enforcement is disabled.",
            warnings: [],
            writablePaths: [],
          },
          systemdFilesystem: {
            available: false,
            boundary: "systemd",
            command: null,
            hardReadonly: false,
            required: false,
            summary: "Readonly filesystem enforcement is disabled.",
            warnings: [],
            writablePaths: [],
          },
        },
        recommendedReadablePaths: ["/tmp/fake"],
        recommendedWritablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
        browser: {
          policy: {
            bootstrapTimeoutMs: 20_000,
            target: "workbench",
            workbenchSelectors: [".monaco-workbench", ".workbench"],
          },
        },
        sandbox: {
          bindings: [],
          collisionSafeName: null,
          ephemeralStateRoot: null,
          readablePaths: [],
          readonly: {
            browserGuards: {
              blockBeforeInput: false,
              blockCommandLinks: false,
              blockDragAndDrop: false,
              blockPaste: false,
              blockUpload: false,
              blockedCommandLinkSchemes: [],
              blockedSelectors: [],
              blockedUiLabels: [],
              readonlyMessage: "This is a readonly session.",
              showBanner: false,
            },
            blockedCommandIds: [],
            blockedCommandPrefixes: [],
            blockedCommandSubstrings: [],
            blockedShortcuts: [],
            enabled: false,
            filesystem: {
              allowHostTempDir: false,
              extraWritablePaths: [],
              mode: "off",
            },
            mode: "off",
            settingsPatch: {},
          },
          sessionRoot: null,
          supportMountTargets: [],
          writablePaths: [],
        },
        supportBindings: [],
        supportRoot: null,
        translatedPaths: [],
        trustedOrigins: [],
        userDataDir: "/tmp/fake/user-data",
        watchdogMode: "native",
        workspacePath: null,
      },
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
    const root = tempDir();
    const fakeBin = tempDir();
    const argsLogRoot = tempDir();
    createFakeCodeServerPackage(root);
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

    const argsLog = path.join(argsLogRoot, "bwrap-args.txt");
    const handle = await launchCodeServerProcess({
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        TB_BWRAP_ARGS_LOG: argsLog,
      },
      plan: {
        args: [
          "-e",
          'process.stdout.write("ready\\n"); process.stderr.write("warn\\n");',
        ],
        bindAddr: "127.0.0.1:1",
        bindings: [],
        browser: {
          policy: {
            bootstrapTimeoutMs: 20_000,
            target: "workbench",
            workbenchSelectors: [".monaco-workbench", ".workbench"],
          },
        },
        codeServerPackageRoot: "/tmp/fake",
        command: process.execPath,
        cwd: process.cwd(),
        entryKind: "node_script",
        entryPoint: process.execPath,
        env: {
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          TB_CHILD: "1",
        },
        extensionsDir: "/tmp/fake/extensions",
        host: "127.0.0.1",
        installation: {
          defaultCwd: "/tmp/fake",
          defaultEnv: {},
          entryArgs: [],
          entryCommand: process.execPath,
          entryKind: "node_script",
          entryPoint: process.execPath,
          entryRelativePath: process.execPath,
          packageJsonPath: "/tmp/fake/package.json",
          packageManagerHints: {
            installCommand: "npm install",
            packageManager: "npm",
          },
          packageRoot: "/tmp/fake",
          preparationStatus: {
            artifacts: [],
            checkedAt: "",
            issues: [],
            launchable: true,
            packageRoot: "/tmp/fake",
            postinstallScriptPath: null,
            readiness: null as any,
            state: "prepared",
            supportRoot: null,
            watchdogIssue: null,
            watchdogMode: "native",
          },
          readinessStatus: null as any,
          recommendedReadablePaths: ["/tmp/fake"],
          supportBindings: [],
          supportRoot: null,
          version: "4.117.0",
        },
        launchMode: "node",
        port: 1,
        preparationStatus: {
          artifacts: [],
          checkedAt: "",
          issues: [],
          launchable: true,
          packageRoot: "/tmp/fake",
          postinstallScriptPath: null,
          readiness: null as any,
          state: "prepared",
          supportRoot: null,
          watchdogIssue: null,
          watchdogMode: "native",
        },
        readinessStatus: null as any,
        readonly: {
          browserGuards: {
            blockBeforeInput: false,
            blockCommandLinks: true,
            blockDragAndDrop: false,
            blockPaste: false,
            blockUpload: false,
            blockedCommandLinkSchemes: ["command"],
            blockedSelectors: [],
            blockedUiLabels: [],
            readonlyMessage: "This is a readonly session.",
            showBanner: false,
          },
          blockedCommandIds: [],
          blockedCommandPrefixes: [],
          blockedCommandSubstrings: [],
          blockedShortcuts: [],
          enabled: true,
          filesystem: {
            allowHostTempDir: false,
            extraWritablePaths: [],
            mode: "auto",
          },
          mode: "view",
          settingsPatch: {},
        },
        readonlyEnforcement: {
          browser: {
            blocksCommandLinks: true,
            blocksDragAndDrop: false,
            blocksPaste: false,
            blocksUpload: false,
            blocksWritableSessionPromotions: false,
            defaultActionSource: "unknown",
          },
          directFilesystem: {
            available: true,
            boundary: "bubblewrap",
            command: path.join(fakeBin, "bwrap"),
            hardReadonly: true,
            required: false,
            summary: "Direct launches can enforce a readonly write barrier with bubblewrap.",
            warnings: [],
            writablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
          },
          systemdFilesystem: {
            available: true,
            boundary: "systemd",
            command: "systemd-run",
            hardReadonly: true,
            required: false,
            summary: "systemd launches can enforce a readonly write barrier with transient unit filesystem protections.",
            warnings: [],
            writablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
          },
        },
        recommendedReadablePaths: ["/tmp/fake"],
        recommendedWritablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
        sandbox: {
          bindings: [],
          collisionSafeName: null,
          ephemeralStateRoot: null,
          readablePaths: [],
          readonly: {
            browserGuards: {
              blockBeforeInput: false,
              blockCommandLinks: true,
              blockDragAndDrop: false,
              blockPaste: false,
              blockUpload: false,
              blockedCommandLinkSchemes: ["command"],
              blockedSelectors: [],
              blockedUiLabels: [],
              readonlyMessage: "This is a readonly session.",
              showBanner: false,
            },
            blockedCommandIds: [],
            blockedCommandPrefixes: [],
            blockedCommandSubstrings: [],
            blockedShortcuts: [],
            enabled: true,
            filesystem: {
              allowHostTempDir: false,
              extraWritablePaths: [],
              mode: "auto",
            },
            mode: "view",
            settingsPatch: {},
          },
          sessionRoot: null,
          supportMountTargets: [],
          writablePaths: [],
        },
        supportBindings: [],
        supportRoot: null,
        translatedPaths: [],
        trustedOrigins: [],
        userDataDir: "/tmp/fake/user-data",
        watchdogMode: "native",
        workspacePath: null,
      },
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
});
