import fs from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import path from "node:path";

import {
  CodeServerInvalidConfigurationError,
  CodeServerSessionLifecycleError,
  CodeServerSessionReuseConflictError,
  CodeServerSystemdCollisionError,
  isCodeServerKitError,
} from "./errors.js";
import { launchCodeServerProcess } from "./launch.js";
import { logPackageInitialized, resolveLogger } from "./logging.js";
import { createCodeServerLaunchPlan } from "./plan.js";
import { syncCodeServerProfile } from "./profile.js";
import { waitForCodeServerReady } from "./readiness.js";
import { normalizeCodeServerStartupFailure } from "./spec.js";
import {
  buildDefaultCodeServerUnitName,
  createCodeServerSystemdLaunchCommand,
  launchCodeServerWithSystemd,
  readCodeServerSystemdJournal,
  readCodeServerSystemdStatus,
  stopCodeServerSystemdUnit,
} from "./systemd.js";
import type {
  CodeServerLaunchPlan,
  CodeServerLaunchStrategy,
  CodeServerProcessHandle,
  CodeServerProfileLifecycleOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionFailure,
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
  CodeServerSystemdStatus,
} from "./types.js";

const DEFAULT_LAUNCH_STRATEGY: CodeServerLaunchStrategy = "direct";
const DEFAULT_READY_RETRY_INTERVAL_MS = 100;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_TAIL_LENGTH = 8_192;

function createCodeServerSessionManager(options: CodeServerSessionManagerOptions = {}): CodeServerSessionManager {
  const handles = new Map<string, CodeServerProcessHandle>();
  const log = resolveLogger(options.logger, options.loggerAdapter);

  logPackageInitialized({
    adapter: options.loggerAdapter,
    logger: options.logger,
    source: "@trebired/code-server-kit",
  });

  return {
    async getStatus(input) {
      const request = {
        logger: input.logger ?? options.logger,
        loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        sessionKey: input.sessionKey,
        stateRoot: input.stateRoot,
      };

      return await getCodeServerSessionStatusInternal(request, handles);
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
        sessionKey: input.sessionKey,
        signal: "SIGTERM",
        stateRoot: input.stateRoot,
      }) ?? {
        diagnostics: null,
        status: createStoppedPlaceholderStatus(input),
        stopped: false,
      };
      const start = await this.start(input);
      return {
        start,
        stop,
      } satisfies CodeServerSessionRestartResult;
    },
    async start(input) {
      return await startCodeServerSessionInternal(
        {
          ...input,
          installation: input.installation ?? options.installation,
          logger: input.logger ?? options.logger,
          loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
          resolveFrom: input.resolveFrom ?? options.resolveFrom,
        },
        handles,
      );
    },
    async stop(input) {
      return await stopCodeServerSessionInternal(
        {
          ...input,
          logger: input.logger ?? options.logger,
          loggerAdapter: input.loggerAdapter ?? options.loggerAdapter,
        },
        handles,
      );
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

async function stopCodeServerSession(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sessionKey" | "stateRoot"> & {
  signal?: NodeJS.Signals | number;
}): Promise<CodeServerSessionStopResult | null> {
  const manager = createCodeServerSessionManager({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
  });

  return await manager.stop(options);
}

