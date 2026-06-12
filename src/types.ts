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
type CodeServerReadinessTarget = "tcp" | "http" | "websocket" | "browser-shell" | "workbench";
type CodeServerLifecyclePhase =
  | "resolve"
  | "prepare"
  | "repair"
  | "profile"
  | "sandbox-plan"
  | "launch"
  | "http-ready"
  | "websocket-ready"
  | "browser-bootstrap"
  | "workbench-ready";
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
type CodeServerReadinessState = "launchable" | "repairable" | "unrecoverable";
type CodeServerRepairOutcome = "noop" | "repaired" | "partially_repaired" | "unrecoverable";
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
  | "browser_bootstrap_failed"
  | "workbench_ready_failed"
  | "unknown";
type CodeServerInstallArtifactKind = "file" | "directory";
type CodeServerDependencyKind = "required" | "optional";
type CodeServerBrowserDiagnosticType =
  | "bootstrap-started"
  | "shell-loaded"
  | "websocket-open"
  | "websocket-error"
  | "workbench-mounted"
  | "bootstrap-timeout"
  | "resource-error"
  | "csp-violation"
  | "service-worker"
  | "iframe-error"
  | "worker-error"
  | "javascript-error"
  | "unhandled-rejection"
  | "readonly-guard"
  | "custom";
type CodeServerBrowserDiagnosticLevel = "info" | "warn" | "error";
type CodeServerReadonlyPolicyMode = "off" | "readonly";

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

type CodeServerInstallArtifactCheck = {
  kind: CodeServerInstallArtifactKind;
  label: string;
  path: string;
  present: boolean;
  runtimeCritical: boolean;
};

type CodeServerDependencyCheck = {
  dependency: string;
  details: Record<string, unknown>;
  fatal: boolean;
  kind: CodeServerDependencyKind;
  message: string;
  present: boolean;
};

type CodeServerReadinessStatus = {
  artifacts: CodeServerInstallArtifactCheck[];
  checkedAt: string;
  dependencies: CodeServerDependencyCheck[];
  entryPoint: string | null;
  issues: CodeServerPreparationIssue[];
  launchable: boolean;
  missingCriticalArtifacts: string[];
  packageRoot: string;
  postinstallScriptPath: string | null;
  state: CodeServerReadinessState;
  supportRoot: string | null;
  watchdogMode: CodeServerWatchdogMode;
};

type CodeServerPreparationStatus = {
  artifacts: CodeServerInstallArtifactCheck[];
  checkedAt: string;
  issues: CodeServerPreparationIssue[];
  launchable: boolean;
  packageRoot: string;
  postinstallScriptPath: string | null;
  readiness: CodeServerReadinessStatus;
  state: CodeServerPreparationState;
  supportRoot: string | null;
  watchdogIssue: CodeServerRuntimeDependencyIssue | null;
  watchdogMode: CodeServerWatchdogMode;
};

type CodeServerRepairAction = {
  changed: boolean;
  command: string;
  details: Record<string, unknown>;
  label: string;
  output: string;
  succeeded: boolean;
};

type CodeServerPreparationResult = {
  actions: CodeServerRepairAction[];
  changed: boolean;
  command: string | null;
  output: string | null;
  outcome: CodeServerRepairOutcome;
  status: CodeServerPreparationStatus;
};

type CodeServerPreparationOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

type CodeServerInstallValidationResult = {
  diagnostic: CodeServerStartupDiagnostics | null;
  ok: boolean;
  status: CodeServerReadinessStatus;
};

type CodeServerRepairOptions = CodeServerPreparationOptions & {
  preferPackageManagerCommand?: boolean;
};

type CodeServerRepairResult = {
  actions: CodeServerRepairAction[];
  changed: boolean;
  diagnostic: CodeServerStartupDiagnostics | null;
  outcome: CodeServerRepairOutcome;
  statusAfter: CodeServerReadinessStatus;
  statusBefore: CodeServerReadinessStatus;
};

type CodeServerEnsureLaunchableOptions = CodeServerRepairOptions & {
  attemptRepair?: boolean;
};

