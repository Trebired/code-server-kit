import { spawn } from "node:child_process";

import { CodeServerBinaryNotFoundError } from "./errors.js";
import type {
  CodeServerLaunchPlan,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  LaunchCodeServerProcessOptions,
} from "./types.js";

async function launchCodeServerProcess(options: LaunchCodeServerProcessOptions): Promise<CodeServerProcessHandle> {
  const plan = options.plan;
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const child = spawn(plan.command, plan.args, {
    cwd: options.cwd ?? plan.cwd,
    env: {
      ...process.env,
      ...plan.env,
      ...(options.env ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk);
    stdoutChunks.push(text);
    options.stdout?.(text);
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    stderrChunks.push(text);
    options.stderr?.(text);
  });

  const exit = new Promise<CodeServerProcessExit>((resolve) => {
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal: typeof signal === "string" ? signal as NodeJS.Signals : null,
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(wrapSpawnError(error, plan)));
  });

  return {
    args: [...plan.args],
    bindAddr: plan.bindAddr,
    child,
    codeServerPackageRoot: plan.codeServerPackageRoot,
    command: plan.command,
    cwd: options.cwd ?? plan.cwd,
    env: {
      ...process.env,
      ...plan.env,
      ...(options.env ?? {}),
    },
    exit,
    extensionsDir: plan.extensionsDir,
    getStderr() {
      return stderrChunks.join("");
    },
    getStdout() {
      return stdoutChunks.join("");
    },
    host: plan.host,
    kill(signal?: NodeJS.Signals | number) {
      return child.kill(signal);
    },
    launchMode: plan.launchMode,
    pid: child.pid,
    plan,
    port: plan.port,
    supportRoot: plan.supportRoot,
    userDataDir: plan.userDataDir,
    workspacePath: plan.workspacePath,
  };
}

function wrapSpawnError(error: unknown, plan: CodeServerLaunchPlan): Error {
  const errorCode = typeof error === "object" && error && "code" in error
    ? String(error.code)
    : null;

  if (errorCode === "ENOENT") {
    return new CodeServerBinaryNotFoundError("Could not launch the resolved code-server command.", {
      args: plan.args,
      command: plan.command,
    });
  }

  return error instanceof Error ? error : new Error(String(error));
}

export { launchCodeServerProcess };