async function restartCodeServerSession(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult> {
  const manager = createCodeServerSessionManager({
    installation: options.installation,
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
  });

  return await manager.restart(options);
}

async function getCodeServerSessionStatus(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionStatus | null> {
  const manager = createCodeServerSessionManager({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
  });

  return await manager.getStatus(options);
}

async function readCodeServerSessionDiagnostics(options: Pick<CodeServerSessionRequest, "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null> {
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const diagnostics = await readJsonFile<CodeServerSessionDiagnostics>(paths.diagnosticsPath);
  return diagnostics ?? null;
}

async function startCodeServerSessionInternal(
  options: CodeServerSessionRequest,
  handles: Map<string, CodeServerProcessHandle>,
): Promise<CodeServerSessionStartResult> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const basePaths = getSessionPaths(options.stateRoot, options.sessionKey);
  const existing = await readJsonFile<CodeServerSessionRecord>(basePaths.recordPath);
  const context = await prepareSessionContext(options, existing);

  log.info("session", "starting code-server session", {
    launchStrategy: context.launchStrategy,
    sessionKey: options.sessionKey,
    stateRoot: context.stateRoot,
  });

  await mkdirp(context.paths.sessionDir);
  await maybeRestoreProfile(options.profile, context.plan.userDataDir);

  if (existing) {
    const liveStatus = await probeSessionRecord(existing, handles, context.paths);
    if (existing.specHash === context.specHash && liveStatus.ready) {
      const reused = {
        ...liveStatus,
        state: "reusing_existing" as const,
      };
      await writeSessionRecord({
        ...existing,
        diagnostics: existing.diagnostics,
        state: "reusing_existing",
        updatedAt: nowIso(),
      }, context.paths.recordPath);
      log.info("session", "reusing existing code-server session", {
        port: reused.port,
        sessionKey: reused.sessionKey,
      });
      return {
        created: false,
        diagnostics: reused.diagnostics,
        handle: handles.get(options.sessionKey) ?? null,
        launchPlan: context.plan,
        launchStrategy: context.launchStrategy,
        reused: true,
        status: reused,
      };
    }

    if (existing.specHash !== context.specHash && isLiveState(liveStatus.state)) {
      await stopExistingRuntime(existing, options.profile, handles, options.logger, options.loggerAdapter);
      await writeSessionRecord({
        ...existing,
        state: "stale",
        stoppedAt: nowIso(),
        updatedAt: nowIso(),
      }, context.paths.recordPath);
    } else if (!liveStatus.ready && isLiveState(existing.state)) {
      await writeSessionRecord({
        ...existing,
        state: "stale",
        stoppedAt: nowIso(),
        updatedAt: nowIso(),
      }, context.paths.recordPath);
    }
  }

  const baseRecord = createBaseRecord(context);
  await writeSessionRecord({
    ...baseRecord,
    state: "launching",
  }, context.paths.recordPath);

  try {
    const launched = context.launchStrategy === "direct"
      ? await startDirectSession(context, handles)
      : await startSystemdSession(context, existing);

    const ready = await waitForCodeServerReady({
      failureProbe: launched.failureProbe,
      host: context.plan.host,
      port: context.plan.port,
      process: launched.handle ?? undefined,
      retryIntervalMs: options.readinessRetryIntervalMs ?? DEFAULT_READY_RETRY_INTERVAL_MS,
      timeoutMs: options.readinessTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
    });

    const diagnostics = await buildDiagnosticsSnapshot(context, launched.handle, ready.elapsedMs, launched.systemdStatus);
    const record = {
      ...baseRecord,
      diagnostics,
      pid: launched.handle?.pid ?? launched.systemdStatus?.execMainPid ?? null,
      readyAt: nowIso(),
      startedAt: nowIso(),
      state: "ready" as const,
      unitName: launched.unitName,
      updatedAt: nowIso(),
    };

    await writeSessionRecord(record, context.paths.recordPath);
    await writeDiagnosticsFile(diagnostics, context.paths);

    const status = await recordToStatus(record, context.paths, handles);
    return {
      created: true,
      diagnostics: status.diagnostics,
      handle: launched.handle,
      launchPlan: context.plan,
      launchStrategy: context.launchStrategy,
      reused: false,
      status,
    };
  } catch (error) {
    const normalized = normalizeCodeServerStartupFailure(error);
    const failure = {
      code: normalized.code ?? "session_start_failed",
      details: normalized.details,
      message: normalized.message,
      name: normalized.name,
    } satisfies CodeServerSessionFailure;

    if (context.launchStrategy === "systemd" && context.systemdScope && context.unitName) {
      try {
        await stopCodeServerSystemdUnit({
          logger: options.logger,
          loggerAdapter: options.loggerAdapter,
          resetFailed: true,
          scope: context.systemdScope,
          unitName: context.unitName,
        });
      } catch {
      }
    }

    const handle = handles.get(options.sessionKey);
    if (handle) {
      try {
        handle.kill("SIGTERM");
      } catch {
      }
      handles.delete(options.sessionKey);
    }

    const diagnostics = await buildFailureDiagnostics(context, handles.get(options.sessionKey) ?? null);
    const record = {
      ...baseRecord,
      diagnostics,
      failure,
      pid: diagnostics.pid ?? null,
      startedAt: nowIso(),
      state: "failed" as const,
      unitName: context.unitName,
      updatedAt: nowIso(),
    };

    await writeSessionRecord(record, context.paths.recordPath);
    await writeDiagnosticsFile(diagnostics, context.paths);

    log.fail("session", "code-server session failed to start", {
      code: failure.code,
      message: failure.message,
      sessionKey: options.sessionKey,
    });

    if (isCodeServerKitError(error)) {
      throw error;
    }

    throw new CodeServerSessionLifecycleError("Could not start the code-server session.", {
      cause: normalized.message,
      sessionKey: options.sessionKey,
      stateRoot: options.stateRoot,
    });
  }
}

async function stopCodeServerSessionInternal(
  options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sessionKey" | "stateRoot"> & {
    signal?: NodeJS.Signals | number;
  },
  handles: Map<string, CodeServerProcessHandle>,
): Promise<CodeServerSessionStopResult | null> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const record = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);

  if (!record) return null;

  log.info("session", "stopping code-server session", {
    launchStrategy: record.launchStrategy,
    sessionKey: options.sessionKey,
  });

  await stopExistingRuntime(record, options.profile, handles, options.logger, options.loggerAdapter, options.signal);
  const diagnostics = await buildStopDiagnostics(record, handles, paths);
  const stoppedRecord = {
    ...record,
    diagnostics,
    pid: null,
    state: "stopped" as const,
    stoppedAt: nowIso(),
    updatedAt: nowIso(),
  };

  await writeSessionRecord(stoppedRecord, paths.recordPath);
  await writeDiagnosticsFile(diagnostics, paths);

  const status = await recordToStatus(stoppedRecord, paths, handles);
  return {
    diagnostics: status.diagnostics,
    signal: options.signal,
    status,
    stopped: true,
  };
}

