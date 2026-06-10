import type { ChildProcess } from "node:child_process";
import type {
  LoggerAdapterEvent,
  LoggerAdapterGenericLogMethod,
  LoggerAdapterLogger,
  LoggerAdapterLogMethod,
  LoggerAdapterWriter,
  NormalizedLoggerAdapter,
} from "@trebired/logger-adapter";

type CodeServerEntryKind = "node_script" | "executable";
type CodeServerLaunchMode = "auto" | "direct" | "node";
type CodeServerLaunchStrategy = "direct" | "systemd";
type CodeServerSystemdScope = "user" | "system";
type CodeServerPathAccessMode = "read" | "write";
type CodeServerSessionState =
  | "planned"
  | "launching"
  | "ready"
  | "failed"
  | "stopped"
  | "stale"
  | "reusing_existing";
type CodeServerProfileItem =
  | "settings.json"
  | "extensions.json"
  | "keybindings.json"
  | "snippets"
  | "extensions";

type CodeServerKitLogMethod = LoggerAdapterLogMethod;
type CodeServerKitLogEvent = LoggerAdapterEvent;
type CodeServerKitGenericLogMethod = LoggerAdapterGenericLogMethod;
type CodeServerKitLogger = LoggerAdapterLogger;
type CodeServerKitLoggerAdapter = LoggerAdapterWriter;
type NormalizedCodeServerKitLogger = NormalizedLoggerAdapter;

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

type CodeServerProfileLifecycleOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  persistTo?: string;
  restoreFrom?: string;
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

type CodeServerSupportBindingSuggestion = {
  access: CodeServerPathAccessMode;
  hostPath: string;
  mountPath: string;
  reason: string;
};

type CodeServerLaunchPlanResult = CodeServerLaunchPlan & {
  entryKind: CodeServerEntryKind;
  env: NodeJS.ProcessEnv;
  supportBindings: CodeServerSupportBindingSuggestion[];
};

type CodeServerSessionManagerOptions = {
  installation?: CodeServerInstallation;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resolveFrom?: string;
};

type CodeServerSystemdOptions = {
  extraProperties?: string[];
  scope?: CodeServerSystemdScope;
  unitName?: string;
};

type CodeServerSessionRequest = CreateCodeServerLaunchPlanOptions & {
  failureProbe?: CodeServerReadyFailureProbe;
  launchStrategy?: CodeServerLaunchStrategy;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  profile?: CodeServerProfileLifecycleOptions;
  readinessRetryIntervalMs?: number;
  readinessTimeoutMs?: number;
  sessionKey: string;
  stateRoot: string;
  systemd?: CodeServerSystemdOptions;
};

type CodeServerSessionFailure = {
  code: string;
  details: Record<string, unknown>;
  message: string;
  name: string;
};

type CodeServerSessionRecord = {
  bindAddr: string;
  diagnostics: CodeServerSessionDiagnosticsSnapshot | null;
  extensionsDir: string;
  launchStrategy: CodeServerLaunchStrategy;
  pid: number | null;
  port: number;
  readyAt: string | null;
  sessionKey: string;
  specHash: string;
  startedAt: string | null;
  state: CodeServerSessionState;
  stoppedAt: string | null;
  systemdScope: CodeServerSystemdScope | null;
  trustedOrigins: string[];
  unitName: string | null;
  updatedAt: string;
  userDataDir: string;
  workspacePath: string | null;
  failure?: CodeServerSessionFailure | null;
};

type CodeServerSessionDiagnosticsSnapshot = {
  activeState?: string | null;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
  journalTail?: string;
  pid?: number | null;
  readyElapsedMs?: number | null;
  stderrTail?: string;
  stdoutTail?: string;
  subState?: string | null;
  summary?: Record<string, unknown>;
  updatedAt: string;
  unitName?: string | null;
};

type CodeServerSessionDiagnostics = {
  diagnosticsPath: string;
  journalTail?: string;
  readyElapsedMs?: number | null;
  recordPath: string;
  stderrTail?: string;
  stdoutTail?: string;
  summary: Record<string, unknown>;
  updatedAt: string;
};

