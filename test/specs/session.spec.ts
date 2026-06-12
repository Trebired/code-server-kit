import { describe, expect, test } from "bun:test";

import {
  CodeServerInvalidConfigurationError,
  CodeServerSessionReuseConflictError,
  createCodeServerSessionManager,
  createSessionDiagnosticsBridge,
  getCodeServerSessionStatus,
  inspectSessionFailure,
  startCodeServerSession,
  stopCodeServerSession,
} from "../../src/index.js";
import { createFakeCodeServerPackage, exists, readFile, sleep, tempDir, writeFile } from "./helpers.js";

const LISTENING_ENTRY = `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const bindAddr = readArg("--bind-addr") || "127.0.0.1:8080";
const userDataDir = readArg("--user-data-dir");
const host = bindAddr.startsWith("[")
  ? bindAddr.slice(1, bindAddr.indexOf("]"))
  : bindAddr.slice(0, bindAddr.lastIndexOf(":"));
const portText = bindAddr.startsWith("[")
  ? bindAddr.slice(bindAddr.indexOf("]:") + 2)
  : bindAddr.slice(bindAddr.lastIndexOf(":") + 1);
const port = Number(portText);

if (userDataDir) {
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  if (fs.existsSync(path.join(userDataDir, "User", "settings.json"))) {
    fs.writeFileSync(path.join(userDataDir, "User", "settings.json"), JSON.stringify({ restored: true, runtime: true }, null, 2) + "\\n");
  }
  fs.writeFileSync(path.join(userDataDir, "User", "keybindings.json"), "[]\\n");
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("ok");
});

server.listen(port, host, () => {
  process.stdout.write("listening\\n");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
`;

