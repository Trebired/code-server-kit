import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { CodeServerInvalidConfigurationError } from "#8974ac53d713";
import { CodeServerProcessHandle } from "#3c8d8166992a";

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
    const socket = net.connect({ host, port });
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
    if (typeof error === "object" && error && "code" in error && String(error.code) === "ENOENT") return null;
    throw error;
  }
}

async function mkdirp(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function terminateHandle(handle: CodeServerProcessHandle, signal: NodeJS.Signals | number): Promise<void> {
  try {
    handle.kill(signal);
    await Promise.race([handle.exit, sleep(1_000)]);
  } catch {
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function nowIso(): string {
  return new Date().toISOString();
}

export {
  canConnect,
  extractHost,
  formatReadyHost,
  getSessionPaths,
  isPidAlive,
  mkdirp,
  normalizeSessionKey,
  nowIso,
  readJsonFile,
  sleep,
  terminateHandle,
};
