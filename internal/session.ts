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
  normalizeCodeServerStartupFailure,
  sanitizeCodeServerDiagnostics,
} from "./diagnostics.js";
import { summarizeCodeServerBrowserDiagnostics } from "./browser/index.js";
import { launchCodeServerProcess } from "./launch.js";
import { logPackageInitialized, resolveLogger } from "./logging.js";
import { createCodeServerLaunchPlan } from "./plan.js";
import { createCodeServerProfilePolicy } from "./profile-policy.js";
import { createReadonlySessionPolicy } from "./readonly.js";
import { ensureCodeServerPrepared } from "./preparation.js";
import { waitForCodeServerReady } from "./readiness.js";
import {
  launchCodeServerWithSystemd,
  readCodeServerSystemdStatus,
  stopCodeServerSystemdUnit,
  summarizeCodeServerSystemdJournal,
} from "./systemd.js";
import type {
  CodeServerProcessHandle,
  CodeServerProfileLifecycleOptions,
  CodeServerProfilePolicy,
  CodeServerReadyResult,
  CodeServerSanitizerOptions,
  CodeServerSessionBackendCheckpoint,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionBrowserOptions,
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
        sanitizer: input.sanitizer,
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
        browser: mergeSessionBrowserOptions(options.browser, input.browser),
        installation: input.installation ?? options.installation,
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        profile: input.profile ?? options.profile,
        readonly: input.readonly ?? options.readonly,
        resolveFrom: input.resolveFrom ?? options.resolveFrom,
      });
    },
    async stop(input) {
      return await stopCodeServerSessionInternal({
        ...input,
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        profile: input.profile ?? options.profile,
      });
    },
  };
}

async function startCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  const manager = createCodeServerSessionManager({
    browser: options.browser,
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    profile: options.profile,
    readonly: options.readonly,
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
    profile: options.profile,
  }).stop(options);
}

async function restartCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult> {
  return await createCodeServerSessionManager({
    browser: options.browser,
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    profile: options.profile,
    readonly: options.readonly,
    resolveFrom: options.resolveFrom,
  }).restart(options);
}

async function startSession(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  return await startCodeServerSession(options);
}

async function stopSession(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sanitizer" | "sessionKey" | "stateRoot"> & {
  signal?: NodeJS.Signals | number;
}): Promise<CodeServerSessionStopResult | null> {
  return await stopCodeServerSession(options);
}

async function reuseSession(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  return await startCodeServerSession(options);
}

async function inspectSessionFailure(
  options: Pick<CodeServerSessionRequest, "sanitizer" | "sessionKey" | "stateRoot">,
): Promise<CodeServerSessionDiagnostics["normalizedFailure"] | null> {
  const diagnostics = await readCodeServerSessionDiagnostics(options);
  return diagnostics?.normalizedFailure ?? null;
}

