import type { ChildProcess } from "node:child_process";

type CodeServerEntryKind = "node_script" | "executable";
type CodeServerLaunchMode = "auto" | "direct" | "node";

type CodeServerInstallation = {
  entryKind: CodeServerEntryKind;
  entryPoint: string;
  packageJsonPath: string;
  packageRoot: string;
  supportRoot: string | null;
  version?: string;
};

type ResolveCodeServerInstallationOptions = {
  resolveFrom?: string;
};

type CodeServerLaunchOptions = {
  bindAddr?: string;
  dataRoot?: string;
  extensionsDir?: string;
  host?: string;
  installation?: CodeServerInstallation;
  launchMode?: CodeServerLaunchMode;
  nodeCommand?: string;
  port?: number;
  resolveFrom?: string;
  trustedOrigins?: string[];
  userDataDir?: string;
  workspacePath?: string;
};

type CodeServerLaunchPlan = {
  args: string[];
  bindAddr: string;
  codeServerPackageRoot: string;
  command: string;
  entryPoint: string;
  extensionsDir: string;
  host: string;
  launchMode: Exclude<CodeServerLaunchMode, "auto">;
  port: number;
  supportRoot: string | null;
  userDataDir: string;
  workspacePath: string | null;
};

type CodeServerProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type CodeServerProcessHandle = {
  args: string[];
  bindAddr: string;
  child: ChildProcess;
  codeServerPackageRoot: string;
  command: string;
  exit: Promise<CodeServerProcessExit>;
  extensionsDir: string;
  getStderr(): string;
  getStdout(): string;
  host: string;
  kill(signal?: NodeJS.Signals | number): boolean;
  launchMode: Exclude<CodeServerLaunchMode, "auto">;
  pid: number | undefined;
  port: number;
  supportRoot: string | null;
  userDataDir: string;
  workspacePath: string | null;
};

type CodeServerReadyOptions = {
  host?: string;
  port: number;
  process?: CodeServerProcessHandle;
  retryIntervalMs?: number;
  timeoutMs?: number;
};

type CodeServerReadyResult = {
  elapsedMs: number;
  host: string;
  port: number;
};

type LaunchCodeServerProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  plan: CodeServerLaunchPlan;
  stderr?(text: string): void;
  stdout?(text: string): void;
};

export type {
  CodeServerEntryKind,
  CodeServerInstallation,
  CodeServerLaunchMode,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  LaunchCodeServerProcessOptions,
  ResolveCodeServerInstallationOptions,
};