type CodeServerEnsureLaunchableResult = {
  diagnostic: CodeServerStartupDiagnostics | null;
  repaired: CodeServerRepairResult | null;
  status: CodeServerReadinessStatus;
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

type CodeServerTranslatedPath = {
  hostPath: string;
  visiblePath: string;
};

type CodeServerReadonlyPolicyOptions = {
  browserGuards?: {
    blockDragAndDrop?: boolean;
  };
  enabled?: boolean;
  settingsPatch?: Record<string, unknown>;
};

type CodeServerReadonlyPolicy = {
  browserGuards: {
    blockDragAndDrop: boolean;
  };
  enabled: boolean;
  mode: CodeServerReadonlyPolicyMode;
  settingsPatch: Record<string, unknown>;
};

type CodeServerSandboxPlan = {
  bindings: CodeServerPathBinding[];
  collisionSafeName: string | null;
  ephemeralStateRoot: string | null;
  readablePaths: string[];
  readonly: CodeServerReadonlyPolicy;
  sessionRoot: string | null;
  supportMountTargets: string[];
  writablePaths: string[];
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
  readinessStatus: CodeServerReadinessStatus;
  recommendedReadablePaths: string[];
  supportBindings: CodeServerPathBinding[];
  supportRoot: string | null;
  version?: string;
};

type ResolveCodeServerInstallationOptions = {
  resolveFrom?: string;
  strictWatchdog?: boolean;
};

type CodeServerBrowserReadinessPolicy = {
  bootstrapTimeoutMs: number;
  target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench">;
  workbenchSelectors: string[];
};

type CodeServerBrowserDiagnosticEvent = {
  details: Record<string, unknown>;
  level: CodeServerBrowserDiagnosticLevel;
  phase: CodeServerLifecyclePhase;
  retryable: boolean;
  summary: string;
  timestamp: string;
  type: CodeServerBrowserDiagnosticType;
};

type CodeServerBrowserDiagnosticsScriptOptions = {
  bridgeProperty?: string;
  policy?: Partial<CodeServerBrowserReadinessPolicy>;
  readonly?: CodeServerReadonlyPolicyOptions | boolean;
  sessionKey?: string;
};

type CodeServerHtmlInjectionStrategy = "append-body" | "prepend-head";

type CodeServerHtmlInjectionPlan = {
  apply(html: string): string;
  markers: string[];
  script: string;
  snippet: string;
  strategy: CodeServerHtmlInjectionStrategy;
};

type CreateHtmlInjectionPlanOptions = {
  script: string;
  strategy?: CodeServerHtmlInjectionStrategy;
};

type CodeServerSessionDiagnosticsBridge = {
  getEvents(): CodeServerBrowserDiagnosticEvent[];
  getSnapshot(): {
    events: CodeServerBrowserDiagnosticEvent[];
    latestEvent: CodeServerBrowserDiagnosticEvent | null;
    readyTargets: CodeServerReadinessTarget[];
  };
  recordEvent(event: unknown): CodeServerBrowserDiagnosticEvent;
  waitForTarget(target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">, options?: {
    timeoutMs?: number;
  }): Promise<{
    elapsedMs: number;
    event: CodeServerBrowserDiagnosticEvent;
    target: Extract<CodeServerReadinessTarget, "browser-shell" | "workbench" | "websocket">;
  }>;
};

type CreateCodeServerSessionDiagnosticsBridgeOptions = {
  logger?: CodeServerKitLogger;
  loggerAdapter?: CodeServerKitLoggerAdapter;
  policy?: Partial<CodeServerBrowserReadinessPolicy>;
  sanitizer?: CodeServerSanitizerOptions;
};

type CreateCodeServerLaunchPlanOptions = {
  bindAddr?: string;
  browser?: {
    bridge?: CodeServerSessionDiagnosticsBridge;
    policy?: Partial<CodeServerBrowserReadinessPolicy>;
  };
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
  readonly?: CodeServerReadonlyPolicyOptions | boolean;
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
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  category: CodeServerDiagnosticCategory;
  checkpoints?: CodeServerReadyCheckpoint[];
  code: string;
  details: Record<string, unknown>;
  hints: string[];
  journalSummary?: string;
  launchStrategy: CodeServerLaunchStrategy | null;
  phase: CodeServerLifecyclePhase;
  retryable: boolean;
  sanitized?: CodeServerSanitizedDiagnostics;
  stderrTail?: string;
  stdoutTail?: string;
  summary: string;
  watchdogMode?: CodeServerWatchdogMode;
};

type CollectCodeServerStartupDiagnosticsOptions = {
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  category?: CodeServerDiagnosticCategory;
  checkpoints?: CodeServerReadyCheckpoint[];
  error?: unknown;
  hints?: string[];
  journal?: string;
  launchStrategy?: CodeServerLaunchStrategy | null;
  phase?: CodeServerLifecyclePhase;
  preparationStatus?: CodeServerPreparationStatus | null;
  process?: Pick<CodeServerProcessHandle, "getStderr" | "getStdout"> | null;
  retryable?: boolean;
  sanitizer?: CodeServerSanitizerOptions;
  watchdogMode?: CodeServerWatchdogMode;
};