async function getCodeServerSessionStatusInternal(
  options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sessionKey" | "stateRoot">,
  handles: Map<string, CodeServerProcessHandle>,
): Promise<CodeServerSessionStatus | null> {
  const log = resolveLogger(options.logger, options.loggerAdapter);
  const paths = getSessionPaths(options.stateRoot, options.sessionKey);
  const record = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);

  if (!record) return null;

  const status = await probeSessionRecord(record, handles, paths);
  log.info("session", "read code-server session status", {
    ready: status.ready,
    sessionKey: options.sessionKey,
    state: status.state,
  });

  return status;
}

async function prepareSessionContext(
  options: CodeServerSessionRequest,
  existing?: CodeServerSessionRecord | null,
) {
  const sessionKey = normalizeSessionKey(options.sessionKey);
  const stateRoot = path.resolve(options.stateRoot);
  const paths = getSessionPaths(stateRoot, sessionKey);
  const launchStrategy = options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY;
  const dataRoot = options.dataRoot
    ? path.resolve(options.dataRoot)
    : path.join(paths.sessionDir, "runtime");
  const existingHost = existing?.bindAddr ? extractHost(existing.bindAddr) : undefined;
  const plan = await createCodeServerLaunchPlan({
    ...options,
    dataRoot,
    host: options.bindAddr ? undefined : (options.host ?? existingHost),
    port: options.bindAddr ? undefined : (options.port ?? existing?.port),
  });
  const systemdScope = launchStrategy === "systemd"
    ? options.systemd?.scope ?? null
    : null;

  if (launchStrategy === "systemd" && !systemdScope) {
    throw new CodeServerInvalidConfigurationError(
      "systemd session launches require an explicit scope of 'user' or 'system'.",
      {
        launchStrategy,
        sessionKey,
      },
    );
  }

  const unitName = launchStrategy === "systemd"
    ? options.systemd?.unitName ?? buildDefaultCodeServerUnitName(sessionKey)
    : null;
  const specHash = hashNormalizedSpec({
    env: sortEnv({
      ...plan.env,
    }),
    launchStrategy,
    plan: {
      args: plan.args,
      bindAddr: plan.bindAddr,
      command: plan.command,
      cwd: plan.cwd,
      extensionsDir: plan.extensionsDir,
      trustedOrigins: plan.trustedOrigins,
      userDataDir: plan.userDataDir,
      workspacePath: plan.workspacePath,
    },
    profile: normalizeProfileConfig(options.profile),
    systemd: launchStrategy === "systemd"
      ? {
        extraProperties: options.systemd?.extraProperties ?? [],
        scope: systemdScope,
        unitName,
      }
      : null,
  });

  return {
    launchStrategy,
    paths,
    plan,
    sessionKey,
    specHash,
    stateRoot,
    systemdScope,
    unitName,
  };
}

