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
type CodeServerWatchdogMode = "disabled_fallback" | "native";
type CodeServerSessionState =
  | "planned"
  | "launching"
  | "ready"
  | "failed"
  | "stopped"
  | "stale"
  | "reusing_existing";
type CodeServerSessionHealth = "failed" | "ready" | "starting" | "stale" | "stopped";
type CodeServerPreparationMode = "auto" | "ensure" | "skip";
type CodeServerPreparationState = "missing" | "prepared" | "repairable";
type CodeServerProfileItem =
  | "settings.json"
  | "extensions.json"
  | "keybindings.json"
  | "snippets"
  | "extensions";
type CodeServerProfileRestorePolicy = "always" | "if-missing-or-empty";
type CodeServerProfilePersistPolicy = "always" | "if-changed";
type CodeServerProfileSignatureMode = "content-hash";
type CodeServerDiagnosticCategory =
  | "entrypoint_resolution_failed"
  | "invalid_configuration"
  | "missing_runtime_dependency"
  | "preparation_failed"
  | "process_exited_before_ready"
  | "startup_timeout"
  | "systemd_launch_failed"
  | "systemd_unit_failed"
  | "unknown";

type CodeServerKitLogMethod = LoggerAdapterLogMethod;
type CodeServerKitLogEvent = LoggerAdapterEvent;
type CodeServerKitGenericLogMethod = LoggerAdapterGenericLogMethod;
type CodeServerKitLogger = LoggerAdapterLogger;
type CodeServerKitLoggerAdapter = LoggerAdapterWriter;
type NormalizedCodeServerKitLogger = NormalizedLoggerAdapter;

type CodeServerPreparationIssue = {
  code: string;
  details: Record<string, unknown>;
  message: string;
};

type CodeServerRuntimeDependencyIssue = CodeServerPreparationIssue & {
  dependency: string;
  fatal: boolean;
};

type CodeServerPreparationStatus = {
  checkedAt: string;
  issues: CodeServerPreparationIssue[];
  packageRoot: string;
  postinstallScriptPath: string | null;
  state: CodeServerPreparationState;
  supportRoot: string | null;
  watchdogIssue: CodeServerRuntimeDependencyIssue | null;
  watchdogMode: CodeServerWatchdogMode;
};

type CodeServerPreparationResult = {
  changed: boolean;
  command: string | null;
  output: string | null;
  status: CodeServerPreparationStatus;
};

type CodeServerPreparationOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

type CodeServerPackageManagerHints = {
  installCommand: string;
  packageManager: "npm" | "unknown";
};

type CodeServerPathBinding = {
  access: CodeServerPathAccessMode;
  hostPath: string;
  mountPath: string;
  reason: string;
};

type CodeServerInstallation = {
  defaultCwd: string;
  defaultEnv: NodeJS.ProcessEnv;
  entryArgs: string[];
  entryCommand: string;
  entryKind: CodeServerEntryKind;
  entryPoint: string;
  entryRelativePath: string;
  packageJsonPath: string;
  packageManagerHints: CodeServerPackageManagerHints;
  packageRoot: string;
  preparationStatus: CodeServerPreparationStatus;
  recommendedReadablePaths: string[];
  supportBindings: CodeServerPathBinding[];
  supportRoot: string | null;
  version?: string;
};