async function getCodeServerSessionStatus(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionStatus | null> {
  return await createCodeServerSessionManager({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
  }).getStatus(options);
}

async function readCodeServerSessionDiagnostics(options: Pick<CodeServerSessionRequest, "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const diagnostics = await readJsonFile<CodeServerSessionDiagnostics>(paths.diagnosticsPath);
  if (!diagnostics) {
    return null;
  }

  if (options.sanitizer && diagnostics.normalizedFailure) {
    diagnostics.sanitized = sanitizeCodeServerDiagnostics(diagnostics.normalizedFailure, options.sanitizer);
  }

  return diagnostics;
}

async function startCodeServerSessionInternal(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  const sessionKey = normalizeSessionKey(options.sessionKey);
  const stateRoot = path.resolve(options.stateRoot);
  const readonlyPolicy = createReadonlySessionPolicy(options.readonly);
  const browserOptions = normalizeSessionBrowserOptions(options.browser);
  const requestedSpecHash = hashNormalizedSpec({
    browser: browserOptions?.policy ?? null,
    launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
    env: options.env ?? {},
    host: options.host ?? null,
    port: options.port ?? null,
    readinessTarget: options.readinessTarget ?? null,
    readonly: readonlyPolicy,
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
      browser: browserOptions ?? undefined,
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
        readonly: launchPlan.readonly,
        readinessTarget: options.readinessTarget ?? null,
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
  const browser = normalizeSessionBrowserOptions(options.browser);
  const browserBridge = browser?.bridge;
  const readinessTarget = options.readinessTarget ?? (browserBridge ? "browser-shell" : "http");
  const preparation = options.preparation?.mode === "skip"
    ? launchPlan.preparationStatus
    : (await ensureCodeServerPrepared({
      logger: options.logger,
      loggerAdapter: options.loggerAdapter,
      resolveFrom: options.resolveFrom,
      strictWatchdog: options.preparation?.strictWatchdog,
    })).status;
  const watchdogMode = preparation.watchdogMode;
  const profilePolicy = resolveProfilePolicy(options.profile, launchPlan.readonly);
  const backendCheckpoints: CodeServerSessionBackendCheckpoint[] = [];
  const correlationId = createSessionCorrelationId(sessionKey, specHash);

  await mkdirp(paths.sessionDir);
  pushBackendCheckpoint(backendCheckpoints, "session", "planned code-server session launch", {
    correlationId,
    launchStrategy,
    readinessTarget,
    sessionKey,
    stateRoot,
    userDataDir: launchPlan.userDataDir,
    workspacePath: launchPlan.workspacePath,
  });

  log.info("launch:planned", "planned code-server session launch", {
    correlationId,
    launchStrategy,
    readinessTarget,
    sessionKey,
    stateRoot,
    userDataDir: launchPlan.userDataDir,
    workspacePath: launchPlan.workspacePath,
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
        browserSummary: summarizeCodeServerBrowserDiagnostics(browserBridge?.getEvents() ?? existing.diagnostics?.browserEvents ?? []),
        correlationId,
        health: "ready",
        metadata: options.metadata ?? existing.metadata ?? null,
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
        readiness: null,
        reused: true,
        status: reused,
      };
    }

    if (isLiveOrStartingState(status.state)) {
      await stopExistingRuntime(existing, profilePolicy, undefined, options.logger, options.loggerAdapter);
    }
  }

  if (profilePolicy) {
    const preparedProfile = await profilePolicy.prepareRuntimeProfile(launchPlan.userDataDir);
    pushBackendCheckpoint(backendCheckpoints, "profile", "prepared runtime profile", {
      persistTarget: preparedProfile.persistTarget,
      restored: preparedProfile.restore.restored,
      runtimeDir: preparedProfile.runtimeDir,
      settingsPatched: preparedProfile.restore.settingsPatched,
      skippedRestore: preparedProfile.restore.skipped,
    });
  }

  const baseRecord = createBaseRecord({
    browserSummary: summarizeCodeServerBrowserDiagnostics(browserBridge?.getEvents() ?? []),
    correlationId,
    lastStartSummary: null,
    launchPlan,
    launchStrategy,
    metadata: options.metadata ?? null,
    preparation,
    readinessTarget,
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
    let readiness: CodeServerReadyResult | null = null;

    if (launchStrategy === "direct") {
      handle = await launchCodeServerProcess({
        plan: launchPlan,
      });
      handles.set(sessionKey, handle);
      pushBackendCheckpoint(backendCheckpoints, "launch", "spawned direct code-server process", {
        args: launchPlan.args,
        command: launchPlan.command,
        pid: handle.pid ?? null,
      });
      log.info("launch:spawned", "spawned code-server process", {
        args: launchPlan.args,
        command: launchPlan.command,
        pid: handle.pid ?? null,
      });
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
      pushBackendCheckpoint(backendCheckpoints, "launch", "spawned code-server systemd unit", {
        scope: options.systemd.scope,
        unitName: options.systemd.unitName ?? `trebired-code-server-kit-${sessionKey}.service`,
      });
      log.info("launch:spawned", "spawned code-server systemd unit", {
        scope: options.systemd.scope,
        unitName: options.systemd.unitName ?? `trebired-code-server-kit-${sessionKey}.service`,
      });
    }

    if (readinessTarget === "browser-shell" || readinessTarget === "workbench") {
      log.info("browser:bootstrap:start", "waiting for browser diagnostics readiness", {
        readinessTarget,
        sessionKey,
      });
    }

    readiness = await waitForCodeServerReady({
      browser: {
        bridge: browserBridge,
        timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      },
      failureProbe: options.failureProbe,
      host: launchPlan.host,
      httpUrl: `http://${formatReadyHost(launchPlan.host)}:${launchPlan.port}/`,
      port: launchPlan.port,
      process: handle ?? undefined,
      retryIntervalMs: options.readinessRetryIntervalMs ?? DEFAULT_READY_RETRY_INTERVAL_MS,
      target: readinessTarget,
      timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
      websocketUrl: options.websocketUrl,
    });

    for (const checkpoint of readiness.checkpoints) {
      pushBackendCheckpoint(backendCheckpoints, checkpoint.phase, `reached ${checkpoint.target} readiness`, checkpoint.details);
      if (checkpoint.target === "http") {
        log.info("ready:http", "code-server HTTP shell is ready", checkpoint.details);
      } else if (checkpoint.target === "websocket") {
        log.info("ready:websocket", "code-server websocket is ready", checkpoint.details);
      } else if (checkpoint.target === "workbench") {
        log.info("ready:workbench", "code-server workbench is ready", checkpoint.details);
      }
    }

    if (launchStrategy === "systemd" && options.systemd?.scope) {
      journalTail = await summarizeCodeServerSystemdJournal({
        lines: 50,
        scope: options.systemd.scope,
        unitName: options.systemd.unitName ?? `trebired-code-server-kit-${sessionKey}.service`,
      });
    }

    if (profilePolicy) {
      const finalizedProfile = await profilePolicy.restoreRuntimeProfile(launchPlan.userDataDir);
      if (finalizedProfile.settingsPatched) {
        pushBackendCheckpoint(backendCheckpoints, "profile", "reapplied runtime profile settings after launch", {
          restored: finalizedProfile.restored,
          runtimeDir: finalizedProfile.runtimeDir,
          settingsPatched: finalizedProfile.settingsPatched,
          skippedRestore: finalizedProfile.skipped,
        });
      }
    }
    const browserEvents = browserBridge?.getEvents() ?? [];
    const browserSummary = summarizeCodeServerBrowserDiagnostics(browserEvents);

    const diagnostics = createDiagnosticsSnapshot({
      backendCheckpoints,
      browserEvents,
      browserSummary,
      correlationId,
      handle,
      journalTail,
      normalizedFailure: null,
      readyElapsedMs: readiness.elapsedMs,
      summary: {
        browserSummary,
        checkpoints: readiness.checkpoints,
        correlationId,
        launchStrategy,
        profile: profilePolicy?.describe() ?? null,
        readinessTarget,
      },
    });

    const record = {
      ...baseRecord,
      browserSummary,
      correlationId,
      diagnostics,
      health: "ready" as const,
      lastStartSummary: `Reached ${readinessTarget} readiness.`,
      metadata: options.metadata ?? null,
      pid: handle?.pid ?? null,
      preparation,
      readyAt: nowIso(),
      readinessTarget,
      sanitizedDiagnostics: null,
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
        sanitizer: options.sanitizer,
        sessionKey,
        stateRoot,
      }),
      handle,
      launchPlan,
      launchStrategy,
      readiness,
      reused: false,
      status: await probeSessionRecord(record, options.sanitizer),
    };
  } catch (error) {
    const normalized = normalizeCodeServerStartupFailure(error, {
      browserEvents: browserBridge?.getEvents() ?? [],
      checkpoints: [],
      launchStrategy,
      preparationStatus: preparation,
      sanitizer: options.sanitizer,
      watchdogMode,
    });
    const handle = handles.get(sessionKey) ?? null;
    const failure = {
      code: normalized.code,
      details: normalized.details,
      hints: normalized.hints,
      message: normalized.summary,
      name: normalized.name,
      phase: normalized.phase,
      retryable: normalized.retryable,
    } satisfies CodeServerSessionFailure;

    if (handle) {
      await terminateHandle(handle, "SIGTERM");
      handles.delete(sessionKey);
    }

    const record = {
      ...baseRecord,
      browserSummary: summarizeCodeServerBrowserDiagnostics(browserBridge?.getEvents() ?? []),
      correlationId,
      diagnostics: createDiagnosticsSnapshot({
        backendCheckpoints,
        browserEvents: browserBridge?.getEvents() ?? [],
        browserSummary: summarizeCodeServerBrowserDiagnostics(browserBridge?.getEvents() ?? []),
        correlationId,
        handle,
        journalTail: launchStrategy === "systemd" && options.systemd?.scope && options.systemd.unitName
          ? await safeSystemdSummary(options.systemd.scope, options.systemd.unitName)
          : "",
        normalizedFailure: normalized,
        readyElapsedMs: null,
        summary: {
          correlationId,
          launchStrategy,
          profile: profilePolicy?.describe() ?? null,
          readinessTarget,
        },
      }),
      failure,
      health: "failed" as const,
      lastStartSummary: normalized.summary,
      pid: handle?.pid ?? null,
      preparation,
      readinessTarget,
      sanitizedDiagnostics: normalized.sanitized ?? null,
      startedAt: nowIso(),
      state: "failed" as const,
      systemdScope: options.systemd?.scope ?? null,
      unitName: options.systemd?.unitName ?? null,
      updatedAt: nowIso(),
    };

    await writeSessionRecord(record, paths.recordPath);
    await writeDiagnosticsFile(record, paths);

    log.error(`fail:${normalized.phase}`, normalized.summary, {
      code: normalized.code,
      details: normalized.details,
      retryable: normalized.retryable,
    });

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

  log.info("session:stop", "stopping code-server session", {
    launchStrategy: record.launchStrategy,
    sessionKey: options.sessionKey,
  });

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
    pid: record.launchStrategy === "direct"
      ? handles.get(record.sessionKey)?.pid ?? record.pid
      : record.pid,
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
  profile: CodeServerProfilePolicy | null,
  signal: NodeJS.Signals | number | undefined,
  logger?: CodeServerSessionRequest["logger"],
  loggerAdapter?: CodeServerSessionRequest["loggerAdapter"],
): Promise<void> {
  if (record.launchStrategy === "systemd" && record.systemdScope && record.unitName) {
    await stopCodeServerSystemdUnit({
      logger,
      loggerAdapter,
      scope: record.systemdScope,
      unitName: record.unitName,
    });
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

function createBaseRecord(options: {
  browserSummary: CodeServerSessionRecord["browserSummary"];
  correlationId: string;
  lastStartSummary: string | null;
  launchPlan: Awaited<ReturnType<typeof createCodeServerLaunchPlan>>;
  launchStrategy: string;
  metadata: Record<string, unknown> | null;
  preparation: Awaited<ReturnType<typeof ensureCodeServerPrepared>>["status"];
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
    launchStrategy: options.launchStrategy as CodeServerSessionRecord["launchStrategy"],
    metadata: options.metadata,
    pid: null,
    port: options.launchPlan.port,
    preparation: options.preparation,
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

async function writeDiagnosticsFile(record: CodeServerSessionRecord, paths: ReturnType<typeof getSessionPaths>): Promise<void> {
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
  if (!defaults && !overrides) {
    return undefined;
  }

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
  if (!options) {
    return null;
  }

  const integration = options.integration;
  const bridge = options.bridge ?? integration?.bridge;
  const hasPolicy = Boolean(options.policy && Object.keys(options.policy).length > 0);
  if (!bridge && !integration && !hasPolicy) {
    return null;
  }

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
    return Object.keys(readonly.settingsPatch).length > 0
      ? createCodeServerProfilePolicy({
        readonly,
      })
      : null;
  }

  if (isProfilePolicy(profile)) {
    return profile;
  }

  return createCodeServerProfilePolicy({
    ...profile,
    readonly,
  });
}

function isProfilePolicy(value: unknown): value is CodeServerProfilePolicy {
  return Boolean(value)
    && typeof value === "object"
    && "prepareRuntimeProfile" in value
    && typeof (value as CodeServerProfilePolicy).prepareRuntimeProfile === "function";
}

function createSessionCorrelationId(sessionKey: string, specHash: string): string {
  return createHash("sha256")
    .update(`${sessionKey}:${specHash}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
}

function pushBackendCheckpoint(
  checkpoints: CodeServerSessionBackendCheckpoint[],
  phase: CodeServerSessionBackendCheckpoint["phase"],
  summary: string,
  details: Record<string, unknown>,
): void {
  checkpoints.push({
    details,
    phase,
    summary,
    timestamp: nowIso(),
  });
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

function formatReadyHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
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

async function terminateHandle(
  handle: CodeServerProcessHandle,
  signal: NodeJS.Signals | number,
): Promise<void> {
  try {
    handle.kill(signal);
    await Promise.race([
      handle.exit,
      sleep(1_000),
    ]);
  } catch {
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function nowIso(): string {
  return new Date().toISOString();
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

export {
  createCodeServerSessionManager,
  getCodeServerSessionStatus,
  inspectSessionFailure,
  readCodeServerSessionDiagnostics,
  restartCodeServerSession,
  reuseSession,
  startSession,
  startCodeServerSession,
  stopSession,
  stopCodeServerSession,
};