async function startDirectSession(
  context: Awaited<ReturnType<typeof prepareSessionContext>>,
  handles: Map<string, CodeServerProcessHandle>,
): Promise<{
  failureProbe: CodeServerSessionRequest["failureProbe"];
  handle: CodeServerProcessHandle;
  systemdStatus: null;
  unitName: null;
}> {
  const stdoutTail = createTailBuffer();
  const stderrTail = createTailBuffer();
  const handle = await launchCodeServerProcess({
    plan: context.plan,
    stderr(text) {
      stderrTail.push(text);
    },
    stdout(text) {
      stdoutTail.push(text);
    },
  });

  handles.set(context.sessionKey, handle);

  return {
    failureProbe: null,
    handle: decorateHandleWithTails(handle, stdoutTail, stderrTail),
    systemdStatus: null,
    unitName: null,
  };
}

async function startSystemdSession(
  context: Awaited<ReturnType<typeof prepareSessionContext>>,
  existing: CodeServerSessionRecord | null,
): Promise<{
  failureProbe: NonNullable<CodeServerSessionRequest["failureProbe"]>;
  handle: null;
  systemdStatus: CodeServerSystemdStatus | null;
  unitName: string;
}> {
  const scope = context.systemdScope as CodeServerSystemdScope;
  const unitName = context.unitName as string;
  const statusBefore = await safeReadSystemdStatus(scope, unitName);

  if (statusBefore && !statusBefore.notFound) {
    if (existing?.specHash === context.specHash && statusBefore.reusable) {
      return {
        failureProbe: createSystemdFailureProbe(scope, unitName),
        handle: null,
        systemdStatus: statusBefore,
        unitName,
      };
    }

    await stopCodeServerSystemdUnit({
      resetFailed: true,
      scope,
      unitName,
    });
  }

  await launchCodeServerWithSystemd({
    extraProperties: context.plan.workspacePath ? [] : [],
    plan: context.plan,
    scope,
    sessionKey: context.sessionKey,
    unitName,
  });

  const statusAfter = await safeReadSystemdStatus(scope, unitName);
  if (!statusAfter || statusAfter.notFound) {
    throw new CodeServerSystemdCollisionError("systemd reported that the launched code-server unit does not exist.", {
      scope,
      unitName,
    });
  }

  return {
    failureProbe: createSystemdFailureProbe(scope, unitName),
    handle: null,
    systemdStatus: statusAfter,
    unitName,
  };
}