type NormalizedCodeServerStartupFailure = CodeServerStartupDiagnostics & {
  isCodeServerKitError: boolean;
  name: string;
};

type CodeServerSessionDiagnosticsSnapshot = {
  activeState?: string | null;
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | null;
  journalTail?: string;
  normalizedFailure?: NormalizedCodeServerStartupFailure | null;
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
  browserEvents?: CodeServerBrowserDiagnosticEvent[];
  diagnosticsPath: string;
  journalTail?: string;
  normalizedFailure?: NormalizedCodeServerStartupFailure | null;
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
  hints?: string[];
  message: string;
  name: string;
  phase?: CodeServerLifecyclePhase;
  retryable?: boolean;
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
  readinessTarget?: CodeServerReadinessTarget | null;
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
  readinessTarget?: CodeServerReadinessTarget | null;
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
  readiness: CodeServerReadyResult | null;
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
  websocketUrl?: string;
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

type CodeServerDoctorOptions = CodeServerEnsureLaunchableOptions;

type CodeServerDoctorResult = {
  repaired: CodeServerRepairResult | null;
  status: CodeServerReadinessStatus;
  validation: CodeServerInstallValidationResult;
};

type CodeServerSmokeTestOptions = CodeServerSessionRequest & {
  keepSession?: boolean;
};

type CodeServerSmokeTestResult = {
  diagnostics: CodeServerSessionDiagnostics | null;
  readiness: CodeServerReadyResult | null;
  session: CodeServerSessionStartResult;
};

type CodeServerSupportBindingSuggestion = CodeServerPathBinding;

export type {
  BuildCodeServerWebSocketHeadersOptions,
  BuildForwardedHeadersOptions,
  ClassifyCodeServerProxyFailureOptions,
  CodeServerBrowserDiagnosticEvent,
  CodeServerBrowserDiagnosticLevel,
  CodeServerBrowserDiagnosticsScriptOptions,
  CodeServerBrowserDiagnosticType,
  CodeServerBrowserReadinessPolicy,
  CodeServerDiagnosticCategory,
  CodeServerDependencyCheck,
  CodeServerDependencyKind,
  CodeServerDoctorOptions,
  CodeServerDoctorResult,
  CodeServerEnsureLaunchableOptions,
  CodeServerEnsureLaunchableResult,
  CodeServerEntryKind,
  CodeServerHtmlInjectionPlan,
  CodeServerHtmlInjectionStrategy,
  CodeServerHtmlResponseOptions,
  CodeServerInstallArtifactCheck,
  CodeServerInstallArtifactKind,
  CodeServerInstallation,
  CodeServerInstallValidationResult,
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
  CodeServerLifecyclePhase,
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
  CodeServerReadinessState,
  CodeServerReadinessStatus,
  CodeServerReadinessTarget,
  CodeServerReadyCheckpoint,
  CodeServerReadyFailure,
  CodeServerReadyFailureProbe,
  CodeServerReadyOptions,
  CodeServerReadyResult,
  CodeServerReadonlyPolicy,
  CodeServerReadonlyPolicyMode,
  CodeServerReadonlyPolicyOptions,
  CodeServerRepairAction,
  CodeServerRepairOptions,
  CodeServerRepairOutcome,
  CodeServerRepairResult,
  CodeServerRuntimeDependencyIssue,
  CodeServerSandboxPlan,
  CodeServerSanitizedDiagnostics,
  CodeServerSanitizerOptions,
  CodeServerSessionDiagnostics,
  CodeServerSessionDiagnosticsBridge,
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
  CodeServerSmokeTestOptions,
  CodeServerSmokeTestResult,
  CodeServerSupportBindingSuggestion,
  CodeServerStartupDiagnostics,
  CodeServerSystemdFailure,
  CodeServerSystemdJournalOptions,
  CodeServerSystemdLaunchCommand,
  CodeServerSystemdLaunchOptions,
  CodeServerSystemdLaunchResult,
  CodeServerSystemdOptions,
  CodeServerSystemdScope,
  CodeServerSystemdStatus,
  CodeServerSystemdStopOptions,
  CodeServerTranslatedPath,
  CodeServerWatchdogMode,
  CollectCodeServerStartupDiagnosticsOptions,
  CreateCodeServerLaunchPlanOptions,
  CreateCodeServerProfileSyncPlanOptions,
  CreateCodeServerSessionDiagnosticsBridgeOptions,
  CreateHtmlInjectionPlanOptions,
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