describe("@trebired/code-server-kit session", () => {
  test("starts a fresh direct session, reports ready status, and stops cleanly", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const manager = createCodeServerSessionManager({
      resolveFrom: root,
    });
    const result = await manager.start({
      sessionKey: "demo",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(result.created).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.status.ready).toBe(true);
    expect(result.status.state).toBe("ready");
    expect(exists(stateRoot, "sessions/demo/session.json")).toBe(true);
    expect(exists(stateRoot, "sessions/demo/diagnostics.json")).toBe(true);
    expect(result.diagnostics?.sanitized).toBeNull();

    const status = await manager.getStatus({
      sessionKey: "demo",
      stateRoot,
    });

    expect(status?.ready).toBe(true);
    expect(status?.pid).toBeGreaterThan(0);

    const stopped = await manager.stop({
      sessionKey: "demo",
      stateRoot,
    });

    expect(stopped?.status.state).toBe("stopped");
  });

  test("reuses an existing direct session when the normalized spec still matches", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const manager = createCodeServerSessionManager({
      resolveFrom: root,
    });
    const first = await manager.start({
      sessionKey: "reuse",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });
    const second = await manager.start({
      sessionKey: "reuse",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(second.reused).toBe(true);
    expect(second.status.state).toBe("reusing_existing");
    expect(second.status.pid).toBe(first.status.pid);

    await manager.stop({
      sessionKey: "reuse",
      stateRoot,
    });
  });

  test("marks the prior session stale and restarts when the normalized spec changes", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const manager = createCodeServerSessionManager({
      resolveFrom: root,
    });
    const first = await manager.start({
      sessionKey: "restart",
      stateRoot,
      workspacePath: "/srv/workspaces/one",
    });
    const second = await manager.start({
      sessionKey: "restart",
      stateRoot,
      workspacePath: "/srv/workspaces/two",
    });

    expect(second.reused).toBe(false);
    expect(second.status.state).toBe("ready");
    expect(second.status.specHash).not.toBe(first.status.specHash);
    expect(second.status.pid).not.toBe(first.status.pid);

    await manager.stop({
      sessionKey: "restart",
      stateRoot,
    });
  });

  test("restores and persists allowlisted profile data during the session lifecycle", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    const restoreFrom = tempDir();
    const persistTo = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    writeFile(restoreFrom, "User/settings.json", "{\n  \"theme\": \"light\"\n}\n");

    const result = await startCodeServerSession({
      profile: {
        items: ["settings.json", "keybindings.json"],
        persistTo,
        restoreFrom,
      },
      resolveFrom: root,
      sessionKey: "profile",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(readFile(pathFrom(result.status.userDataDir), "User/settings.json")).toContain("\"runtime\": true");

    await stopCodeServerSession({
      profile: {
        items: ["settings.json", "keybindings.json"],
        persistTo,
      },
      sessionKey: "profile",
      stateRoot,
    });

    expect(exists(persistTo, "User/settings.json")).toBe(true);
    expect(exists(persistTo, "User/keybindings.json")).toBe(true);
    expect(readFile(persistTo, "User/settings.json")).toContain("\"restored\": true");
  });

  test("requires an explicit scope for systemd lifecycle launches", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    await expect(startCodeServerSession({
      launchStrategy: "systemd",
      resolveFrom: root,
      sessionKey: "systemd-missing-scope",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    })).rejects.toBeInstanceOf(CodeServerInvalidConfigurationError);
  });

  test("logs package initialization and lifecycle events through logger-adapter wiring", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const events: Array<{ group: string; level: string; message: string }> = [];
    const manager = createCodeServerSessionManager({
      logger: events as unknown as Record<string, unknown>,
      loggerAdapter(logger, event) {
        (logger as unknown as typeof events).push({
          group: event.group,
          level: event.level,
          message: event.message,
        });
      },
      resolveFrom: root,
    });

    expect(events.some((event) => event.group.endsWith(".initialize"))).toBe(true);

    await manager.start({
      sessionKey: "logged",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });
    await manager.stop({
      sessionKey: "logged",
      stateRoot,
    });

    expect(events.some((event) => event.group === "launch:planned")).toBe(true);
    expect(events.some((event) => event.group === "session:stop")).toBe(true);
  });

  test("reads persisted sanitized diagnostics when a sanitizer is provided", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const manager = createCodeServerSessionManager({
      resolveFrom: root,
    });

    await manager.start({
      sanitizer: {
        pathPrefixes: ["/srv/workspaces/demo"],
      },
      sessionKey: "sanitized",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    const diagnostics = await manager.readDiagnostics({
      sanitizer: {
        pathPrefixes: ["/srv/workspaces/demo"],
      },
      sessionKey: "sanitized",
      stateRoot,
    });

    expect(diagnostics?.sanitized).not.toBeUndefined();

    await manager.stop({
      sessionKey: "sanitized",
      stateRoot,
    });
  });

  test("rejects conflicting inflight starts for the same session key", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const manager = createCodeServerSessionManager({
      resolveFrom: root,
    });
    const first = manager.start({
      sessionKey: "race",
      stateRoot,
      workspacePath: "/srv/workspaces/one",
    });

    await expect(manager.start({
      sessionKey: "race",
      stateRoot,
      workspacePath: "/srv/workspaces/two",
    })).rejects.toBeInstanceOf(CodeServerSessionReuseConflictError);

    const started = await first;
    await manager.stop({
      sessionKey: "race",
      stateRoot,
    });

    expect(started.status.ready).toBe(true);
  });

  test("can wait for workbench readiness through browser diagnostics", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    const bridge = createSessionDiagnosticsBridge();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    setTimeout(() => {
      bridge.recordEvent({
        summary: "shell loaded",
        type: "shell-loaded",
      });
      bridge.recordEvent({
        summary: "workbench mounted",
        type: "workbench-mounted",
      });
    }, 120);

    const result = await startCodeServerSession({
      browser: {
        bridge,
      },
      readinessTarget: "workbench",
      resolveFrom: root,
      sessionKey: "browser-ready",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(result.readiness?.target).toBe("workbench");
    expect(result.diagnostics?.browserEvents?.some((event) => event.type === "workbench-mounted")).toBe(true);

    await stopCodeServerSession({
      sessionKey: "browser-ready",
      stateRoot,
    });
  });

  test("seeds readonly profile settings into ephemeral session state", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    const result = await startCodeServerSession({
      readonly: true,
      resolveFrom: root,
      sessionKey: "readonly",
      stateRoot,
      workspacePath: "/srv/workspaces/demo",
    });

    expect(readFile(pathFrom(result.status.userDataDir), "User/settings.json")).toContain("\"update.mode\": \"none\"");

    await stopCodeServerSession({
      sessionKey: "readonly",
      stateRoot,
    });
  });

  test("persists structured browser-side failure diagnostics", async () => {
    const root = tempDir();
    const stateRoot = tempDir();
    const bridge = createSessionDiagnosticsBridge();
    createFakeCodeServerPackage(root, {
      entryContents: LISTENING_ENTRY,
    });

    setTimeout(() => {
      bridge.recordEvent({
        level: "error",
        summary: "resource failed",
        type: "resource-error",
      });
      bridge.recordEvent({
        level: "error",
        summary: "bootstrap timeout",
        type: "bootstrap-timeout",
      });
    }, 100);

    let thrown: unknown = null;
    try {
      await startCodeServerSession({
        browser: {
          bridge,
        },
        readinessTarget: "workbench",
        resolveFrom: root,
        sessionKey: "browser-failure",
        stateRoot,
        workspacePath: "/srv/workspaces/demo",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).not.toBeNull();
    await sleep(50);
    const failure = await inspectSessionFailure({
      sessionKey: "browser-failure",
      stateRoot,
    });

    expect(failure).not.toBeNull();
    expect(failure?.browserEvents?.some((event) => event.type === "bootstrap-timeout")).toBe(true);

    await stopCodeServerSession({
      sessionKey: "browser-failure",
      stateRoot,
    });
  });
});

function pathFrom(value: string): string {
  return value;
}