type ResolveCodeServerInstallationOptions = {
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

type CodeServerTranslatedPath = {
  hostPath: string;
  visiblePath: string;
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
  preparation?: {
    mode?: CodeServerPreparationMode;
    strictWatchdog?: boolean;
  };
  resolveFrom?: string;
  trustedOrigins?: string[];
  userDataDir?: string;
  workspacePath?: string;
};

type CodeServerLaunchOptions = CreateCodeServerLaunchPlanOptions;

type CodeServerLaunchPlan = {
  args: string[];
  bindAddr: string;
  bindings: CodeServerPathBinding[];
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
  recommendedReadablePaths: string[];
  recommendedWritablePaths: string[];
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
  changed: boolean;
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

type CodeServerProfileSnapshotEntry = {
  item: CodeServerProfileItem;
  present: boolean;
  signature: string | null;
};

type CodeServerProfileSnapshot = {
  entries: CodeServerProfileSnapshotEntry[];
  rootDir: string;
  signature: string;
};

type ReadCodeServerProfileSnapshotOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  rootDir: string;
  snapshotExtensions?: boolean;
};

type ReadCodeServerProfileSignatureOptions = ReadCodeServerProfileSnapshotOptions;

type PersistCodeServerProfileIfChangedOptions = SyncCodeServerProfileOptions & {
  signatureMode?: CodeServerProfileSignatureMode;
  snapshotExtensions?: boolean;
};

type PersistCodeServerProfileIfChangedResult = CodeServerProfileSyncResult & {
  nextSignature: string;
  previousSignature: string | null;
};

type CodeServerProfileLifecycleOptions = {
  items?: CodeServerProfileItem[];
  pathMap?: Partial<CodeServerProfilePathMap>;
  persistPolicy?: CodeServerProfilePersistPolicy;
  persistTo?: string;
  restoreFrom?: string;
  restorePolicy?: CodeServerProfileRestorePolicy;
  signatureMode?: CodeServerProfileSignatureMode;
  skipMissing?: boolean;
  skipUnreadable?: boolean;
  snapshotExtensions?: boolean;
};

type BuildForwardedHeadersOptions = {
  forwardedFor?: string | string[];
  forwardedHost?: string;
  forwardedProto?: string;
  host?: string;
  port?: number | string;
  proto?: string;
};

type BuildCodeServerWebSocketHeadersOptions = BuildForwardedHeadersOptions & {
  connection?: string;
  upgrade?: string;
};

type CodeServerProxyFailureCategory = "refused" | "reset" | "timeout" | "upstream_failure" | "unknown";

type ClassifyCodeServerProxyFailureOptions = {
  error?: unknown;
  statusCode?: number | null;
};

type CodeServerProxyFailure = {
  category: CodeServerProxyFailureCategory;
  details: Record<string, unknown>;
  message: string;
};

type CodeServerHtmlResponseOptions = {
  contentType?: string | null;
  headers?: Headers | Record<string, unknown>;
  method?: string;
  statusCode?: number;
};

type CodeServerSanitizerOptions = {
  pathPrefixes?: string[];
  values?: string[];
  replacer?(value: string): string;
};

type CodeServerSanitizedDiagnostics = {
  details: Record<string, unknown>;
  summary: string;
};

type CodeServerStartupDiagnostics = {
  category: CodeServerDiagnosticCategory;
  code: string;
  details: Record<string, unknown>;
  journalSummary?: string;
  launchStrategy: CodeServerLaunchStrategy | null;
  sanitized?: CodeServerSanitizedDiagnostics;
  stderrTail?: string;
  stdoutTail?: string;
  summary: string;
  watchdogMode?: CodeServerWatchdogMode;
};

type CollectCodeServerStartupDiagnosticsOptions = {
  category?: CodeServerDiagnosticCategory;
  error?: unknown;
  journal?: string;
  launchStrategy?: CodeServerLaunchStrategy | null;
  preparationStatus?: CodeServerPreparationStatus | null;
  process?: Pick<CodeServerProcessHandle, "getStderr" | "getStdout"> | null;
  sanitizer?: CodeServerSanitizerOptions;
  watchdogMode?: CodeServerWatchdogMode;
};

type NormalizedCodeServerStartupFailure = CodeServerStartupDiagnostics & {
  isCodeServerKitError: boolean;
  name: string;
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
  normalizedFailure?: CodeServerStartupDiagnostics | null;
  readyElapsedMs?: number | null;
  recordPath: string;
  sanitized?: CodeServerSanitizedDiagnostics | null;
  stderrTail?: string;
  stdoutTail?: string;
  summary: Record<string, unknown>;
  updatedAt: string;
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
  failure?: CodeServerSessionFailure | null;
  health: CodeServerSessionHealth;
  lastStartSummary?: string | null;
  launchStrategy: CodeServerLaunchStrategy;
  pid: number | null;
  port: number;
  preparation: CodeServerPreparationStatus | null;
  readyAt: string | null;
  sanitizedDiagnostics?: CodeServerSanitizedDiagnostics | null;
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
  watchdogMode: CodeServerWatchdogMode;
  workspacePath: string | null;
};

type CodeServerSessionStatus = {
  bindAddr: string;
  diagnostics: CodeServerSessionDiagnostics | null;
  extensionsDir: string;
  failure: CodeServerSessionFailure | null;
  health: CodeServerSessionHealth;
  lastStartSummary: string | null;
  launchStrategy: CodeServerLaunchStrategy;
  pid: number | null;
  port: number;
  preparation: CodeServerPreparationStatus | null;
  ready: boolean;
  readyAt: string | null;
  sanitizedDiagnostics: CodeServerSanitizedDiagnostics | null;
  sessionKey: string;
  specHash: string;
  startedAt: string | null;
  state: CodeServerSessionState;
  stoppedAt: string | null;
  systemdScope: CodeServerSystemdScope | null;
  unitName: string | null;
  updatedAt: string;
  userDataDir: string;
  watchdogMode: CodeServerWatchdogMode;
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
  sanitizer?: CodeServerSanitizerOptions;
  sessionKey: string;
  stateRoot: string;
  systemd?: CodeServerSystemdOptions;
};

type CodeServerSessionManager = {
  getStatus(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionStatus | null>;
  readDiagnostics(options: Pick<CodeServerSessionRequest, "sanitizer" | "sessionKey" | "stateRoot">): Promise<CodeServerSessionDiagnostics | null>;
  restart(options: CodeServerSessionRequest): Promise<CodeServerSessionRestartResult>;
  start(options: CodeServerSessionRequest): Promise<CodeServerSessionStartResult>;
  stop(options: Pick<CodeServerSessionRequest, "logger" | "loggerAdapter" | "profile" | "sanitizer" | "sessionKey" | "stateRoot"> & {
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
  stateLabel: "failed" | "not_found" | "ready" | "stale";
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

type CodeServerSystemdFailure = {
  diagnostics: CodeServerStartupDiagnostics;
  summary: string;
};

export type {
  BuildCodeServerWebSocketHeadersOptions,
  BuildForwardedHeadersOptions,
  ClassifyCodeServerProxyFailureOptions,
  CodeServerDiagnosticCategory,
  CodeServerEntryKind,
  CodeServerHtmlResponseOptions,
  CodeServerInstallation,
  CodeServerIntegrationPlan,
  CodeServerKitGenericLogMethod,
  CodeServerKitLogEvent,
  CodeServerKitLogger,
  CodeServerKitLoggerAdapter,
  CodeServerKitLogMethod,
  CodeServerLaunchMode,
  CodeServerLaunchOptions,
  CodeServerLaunchPlan,
  CodeServerLaunchSpec,
  CodeServerLaunchStrategy,
  CodeServerPackageManagerHints,
  CodeServerPathAccessMode,
  CodeServerPathBinding,
  CodeServerPreparationIssue,
  CodeServerPreparationMode,
  CodeServerPreparationOptions,
  CodeServerPreparationResult,
  CodeServerPreparationState,
  CodeServerPreparationStatus,
  CodeServerProcessExit,
  CodeServerProcessHandle,
  CodeServerProfileEntryKind,
  CodeServerProfileItem,
  CodeServerProfileLifecycleOptions,
  CodeServerProfilePathMap,
  CodeServerProfilePersistPolicy,
  CodeServerProfileRestorePolicy,
  CodeServerProfileSignatureMode,
  CodeServerProfileSkipReason,
  CodeServerProfileSnapshot,
  CodeServerProfileSnapshotEntry,
  CodeServerProfileSyncEntry,
  CodeServerProfileSyncPlan,
  CodeServerProfileSyncResult,
  CodeServerProxyFailure,
  CodeServerProxyFailureCategory,
  CodeServerReadyFailure,
  CodeServerReadyFailureProbe,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  CodeServerRuntimeDependencyIssue,
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsSnapshot,
  CodeServerSessionFailure,
  CodeServerSessionHealth,
  CodeServerSessionManager,
  CodeServerSessionManagerOptions,
  CodeServerSessionRecord,
  CodeServerSessionRequest,
  CodeServerSessionRestartResult,
  CodeServerSessionStartResult,
  CodeServerSessionState,
  CodeServerSessionStatus,
  CodeServerSessionStopResult,
  CodeServerSystemdFailure,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdOptions,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
  CodeServerSupportBindingSuggestion,
  CodeServerStartupDiagnostics,
  CodeServerTranslatedPath,
  CodeServerWatchdogMode,
  CollectCodeServerStartupDiagnosticsOptions,
  CreateCodeServerLaunchPlanOptions,
  CreateCodeServerProfileSyncPlanOptions,
  LaunchCodeServerProcessOptions,
  NormalizedCodeServerKitLogger,
  NormalizedCodeServerStartupFailure,
  PersistCodeServerProfileIfChangedOptions,
  PersistCodeServerProfileIfChangedResult,
  ReadCodeServerProfileSignatureOptions,
  ReadCodeServerProfileSnapshotOptions,
  ResolveCodeServerInstallationOptions,
  SyncCodeServerProfileOptions,
};

type CodeServerSupportBindingSuggestion = CodeServerPathBinding;
