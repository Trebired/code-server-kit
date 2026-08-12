import fs from "node:fs";
import path from "node:path";

import { CodeServerInvalidConfigurationError } from "#8974ac53d713";
import { CodeServerProcessHandle } from "#3c8d8166992a";
import {
  canConnectToHost,
  formatReadyHost,
  sleep,
} from "#1hrgy979pns4";

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
  return await canConnectToHost(host, port, 250);
}

function extractHost(bindAddr: string): string {
  if (bindAddr.startsWith("[")) {
    const end = bindAddr.indexOf("]");
    return bindAddr.slice(1, end);
  }
  return bindAddr.slice(0, bindAddr.lastIndexOf(":"));
}

async function readJsonFile<T>(filePath: string): Promise<T|null> {
  try {
    const contents = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(contents) as T;
  } catch (error) {
    if (typeof error === "object" && error && "code"in error && String(error.code) === "ENOENT") return null;
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