type CodeServerSessionStatus = {
  bindAddr: string;
  diagnostics: CodeServerSessionDiagnostics | null;
  extensionsDir: string;
  failure: CodeServerSessionFailure | null;
  launchStrategy: CodeServerLaunchStrategy;
  pid: number | null;
  port: number;
  ready: boolean;
  readyAt: string | null;
  sessionKey: string;
  specHash: string;
  startedAt: string | null;
  state: CodeServerSessionState;
  stoppedAt: string | null;
  systemdScope: CodeServerSystemdScope | null;
  unitName: string | null;
  updatedAt: string;
  userDataDir: string;
  workspacePath: string | null;
};

type CodeServerSessionStartResult = {
  created: boolean;
  diagnostics: CodeServerSessionDiagnostics | null;
  handle: CodeServerProcessHandle | null;
  launchPlan: CodeServerLaunchPlan;
  launchStrategy: CodeServerLaunchStrategy;
  reused: boolean;
  status: CodeServerSessionStatus;
};

type CodeServerSessionStopResult = {
  diagnostics: CodeServerSessionDiagnostics | null;
  signal?: NodeJS.Signals | number;
  status: CodeServerSessionStatus;
  stopped: boolean;
};

type CodeServerSessionRestartResult = {
  start: CodeServerSessionStartResult;
  stop: CodeServerSessionStopResult;
};

type CodeServerSessionManager = {
  getStatus(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionStatus | null>;
  readDiagnostics(options: Pick<CodeServerSessionRequest, "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null>;
  restart(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult>;
  start(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult>;
  stop(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sessionKey" | "stateRoot"> & {
    signal?: NodeJS.Signals | number;
  }): Promise<CodeServerSessionStopResult | null>;
};

type CodeServerSystemdLaunchOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  extraProperties?: string[];
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  plan: CodeServerLaunchPlan;
  scope: CodeServerSystemdScope;
  sessionKey?: string;
  unitName?: string;
};

type CodeServerSystemdLaunchCommand = {
  args: string[];
  command: string;
  scope: CodeServerSystemdScope;
  unitName: string;
};

type CodeServerSystemdLaunchResult = CodeServerSystemdLaunchCommand & {
  output: string;
};

type CodeServerSystemdStatus = {
  activeState: string | null;
  execMainPid: number | null;
  failed: boolean;
  loadState: string | null;
  notFound: boolean;
  raw: Record<string, string>;
  reusable: boolean;
  result: string | null;
  scope: CodeServerSystemdScope;
  subState: string | null;
  unitName: string;
};

type CodeServerSystemdJournalOptions = {
  lines?: number;
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  scope: CodeServerSystemdScope;
  unitName: string;
};

type CodeServerSystemdStopOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resetFailed?: boolean;
  scope: CodeServerSystemdScope;
  unitName: string;
};

export type {
  BuildForwardedHeadersOptions,
  CodeServerEntryKind,
  CodeServerHtmlResponseOptions,
  CodeServerInstallation,
  CodeServerKitGenericLogMethod,
  CodeServerKitLogEvent,
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerKitLogMethod,
  CodeServerLaunchMode,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerLaunchPlanResult,
  CodeServerLaunchSpec,
  CodeServerLaunchStrategy,
  CodeServerPathAccessMode,
  CodeServerPathBinding,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  CodeServerProfileEntryKind,
  CodeServerProfileItem,
  CodeServerProfileLifecycleOptions,
  CodeServerProfilePathMap,
  CodeServerProfileSkipReason,
  CodeServerProfileSyncEntry,
  CodeServerProfileSyncPlan,
  CodeServerProfileSyncResult,
  CodeServerReadyFailure,
  CodeServerReadyFailureProbe,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionFailure,
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStartResult,
  CodeServerSessionState,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
  CodeServerSupportBindingSuggestion,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdOptions,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
  CreateCodeServerLaunchPlanOptions,
  CreateCodeServerProfileSyncPlanOptions,
  LaunchCodeServerProcessOptions,
  NormalizedCodeServerKitLogger,
  NormalizedCodeServerStartupFailure,
  ResolveCodeServerInstallationOptions,
  SyncCodeServerProfileOptions,
};
