import fs from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";

import {
  CodeServerInvalidConfigurationError,
  CodeServerSessionLifecycleError,
  CodeServerSessionReuseConflictError,
  isCodeServerKitError,
} from "./errors.js";
import {
  collectCodeServerStartupDiagnostics,
  normalizeCodeServerStartupFailure,
  sanitizeCodeServerDiagnostics,
} from "./diagnostics.js";
import { launchCodeServerProcess } from "./launch.js";
import { logPackageInitialized, resolveLogger } from "./logging.js";
import { createCodeServerLaunchPlan } from "./plan.js";
import { ensureCodeServerPrepared } from "./preparation.js";
import {
  persistCodeServerProfileIfChanged,
  readCodeServerProfileSnapshot,
  syncCodeServerProfile,
} from "./profile.js";
import { waitForCodeServerReady } from "./readiness.js";
import {
  extractCodeServerSystemdFailure,
  launchCodeServerWithSystemd,
  readCodeServerSystemdJournal,
  readCodeServerSystemdStatus,
  restartCodeServerSystemdUnit,
  stopCodeServerSystemdUnit,
  summarizeCodeServerSystemdJournal,
} from "./systemd.js";
import type {
  CodeServerProcessHandle,
  CodeServerProfileLifecycleOptions,
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionFailure,
  CodeServerSessionHealth,
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStartResult,
  CodeServerSessionState,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
  CodeServerSystemdScope,
  CodeServerWatchdogMode,
} from "./types.js";

const DEFAULT_LAUNCH_STRATEGY = "direct";
const DEFAULT_READY_RETRY_INTERVAL_MS = 100;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const handles = new Map<string, CodeServerProcessHandle>();
const inflightStarts = new Map<string, {
  promise: Promise<CodeServerSessionStartResult>;
  specHash: string;
}>();

function createCodeServerSessionManager(options: CodeServerSessionManagerOptions = {}): CodeServerSessionManager {
  logPackageInitialized({
    adapter: options.loggerAdapter,
    logger: options.logger,
    source: "@trebired/code-server-kit",
  });

  return {
    async getStatus(input) {
      return await getCodeServerSessionStatusInternal({
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        sanitizer: input.sanitizer,
        sessionKey: input.sessionKey,
        stateRoot: input.stateRoot,
      });
    },
    async readDiagnostics(input) {
      return await readCodeServerSessionDiagnostics({
        sessionKey: input.sessionKey,
        stateRoot: input.stateRoot,
      });
    },
    async restart(input) {
      const stop = await this.stop({
        logger: input.logger,
        loggerAdapter: input.loggerAdapter,
        profile: input.profile,
        sanitizer: input.sanitizer,
        sessionKey: input.sessionKey,
        signal: "SIGTERM",
        stateRoot: input.stateRoot,
      }) ?? createEmptyStopResult(input.sessionKey);
      const start = await this.start(input);
      return {
        start,
        stop,
      } satisfies CodeServerSessionRestartResult;
    },
    async start(input) {
      return await startCodeServerSessionInternal({
        ...input,
        installation: input.installation ?? options.installation,
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        resolveFrom: input.resolveFrom ?? options.resolveFrom,
      });
    },
    async stop(input) {
      return await stopCodeServerSessionInternal({
        ...input,
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
      });
    },
  };
}

async function startCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  const manager = createCodeServerSessionManager({
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
  });

  return await manager.start(options);
}

async function stopCodeServerSession(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sanitizer" | "sessionKey" | "stateRoot"> & {
  signal?: NodeJS.Signals | number;
}): Promise<CodeServerSessionStopResult | null> {
  return await createCodeServerSessionManager({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
  }).stop(options);
}

async function restartCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult> {
  return await createCodeServerSessionManager({
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
  }).restart(options);
}

