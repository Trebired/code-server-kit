import { summarizeCodeServerBrowserDiagnostics } from "#8392d406df71";
import { normalizeCodeServerStartupFailure } from "#585f3a8d1af0";
import {
  CodeServerSessionLifecycleError,
  isCodeServerKitError,
} from "#8974ac53d713";
import type {
  CodeServerSessionFailure,
  CodeServerSessionRecord,
} from "#3c8d8166992a";
import {
  createDiagnosticsSnapshot,
  handles,
  nowIso,
  safeSystemdSummary,
  terminateHandle,
  writeDiagnosticsFile,
  writeSessionRecord,
} from "#5abxg3204o0r";
import type {
  SessionReadyRuntime,
  SessionStartContext,
  SessionStartRuntime,
} from "./shared.js";

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

  const record = await createFailedRecord(
    context,
    runtime,
    baseRecord,
    normalized,
    failure,
    handle,
  );
  await writeSessionRecord(record, context.paths.recordPath);
  await writeDiagnosticsFile(record, context.paths);

  if (isCodeServerKitError(error)) throw error;
  throw new CodeServerSessionLifecycleError(
    "Could not start the code-server session.",
    {
      cause: normalized.summary,
      sessionKey: context.sessionKey,
      stateRoot: context.stateRoot,
    },
  );
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
    runtime.launchStrategy !== "systemd" ||
      !context.options.systemd?.scope ||
      !context.options.systemd.unitName
  ) {
    return "";
  }
  return await safeSystemdSummary(
    context.options.systemd.scope,
    context.options.systemd.unitName,
  );
}

export { finalizeFailedStart };
