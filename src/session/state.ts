import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { createCodeServerProfilePolicy } from "#4a168ae26562";
import { createReadonlySessionPolicy } from "#3nojkzzzf31b";
import { summarizeCodeServerSystemdJournal } from "#4d930a954677";
import type {
  CodeServerProcessHandle,
  CodeServerProfileLifecycleOptions,
  CodeServerProfilePolicy,
  CodeServerSessionBackendCheckpoint,
  CodeServerSessionBrowserOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionRecord,
  CodeServerSessionState,
  CodeServerSessionStopResult,
  CodeServerSystemdScope,
  CodeServerWatchdogMode,
} from "#3c8d8166992a";
import { getSessionPaths, mkdirp, nowIso } from "./io.js";

const handles = new Map<string, CodeServerProcessHandle>();
const inflightStarts = new Map<string, {
  promise: Promise<import("#3c8d8166992a").CodeServerSessionStartResult>;
  specHash: string;
}>();

function createBaseRecord(options: {
  browserSummary: CodeServerSessionRecord["browserSummary"];
  correlationId: string;
  lastStartSummary: string | null;
  launchPlan: Awaited<ReturnType<typeof import("#0c8da394780f").createCodeServerLaunchPlan>>;
  launchStrategy: CodeServerSessionRecord["launchStrategy"];
  metadata: Record<string, unknown> | null;
  preparation: { watchdogMode: CodeServerWatchdogMode };
  readinessTarget: CodeServerSessionRecord["readinessTarget"];
  sessionKey: string;
  specHash: string;
  watchdogMode: CodeServerWatchdogMode;
}): CodeServerSessionRecord {
  return {
    bindAddr: options.launchPlan.bindAddr,
    browserSummary: options.browserSummary ?? null,
    correlationId: options.correlationId,
    diagnostics: null,
    extensionsDir: options.launchPlan.extensionsDir,
    health: "starting",
    lastStartSummary: options.lastStartSummary,
    launchStrategy: options.launchStrategy,
    metadata: options.metadata,
    pid: null,
    port: options.launchPlan.port,
    preparation: options.preparation as CodeServerSessionRecord["preparation"],
    readyAt: null,
    readinessTarget: options.readinessTarget ?? null,
    sanitizedDiagnostics: null,
    sessionKey: options.sessionKey,
    specHash: options.specHash,
    startedAt: null,
    state: "planned",
    stoppedAt: null,
    systemdScope: null,
    trustedOrigins: [...options.launchPlan.trustedOrigins],
    unitName: null,
    updatedAt: nowIso(),
    userDataDir: options.launchPlan.userDataDir,
    watchdogMode: options.watchdogMode,
    workspacePath: options.launchPlan.workspacePath,
  };
}

function createDiagnosticsSnapshot(options: {
  backendCheckpoints: CodeServerSessionBackendCheckpoint[];
  browserEvents: NonNullable<CodeServerSessionDiagnostics["browserEvents"]>;
  browserSummary: CodeServerSessionRecord["browserSummary"];
  correlationId: string;
  handle: CodeServerProcessHandle | null;
  journalTail: string;
  normalizedFailure: CodeServerSessionDiagnostics["normalizedFailure"];
  readyElapsedMs: number | null;
  summary: Record<string, unknown>;
}): CodeServerSessionDiagnosticsSnapshot {
  return {
    backendCheckpoints: options.backendCheckpoints,
    browserEvents: options.browserEvents,
    correlationId: options.correlationId,
    journalTail: options.journalTail || undefined,
    normalizedFailure: options.normalizedFailure ?? null,
    pid: options.handle?.pid ?? null,
    readyElapsedMs: options.readyElapsedMs,
    stderrTail: options.handle?.getStderr(),
    stdoutTail: options.handle?.getStdout(),
    summary: {
      ...options.summary,
      browserSummary: options.browserSummary ?? null,
    },
    updatedAt: nowIso(),
  };
}

