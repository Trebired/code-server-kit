import path from "node:path";

import { expect, test } from "bun:test";

import { createCodeServerLaunch, createCodeServerLaunchPlan, createCodeServerLaunchSpec, formatCodeServerCommand, resolveCodeServerInstallation } from "#c0ucu2gxeffq";
import { createFakeCodeServerPackage, tempDir, writeFile } from "#bfmndbpzi7qu";

test("builds node launch args and trusted origins for host-owned execution", async () => {
  const { packageRoot, installation, plan } = await createNodeLaunchPlanFixture();
  expect(plan.args).toEqual([
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
  ]);
  expect(plan.bindAddr).toBe(`127.0.0.1:${plan.port}`);
  expect(plan.command).toBe(process.execPath);
  expect(plan.cwd).toBe("/srv/runtime");
  expect(plan.entryKind).toBe("node_script");
  expect(plan.entryPoint).toBe(path.join(packageRoot, "out/node/entry.js"));
  expect(plan.env).toEqual({
    TB_MODE: "test",
  });
  expect(plan.extensionsDir).toBe("/tmp/code-server/extensions");
  expect(plan.host).toBe("127.0.0.1");
  expect(plan.installation).toBe(installation);
  expect(plan.launchMode).toBe("node");
  expect(plan.trustedOrigins).toEqual([
    "https://app.example.com",
    "https://admin.example.com",
  ]);
  expect(plan.userDataDir).toBe("/tmp/code-server/user-data");
  expect(plan.workspacePath).toBe("/srv/workspaces/demo");
});

test("records bindings and path recommendations on node launch plans", async () => {
  const { packageRoot, plan } = await createNodeLaunchPlanFixture();
  expect(plan.bindings).toEqual([
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
  ]);
  expect(plan.recommendedReadablePaths).toEqual([
    packageRoot,
    path.join(packageRoot, "out/node/entry.js"),
    path.join(packageRoot, "lib/vscode"),
    "/srv/workspaces/demo",
  ]);
  expect(plan.recommendedWritablePaths).toEqual([
    "/tmp/code-server/user-data",
    "/tmp/code-server/extensions",
  ]);
  expect(plan.supportRoot).toBe(path.join(packageRoot, "lib/vscode"));
});

test("keeps node launch plans in a prepared and launchable state", async () => {
  const { plan } = await createNodeLaunchPlanFixture();
  expect(plan.codeServerPackageRoot).toBeTruthy();
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

async function createNodeLaunchPlanFixture() {
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
  return { installation, packageRoot, plan };
}
