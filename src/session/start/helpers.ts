import { summarizeCodeServerBrowserDiagnostics } from "#8392d406df71";
import { normalizeCodeServerStartupFailure } from "#585f3a8d1af0";
import { CodeServerInvalidConfigurationError, CodeServerSessionLifecycleError, isCodeServerKitError } from "#8974ac53d713";
import { launchCodeServerProcess } from "#58b1c427e96f";
import { waitForCodeServerReady } from "#37ar8glh8po5";
import { launchCodeServerWithSystemd, summarizeCodeServerSystemdJournal } from "#4d930a954677";
import type { CodeServerSessionFailure, CodeServerSessionRecord, CodeServerSessionStartResult } from "#3c8d8166992a";
import { createDiagnosticsSnapshot, formatReadyHost, handles, nowIso, pushBackendCheckpoint, safeSystemdSummary, terminateHandle, writeDiagnosticsFile, writeSessionRecord } from "#5abxg3204o0r";
import type { SessionReadyRuntime, SessionStartContext, SessionStartRuntime } from "./shared.js";
import { probeSessionRecord, readCodeServerSessionDiagnostics } from "#jfr5p9teg08n";

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
  const record = createReadyRecord(context, runtime, baseRecord, diagnostics, readyRuntime.handle);
  await writeSessionRecord(record, context.paths.recordPath);
  await writeDiagnosticsFile(record, context.paths);
  return await buildStartResult(context, runtime, record, readyRuntime);
}

async function finalizeFailedStart(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  baseRecord: CodeServerSessionRecord,
  error: unknown,
): Promise<never> {
  const normalized = normalizeCodeServerStartupFailure(error, {
    browserEvents: runtime.browserBridge?.getEvents() ?? [],
    checkpoints: [],
    launchStrategy: runtime.launchStrategy,
    preparationStatus: runtime.preparation,
    sanitizer: context.options.sanitizer,
    watchdogMode: runtime.preparation.watchdogMode,
  });
  const handle = handles.get(context.sessionKey) ?? null;
  const failure = createFailure(normalized);
  await stopFailedHandle(context.sessionKey, handle);

  const record = await createFailedRecord(context, runtime, baseRecord, normalized, failure, handle);
  await writeSessionRecord(record, context.paths.recordPath);
  await writeDiagnosticsFile(record, context.paths);

  if (isCodeServerKitError(error)) throw error;
  throw new CodeServerSessionLifecycleError("Could not start the code-server session.", {
    cause: normalized.summary,
    sessionKey: context.sessionKey,
    stateRoot: context.stateRoot,
  });
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
  pushBackendCheckpoint(runtime.backendCheckpoints, "launch", "spawned direct code-server process", {
    args: context.launchPlan.args,
    command: context.launchPlan.command,
    readonlyEnforcement: runtime.readonlyFilesystem,
    pid: handle.pid ?? null,
  });
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
  pushBackendCheckpoint(runtime.backendCheckpoints, "launch", "launched code-server with systemd transient unit", {
    readonlyEnforcement: runtime.readonlyFilesystem,
    scope: context.options.systemd.scope,
    unitName: context.options.systemd.unitName ?? `package-code-server-kit-${context.sessionKey}.service`,
  });
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
    retryIntervalMs: context.options.readinessRetryIntervalMs ?? DEFAULT_READY_RETRY_INTERVAL_MS,
    target: runtime.readinessTarget,
    timeoutMs: context.options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    websocketUrl: context.options.websocketUrl,
  });
}

function recordReadyCheckpoints(
  runtime: SessionStartRuntime,
  checkpoints: Array<{ details: Record<string, unknown>; phase: import("#3c8d8166992a").CodeServerSessionBackendCheckpoint["phase"]; target: string; }>,
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
    unitName: context.options.systemd.unitName ?? `package-code-server-kit-${context.sessionKey}.service`,
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
    browserSummary: summarizeCodeServerBrowserDiagnostics(runtime.browserBridge?.getEvents() ?? []),
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

function createFailure(
  normalized: ReturnType<typeof normalizeCodeServerStartupFailure>,
): CodeServerSessionFailure {
  return {
    code: normalized.code,
    details: normalized.details,
    hints: normalized.hints,
    message: normalized.summary,
    name: normalized.name,
    phase: normalized.phase,
    retryable: normalized.retryable,
  };
}

async function stopFailedHandle(
  sessionKey: string,
  handle: SessionReadyRuntime["handle"],
): Promise<void> {
  if (!handle) return;
  await terminateHandle(handle, "SIGTERM");
  handles.delete(sessionKey);
}

async function createFailedRecord(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  baseRecord: CodeServerSessionRecord,
  normalized: ReturnType<typeof normalizeCodeServerStartupFailure>,
  failure: CodeServerSessionFailure,
  handle: SessionReadyRuntime["handle"],
): Promise<CodeServerSessionRecord> {
  const browserEvents = runtime.browserBridge?.getEvents() ?? [];
  const browserSummary = summarizeCodeServerBrowserDiagnostics(browserEvents);
  const journalTail = await readFailedJournalTail(context, runtime);
  return {
    ...baseRecord,
    browserSummary,
    correlationId: runtime.correlationId,
    diagnostics: createDiagnosticsSnapshot({
      backendCheckpoints: runtime.backendCheckpoints,
      browserEvents,
      browserSummary,
      correlationId: runtime.correlationId,
      handle,
      journalTail,
      normalizedFailure: normalized,
      readyElapsedMs: null,
      summary: {
        correlationId: runtime.correlationId,
        launchStrategy: runtime.launchStrategy,
        profile: runtime.profilePolicy?.describe() ?? null,
        readinessTarget: runtime.readinessTarget,
      },
    }),
    failure,
    health: "failed",
    lastStartSummary: normalized.summary,
    pid: handle?.pid ?? null,
    preparation: runtime.preparation,
    readinessTarget: runtime.readinessTarget,
    sanitizedDiagnostics: normalized.sanitized ?? null,
    startedAt: nowIso(),
    state: "failed",
    systemdScope: context.options.systemd?.scope ?? null,
    unitName: context.options.systemd?.unitName ?? null,
    updatedAt: nowIso(),
  };
}

async function readFailedJournalTail(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<string> {
  if (
    runtime.launchStrategy !== "systemd"
    || !context.options.systemd?.scope
    || !context.options.systemd.unitName
  ) {
    return "";
  }
  return await safeSystemdSummary(context.options.systemd.scope, context.options.systemd.unitName);
}

export {
  finalizeFailedStart,
  finalizeReadyStart,
  launchAndWaitForReady,
};