async function probeSessionRecord(
  record: CodeServerSessionRecord,
  handles: Map<string, CodeServerProcessHandle>,
  paths: ReturnType<typeof getSessionPaths>,
): Promise<CodeServerSessionStatus> {
  const diagnostics = await readCodeServerSessionDiagnostics({
    sessionKey: record.sessionKey,
    stateRoot: path.resolve(paths.stateRoot),
  });

  if (record.launchStrategy === "systemd" && record.systemdScope && record.unitName) {
    const status = await safeReadSystemdStatus(record.systemdScope, record.unitName);
    const ready = !!status?.reusable && await canConnect(record.bindAddr, record.port);

    return {
      bindAddr: record.bindAddr,
      diagnostics,
      extensionsDir: record.extensionsDir,
      failure: record.failure ?? null,
      launchStrategy: record.launchStrategy,
      pid: status?.execMainPid ?? null,
      port: record.port,
      ready,
      readyAt: ready ? record.readyAt : null,
      sessionKey: record.sessionKey,
      specHash: record.specHash,
      startedAt: record.startedAt,
      state: ready ? (record.state === "reusing_existing" ? "reusing_existing" : "ready") : deriveDeadState(record, status),
      stoppedAt: record.stoppedAt,
      systemdScope: record.systemdScope,
      unitName: record.unitName,
      updatedAt: record.updatedAt,
      userDataDir: record.userDataDir,
      workspacePath: record.workspacePath,
    };
  }

  const live = record.pid ? isPidAlive(record.pid) : false;
  const ready = live && await canConnect(record.bindAddr, record.port);
  const handle = handles.get(record.sessionKey);

  return {
    bindAddr: record.bindAddr,
    diagnostics,
    extensionsDir: record.extensionsDir,
    failure: record.failure ?? null,
    launchStrategy: record.launchStrategy,
    pid: handle?.pid ?? record.pid,
    port: record.port,
    ready,
    readyAt: ready ? record.readyAt : null,
    sessionKey: record.sessionKey,
    specHash: record.specHash,
    startedAt: record.startedAt,
    state: ready ? (record.state === "reusing_existing" ? "reusing_existing" : "ready") : deriveDirectDeadState(record, live),
    stoppedAt: record.stoppedAt,
    systemdScope: null,
    unitName: null,
    updatedAt: record.updatedAt,
    userDataDir: record.userDataDir,
    workspacePath: record.workspacePath,
  };
}

async function stopExistingRuntime(
  record: CodeServerSessionRecord,
  profile: CodeServerProfileLifecycleOptions | undefined,
  handles: Map<string, CodeServerProcessHandle>,
  logger?: CodeServerSessionRequest["logger"],
  loggerAdapter?: CodeServerSessionRequest["loggerAdapter"],
  signal?: NodeJS.Signals | number,
): Promise<void> {
  if (record.launchStrategy === "systemd" && record.systemdScope && record.unitName) {
    await stopCodeServerSystemdUnit({
      logger,
      loggerAdapter,
      resetFailed: true,
      scope: record.systemdScope,
      unitName: record.unitName,
    });
  } else if (record.pid) {
    const handle = handles.get(record.sessionKey);
    if (handle) {
      handle.kill(signal ?? "SIGTERM");
      handles.delete(record.sessionKey);
    } else if (isPidAlive(record.pid)) {
      process.kill(record.pid, signal ?? "SIGTERM");
    }
  }

  await maybePersistProfile(profile, record.userDataDir);
}

function createBaseRecord(context: Awaited<ReturnType<typeof prepareSessionContext>>): CodeServerSessionRecord {
  return {
    bindAddr: context.plan.bindAddr,
    diagnostics: null,
    extensionsDir: context.plan.extensionsDir,
    launchStrategy: context.launchStrategy,
    pid: null,
    port: context.plan.port,
    readyAt: null,
    sessionKey: context.sessionKey,
    specHash: context.specHash,
    startedAt: null,
    state: "planned",
    stoppedAt: null,
    systemdScope: context.systemdScope,
    trustedOrigins: [...context.plan.trustedOrigins],
    unitName: context.unitName,
    updatedAt: nowIso(),
    userDataDir: context.plan.userDataDir,
    workspacePath: context.plan.workspacePath,
  };
}

async function buildDiagnosticsSnapshot(
  context: Awaited<ReturnType<typeof prepareSessionContext>>,
  handle: CodeServerProcessHandle | null,
  readyElapsedMs: number,
  systemdStatus: CodeServerSystemdStatus | null,
): Promise<CodeServerSessionDiagnosticsSnapshot> {
  const summary: Record<string, unknown> = {
    bindAddr: context.plan.bindAddr,
    launchStrategy: context.launchStrategy,
    port: context.plan.port,
  };

  if (handle) {
    summary.pid = handle.pid ?? null;
    return {
      pid: handle.pid ?? null,
      readyElapsedMs,
      stderrTail: trimTail(handle.getStderr()),
      stdoutTail: trimTail(handle.getStdout()),
      summary,
      updatedAt: nowIso(),
    };
  }

  const journalTail = context.systemdScope && context.unitName
    ? await safeReadSystemdJournal(context.systemdScope, context.unitName)
    : "";
  if (systemdStatus) {
    summary.activeState = systemdStatus.activeState;
    summary.subState = systemdStatus.subState;
  }

  return {
    activeState: systemdStatus?.activeState ?? null,
    journalTail,
    pid: systemdStatus?.execMainPid ?? null,
    readyElapsedMs,
    subState: systemdStatus?.subState ?? null,
    summary,
    unitName: context.unitName,
    updatedAt: nowIso(),
  };
}

