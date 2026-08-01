
import { summarizeCodeServerBrowserDiagnostics } from "#8392d406df71";
import { resolveLogger } from "#5a29135e56c1";
import { ensureCodeServerPrepared } from "#1fwnycc9wdnp";
import type {
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionStartResult,
} from "#3c8d8166992a";
import {
  createBaseRecord,
  createSessionCorrelationId,
  handles,
  hashNormalizedSpec,
  isLiveOrStartingState,
  mkdirp,
  normalizeProfileConfig,
  normalizeSessionBrowserOptions,
  nowIso,
  pushBackendCheckpoint,
  resolveProfilePolicy,
  writeSessionRecord,
} from "#5abxg3204o0r";
import type { SessionStartContext, SessionStartRuntime } from "./shared.js";
import {
  probeSessionRecord,
  stopExistingRuntime,
} from "#jfr5p9teg08n";

const DEFAULT_LAUNCH_STRATEGY = "direct";

async function prepareStartRuntime(context: SessionStartContext): Promise<SessionStartRuntime> {
  const { launchPlan, options, sessionKey, stateRoot } = context;
  const launchStrategy = options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY;
  const browserBridge = normalizeSessionBrowserOptions(options.browser)?.bridge;
  const readinessTarget = options.readinessTarget ?? (browserBridge ? "browser-shell" : "http");
  const preparation = await resolvePreparationStatus(options, launchPlan);
  const correlationId = createSessionCorrelationId(sessionKey, context.specHash);
  const backendCheckpoints: import("#3c8d8166992a").CodeServerSessionBackendCheckpoint[] = [];
  const readonlyFilesystem = launchStrategy === "systemd"
    ? launchPlan.readonlyEnforcement.systemdFilesystem
    : launchPlan.readonlyEnforcement.directFilesystem;

  await mkdirp(context.paths.sessionDir);
  logPlannedStart(context, correlationId, launchStrategy, readinessTarget, readonlyFilesystem, backendCheckpoints);

  return {
    backendCheckpoints,
    browserBridge,
    correlationId,
    launchStrategy,
    readonlyFilesystem,
    preparation,
    profilePolicy: resolveProfilePolicy(options.profile, launchPlan.readonly),
    readinessTarget,
  };
}

async function tryReuseExistingSession(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<CodeServerSessionStartResult | null> {
  const existing = context.existing;
  if (!existing) return null;

  const status = await probeSessionRecord(existing, context.options.sanitizer);
  if (existing.specHash === context.specHash && status.ready) {
    await writeSessionRecord(createReusedRecord(context, runtime, existing), context.paths.recordPath);
    const reused = { ...status, state: "reusing_existing" as const };
    return {
      created: false,
      diagnostics: reused.diagnostics,
      handle: handles.get(context.sessionKey) ?? null,
      launchPlan: context.launchPlan,
      launchStrategy: runtime.launchStrategy,
      readiness: null,
      reused: true,
      status: reused,
    };
  }

  if (isLiveOrStartingState(status.state)) {
    await stopExistingRuntime(
      existing,
      runtime.profilePolicy,
      undefined,
      context.options.logger,
      context.options.loggerAdapter,
    );
  }
  return null;
}

async function prepareRuntimeProfile(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<void> {
  if (!runtime.profilePolicy) return;

  const preparedProfile = await runtime.profilePolicy.prepareRuntimeProfile(context.launchPlan.userDataDir);
  pushBackendCheckpoint(runtime.backendCheckpoints, "profile", "prepared runtime profile", {
    persistTarget: preparedProfile.persistTarget,
    restored: preparedProfile.restore.restored,
    runtimeDir: preparedProfile.runtimeDir,
    settingsPatched: preparedProfile.restore.settingsPatched,
    skippedRestore: preparedProfile.restore.skipped,
  });
}

async function createLaunchingRecord(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
): Promise<CodeServerSessionRecord> {
  const baseRecord = createBaseRecord({
    browserSummary: summarizeCodeServerBrowserDiagnostics(runtime.browserBridge?.getEvents() ?? []),
    correlationId: runtime.correlationId,
    lastStartSummary: null,
    launchPlan: context.launchPlan,
    launchStrategy: runtime.launchStrategy,
    metadata: context.options.metadata ?? null,
    preparation: runtime.preparation,
    readinessTarget: runtime.readinessTarget,
    sessionKey: context.sessionKey,
    specHash: context.specHash,
    watchdogMode: runtime.preparation.watchdogMode,
  });
  await writeSessionRecord({ ...baseRecord, state: "launching", updatedAt: nowIso() }, context.paths.recordPath);
  return baseRecord;
}

function buildRequestedSpecHash(options: CodeServerSessionRequest): string {
  return hashNormalizedSpec({
    browser: normalizeSessionBrowserOptions(options.browser)?.policy ?? null,
    env: options.env ?? {},
    host: options.host ?? null,
    launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
    port: options.port ?? null,
    profile: normalizeProfileConfig(options.profile),
    readinessTarget: options.readinessTarget ?? null,
    readonly: options.readonly ?? null,
    systemd: options.systemd ?? null,
    trustedOrigins: options.trustedOrigins ?? [],
    workspacePath: options.workspacePath ?? null,
  });
}

async function resolvePreparationStatus(
  options: CodeServerSessionRequest,
  launchPlan: SessionStartContext["launchPlan"],
) {
  if (options.preparation?.mode === "skip") {
    return launchPlan.preparationStatus;
  }
  return (await ensureCodeServerPrepared({
    logger: options.logger,
    loggerAdapter: options.loggerAdapter,
    resolveFrom: options.resolveFrom,
    strictWatchdog: options.preparation?.strictWatchdog,
  })).status;
}

function logPlannedStart(
  context: SessionStartContext,
  correlationId: string,
  launchStrategy: SessionStartRuntime["launchStrategy"],
  readinessTarget: SessionStartRuntime["readinessTarget"],
  readonlyFilesystem: SessionStartRuntime["readonlyFilesystem"],
  backendCheckpoints: SessionStartRuntime["backendCheckpoints"],
): void {
  const details = {
    correlationId,
    launchStrategy,
    readonlyFilesystem,
    readinessTarget,
    sessionKey: context.sessionKey,
    stateRoot: context.stateRoot,
    userDataDir: context.launchPlan.userDataDir,
    workspacePath: context.launchPlan.workspacePath,
  };
  pushBackendCheckpoint(backendCheckpoints, "session", "planned code-server session launch", details);
  resolveLogger(context.options.logger, context.options.loggerAdapter).info(
    "launch:planned",
    "planned code-server session launch",
    details,
  );
}

function createReusedRecord(
  context: SessionStartContext,
  runtime: SessionStartRuntime,
  existing: CodeServerSessionRecord,
): CodeServerSessionRecord {
  return {
    ...existing,
    browserSummary: summarizeCodeServerBrowserDiagnostics(
      runtime.browserBridge?.getEvents() ?? existing.diagnostics?.browserEvents ?? [],
    ),
    correlationId: runtime.correlationId,
    health: "ready",
    metadata: context.options.metadata ?? existing.metadata ?? null,
    preparation: runtime.preparation,
    state: "reusing_existing",
    updatedAt: nowIso(),
  };
}

export {
  buildRequestedSpecHash,
  createLaunchingRecord,
  prepareRuntimeProfile,
  prepareStartRuntime,
  tryReuseExistingSession,
};
