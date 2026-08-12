import { summarizeCodeServerBrowserDiagnostics } from "#8392d406df71";
import {
  CodeServerInvalidConfigurationError,
} from "#8974ac53d713";
import { launchCodeServerProcess } from "#58b1c427e96f";
import { waitForCodeServerReady } from "#vbzbeb8hf107";
import {
  launchCodeServerWithSystemd,
  summarizeCodeServerSystemdJournal,
} from "#4d930a954677";
import type { CodeServerSessionRecord, CodeServerSessionStartResult } from "#3c8d8166992a";
import {
  createDiagnosticsSnapshot,
  formatReadyHost,
  handles,
  nowIso,
  pushBackendCheckpoint,
  writeDiagnosticsFile,
  writeSessionRecord,
} from "#5abxg3204o0r";
import type {
  SessionReadyRuntime,
  SessionStartContext,
  SessionStartRuntime,
} from "./shared.js";
import {
  probeSessionRecord,
  readCodeServerSessionDiagnostics,
} from "#jfr5p9teg08n";

const DEFAULT_READY_RETRY_INTERVAL_MS = 100;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

async function launchAndWaitForReady(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<SessionReadyRuntime> {
  const handle = await launchSessionRuntime(context, runtime);
  const readiness = await waitForSessionReady(context, runtime, handle);
  recordReadyCheckpoints(runtime, readiness.checkpoints);
  const journalTail = await readJournalTail(context, runtime);
  return { handle, journalTail, readiness };
}

async function finalizeReadyStart(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  baseRecord: CodeServerSessionRecord,
  readyRuntime: SessionReadyRuntime,
): Promise<CodeServerSessionStartResult> {
  await refreshRuntimeProfile(runtime, context.launchPlan.userDataDir);
  const browserEvents = runtime.browserBridge?.getEvents() ?? [];
  const browserSummary = summarizeCodeServerBrowserDiagnostics(browserEvents);
  const diagnostics = createDiagnosticsSnapshot({
      backendCheckpoints: runtime.backendCheckpoints,
      browserEvents,
      browserSummary,
      correlationId: runtime.correlationId,
      handle: readyRuntime.handle,
      journalTail: readyRuntime.journalTail,
      normalizedFailure: null,
      readyElapsedMs: readyRuntime.readiness.elapsedMs,
      summary: {
        browserSummary,
        checkpoints: readyRuntime.readiness.checkpoints,
        correlationId: runtime.correlationId,
        launchStrategy: runtime.launchStrategy,
        profile: runtime.profilePolicy?.describe() ?? null,
        readonlyEnforcement: runtime.readonlyFilesystem,
        readinessTarget: runtime.readinessTarget,
      },
  });
  const record = createReadyRecord(
    context,
    runtime,
    baseRecord,
    diagnostics,
    readyRuntime.handle,
  );
  await writeSessionRecord(record, context.paths.recordPath);
  await writeDiagnosticsFile(record, context.paths);
  return await buildStartResult(context, runtime, record, readyRuntime);
}

async function launchSessionRuntime(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
) {
  if (runtime.launchStrategy !== "systemd") {
    return await launchDirectRuntime(context, runtime);
  }
  await launchSystemdRuntime(context, runtime);
  return null;
}

async function launchDirectRuntime(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
) {
  const handle = await launchCodeServerProcess({ plan: context.launchPlan });
  handles.set(context.sessionKey, handle);
  pushBackendCheckpoint(
    runtime.backendCheckpoints,
    "launch",
    "spawned direct code-server process",
    {
      args: context.launchPlan.args,
      command: context.launchPlan.command,
      readonlyEnforcement: runtime.readonlyFilesystem,
      pid: handle.pid ?? null,
    },
  );
  return handle;
}

async function launchSystemdRuntime(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<void> {
  if (!context.options.systemd?.scope) {
    throw new CodeServerInvalidConfigurationError(
      "systemd session launches require an explicit scope of 'user' or 'system'.",
      { sessionKey: context.sessionKey },
    );
  }
  await launchCodeServerWithSystemd({
      extraProperties: context.options.systemd.extraProperties,
      logger: context.options.logger,
      loggerAdapter: context.options.loggerAdapter,
      plan: context.launchPlan,
      scope: context.options.systemd.scope,
      sessionKey: context.sessionKey,
      unitName: context.options.systemd.unitName,
  });
  pushBackendCheckpoint(
    runtime.backendCheckpoints,
    "launch",
    "launched code-server with systemd transient unit",
    {
      readonlyEnforcement: runtime.readonlyFilesystem,
      scope: context.options.systemd.scope,
      unitName:
      context.options.systemd.unitName ??
      `package-code-server-kit-${context.sessionKey}.service`,
    },
  );
}

async function waitForSessionReady(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  handle: SessionReadyRuntime["handle"],
) {
  return await waitForCodeServerReady({
      browser: {
        bridge: runtime.browserBridge,
        timeoutMs: context.options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      },
      failureProbe: context.options.failureProbe,
      host: context.launchPlan.host,
      httpUrl: `http://${formatReadyHost(context.launchPlan.host)}:${context.launchPlan.port}/`,
      port: context.launchPlan.port,
      process: handle ?? undefined,
      retryIntervalMs:
      context.options.readinessRetryIntervalMs ??
      DEFAULT_READY_RETRY_INTERVAL_MS,
      target: runtime.readinessTarget,
      timeoutMs: context.options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      websocketUrl: context.options.websocketUrl,
  });
}

function recordReadyCheckpoints(
  runtime: SessionStartRuntime,
  checkpoints: Array<{
    details: Record<string, unknown>;
    phase: import("#3c8d8166992a").CodeServerSessionBackendCheckpoint["phase"];
    target: string;
  }>,
): void {
  for (const checkpoint of checkpoints) {
    pushBackendCheckpoint(
      runtime.backendCheckpoints,
      checkpoint.phase,
      `reached ${checkpoint.target} readiness`,
      checkpoint.details,
    );
  }
}

async function readJournalTail(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<string> {
  if (runtime.launchStrategy !== "systemd" || !context.options.systemd?.scope) {
    return "";
  }
  return await summarizeCodeServerSystemdJournal({
      lines: 50,
      scope: context.options.systemd.scope,
      unitName:
      context.options.systemd.unitName ??
      `package-code-server-kit-${context.sessionKey}.service`,
  });
}

function createReadyRecord(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  baseRecord: CodeServerSessionRecord,
  diagnostics: CodeServerSessionRecord["diagnostics"],
  handle: SessionReadyRuntime["handle"],
): CodeServerSessionRecord {
  return {
    ...baseRecord,
    browserSummary: summarizeCodeServerBrowserDiagnostics(
      runtime.browserBridge?.getEvents() ?? [],
    ),
    correlationId: runtime.correlationId,
    diagnostics,
    health: "ready",
    lastStartSummary: `Reached ${runtime.readinessTarget} readiness.`,
    metadata: context.options.metadata ?? null,
    pid: handle?.pid ?? null,
    preparation: runtime.preparation,
    readyAt: nowIso(),
    readinessTarget: runtime.readinessTarget,
    sanitizedDiagnostics: null,
    startedAt: nowIso(),
    state: "ready",
    systemdScope: context.options.systemd?.scope ?? null,
    unitName: context.options.systemd?.unitName ?? null,
    updatedAt: nowIso(),
  };
}

async function buildStartResult(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  record: CodeServerSessionRecord,
  readyRuntime: SessionReadyRuntime,
): Promise<CodeServerSessionStartResult> {
  return {
    created: true,
    diagnostics: await readCodeServerSessionDiagnostics({
        sanitizer: context.options.sanitizer,
        sessionKey: context.sessionKey,
        stateRoot: context.stateRoot,
    }),
    handle: readyRuntime.handle,
    launchPlan: context.launchPlan,
    launchStrategy: runtime.launchStrategy,
    readiness: readyRuntime.readiness,
    reused: false,
    status: await probeSessionRecord(record, context.options.sanitizer),
  };
}

async function refreshRuntimeProfile(
  runtime: SessionStartRuntime,
  runtimeDir: string,
): Promise<void> {
  if (!runtime.profilePolicy) return;
  await runtime.profilePolicy.prepareRuntimeProfile(runtimeDir);
}

export { finalizeFailedStart } from "./failure.js";
export { finalizeReadyStart, launchAndWaitForReady };