async function buildFailureDiagnostics(
  context: Awaited<ReturnType<typeof prepareSessionContext>>,
  handle: CodeServerProcessHandle | null,
): Promise<CodeServerSessionDiagnosticsSnapshot> {
  if (handle) {
    return {
      pid: handle.pid ?? null,
      stderrTail: trimTail(handle.getStderr()),
      stdoutTail: trimTail(handle.getStdout()),
      summary: {
        bindAddr: context.plan.bindAddr,
        launchStrategy: context.launchStrategy,
        port: context.plan.port,
      },
      updatedAt: nowIso(),
    };
  }

  const journalTail = context.systemdScope && context.unitName
    ? await safeReadSystemdJournal(context.systemdScope, context.unitName)
    : "";
  const status = context.systemdScope && context.unitName
    ? await safeReadSystemdStatus(context.systemdScope, context.unitName)
    : null;

  return {
    activeState: status?.activeState ?? null,
    journalTail,
    pid: status?.execMainPid ?? null,
    subState: status?.subState ?? null,
    summary: {
      bindAddr: context.plan.bindAddr,
      launchStrategy: context.launchStrategy,
      port: context.plan.port,
    },
    unitName: context.unitName,
    updatedAt: nowIso(),
  };
}

async function buildStopDiagnostics(
  record: CodeServerSessionRecord,
  handles: Map<string, CodeServerProcessHandle>,
  paths: ReturnType<typeof getSessionPaths>,
): Promise<CodeServerSessionDiagnosticsSnapshot> {
  const existing = await readCodeServerSessionDiagnostics({
    sessionKey: record.sessionKey,
    stateRoot: paths.stateRoot,
  });
  const handle = handles.get(record.sessionKey);

  return {
    journalTail: existing?.journalTail,
    pid: handle?.pid ?? record.pid ?? null,
    readyElapsedMs: existing?.readyElapsedMs ?? null,
    stderrTail: trimTail(handle?.getStderr() ?? existing?.stderrTail ?? ""),
    stdoutTail: trimTail(handle?.getStdout() ?? existing?.stdoutTail ?? ""),
    summary: existing?.summary ?? {},
    updatedAt: nowIso(),
  };
}

