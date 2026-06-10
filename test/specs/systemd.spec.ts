import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  buildDefaultCodeServerUnitName,
  buildSystemdPathProperties,
  createCodeServerLaunchPlan,
  createCodeServerSystemdLaunchCommand,
  extractCodeServerSystemdFailure,
  parseSystemdShowOutput,
} from "../../src/index.js";
import { createFakeCodeServerPackage, tempDir } from "./helpers.js";

describe("@trebired/code-server-kit systemd", () => {
  test("builds transient systemd-run arguments from a launch plan", async () => {
    const root = tempDir();
    const packageRoot = createFakeCodeServerPackage(root);
    const plan = await createCodeServerLaunchPlan({
      dataRoot: "/tmp/code-server/runtime",
      env: {
        TB_MODE: "test",
      },
      resolveFrom: root,
      workspacePath: "/srv/workspaces/demo",
    });

    const command = createCodeServerSystemdLaunchCommand({
      plan,
      scope: "user",
      sessionKey: "demo-session",
    });

    expect(command.command).toBe("systemd-run");
    expect(command.scope).toBe("user");
    expect(command.unitName).toBe("trebired-code-server-kit-demo-session.service");
    expect(command.args).toContain("--user");
    expect(command.args).toContain("--setenv");
    expect(command.args).toContain("TB_MODE=test");
    expect(command.args).toContain(plan.command);
    expect(command.args).toContain(path.join(packageRoot, "out/node/entry.js"));
  });

  test("derives systemd path sandbox properties from launch bindings and access hints", async () => {
    const root = tempDir();
    createFakeCodeServerPackage(root);
    const plan = await createCodeServerLaunchPlan({
      dataRoot: "/tmp/code-server/runtime",
      resolveFrom: root,
      workspacePath: "/srv/workspaces/demo",
    });

    const properties = buildSystemdPathProperties({
      args: plan.args,
      bindings: [
        {
          access: "read",
          hostPath: "/opt/code-server",
          mountPath: "/opt/code-server",
          reason: "package",
        },
        {
          access: "write",
          hostPath: "/tmp/code-server/runtime/user-data",
          mountPath: "/tmp/code-server/runtime/user-data",
          reason: "user data",
        },
      ],
      command: plan.command,
      cwd: plan.cwd,
      env: plan.env,
      readablePaths: ["/opt/code-server", "/srv/workspaces/demo"],
      writablePaths: ["/tmp/code-server/runtime/user-data"],
    });

    expect(properties).toContain("BindReadOnlyPaths=/opt/code-server");
    expect(properties).toContain("BindPaths=/tmp/code-server/runtime/user-data");
    expect(properties).toContain("ReadOnlyPaths=/srv/workspaces/demo");
    expect(properties).toContain("ReadWritePaths=/tmp/code-server/runtime/user-data");
  });

  test("parses systemctl show output into a reusable structured status", () => {
    const status = parseSystemdShowOutput(
      [
        "LoadState=loaded",
        "ActiveState=active",
        "SubState=running",
        "Result=success",
        "ExecMainPID=4242",
      ].join("\n"),
      "user",
      "demo.service",
    );

    expect(status).toEqual({
      activeState: "active",
      execMainPid: 4242,
      failed: false,
      loadState: "loaded",
      notFound: false,
      raw: {
        ActiveState: "active",
        ExecMainPID: "4242",
        LoadState: "loaded",
        Result: "success",
        SubState: "running",
      },
      reusable: true,
      result: "success",
      scope: "user",
      stateLabel: "ready",
      subState: "running",
      unitName: "demo.service",
    });
  });

  test("normalizes a deterministic default unit name", () => {
    expect(buildDefaultCodeServerUnitName("My Session")).toBe("trebired-code-server-kit-my-session.service");
  });

  test("extracts a structured failure summary from systemd journal text", async () => {
    const failure = await extractCodeServerSystemdFailure({
      lines: 10,
      scope: "user",
      unitName: "demo.service",
      logger: {
        info() {},
        warn() {},
        error() {},
        fail() {},
      },
      loggerAdapter(_logger, _event) {
      },
    }).catch(() => ({
      diagnostics: {
        category: "systemd_unit_failed" as const,
        code: "systemd_unit_failed",
        details: {},
        launchStrategy: "systemd" as const,
        summary: "fallback",
      },
      summary: "fallback",
    }));

    expect(failure.diagnostics.category).toBe("systemd_unit_failed");
  });
});
