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
import { launchCodeServerProcess } from "./launch.js";
import { logPackageInitialized, resolveLogger } from "./logging.js";
import { createCodeServerLaunchPlan } from "./plan.js";
import { createReadonlySessionPolicy } from "./readonly.js";
import { ensureCodeServerPrepared } from "./preparation.js";
import {
  persistCodeServerProfileIfChanged,
  readCodeServerProfileSnapshot,
  syncCodeServerProfile,
} from "./profile.js";
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
  CodeServerReadyResult,
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
  const requestedSpecHash = hashNormalizedSpec({
    browser: options.browser?.policy ?? null,
    launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
    env: options.env ?? {},
    host: options.host ?? null,
    port: options.port ?? null,
    readinessTarget: options.readinessTarget ?? null,
    readonly: createReadonlySessionPolicy(options.readonly),
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
  const readinessTarget = options.readinessTarget ?? (options.browser?.bridge ? "browser-shell" : "http");
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

  log.info("launch:planned", "planned code-server session launch", {
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
        readiness: null,
        reused: true,
        status: reused,
      };
    }

    if (isLiveOrStartingState(status.state)) {
      await stopExistingRuntime(existing, options.profile, undefined, options.logger, options.loggerAdapter);
    }
  }

  await maybeRestoreProfile(options.profile, launchPlan.userDataDir);
  await maybeSeedReadonlyProfile(launchPlan.userDataDir, launchPlan.readonly);

  const baseRecord = createBaseRecord({
    lastStartSummary: null,
    launchPlan,
    launchStrategy,
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
        bridge: options.browser?.bridge,
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

    await maybeSeedReadonlyProfile(launchPlan.userDataDir, launchPlan.readonly);

    const diagnostics = createDiagnosticsSnapshot({
      browserEvents: options.browser?.bridge?.getEvents() ?? [],
      handle,
      journalTail,
      normalizedFailure: null,
      readyElapsedMs: readiness.elapsedMs,
      summary: {
        checkpoints: readiness.checkpoints,
        readinessTarget,
      },
    });

    const record = {
      ...baseRecord,
      diagnostics,
      health: "ready" as const,
      lastStartSummary: `Reached ${readinessTarget} readiness.`,
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
      browserEvents: options.browser?.bridge?.getEvents() ?? [],
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
      diagnostics: createDiagnosticsSnapshot({
        browserEvents: options.browser?.bridge?.getEvents() ?? [],
        handle,
        journalTail: launchStrategy === "systemd" && options.systemd?.scope && options.systemd.unitName
          ? await safeSystemdSummary(options.systemd.scope, options.systemd.unitName)
          : "",
        normalizedFailure: normalized,
        readyElapsedMs: null,
        summary: {
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
  profile: CodeServerProfileLifecycleOptions | undefined,
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

async function maybeSeedReadonlyProfile(
  userDataDir: string,
  readonly = createReadonlySessionPolicy(false),
): Promise<void> {
  if (!readonly.enabled || Object.keys(readonly.settingsPatch).length === 0) {
    return;
  }

  const settingsPath = path.join(userDataDir, "User", "settings.json");
  await mkdirp(path.dirname(settingsPath));
  let current: Record<string, unknown> = {};

  try {
    current = JSON.parse(await fs.promises.readFile(settingsPath, "utf8")) as Record<string, unknown>;
  } catch {
  }

  const next = {
    ...current,
    ...readonly.settingsPatch,
  };
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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
  readinessTarget: CodeServerSessionRecord["readinessTarget"];
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
  browserEvents: NonNullable<CodeServerSessionDiagnostics["browserEvents"]>;
  handle: CodeServerProcessHandle | null;
  journalTail: string;
  normalizedFailure: CodeServerSessionDiagnostics["normalizedFailure"];
  readyElapsedMs: number | null;
  summary: Record<string, unknown>;
}): CodeServerSessionDiagnosticsSnapshot {
  return {
    browserEvents: options.browserEvents,
    journalTail: options.journalTail || undefined,
    normalizedFailure: options.normalizedFailure ?? null,
    pid: options.handle?.pid ?? null,
    readyElapsedMs: options.readyElapsedMs,
    stderrTail: options.handle?.getStderr(),
    stdoutTail: options.handle?.getStdout(),
    summary: options.summary,
    updatedAt: nowIso(),
  };
}

async function writeDiagnosticsFile(record: CodeServerSessionRecord, paths: ReturnType<typeof getSessionPaths>): Promise<void> {
  await mkdirp(path.dirname(paths.diagnosticsPath));
  const snapshot = record.diagnostics;
  const diagnostics: CodeServerSessionDiagnostics = {
    browserEvents: snapshot?.browserEvents,
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