async function writeDiagnosticsFile(
  snapshot: CodeServerSessionDiagnosticsSnapshot | null,
  paths: ReturnType<typeof getSessionPaths>,
): Promise<void> {
  if (!snapshot) return;

  await mkdirp(path.dirname(paths.diagnosticsPath));
  const diagnostics: CodeServerSessionDiagnostics = {
    diagnosticsPath: paths.diagnosticsPath,
    journalTail: snapshot.journalTail,
    readyElapsedMs: snapshot.readyElapsedMs ?? null,
    recordPath: paths.recordPath,
    stderrTail: snapshot.stderrTail,
    stdoutTail: snapshot.stdoutTail,
    summary: snapshot.summary ?? {},
    updatedAt: snapshot.updatedAt,
  };
  await fs.promises.writeFile(paths.diagnosticsPath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
}

async function writeSessionRecord(record: CodeServerSessionRecord, recordPath: string): Promise<void> {
  await mkdirp(path.dirname(recordPath));
  await fs.promises.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function recordToStatus(
  record: CodeServerSessionRecord,
  paths: ReturnType<typeof getSessionPaths>,
  handles: Map<string, CodeServerProcessHandle>,
): Promise<CodeServerSessionStatus> {
  return await probeSessionRecord(record, handles, paths);
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

function sortEnv(value: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const entries = Object.entries(value)
    .filter(([, current]) => current !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function normalizeProfileConfig(profile: CodeServerProfileLifecycleOptions | undefined) {
  if (!profile) return null;

  return {
    items: [...(profile.items ?? [])].sort(),
    pathMap: profile.pathMap ?? {},
    persistTo: profile.persistTo ? path.resolve(profile.persistTo) : null,
    restoreFrom: profile.restoreFrom ? path.resolve(profile.restoreFrom) : null,
    skipMissing: profile.skipMissing ?? true,
    skipUnreadable: profile.skipUnreadable ?? true,
  };
}

function hashNormalizedSpec(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, current]) => `${JSON.stringify(key)}:${stableStringify(current)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

async function maybeRestoreProfile(profile: CodeServerProfileLifecycleOptions | undefined, userDataDir: string): Promise<void> {
  if (!profile?.restoreFrom) return;

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

  await syncCodeServerProfile({
    items: profile.items,
    pathMap: profile.pathMap,
    skipMissing: profile.skipMissing,
    skipUnreadable: profile.skipUnreadable,
    sourceDir: userDataDir,
    targetDir: profile.persistTo,
  });
}

function isLiveState(state: CodeServerSessionState): boolean {
  return state === "planned" || state === "launching" || state === "ready" || state === "reusing_existing";
}

function deriveDeadState(record: CodeServerSessionRecord, status: CodeServerSystemdStatus | null): CodeServerSessionState {
  if (status?.failed) return "failed";
  if (record.state === "stopped") return "stopped";
  return "stale";
}

function deriveDirectDeadState(record: CodeServerSessionRecord, live: boolean): CodeServerSessionState {
  if (live) return record.state;
  if (record.state === "failed") return "failed";
  if (record.state === "stopped") return "stopped";
  return "stale";
}

function createSystemdFailureProbe(scope: CodeServerSystemdScope, unitName: string) {
  return async () => {
    const status = await safeReadSystemdStatus(scope, unitName);
    if (!status) return null;
    if (status.failed) {
      return {
        code: "systemd_unit_failed",
        details: {
          activeState: status.activeState,
          result: status.result,
          subState: status.subState,
          unitName,
        },
        message: "systemd reported that the code-server unit failed during startup.",
      };
    }
    return null;
  };
}

async function safeReadSystemdStatus(scope: CodeServerSystemdScope, unitName: string): Promise<CodeServerSystemdStatus | null> {
  try {
    return await readCodeServerSystemdStatus({
      scope,
      unitName,
    });
  } catch {
    return null;
  }
}

async function safeReadSystemdJournal(scope: CodeServerSystemdScope, unitName: string): Promise<string> {
  try {
    return await readCodeServerSystemdJournal({
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

function createTailBuffer(limit = DEFAULT_TAIL_LENGTH) {
  let text = "";

  return {
    push(next: string) {
      text = trimTail(`${text}${next}`, limit);
    },
    value() {
      return text;
    },
  };
}

function decorateHandleWithTails(
  handle: CodeServerProcessHandle,
  stdoutTail: ReturnType<typeof createTailBuffer>,
  stderrTail: ReturnType<typeof createTailBuffer>,
): CodeServerProcessHandle {
  return {
    ...handle,
    getStderr() {
      return stderrTail.value() || handle.getStderr();
    },
    getStdout() {
      return stdoutTail.value() || handle.getStdout();
    },
  };
}

function trimTail(value: string, limit = DEFAULT_TAIL_LENGTH): string {
  return value.length > limit
    ? value.slice(value.length - limit)
    : value;
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

function createStoppedPlaceholderStatus(options: Pick<CodeServerSessionRequest, "sessionKey">): CodeServerSessionStatus {
  return {
    bindAddr: "",
    diagnostics: null,
    extensionsDir: "",
    failure: null,
    launchStrategy: "direct",
    pid: null,
    port: 0,
    ready: false,
    readyAt: null,
    sessionKey: options.sessionKey,
    specHash: "",
    startedAt: null,
    state: "stopped",
    stoppedAt: null,
    systemdScope: null,
    unitName: null,
    updatedAt: nowIso(),
    userDataDir: "",
    workspacePath: null,
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
