import net from "node:net";

import {
  CodeServerProcessExitedBeforeReadyError,
  CodeServerStartupTimeoutError,
} from "./errors.js";
import type { CodeServerProcessExit, CodeServerReadyOptions, CodeServerReadyResult } from "./types.js";

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

    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const connected = await canConnect(host, port, Math.min(CONNECT_ATTEMPT_TIMEOUT_MS, remainingMs));
    if (connected) {
      return {
        elapsedMs: Date.now() - startedAt,
        host,
        port,
      };
    }

    if (exitResult) {
      throw createExitedBeforeReadyError(host, port, exitResult, options.process);
    }

    await sleep(Math.min(retryIntervalMs, Math.max(remainingMs, 0)));
  }

  throw new CodeServerStartupTimeoutError("Timed out waiting for code-server to accept TCP connections.", {
    host,
    port,
    stderr: options.process?.getStderr(),
    stdout: options.process?.getStdout(),
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

function createExitedBeforeReadyError(
  host: string,
  port: number,
  exitResult: CodeServerProcessExit,
  process?: CodeServerReadyOptions["process"],
) {
  return new CodeServerProcessExitedBeforeReadyError("code-server exited before the TCP port became ready.", {
    code: exitResult.code,
    host,
    port,
    signal: exitResult.signal,
    stderr: process?.getStderr(),
    stdout: process?.getStdout(),
  });
}

function normalizeReadyHost(value?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || DEFAULT_READY_HOST;
}

function normalizeReadyPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TypeError("waitForCodeServerReady requires a TCP port between 1 and 65535.");
  }

  return value;
}

function normalizePositiveDuration(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("Readiness durations must be greater than zero.");
  }
  return Math.floor(value);
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export { waitForCodeServerReady };
