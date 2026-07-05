import { spawn } from "node:child_process";

import { CodeServerBinaryNotFoundError } from "./errors.js";
import { buildDirectReadonlyLaunch } from "./readonly/launch.js";
import type {
  CodeServerLaunchPlan,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  LaunchCodeServerProcessOptions,
} from "./types.js";

async function launchCodeServerProcess(options: LaunchCodeServerProcessOptions): Promise<CodeServerProcessHandle> {
  const plan = options.plan;
  const env = buildLaunchEnvironment(options);
  const processState = spawnPlanProcess(options, env);
  await waitForSpawn(processState.child, plan);
  return createProcessHandle(plan, options, env, processState);
}

function buildLaunchEnvironment(options: LaunchCodeServerProcessOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...options.plan.env,
    ...(options.env ?? {}),
  };
}

function spawnPlanProcess(options: LaunchCodeServerProcessOptions, env: NodeJS.ProcessEnv) {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const resolvedLaunch = buildDirectReadonlyLaunch(options.plan, env);
  const child = spawn(resolvedLaunch.command, resolvedLaunch.args, {
    cwd: options.cwd ?? options.plan.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  bindProcessOutput(child, stdoutChunks, stderrChunks, options);
  return {
    child,
    exit: createProcessExitPromise(child),
    stderrChunks,
    stdoutChunks,
  };
}

function bindProcessOutput(
  child: ReturnType<typeof spawn>,
  stdoutChunks: string[],
  stderrChunks: string[],
  options: LaunchCodeServerProcessOptions,
): void {
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
}

function createProcessExitPromise(child: ReturnType<typeof spawn>): Promise<CodeServerProcessExit> {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal: typeof signal === "string" ? signal as NodeJS.Signals : null,
      });
    });
  });
}

async function waitForSpawn(child: ReturnType<typeof spawn>, plan: CodeServerLaunchPlan): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (error) => reject(wrapSpawnError(error, plan)));
  });
}

function createProcessHandle(
  plan: CodeServerLaunchPlan,
  options: LaunchCodeServerProcessOptions,
  env: NodeJS.ProcessEnv,
  processState: ReturnType<typeof spawnPlanProcess>,
): CodeServerProcessHandle {
  return {
    args: [...plan.args],
    bindAddr: plan.bindAddr,
    child: processState.child,
    codeServerPackageRoot: plan.codeServerPackageRoot,
    command: plan.command,
    cwd: options.cwd ?? plan.cwd,
    env,
    exit: processState.exit,
    extensionsDir: plan.extensionsDir,
    getStderr() {
      return processState.stderrChunks.join("");
    },
    getStdout() {
      return processState.stdoutChunks.join("");
    },
    host: plan.host,
    kill(signal?: NodeJS.Signals | number) {
      return processState.child.kill(signal);
    },
    launchMode: plan.launchMode,
    pid: processState.child.pid,
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
