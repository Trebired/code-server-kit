import { expect, test } from "bun:test";

import {
  createCodeServerSessionManager,
  createSessionDiagnosticsBridge,
  getCodeServerSessionStatus,
  inspectSessionFailure,
  startCodeServerSession,
  stopCodeServerSession,
} from "#c0ucu2gxeffq";
import { createFakeCodeServerPackage, readFile, sleep, tempDir } from "#bfmndbpzi7qu";
import { LISTENING_ENTRY } from "./support/entries.js";

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
    env: {
      PATH: "",
    },
    readonly: true,
    resolveFrom: root,
    sessionKey: "readonly",
    stateRoot,
    workspacePath: "/srv/workspaces/demo",
  });

  expect(readFile(pathFrom(result.status.userDataDir), "User/settings.json")).toContain("\"update.mode\": \"none\"");
  expect(result.diagnostics?.summary.readonlyEnforcement).toMatchObject({
    available: false,
    boundary: "none",
    hardReadonly: false,
  });

  await stopCodeServerSession({
    sessionKey: "readonly",
    stateRoot,
  });
});

test("persists structured browser-side failure diagnostics", async () => {
  const root = tempDir();
  const stateRoot = tempDir();
  const bridge = createBrowserFailureBridge();
  createFakeCodeServerPackage(root, {
    entryContents: LISTENING_ENTRY,
  });

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

test("persists correlation ids and backend checkpoints in diagnostics snapshots", async () => {
  const root = tempDir();
  const stateRoot = tempDir();
  createFakeCodeServerPackage(root, {
    entryContents: LISTENING_ENTRY,
  });

  const started = await startCodeServerSession({
    metadata: {
      owner: "tests",
    },
    resolveFrom: root,
    sessionKey: "diagnostics",
    stateRoot,
    workspacePath: "/srv/workspaces/demo",
  });
  const status = await getCodeServerSessionStatus({
    sessionKey: "diagnostics",
    stateRoot,
  });
  const snapshot = readDiagnosticsSnapshot(stateRoot);

  expect(started.status.correlationId).toBeTruthy();
  expect(status?.metadata).toEqual({
    owner: "tests",
  });
  expect(snapshot.correlationId).toBe(started.status.correlationId);
  expect(snapshot.summary.correlationId).toBe(started.status.correlationId);
  expect(snapshot.summary.launchStrategy).toBe("direct");
  expect(snapshot.backendCheckpoints?.some((checkpoint) => checkpoint.phase === "launch")).toBe(true);
  expect(snapshot.backendCheckpoints?.some((checkpoint) => checkpoint.summary.includes("readiness"))).toBe(true);

  await stopCodeServerSession({
    sessionKey: "diagnostics",
    stateRoot,
  });
});

function pathFrom(value: string): string {
  return value;
}

function readDiagnosticsSnapshot(stateRoot: string) {
  return JSON.parse(readFile(stateRoot, "sessions/diagnostics/diagnostics.json")) as {
    backendCheckpoints?: Array<{ phase: string; summary: string }>;
    correlationId?: string;
    summary: {
      correlationId?: string;
      launchStrategy?: string;
    };
  };
}

function createBrowserFailureBridge() {
  const bridge = createSessionDiagnosticsBridge();
  recordBridgeEventsAfterDelay(bridge, 100, [
    {
      level: "error",
      summary: "resource failed",
      type: "resource-error",
    },
    {
      level: "error",
      summary: "bootstrap timeout",
      type: "bootstrap-timeout",
    },
  ]);
  return bridge;
}

function recordBridgeEventsAfterDelay(
  bridge: ReturnType<typeof createSessionDiagnosticsBridge>,
  delayMs: number,
  events: Array<{
    level?: "error";
    summary: string;
    type: string;
  }>,
): void {
  setTimeout(() => {
    for (const event of events) {
      bridge.recordEvent(event);
    }
  }, delayMs);
}
