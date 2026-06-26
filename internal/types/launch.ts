import type { ChildProcess } from "node:child_process";

import type {
  CodeServerEntryKind,
  CodeServerLaunchMode,
  CodeServerLifecyclePhase,
  CodeServerPreparationMode,
  CodeServerReadinessTarget,
  CodeServerWatchdogMode,
} from "./core.js";
import type {
  CodeServerInstallation,
  CodeServerPathBinding,
  CodeServerReadonlyEnforcement,
  CodeServerPreparationStatus,
  CodeServerReadinessStatus,
  CodeServerReadonlyInput,
  CodeServerReadonlyPolicy,
  CodeServerSandboxPlan,
  CodeServerTranslatedPath,
} from "./preparation.js";
import type {
  CodeServerBrowserReadinessPolicy,
  CodeServerSessionBrowserOptions,
  CodeServerSessionDiagnosticsBridge,
} from "./browser.js";

type CreateCodeServerLaunchPlanOptions = {
  bindAddr?: string;
  browser?: CodeServerSessionBrowserOptions;
  cwd?: string;
  dataRoot?: string;
  env?: NodeJS.ProcessEnv;
  extensionsDir?: string;
  host?: string;
  installation?: CodeServerInstallation;
  launchMode?: CodeServerLaunchMode;
  nodeCommand?: string;
  port?: number;
  preparation?: {
    mode?: CodeServerPreparationMode;
    strictWatchdog?: boolean;
  };
  readinessTarget?: CodeServerReadinessTarget;
  readonly?: CodeServerReadonlyInput;
  resolveFrom?: string;
  sessionKey?: string;
  stateRoot?: string;
  trustedOrigins?: string[];
  userDataDir?: string;
  workspacePath?: string;
};

type CodeServerLaunchOptions = CreateCodeServerLaunchPlanOptions;

type CodeServerLaunchPlan = {
  args: string[];
  bindAddr: string;
  bindings: CodeServerPathBinding[];
  browser: {
    policy: CodeServerBrowserReadinessPolicy;
  };
  codeServerPackageRoot: string;
  command: string;
  cwd: string;
  entryKind: CodeServerEntryKind;
  entryPoint: string;
  env: NodeJS.ProcessEnv;
  extensionsDir: string;
  host: string;
  installation: CodeServerInstallation;
  launchMode: Exclude<CodeServerLaunchMode, "auto">;
  port: number;
  preparationStatus: CodeServerPreparationStatus;
  readinessStatus: CodeServerReadinessStatus;
  readonly: CodeServerReadonlyPolicy;
  readonlyEnforcement: CodeServerReadonlyEnforcement;
  recommendedReadablePaths: string[];
  recommendedWritablePaths: string[];
  sandbox: CodeServerSandboxPlan;
  supportBindings: CodeServerPathBinding[];
  supportRoot: string | null;
  translatedPaths: CodeServerTranslatedPath[];
  trustedOrigins: string[];
  userDataDir: string;
  watchdogMode: CodeServerWatchdogMode;
  workspacePath: string | null;
};

type CodeServerIntegrationPlan = CodeServerLaunchPlan & {
  defaultCwd: string;
  defaultEnv: NodeJS.ProcessEnv;
  hostVisiblePaths: string[];
  sandboxVisiblePaths: string[];
};

type CodeServerLaunchSpec = {
  args: string[];
  bindings: CodeServerPathBinding[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  readablePaths: string[];
  readonly: CodeServerReadonlyPolicy;
  writablePaths: string[];
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
  cwd: string;
  env: NodeJS.ProcessEnv;
  exit: Promise<CodeServerProcessExit>;
  extensionsDir: string;
  getStderr(): string;
  getStdout(): string;
  host: string;
  kill(signal?: NodeJS.Signals | number): boolean;
  launchMode: Exclude<CodeServerLaunchMode, "auto">;
  pid: number | undefined;
  plan: CodeServerLaunchPlan;
  port: number;
  supportRoot: string | null;
  userDataDir: string;
  workspacePath: string | null;
};

type CodeServerReadyFailure = {
  code?: string;
  details?: Record<string, unknown>;
  hints?: string[];
  message: string;
  phase?: CodeServerLifecyclePhase;
  retryable?: boolean;
};

type CodeServerReadyFailureProbe = (context: {
  elapsedMs: number;
  host: string;
  port: number;
  process?: CodeServerProcessHandle;
}) => CodeServerReadyFailure | Error | string | null | undefined | Promise<CodeServerReadyFailure | Error | string | null | undefined>;

type CodeServerReadyCheckpoint = {
  details: Record<string, unknown>;
  elapsedMs: number;
  phase: CodeServerLifecyclePhase;
  target: CodeServerReadinessTarget;
};

type CodeServerReadyOptions = {
  browser?: {
    bridge?: CodeServerSessionDiagnosticsBridge;
    timeoutMs?: number;
  };
  failureProbe?: CodeServerReadyFailureProbe;
  host?: string;
  httpHeaders?: Record<string, string>;
  httpUrl?: string;
  process?: CodeServerProcessHandle;
  port: number;
  retryIntervalMs?: number;
  target?: CodeServerReadinessTarget;
  timeoutMs?: number;
  websocketUrl?: string;
};

type CodeServerReadyResult = {
  checkpoints: CodeServerReadyCheckpoint[];
  elapsedMs: number;
  host: string;
  port: number;
  target: CodeServerReadinessTarget;
};

type LaunchCodeServerProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  plan: CodeServerLaunchPlan;
  stderr?(text: string): void;
  stdout?(text: string): void;
};

export type {
  CodeServerIntegrationPlan,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  CodeServerReadyCheckpoint,
  CodeServerReadyFailure,
  CodeServerReadyFailureProbe,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  CreateCodeServerLaunchPlanOptions,
  LaunchCodeServerProcessOptions,
};
