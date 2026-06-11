import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createCodeServerLaunch,
  createCodeServerLaunchPlan,
  createCodeServerLaunchSpec,
  formatCodeServerCommand,
  launchCodeServerProcess,
  resolveCodeServerInstallation,
} from "../../src/index.js";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

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
    expect(plan.bindings).toHaveLength(4);
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
            checkedAt: "",
            issues: [],
            packageRoot: "/tmp/fake",
            postinstallScriptPath: null,
            state: "prepared",
            supportRoot: null,
            watchdogIssue: null,
            watchdogMode: "native",
          },
          recommendedReadablePaths: ["/tmp/fake"],
          supportBindings: [],
          supportRoot: null,
          version: "4.117.0",
        },
        launchMode: "node",
        port: 1,
        preparationStatus: {
          checkedAt: "",
          issues: [],
          packageRoot: "/tmp/fake",
          postinstallScriptPath: null,
          state: "prepared",
          supportRoot: null,
          watchdogIssue: null,
          watchdogMode: "native",
        },
        recommendedReadablePaths: ["/tmp/fake"],
        recommendedWritablePaths: ["/tmp/fake/user-data", "/tmp/fake/extensions"],
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
});
