import {
  CodeServerInvalidConfigurationError,
  CodeServerStartupProbeError,
  CodeServerStartupTimeoutError,
} from "#8974ac53d713";
import {
  CONNECT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_READY_RETRY_INTERVAL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  canConnect,
  createExitedBeforeReadyError,
  formatHost,
  normalizePositiveDuration,
  normalizeReadyHost,
  normalizeReadyPort,
  probeHttpReady,
  probeWebSocketReady,
  pushCheckpoint,
  runFailureProbe,
  sleep,
} from "./probes.js";
import type {
  CodeServerProcessExit,
  CodeServerReadyCheckpoint,
  CodeServerReadyOptions,
  CodeServerReadyResult,
} from "#3c8d8166992a";

async function waitForCodeServerReady(options: CodeServerReadyOptions): Promise<CodeServerReadyResult> {
  const context = createReadinessContext(options);
  while (Date.now() - context.startedAt < context.timeoutMs) {
    if (context.exitResult) {
      throw createExitedBeforeReadyError(context.host, context.port, context.exitResult, options.process);
    }

    const elapsedMs = Date.now() - context.startedAt;
    await assertNoProbeFailure(options, context, elapsedMs);
    const connected = await waitForTcpConnection(options, context, elapsedMs);
    if (!connected) continue;
    const result = await resolveReadyResult(options, context);
    if (result) return result;
  }

  throw new CodeServerStartupTimeoutError(`Timed out waiting for code-server to reach ${context.target} readiness.`, {
      host: context.host,
      port: context.port,
      stderr: options.process?.getStderr(),
      stdout: options.process?.getStdout(),
      target: context.target,
      timeoutMs: context.timeoutMs,
  });
}

function createReadinessContext(options: CodeServerReadyOptions) {
  const checkpoints: CodeServerReadyCheckpoint[] = [];
  const context = {
    checkpoints,
    exitResult: null as CodeServerProcessExit | null,
    host: normalizeReadyHost(options.host),
    port: normalizeReadyPort(options.port),
    retryIntervalMs: normalizePositiveDuration(options.retryIntervalMs, DEFAULT_READY_RETRY_INTERVAL_MS),
    startedAt: Date.now(),
    target: options.target ?? "tcp",
    timeoutMs: normalizePositiveDuration(options.timeoutMs, DEFAULT_READY_TIMEOUT_MS),
  };
  if (options.process) {
    void options.process.exit.then((result) => {
        context.exitResult = result;
    });
  }
  return context;
}

async function assertNoProbeFailure(
  options: CodeServerReadyOptions,
  context: ReturnType<typeof createReadinessContext>,
  elapsedMs: number,
): Promise<void> {
  const probeFailure = await runFailureProbe(options, {
      elapsedMs,
      host: context.host,
      port: context.port,
      process: options.process,
  });
  if (!probeFailure) return;

  throw new CodeServerStartupProbeError(probeFailure.message, {
      ...(probeFailure.details ?? {}),
      elapsedMs,
      hints: probeFailure.hints,
      host: context.host,
      phase: probeFailure.phase ?? "launch",
      port: context.port,
      retryable: probeFailure.retryable ?? true,
  });
}

async function waitForTcpConnection(
  options: CodeServerReadyOptions,
  context: ReturnType<typeof createReadinessContext>,
  elapsedMs: number,
): Promise<boolean> {
  const remainingMs = context.timeoutMs - elapsedMs;
  const connected = await canConnect(context.host, context.port, Math.min(CONNECT_ATTEMPT_TIMEOUT_MS, remainingMs));
  if (!connected) {
    await sleep(Math.min(context.retryIntervalMs, Math.max(remainingMs, 0)));
    return false;
  }

  pushCheckpoint(context.checkpoints, elapsedMs, "launch", "tcp", {
      bindAddr: options.process?.bindAddr ?? `${context.host}:${context.port}`,
  });
  return true;
}

async function resolveReadyResult(
  options: CodeServerReadyOptions,
  context: ReturnType<typeof createReadinessContext>,
): Promise<CodeServerReadyResult|null> {
  if (context.target === "tcp") return buildReadyResult(context);

  const httpReady = await waitForHttpStage(options, context);
  if (!httpReady) return null;
  if (context.target === "http") return buildReadyResult(context);
  return await waitForBrowserStage(options, context);
}

async function waitForHttpStage(
  options: CodeServerReadyOptions,
  context: ReturnType<typeof createReadinessContext>,
): Promise<boolean> {
  const elapsedMs = Date.now() - context.startedAt;
  const remainingMs = context.timeoutMs - elapsedMs;
  const httpUrl = options.httpUrl ?? `http://${formatHost(context.host)}:${context.port}/`;
  const httpReady = await probeHttpReady(httpUrl, options.httpHeaders);
  if (!httpReady) {
    await sleep(Math.min(context.retryIntervalMs, Math.max(remainingMs, 0)));
    return false;
  }

  pushCheckpoint(context.checkpoints, Date.now() - context.startedAt, "http-ready", "http", { url: httpUrl });
  return true;
}

async function waitForBrowserStage(
  options: CodeServerReadyOptions,
  context: ReturnType<typeof createReadinessContext>,
): Promise<CodeServerReadyResult|null> {
  if (context.target === "websocket" && options.websocketUrl) {
    const remainingMs = context.timeoutMs - (Date.now() - context.startedAt);
    const websocketReady = await probeWebSocketReady(options.websocketUrl, Math.min(remainingMs, context.retryIntervalMs * 4));
    if (!websocketReady) {
      await sleep(Math.min(context.retryIntervalMs, Math.max(remainingMs, 0)));
      return null;
    }
    pushCheckpoint(context.checkpoints, Date.now() - context.startedAt, "websocket-ready", "websocket", {
        url: options.websocketUrl,
    });
    return buildReadyResult(context);
  }

  const browserTarget = resolveBrowserTarget(options, context.target);
  const browserReady = await options.browser!.bridge!.waitForTarget(browserTarget, {
      timeoutMs: options.browser?.timeoutMs ?? (context.timeoutMs - (Date.now() - context.startedAt)),
  });
  pushCheckpoint(
    context.checkpoints,
    Date.now() - context.startedAt,
    browserTarget === "workbench" ? "workbench-ready" : browserTarget === "browser-shell" ? "browser-bootstrap" : "websocket-ready",
    context.target,
    {
      browserEvent: browserReady.event,
    },
  );
  return buildReadyResult(context);
}

function resolveBrowserTarget(
  options: CodeServerReadyOptions,
  target: ReturnType<typeof createReadinessContext>["target"],
) {
  if (target === "websocket" && !options.websocketUrl && !options.browser?.bridge) {
    throw new CodeServerInvalidConfigurationError(
      "Websocket readiness requires either websocketUrl or a browser diagnostics bridge.",
      { phase: "websocket-ready" },
    );
  }
  if ((target === "websocket" || target === "browser-shell" || target === "workbench") && !options.browser?.bridge) {
    throw new CodeServerInvalidConfigurationError(
      "Browser readiness targets require a browser diagnostics bridge.",
      {
        phase: target === "workbench" ? "workbench-ready" : "browser-bootstrap",
        target,
      },
    );
  }
  return target === "browser-shell"
  ? "browser-shell"
  : target === "workbench"
  ? "workbench"
  : "websocket";
}

function buildReadyResult(context: ReturnType<typeof createReadinessContext>): CodeServerReadyResult {
  return {
    checkpoints: context.checkpoints,
    elapsedMs: Date.now() - context.startedAt,
    host: context.host,
    port: context.port,
    target: context.target,
  };
}

export { waitForCodeServerReady };
