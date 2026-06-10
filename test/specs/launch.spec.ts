import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createCodeServerLaunch,
  launchCodeServerProcess,
  resolveCodeServerInstallation,
} from "../../src/index.js";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

describe("@trebired/code-server-kit launch", () => {
  test("builds the standard code-server CLI args for a node-launched entrypoint", async () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);
    const installation = resolveCodeServerInstallation({
      resolveFrom: root,
    });

    const plan = await createCodeServerLaunch({
      bindAddr: "127.0.0.1:8123",
      extensionsDir: "/tmp/code-server/extensions",
      installation,
      launchMode: "node",
      trustedOrigins: [
        "https://app.example.com",
        "https://app.example.com",
        "https://admin.example.com",
      ],
      userDataDir: "/tmp/code-server/user-data",
      workspacePath: "/srv/workspaces/demo",
    });

    expect(plan).toEqual({
      args: [
        path.join(packageRoot, "out/node/entry.js"),
        "--auth",
        "none",
        "--bind-addr",
        "127.0.0.1:8123",
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
      bindAddr: "127.0.0.1:8123",
      codeServerPackageRoot: packageRoot,
      command: process.execPath,
      entryPoint: path.join(packageRoot, "out/node/entry.js"),
      extensionsDir: "/tmp/code-server/extensions",
      host: "127.0.0.1",
      launchMode: "node",
      port: 8123,
      supportRoot: path.join(packageRoot, "lib/vscode"),
      userDataDir: "/tmp/code-server/user-data",
      workspacePath: "/srv/workspaces/demo",
    });
  });

  test("derives user data directories from dataRoot and allocates a free TCP port when needed", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);

    const plan = await createCodeServerLaunch({
      dataRoot: "/tmp/code-server/session-42",
      host: "127.0.0.1",
      port: 0,
      resolveFrom: root,
    });

    expect(plan.userDataDir).toBe("/tmp/code-server/session-42/user-data");
    expect(plan.extensionsDir).toBe("/tmp/code-server/session-42/extensions");
    expect(plan.port).toBeGreaterThan(0);
    expect(plan.bindAddr).toBe(`127.0.0.1:${plan.port}`);
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

    const plan = await createCodeServerLaunch({
      bindAddr: "127.0.0.1:8124",
      dataRoot: "/tmp/code-server/direct",
      installation,
      launchMode: "direct",
    });

    expect(plan.command).toBe(path.join(packageRoot, "bin/code-server"));
    expect(plan.args[0]).toBe("--auth");
    expect(plan.launchMode).toBe("direct");
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
        codeServerPackageRoot: "/tmp/fake",
        command: process.execPath,
        entryPoint: process.execPath,
        extensionsDir: "/tmp/fake/extensions",
        host: "127.0.0.1",
        launchMode: "node",
        port: 1,
        supportRoot: null,
        userDataDir: "/tmp/fake/user-data",
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
  });
});
