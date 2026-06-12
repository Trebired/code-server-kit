import net from "node:net";

import {
  CodeServerInvalidConfigurationError,
  CodeServerProcessExitedBeforeReadyError,
  CodeServerStartupProbeError,
  CodeServerStartupTimeoutError,
} from "./errors.js";
import type {
  CodeServerProcessExit,
  CodeServerReadinessTarget,
  CodeServerReadyCheckpoint,
  CodeServerReadyFailure,
  CodeServerReadyOptions,
  CodeServerReadyResult,
} from "./types.js";

const DEFAULT_READY_HOST = "127.0.0.1";
const DEFAULT_READY_RETRY_INTERVAL_MS = 100;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 400;

async function waitForCodeServerReady(options: CodeServerReadyOptions): Promise<CodeServerReadyResult> {
  const host = normalizeReadyHost(options.host);
  const port = normalizeReadyPort(options.port);
  const retryIntervalMs = normalizePositiveDuration(
    options.retryIntervalMs,
    DEFAULT_READY_RETRY_INTERVAL_MS,
  );
  const timeoutMs = normalizePositiveDuration(options.timeoutMs, DEFAULT_READY_TIMEOUT_MS);
  const target = options.target ?? "tcp";
  const checkpoints: CodeServerReadyCheckpoint[] = [];
  const startedAt = Date.now();
  let exitResult: CodeServerProcessExit | null = null;

  if (options.process) {
    void options.process.exit.then((result) => {
      exitResult = result;
    });
  }

  while (Date.now() - startedAt < timeoutMs) {
    if (exitResult) {
      throw createExitedBeforeReadyError(host, port, exitResult, options.process);
    }

    const elapsedMs = Date.now() - startedAt;
    const probeFailure = await runFailureProbe(options, {
      elapsedMs,
      host,
      port,
      process: options.process,
    });

    if (probeFailure) {
      throw new CodeServerStartupProbeError(probeFailure.message, {
        ...(probeFailure.details ?? {}),
        elapsedMs,
        hints: probeFailure.hints,
        host,
        phase: probeFailure.phase ?? "launch",
        port,
        retryable: probeFailure.retryable ?? true,
      });
    }

    const remainingMs = timeoutMs - elapsedMs;
    const connected = await canConnect(host, port, Math.min(CONNECT_ATTEMPT_TIMEOUT_MS, remainingMs));
    if (!connected) {
      await sleep(Math.min(retryIntervalMs, Math.max(remainingMs, 0)));
      continue;
    }

    pushCheckpoint(checkpoints, elapsedMs, "launch", "tcp", {
      bindAddr: options.process?.bindAddr ?? `${host}:${port}`,
    });

    if (target === "tcp") {
      return {
        checkpoints,
        elapsedMs: Date.now() - startedAt,
        host,
        port,
        target,
      };
    }

    const httpUrl = options.httpUrl ?? `http://${formatHost(host)}:${port}/`;
    const httpReady = await probeHttpReady(httpUrl, options.httpHeaders);
    if (!httpReady) {
      await sleep(Math.min(retryIntervalMs, Math.max(remainingMs, 0)));
      continue;
    }

    pushCheckpoint(checkpoints, Date.now() - startedAt, "http-ready", "http", {
      url: httpUrl,
    });

    if (target === "http") {
      return {
        checkpoints,
        elapsedMs: Date.now() - startedAt,
        host,
        port,
        target,
      };
    }

    if (target === "websocket") {
      const websocketUrl = options.websocketUrl;
      if (websocketUrl) {
        const websocketReady = await probeWebSocketReady(websocketUrl, Math.min(remainingMs, retryIntervalMs * 4));
        if (!websocketReady) {
          await sleep(Math.min(retryIntervalMs, Math.max(remainingMs, 0)));
          continue;
        }

        pushCheckpoint(checkpoints, Date.now() - startedAt, "websocket-ready", "websocket", {
          url: websocketUrl,
        });
        return {
          checkpoints,
          elapsedMs: Date.now() - startedAt,
          host,
          port,
          target,
        };
      }

      if (!options.browser?.bridge) {
        throw new CodeServerInvalidConfigurationError(
          "Websocket readiness requires either websocketUrl or a browser diagnostics bridge.",
          {
            phase: "websocket-ready",
          },
        );
      }
    }

    if (target === "websocket" || target === "browser-shell" || target === "workbench") {
      if (!options.browser?.bridge) {
        throw new CodeServerInvalidConfigurationError(
          "Browser readiness targets require a browser diagnostics bridge.",
          {
            phase: target === "workbench" ? "workbench-ready" : "browser-bootstrap",
            target,
          },
        );
      }

      const browserTarget = target === "browser-shell"
        ? "browser-shell"
        : target === "workbench"
          ? "workbench"
          : "websocket";
      const browserReady = await options.browser.bridge.waitForTarget(browserTarget, {
        timeoutMs: options.browser.timeoutMs ?? remainingMs,
      });
      pushCheckpoint(
        checkpoints,
        Date.now() - startedAt,
        browserTarget === "workbench" ? "workbench-ready" : browserTarget === "browser-shell" ? "browser-bootstrap" : "websocket-ready",
        target,
        {
          browserEvent: browserReady.event,
        },
      );
      return {
        checkpoints,
        elapsedMs: Date.now() - startedAt,
        host,
        port,
        target,
      };
    }
  }

  throw new CodeServerStartupTimeoutError(`Timed out waiting for code-server to reach ${target} readiness.`, {
    host,
    port,
    stderr: options.process?.getStderr(),
    stdout: options.process?.getStdout(),
    target,
    timeoutMs,
  });
}