async function writeDiagnosticsFile(
  record: CodeServerSessionRecord,
  paths: ReturnType<typeof getSessionPaths>,
): Promise<void> {
  await mkdirp(path.dirname(paths.diagnosticsPath));
  const snapshot = record.diagnostics;
  const diagnostics: CodeServerSessionDiagnostics = {
    backendCheckpoints: snapshot?.backendCheckpoints,
    browserEvents: snapshot?.browserEvents,
    correlationId: snapshot?.correlationId,
    diagnosticsPath: paths.diagnosticsPath,
    journalTail: snapshot?.journalTail,
    normalizedFailure: snapshot?.normalizedFailure ?? null,
    readyElapsedMs: snapshot?.readyElapsedMs ?? null,
    recordPath: paths.recordPath,
    sanitized: record.sanitizedDiagnostics ?? null,
    stderrTail: snapshot?.stderrTail,
    stdoutTail: snapshot?.stdoutTail,
    summary: snapshot?.summary ?? {},
    updatedAt: snapshot?.updatedAt ?? nowIso(),
  };
  await fs.promises.writeFile(paths.diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
}

async function writeSessionRecord(record: CodeServerSessionRecord, recordPath: string): Promise<void> {
  await mkdirp(path.dirname(recordPath));
  await fs.promises.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function normalizeProfileConfig(profile: CodeServerProfileLifecycleOptions | CodeServerProfilePolicy | undefined) {
  if (!profile) return null;
  if (isProfilePolicy(profile)) {
    const description = profile.describe();
    return {
      debounceMs: description.debounceMs,
      includeExtensionState: description.includeExtensionState,
      items: [...description.items].sort(),
      pathMap: description.pathMap,
      persistPolicy: description.persistPolicy,
      persistTo: description.persistTo,
      restoreFrom: description.restoreFrom,
      restorePolicy: description.restorePolicy,
      signatureMode: description.signatureMode,
      snapshotExtensions: description.snapshotExtensions,
    };
  }
  return {
    debounceMs: profile.debounceMs ?? 0,
    includeExtensionState: profile.includeExtensionState ?? false,
    items: [...(profile.items ?? [])].sort(),
    pathMap: profile.pathMap ?? {},
    persistPolicy: profile.persistPolicy ?? "if-changed",
    persistTo: profile.persistTo ? path.resolve(profile.persistTo) : null,
    restoreFrom: profile.restoreFrom ? path.resolve(profile.restoreFrom) : null,
    restorePolicy: profile.restorePolicy ?? "if-missing-or-empty",
    signatureMode: profile.signatureMode ?? "content-hash",
    snapshotExtensions: profile.snapshotExtensions ?? false,
  };
}

function mergeSessionBrowserOptions(
  defaults: CodeServerSessionBrowserOptions | undefined,
  overrides: CodeServerSessionBrowserOptions | undefined,
): CodeServerSessionBrowserOptions | undefined {
  if (!defaults && !overrides) return undefined;
  return normalizeSessionBrowserOptions({
    bridge: overrides?.bridge ?? defaults?.bridge,
    integration: overrides?.integration ?? defaults?.integration,
    policy: {
      ...(defaults?.policy ?? {}),
      ...(overrides?.policy ?? {}),
    },
  }) ?? undefined;
}

function normalizeSessionBrowserOptions(
  options: CodeServerSessionBrowserOptions | undefined,
): CodeServerSessionBrowserOptions | null {
  if (!options) return null;
  const integration = options.integration;
  const bridge = options.bridge ?? integration?.bridge;
  const hasPolicy = Boolean(options.policy && Object.keys(options.policy).length > 0);
  if (!bridge && !integration && !hasPolicy) return null;
  return {
    bridge,
    integration,
    policy: options.policy,
  };
}

function resolveProfilePolicy(
  profile: CodeServerProfileLifecycleOptions | CodeServerProfilePolicy | undefined,
  readonly = createReadonlySessionPolicy(false),
): CodeServerProfilePolicy | null {
  if (!profile) {
    return Object.keys(readonly.settingsPatch).length > 0 ? createCodeServerProfilePolicy({ readonly }) : null;
  }
  if (isProfilePolicy(profile)) return profile;
  return createCodeServerProfilePolicy({ ...profile, readonly });
}

function createSessionCorrelationId(sessionKey: string, specHash: string): string {
  return createHash("sha256").update(`${sessionKey}:${specHash}:${Date.now()}`).digest("hex").slice(0, 16);
}

function pushBackendCheckpoint(
  checkpoints: CodeServerSessionBackendCheckpoint[],
  phase: CodeServerSessionBackendCheckpoint["phase"],
  summary: string,
  details: Record<string, unknown>,
): void {
  checkpoints.push({ details, phase, summary, timestamp: nowIso() });
}

function hashNormalizedSpec(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deriveDeadState(record: CodeServerSessionRecord): CodeServerSessionState {
  if (record.state === "failed") return "failed";
  if (record.state === "stopped") return "stopped";
  return "stale";
}

function isLiveOrStartingState(state: CodeServerSessionState): boolean {
  return state === "launching" || state === "planned" || state === "ready" || state === "reusing_existing";
}

async function safeSystemdSummary(scope: CodeServerSystemdScope, unitName: string): Promise<string> {
  try {
    return await summarizeCodeServerSystemdJournal({ scope, unitName });
  } catch {
    return "";
  }
}

function createEmptyStopResult(sessionKey: string): CodeServerSessionStopResult {
  return {
    diagnostics: null,
    status: {
      bindAddr: "",
      browserSummary: null,
      correlationId: null,
      diagnostics: null,
      extensionsDir: "",
      failure: null,
      health: "stopped",
      lastStartSummary: null,
      launchStrategy: "direct",
      metadata: null,
      pid: null,
      port: 0,
      preparation: null,
      ready: false,
      readyAt: null,
      readinessTarget: null,
      sanitizedDiagnostics: null,
      sessionKey,
      specHash: "",
      startedAt: null,
      state: "stopped",
      stoppedAt: nowIso(),
      systemdScope: null,
      unitName: null,
      updatedAt: nowIso(),
      userDataDir: "",
      watchdogMode: "disabled_fallback",
      workspacePath: null,
    },
    stopped: false,
  };
}

function isProfilePolicy(value: unknown): value is CodeServerProfilePolicy {
  return Boolean(value)
    && typeof value === "object"
    && "prepareRuntimeProfile" in value
    && typeof (value as CodeServerProfilePolicy).prepareRuntimeProfile === "function";
}

export {
  createBaseRecord,
  createDiagnosticsSnapshot,
  createEmptyStopResult,
  createSessionCorrelationId,
  deriveDeadState,
  handles,
  hashNormalizedSpec,
  inflightStarts,
  isLiveOrStartingState,
  mergeSessionBrowserOptions,
  normalizeProfileConfig,
  normalizeSessionBrowserOptions,
  pushBackendCheckpoint,
  resolveProfilePolicy,
  safeSystemdSummary,
  writeDiagnosticsFile,
  writeSessionRecord,
};