async function getCodeServerSessionStatus(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionStatus | null> {
  return await createCodeServerSessionManager({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
  }).getStatus(options);
}

async function readCodeServerSessionDiagnostics(options: Pick<CodeServerSessionRequest, "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  return await readJsonFile<CodeServerSessionDiagnostics>(paths.diagnosticsPath);
}

async function startCodeServerSessionInternal(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  const sessionKey = normalizeSessionKey(options.sessionKey);
  const stateRoot = path.resolve(options.stateRoot);
  const requestedSpecHash = hashNormalizedSpec({
    launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
    env: options.env ?? {},
    host: options.host ?? null,
    port: options.port ?? null,
    trustedOrigins: options.trustedOrigins ?? [],
    workspacePath: options.workspacePath ?? null,
    profile: normalizeProfileConfig(options.profile),
    systemd: options.systemd ?? null,
  });
  const inflightKey = `${stateRoot}:${sessionKey}`;
  const running = inflightStarts.get(inflightKey);
  if (running) {
    if (running.specHash === requestedSpecHash) {
      return await running.promise;
    }
    throw new CodeServerSessionReuseConflictError("A code-server session start is already in flight for this session key with a different effective spec.", {
      sessionKey,
      stateRoot,
    });
  }

  const promise = (async () => {
    const paths = getSessionPaths(stateRoot, sessionKey);
    const existing = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);
    const existingHost = existing ? extractHost(existing.bindAddr) : undefined;
    const launchPlan = await createCodeServerLaunchPlan({
      ...options,
      host: options.bindAddr ? undefined : (options.host ?? existingHost),
      port: options.bindAddr ? undefined : (options.port ?? existing?.port),
      dataRoot: options.dataRoot ?? path.join(paths.sessionDir, "runtime"),
    });
    const specHash = hashNormalizedSpec({
      launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
      plan: {
        args: launchPlan.args,
        bindAddr: launchPlan.bindAddr,
        command: launchPlan.command,
        trustedOrigins: launchPlan.trustedOrigins,
        workspacePath: launchPlan.workspacePath,
      },
      profile: normalizeProfileConfig(options.profile),
      systemd: options.systemd ?? null,
    });

    return await startCodeServerSessionInner({
      existing,
      launchPlan,
      options,
      paths,
      sessionKey,
      specHash,
      stateRoot,
    });
  })();
  inflightStarts.set(inflightKey, {
    promise,
    specHash: requestedSpecHash,
  });

  try {
    return await promise;
  } finally {
    inflightStarts.delete(inflightKey);
  }
}