async function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
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

    socket.setTimeout(Math.max(timeoutMs, 1));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function probeHttpReady(url: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function probeWebSocketReady(url: string, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), Math.max(timeoutMs, 250));

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    try {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        socket.close();
        finish(true);
      });
      socket.addEventListener("error", () => finish(false));
      socket.addEventListener("close", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

async function runFailureProbe(
  options: CodeServerReadyOptions,
  context: {
    elapsedMs: number;
    host: string;
    port: number;
    process?: CodeServerReadyOptions["process"];
  },
): Promise<CodeServerReadyFailure | null> {
  if (!options.failureProbe) return null;

  const result = await options.failureProbe(context);
  if (!result) return null;
  if (typeof result === "string") {
    return {
      message: result,
    };
  }
  if (result instanceof Error) {
    return {
      details: {
        name: result.name,
      },
      message: result.message,
    };
  }
  return result;
}

function createExitedBeforeReadyError(
  host: string,
  port: number,
  exitResult: CodeServerProcessExit,
  process?: CodeServerReadyOptions["process"],
) {
  return new CodeServerProcessExitedBeforeReadyError("code-server exited before reaching the requested readiness target.", {
    code: exitResult.code,
    host,
    phase: "launch",
    port,
    signal: exitResult.signal,
    stderr: process?.getStderr(),
    stdout: process?.getStdout(),
  });
}

function pushCheckpoint(
  checkpoints: CodeServerReadyCheckpoint[],
  elapsedMs: number,
  phase: CodeServerReadyCheckpoint["phase"],
  target: CodeServerReadinessTarget,
  details: Record<string, unknown>,
): void {
  const key = `${phase}:${target}`;
  if (checkpoints.some((checkpoint) => `${checkpoint.phase}:${checkpoint.target}` === key)) {
    return;
  }

  checkpoints.push({
    details,
    elapsedMs,
    phase,
    target,
  });
}

function normalizeReadyHost(value?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || DEFAULT_READY_HOST;
}

function normalizeReadyPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new CodeServerInvalidConfigurationError(
      "waitForCodeServerReady requires a TCP port between 1 and 65535.",
      { value },
    );
  }

  return value;
}

function normalizePositiveDuration(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new CodeServerInvalidConfigurationError("Readiness durations must be greater than zero.", {
      value,
    });
  }
  return Math.floor(value);
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export { waitForCodeServerReady };
