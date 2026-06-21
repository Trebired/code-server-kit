import path from "node:path";

import { sanitizeCodeServerDiagnostics } from "#585f3a8d1af0";
import { resolveLogger } from "#5a29135e56c1";
import { createReadonlySessionPolicy } from "#ad2fd7ec5e18";
import {
  readCodeServerSystemdStatus,
  stopCodeServerSystemdUnit,
} from "#4d930a954677";
import type {
  CodeServerProfilePolicy,
  CodeServerSanitizerOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
} from "#3c8d8166992a";
import {
  canConnect,
  createEmptyStopResult,
  deriveDeadState,
  getSessionPaths,
  handles,
  isLiveOrStartingState,
  isPidAlive,
  nowIso,
  readJsonFile,
  resolveProfilePolicy,
  terminateHandle,
  writeDiagnosticsFile,
  writeSessionRecord,
} from "./shared.js";

async function readCodeServerSessionDiagnostics(options: Pick<CodeServerSessionRequest, "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const diagnostics = await readJsonFile<CodeServerSessionDiagnostics>(paths.diagnosticsPath);
  if (!diagnostics) return null;

  if (options.sanitizer && diagnostics.normalizedFailure) {
    diagnostics.sanitized = sanitizeCodeServerDiagnostics(diagnostics.normalizedFailure, options.sanitizer);
  }
  return diagnostics;
}

async function stopCodeServerSessionInternal(
  options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sanitizer" | "sessionKey" | "stateRoot"> & {
    signal?: NodeJS.Signals | number;
  },
): Promise<CodeServerSessionStopResult | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const record = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);
  if (!record) return null;

  await stopExistingRuntime(
    record,
    resolveProfilePolicy(options.profile, createReadonlySessionPolicy(false)),
    options.signal,
    options.logger,
    options.loggerAdapter,
  );
  const stoppedRecord = {
    ...record,
    health: "stopped" as const,
    pid: null,
    state: "stopped" as const,
    stoppedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeSessionRecord(stoppedRecord, paths.recordPath);
  await writeDiagnosticsFile(stoppedRecord, paths);
  resolveLogger(options.logger, options.loggerAdapter).info(
    "session:stop",
    "stopped code-server session",
    {
      sessionKey: options.sessionKey,
      signal: options.signal ?? "SIGTERM",
      stateRoot: options.stateRoot,
    },
  );

  return {
    diagnostics: await readCodeServerSessionDiagnostics({
      sanitizer: options.sanitizer,
      sessionKey: options.sessionKey,
      stateRoot: options.stateRoot,
    }),
    signal: options.signal,
    status: await probeSessionRecord(stoppedRecord, options.sanitizer),
    stopped: true,
  };
}

async function getCodeServerSessionStatusInternal(
  options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sanitizer" | "sessionKey" | "stateRoot">,
): Promise<CodeServerSessionStatus | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const record = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);
  if (!record) return null;
  return await probeSessionRecord(record, options.sanitizer);
}

async function probeSessionRecord(
  record: CodeServerSessionRecord,
  sanitizer?: CodeServerSanitizerOptions,
): Promise<CodeServerSessionStatus> {
  const diagnostics = await readCodeServerSessionDiagnostics({
    sanitizer,
    sessionKey: record.sessionKey,
    stateRoot: path.dirname(path.dirname(path.dirname(record.userDataDir))),
  });
  const ready = record.launchStrategy === "systemd"
    ? await probeSystemdReady(record)
    : await probeDirectReady(record);
  const sanitizedDiagnostics = sanitizer && diagnostics?.normalizedFailure
    ? sanitizeCodeServerDiagnostics(diagnostics.normalizedFailure, sanitizer)
    : record.sanitizedDiagnostics ?? null;

  return {
    bindAddr: record.bindAddr,
    browserSummary: record.browserSummary ?? null,
    correlationId: record.correlationId ?? null,
    diagnostics,
    extensionsDir: record.extensionsDir,
    failure: record.failure ?? null,
    health: ready ? "ready" : record.health,
    lastStartSummary: record.lastStartSummary ?? null,
    launchStrategy: record.launchStrategy,
    metadata: record.metadata ?? null,
    pid: record.launchStrategy === "direct" ? handles.get(record.sessionKey)?.pid ?? record.pid : record.pid,
    port: record.port,
    preparation: record.preparation ?? null,
    ready,
    readyAt: ready ? record.readyAt : null,
    readinessTarget: record.readinessTarget ?? null,
    sanitizedDiagnostics,
    sessionKey: record.sessionKey,
    specHash: record.specHash,
    startedAt: record.startedAt,
    state: ready ? record.state : deriveDeadState(record),
    stoppedAt: record.stoppedAt,
    systemdScope: record.systemdScope,
    unitName: record.unitName,
    updatedAt: record.updatedAt,
    userDataDir: record.userDataDir,
    watchdogMode: record.watchdogMode,
    workspacePath: record.workspacePath,
  };
}

async function probeSystemdReady(record: CodeServerSessionRecord): Promise<boolean> {
  if (!record.systemdScope || !record.unitName) return false;
  try {
    const status = await readCodeServerSystemdStatus({ scope: record.systemdScope, unitName: record.unitName });
    return status.reusable && await canConnect(record.bindAddr, record.port);
  } catch {
    return false;
  }
}

async function probeDirectReady(record: CodeServerSessionRecord): Promise<boolean> {
  const pid = handles.get(record.sessionKey)?.pid ?? record.pid;
  if (!pid || !isPidAlive(pid)) return false;
  return await canConnect(record.bindAddr, record.port);
}

async function stopExistingRuntime(
  record: CodeServerSessionRecord,
  profile: CodeServerProfilePolicy | null,
  signal: NodeJS.Signals | number | undefined,
  logger?: CodeServerSessionRequest["logger"],
  loggerAdapter?: CodeServerSessionRequest["loggerAdapter"],
): Promise<void> {
  if (record.launchStrategy === "systemd" && record.systemdScope && record.unitName) {
    await stopCodeServerSystemdUnit({ logger, loggerAdapter, scope: record.systemdScope, unitName: record.unitName });
  } else {
    const handle = handles.get(record.sessionKey);
    if (handle) {
      await terminateHandle(handle, signal ?? "SIGTERM");
      handles.delete(record.sessionKey);
    } else if (record.pid && isPidAlive(record.pid)) {
      process.kill(record.pid, signal ?? "SIGTERM");
    }
  }

  await profile?.persistRuntimeProfile(record.userDataDir);
}

export {
  getCodeServerSessionStatusInternal,
  probeSessionRecord,
  readCodeServerSessionDiagnostics,
  stopCodeServerSessionInternal,
  stopExistingRuntime,
};