async function startCodeServerSessionInner(context: {
  existing: CodeServerSessionRecord | null;
  launchPlan: Awaited<ReturnType<typeof createCodeServerLaunchPlan>>;
  options: CodeServerSessionRequest;
  paths: ReturnType<typeof getSessionPaths>;
  sessionKey: string;
  specHash: string;
  stateRoot: string;
}): Promise<CodeServerSessionStartResult> {
  const { existing, launchPlan, options, paths, sessionKey, specHash, stateRoot } = context;
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const launchStrategy = options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY;
  const preparation = options.preparation?.mode === "skip"
    ? launchPlan.preparationStatus
    : (await ensureCodeServerPrepared({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
      resolveFrom: options.resolveFrom,
      strictWatchdog: options.preparation?.strictWatchdog,
    })).status;
  const watchdogMode = preparation.watchdogMode;

  await mkdirp(paths.sessionDir);

  log.info("session", "starting code-server session", {
    launchStrategy,
    sessionKey,
    stateRoot,
  });

  if (existing) {
    const status = await probeSessionRecord(existing, options.sanitizer);
    if (existing.specHash === specHash && status.ready) {
      const reused = {
        ...status,
        state: "reusing_existing" as const,
      };
      await writeSessionRecord({
        ...existing,
        health: "ready",
        preparation,
        state: "reusing_existing",
        updatedAt: nowIso(),
      }, paths.recordPath);
      return {
        created: false,
        diagnostics: reused.diagnostics,
        handle: handles.get(sessionKey) ?? null,
        launchPlan,
        launchStrategy,
        reused: true,
        status: reused,
      };
    }

    if (isLiveOrStartingState(status.state)) {
      await stopExistingRuntime(existing, options.profile, undefined, options.logger, options.loggerAdapter);
    }
  }

  await maybeRestoreProfile(options.profile, launchPlan.userDataDir);

  const baseRecord = createBaseRecord({
    lastStartSummary: null,
    launchPlan,
    launchStrategy,
    preparation,
    sessionKey,
    specHash,
    watchdogMode,
  });
  await writeSessionRecord({
    ...baseRecord,
    state: "launching",
    updatedAt: nowIso(),
  }, paths.recordPath);

  try {
    let handle: CodeServerProcessHandle | null = null;
    let journalTail = "";

    if (launchStrategy === "direct") {
      handle = await launchCodeServerProcess({
        plan: launchPlan,
      });
      handles.set(sessionKey, handle);
    } else {
      if (!options.systemd?.scope) {
        throw new CodeServerInvalidConfigurationError(
          "systemd session launches require an explicit scope of 'user' or 'system'.",
          {
            sessionKey,
          },
        );
      }

      await launchCodeServerWithSystemd({
        extraProperties: options.systemd.extraProperties,
        logger: options.logger,
        loggerAdapter: options.loggerAdapter,
        plan: launchPlan,
        scope: options.systemd.scope,
        sessionKey,
        unitName: options.systemd.unitName,
      });
    }

    const ready = await waitForCodeServerReady({
      failureProbe: options.failureProbe,
      host: launchPlan.host,
      port: launchPlan.port,
      process: handle ?? undefined,
      retryIntervalMs: options.readinessRetryIntervalMs ?? DEFAULT_READY_RETRY_INTERVAL_MS,
      timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    });

    if (launchStrategy === "systemd" && options.systemd?.scope) {
      journalTail = await summarizeCodeServerSystemdJournal({
        lines: 50,
        scope: options.systemd.scope,
        unitName: options.systemd.unitName ?? `trebired-code-server-kit-${sessionKey}.service`,
      });
    }

    const normalizedFailure = collectCodeServerStartupDiagnostics({
      journal: journalTail,
      launchStrategy,
      preparationStatus: preparation,
      process: handle,
      sanitizer: options.sanitizer,
      watchdogMode,
    });
    const diagnostics = createDiagnosticsSnapshot({
      handle,
      journalTail,
      normalizedFailure,
      readyElapsedMs: ready.elapsedMs,
    });

    const record = {
      ...baseRecord,
      diagnostics,
      health: "ready" as const,
      lastStartSummary: normalizedFailure.summary,
      pid: handle?.pid ?? null,
      preparation,
      readyAt: nowIso(),
      sanitizedDiagnostics: normalizedFailure.sanitized ?? null,
      startedAt: nowIso(),
      state: "ready" as const,
      systemdScope: options.systemd?.scope ?? null,
      unitName: options.systemd?.unitName ?? null,
      updatedAt: nowIso(),
    };

    await writeSessionRecord(record, paths.recordPath);
    await writeDiagnosticsFile(record, paths);

    return {
      created: true,
      diagnostics: await readCodeServerSessionDiagnostics({
        sessionKey,
        stateRoot,
      }),
      handle,
      launchPlan,
      launchStrategy,
      reused: false,
      status: await probeSessionRecord(record, options.sanitizer),
    };
  } catch (error) {
    const normalized = normalizeCodeServerStartupFailure(error, {
      launchStrategy,
      preparationStatus: preparation,
      sanitizer: options.sanitizer,
      watchdogMode,
    });
    const handle = handles.get(sessionKey) ?? null;
    const failure = {
      code: normalized.code,
      details: normalized.details,
      message: normalized.summary,
      name: normalized.name,
    } satisfies CodeServerSessionFailure;

    if (handle) {
      try {
        handle.kill("SIGTERM");
      } catch {
      }
      handles.delete(sessionKey);
    }

    const record = {
      ...baseRecord,
      diagnostics: createDiagnosticsSnapshot({
        handle,
        journalTail: launchStrategy === "systemd" && options.systemd?.scope && options.systemd.unitName
          ? await safeSystemdSummary(options.systemd.scope, options.systemd.unitName)
          : "",
        normalizedFailure: normalized,
        readyElapsedMs: null,
      }),
      failure,
      health: "failed" as const,
      lastStartSummary: normalized.summary,
      pid: handle?.pid ?? null,
      preparation,
      sanitizedDiagnostics: normalized.sanitized ?? null,
      startedAt: nowIso(),
      state: "failed" as const,
      systemdScope: options.systemd?.scope ?? null,
      unitName: options.systemd?.unitName ?? null,
      updatedAt: nowIso(),
    };

    await writeSessionRecord(record, paths.recordPath);
    await writeDiagnosticsFile(record, paths);

    if (isCodeServerKitError(error)) {
      throw error;
    }

    throw new CodeServerSessionLifecycleError("Could not start the code-server session.", {
      cause: normalized.summary,
      sessionKey,
      stateRoot,
    });
  }
}

