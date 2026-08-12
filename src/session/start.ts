import path from "node:path";

import { CodeServerSessionReuseConflictError } from "#8974ac53d713";
import { createCodeServerLaunchPlan } from "#0c8da394780f";
import type {
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionStartResult,
} from "#3c8d8166992a";
import {
  extractHost,
  getSessionPaths,
  inflightStarts,
  normalizeSessionBrowserOptions,
  normalizeSessionKey,
  readJsonFile,
} from "./shared.js";
import {
  finalizeFailedStart,
  finalizeReadyStart,
  launchAndWaitForReady,
} from "./start/helpers.js";
import type { SessionStartContext } from "./start/shared.js";
import {
  buildRequestedSpecHash,
  createLaunchingRecord,
  prepareRuntimeProfile,
  prepareStartRuntime,
  tryReuseExistingSession,
} from "./start/runtime.js";

const DEFAULT_LAUNCH_STRATEGY = "direct";

async function startCodeServerSessionInternal(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult> {
  const sessionKey = normalizeSessionKey(options.sessionKey);
  const stateRoot = path.resolve(options.stateRoot);
  const requestedSpecHash = buildRequestedSpecHash(options);
  const inflightKey = `${stateRoot}:${sessionKey}`;
  const running = inflightStarts.get(inflightKey);
  if (running) return await resolveInflightStart(running, requestedSpecHash, sessionKey, stateRoot);

  const promise = createSessionStartAttempt(options, sessionKey, stateRoot);
  inflightStarts.set(inflightKey, { promise, specHash: requestedSpecHash });
  try {
    return await promise;
  } finally {
    inflightStarts.delete(inflightKey);
  }
}

async function createSessionStartAttempt(
  options: CodeServerSessionRequest,
  sessionKey: string,
  stateRoot: string,
): Promise<CodeServerSessionStartResult> {
  const paths = getSessionPaths(stateRoot, sessionKey);
  const existing = await readJsonFile<CodeServerSessionRecord>(paths.recordPath);
  const launchPlan = await createCodeServerLaunchPlan(buildLaunchPlanOptions(options, paths.sessionDir, existing));
  const specHash = buildSessionSpecHash(options, launchPlan);
  return await startCodeServerSessionInner({
      existing,
      launchPlan,
      options,
      paths,
      sessionKey,
      specHash,
      stateRoot,
  });
}

async function startCodeServerSessionInner(context: SessionStartContext): Promise<CodeServerSessionStartResult> {
  const runtime = await prepareStartRuntime(context);
  const reused = await tryReuseExistingSession(context, runtime);
  if (reused) return reused;

  await prepareRuntimeProfile(context, runtime);
  const baseRecord = await createLaunchingRecord(context, runtime);

  try {
    return await finalizeReadyStart(
      context,
      runtime,
      baseRecord,
      await launchAndWaitForReady(context, runtime),
    );
  } catch (error) {
    return await finalizeFailedStart(context, runtime, baseRecord, error);
  }
}

async function resolveInflightStart(
  running: {
    promise: Promise<CodeServerSessionStartResult>;
    specHash: string;
  },
  requestedSpecHash: string,
  sessionKey: string,
  stateRoot: string,
): Promise<CodeServerSessionStartResult> {
  if (running.specHash === requestedSpecHash) return await running.promise;
  throw new CodeServerSessionReuseConflictError(
    "A code-server session start is already in flight for this session key with a different effective spec.",
    { sessionKey, stateRoot },
  );
}

function buildLaunchPlanOptions(
  options: CodeServerSessionRequest,
  sessionDir: string,
  existing: CodeServerSessionRecord | null,
): CodeServerSessionRequest {
  const existingHost = existing ? extractHost(existing.bindAddr) : undefined;
  return {
    ...options,
    browser: normalizeSessionBrowserOptions(options.browser) ?? undefined,
    dataRoot: options.dataRoot ?? path.join(sessionDir, "runtime"),
    host: options.bindAddr ? undefined : (options.host ?? existingHost),
    port: options.bindAddr ? undefined : (options.port ?? existing?.port),
  };
}

function buildSessionSpecHash(
  options: CodeServerSessionRequest,
  launchPlan: Awaited<ReturnType<typeof createCodeServerLaunchPlan>>,
): string {
  return buildRequestedSpecHash({
      ...options,
      host: launchPlan.host,
      launchStrategy: options.launchStrategy ?? DEFAULT_LAUNCH_STRATEGY,
      port: launchPlan.port,
  });
}

export { startCodeServerSessionInternal };
