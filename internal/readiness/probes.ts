import net from "node:net";

import {
  CodeServerInvalidConfigurationError,
  CodeServerProcessExitedBeforeReadyError,
} from "#8974ac53d713";
import type {
  CodeServerProcessExit,
  CodeServerReadinessTarget,
  CodeServerReadyCheckpoint,
  CodeServerReadyFailure,
  CodeServerReadyOptions,
} from "#3c8d8166992a";

const DEFAULT_READY_HOST = "127.0.0.1";
const DEFAULT_READY_RETRY_INTERVAL_MS = 100;
const DEFAULT_READY_TIMEOUT_MS = 30_000;
const CONNECT_ATTEMPT_TIMEOUT_MS = 400;

async function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.connect({ host, port });
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
  if (typeof result === "string") return { message: result };
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
  if (checkpoints.some((checkpoint) => `${checkpoint.phase}:${checkpoint.target}` === key)) return;
  checkpoints.push({ details, elapsedMs, phase, target });
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
    throw new CodeServerInvalidConfigurationError("Readiness durations must be greater than zero.", { value });
  }
  return Math.floor(value);
}

function formatHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export {
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
};