async function stopCodeServerSessionInternal(
  options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sanitizer" | "sessionKey" | "stateRoot"> & {
    signal?: NodeJS.Signals | number;
  },
): Promise<CodeServerSessionStopResult | null> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const record = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);
  if (!record) return null;

  log.info("session", "stopping code-server session", {
    launchStrategy: record.launchStrategy,
    sessionKey: options.sessionKey,
  });

  await stopExistingRuntime(record, options.profile, options.signal, options.logger, options.loggerAdapter);
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

  return {
    diagnostics: await readCodeServerSessionDiagnostics({
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
    diagnostics,
    extensionsDir: record.extensionsDir,
    failure: record.failure ?? null,
    health: ready ? "ready" : record.health,
    lastStartSummary: record.lastStartSummary ?? null,
    launchStrategy: record.launchStrategy,
    pid: record.launchStrategy === "direct"
      ? handles.get(record.sessionKey)?.pid ?? record.pid
      : record.pid,
    port: record.port,
    preparation: record.preparation ?? null,
    ready,
    readyAt: ready ? record.readyAt : null,
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
    const status = await readCodeServerSystemdStatus({
      scope: record.systemdScope,
      unitName: record.unitName,
    });
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
  profile: CodeServerProfileLifecycleOptions | undefined,
  signal: NodeJS.Signals | number | undefined,
  logger?: CodeServerSessionRequest["logger"],
  loggerAdapter?: CodeServerSessionRequest["loggerAdapter"],
): Promise<void> {
  if (record.launchStrategy === "systemd" && record.systemdScope && record.unitName) {
    await restartCodeServerSystemdUnit({
      logger,
      loggerAdapter,
      scope: record.systemdScope,
      unitName: record.unitName,
    });
  } else {
    const handle = handles.get(record.sessionKey);
    if (handle) {
      handle.kill(signal ?? "SIGTERM");
      handles.delete(record.sessionKey);
    } else if (record.pid && isPidAlive(record.pid)) {
      process.kill(record.pid, signal ?? "SIGTERM");
    }
  }

  await maybePersistProfile(profile, record.userDataDir);
}

async function maybeRestoreProfile(profile: CodeServerProfileLifecycleOptions | undefined, userDataDir: string): Promise<void> {
  if (!profile?.restoreFrom) return;

  const restorePolicy = profile.restorePolicy ?? "if-missing-or-empty";
  if (restorePolicy === "if-missing-or-empty") {
    const snapshot = await readCodeServerProfileSnapshot({
      items: profile.items,
      pathMap: profile.pathMap,
      rootDir: userDataDir,
      snapshotExtensions: profile.snapshotExtensions,
    });
    if (snapshot.entries.some((entry) => entry.present)) {
      return;
    }
  }

  await syncCodeServerProfile({
    items: profile.items,
    pathMap: profile.pathMap,
    skipMissing: profile.skipMissing,
    skipUnreadable: profile.skipUnreadable,
    sourceDir: profile.restoreFrom,
    targetDir: userDataDir,
  });
}

async function maybePersistProfile(profile: CodeServerProfileLifecycleOptions | undefined, userDataDir: string): Promise<void> {
  if (!profile?.persistTo) return;

  const persistPolicy = profile.persistPolicy ?? "if-changed";
  if (persistPolicy === "always") {
    await syncCodeServerProfile({
      items: profile.items,
      pathMap: profile.pathMap,
      skipMissing: profile.skipMissing,
      skipUnreadable: profile.skipUnreadable,
      sourceDir: userDataDir,
      targetDir: profile.persistTo,
    });
    return;
  }

  await persistCodeServerProfileIfChanged({
    items: profile.items,
    pathMap: profile.pathMap,
    signatureMode: profile.signatureMode,
    skipMissing: profile.skipMissing,
    skipUnreadable: profile.skipUnreadable,
    snapshotExtensions: profile.snapshotExtensions,
    sourceDir: userDataDir,
    targetDir: profile.persistTo,
  });
}

function createBaseRecord(options: {
  lastStartSummary: string | null;
  launchPlan: Awaited<ReturnType<typeof createCodeServerLaunchPlan>>;
  launchStrategy: string;
  preparation: Awaited<ReturnType<typeof ensureCodeServerPrepared>>["status"];
  sessionKey: string;
  specHash: string;
  watchdogMode: CodeServerWatchdogMode;
}): CodeServerSessionRecord {
  return {
    bindAddr: options.launchPlan.bindAddr,
    diagnostics: null,
    extensionsDir: options.launchPlan.extensionsDir,
    health: "starting",
    lastStartSummary: options.lastStartSummary,
    launchStrategy: options.launchStrategy as CodeServerSessionRecord["launchStrategy"],
    pid: null,
    port: options.launchPlan.port,
    preparation: options.preparation,
    readyAt: null,
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
  handle: CodeServerProcessHandle | null;
  journalTail: string;
  normalizedFailure: ReturnType<typeof collectCodeServerStartupDiagnostics>;
  readyElapsedMs: number | null;
}): CodeServerSessionDiagnosticsSnapshot {
  return {
    journalTail: options.journalTail || undefined,
    pid: options.handle?.pid ?? null,
    readyElapsedMs: options.readyElapsedMs,
    stderrTail: options.handle?.getStderr(),
    stdoutTail: options.handle?.getStdout(),
    summary: {
      category: options.normalizedFailure.category,
      details: options.normalizedFailure.details,
      summary: options.normalizedFailure.summary,
      watchdogMode: options.normalizedFailure.watchdogMode,
    },
    updatedAt: nowIso(),
  };
}

async function writeDiagnosticsFile(record: CodeServerSessionRecord, paths: ReturnType<typeof getSessionPaths>): Promise<void> {
  await mkdirp(path.dirname(paths.diagnosticsPath));
  const snapshot = record.diagnostics;
  const diagnostics: CodeServerSessionDiagnostics = {
    diagnosticsPath: paths.diagnosticsPath,
    journalTail: snapshot?.journalTail,
    normalizedFailure: snapshot?.summary
      ? {
        category: String(snapshot.summary.category ?? "unknown") as CodeServerSessionDiagnostics["normalizedFailure"] extends infer T ? never : never,
      } as never
      : null,
    readyElapsedMs: snapshot?.readyElapsedMs ?? null,
    recordPath: paths.recordPath,
    stderrTail: snapshot?.stderrTail,
    stdoutTail: snapshot?.stdoutTail,
    summary: snapshot?.summary ?? {},
    updatedAt: snapshot?.updatedAt ?? nowIso(),
  };
  if (snapshot?.summary) {
    const summary = snapshot.summary as Record<string, unknown>;
    diagnostics.normalizedFailure = {
      category: String(summary.category ?? "unknown") as any,
      code: String(summary.category ?? "unknown"),
      details: (summary.details as Record<string, unknown>) ?? {},
      launchStrategy: record.launchStrategy,
      summary: String(summary.summary ?? ""),
      watchdogMode: record.watchdogMode,
    };
  }
  await fs.promises.writeFile(paths.diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
}

async function writeSessionRecord(record: CodeServerSessionRecord, recordPath: string): Promise<void> {
  await mkdirp(path.dirname(recordPath));
  await fs.promises.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function getSessionPaths(stateRoot: string, sessionKey: string) {
  const normalizedStateRoot = path.resolve(stateRoot);
  const safeKey = normalizeSessionKey(sessionKey);
  const sessionDir = path.join(normalizedStateRoot, "sessions", safeKey);

  return {
    diagnosticsPath: path.join(sessionDir, "diagnostics.json"),
    recordPath: path.join(sessionDir, "session.json"),
    sessionDir,
    stateRoot: normalizedStateRoot,
  };
}

function normalizeSessionKey(value: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new CodeServerInvalidConfigurationError("sessionKey is required for lifecycle-managed code-server APIs.");
  }

  return normalized.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function normalizeProfileConfig(profile: CodeServerProfileLifecycleOptions | undefined) {
  if (!profile) return null;

  return {
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

function hashNormalizedSpec(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
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
    return await summarizeCodeServerSystemdJournal({
      scope,
      unitName,
    });
  } catch {
    return "";
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function canConnect(bindAddr: string, port: number): Promise<boolean> {
  const host = extractHost(bindAddr);
  return await new Promise((resolve) => {
    const socket = net.connect({
      host,
      port,
    });
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function extractHost(bindAddr: string): string {
  if (bindAddr.startsWith("[")) {
    const end = bindAddr.indexOf("]");
    return bindAddr.slice(1, end);
  }

  return bindAddr.slice(0, bindAddr.lastIndexOf(":"));
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const contents = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(contents) as T;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && String(error.code) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function mkdirp(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptyStopResult(sessionKey: string): CodeServerSessionStopResult {
  return {
    diagnostics: null,
    status: {
      bindAddr: "",
      diagnostics: null,
      extensionsDir: "",
      failure: null,
      health: "stopped",
      lastStartSummary: null,
      launchStrategy: "direct",
      pid: null,
      port: 0,
      preparation: null,
      ready: false,
      readyAt: null,
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

export {
  createCodeServerSessionManager,
  getCodeServerSessionStatus,
  readCodeServerSessionDiagnostics,
  restartCodeServerSession,
  startCodeServerSession,
  stopCodeServerSession,
};
