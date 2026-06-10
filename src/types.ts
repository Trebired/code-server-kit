import type { ChildProcess } from "node:child_process";

type CodeServerEntryKind = "node_script" | "executable";
type CodeServerLaunchMode = "auto" | "direct" | "node";
type CodeServerPathAccessMode = "read" | "write";
type CodeServerProfileItem =
  | "settings.json"
  | "extensions.json"
  | "keybindings.json"
  | "snippets"
  | "extensions";

type CodeServerInstallation = {
  entryKind: CodeServerEntryKind;
  entryPoint: string;
  entryRelativePath: string;
  packageJsonPath: string;
  packageRoot: string;
  supportRoot: string | null;
  version?: string;
};

type ResolveCodeServerInstallationOptions = {
  resolveFrom?: string;
};

type CodeServerPathBinding = {
  access: CodeServerPathAccessMode;
  hostPath: string;
  mountPath: string;
  reason: string;
};

type CreateCodeServerLaunchPlanOptions = {
  bindAddr?: string;
  cwd?: string;
  dataRoot?: string;
  env?: NodeJS.ProcessEnv;
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

type CodeServerLaunchOptions = CreateCodeServerLaunchPlanOptions;

type CodeServerLaunchPlan = {
  args: string[];
  bindAddr: string;
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
  recommendedReadablePaths: string[];
  recommendedWritablePaths: string[];
  supportBindings: CodeServerPathBinding[];
  supportRoot: string | null;
  trustedOrigins: string[];
  userDataDir: string;
  workspacePath: string | null;
};

type CodeServerLaunchSpec = {
  args: string[];
  bindings: CodeServerPathBinding[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  readablePaths: string[];
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
  message: string;
};

type CodeServerReadyFailureProbe = (context: {
  elapsedMs: number;
  host: string;
  port: number;
  process?: CodeServerProcessHandle;
}) => CodeServerReadyFailure | Error | string | null | undefined | Promise<CodeServerReadyFailure | Error | string | null | undefined>;

type CodeServerReadyOptions = {
  failureProbe?: CodeServerReadyFailureProbe;
  host?: string;
  process?: CodeServerProcessHandle;
  port: number;
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

type CodeServerProfilePathMap = Record<CodeServerProfileItem, string>;
type CodeServerProfileEntryKind = "directory" | "file";

type CodeServerProfileSyncEntry = {
  item: CodeServerProfileItem;
  kind: CodeServerProfileEntryKind;
  relativePath: string;
  sourcePath: string;
  targetPath: string;
};

type CreateCodeServerProfileSyncPlanOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  sourceDir: string;
  targetDir: string;
};

type CodeServerProfileSyncPlan = {
  entries: CodeServerProfileSyncEntry[];
  items: CodeServerProfileItem[];
  sourceDir: string;
  targetDir: string;
};

type CodeServerProfileSkipReason = "missing_source" | "unreadable_source";

type CodeServerProfileSyncResult = {
  copied: CodeServerProfileSyncEntry[];
  skipped: Array<{
    entry: CodeServerProfileSyncEntry;
    reason: CodeServerProfileSkipReason;
  }>;
};

type SyncCodeServerProfileOptions = CreateCodeServerProfileSyncPlanOptions & {
  skipMissing?: boolean;
  skipUnreadable?: boolean;
};

type BuildForwardedHeadersOptions = {
  forwardedFor?: string | string[];
  forwardedHost?: string;
  forwardedProto?: string;
  host?: string;
  port?: number | string;
  proto?: string;
};

type CodeServerHtmlResponseOptions = {
  contentType?: string | null;
  headers?: Headers | Record<string, unknown>;
  method?: string;
  statusCode?: number;
};

type NormalizedCodeServerStartupFailure = {
  code: string | null;
  details: Record<string, unknown>;
  isCodeServerKitError: boolean;
  message: string;
  name: string;
};

export type {
  BuildForwardedHeadersOptions,
  CodeServerEntryKind,
  CodeServerHtmlResponseOptions,
  CodeServerInstallation,
  CodeServerLaunchMode,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerPathAccessMode,
  CodeServerPathBinding,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  CodeServerProfileEntryKind,
  CodeServerProfileItem,
  CodeServerProfilePathMap,
  CodeServerProfileSkipReason,
  CodeServerProfileSyncEntry,
  CodeServerProfileSyncPlan,
  CodeServerProfileSyncResult,
  CodeServerReadyFailure,
  CodeServerReadyFailureProbe,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  CreateCodeServerLaunchPlanOptions,
  CreateCodeServerProfileSyncPlanOptions,
  LaunchCodeServerProcessOptions,
  NormalizedCodeServerStartupFailure,
  ResolveCodeServerInstallationOptions,
  SyncCodeServerProfileOptions,
};
