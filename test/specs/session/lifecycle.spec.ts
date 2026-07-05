import { expect, test } from "bun:test";

import {
  CodeServerInvalidConfigurationError,
  CodeServerSessionReuseConflictError,
  createCodeServerSessionManager,
  createSessionDiagnosticsBridge,
  startCodeServerSession,
  stopCodeServerSession,
} from "#c0ucu2gxeffq";
import { createFakeCodeServerPackage, exists, readFile, tempDir, writeFile } from "#bfmndbpzi7qu";
import { DELAYED_LISTENING_ENTRY, LISTENING_ENTRY } from "./support/entries.js";

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

test("rejects conflicting inflight starts for the same session key", async () => {
  const root = tempDir();
  const stateRoot = tempDir();
  createFakeCodeServerPackage(root, {
    entryContents: DELAYED_LISTENING_ENTRY,
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

function pathFrom(value: string): string {
  return value;
}
